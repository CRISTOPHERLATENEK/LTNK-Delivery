/**
 * Camada de comunicação com a API REST.
 *
 * SESSÃO ISOLADA POR ÁREA
 * -----------------------
 * Cada área do sistema (cliente, lojista, entregador, admin) tem sua própria
 * sessão independente no localStorage. A área é detectada pela URL atual.
 *
 * Isso significa que:
 *  - Logar como entregador NÃO loga você no cardápio do cliente.
 *  - Cada app (entregador.exe, lojista, etc.) enxerga só a sua sessão.
 *  - Sair de uma área não desloga as outras.
 *
 * O token enviado em cada chamada à API é sempre o da área onde você está.
 */
import type { UsuarioSessao } from '@/types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

export type Area = 'cliente' | 'lojista' | 'entregador' | 'cozinha' | 'admin';

/** Detecta a área atual pela URL. Cada área tem sessão isolada. */
export function areaAtual(): Area {
  const p = typeof window !== 'undefined' ? window.location.pathname : '/';
  if (p.startsWith('/lojista')) return 'lojista';
  if (p.startsWith('/entregador')) return 'entregador';
  if (p.startsWith('/cozinha')) return 'cozinha';
  if (p.startsWith('/painel-admin')) return 'admin';
  return 'cliente';
}

/** Caminho da raiz de uma área — usado em logout/redirecionamentos. */
export function raizArea(area: Area = areaAtual()): string {
  switch (area) {
    case 'lojista': return '/lojista';
    case 'entregador': return '/entregador';
    case 'cozinha': return '/cozinha';
    case 'admin': return '/painel-admin';
    default: return '/';
  }
}

const chaveToken = (a: Area) => `token:${a}`;
const chaveUsuario = (a: Area) => `usuario:${a}`;

/** Chave do tema (claro/escuro) por área — cada painel lembra a própria preferência. */
export const chaveTema = (a: Area = areaAtual()) => `tema:${a}`;

/**
 * Salva a sessão. `lembrar` (padrão true) controla a persistência:
 *   - true  → localStorage: continua logado mesmo fechando o navegador.
 *   - false → sessionStorage: cai fora ao fechar a aba/navegador.
 * Grava só num dos dois e limpa o outro, pra não deixar sessão duplicada.
 */
export function salvarSessao(token: string, usuario: UsuarioSessao, area: Area = areaAtual(), lembrar = true) {
  const persistente = lembrar ? localStorage : sessionStorage;
  const efemero = lembrar ? sessionStorage : localStorage;
  efemero.removeItem(chaveToken(area));
  efemero.removeItem(chaveUsuario(area));
  persistente.setItem(chaveToken(area), token);
  persistente.setItem(chaveUsuario(area), JSON.stringify(usuario));
}

export function sessaoUsuario(area: Area = areaAtual()): UsuarioSessao | null {
  try {
    const bruto = localStorage.getItem(chaveUsuario(area)) ?? sessionStorage.getItem(chaveUsuario(area));
    return JSON.parse(bruto || 'null');
  } catch { return null; }
}

export function tokenSessao(area: Area = areaAtual()): string | null {
  return localStorage.getItem(chaveToken(area)) ?? sessionStorage.getItem(chaveToken(area));
}

export function encerrarSessao(area: Area = areaAtual()) {
  localStorage.removeItem(chaveToken(area));
  localStorage.removeItem(chaveUsuario(area));
  sessionStorage.removeItem(chaveToken(area));
  sessionStorage.removeItem(chaveUsuario(area));
}

/**
 * "Entrar como lojista" (Admin → Clientes/Lojas): abre uma sessão de lojista a
 * partir de um token de impersonação SEM passá-lo pela URL — um JWT na query
 * string vaza em histórico do navegador, logs de acesso e header Referer.
 * Valida o token, grava a sessão de lojista no localStorage (compartilhado
 * entre abas same-origin) e o chamador só precisa abrir /lojista numa nova aba,
 * que já encontra a sessão pronta. Lança se o token não validar.
 */
export async function abrirSessaoLojistaImpersonada(token: string): Promise<void> {
  const r = await fetch('/api/auth/eu', { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Não foi possível validar a sessão de lojista (HTTP ${r.status}).`);
  const { usuario } = await r.json();
  salvarSessao(token, usuario, 'lojista');
}

/** Checa se o usuário logado NA ÁREA ADMIN é o super admin (dono da plataforma). */
export function ehSuperAdmin(): boolean {
  const u = sessaoUsuario('admin');
  return !!(u && u.perfil === 'admin' && u.super_admin);
}

/**
 * Migração one-shot do formato antigo (sessão global única) para o novo
 * formato isolado por área. Roda uma vez ao carregar o módulo; depois remove
 * as chaves antigas para que ninguém fique "logado em tudo".
 */
(function migrarSessaoAntiga() {
  if (typeof window === 'undefined') return;
  try {
    const t = localStorage.getItem('token');
    const u = localStorage.getItem('usuario');
    if (t && u) {
      const usuario = JSON.parse(u);
      const perfil: string = usuario?.perfil;
      const area: Area =
        perfil === 'lojista' ? 'lojista'
        : perfil === 'entregador' ? 'entregador'
        : perfil === 'admin' ? 'admin'
        : 'cliente';
      if (!localStorage.getItem(chaveToken(area))) {
        localStorage.setItem(chaveToken(area), t);
        localStorage.setItem(chaveUsuario(area), u);
      }
    }
  } catch { /* ignora */ }
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
})();

const CHAVE_TENANT_DEMO = 'tenant-demo-slug';

/**
 * Ativa/desativa o modo "vitrine de demonstração": enquanto ativo, toda
 * chamada à API carrega o header X-Demo-Tenant, que o backend usa pra
 * resolver o tenant daquele slug em vez do Host da requisição (ver
 * server.ts). Usado só pela página de demo (pages/cliente/demo.tsx) —
 * sessionStorage porque não deve sobreviver ao fechamento da aba.
 */
export function definirTenantDemo(slug: string | null) {
  if (slug) sessionStorage.setItem(CHAVE_TENANT_DEMO, slug);
  else sessionStorage.removeItem(CHAVE_TENANT_DEMO);
}

/**
 * Só considera o modo demo ativo dentro das rotas da área cliente que a
 * vitrine de demo realmente usa (/demo, /loja, /carrinho, /pedido*, /conta).
 * Fora delas (lojista/entregador/cozinha/admin, ou de volta pra home) o flag
 * é ignorado — e apagado — pra uma sessionStorage esquecida nunca desviar
 * chamadas reais de outra área pro tenant de demonstração.
 */
export function tenantDemoAtivo(): string | null {
  const slug = sessionStorage.getItem(CHAVE_TENANT_DEMO);
  if (!slug) return null;
  const p = typeof window !== 'undefined' ? window.location.pathname : '/';
  const dentroDaDemo = /^\/(demo|loja|carrinho|pedidos|pedido|conta)(\/|$)/.test(p);
  if (!dentroDaDemo) { sessionStorage.removeItem(CHAVE_TENANT_DEMO); return null; }
  return slug;
}

export async function api<T = unknown>(
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE',
  caminho: string,
  corpo?: unknown,
  tokenOverride?: string,
): Promise<T> {
  const cabecalhos: Record<string, string> = { 'Content-Type': 'application/json' };
  // tokenOverride: usado pelo fluxo de 2FA (token de pré-autenticação de curta
  // duração, ainda sem sessão salva) — nesses casos NÃO cai pro tokenSessao().
  const token = tokenOverride ?? tokenSessao();
  if (token) cabecalhos['Authorization'] = 'Bearer ' + token;
  const tenantDemo = tenantDemoAtivo();
  if (tenantDemo) cabecalhos['X-Demo-Tenant'] = tenantDemo;

  const resposta = await fetch(caminho, {
    method: metodo,
    headers: cabecalhos,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });

  let dados: any = {};
  try { dados = await resposta.json(); } catch { /* sem corpo */ }

  if (!resposta.ok) {
    if (resposta.status === 401) encerrarSessao();
    throw new ApiError(resposta.status, dados.erro || 'Erro de comunicação com o servidor.');
  }
  return dados as T;
}
