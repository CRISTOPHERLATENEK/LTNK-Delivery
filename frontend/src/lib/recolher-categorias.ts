/**
 * QUANDO A CATEGORIA COMEÇA RECOLHIDA — a mesma regra na vitrine e no cadastro.
 *
 * POR QUE ISSO É UM MÓDULO, e não um número em cada tela. O lojista pediu que a
 * vitrine ficasse "igual ao cadastro de produto": clicar na categoria e ela
 * abrir, senão fica ruim de ver tudo. O cadastro já fazia isso com um `150`
 * escrito no meio do JSX. Duas telas com o mesmo comportamento e dois números
 * soltos divergem na primeira vez que alguém mexe em um deles — e aí a promessa
 * de "igual ao cadastro" morre sem ninguém perceber.
 *
 * POR QUE 150. É o ponto em que a lista deixa de ser navegável por rolagem: com
 * catálogo pequeno, recolher só cobra um toque a mais para ver o que já caberia
 * na tela. Medido nas lojas reais em 10/09/2026:
 *
 *   Galderio Bebidas ...... 458 itens à venda em 13 categorias  -> recolhido
 *   Mostruário ............  36 itens                           -> aberto
 *
 * A maior categoria da Galderio tem 60 itens, então uma vez aberta ela ainda é
 * uma tela de rolagem — o problema era ter 13 dessas em sequência.
 */
export const LIMITE_RECOLHER = 150;

/** O catálogo é grande o bastante para as categorias começarem fechadas? */
export function comecarRecolhido(totalProdutos: number): boolean {
  return totalProdutos > LIMITE_RECOLHER;
}
