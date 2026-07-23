/**
 * Rotas de autenticação: cadastro, login (com rate limiting) e dados da sessão.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import db from '../db-mysql';
import { gerarToken, gerarTokenPreAuth, autenticar, autenticarPreAuth } from '../auth';
import { agoraUTC, textoLimpo, emailValido, cpfValido, cpfDigitos, telefoneDigitos, erroHttp } from '../util';
import { enviarEmail, emailRedefinirSenha, emailHabilitado } from '../email';
import { criptografar, descriptografar } from '../cripto';
import { Perfil, Usuario } from '../../tipos/modelos';

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

    // Cliente entra por e-mail ou telefone (CPF continua sendo aceito no
    // login como fallback silencioso, mas some da tela — ver /login). CPF
    // ainda é obrigatório no CADASTRO (dado fiscal, usado na NFC-e).
    // Lojista/entregador continuam só por e-mail, sem CPF.
    // Mensagem de conflito GENÉRICA de propósito, igual pra CPF/telefone/
    // e-mail: mensagens distintas por campo davam pra descobrir se um CPF ou
    // telefone específico já tem conta na plataforma só tentando cadastrar
    // (enumeração de conta — sensível pra CPF, que é dado de identidade).
    const CONFLITO = 'Não foi possível concluir o cadastro com esses dados. Se você já tem conta, faça login; senão, confira CPF/telefone/e-mail informados.';
    const ehCliente = perfil === 'cliente';
    if (ehCliente) {
      if (!cpfValido(cpf)) throw erroHttp(400, 'Informe um CPF válido.');
      if (email && !emailValido(email)) throw erroHttp(400, 'E-mail inválido.');
      const cpfExiste = await db.prepare('SELECT id FROM usuarios WHERE cpf = ?').get(cpf);
      if (cpfExiste) throw erroHttp(409, CONFLITO);
      if (telefone) {
        const telExiste = await db.prepare('SELECT id FROM usuarios WHERE telefone = ?').get(telefone);
        if (telExiste) throw erroHttp(409, CONFLITO);
      }
    } else if (!emailValido(email)) {
      throw erroHttp(400, 'Informe um e-mail válido.');
    }

    // A coluna email é NOT NULL UNIQUE: se o cliente não informou, gera um
    // sintético a partir do CPF (não é usado pra login, só satisfaz o schema).
    const emailFinal = email || (ehCliente ? `${cpf}@cliente.local` : '');
    const jaExiste = await db.prepare('SELECT id FROM usuarios WHERE email = ?').get(emailFinal);
    if (jaExiste) throw erroHttp(409, CONFLITO);

    const senhaHash = bcrypt.hashSync(senha, 10);
    // Clientes podem ser associados a uma loja específica (white label)
    const lojaId = (ehCliente && req.body.loja_id) ? Number(req.body.loja_id) : null;
    const cpfFinal = ehCliente ? cpf : null;
    const info = await db.prepare(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, loja_id, cpf, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(nome, emailFinal, senhaHash, perfil, telefone, lojaId, cpfFinal, agoraUTC());

    const novoId = Number(info.lastInsertRowid);
    const usuario = { id: novoId, nome, email: emailFinal, perfil, telefone, cpf: cpfFinal };
    res.status(201).json({ token: gerarToken(usuario), usuario });
  } catch (e) { next(e); }
});

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
    if (!usuario || !bcrypt.compareSync(senha, usuario.senha_hash)) {
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

    res.json({
      token: gerarToken(usuario),
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
function gerarCodigosBackup(qtd = 8): { texto: string; hash: string }[] {
  return Array.from({ length: qtd }, () => {
    const bruto = crypto.randomBytes(5).toString('hex');
    const texto = `${bruto.slice(0, 5)}-${bruto.slice(5, 10)}`;
    return { texto, hash: bcrypt.hashSync(texto, 10) };
  });
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
    if (usuario.totp_ativo) throw erroHttp(400, 'O 2FA já está ativo nesta conta.');
    if (!usuario.totp_secret) throw erroHttp(400, 'Comece pelo /2fa/configurar antes de confirmar.');

    const secret = descriptografar(usuario.totp_secret);
    if (!codigo || !authenticator.check(codigo, secret)) {
      throw erroHttp(400, 'Código inválido. Confira o horário do celular e tente de novo.');
    }

    const codigos = gerarCodigosBackup();
    await db.prepare('UPDATE usuarios SET totp_ativo = 1, totp_backup_codes = ? WHERE id = ?')
      .run(JSON.stringify(codigos.map(c => c.hash)), usuario.id);

    res.json({
      token: gerarToken(usuario),
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
      const idx = hashes.findIndex(h => bcrypt.compareSync(codigoBackup, h));
      if (idx === -1) throw erroHttp(400, 'Código de backup inválido ou já usado.');
      // Uso único: remove o código usado da lista.
      hashes.splice(idx, 1);
      await db.prepare('UPDATE usuarios SET totp_backup_codes = ? WHERE id = ?')
        .run(JSON.stringify(hashes), usuario.id);
    } else {
      throw erroHttp(400, 'Informe o código do app ou um código de backup.');
    }

    res.json({ token: gerarToken(usuario), usuario: usuarioPublico(usuario) });
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

    const senhaHash = bcrypt.hashSync(senha, 10);
    await db.prepare('UPDATE usuarios SET senha_hash = ?, reset_token_hash = NULL, reset_token_expira = NULL WHERE id = ?')
      .run(senhaHash, usuario.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/eu', autenticar, (req, res) => {
  res.json({ usuario: req.usuario });
});

export default router;
