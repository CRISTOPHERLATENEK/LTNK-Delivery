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

  /**
   * A requisição não chegou ao servidor: sem internet, servidor fora, DNS, TLS.
   *
   * POR QUE ISSO EXISTE: `fetch` rejeita com `TypeError: Failed to fetch` nesse
   * caso, e não com ApiError — então nenhuma tela conseguia diferenciar "não
   * existe" de "não deu pra falar com o servidor". O resultado aparecia na cara
   * do cliente: a vitrine dizia "Loja não encontrada" quando o servidor estava
   * fora do ar. Agora essa falha também vira ApiError, com status 0 (a mesma
   * convenção do XHR pra "sem resposta").
   */
  get semRede(): boolean {
    return this.status === 0;
  }
}

export type Area = 'cliente' | 'lojista' | 'entregador' | 'cozinha' | 'admin' | 'revendedor';

/** Detecta a área atual pela URL. Cada área tem sessão isolada. */
export function areaAtual(): Area {
  const p = typeof window !== 'undefined' ? window.location.pathname : '/';
  if (p.startsWith('/lojista')) return 'lojista';
  if (p.startsWith('/entregador')) return 'entregador';
  if (p.startsWith('/cozinha')) return 'cozinha';
  if (p.startsWith('/painel-admin')) return 'admin';
  // Sessão isolada: o revendedor não é usuário de tenant nenhum, e misturar a
  // chave dele com a do admin faria uma sessão derrubar a outra no mesmo
  // navegador.
  if (p.startsWith('/revenda')) return 'revendedor';
  return 'cliente';
}

/** Caminho da raiz de uma área — usado em logout/redirecionamentos. */
export function raizArea(area: Area = areaAtual()): string {
  switch (area) {
    case 'lojista': return '/lojista';
    case 'entregador': return '/entregador';
    case 'cozinha': return '/cozinha';
    case 'revendedor': return '/revenda';
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

/**
 * A resposta do login é de um REVENDEDOR? Se for, guarda a sessão dele e manda
 * pro painel de revenda, devolvendo true pra quem chamou parar ali.
 *
 * Existe porque `/api/auth/login` é compartilhado por quatro telas, e a
 * resposta do revendedor não traz `usuario` — sem este desvio, cada tela
 * quebraria ao ler `r.usuario.perfil` de um objeto que não tem `usuario`.
 */
export function desviouParaRevendedor(r: unknown): boolean {
  const resp = r as { token?: string; perfil?: string };
  if (resp?.perfil !== 'revendedor' || !resp.token) return false;
  salvarSessao(resp.token, { id: 0, nome: '', email: '', perfil: 'revendedor' } as unknown as UsuarioSessao, 'revendedor');
  window.location.assign('/revenda');
  return true;
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

/**
 * Quando a loja TEM domínio próprio, "Entrar como lojista" precisa abrir a
 * aba LÁ, não no domínio do admin — senão a URL na barra de endereço mostra a
 * plataforma em vez da marca do cliente (os dados carregam certos mesmo assim,
 * porque o JWT leva o tenant; só a URL fica errada). Só que localStorage é
 * por origem, então gravar a sessão aqui não ajudaria uma aba aberta noutro
 * domínio — por isso o token viaja no FRAGMENTO da URL de destino em vez de ir
 * pro localStorage local. Mesma razão do repasse do 2FA (ver lib/repasse-2fa.ts):
 * fragmento não é enviado ao servidor, não aparece em log de acesso nem em
 * Referer, e a página de chegada consome e apaga da URL.
 *
 * `redirecionar` null (sem domínio próprio nem DOMINIO_BASE) ou apontando pro
 * domínio que já está aberto: devolve null, e quem chamou segue com
 * `abrirSessaoLojistaImpersonada` normal (mesma origem).
 */
export function destinoImpersonacao(redirecionar: string | null | undefined, token: string): string | null {
  if (!redirecionar) return null;
  let origem: string;
  try { origem = new URL(redirecionar).origin; } catch { return null; }
  if (origem === window.location.origin) return null;
  return `${redirecionar.replace(/\/+$/, '')}/lojista#sessao=${encodeURIComponent(token)}`;
}

/**
 * "ENTRAR COMO LOJISTA" INTEIRO, num lugar só.
 *
 * Existia três vezes copiado (admin/tenants, admin/lojas, admin/loja-detalhe) e
 * as três cópias tinham o MESMO defeito, que é o motivo desta função existir:
 *
 *   window.open(destino, '_blank');   // ← e o retorno nunca era olhado
 *
 * `window.open` só abre aba enquanto vale a ATIVAÇÃO do clique, e ela é curta.
 * A chamada vinha depois de um `await fetch` (às vezes dois), então o navegador
 * bloqueava a aba e devolvia `null` — sem lançar erro. Resultado na tela: nada.
 * Nenhum aviso, nenhum toast, e o botão pronto para ser clicado de novo.
 * Medido em produção: seis tokens emitidos e registrados na auditoria, quatro
 * deles em onze minutos, todos do mesmo admin — a assinatura de alguém clicando
 * repetidamente numa coisa que não responde.
 *
 * O CONSERTO É ABRIR A ABA NO CLIQUE, antes de qualquer espera, e só depois
 * mandá-la para o destino. A aba em branco existe durante a requisição, que é
 * rápida; se der erro, ela é fechada.
 *
 * E QUANDO NEM ASSIM ABRIR — o navegador pode ter bloqueio total de pop-up para
 * o site —, isto AVISA e navega na própria aba, em vez de continuar sem dizer
 * nada. Perder a página do admin é pior que uma aba nova; ficar sem resposta é
 * pior que os dois.
 */
export async function entrarComoLojista(
  /* `number | string` porque um dos chamadores tira o id da query string da
     URL e ele chega texto. Converter aqui com `Number` trocaria um id
     inesperado por `NaN`, que viraria uma URL sem sentido; passando adiante, é
     o servidor que valida e responde 400 com mensagem. */
  tenantId: number | string,
  opcoes: { avisar?: (mensagem: string) => void } = {},
): Promise<void> {
  /* PRIMEIRA COISA, ainda dentro do clique: pedir a aba. Qualquer `await` antes
     daqui é o bug de volta. */
  const aba = window.open('about:blank', '_blank');

  let corpo: { token?: string; redirecionar?: string | null; erro?: string };
  try {
    const token = tokenSessao();
    const resp = await fetch(`/api/admin/tenants/${tenantId}/impersonar`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(corpo.erro || `Falha ao entrar (HTTP ${resp.status}).`);
    if (!corpo.token) throw new Error('O servidor não devolveu a sessão de lojista.');
  } catch (e) {
    /* Aba em branco sem destino é lixo na cara do usuário. */
    aba?.close();
    throw e;
  }

  /*
   * Loja em OUTRO domínio: o token viaja no fragmento, porque localStorage não
   * atravessa origem. Mesmo domínio: grava a sessão aqui, que a aba nova lê.
   */
  const destino = destinoImpersonacao(corpo.redirecionar, corpo.token);
  if (!destino) {
    try {
      await abrirSessaoLojistaImpersonada(corpo.token);
    } catch (e) {
      aba?.close();
      throw e;
    }
  }
  const url = destino ?? '/lojista';

  if (aba) {
    /* `replace` e não `href`: a aba em branco não merece uma entrada no
       histórico de volta. */
    aba.location.replace(url);
    /*
     * E TRAZ A ABA PARA A FRENTE, com aviso na tela de onde ela foi.
     *
     * Sem isto, o pior caso é indistinguível de falha: a aba abre atrás, a tela
     * do admin não muda, e quem clicou conclui que nada aconteceu — e clica de
     * novo. Foi medido: nove emissões de token na auditoria, em pares separados
     * por segundos, e um painel que tinha carregado direito numa aba que a
     * pessoa não estava olhando.
     */
    aba.focus();
    opcoes.avisar?.('Abri o painel do lojista numa aba nova.');
    return;
  }
  /*
   * Pop-up bloqueado de verdade. Não dá para abrir aba nenhuma, então a escolha
   * é avisar e ir na própria aba — nunca sumir em silêncio, que era o defeito.
   */
  opcoes.avisar?.('O navegador bloqueou a aba nova. Abrindo o painel nesta aba.');
  window.location.assign(url);
}

/** Lê (e consome) o token de sessão impersonada vindo no fragmento da URL — ver destinoImpersonacao. */
export function lerRepasseImpersonacao(): string | null {
  if (!window.location.hash.startsWith('#')) return null;
  const p = new URLSearchParams(window.location.hash.slice(1));
  const token = p.get('sessao');
  if (!token) return null;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return token;
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
 * O modo demo vale em toda a área CLIENTE e é ignorado — e apagado — nas
 * outras áreas, pra uma sessionStorage esquecida nunca desviar chamadas reais
 * de lojista/entregador/cozinha/admin pro tenant de demonstração.
 *
 * A regra é por EXCLUSÃO (o que NÃO é área cliente) de propósito: a loja mora
 * em "/:slug" desde que a URL perdeu o prefixo /loja/, então qualquer caminho
 * de um segmento pode ser uma loja e não dá mais pra listar as rotas de
 * cliente. A lista antiga ainda citava "/loja" e, por isso, o redirect de
 * /demo/:slug pro storefront caía fora dela: o flag era apagado no meio do
 * caminho, a chamada seguinte ia pro tenant master e voltava 404.
 */
export function tenantDemoAtivo(): string | null {
  const slug = sessionStorage.getItem(CHAVE_TENANT_DEMO);
  if (!slug) return null;
  if (areaAtual() !== 'cliente') { sessionStorage.removeItem(CHAVE_TENANT_DEMO); return null; }
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

  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      method: metodo,
      headers: cabecalhos,
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    // Falha de transporte (ver ApiError.semRede). A mensagem já sai pronta pra
    // mostrar: distingue "o aparelho está sem internet" de "a internet está aí,
    // o servidor é que não respondeu" — são ações diferentes pra quem lê.
    throw new ApiError(0, navigator.onLine
      ? 'Não conseguimos falar com o servidor. Tente de novo em alguns instantes.'
      : 'Você está sem internet. Verifique a conexão e tente de novo.');
  }

  let dados: any = {};
  try { dados = await resposta.json(); } catch { /* sem corpo */ }

  if (!resposta.ok) {
    if (resposta.status === 401) encerrarSessao();
    throw new ApiError(resposta.status, dados.erro || 'Erro de comunicação com o servidor.');
  }
  return dados as T;
}
