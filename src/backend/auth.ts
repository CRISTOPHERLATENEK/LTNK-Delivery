/**
 * Autenticação (JWT) e autorização por perfil.
 * Toda verificação de permissão acontece no backend — o frontend só esconde botões.
 */
import jwt, { SignOptions } from 'jsonwebtoken';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import db from './db';
import { erroHttp } from './util';
import { Perfil, Usuario } from '../tipos/modelos';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('ERRO FATAL: defina JWT_SECRET no arquivo .env');
  process.exit(1);
}
const JWT_EXPIRACAO = (process.env.JWT_EXPIRACAO || '12h') as SignOptions['expiresIn'];

/** Dados do usuário autenticado que ficam disponíveis em req.usuario. */
export type UsuarioAutenticado = Pick<Usuario, 'id' | 'nome' | 'email' | 'perfil' | 'telefone' | 'bloqueado' | 'super_admin'>;

/** Conta de cozinha autenticada (KDS) — pertence a uma loja específica. */
export type CozinhaAutenticada = { id: number; nome: string; loja_id: number };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioAutenticado;
      cozinha?: CozinhaAutenticada;
    }
  }
}

export function gerarToken(usuario: Pick<Usuario, 'id' | 'perfil'>): string {
  return jwt.sign(
    { sub: usuario.id, perfil: usuario.perfil },
    JWT_SECRET as string,
    { expiresIn: JWT_EXPIRACAO }
  );
}

/**
 * Exige token válido no header "Authorization: Bearer <token>".
 * Recarrega o usuário do banco a cada requisição para respeitar bloqueios
 * feitos pelo admin DEPOIS da emissão do token.
 */
export const autenticar: RequestHandler = (req, _res, next) => {
  const cabecalho = req.headers.authorization || '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;
  if (!token) return next(erroHttp(401, 'Faça login para continuar.'));

  let dados: jwt.JwtPayload;
  try {
    dados = jwt.verify(token, JWT_SECRET as string) as jwt.JwtPayload;
  } catch {
    return next(erroHttp(401, 'Sessão inválida ou expirada. Faça login novamente.'));
  }

  const usuario = db.prepare(
    'SELECT id, nome, email, perfil, telefone, bloqueado, super_admin FROM usuarios WHERE id = ?'
  ).get(dados.sub) as UsuarioAutenticado | undefined;

  if (!usuario) return next(erroHttp(401, 'Usuário não encontrado.'));
  if (usuario.bloqueado) return next(erroHttp(403, 'Sua conta está bloqueada. Fale com o suporte.'));

  req.usuario = usuario;
  next();
};

// ----- Autenticação de cozinha (KDS) ---------------------------------------
// Token separado do de usuário: carrega tipo='cozinha' e a loja vinculada.

export function gerarTokenCozinha(conta: { id: number; loja_id: number }): string {
  return jwt.sign(
    { sub: conta.id, tipo: 'cozinha', loja_id: conta.loja_id },
    JWT_SECRET as string,
    { expiresIn: JWT_EXPIRACAO }
  );
}

/**
 * Exige um token de cozinha válido. Recarrega a conta do banco a cada
 * requisição (respeita bloqueio feito pelo lojista depois da emissão).
 */
export const autenticarCozinha: RequestHandler = (req, _res, next) => {
  const cabecalho = req.headers.authorization || '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;
  if (!token) return next(erroHttp(401, 'Faça login para continuar.'));

  let dados: jwt.JwtPayload;
  try {
    dados = jwt.verify(token, JWT_SECRET as string) as jwt.JwtPayload;
  } catch {
    return next(erroHttp(401, 'Sessão inválida ou expirada. Faça login novamente.'));
  }
  if (dados.tipo !== 'cozinha') return next(erroHttp(403, 'Este acesso é exclusivo da cozinha.'));

  const conta = db.prepare(
    'SELECT id, nome, loja_id, bloqueado FROM cozinha_contas WHERE id = ?'
  ).get(dados.sub) as { id: number; nome: string; loja_id: number; bloqueado: number } | undefined;

  if (!conta) return next(erroHttp(401, 'Conta de cozinha não encontrada.'));
  if (conta.bloqueado) return next(erroHttp(403, 'Este acesso da cozinha foi desativado.'));

  req.cozinha = { id: conta.id, nome: conta.nome, loja_id: conta.loja_id };
  next();
};

/** Restringe a rota aos perfis informados. */
export function exigirPerfil(...perfis: Perfil[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.usuario) return next(erroHttp(401, 'Faça login para continuar.'));
    if (!perfis.includes(req.usuario.perfil)) {
      return next(erroHttp(403, 'Você não tem permissão para acessar este recurso.'));
    }
    next();
  };
}

/**
 * Restringe a rota ao SUPER ADMIN (dono do SaaS).
 * Admins operacionais recebem 403 — só podem ver/aprovar lojas e pedidos,
 * sem mexer na marca da plataforma, na comissão nem em outros admins.
 */
export const exigirSuperAdmin: RequestHandler = (req, _res, next) => {
  if (!req.usuario) return next(erroHttp(401, 'Faça login para continuar.'));
  if (req.usuario.perfil !== 'admin' || !req.usuario.super_admin) {
    return next(erroHttp(403, 'Apenas o super admin pode executar esta ação.'));
  }
  next();
};
