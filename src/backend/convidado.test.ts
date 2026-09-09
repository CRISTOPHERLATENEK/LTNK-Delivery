import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { convidadoPodeAlcancar } from './convidado-alcance';

/*
 * PEDIDO SEM CRIAR CONTA — só nome e WhatsApp.
 *
 * Nem todo mundo quer criar conta antes de pedir uma pizza, e exigir isso é
 * atrito no pior momento: antes da primeira compra, quando a pessoa ainda não
 * sabe se gosta da loja.
 *
 * O QUE TORNA ISSO DELICADO, e o que a maior parte destes testes guarda:
 *
 * O pedido exige `cliente_id`, então uma conta é criada de verdade. O telefone
 * é único no banco, então um número que já pediu antes REUSA a conta que
 * existe — com o endereço e o histórico dela. Se a sessão de convidado
 * enxergasse isso, qualquer pessoa que digitasse o número de outra veria onde
 * ela mora. Num app de entrega, endereço de casa.
 *
 * A escolha foi: a sessão vale para UM pedido. Ela monta e fecha o pedido, e
 * cuida daquele pedido. Não lista histórico, não lista endereços salvos, não
 * abre a conta. Quem quiser isso cria senha.
 */

const BACKEND = __dirname;
const cliente = fs.readFileSync(path.join(BACKEND, 'rotas', 'cliente.ts'), 'utf8');
const autenticacao = fs.readFileSync(path.join(BACKEND, 'rotas', 'autenticacao.ts'), 'utf8');
const auth = fs.readFileSync(path.join(BACKEND, 'auth.ts'), 'utf8');
const schema = fs.readFileSync(path.join(BACKEND, 'schema-mysql.ts'), 'utf8');
const alcance = fs.readFileSync(path.join(BACKEND, 'convidado-alcance.ts'), 'utf8');

/** Só o que executa: comentário citando o erro evitado não conta como erro. */
function exec(fonte: string): string {
  return fonte.split('\n')
    .filter(l => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

const pode = (m: string, c: string, p: number | null) => convidadoPodeAlcancar(m, c, p).pode;

describe('a sessão sem pedido ainda', () => {
  /* Ela nasce assim: precisa poder montar e enviar o pedido. */
  it('monta e envia o pedido', () => {
    expect(pode('POST', '/carrinho/conferir', null)).toBe(true);
    expect(pode('POST', '/cupons/validar', null)).toBe(true);
    expect(pode('POST', '/frete', null)).toBe(true);
    expect(pode('POST', '/enderecos', null)).toBe(true);
    expect(pode('POST', '/pedidos', null)).toBe(true);
  });

  /*
   * CRIAR ENDEREÇO SIM, LISTAR NÃO — e a assimetria é o ponto.
   *
   * O endereço da entrega precisa ser criado. Os endereços JÁ SALVOS são de
   * quem usou aquele telefone antes, e é exatamente o que não pode aparecer
   * para quem só digitou um número.
   */
  it('não lista os endereços salvos', () => {
    expect(pode('GET', '/enderecos', null)).toBe(false);
    expect(pode('PUT', '/enderecos/3', null)).toBe(false);
    expect(pode('DELETE', '/enderecos/3', null)).toBe(false);
  });

  it('não vê pedido nenhum antes de criar o seu', () => {
    expect(pode('GET', '/pedidos', null)).toBe(false);
    expect(pode('GET', '/pedidos/7', null)).toBe(false);
  });

  it('não abre a conta', () => {
    for (const [m, c] of [
      ['PUT', '/perfil'], ['PUT', '/senha'], ['GET', '/meus-dados'],
      ['POST', '/conta/excluir'], ['GET', '/favoritos'], ['GET', '/pedidos/7/repetir'],
    ]) expect(pode(m, c, null), `${m} ${c}`).toBe(false);
  });
});

describe('a sessão com o pedido dela', () => {
  it('cuida do próprio pedido', () => {
    expect(pode('GET', '/pedidos/42', 42)).toBe(true);
    expect(pode('POST', '/pedidos/42/pagar-cartao', 42)).toBe(true);
    expect(pode('POST', '/pedidos/42/conferir-pix', 42)).toBe(true);
    expect(pode('POST', '/pedidos/42/conferir-pagamento', 42)).toBe(true);
    expect(pode('POST', '/pedidos/42/cancelar', 42)).toBe(true);
    expect(pode('GET', '/pedidos/42/mensagens', 42)).toBe(true);
    expect(pode('POST', '/pedidos/42/mensagens', 42)).toBe(true);
    expect(pode('POST', '/pedidos/42/avaliar', 42)).toBe(true);
  });

  /*
   * E DE MAIS NENHUM. É a asserção central do arquivo: o número do pedido é
   * sequencial, então adivinhar o do vizinho é trivial — `42` viraria `41`.
   */
  it('não alcança o pedido de outra pessoa', () => {
    expect(pode('GET', '/pedidos/41', 42)).toBe(false);
    expect(pode('GET', '/pedidos/43', 42)).toBe(false);
    expect(pode('POST', '/pedidos/41/cancelar', 42)).toBe(false);
    expect(pode('GET', '/pedidos/1/mensagens', 42)).toBe(false);
  });

  /* E a mensagem diz que é de OUTRO pedido, não que a rota não existe: é a
     diferença entre "você não pode" e "você está no lugar errado". */
  it('e diz que o pedido é de outro acompanhamento', () => {
    const r = convidadoPodeAlcancar('GET', '/pedidos/41', 42);
    expect(r.pode).toBe(false);
    if (!r.pode) expect(r.motivo).toContain('não é deste acompanhamento');
  });

  /* Histórico continua fechado mesmo com pedido na mão. */
  it('continua sem histórico', () => {
    expect(pode('GET', '/pedidos', 42)).toBe(false);
    expect(pode('GET', '/enderecos', 42)).toBe(false);
  });

  /*
   * UM PEDIDO POR SESSÃO. Sem isto, a mesma sessão criaria um segundo pedido —
   * e o token aponta para o primeiro, então ela criaria um pedido que não
   * consegue acompanhar nem pagar. Pedido órfão é pior que pedido recusado.
   */
  it('não cria um segundo pedido', () => {
    expect(pode('POST', '/pedidos', 42)).toBe(false);
    const r = convidadoPodeAlcancar('POST', '/pedidos', 42);
    if (!r.pode) expect(r.motivo).toContain('já foi enviado');
  });
});

describe('a forma da regra', () => {
  /*
   * LISTA DE PERMISSÃO, não de proibição — e é o que garante que rota nova
   * nasça fechada. Lista de proibição erra em silêncio: alguém acrescenta um
   * endpoint, esquece de proibir, e ele nasce aberto para convidado.
   */
  it('o que não está na lista é negado', () => {
    for (const c of ['/rota-que-nao-existe', '/pedidos/42/algo-novo', '/relatorios']) {
      expect(pode('GET', c, 42), c).toBe(false);
      expect(pode('POST', c, 42), c).toBe(false);
    }
  });

  it('o método importa', () => {
    /* `POST /frete` é permitido; `GET /frete` não é a mesma coisa. */
    expect(pode('POST', '/frete', null)).toBe(true);
    expect(pode('GET', '/frete', null)).toBe(false);
    expect(pode('DELETE', '/pedidos/42', 42)).toBe(false);
  });

  it('barra no fim e query não driblam a regra', () => {
    expect(pode('GET', '/pedidos/42/', 42)).toBe(true);
    expect(pode('GET', '/pedidos/41/', 42)).toBe(false);
    expect(pode('GET', '/pedidos?tudo=1', 42)).toBe(false);
  });

  it('método em minúscula é o mesmo método', () => {
    expect(pode('post', '/pedidos', null)).toBe(true);
    expect(pode('get', '/pedidos/42', 42)).toBe(true);
  });

  /* A regra devolve MOTIVO, não só um não: 403 sozinho manda a pessoa procurar
     defeito onde não tem. */
  it('a negação explica a saída', () => {
    const r = convidadoPodeAlcancar('GET', '/pedidos', null);
    expect(r.pode).toBe(false);
    if (!r.pode) expect(r.motivo).toContain('conta');
  });
});

describe('a guarda está instalada onde alcança tudo', () => {
  it('no topo do router de cliente, não em cada rota', () => {
    const codigo = exec(cliente);
    const iGuarda = codigo.indexOf('convidadoPodeAlcancar(req.method, req.path');
    const iPrimeiraRota = codigo.indexOf("router.get('/enderecos'");
    expect(iGuarda).toBeGreaterThan(0);
    expect(iGuarda).toBeLessThan(iPrimeiraRota);
  });

  it('e só age em sessão de convidado', () => {
    expect(exec(cliente)).toContain('if (!req.convidado) return next();');
  });

  /*
   * O TOKEN É REEMITIDO NA RESPOSTA QUE CRIA O PEDIDO, e isso é feito no
   * middleware porque `POST /pedidos` tem QUATRO saídas com `pedido_id`
   * (idempotência, Pix, cartão e o caminho normal). Depender de lembrar em cada
   * uma teria como sintoma o pior possível: pedido feito, cobrado, e a pessoa
   * sem conseguir acompanhar.
   */
  it('o token novo sai junto do pedido_id, sem depender de cada rota', () => {
    const codigo = exec(cliente);
    expect(codigo).toContain('gerarTokenConvidado(req.usuario!.id, novo)');
    expect(codigo).toContain('res.json = ');
    /* Quantas saídas existem hoje — a asserção que explica por que é no
       middleware. */
    const saidas = (codigo.match(/res\.status\(201\)\.json\(\{\s*\n?\s*pedido_id/g)
      ?? codigo.match(/pedido_id: /g) ?? []).length;
    expect(saidas).toBeGreaterThanOrEqual(3);
  });
});

describe('a sessão de convidado no token', () => {
  it('é token de cliente de verdade, com a marca', () => {
    const fn = auth.slice(auth.indexOf('export function gerarTokenConvidado'));
    const corpo = fn.slice(0, fn.indexOf('\n}\n'));
    expect(corpo).toContain("perfil: 'cliente'");
    expect(corpo).toContain('convidado: true');
    expect(corpo).toContain('pedido: pedidoId');
    /* Duas horas: fechar e acompanhar, não ficar valendo no celular emprestado
       da loja. */
    expect(corpo).toContain("expiresIn: '2h'");
  });

  it('a marca vem do token, não do banco', () => {
    expect(exec(auth)).toContain('if (dados.convidado === true)');
    expect(exec(auth)).toContain('req.convidado = { pedido:');
  });
});

describe('a rota que abre a sessão', () => {
  const rota = (() => {
    const i = autenticacao.indexOf("router.post('/convidado'");
    return exec(autenticacao.slice(i, autenticacao.indexOf('\nrouter.', i + 10)));
  })();

  it('o teste está lendo a rota certa', () => {
    expect(rota).toContain('gerarTokenConvidado');
    expect(rota.length).toBeGreaterThan(400);
  });

  it('exige nome e WhatsApp válido, e nada mais', () => {
    expect(rota).toContain('Informe seu nome.');
    expect(rota).toContain('telefoneValido(req.body.telefone)');
    expect(rota).toContain('Informe um WhatsApp válido com DDD.');
    /* Sem senha, sem CPF, sem e-mail: é o ponto da coisa. */
    expect(rota).not.toContain('req.body.senha');
    expect(rota).not.toContain('cpfValido');
  });

  /*
   * A CONTA NASCE SEM SENHA QUE ABRA. `senha_hash` é NOT NULL, então guarda o
   * hash de bytes aleatórios: não existe senha que sirva, nem para nós.
   */
  it('a conta nasce com senha impossível', () => {
    expect(rota).toContain('crypto.randomBytes(32)');
    expect(rota).toContain('sem_senha');
  });

  /*
   * TELEFONE DA EQUIPE DA LOJA NÃO ABRE SESSÃO DE CONVIDADO. Sem esta guarda,
   * digitar o telefone do dono devolveria um token com o `sub` dele — a guarda
   * de alcance limitaria o dano, mas apoiar segurança na segunda camada quando
   * a primeira dá para fechar é aceitar risco de graça.
   */
  it('recusa telefone que não é de cliente', () => {
    expect(rota).toContain("existente.perfil !== 'cliente'");
  });

  it('recusa número bloqueado', () => {
    expect(rota).toContain('existente?.bloqueado');
  });

  /* A sessão nasce SEM pedido: neste estado ela só cria. */
  it('nasce sem pedido', () => {
    expect(rota).toContain('gerarTokenConvidado(usuarioId, null)');
  });

  /* E não renomeia conta alheia com o nome digitado agora. */
  it('não sobrescreve o nome de uma conta que já existe', () => {
    expect(rota).not.toMatch(/UPDATE usuarios SET nome/);
  });
});

describe('quem pediu sem conta não fica num beco', () => {
  /*
   * O BECO QUE EU CRIARIA: quem pede sem cadastro deixa uma conta sem senha com
   * o telefone dela. Voltando para se cadastrar de verdade, levaria "não foi
   * possível concluir o cadastro" e não teria o que fazer — não consegue logar
   * (não tem senha) e não consegue cadastrar (telefone ocupado).
   */
  it('o cadastro solta o telefone da conta de convidado', () => {
    const codigo = exec(autenticacao);
    expect(codigo).toContain('Number(telExiste.sem_senha ?? 0) === 1');
    expect(codigo).toContain('UPDATE usuarios SET telefone = NULL, email = ?');
  });

  /*
   * E NÃO ENTREGA A CONTA ANTIGA. Adotá-la seria o caminho cômodo e é o mesmo
   * furo que a sessão limitada existe para evitar: quem soubesse o número de
   * outra pessoa se cadastraria com ele e herdaria os endereços de entrega
   * dela.
   */
  it('mas não adota a conta antiga', () => {
    const codigo = exec(autenticacao);
    expect(codigo).not.toMatch(/UPDATE usuarios SET senha_hash = \?[^;]*sem_senha = 1/);
    /* Telefone de conta COM senha continua sendo conflito. */
    expect(codigo).toContain('} else if (telExiste) {');
  });

  /*
   * E O LOGIN DIZ A VERDADE. Sem isto a pessoa recebe "senha incorreta" e passa
   * a tentar adivinhar uma senha que nunca existiu.
   */
  it('o login não diz "senha incorreta" a quem nunca teve senha', () => {
    const codigo = exec(autenticacao);
    expect(codigo).toContain('sem_senha ?? 0) === 1');
    expect(codigo).toContain('não tem senha. Crie sua conta');
    /* E a checagem vem ANTES do compare, senão o resultado já é
       indistinguível de senha errada. */
    const iSem = codigo.indexOf('não tem senha. Crie sua conta');
    const iCompare = codigo.indexOf('await bcrypt.compare(senha, usuario.senha_hash)');
    expect(iSem).toBeGreaterThan(0);
    expect(iSem).toBeLessThan(iCompare);
  });

  /*
   * E NÃO MANDA USAR "ESQUECI MINHA SENHA": a redefinição vai por e-mail, e
   * conta de convidado tem e-mail sintético que não recebe nada. Prometer um
   * caminho que não existe é pior que não prometer nada.
   */
  it('e não promete redefinição por e-mail que não chega', () => {
    const codigo = exec(autenticacao);
    const i = codigo.indexOf('não tem senha. Crie sua conta');
    expect(codigo.slice(Math.max(0, i - 200), i + 200)).not.toContain('Esqueci minha senha');
  });
});

describe('a tela do carrinho', () => {
  const carrinho = fs.readFileSync(
    path.join(BACKEND, '..', '..', 'frontend', 'src', 'pages', 'cliente', 'carrinho.tsx'), 'utf8');

  /*
   * A PAREDE DE LOGIN SAIU DO FIM DO FUNIL. Ali estava um cartão "Entre para
   * finalizar o pedido" com um botão para a tela de login: a pessoa escolheu os
   * itens, viu o total, e a última coisa pedida era inventar uma senha.
   */
  it('quem não está logado vê o formulário de convidado, não uma parede', () => {
    expect(carrinho).toContain('<FormConvidado lojaId={carrinho.loja_id} />');
    /*
     * `exec` porque a frase antiga sobrevive num COMENTÁRIO — o que explica o
     * que foi substituído. Sem tirar comentário, a asserção negativa acusava a
     * própria documentação da mudança. É a quarta vez que caio nisso nesta
     * sessão, e o helper existe exatamente para isso.
     */
    expect(exec(carrinho)).not.toContain('Entre para finalizar o pedido');
  });

  it('pede só nome e WhatsApp', () => {
    const form = carrinho.slice(carrinho.indexOf('function FormConvidado'));
    const corpo = form.slice(0, form.indexOf('\n}\n'));
    expect(corpo).toContain('id="conv-nome"');
    expect(corpo).toContain('id="conv-tel"');
    expect(corpo).toContain('/api/auth/convidado');
    /* Sem senha, sem CPF, sem e-mail. */
    expect(corpo).not.toContain('type="password"');
    expect(corpo).not.toContain('cpf');
  });

  /* E o login continua existindo, depois: quem tem conta tem endereço salvo, e
     para essa pessoa entrar economiza digitação. */
  it('e o login continua oferecido, sem destaque', () => {
    const form = carrinho.slice(carrinho.indexOf('function FormConvidado'));
    expect(form.slice(0, form.indexOf('\n}\n'))).toContain('Já tem conta?');
  });

  /*
   * A SESSÃO DE CONVIDADO MORRE COM A ABA (`lembrar: false` → sessionStorage).
   *
   * Quem pede sem conta costuma estar num aparelho que não é só dele — o
   * celular da mesa, o computador do trabalho. No localStorage, a próxima
   * pessoa abriria o acompanhamento do pedido de outra.
   */
  it('a sessão de convidado não fica guardada no aparelho', () => {
    const form = carrinho.slice(carrinho.indexOf('function FormConvidado'));
    expect(form.slice(0, form.indexOf('\n}\n')))
      .toContain('salvarSessao(r.token, r.usuario, undefined, false)');
  });

  /*
   * E O TOKEN REEMITIDO É GUARDADO. Sem isto a pessoa paga e cai numa tela de
   * acompanhamento que responde 403 — pedido feito, cobrado, e sem como
   * acompanhar. É o pior desfecho possível desta tela.
   */
  it('o token que volta com o pedido substitui o da sessão', () => {
    expect(carrinho).toContain('if (r.token) {');
    expect(carrinho).toContain('salvarSessao(r.token, u, undefined, false)');
  });
});

describe('a coluna nova tem migração', () => {
  /*
   * O CREATE é IF NOT EXISTS e não alcança banco que já existe. Sem o ALTER, o
   * pedido sem cadastro quebraria em produção e funcionaria no banco novo do
   * desenvolvimento — que é o pior jeito de descobrir.
   */
  it('sem_senha está no laço de ALTER', () => {
    expect(schema).toMatch(/\['usuarios', 'sem_senha'/);
  });
});

describe('o arquivo da regra não tem crase dentro de SQL', () => {
  /* Erro que eu cometi três vezes nesta sessão: crase dentro de template
     literal fecha a string. Aqui não há SQL, mas a regra fica registrada. */
  it('o comentário do schema sobre sem_senha não usa crase', () => {
    const i = schema.indexOf('CONTA NASCIDA DE UM PEDIDO SEM CADASTRO');
    const bloco = schema.slice(i, i + 700);
    expect(bloco).not.toContain('`');
  });

  it('e a regra de alcance é um módulo separado, testável sem servidor', () => {
    expect(alcance).toContain('export function convidadoPodeAlcancar');
    expect(alcance).not.toContain("from 'express'");
  });
});
