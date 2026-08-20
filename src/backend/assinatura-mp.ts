/**
 * Assinatura do webhook do Mercado Pago (cabeçalho `x-signature`).
 *
 * POR QUE ISTO É UM MÓDULO SEPARADO, E COM TESTE.
 *
 * Hoje a validação é opt-in: sem `MERCADOPAGO_WEBHOOK_SECRET` (ou o segredo da
 * loja), tudo passa. Isso não é um buraco, porque o status do pagamento é SEMPRE
 * reconsultado na API do MP antes de valer — notificação forjada não marca pedido
 * como pago.
 *
 * O risco de verdade está no outro lado do interruptor: **no minuto em que o
 * segredo é configurado, um manifest errado passa a rejeitar TODAS as
 * notificações legítimas** — e aí pedido pago para de ser confirmado, em
 * silêncio, com um `console.warn` que ninguém está lendo. É uma falha muito pior
 * que a atual, e ela só aparece em produção, com dinheiro real.
 *
 * Por isso o formato do manifest está travado por teste com vetor fixo
 * (assinatura-mp.test.ts): se alguém mudar a ordem dos campos, o separador, o
 * `;` final ou o lowercase, o teste quebra antes de o pagamento quebrar.
 *
 * O TEMPLATE (confere com a documentação do MP):
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts do x-signature>;
 * HMAC-SHA256 do manifest com o segredo, em hex minúsculo, comparado com `v1`.
 */
import crypto from 'crypto';

export interface ParteAssinatura {
  ts: string;
  v1: string;
}

/**
 * Quebra `ts=1704908010,v1=618c...` nas partes.
 *
 * `indexOf` em vez de `split('=')`: hex não tem `=`, mas se o MP algum dia
 * incluir um valor em base64 (que termina em `=`), `split` cortaria no lugar
 * errado e a assinatura passaria a falhar sem motivo aparente.
 */
export function lerCabecalhoAssinatura(cabecalho: string): ParteAssinatura | null {
  const partes: Record<string, string> = {};
  for (const par of cabecalho.split(',')) {
    const bruto = par.trim();
    const i = bruto.indexOf('=');
    if (i <= 0) continue;
    partes[bruto.slice(0, i)] = bruto.slice(i + 1);
  }
  if (!partes.ts || !partes.v1) return null;
  return { ts: partes.ts, v1: partes.v1 };
}

/**
 * O manifest que entra no HMAC.
 *
 * `dataId` em minúsculo porque o MP documenta assim quando o id é
 * alfanumérico — e o id de pagamento é numérico, então minusculizar não muda
 * nada nesse caso e cobre o caso alfanumérico de graça.
 */
export function montarManifest(dataId: string, requestId: string, ts: string): string {
  return `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
}

/** Motivo da recusa — o log precisa distinguir "não veio" de "não bate". */
export type MotivoRecusa =
  | 'sem-segredo'
  | 'sem-cabecalho'
  | 'sem-request-id'
  | 'cabecalho-malformado'
  | 'hash-diferente';

export interface ResultadoAssinatura {
  valida: boolean;
  /** Ausente quando `valida` é true. */
  motivo?: MotivoRecusa;
}

/**
 * Confere a assinatura.
 *
 * Devolve o MOTIVO e não só um booleano: às duas da manhã, com o lojista
 * dizendo que o pedido não confirmou, "cabeçalho não veio" e "hash não bate"
 * levam a lugares completamente diferentes — o primeiro é configuração do MP,
 * o segundo é segredo trocado.
 *
 * Sem segredo configurado, devolve `valida: true` com o motivo `sem-segredo`:
 * quem chama decide se isso é "aceita como sempre aceitou" (é o comportamento
 * hoje, mitigado pela reconsulta na API) ou se um dia passa a recusar.
 */
export function conferirAssinatura(entrada: {
  cabecalho: unknown;
  requestId: unknown;
  dataId: string;
  secret: string | null;
}): ResultadoAssinatura {
  const { cabecalho, requestId, dataId, secret } = entrada;
  if (!secret) return { valida: true, motivo: 'sem-segredo' };
  if (typeof cabecalho !== 'string' || !cabecalho) return { valida: false, motivo: 'sem-cabecalho' };
  if (typeof requestId !== 'string' || !requestId) return { valida: false, motivo: 'sem-request-id' };

  const partes = lerCabecalhoAssinatura(cabecalho);
  if (!partes) return { valida: false, motivo: 'cabecalho-malformado' };

  const esperado = crypto
    .createHmac('sha256', secret)
    .update(montarManifest(dataId, requestId, partes.ts))
    .digest('hex');

  /*
   * `timingSafeEqual` exige buffers do mesmo tamanho, e ele LANÇA quando os
   * tamanhos diferem — daí a checagem de comprimento antes. Comparar o
   * comprimento primeiro não vaza nada útil: o tamanho de um SHA-256 em hex é
   * público (64 caracteres).
   */
  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(partes.v1, 'utf8');
  if (a.length !== b.length) return { valida: false, motivo: 'hash-diferente' };
  return crypto.timingSafeEqual(a, b)
    ? { valida: true }
    : { valida: false, motivo: 'hash-diferente' };
}
