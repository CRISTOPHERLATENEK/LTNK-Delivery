/**
 * Tamanho da logo, escolhido pelo lojista numa barra de 0 a 100.
 *
 * A MESMA escala vale para todas as superfícies (login, cabeçalho do painel,
 * landing, celular), cada uma com a sua altura base. É por isso que o valor é
 * um MULTIPLICADOR e não uma altura em pixels: uma altura fixa igualaria a logo
 * do cabeçalho de 44px com a da landing de 56px, apagando a diferença que
 * existe de propósito — o cabeçalho tem 56px de altura total, a landing tem a
 * tela inteira.
 *
 * 50 é o padrão e vale exatamente 1×, então quem nunca mexer na barra continua
 * vendo o tamanho de sempre. Daí para baixo chega à metade, para cima ao dobro.
 * Duas retas em vez de uma só justamente para o meio da barra cair no 1× —
 * numa reta única de 0,5× a 2×, o meio daria 1,25× e o padrão ficaria num
 * número quebrado que ninguém acerta arrastando.
 */

/** Valor da barra que representa o tamanho original. */
export const ESCALA_PADRAO = 50;

/** Converte a posição da barra (0-100) no multiplicador de altura (0,5×-2×). */
export function fatorDaEscala(escala: number | string | null | undefined): number {
  /*
   * Ausente cai no PADRÃO, não no zero da barra. `Number(null)` é 0, e 0 é um
   * valor válido da barra — sem este desvio, todo lojista que nunca mexeu na
   * configuração veria a logo encolher pela metade.
   */
  if (escala === null || escala === undefined || escala === '') return 1;
  const n = Number(escala);
  // Texto ou NaN também cai no padrão: um dado torto no banco não pode apagar
  // a marca do lojista.
  if (!Number.isFinite(n)) return 1;
  const v = Math.min(100, Math.max(0, n));
  return v <= ESCALA_PADRAO
    ? 0.5 + (v / ESCALA_PADRAO) * 0.5
    : 1 + ((v - ESCALA_PADRAO) / ESCALA_PADRAO);
}

/**
 * Altura final em px, arredondada.
 *
 * `basePx` é o tamanho daquela superfície com a barra no padrão.
 */
export function alturaLogo(basePx: number, escala: number | string | null | undefined): number {
  return Math.round(basePx * fatorDaEscala(escala));
}
