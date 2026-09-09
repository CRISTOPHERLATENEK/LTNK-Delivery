/**
 * Rotas de autenticação: cadastro, login (com rate limiting) e dados da sessão.
 */
/*
 * BCRYPT ASSÍNCRONO EM TODA ROTA — nunca `hashSync`/`compareSync`.
 *
 * O `bcrypt` nativo faz o cálculo no POOL DE THREADS do sistema, fora da thread
 * que atende requisição. A versão anterior (`bcryptjs`, JavaScript puro) fazia
 * na mesma — e medido nesta máquina, cinco verificações de senha travavam o
 * event loop por 384 ms, durante os quais a instância não respondia mais nada,
 * nem o health check. Com o nativo, a mesma carga trava 11 ms.
 *
 * ATENÇÃO: o `bcryptjs` também tem API assíncrona, e ela NÃO resolve — medido:
 * 77 ms contra 74 ms do síncrono. Ele cede o controle entre rodadas, mas em
 * pedaços grandes demais pra fazer diferença. Trocar `compareSync` por
 * `compare` mantendo o bcryptjs daria a impressão de ter consertado.
 *
 * Os hashes são os mesmos: um hash gerado pelo bcryptjs é lido pelo nativo
 * (conferido antes da troca), então ninguém precisou trocar de senha.
 */
import { Router, type Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import db, { comTenant, bancoTenantAtual } from '../db-mysql';
import {
  provedoresDisponiveis, assinarEstado, lerEstado, urlDeAutorizacao,
  perfilDoCodigo, decidirVinculo, nomeUsavel, type ProvedorOauth,
} from '../oauth';
import { listarTenants, urlDoTenant, poolCentral, Tenant } from '../tenants-mysql';
import { gerarToken, gerarTokenPreAuth, gerarTokenConvidado, autenticar, autenticarPreAuth, gerarTokenRevendedor } from '../auth';
import { registrarAcesso } from '../ultimo-acesso';
import { agoraUTC, textoLimpo, emailValido, cpfValido, cpfDigitos, telefoneDigitos, telefoneValido, erroHttp } from '../util';
import { enviarEmail, emailRedefinirSenha, emailHabilitado } from '../email';
import { criptografar, descriptografar } from '../cripto';
import { Perfil, Usuario } from '../../tipos/modelos';
import { VERSAO_DOCUMENTOS } from '../documentos-legais';

/** Perfis que exigem 2FA (TOTP) obrigatório pra logar. */
const PERFIS_2FA: Perfil[] = ['lojista', 'admin'];

const router = Router();

// Rate limiting no login (10 falhas por IP em 15 min)
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { erro: 'Muitas tentativas de login. Aguarde 15 minutos e tente novamente.' },
});

// Rate limiting no pedido de redefinição (evita usar o e-mail alheio pra spam)
const limiteEsqueciSenha = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitos pedidos de redefinição. Aguarde 15 minutos e tente novamente.' },
});

// Rate limiting no cadastro (evita varrer CPF/telefone/e-mail em massa pra
// descobrir quais já têm conta, e reduz o custo de criação de conta em massa).
const limiteRegistro = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de cadastro. Aguarde 15 minutos e tente novamente.' },
});

// Código de 6 dígitos é força-bruteável sem limite (1M combinações, mas a
// janela TOTP é só 30s — poucas tentativas por minuto já bastam pra reduzir
// bastante a chance). Mesma janela/limite do rate limit de login.
const limite2fa = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' },
});

const PERFIS_PUBLICOS: Perfil[] = ['cliente', 'entregador'];

/**
 * A VERSÃO DOS DOCUMENTOS VIGENTE AGORA.
 *
 * Gravada junto com o aceite de cada pessoa. Sem ela, o registro diz "aceitou
 * em tal data" e não diz o QUE aceitou — e é justamente isso que se pergunta
 * quando os termos mudam.
 *
 * Vazio quando o admin ainda não publicou versão: aí o registro prova só a
 * data, o que é melhor que nada e melhor que inventar uma versão.
 */
async function versaoDosTermos(): Promise<string> {
  try {
    const row = await db.prepare(
      "SELECT valor FROM configuracoes WHERE chave = 'termos_versao'"
    ).get() as { valor: string | null } | undefined;
    /*
     * VAZIO CAI NA VERSAO PUBLICADA, nao em string vazia.
     *
     * `termos_versao` nasce vazio, e nenhuma instalacao tinha preenchido: o
     * aceite de todo mundo estava sendo gravado como aceite da versao "" — data
     * de aceite sem documento, que nao prova o que a pessoa concordou. O padrao
     * agora e a versao que viaja com o codigo, e o campo do admin continua
     * ganhando de quem publica documento proprio.
     */
    return row?.valor || VERSAO_DOCUMENTOS;
  } catch {
    return VERSAO_DOCUMENTOS;
  }
}

/**
 * PEDIDO SEM CRIAR CONTA — só nome e WhatsApp.
 *
 * Abre uma sessão de CONVIDADO: a pessoa fecha o pedido e acompanha a entrega
 * sem inventar senha. Existe porque criar conta antes da primeira compra é
 * atrito no pior momento possível — a pessoa ainda não sabe se gosta da loja.
 *
 * COMO ISSO NÃO VIRA UM BURACO DE PRIVACIDADE:
 *
 * O pedido precisa de `cliente_id`, então uma conta é criada de verdade — e o
 * telefone é único no banco, então um número que já pediu antes REUSA a conta
 * existente, com o endereço e o histórico dela. Se a sessão de convidado
 * enxergasse isso, qualquer pessoa que digitasse o número de outra veria onde
 * ela mora. Num app de entrega, endereço de casa.
 *
 * Por isso a sessão vale para UM PEDIDO e nada mais (ver `gerarTokenConvidado`
 * e a guarda em rotas/cliente.ts): ela pode criar pedido e endereço, e depois
 * ler e pagar o pedido que criou. Não lista histórico, não lista endereços
 * salvos, não abre a conta. Quem quiser histórico e endereço salvo cria senha —
 * e aí é login normal.
 *
 * A CONTA NÃO GANHA SENHA. `senha_hash` é NOT NULL, então guarda o hash de 32
 * bytes aleatórios: não existe senha que abra, nem para nós. `sem_senha = 1`
 * marca isso, para o login poder dizer a verdade em vez de "senha inválida" a
 * quem nunca teve uma.
 */
router.post('/convidado', limiteRegistro, async (req, res, next) => {
  try {
    const nome = textoLimpo(req.body.nome, 120);
    const telefone = telefoneDigitos(req.body.telefone);

    if (nome.length < 2) throw erroHttp(400, 'Informe seu nome.');
    /* O valor CRU: `telefoneDigitos` corta em 11 e um dígito a mais viraria
       outro número válido. Mesma razão do cadastro. */
    if (!telefoneValido(req.body.telefone)) {
      throw erroHttp(400, 'Informe um WhatsApp válido com DDD.');
    }

    const lojaId = req.body.loja_id ? Number(req.body.loja_id) : null;

    const existente = await db.prepare(
      "SELECT id, perfil, bloqueado FROM usuarios WHERE telefone = ?"
    ).get(telefone) as { id: number; perfil: string; bloqueado: number } | undefined;

    /*
     * TELEFONE DE LOJISTA/ENTREGADOR/ADMIN NÃO ABRE SESSÃO DE CONVIDADO.
     *
     * Sem esta guarda, digitar o telefone do dono da loja devolveria um token
     * com o `sub` dele. A guarda de rotas/cliente.ts limitaria o alcance, mas
     * apoiar a segurança numa segunda camada quando a primeira dá para fechar
     * é escolher o risco de graça.
     */
    if (existente && existente.perfil !== 'cliente') {
      throw erroHttp(409, 'Esse número já é usado por uma conta da loja. Faça login para continuar.');
    }
    if (existente?.bloqueado) {
      throw erroHttp(403, 'Esse número está bloqueado. Fale com o suporte.');
    }

    let usuarioId: number;
    if (existente) {
      usuarioId = existente.id;
      /* NÃO atualiza o nome do cadastro com o que foi digitado agora: a conta
         pode ser de alguém que já se cadastrou de verdade, e um pedido de
         convidado não tem autoridade para renomear ninguém. */
    } else {
      /* Senha impossível: 32 bytes aleatórios que ninguém vê, nem guarda. */
      const senhaImpossivel = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      const info = await db.prepare(
        `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, loja_id, cpf,
                               criado_em, sem_senha, termos_aceitos_em, termos_versao)
         VALUES (?, ?, ?, 'cliente', ?, ?, NULL, ?, 1, ?, ?)`
      ).run(nome, `${telefone}@cliente.local`, senhaImpossivel, telefone,
            lojaId, agoraUTC(), agoraUTC(), await versaoDosTermos());
      usuarioId = Number(info.lastInsertRowid);
    }

    /* Nasce SEM pedido: neste estado a sessão só pode criar. */
    res.status(201).json({
      token: gerarTokenConvidado(usuarioId, null),
      usuario: { id: usuarioId, nome, email: '', perfil: 'cliente', telefone, cpf: null },
      convidado: true,
    });
  } catch (e) { next(e); }
});

router.post('/registrar', limiteRegistro, async (req, res, next) => {
  try {
    const nome = textoLimpo(req.body.nome, 120);
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    const telefone = telefoneDigitos(req.body.telefone);
    const perfil = (textoLimpo(req.body.perfil, 20) || 'cliente') as Perfil;
    const cpf = cpfDigitos(req.body.cpf);

    if (nome.length < 2) throw erroHttp(400, 'Informe seu nome completo.');
    if (senha.length < 6) throw erroHttp(400, 'A senha precisa ter pelo menos 6 caracteres.');
    // Lojista não se autocadastra: cada lojista novo ganha um banco isolado,
    // criado pelo admin em Clientes (Tenants) — ver POST /api/admin/tenants.
    if (perfil === 'lojista') {
      throw erroHttp(403, 'Cadastro de lojista é feito pela nossa equipe. Entre em contato pra abrir sua loja.');
    }
    if (!PERFIS_PUBLICOS.includes(perfil)) throw erroHttp(400, 'Perfil inválido.');

    /*
     * DO CLIENTE, SÓ O TELEFONE É OBRIGATÓRIO — CPF e e-mail são opcionais.
     *
     * Antes o CPF era exigido, "dado fiscal, usado na NFC-e". Só que ele NÃO É
     * necessário para a nota: sem CPF a venda sai como consumidor final, que é
     * legal e é como a maioria das vendas de balcão sai. O que o CPF obrigatório
     * fazia de verdade era pedir documento de identidade a quem só quer pedir
     * uma pizza — o atrito mais caro que existe, porque acontece antes da
     * primeira compra, quando a pessoa ainda não tem motivo nenhum para
     * confiar. Quem quiser o CPF na nota preenche; quem não quiser, compra.
     *
     * O TELEFONE, EM TROCA, PASSOU A SER EXIGIDO — e não é simetria: é o que a
     * loja precisa para falar com quem pediu (entrega, troco, produto que
     * faltou) e é por ele que a pessoa entra na conta depois (o login já aceita
     * telefone; ver /login). Ele deixou de ser um "seria bom ter" e virou a
     * identidade, então é validado de verdade agora — telefone errado é conta
     * que ninguém recupera.
     *
     * Mensagem de conflito GENÉRICA de propósito, igual pra CPF/telefone/
     * e-mail: mensagens distintas por campo davam pra descobrir se um CPF ou
     * telefone específico já tem conta na plataforma só tentando cadastrar
     * (enumeração de conta — sensível pra CPF, que é dado de identidade).
     */
    const CONFLITO = 'Não foi possível concluir o cadastro com esses dados. Se você já tem conta, faça login; senão, confira CPF/telefone/e-mail informados.';
    const ehCliente = perfil === 'cliente';
    if (ehCliente) {
      /*
       * VALIDA O VALOR CRU DO CORPO, não a variável já cortada.
       *
       * `telefoneDigitos` corta em 11 dígitos. Validando a variável, doze
       * dígitos passavam: o corte descartava o último e sobrava um número
       * válido — e a pessoa recebia "já existe conta com esses dados", que é
       * uma mentira sobre um erro de digitação. Medido contra produção depois
       * de eu já ter "consertado" isto na função: o conserto não alcançava a
       * rota, porque o corte acontece antes dela chamar.
       */
      if (!telefoneValido(req.body.telefone)) {
        throw erroHttp(400, 'Informe um telefone válido com DDD.');
      }
      if (email && !emailValido(email)) throw erroHttp(400, 'E-mail inválido.');
      /* CPF só é validado quando vem preenchido: vazio é resposta legítima, mas
         CPF ERRADO não — ele iria para a nota fiscal de alguém. */
      if (cpf && !cpfValido(cpf)) throw erroHttp(400, 'Informe um CPF válido ou deixe em branco.');
      /*
       * TELEFONE JÁ USADO POR UM CONVIDADO NÃO É BECO SEM SAÍDA.
       *
       * Quem pediu sem cadastro deixou uma conta sem senha com o telefone dela.
       * Sem este ramo, essa mesma pessoa voltando para se cadastrar de verdade
       * levava "não foi possível concluir o cadastro" e não tinha o que fazer:
       * não consegue logar (não tem senha) e não consegue cadastrar (telefone
       * ocupado). Foi um beco que eu mesmo criaria ao ligar o pedido sem conta.
       *
       * A saída é SOLTAR o telefone da conta de convidado, não entregá-la. Ela
       * fica com os pedidos que fez (o lojista precisa deles no histórico da
       * loja) e perde o telefone e o e-mail sintético; a conta nova nasce
       * limpa, com o número.
       *
       * ADOTAR a conta antiga seria o caminho cômodo e é justamente o furo que
       * a sessão de convidado limitada existe para evitar: quem soubesse o
       * número de outra pessoa se cadastraria com ele e herdaria os endereços
       * de entrega dela. Aqui ninguém herda nada.
       */
      const telExiste = await db.prepare(
        'SELECT id, sem_senha FROM usuarios WHERE telefone = ?'
      ).get(telefone) as { id: number; sem_senha: number } | undefined;
      if (telExiste && Number(telExiste.sem_senha ?? 0) === 1) {
        await db.prepare(
          "UPDATE usuarios SET telefone = NULL, email = ? WHERE id = ? AND sem_senha = 1"
        ).run(`convidado-${telExiste.id}@cliente.local`, telExiste.id);
        console.log(`[cadastro] telefone ${telefone} liberado da conta de convidado #${telExiste.id}`);
      } else if (telExiste) {
        throw erroHttp(409, CONFLITO);
      }
      if (cpf) {
        const cpfExiste = await db.prepare('SELECT id FROM usuarios WHERE cpf = ?').get(cpf);
        if (cpfExiste) throw erroHttp(409, CONFLITO);
      }
    } else if (!emailValido(email)) {
      throw erroHttp(400, 'Informe um e-mail válido.');
    }

    /*
     * A coluna email é NOT NULL UNIQUE: sem e-mail informado, gera um sintético
     * (não serve para login, só satisfaz o schema).
     *
     * A BASE PASSOU A SER O TELEFONE, não o CPF — que agora pode não existir. E
     * o telefone serve melhor: ele é único por índice no banco
     * (`telefone_unico`), então o e-mail sintético herda essa unicidade em vez
     * de depender de um campo opcional.
     */
    const emailFinal = email || (ehCliente ? `${telefone}@cliente.local` : '');
    const jaExiste = await db.prepare('SELECT id FROM usuarios WHERE email = ?').get(emailFinal);
    if (jaExiste) throw erroHttp(409, CONFLITO);

    const senhaHash = await bcrypt.hash(senha, 10);
    // Clientes podem ser associados a uma loja específica (white label)
    const lojaId = (ehCliente && req.body.loja_id) ? Number(req.body.loja_id) : null;
    /* Vazio vira NULL, não string vazia: o índice único já usa NULLIF, mas um
       CPF "presente e em branco" mentiria em toda consulta que lê a coluna. */
    const cpfFinal = ehCliente && cpf ? cpf : null;
    const info = await db.prepare(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, loja_id, cpf, criado_em,
                             termos_aceitos_em, termos_versao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      /*
       * O ACEITE É GRAVADO NO CADASTRO, não num passo separado.
       *
       * A tela diz, acima do botão, que criar a conta aceita os termos e a
       * política — e é isso que fica registrado, com data e versão. Uma
       * caixinha obrigatória a mais não prova mais nada e derruba cadastro;
       * o que prova é o registro do que estava publicado no momento.
       */
    ).run(nome, emailFinal, senhaHash, perfil, telefone, lojaId, cpfFinal, agoraUTC(),
          agoraUTC(), await versaoDosTermos());

    const novoId = Number(info.lastInsertRowid);
    const usuario = { id: novoId, nome, email: emailFinal, perfil, telefone, cpf: cpfFinal };
    res.status(201).json({ token: gerarToken(usuario), usuario });
  } catch (e) { next(e); }
});

/**
 * Procura em TODOS os tenants a conta de lojista/admin cujo e-mail E senha
 * batem — o que faz o login do domínio da plataforma funcionar pra quem tem
 * conta em outra marca.
 *
 * POR QUE SÓ COM A SENHA CONFERIDA: devolver "achei" a partir do e-mail sozinho
 * transformaria o login central num oráculo — qualquer pessoa digitaria um
 * e-mail e descobriria se ele existe na plataforma e de qual marca é, coisa que
 * hoje o isolamento por banco impede. Conferindo a senha antes, quem não tem a
 * credencial recebe sempre o mesmo erro genérico e não aprende nada.
 *
 * POR QUE SÓ PERFIS_2FA: lojista/admin terminam o login com o 2FA, então o que
 * viaja entre domínios é o token de PRÉ-autenticação (10 min, inútil sem o
 * código TOTP), não uma sessão. Cliente e entregador logam no domínio da
 * própria loja e não passam por aqui — não vale abrir um repasse de sessão
 * pronta entre domínios só por eles.
 *
 * Um tenant com banco fora do ar não pode derrubar o login dos demais: falha
 * isolada é registrada e a varredura continua.
 */
async function acharContaNosTenants(email: string, senha: string): Promise<{ tenant: Tenant; usuario: Usuario }[]> {
  const achados: { tenant: Tenant; usuario: Usuario }[] = [];
  for (const tenant of await listarTenants()) {
    if (!tenant.ativo) continue;
    try {
      const u = await comTenant(tenant.db_nome, async () =>
        await db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email) as Usuario | undefined);
      if (!u || !PERFIS_2FA.includes(u.perfil)) continue;
      if (!await bcrypt.compare(senha, u.senha_hash)) continue;
      achados.push({ tenant, usuario: u });
    } catch (e) {
      console.error(`[LOGIN CENTRAL] falha ao consultar tenant ${tenant.slug}:`, e);
    }
  }
  return achados;
}

router.post('/login', limiteLogin, async (req, res, next) => {
  try {
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    // Cliente entra por e-mail ou telefone (tela nova); lojista/entregador/
    // admin continuam só por e-mail. CPF ainda funciona como fallback
    // silencioso (não aparece mais na tela de login, mas contas antigas que
    // só têm CPF+senha — sem e-mail nem telefone salvos — continuam
    // conseguindo entrar digitando o CPF no mesmo campo).
    const cpf = cpfDigitos(req.body.cpf);
    const telefone = telefoneDigitos(req.body.telefone);
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const porTelefone = telefone.length === 10 || telefone.length === 11;
    const porCpf = !porTelefone && cpf.length === 11;
    const credErrada = (porCpf || porTelefone) ? 'Credenciais incorretas.' : 'E-mail ou senha incorretos.';

    let usuario: Usuario | undefined;
    if (porTelefone) {
      usuario = await db.prepare('SELECT * FROM usuarios WHERE telefone = ?').get(telefone) as Usuario | undefined;
      // Um telefone de 11 dígitos é ambíguo com CPF (mesmo tamanho) — se não
      // achou por telefone, tenta como CPF antes de desistir (contas antigas).
      if (!usuario && telefone.length === 11) {
        usuario = await db.prepare('SELECT * FROM usuarios WHERE cpf = ?').get(telefone) as Usuario | undefined;
      }
    } else if (porCpf) {
      usuario = await db.prepare('SELECT * FROM usuarios WHERE cpf = ?').get(cpf) as Usuario | undefined;
    } else {
      usuario = await db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email) as Usuario | undefined;
    }
    /*
     * REVENDEDOR entra pela MESMA tela, mas não é um `usuarios`: mora no banco
     * central e atravessa vários clientes. Tentado só quando não achou usuário
     * neste tenant — assim ninguém perde o login de sempre, e um e-mail que
     * exista nos dois lugares continua entrando como usuário, que é o caso
     * mais comum.
     */
    if (!usuario && email) {
      const [revs] = await poolCentral().query(
        'SELECT id, senha_hash, bloqueado FROM revendedores WHERE email = ?',
        [email],
      ) as unknown as [Array<{ id: number; senha_hash: string; bloqueado: number }>];
      const rev = revs[0];
      if (rev && await bcrypt.compare(senha, rev.senha_hash)) {
        if (rev.bloqueado) throw erroHttp(403, 'Seu acesso está bloqueado. Fale com o suporte.');
        return res.json({ token: gerarTokenRevendedor(rev.id), perfil: 'revendedor' });
      }
    }

    /*
     * QUEM NUNCA TEVE SENHA OUVE ISSO, e não "senha incorreta".
     *
     * Conta nascida de pedido sem cadastro guarda o hash de bytes aleatórios —
     * nenhuma senha abre. Sem esta mensagem a pessoa recebe "e-mail ou senha
     * incorretos" e passa a tentar adivinhar uma senha que nunca existiu, ou
     * pede redefinição de uma conta que ela não sabe que tem.
     *
     * Vem ANTES do `compare` de propósito: depois dele, o resultado já é
     * indistinguível de senha errada.
     *
     * NÃO revela se o telefone tem conta para quem só digitou um número
     * qualquer: só chega aqui quem acertou um identificador existente, que é a
     * mesma informação que "senha incorreta" já dava.
     */
    if (usuario && Number((usuario as unknown as { sem_senha?: number }).sem_senha ?? 0) === 1) {
      /*
       * NÃO manda "Esqueci minha senha": a redefinição vai por e-mail, e conta
       * de convidado tem e-mail SINTÉTICO (telefone@cliente.local), que não
       * recebe nada. Prometer um caminho que não existe é pior que não
       * prometer nada — a pessoa espera um e-mail que nunca chega.
       *
       * O caminho que funciona é criar conta, e o cadastro sabe lidar com o
       * telefone já usado por um convidado (ver /registrar).
       */
      throw erroHttp(409, 'Esse número foi usado num pedido sem cadastro, e não tem senha. Crie sua conta para ter senha, histórico e endereços salvos.');
    }

    if (!usuario || !await bcrypt.compare(senha, usuario.senha_hash)) {
      // Não achou NESTE tenant. Se a pessoa entrou pelo domínio da plataforma
      // (que cai no tenant padrão), a conta pode simplesmente morar em outra
      // marca — antes disso ela levava "e-mail ou senha incorretos" mesmo
      // digitando tudo certo, e só conseguia entrar se soubesse o endereço
      // exato da própria loja.
      if (req.hostEhDaPlataforma && !porTelefone && !porCpf && email) {
        const achados = await acharContaNosTenants(email, senha);

        // Mesmo e-mail com a MESMA senha em duas marcas: não dá pra adivinhar
        // qual delas a pessoa quer, e escolher por conta própria colocaria
        // alguém na marca errada sem explicação. Erro claro e o endereço da
        // loja resolve. (Só chega aqui quem acertou a credencial.)
        if (achados.length > 1) {
          throw erroHttp(409, 'Este e-mail tem conta em mais de uma marca da plataforma. Entre pelo endereço da sua loja.');
        }

        if (achados.length === 1) {
          const { tenant, usuario: achado } = achados[0];
          if (achado.bloqueado) throw erroHttp(403, 'Sua conta está bloqueada. Fale com o suporte.');

          // O token de pré-autenticação PRECISA nascer dentro do tenant da
          // conta: ele embute `bancoTenantAtual()` e `autenticarPreAuth` o
          // recusa em qualquer outro banco. Gerado aqui fora, ele nasceria
          // carimbado com o tenant padrão e seria rejeitado no destino.
          const tokenPreAuth = await comTenant(tenant.db_nome, async () => gerarTokenPreAuth(achado));

          return res.json({
            precisa2fa: true,
            modo2fa: achado.totp_ativo ? 'verificar' : 'configurar',
            tokenPreAuth,
            // null quando o tenant não tem domínio próprio nem DOMINIO_BASE:
            // o frontend segue o 2FA no próprio domínio da plataforma, que
            // funciona porque o token já carrega o tenant certo.
            redirecionar: urlDoTenant(tenant),
          });
        }
      }
      throw erroHttp(401, credErrada);
    }
    if (usuario.bloqueado) throw erroHttp(403, 'Sua conta está bloqueada. Fale com o suporte.');

    // Isolamento white-label: se o cliente foi registrado em uma loja específica
    // e o login chega com loja_id, garante que é a mesma loja.
    const lojaIdReq = req.body.loja_id ? Number(req.body.loja_id) : null;
    const lojaIdUser = (usuario as any).loja_id ? Number((usuario as any).loja_id) : null;
    if (lojaIdReq && lojaIdUser && lojaIdUser !== lojaIdReq) {
      throw erroHttp(401, 'E-mail ou senha incorretos.');
    }

    // 2FA obrigatório pra lojista/admin: em vez do token normal, devolve um
    // token de pré-autenticação de curta duração (sem acesso a rota nenhuma)
    // — o frontend usa ele pra chamar /2fa/configurar (primeiro login, ainda
    // sem TOTP ativo) ou /2fa/verificar (logins seguintes), que só aí emitem
    // o token de verdade.
    if (PERFIS_2FA.includes(usuario.perfil)) {
      return res.json({
        precisa2fa: true,
        modo2fa: usuario.totp_ativo ? 'verificar' : 'configurar',
        tokenPreAuth: gerarTokenPreAuth(usuario),
      });
    }

    /**
     * "Manter conectado neste dispositivo" (checkbox do login). Antes o front
     * mandava a preferencia e o backend nao lia: o token vinha com 12h de
     * qualquer jeito, e a pessoa era deslogada no dia seguinte mesmo tendo
     * marcado a caixa.
     */
    /* SESSÃO CONCEDIDA: marca o acesso. Aqui e não dentro de `gerarToken` —
       aquela função é pura e usada em teste; escrever no banco de dentro dela
       acoplaria a emissão do token ao tenant da requisição. */
    await registrarAcesso(usuario.id);
    res.json({
      token: gerarToken(usuario, { manterConectado: req.body?.manter_conectado === true }),
      usuario: {
        id: usuario.id, nome: usuario.nome, email: usuario.email,
        perfil: usuario.perfil, telefone: usuario.telefone, cpf: usuario.cpf || null,
        super_admin: usuario.super_admin || 0,
      },
    });
  } catch (e) { next(e); }
});

/** Monta o objeto usuário devolvido nas respostas de auth (mesmo shape do /login normal). */
function usuarioPublico(usuario: Usuario) {
  return {
    id: usuario.id, nome: usuario.nome, email: usuario.email,
    perfil: usuario.perfil, telefone: usuario.telefone, cpf: usuario.cpf || null,
    super_admin: usuario.super_admin || 0,
  };
}

/** Gera N códigos de backup (formato xxxxx-xxxxx), retorna o texto plano (mostrado 1x) + os hashes (salvos). */
async function gerarCodigosBackup(qtd = 8): Promise<{ texto: string; hash: string }[]> {
  // Assíncrona porque o hash agora é assíncrono (ver o porquê no topo do
  // arquivo). São 8 hashes de uma vez: em `Promise.all` eles se intercalam e o
  // event loop continua atendendo, em vez de ficar 8 × 95 ms travado.
  return Promise.all(Array.from({ length: qtd }, async () => {
    const bruto = crypto.randomBytes(5).toString('hex');
    const texto = `${bruto.slice(0, 5)}-${bruto.slice(5, 10)}`;
    return { texto, hash: await bcrypt.hash(texto, 10) };
  }));
}

/**
 * Início do setup do 2FA (primeiro login de lojista/admin, TOTP ainda não
 * ativo): gera um secret novo, salva CIFRADO (mas com totp_ativo continua 0
 * até /2fa/confirmar validar um código de verdade), devolve o QR pra escanear
 * no app autenticador. Chamar de novo antes de confirmar gera um secret novo
 * (descarta o anterior — sem problema, nada foi ativado ainda).
 */
router.post('/2fa/configurar', autenticarPreAuth, async (req, res, next) => {
  try {
    const usuario = await db.prepare('SELECT id, nome, email, perfil, totp_ativo FROM usuarios WHERE id = ?')
      .get(req.usuarioPreAuth!.id) as Pick<Usuario, 'id' | 'nome' | 'email' | 'perfil' | 'totp_ativo'> | undefined;
    if (!usuario) throw erroHttp(401, 'Usuário não encontrado.');
    if (usuario.totp_ativo) throw erroHttp(400, 'O 2FA já está ativo nesta conta — use a verificação normal.');

    const secret = authenticator.generateSecret();
    await db.prepare('UPDATE usuarios SET totp_secret = ? WHERE id = ?').run(criptografar(secret), usuario.id);

    const otpauth = authenticator.keyuri(usuario.email, 'Delivery Já', secret);
    const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 240 });
    res.json({ qr, chaveManual: secret });
  } catch (e) { next(e); }
});

/** Confirma o setup: primeiro código de 6 dígitos válido ativa o 2FA e emite o token de verdade. */
router.post('/2fa/confirmar', limite2fa, autenticarPreAuth, async (req, res, next) => {
  try {
    const codigo = textoLimpo(req.body.codigo, 10).replace(/\s+/g, '');
    const usuario = await db.prepare('SELECT * FROM usuarios WHERE id = ?')
      .get(req.usuarioPreAuth!.id) as Usuario | undefined;
    if (!usuario) throw erroHttp(401, 'Usuário não encontrado.');
    // Mesma checagem do /2fa/verificar: a conta pode ter sido bloqueada DEPOIS
    // do login, dentro da janela de 10 min do token de pré-autenticação.
    if (usuario.bloqueado) throw erroHttp(403, 'Sua conta está bloqueada. Fale com o suporte.');
    if (usuario.totp_ativo) throw erroHttp(400, 'O 2FA já está ativo nesta conta.');
    if (!usuario.totp_secret) throw erroHttp(400, 'Comece pelo /2fa/configurar antes de confirmar.');

    const secret = descriptografar(usuario.totp_secret);
    if (!codigo || !authenticator.check(codigo, secret)) {
      throw erroHttp(400, 'Código inválido. Confira o horário do celular e tente de novo.');
    }

    const codigos = await gerarCodigosBackup();
    await db.prepare('UPDATE usuarios SET totp_ativo = 1, totp_backup_codes = ? WHERE id = ?')
      .run(JSON.stringify(codigos.map(c => c.hash)), usuario.id);

    /* SESSÃO CONCEDIDA: marca o acesso. Aqui e não dentro de `gerarToken` —
       aquela função é pura e usada em teste; escrever no banco de dentro dela
       acoplaria a emissão do token ao tenant da requisição. */
    await registrarAcesso(usuario.id);
    res.json({
      // Quem usa 2FA passa por aqui em vez do /login: sem repassar a opcao, o
      // "manter conectado" simplesmente nao valeria pra esses usuarios.
      token: gerarToken(usuario, { manterConectado: req.body?.manter_conectado === true }),
      usuario: usuarioPublico(usuario),
      codigosBackup: codigos.map(c => c.texto),
    });
  } catch (e) { next(e); }
});

/** Verificação normal (2FA já ativo): código do app OU um código de backup (uso único). */
router.post('/2fa/verificar', limite2fa, autenticarPreAuth, async (req, res, next) => {
  try {
    const codigo = textoLimpo(req.body.codigo, 10).replace(/\s+/g, '');
    const codigoBackup = textoLimpo(req.body.codigoBackup, 20).trim();
    const usuario = await db.prepare('SELECT * FROM usuarios WHERE id = ?')
      .get(req.usuarioPreAuth!.id) as Usuario | undefined;
    if (!usuario) throw erroHttp(401, 'Usuário não encontrado.');
    if (usuario.bloqueado) throw erroHttp(403, 'Sua conta está bloqueada. Fale com o suporte.');
    if (!usuario.totp_ativo || !usuario.totp_secret) throw erroHttp(400, 'O 2FA não está configurado nesta conta.');

    if (codigo) {
      const secret = descriptografar(usuario.totp_secret);
      if (!authenticator.check(codigo, secret)) throw erroHttp(400, 'Código inválido.');
    } else if (codigoBackup) {
      const hashes: string[] = usuario.totp_backup_codes ? JSON.parse(usuario.totp_backup_codes) : [];
      /*
       * Laço em vez de `findIndex`: o callback dele não pode ser assíncrono.
       * Sai no primeiro que bater — não compara os 8 à toa.
       */
      let idx = -1;
      for (let k = 0; k < hashes.length; k++) {
        if (await bcrypt.compare(codigoBackup, hashes[k])) { idx = k; break; }
      }
      if (idx === -1) throw erroHttp(400, 'Código de backup inválido ou já usado.');
      // Uso único: remove o código usado da lista.
      hashes.splice(idx, 1);
      await db.prepare('UPDATE usuarios SET totp_backup_codes = ? WHERE id = ?')
        .run(JSON.stringify(hashes), usuario.id);
    } else {
      throw erroHttp(400, 'Informe o código do app ou um código de backup.');
    }

    /* SESSÃO CONCEDIDA: marca o acesso. Aqui e não dentro de `gerarToken` —
       aquela função é pura e usada em teste; escrever no banco de dentro dela
       acoplaria a emissão do token ao tenant da requisição. */
    await registrarAcesso(usuario.id);
    res.json({ token: gerarToken(usuario, { manterConectado: req.body?.manter_conectado === true }), usuario: usuarioPublico(usuario) });
  } catch (e) { next(e); }
});

/**
 * Pede a redefinição de senha por e-mail. Responde SEMPRE com a mesma
 * mensagem genérica (exista ou não o e-mail) — evita que alguém descubra
 * quais e-mails estão cadastrados testando um por um.
 */
router.post('/esqueci-senha', limiteEsqueciSenha, async (req, res, next) => {
  try {
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const mensagemGenerica = { ok: true, mensagem: 'Se esse e-mail estiver cadastrado, enviamos um link de redefinição.' };
    if (!emailValido(email)) return res.json(mensagemGenerica);

    // E-mails sintéticos (@cliente.local) são gerados pra clientes que
    // logam por CPF sem informar e-mail de verdade — não recebem nada.
    if (email.endsWith('@cliente.local')) return res.json(mensagemGenerica);

    const usuario = await db.prepare('SELECT id, nome, email, bloqueado FROM usuarios WHERE email = ?')
      .get(email) as { id: number; nome: string; email: string; bloqueado: number } | undefined;

    // Log só do servidor (nunca vai pra resposta HTTP) — a mensagem pro
    // usuário continua genérica por segurança, mas isso ajuda a diagnosticar
    // "não chegou o e-mail" sem precisar adivinhar qual dos 3 motivos foi.
    if (!usuario) console.warn(`[AUTH] esqueci-senha: nenhuma conta encontrada com o e-mail "${email}".`);
    else if (usuario.bloqueado) console.warn(`[AUTH] esqueci-senha: conta de "${email}" (id ${usuario.id}) está bloqueada — e-mail não enviado.`);

    if (usuario && !usuario.bloqueado) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expira = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await db.prepare('UPDATE usuarios SET reset_token_hash = ?, reset_token_expira = ? WHERE id = ?')
        .run(tokenHash, expira, usuario.id);

      const origem = `${req.protocol}://${req.get('host')}`;
      const link = `${origem}/redefinir-senha?token=${token}`;
      const { assunto, html } = emailRedefinirSenha(usuario.nome, link);
      const enviado = await enviarEmail(usuario.email, assunto, html);
      if (!enviado) {
        console.warn(`[AUTH] Não foi possível enviar e-mail de redefinição para ${usuario.email} (SMTP configurado? ${emailHabilitado()}).`);
      }
    }
    res.json(mensagemGenerica);
  } catch (e) { next(e); }
});

/** Confirma a redefinição: token válido e não expirado + nova senha. */
router.post('/redefinir-senha', async (req, res, next) => {
  try {
    const token = textoLimpo(req.body.token, 128);
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (!token) throw erroHttp(400, 'Link inválido.');
    if (senha.length < 6) throw erroHttp(400, 'A senha precisa ter pelo menos 6 caracteres.');

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const usuario = await db.prepare(
      'SELECT id, reset_token_expira FROM usuarios WHERE reset_token_hash = ?'
    ).get(tokenHash) as { id: number; reset_token_expira: string } | undefined;

    if (!usuario || new Date(usuario.reset_token_expira) < new Date()) {
      throw erroHttp(400, 'Esse link expirou ou já foi usado. Peça uma nova redefinição.');
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    await db.prepare('UPDATE usuarios SET senha_hash = ?, reset_token_hash = NULL, reset_token_expira = NULL WHERE id = ?')
      .run(senhaHash, usuario.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/eu', autenticar, (req, res) => {
  res.json({ usuario: req.usuario });
});


/* ═══════════════════════ LOGIN SOCIAL (Google / Facebook) ═══════════════════════ */

/**
 * Provedores disponíveis — a tela só desenha botão pro que o servidor tem
 * credencial. Sem isto o cliente veria "Entrar com Google" e receberia um erro do
 * Google, que é pior que não ter o botão.
 */
router.get('/oauth/provedores', (_req, res) => {
  res.json({ provedores: provedoresDisponiveis() });
});

/** Valida o provedor pedido na URL, ou erro legível. */
function provedorDaRota(valor: string): ProvedorOauth {
  if (valor !== 'google' && valor !== 'facebook') throw erroHttp(404, 'Provedor de login não suportado.');
  if (!provedoresDisponiveis().includes(valor)) throw erroHttp(503, 'Este login social não está configurado.');
  return valor;
}

/**
 * Passo 1 — manda a pessoa pro provedor.
 *
 * Roda no domínio da LOJA, e é aqui que o tenant é capturado: `bancoTenantAtual()`
 * só existe dentro do contexto desta requisição. O callback roda noutro domínio e
 * resolveria o tenant errado se dependesse do Host.
 */
router.get('/oauth/:provedor/iniciar', async (req, res, next) => {
  try {
    const provedor = provedorDaRota(String(req.params.provedor));
    const origem = `${req.protocol}://${req.headers.host}`;
    // Destino limitado a rota INTERNA: sem isso, `?voltar=https://malicioso`
    // transformaria nosso login num redirecionador aberto, útil pra phishing.
    const bruto = textoLimpo(String(req.query.voltar || '/conta'), 200);
    const caminho = bruto.startsWith('/') && !bruto.startsWith('//') ? bruto : '/conta';

    const state = assinarEstado({
      tenant: bancoTenantAtual(),
      lojaId: req.query.loja_id ? Number(req.query.loja_id) : null,
      origem,
      caminho,
    });
    const url = urlDeAutorizacao(provedor, state);
    if (!url) throw erroHttp(503, 'Este login social não está configurado.');
    res.redirect(url);
  } catch (e) { next(e); }
});

/** Volta pro domínio da loja com uma mensagem de erro legível no fragmento. */
function voltarComErro(res: Response, destino: string, motivo: string) {
  const sep = destino.includes('#') ? '&' : '#';
  res.redirect(`${destino}${sep}oauth_erro=${encodeURIComponent(motivo)}`);
}

/**
 * Passo 2 — callback, no domínio FIXO da plataforma.
 *
 * Tudo aqui roda DENTRO do tenant que veio no `state` (via `comTenant`): é o único
 * jeito de criar o usuário no banco certo, já que o Host deste domínio aponta pro
 * tenant da plataforma, não pro da loja.
 */
router.get('/oauth/:provedor/callback', async (req, res, next) => {
  let destino = '';
  try {
    const provedor = provedorDaRota(String(req.params.provedor));
    const estado = lerEstado(String(req.query.state || ''));
    // Sem state válido não há pra onde voltar com segurança: um destino vindo de
    // outro lugar que não o nosso próprio state é exatamente o que não se pode
    // seguir. Responde no domínio da plataforma mesmo.
    if (!estado) throw erroHttp(400, 'Sessão de login social expirada ou inválida. Tente novamente.');
    destino = `${estado.origem}${estado.caminho}`;

    // A pessoa clicou "cancelar" na tela do provedor: não é erro nosso.
    if (req.query.error) return voltarComErro(res, destino, 'Login social cancelado.');
    const code = String(req.query.code || '');
    if (!code) return voltarComErro(res, destino, 'O provedor não devolveu o código de autorização.');

    const perfil = await perfilDoCodigo(provedor, code);

    const resultado = await comTenant(estado.tenant, async (): Promise<{ erro?: string; codigo?: string }> => {
      const porSub = perfil.sub
        ? await db.prepare('SELECT id FROM usuarios WHERE oauth_provedor = ? AND oauth_sub = ?')
            .get(provedor, perfil.sub) as { id: number } | undefined
        : undefined;
      const porEmail = perfil.email
        ? await db.prepare('SELECT id, perfil FROM usuarios WHERE email = ?')
            .get(perfil.email) as { id: number; perfil: string } | undefined
        : undefined;

      const decisao = decidirVinculo(perfil, { porSub, porEmail });
      if (decisao.acao === 'recusar') return { erro: decisao.motivo };

      let usuarioId: number;
      if (decisao.acao === 'criar') {
        /*
         * `senha_hash` é NOT NULL no schema, e conta de login social não tem senha.
         * Grava o hash de um valor ALEATÓRIO: não pode ser vazio (viola a coluna)
         * nem previsível (viraria senha universal). Assim nenhuma senha digitada
         * bate, e quem quiser uma usa "esqueci minha senha", que gera de verdade.
         */
        const inutilizavel = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
        const info = await db.prepare(
          `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, criado_em, loja_id, oauth_provedor, oauth_sub,
                                 termos_aceitos_em, termos_versao)
           VALUES (?, ?, ?, 'cliente', '', ?, ?, ?, ?, ?, ?)`
          /* Entrar com o Google TAMBÉM cria conta, então registra igual. Sem
             isto, metade dos clientes ficaria sem aceite nenhum. */
        ).run(nomeUsavel(perfil), perfil.email, inutilizavel, agoraUTC(), estado.lojaId, provedor, perfil.sub,
              agoraUTC(), await versaoDosTermos());
        usuarioId = Number(info.lastInsertRowid);
      } else {
        usuarioId = decisao.usuarioId;
        if (decisao.acao === 'vincular') {
          await db.prepare('UPDATE usuarios SET oauth_provedor = ?, oauth_sub = ? WHERE id = ?')
            .run(provedor, perfil.sub, usuarioId);
        }
      }

      const usuario = await db.prepare('SELECT id, bloqueado FROM usuarios WHERE id = ?')
        .get(usuarioId) as { id: number; bloqueado: number };
      if (usuario.bloqueado) return { erro: 'Sua conta está bloqueada. Fale com o suporte.' };

      /*
       * CÓDIGO DE USO ÚNICO em vez do token de sessão na URL. Mesmo no fragmento,
       * token de sessão fica no histórico do aparelho — e no delivery o aparelho é
       * com frequência compartilhado. Guardamos só o HASH: vazamento do banco não
       * devolve códigos utilizáveis.
       */
      const codigo = crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(codigo).digest('hex');
      const agora = new Date();
      await db.prepare(
        'INSERT INTO oauth_codigos (codigo_hash, usuario_id, expira_em, criado_em) VALUES (?, ?, ?, ?)'
      ).run(hash, usuarioId, new Date(agora.getTime() + 2 * 60_000).toISOString(), agora.toISOString());
      return { codigo };
    });

    if (resultado.erro) return voltarComErro(res, destino, resultado.erro);
    // Fragmento (#), não query: não vai pro servidor, não entra em log de acesso e
    // não viaja no Referer — mesma escolha do repasse de 2FA entre domínios.
    return res.redirect(`${destino}#oauth=${resultado.codigo}`);
  } catch (e) {
    // Falha do provedor (rede, credencial errada, código já usado) não pode
    // terminar em página de erro no domínio da plataforma: a pessoa tem que voltar
    // pra loja com uma mensagem que explique o que houve.
    if (destino) return voltarComErro(res, destino, (e as Error).message || 'Não foi possível concluir o login social.');
    return next(e);
  }
});

/**
 * Passo 3 — troca o código pela sessão. Chamado pelo frontend no domínio da loja.
 *
 * Marca `usado_em` em vez de apagar: código apresentado duas vezes é sinal (link
 * copiado, replay), e apagando, a segunda tentativa seria indistinguível de
 * expiração.
 */
router.post('/oauth/trocar', limiteLogin, async (req, res, next) => {
  try {
    const codigo = typeof req.body?.codigo === 'string' ? req.body.codigo : '';
    if (!codigo) throw erroHttp(400, 'Código de login ausente.');
    const hash = crypto.createHash('sha256').update(codigo).digest('hex');

    const linha = await db.prepare(
      'SELECT id, usuario_id, expira_em, usado_em FROM oauth_codigos WHERE codigo_hash = ?'
    ).get(hash) as { id: number; usuario_id: number; expira_em: string; usado_em: string } | undefined;

    // Mensagem única pra "não existe", "expirou" e "já usado": as três não têm
    // ação diferente pra quem é dono do código, e distinguir só ajudaria quem
    // estivesse testando códigos.
    const GENERICO = 'Link de login expirado ou já utilizado. Entre novamente.';
    if (!linha || linha.usado_em || linha.expira_em <= agoraUTC()) throw erroHttp(401, GENERICO);

    // Consumo CONDICIONAL: duas requisições simultâneas com o mesmo código (duplo
    // clique, prefetch do navegador) só podem render uma sessão.
    const r = await db.prepare("UPDATE oauth_codigos SET usado_em = ? WHERE id = ? AND usado_em = ''")
      .run(agoraUTC(), linha.id);
    if (r.changes === 0) throw erroHttp(401, GENERICO);

    const usuario = await db.prepare('SELECT * FROM usuarios WHERE id = ?')
      .get(linha.usuario_id) as Usuario | undefined;
    if (!usuario) throw erroHttp(401, GENERICO);
    if (usuario.bloqueado) throw erroHttp(403, 'Sua conta está bloqueada. Fale com o suporte.');

    // Login social entra sempre como "manter conectado": a pessoa escolheu o
    // caminho de não digitar senha, e pedir pra refazer em 12h anula o motivo.
    res.json({ token: gerarToken(usuario, { manterConectado: true }), usuario: usuarioPublico(usuario) });
  } catch (e) { next(e); }
});


export default router;
