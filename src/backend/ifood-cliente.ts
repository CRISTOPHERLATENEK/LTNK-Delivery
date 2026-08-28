/**
 * CLIENTE HTTP DO IFOOD.
 *
 * `fetch` injetável, como no Smart TEF, e pelo mesmo motivo: o que precisa ser
 * provado aqui é o caminho ruim — token vencido, 429, 403 de merchant sem
 * permissão — e nada disso se reproduz esperando o iFood colaborar.
 *
 * A diferença para o TEF é o TOKEN. Lá cada chamada leva a credencial pronta.
 * Aqui existe um token OAuth de 6 horas que precisa ser guardado e renovado, e
 * é aí que mora o erro caro: pedir token a cada requisição, com polling a cada
 * 30 segundos e N lojas, é como se chega no 429 e no bloqueio.
 */
import { lotesDeMerchants, type EventoIfood } from './ifood-protocolo';

export const BASE_IFOOD = 'https://merchant-api.ifood.com.br';

export interface CredenciaisIfood {
  clientId: string;
  clientSecret: string;
}

export interface OpcoesIfood {
  buscar?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

export class ErroIfood extends Error {
  constructor(
    mensagem: string,
    readonly httpStatus: number,
    /** Merchants que o token não pode ver (403). Ver `pollingEventos`. */
    readonly merchantsSemPermissao: string[] = [],
  ) {
    super(mensagem);
    this.name = 'ErroIfood';
  }
}

/* ─────────────────────────── token ─────────────────────────── */

interface TokenGuardado { token: string; expiraEm: number }

/*
 * Cache em memória, por clientId.
 *
 * Não é otimização: o token vale 6 horas e o polling roda a cada 30 segundos.
 * Pedir um token por ciclo seria trocar 1 requisição de autenticação por dia
 * por 2.880 — e o rate limit é por token, então cada renovação desnecessária
 * também joga fora o token anterior que ainda estava bom.
 *
 * Morre quando o processo morre, e tudo bem: o pior caso é uma autenticação a
 * mais depois de um deploy.
 */
const tokens = new Map<string, TokenGuardado>();

/** Só para os testes: começa do zero. */
export function limparTokensIfood(): void {
  tokens.clear();
}

/**
 * Devolve um token válido, renovando quando necessário.
 *
 * A MARGEM DE 5 MINUTOS não é folga arbitrária. Sem ela, um token que expira
 * "daqui a 2 segundos" passa na verificação e vence no meio da requisição
 * seguinte — o 401 chega quando já não dá para distinguir de credencial errada,
 * e o ciclo de polling se perde por um problema de relógio.
 */
export async function tokenDeAcesso(
  cred: CredenciaisIfood,
  opcoes: OpcoesIfood = {},
): Promise<string> {
  const agora = Date.now();
  const guardado = tokens.get(cred.clientId);
  if (guardado && guardado.expiraEm > agora + 5 * 60_000) return guardado.token;

  const buscar = opcoes.buscar ?? fetch;
  const base = opcoes.baseUrl ?? BASE_IFOOD;

  /*
   * `application/x-www-form-urlencoded`, não JSON — a doc é explícita, e o
   * nome dos campos é camelCase (`grantType`, `clientId`), fora do costume do
   * OAuth. Mandar `grant_type` aqui dá 401 sem dizer o motivo.
   */
  const corpo = new URLSearchParams({
    grantType: 'client_credentials',
    clientId: cred.clientId,
    clientSecret: cred.clientSecret,
  });

  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), opcoes.timeoutMs ?? 15_000);
  let resp: Response;
  try {
    resp = await buscar(`${base}/authentication/v1.0/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo.toString(),
      signal: controlador.signal,
    });
  } catch {
    throw new ErroIfood('O iFood não respondeu à autenticação.', 0);
  } finally {
    clearTimeout(timer);
  }

  let json: Record<string, unknown> = {};
  try { json = (await resp.json()) as Record<string, unknown>; } catch { /* segue com o status */ }

  if (!resp.ok) {
    const erro = (json.error ?? {}) as Record<string, unknown>;
    const msg = String(erro.message ?? '').trim();
    throw new ErroIfood(
      msg || (resp.status === 401
        ? 'O iFood recusou as credenciais do aplicativo.'
        : 'Falha ao autenticar no iFood.'),
      resp.status,
    );
  }

  const token = String(json.accessToken ?? '').trim();
  const segundos = Number(json.expiresIn);
  if (!token) throw new ErroIfood('O iFood autenticou mas não devolveu token.', 0);

  /*
   * `expiresIn` ausente ou absurdo vira 6h — o padrão documentado. Confiar num
   * NaN faria `expiraEm` virar NaN, e toda comparação com NaN é falsa: o token
   * seria renovado a cada chamada, silenciosamente, até bater no rate limit.
   */
  const ttl = Number.isFinite(segundos) && segundos > 0 ? segundos : 21600;
  tokens.set(cred.clientId, { token, expiraEm: agora + ttl * 1000 });
  return token;
}

/* ─────────────────────────── chamadas ─────────────────────────── */

async function chamar(
  cred: CredenciaisIfood,
  caminho: string,
  init: RequestInit & { headers?: Record<string, string> },
  opcoes: OpcoesIfood = {},
): Promise<{ status: number; corpo: unknown }> {
  const buscar = opcoes.buscar ?? fetch;
  const base = opcoes.baseUrl ?? BASE_IFOOD;
  const token = await tokenDeAcesso(cred, opcoes);

  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), opcoes.timeoutMs ?? 15_000);
  let resp: Response;
  try {
    resp = await buscar(`${base}${caminho}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      signal: controlador.signal,
    });
  } catch {
    throw new ErroIfood('O iFood não respondeu.', 0);
  } finally {
    clearTimeout(timer);
  }

  let corpo: unknown = null;
  try { corpo = await resp.json(); } catch { corpo = null; }

  if (resp.status === 403) {
    /*
     * 403 devolve `unauthorizedMerchants` — e isso é acionável, não fatal: a
     * doc manda repetir sem essas lojas. Perder essa lista transformaria "uma
     * loja revogou o acesso" em "o polling inteiro parou", derrubando todas as
     * outras junto.
     */
    const d = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
    const lista = Array.isArray(d.unauthorizedMerchants) ? d.unauthorizedMerchants.map(String) : [];
    throw new ErroIfood('O iFood recusou o acesso a uma ou mais lojas.', 403, lista);
  }

  if (!resp.ok) {
    const d = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
    const msg = String(d.message ?? (d.error as Record<string, unknown>)?.message ?? '').trim();
    throw new ErroIfood(msg || `O iFood respondeu ${resp.status}.`, resp.status);
  }

  return { status: resp.status, corpo };
}

/**
 * Busca eventos novos de um lote de lojas.
 *
 * `204` significa "nada novo" e é a resposta MAIS COMUM — a cada 30 segundos,
 * na maior parte do dia, não há pedido. Devolve lista vazia, não erro.
 *
 * O `x-polling-merchants` é obrigatório aqui, mesmo com poucas lojas. A doc
 * recomenda para aplicativos centralizados, que é o nosso caso, e evita
 * descobrir o limite de 100 no dia em que a plataforma crescer.
 */
export async function pollingEventos(
  cred: CredenciaisIfood,
  merchantIds: readonly string[],
  opcoes?: OpcoesIfood,
): Promise<EventoIfood[]> {
  if (merchantIds.length === 0) return [];
  if (merchantIds.length > 100) {
    throw new Error('pollingEventos recebe no máximo 100 merchants — use lotesDeMerchants');
  }

  const { status, corpo } = await chamar(cred, '/events/v1.0/events:polling', {
    method: 'GET',
    headers: { 'x-polling-merchants': merchantIds.join(',') },
  }, opcoes);

  if (status === 204) return [];
  return Array.isArray(corpo) ? (corpo as EventoIfood[]) : [];
}

/** Faz o polling de todas as lojas, em lotes de 100, em série. */
export async function pollingTodasAsLojas(
  cred: CredenciaisIfood,
  merchantIds: readonly string[],
  opcoes?: OpcoesIfood,
): Promise<EventoIfood[]> {
  const todos: EventoIfood[] = [];
  /*
   * EM SÉRIE, não em paralelo. A doc manda "agrupe as requisições
   * sequencialmente dentro do mesmo ciclo de 30 segundos" — disparar todos os
   * lotes juntos é como uma plataforma com muitas lojas encosta no limite de
   * 6000 RPM e leva bloqueio.
   */
  for (const lote of lotesDeMerchants(merchantIds)) {
    todos.push(...await pollingEventos(cred, lote, opcoes));
  }
  return todos;
}

/**
 * Confirma os eventos recebidos.
 *
 * Só chame DEPOIS de ter gravado — a doc é explícita: "Envie o ACK somente após
 * garantir que armazenou o evento com segurança". ACK e queda no mesmo segundo
 * é pedido perdido para sempre, com o cliente esperando.
 */
export async function confirmarEventos(
  cred: CredenciaisIfood,
  ids: readonly string[],
  opcoes?: OpcoesIfood,
): Promise<void> {
  if (ids.length === 0) return;
  if (ids.length > 2000) {
    throw new Error('confirmarEventos recebe no máximo 2000 ids — use lotesDeAck');
  }
  await chamar(cred, '/events/v1.0/events/acknowledgment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ids.map(id => ({ id }))),
  }, opcoes);
}

/** Detalhes do pedido: itens, valores, endereço, pagamento. */
export async function buscarPedido(
  cred: CredenciaisIfood,
  orderId: string,
  opcoes?: OpcoesIfood,
): Promise<Record<string, unknown>> {
  const { corpo } = await chamar(
    cred, `/order/v1.0/orders/${encodeURIComponent(orderId)}`, { method: 'GET' }, opcoes,
  );
  return (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
}

/** As credenciais da plataforma. Vazias quando o iFood não foi configurado. */
export function credenciaisDoAmbiente(): CredenciaisIfood | null {
  const clientId = (process.env.IFOOD_CLIENT_ID || '').trim();
  const clientSecret = (process.env.IFOOD_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}
