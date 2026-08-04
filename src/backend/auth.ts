/**
 * Autenticação (JWT) e autorização por perfil.
 * Toda verificação de permissão acontece no backend — o frontend só esconde botões.
 */
import jwt, { SignOptions } from 'jsonwebtoken';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import db, { comTenant, bancoTenantAtual } from './db-mysql';
import { erroHttp } from './util';
import { Perfil, Usuario } from '../tipos/modelos';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('ERRO FATAL: defina JWT_SECRET no arquivo .env');
  process.exit(1);
}
const JWT_EXPIRACAO = (process.env.JWT_EXPIRACAO || '12h') as SignOptions['expiresIn'];

/** Dados do usuário autenticado que ficam disponíveis em req.usuario. */
export type UsuarioAutenticado = Pick<Usuario, 'id' | 'nome' | 'email' | 'perfil' | 'telefone' | 'cpf' | 'bloqueado' | 'super_admin' | 'totp_ativo'>;

/**
 * Extrai o tenant (db_nome) embutido num token de sessão VÁLIDO, ou null.
 * Usado pela middleware de resolução de tenant (server.ts): a sessão inteira —
 * rotas PÚBLICAS e privadas — passa a rodar no tenant a que o usuário pertence,
 * não no resolvido pelo Host. Sem isso, depois do login as rotas públicas (menu
 * da loja, tema…) caíam no tenant errado, porque o header X-Demo-Tenant só vale
 * em requisição anônima e rota pública não roda `autenticar` pra ler o claim.
 * O claim é assinado por nós (login/registro/impersonação) — nunca vem cru do
 * cliente. Não lança: token ausente/inválido/sem claim → null (cai no Host).
 */
export function tenantDoToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const dados = jwt.verify(authHeader.slice(7), JWT_SECRET as string) as jwt.JwtPayload;
    return typeof dados.tenant === 'string' && dados.tenant ? dados.tenant : null;
  } catch { return null; }
}

/** Conta de cozinha autenticada (KDS) — pertence a uma loja específica. */
export type CozinhaAutenticada = { id: number; nome: string; loja_id: number };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioAutenticado;
      cozinha?: CozinhaAutenticada;
      /** true quando o Host NÃO casou com nenhum tenant (domínio da plataforma). */
      hostEhDaPlataforma?: boolean;
    }
  }
}

/**
 * Emite o token normal (login/registro). Embute o BANCO do tenant resolvido
 * pra este request (`bancoTenantAtual()`), igual o token de impersonação —
 * assim a sessão fica pinada naquele tenant pro resto da vida do token,
 * independente de qual domínio/header resolveu o tenant na hora do login.
 *
 * Isso importa principalmente pra quem loga durante a vitrine de demo
 * (`/demo/:slug`, tenant resolvido via header X-Demo-Tenant — só válido em
 * requisições SEM Authorization, ver server.ts): sem o claim, toda chamada
 * autenticada DEPOIS do login perderia o override de demo (o header só vale
 * pra requisição anônima) e resolveria pelo Host — quase sempre o tenant
 * master, onde o usuário recém-criado não existe → 401 em cascata, sessão
 * derrubada, cliente jogado de volta pra tela de login/landing.
 */
/**
 * Validade longa, usada quando a pessoa marca "Manter conectado neste
 * dispositivo".
 *
 * O QUE ESTAVA QUEBRADO: a opção só mudava ONDE o token era guardado
 * (localStorage em vez de sessionStorage), então ele sobrevivia a fechar a aba —
 * mas o JWT expirava em 12h de qualquer jeito. O lojista marcava a caixa e no dia
 * seguinte estava fora. Do ponto de vista dele, a opção não fazia nada.
 *
 * POR QUE 30 DIAS É ACEITÁVEL AQUI: `autenticar` recarrega o usuário do banco em
 * CADA requisição e recusa quem está `bloqueado`. Ou seja, existe revogação de
 * verdade — bloquear a conta encerra as sessões na hora, independente da validade
 * do token. Sem essa checagem por request, token de 30 dias seria imprudente.
 */
const JWT_EXPIRACAO_LONGA = (process.env.JWT_EXPIRACAO_LONGA || '30d') as SignOptions['expiresIn'];

/**
 * Perfis que NÃO expiram: entregador e cozinha.
 *
 * POR QUE: são ferramentas de turno, não sessões de escritório. O entregador está
 * na rua, de moto, muitas vezes sem saber a senha de cor — ser deslogado no meio
 * de uma entrega significa corrida perdida e cliente sem rastreio. O KDS é um
 * tablet preso na parede da cozinha: relogar toda manhã é atrito puro, e no pico
 * do almoço é pedido saindo errado.
 *
 * POR QUE ISSO NÃO É IMPRUDENTE: `autenticar` e `autenticarCozinha` recarregam o
 * usuário/conta do banco em CADA requisição e recusam quem está `bloqueado`.
 * Existe revogação de verdade: bloquear no painel encerra a sessão na hora,
 * independente do prazo do token. É o que substitui a expiração aqui — e é o que
 * o lojista deve usar quando um entregador sai da equipe ou um tablet é perdido.
 *
 * Sem essa checagem por request, token sem prazo seria irresponsável.
 */
const PERFIS_SEM_EXPIRACAO = new Set(['entregador']);

export function gerarToken(
  usuario: Pick<Usuario, 'id' | 'perfil'>,
  opcoes: { manterConectado?: boolean } = {},
): string {
  const conteudo = { sub: usuario.id, perfil: usuario.perfil, tenant: bancoTenantAtual() };

  // Sem `expiresIn` o JWT não carrega `exp`, e `jwt.verify` não tem o que checar:
  // o token vale até a conta ser bloqueada. Deliberado, ver acima.
  if (PERFIS_SEM_EXPIRACAO.has(usuario.perfil)) {
    return jwt.sign(conteudo, JWT_SECRET as string);
  }

  return jwt.sign(
    conteudo,
    JWT_SECRET as string,
    { expiresIn: opcoes.manterConectado ? JWT_EXPIRACAO_LONGA : JWT_EXPIRACAO }
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

  // SEGURANÇA: tokens de cozinha (KDS) e de pré-autenticação (2FA pendente)
  // são assinados com o MESMO segredo, mas não dão acesso a rotas protegidas
  // — cozinha porque seu `sub` é de `cozinha_contas`, não de `usuarios`
  // (escalonamento de privilégio); pré-auth porque o login ainda não terminou
  // (o 2FA não foi verificado). Ambos carregam `tipo` pra se identificar;
  // tokens de usuário legítimos e completos sempre carregam `perfil` e NUNCA
  // um `tipo`.
  if (dados.tipo === 'cozinha' || dados.tipo === 'pre2fa' || !dados.perfil) {
    return next(erroHttp(401, 'Sessão inválida ou expirada. Faça login novamente.'));
  }

  const carregarUsuarioEContinuar = async () => {
    const usuario = await db.prepare(
      'SELECT id, nome, email, perfil, telefone, cpf, bloqueado, super_admin, totp_ativo FROM usuarios WHERE id = ?'
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

// ----- Pré-autenticação (2FA obrigatório pra lojista/admin) ----------------
//
// Depois de validar email+senha, lojista/admin ainda não recebem o token
// normal — recebem este, de curta duração e sem acesso a NENHUMA rota
// protegida (`autenticar` recusa `tipo: 'pre2fa'` explicitamente, ver acima).
// Só serve pra completar o setup (primeiro login) ou a verificação (logins
// seguintes) do código de 6 dígitos nos endpoints /api/auth/2fa/*, que aí sim
// devolvem o token normal via gerarToken().

export type UsuarioPreAuth = { id: number; perfil: Perfil };

/**
 * O claim `tenant` é OBRIGATÓRIO aqui, pelo mesmo motivo do token normal (ver
 * gerarToken e o comentário da middleware de tenant em server.ts): sem ele, o
 * tenant desta etapa do login seria resolvido pelo Host, e um token emitido no
 * tenant A poderia ser apresentado no domínio do tenant B. Como o `sub` é só
 * um id numérico e ids colidem entre bancos (id=1/2 existem em quase todo
 * tenant), o backend carregaria o usuário de MESMO ID do tenant B e emitiria
 * uma sessão válida pra ele — troca de conta entre tenants sem saber a senha.
 */
export function gerarTokenPreAuth(usuario: UsuarioPreAuth): string {
  return jwt.sign(
    { sub: usuario.id, perfil: usuario.perfil, tipo: 'pre2fa', tenant: bancoTenantAtual() },
    JWT_SECRET as string,
    { expiresIn: '10m' }
  );
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuarioPreAuth?: UsuarioPreAuth;
    }
  }
}

/** Exige um token de pré-autenticação válido (ver gerarTokenPreAuth). */
export const autenticarPreAuth: RequestHandler = (req, _res, next) => {
  const cabecalho = req.headers.authorization || '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;
  if (!token) return next(erroHttp(401, 'Sessão de login expirada. Comece de novo.'));

  let dados: jwt.JwtPayload;
  try {
    dados = jwt.verify(token, JWT_SECRET as string) as jwt.JwtPayload;
  } catch {
    return next(erroHttp(401, 'Sessão de login expirada. Comece de novo.'));
  }
  if (dados.tipo !== 'pre2fa' || typeof dados.sub !== 'number' && typeof dados.sub !== 'string') {
    return next(erroHttp(401, 'Sessão de login expirada. Comece de novo.'));
  }

  // Defesa em profundidade: a middleware de tenant (server.ts) já troca o banco
  // pro claim `tenant` deste token, então em condição normal os dois batem.
  // Recusar explicitamente quando NÃO batem garante que, se aquela ordem mudar
  // algum dia, isto falha fechado em vez de carregar o usuário de mesmo id no
  // banco errado — que é justamente a troca de conta entre tenants.
  if (typeof dados.tenant !== 'string' || dados.tenant !== bancoTenantAtual()) {
    return next(erroHttp(401, 'Sessão de login expirada. Comece de novo.'));
  }

  req.usuarioPreAuth = { id: Number(dados.sub), perfil: dados.perfil };
  next();
};

// ----- Autenticação de cozinha (KDS) ---------------------------------------
// Token separado do de usuário: carrega tipo='cozinha' e a loja vinculada.

export function gerarTokenCozinha(conta: { id: number; loja_id: number }): string {
  // SEM `expiresIn`, pelo mesmo motivo de PERFIS_SEM_EXPIRACAO acima: o KDS é um
  // tablet fixo na cozinha e não pode cair no meio do serviço. Quem revoga é o
  // lojista, desativando o acesso da cozinha (autenticarCozinha checa `bloqueado`
  // a cada requisição). Antes expirava em 12h e a cozinha relogava toda manhã.
  return jwt.sign(
    { sub: conta.id, tipo: 'cozinha', loja_id: conta.loja_id },
    JWT_SECRET as string,
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
