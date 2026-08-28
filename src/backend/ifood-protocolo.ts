/**
 * O PROTOCOLO DE EVENTOS DO IFOOD — regras puras, sem rede.
 *
 * Tudo aqui existe por causa de uma frase da documentação deles. Não são
 * defesas imaginadas: são comportamentos que o iFood AVISA que tem, e que só
 * aparecem em produção, sem erro nenhum, na forma de pedido duplicado ou pedido
 * perdido com o cliente esperando.
 *
 * - "A API pode entregar eventos fora de ordem"        → `ordenarEventos`
 * - "A API pode retornar o mesmo evento mais de uma vez,
 *    incluindo eventos antigos de PLACED"              → `separarNovos`
 * - "Limite: até 2000 IDs por requisição"              → `lotesDeAck`
 * - "máximo 100 merchants por requisição"              → `lotesDeMerchants`
 *
 * O iFood é o ÚNICO caminho de entrada desses pedidos: diferente das
 * reconciliações de Pix e cartão, aqui não existe um segundo ciclo que
 * conserta. Errar não atrasa — perde.
 */

/** Um evento como vem do `GET /events:polling`. */
export interface EventoIfood {
  id: string;
  /** Sigla curta: PLC, CFM, CAN, DSP, CON… */
  code?: string;
  /** Nome longo: PLACED, CONFIRMED, CANCELLED… */
  fullCode?: string;
  orderId?: string;
  merchantId?: string;
  createdAt?: string;
}

/** O que o evento significa para o `pedidos.status` daqui. */
export type AcaoEvento =
  | 'novo'         // chegou pedido — criar
  | 'confirmado'   // alguém confirmou (pode ter sido outro app!)
  | 'preparando'
  | 'pronto'
  | 'despachado'
  | 'concluido'
  | 'cancelado'
  | 'ignorar';     // existe, mas não muda nada aqui

/**
 * Traduz o código do evento.
 *
 * O DESCONHECIDO É `ignorar`, nunca `novo`. Um código que a gente não conhece
 * criando pedido é a pior falha possível: pedido fantasma no painel, cozinha
 * produzindo o que ninguém pediu. Ignorar é seguro — o evento continua sendo
 * confirmado (ACK) e, se for mesmo importante, aparece de novo como PLACED.
 */
export function acaoDoEvento(evento: Pick<EventoIfood, 'code' | 'fullCode'>): AcaoEvento {
  const c = String(evento.code ?? '').trim().toUpperCase();
  const f = String(evento.fullCode ?? '').trim().toUpperCase();

  if (c === 'PLC' || f === 'PLACED') return 'novo';
  if (c === 'CFM' || f === 'CONFIRMED') return 'confirmado';
  if (c === 'SPS' || f === 'SEPARATION_STARTED') return 'preparando';
  if (c === 'RTP' || f === 'READY_TO_PICKUP') return 'pronto';
  if (c === 'DSP' || f === 'DISPATCHED') return 'despachado';
  if (c === 'CON' || f === 'CONCLUDED') return 'concluido';
  /*
   * CAN (cancelado) e CAR (pedido de cancelamento) são coisas diferentes, mas
   * ambos exigem parar de produzir. Tratar CAR como 'ignorar' faria a cozinha
   * seguir montando um pedido que o cliente já desistiu.
   */
  if (c === 'CAN' || f === 'CANCELLED' || c === 'CAR' || f === 'CANCELLATION_REQUESTED') return 'cancelado';

  return 'ignorar';
}

/**
 * Ordena por `createdAt`, do mais antigo para o mais novo.
 *
 * A documentação avisa que os eventos podem vir fora de ordem. Sem isto, um
 * lote com CANCELLED antes de PLACED faria o pedido nascer cancelado — e o
 * lojista veria um cancelamento de algo que nunca apareceu.
 *
 * Evento sem `createdAt` vai para o FIM, não para o começo: sem data não dá
 * para saber quando aconteceu, e aplicar por último é o que menos estraga um
 * estado já construído pelos eventos datados.
 */
export function ordenarEventos<T extends { createdAt?: string }>(eventos: T[]): T[] {
  return [...eventos].sort((a, b) => {
    const ta = Date.parse(a.createdAt ?? '');
    const tb = Date.parse(b.createdAt ?? '');
    const va = Number.isNaN(ta) ? Infinity : ta;
    const vb = Number.isNaN(tb) ? Infinity : tb;
    return va - vb;
  });
}

export interface SeparacaoEventos<T> {
  /** Nunca vistos — processar. */
  novos: T[];
  /** Todos os ids recebidos, novos ou não: TODOS precisam de ACK. */
  idsParaAck: string[];
}

/**
 * Separa o que processar do que só confirmar.
 *
 * Duas regras da documentação que puxam para lados opostos, e é por isso que
 * esta função devolve duas listas em vez de uma:
 *
 * - "Descarte eventos duplicados. Não processe o mesmo evento mais de uma vez."
 * - "Envie acknowledgment mesmo para eventos já processados."
 *
 * Quem só filtra os duplicados e manda ACK do que sobrou vai acumular *strike*
 * por cada repetido não confirmado — e 100 strikes bloqueiam o polling por 5
 * minutos, que é tempo de perder pedido.
 *
 * Evento sem `id` é DESCARTADO dos dois lados: não dá para deduplicar nem para
 * confirmar algo sem identificador, e mandar `undefined` no ACK derrubaria o
 * lote inteiro por payload malformado.
 */
export function separarNovos<T extends { id?: string }>(
  eventos: T[],
  jaVistos: ReadonlySet<string>,
): SeparacaoEventos<T> {
  const novos: T[] = [];
  const idsParaAck: string[] = [];
  /* Duplicado DENTRO do mesmo lote também conta: a doc fala em repetição, e
     nada garante que ela só aconteça entre requisições diferentes. */
  const nesteLote = new Set<string>();

  for (const e of eventos) {
    const id = String(e.id ?? '').trim();
    if (!id) continue;
    if (nesteLote.has(id)) continue;
    nesteLote.add(id);
    idsParaAck.push(id);
    if (!jaVistos.has(id)) novos.push(e);
  }

  return { novos, idsParaAck };
}

/**
 * Quebra os ids de ACK em lotes.
 *
 * 2000 e não 10000 DE PROPÓSITO. A documentação do iFood se contradiz sobre o
 * mesmo endpoint: a seção de acknowledgment diz "Limite: até 2000 IDs por
 * requisição" e a referência da API diz "Máximo 10000 eventos" (413 acima
 * disso). Indo pelo menor, os dois textos estão satisfeitos.
 *
 * Descobrir qual é o certo custaria um 413 em produção — e um 413 aqui não é um
 * erro qualquer: é um lote inteiro sem ACK, virando strike.
 */
export const MAX_ACK_POR_REQUISICAO = 2000;

/** Merchants por requisição de polling. A doc é explícita: máximo 100. */
export const MAX_MERCHANTS_POR_POLLING = 100;

export function emLotes<T>(itens: readonly T[], tamanho: number): T[][] {
  if (tamanho < 1) throw new Error('tamanho de lote inválido');
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

export const lotesDeAck = (ids: readonly string[]) => emLotes(ids, MAX_ACK_POR_REQUISICAO);
export const lotesDeMerchants = (ids: readonly string[]) => emLotes(ids, MAX_MERCHANTS_POR_POLLING);
