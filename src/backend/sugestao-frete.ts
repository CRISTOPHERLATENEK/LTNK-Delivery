/**
 * Sugestão de taxa de entrega a partir da distância.
 *
 * É SUGESTÃO, não cálculo automático: quem cobra é o lojista, que sabe do
 * combustível, do trânsito e do que o concorrente cobra. O que o sistema
 * entrega de valioso aqui é a DISTÂNCIA — o número que ninguém tem de cabeça
 * ao cadastrar um bairro. O preço é um ponto de partida editável.
 *
 * Os parâmetros são explícitos e visíveis na tela de propósito: taxa sugerida
 * sem mostrar a conta vira número mágico, e ninguém confia em número mágico
 * pra decidir preço.
 */

/** Até aqui, paga só a base — bairro vizinho não é entrega "longa". */
export const KM_BASE = 2;
/** Base cobrada dentro do raio acima. */
export const BASE_CENTAVOS = 500;
/** Acréscimo por km que passar da base. */
export const POR_KM_CENTAVOS = 150;

/** Arredonda pra cima em múltiplos de 50 centavos — preço de entrega é redondo. */
function arredondar(centavos: number): number {
  return Math.ceil(centavos / 50) * 50;
}

/**
 * Quanto sugerir para uma entrega de `km` quilômetros.
 *
 * Distância em LINHA RETA, não por rua: o cálculo vem de coordenadas, e a rota
 * real é sempre maior. Por isso a sugestão erra pra baixo em cidade com rio,
 * morro ou avenida de mão única — e por isso ela é editável.
 */
export function sugerirFreteCentavos(km: number): number {
  if (!Number.isFinite(km) || km < 0) return BASE_CENTAVOS;
  if (km <= KM_BASE) return BASE_CENTAVOS;
  return arredondar(BASE_CENTAVOS + (km - KM_BASE) * POR_KM_CENTAVOS);
}

/** A conta em palavras, pra tela mostrar em vez de só cuspir um número. */
export function explicarSugestao(km: number): string {
  if (km <= KM_BASE) {
    return `Até ${KM_BASE} km é só a base de R$ ${(BASE_CENTAVOS / 100).toFixed(2).replace('.', ',')}.`;
  }
  const extras = km - KM_BASE;
  return `R$ ${(BASE_CENTAVOS / 100).toFixed(2).replace('.', ',')} de base + `
    + `${extras.toFixed(1).replace('.', ',')} km × R$ ${(POR_KM_CENTAVOS / 100).toFixed(2).replace('.', ',')}`;
}
