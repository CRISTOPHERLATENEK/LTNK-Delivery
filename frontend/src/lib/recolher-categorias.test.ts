import { describe, it, expect } from 'vitest';
import { comecarRecolhido, LIMITE_RECOLHER } from './recolher-categorias';

/*
 * CATEGORIA RECOLHIDA NA VITRINE — "igual ao cadastro de produto".
 *
 * O pedido do lojista foi literal: clicar na categoria e ela abrir os produtos,
 * "senão vai ficar ruim de ver tudo", e igual ao que o cadastro já faz. Então o
 * que este arquivo protege não é o desenho da faixa: é a regra ser UMA, usada
 * pelas duas telas. Duas cópias do mesmo `150` divergem na primeira vez que
 * alguém mexe numa delas, e aí "igual ao cadastro" deixa de ser verdade sem
 * ninguém perceber.
 *
 * OS NÚMEROS SÃO DAS LOJAS REAIS, medidos em 10/09/2026 (só itens à venda):
 *   Galderio Bebidas ... 458 em 13 categorias, a maior com 60  -> recolhido
 *   Mostruário .........  36                                   -> aberto
 */

/*
 * SO A REGRA MORA AQUI. As asercoes que LEEM o fonte das duas telas ficam em
 * `src/backend/vitrine-categoria-recolhida.test.ts`: o `tsconfig` do frontend
 * nao tem os tipos do Node, e um `import fs` neste arquivo quebra o BUILD da
 * vitrine — o teste passava e o site nao compilava.
 */

describe('a decisão de recolher', () => {
  it('catálogo grande começa recolhido, pequeno começa aberto', () => {
    expect(comecarRecolhido(458)).toBe(true);     /* Galderio */
    expect(comecarRecolhido(36)).toBe(false);     /* Mostruário */
  });

  /*
   * O LIMITE NÃO É ZERO. Recolher cardápio de 20 itens cobra um toque a mais
   * para esconder o que já caberia na tela — a loja perde a vitrine e não ganha
   * nada em troca. O corte existe justamente para separar os dois casos.
   */
  it('nada é recolhido num cardápio que caberia na tela', () => {
    expect(comecarRecolhido(0)).toBe(false);
    expect(comecarRecolhido(20)).toBe(false);
    expect(comecarRecolhido(LIMITE_RECOLHER)).toBe(false);
    expect(comecarRecolhido(LIMITE_RECOLHER + 1)).toBe(true);
  });
});
