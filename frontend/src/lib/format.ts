/** Formatadores de moeda e data em pt-BR. */

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos (inteiro) → "R$ 12,34". */
export function brl(centavos: number | null | undefined): string {
  return fmtBRL.format((centavos || 0) / 100);
}

/** Data ISO UTC → "12/06/2026, 14:30" no fuso do usuário. */
export function dataLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Apenas a hora (HH:mm). */
export function horaLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Posição de GPS velha demais para representar onde o entregador está agora.
 *
 * O app do entregador reenvia a posição a cada 25s mesmo parado (heartbeat), então
 * mais de 2 min de silêncio significa app em segundo plano, sem sinal ou GPS
 * desligado — e não "o entregador ficou parado".
 */
export function posicaoAtrasada(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() > 120_000;
}

/** "há 5 minutos", "agora mesmo" etc. */
export function tempoRelativo(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const segundos = Math.round(diff / 1000);
  if (segundos < 60) return 'agora mesmo';
  const min = Math.round(segundos / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return dataLocal(iso);
}
