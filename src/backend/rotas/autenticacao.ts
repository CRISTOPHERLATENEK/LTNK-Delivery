/**
 * Rotas de autenticação: cadastro, login (com rate limiting) e dados da sessão.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import db from '../db';
import { gerarToken, autenticar } from '../auth';
import { agoraUTC, textoLimpo, emailValido, cpfValido, cpfDigitos, erroHttp } from '../util';
import { enviarEmail, emailRedefinirSenha, emailHabilitado } from '../email';
import { Perfil, Usuario } from '../../tipos/modelos';

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

const PERFIS_PUBLICOS: Perfil[] = ['cliente', 'lojista', 'entregador'];

router.post('/registrar', (req, res, next) => {
  try {
    const nome = textoLimpo(req.body.nome, 120);
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    const telefone = textoLimpo(req.body.telefone, 30);
    const perfil = (textoLimpo(req.body.perfil, 20) || 'cliente') as Perfil;
    const cpf = cpfDigitos(req.body.cpf);

    if (nome.length < 2) throw erroHttp(400, 'Informe seu nome completo.');
    if (senha.length < 6) throw erroHttp(400, 'A senha precisa ter pelo menos 6 caracteres.');
    if (!PERFIS_PUBLICOS.includes(perfil)) throw erroHttp(400, 'Perfil inválido.');

    // Cliente loga por CPF (obrigatório); e-mail é opcional. Lojista/entregador
    // continuam por e-mail (obrigatório), sem CPF.
    const ehCliente = perfil === 'cliente';
    if (ehCliente) {
      if (!cpfValido(cpf)) throw erroHttp(400, 'Informe um CPF válido.');
      if (email && !emailValido(email)) throw erroHttp(400, 'E-mail inválido.');
      const cpfExiste = db.prepare('SELECT id FROM usuarios WHERE cpf = ?').get(cpf);
      if (cpfExiste) throw erroHttp(409, 'Já existe uma conta com este CPF.');
    } else if (!emailValido(email)) {
      throw erroHttp(400, 'Informe um e-mail válido.');
    }

    // A coluna email é NOT NULL UNIQUE: se o cliente não informou, gera um
    // sintético a partir do CPF (não é usado pra login, só satisfaz o schema).
    const emailFinal = email || (ehCliente ? `${cpf}@cliente.local` : '');
    const jaExiste = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(emailFinal);
    if (jaExiste) throw erroHttp(409, 'Já existe uma conta com este e-mail.');

    const senhaHash = bcrypt.hashSync(senha, 10);
    // Clientes podem ser associados a uma loja específica (white label)
    const lojaId = (ehCliente && req.body.loja_id) ? Number(req.body.loja_id) : null;
    const cpfFinal = ehCliente ? cpf : null;
    const info = db.prepare(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, loja_id, cpf, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(nome, emailFinal, senhaHash, perfil, telefone, lojaId, cpfFinal, agoraUTC());

    const novoId = Number(info.lastInsertRowid);

    // Lojistas recebem uma loja vazia automaticamente ao se cadastrar
    if (perfil === 'lojista') {
      db.prepare(
        `INSERT INTO lojas (usuario_id, nome, descricao, categoria, endereco,
                            taxa_entrega_centavos, tempo_estimado_min, horario_funcionamento,
                            status_aprovacao, aberta, criado_em)
         VALUES (?, ?, '', 'Outros', '', 0, 40, '', 'pendente', 0, ?)`
      ).run(novoId, nome, agoraUTC());
    }

    const usuario = { id: novoId, nome, email: emailFinal, perfil, telefone, cpf: cpfFinal };
    res.status(201).json({ token: gerarToken(usuario), usuario });
  } catch (e) { next(e); }
});

router.post('/login', limiteLogin, (req, res, next) => {
  try {
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    // Cliente entra por CPF; lojista/entregador por e-mail. Se vier `cpf` no
    // corpo, busca por CPF; senão, pelo e-mail.
    const cpf = cpfDigitos(req.body.cpf);
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const porCpf = cpf.length === 11;
    const credErrada = porCpf ? 'CPF ou senha incorretos.' : 'E-mail ou senha incorretos.';

    const usuario = (porCpf
      ? db.prepare('SELECT * FROM usuarios WHERE cpf = ?').get(cpf)
      : db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email)) as Usuario | undefined;
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

    const usuario = db.prepare('SELECT id, nome, email, bloqueado FROM usuarios WHERE email = ?')
      .get(email) as { id: number; nome: string; email: string; bloqueado: number } | undefined;

    if (usuario && !usuario.bloqueado) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expira = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      db.prepare('UPDATE usuarios SET reset_token_hash = ?, reset_token_expira = ? WHERE id = ?')
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
router.post('/redefinir-senha', (req, res, next) => {
  try {
    const token = textoLimpo(req.body.token, 128);
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (!token) throw erroHttp(400, 'Link inválido.');
    if (senha.length < 6) throw erroHttp(400, 'A senha precisa ter pelo menos 6 caracteres.');

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const usuario = db.prepare(
      'SELECT id, reset_token_expira FROM usuarios WHERE reset_token_hash = ?'
    ).get(tokenHash) as { id: number; reset_token_expira: string } | undefined;

    if (!usuario || new Date(usuario.reset_token_expira) < new Date()) {
      throw erroHttp(400, 'Esse link expirou ou já foi usado. Peça uma nova redefinição.');
    }

    const senhaHash = bcrypt.hashSync(senha, 10);
    db.prepare('UPDATE usuarios SET senha_hash = ?, reset_token_hash = NULL, reset_token_expira = NULL WHERE id = ?')
      .run(senhaHash, usuario.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/eu', autenticar, (req, res) => {
  res.json({ usuario: req.usuario });
});

export default router;
