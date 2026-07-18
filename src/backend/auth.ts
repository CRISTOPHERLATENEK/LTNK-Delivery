/**
 * Autenticação (JWT) e autorização por perfil.
 * Toda verificação de permissão acontece no backend — o frontend só esconde botões.
 */
import jwt, { SignOptions } from 'jsonwebtoken';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import db, { comTenant } from './db-mysql';
import { erroHttp } from './util';
import { Perfil, Usuario } from '../tipos/modelos';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('ERRO FATAL: defina JWT_SECRET no arquivo .env');
  process.exit(1);
}
const JWT_EXPIRACAO = (process.env.JWT_EXPIRACAO || '12h') as SignOptions['expiresIn'];

/** Dados do usuário autenticado que ficam disponíveis em req.usuario. */
export type UsuarioAutenticado = Pick<Usuario, 'id' | 'nome' | 'email' | 'perfil' | 'telefone' | 'cpf' | 'bloqueado' | 'super_admin'>;

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
 * Token de "entrar como lojista" (Admin → Clientes): carrega o BANCO do
 * tenant no próprio token (claim `tenant`). Diferente do token normal — cujo
 * tenant vem do Host da requisição — este funciona em QUALQUER domínio,
 * porque `autenticar` abaixo troca o contexto de banco pra esse valor assim
 * que valida o token, antes de carregar o usuário. Só emitido pelo super
 * admin (ver POST /api/admin/tenants/:id/impersonar); expira rápido.
 */
export function gerarTokenImpersonado(usuario: Pick<Usuario, 'id' | 'perfil'>, dbNomeTenant: string): string {
  return jwt.sign(
    { sub: usuario.id, perfil: usuario.perfil, tenant: dbNomeTenant },
    JWT_SECRET as string,
    { expiresIn: '2h' }
  );
}

/**
 * Exige token válido no header "Authorization: Bearer <token>".
 * Recarrega o usuário do banco a cada requisição para respeitar bloqueios
 * feitos pelo admin DEPOIS da emissão do token.
 */
export const autenticar: RequestHandler = async (req, _res, next) => {
  const cabecalho = req.headers.authorization || '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;
  if (!token) return next(erroHttp(401, 'Faça login para continuar.'));

  let dados: jwt.JwtPayload;
  try {
    dados = jwt.verify(token, JWT_SECRET as string) as jwt.JwtPayload;
  } catch {
    return next(erroHttp(401, 'Sessão inválida ou expirada. Faça login novamente.'));
  }

  // SEGURANÇA: tokens de cozinha (KDS) são assinados com o MESMO segredo, mas
  // seu `sub` é um id de `cozinha_contas`, não de `usuarios`. Sem esta guarda,
  // um token de cozinha passaria por aqui e seria carregado como o `usuarios`
  // de mesmo id — escalonamento de privilégio. Tokens de usuário legítimos
  // sempre carregam o claim `perfil`; os de cozinha carregam `tipo:'cozinha'`.
  if (dados.tipo === 'cozinha' || !dados.perfil) {
    return next(erroHttp(401, 'Sessão inválida ou expirada. Faça login novamente.'));
  }

  const carregarUsuarioEContinuar = async () => {
    const usuario = await db.prepare(
      'SELECT id, nome, email, perfil, telefone, cpf, bloqueado, super_admin FROM usuarios WHERE id = ?'
    ).get(dados.sub) as UsuarioAutenticado | undefined;

    if (!usuario) return next(erroHttp(401, 'Usuário não encontrado.'));
    if (usuario.bloqueado) return next(erroHttp(403, 'Sua conta está bloqueada. Fale com o suporte.'));

    req.usuario = usuario;
    next();
  };

  // Token de impersonação (ver gerarTokenImpersonado): o banco vem do token,
  // não do Host — sobrescreve o tenant já resolvido pra esta requisição.
  if (typeof dados.tenant === 'string' && dados.tenant) {
    await comTenant(dados.tenant, carregarUsuarioEContinuar);
  } else {
    await carregarUsuarioEContinuar();
  }
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
export const autenticarCozinha: RequestHandler = async (req, _res, next) => {
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

  const conta = await db.prepare(
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
