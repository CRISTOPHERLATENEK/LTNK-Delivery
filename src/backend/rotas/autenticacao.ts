/**
 * Rotas de autenticação: cadastro, login (com rate limiting) e dados da sessão.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import db from '../db';
import { gerarToken, autenticar } from '../auth';
import { agoraUTC, textoLimpo, emailValido, erroHttp } from '../util';
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

const PERFIS_PUBLICOS: Perfil[] = ['cliente', 'lojista', 'entregador'];

router.post('/registrar', (req, res, next) => {
  try {
    const nome = textoLimpo(req.body.nome, 120);
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    const telefone = textoLimpo(req.body.telefone, 30);
    const perfil = (textoLimpo(req.body.perfil, 20) || 'cliente') as Perfil;

    if (nome.length < 2) throw erroHttp(400, 'Informe seu nome completo.');
    if (!emailValido(email)) throw erroHttp(400, 'Informe um e-mail válido.');
    if (senha.length < 6) throw erroHttp(400, 'A senha precisa ter pelo menos 6 caracteres.');
    if (!PERFIS_PUBLICOS.includes(perfil)) throw erroHttp(400, 'Perfil inválido.');

    const jaExiste = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    if (jaExiste) throw erroHttp(409, 'Já existe uma conta com este e-mail.');

    const senhaHash = bcrypt.hashSync(senha, 10);
    // Clientes podem ser associados a uma loja específica (white label)
    const lojaId = (perfil === 'cliente' && req.body.loja_id) ? Number(req.body.loja_id) : null;
    const info = db.prepare(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, loja_id, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(nome, email, senhaHash, perfil, telefone, lojaId, agoraUTC());

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

    const usuario = { id: novoId, nome, email, perfil, telefone };
    res.status(201).json({ token: gerarToken(usuario), usuario });
  } catch (e) { next(e); }
});

router.post('/login', limiteLogin, (req, res, next) => {
  try {
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';

    const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email) as Usuario | undefined;
    if (!usuario || !bcrypt.compareSync(senha, usuario.senha_hash)) {
      throw erroHttp(401, 'E-mail ou senha incorretos.');
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
        perfil: usuario.perfil, telefone: usuario.telefone,
        super_admin: usuario.super_admin || 0,
      },
    });
  } catch (e) { next(e); }
});

router.get('/eu', autenticar, (req, res) => {
  res.json({ usuario: req.usuario });
});

export default router;
