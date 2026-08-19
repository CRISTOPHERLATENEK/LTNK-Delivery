/**
 * Quão urgente é um pedido, pelo tempo que ele está esperando.
 *
 * MORA AQUI, e não na tela da cozinha, porque o critério é o MESMO nos dois
 * lugares que mostram pedido em andamento: o KDS e o painel do lojista. Enquanto
 * a função vivia só no KDS, a mesma cozinha via um pedido de 12 minutos em
 * vermelho numa tela e em cinza na outra — e quem estava no balcão não tinha
 * como saber que havia algo atrasado sem olhar o outro monitor.
 *
 * O rótulo é `m:ss` (cronômetro), não "5 min": com granularidade de minuto o
 * número ficava parado por 60s e a tela parecia travada — numa cozinha, ver o
 * tempo correndo é o que cria senso de urgência.
 *
 * As cores são fixas (verde/âmbar/vermelho) de propósito: é semáforo, convenção
 * universal de urgência, não identidade visual da marca. É a única exceção à
 * regra de usar só os tokens do tema, e ela é deliberada.
 */

/** Minutos de espera a partir dos quais o pedido muda de faixa. */
export const MINUTOS_ATENCAO = 5;
export const MINUTOS_ATRASADO = 10;

export interface Urgencia {
  /** Minutos inteiros de espera. */
  min: number;
  /** Cronômetro `m:ss` pra exibição. */
  rotulo: string;
  /** Passou do limite vermelho — a tela pode chamar mais atenção. */
  atrasado: boolean;
  /** Classes de fundo e texto da faixa do cronômetro. */
  faixa: string;
  /** Classe de borda do card. */
  borda: string;
  /** Texto curto pra leitor de tela — o cronômetro sozinho não se lê bem. */
  descricao: string;
}

export function urgenciaPedido(criadoEm: string, agora: number = Date.now()): Urgencia {
  const seg = Math.max(0, Math.floor((agora - new Date(criadoEm).getTime()) / 1000));
  const min = Math.floor(seg / 60);
  const rotulo = `${min}:${String(seg % 60).padStart(2, '0')}`;

  if (min >= MINUTOS_ATRASADO) return {
    min, rotulo, atrasado: true,
    faixa: 'bg-red-500/15 text-red-700 dark:text-red-300',
    borda: 'border-red-500/50',
    descricao: `esperando há ${min} minutos, atrasado`,
  };
  if (min >= MINUTOS_ATENCAO) return {
    min, rotulo, atrasado: false,
    faixa: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    borda: 'border-amber-500/40',
    descricao: `esperando há ${min} minutos`,
  };
  return {
    min, rotulo, atrasado: false,
    faixa: 'bg-green-500/15 text-green-700 dark:text-green-300',
    borda: 'border-green-500/40',
    descricao: min > 0 ? `esperando há ${min} minutos` : 'acabou de chegar',
  };
}
