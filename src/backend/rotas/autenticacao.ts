/**
 * Rotas de autenticação: cadastro, login (com rate limiting) e dados da sessão.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import db from '../db';
import { gerarToken, autenticar } from '../auth';
import { agoraUTC, textoLimpo, emailValido, cpfValido, cpfDigitos, erroHttp } from '../util';
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

router.get('/eu', autenticar, (req, res) => {
  res.json({ usuario: req.usuario });
});

export default router;
