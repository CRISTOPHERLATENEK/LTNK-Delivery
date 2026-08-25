import { describe, it, expect } from 'vitest';
import { agregarEstoque, type LinhaCarrinho, type ComponenteCombo } from './estoque-combo';

const info = (nome: string, estoque?: number | null) => ({
  nome, controla_estoque: estoque === undefined ? 0 : 1, estoque: estoque ?? null,
});

const COMBO = 100, GIGANTE = 1, BROTO = 2, ARTESANAL = 3;

const linha = (produtoId: number, quantidade: number, i = info('x')): LinhaCarrinho =>
  ({ produtoId, quantidade, info: i });

const comp = (combo_id: number, produto_id: number, nome: string, estoque: number | null = 10): ComponenteCombo =>
  ({ combo_id, produto_id, nome, controla_estoque: 1, estoque });

describe('agregarEstoque', () => {
  it('produto comum: sai o que foi pedido', () => {
    const { qtd } = agregarEstoque([linha(ARTESANAL, 2, info('Artesanal', 5))], []);
    expect(qtd.get(ARTESANAL)).toBe(2);
  });

  it('mesmo produto em duas linhas soma (opções diferentes)', () => {
    const { qtd } = agregarEstoque(
      [linha(ARTESANAL, 2, info('Artesanal', 5)), linha(ARTESANAL, 3, info('Artesanal', 5))], []);
    expect(qtd.get(ARTESANAL)).toBe(5);
  });

  it('combo baixa os componentes junto', () => {
    const { qtd } = agregarEstoque(
      [linha(COMBO, 1, info('Combo Duas Pizzas'))],
      [comp(COMBO, GIGANTE, 'Gigante'), comp(COMBO, BROTO, 'Broto')]);
    expect(qtd.get(COMBO)).toBe(1);
    expect(qtd.get(GIGANTE)).toBe(1);
    expect(qtd.get(BROTO)).toBe(1);
  });

  /*
   * O CASO QUE ERRA EM SILÊNCIO. "2× Pizza Artesanal" são DOIS slots do mesmo
   * produto — duas linhas em `combo_itens`. Deduplicar por produto (um `Set`,
   * um `Map` de slot) faria o combo consumir uma pizza e entregar duas.
   */
  it('dois slots do mesmo produto consomem duas unidades', () => {
    const { qtd } = agregarEstoque(
      [linha(COMBO, 1, info('Combo 2 Pizzas Iguais'))],
      [comp(COMBO, ARTESANAL, 'Artesanal'), comp(COMBO, ARTESANAL, 'Artesanal')]);
    expect(qtd.get(ARTESANAL)).toBe(2);
  });

  it('a quantidade do combo multiplica os componentes', () => {
    const { qtd } = agregarEstoque(
      [linha(COMBO, 3, info('Combo'))],
      [comp(COMBO, ARTESANAL, 'Artesanal'), comp(COMBO, ARTESANAL, 'Artesanal')]);
    expect(qtd.get(COMBO)).toBe(3);
    expect(qtd.get(ARTESANAL)).toBe(6);
  });

  /* Pizza avulsa E dentro do combo no mesmo pedido: as duas somam, e o `info`
     fica com o da linha do carrinho, que é a fonte completa. */
  it('avulso e dentro do combo somam no mesmo produto', () => {
    const { qtd, info: mapa } = agregarEstoque(
      [linha(ARTESANAL, 2, info('Pizza Artesanal', 9)), linha(COMBO, 1, info('Combo'))],
      [comp(COMBO, ARTESANAL, 'Artesanal', 9)]);
    expect(qtd.get(ARTESANAL)).toBe(3);
    expect(mapa.get(ARTESANAL)!.estoque).toBe(9);
  });

  it('componentes de combos diferentes não se misturam', () => {
    const { qtd } = agregarEstoque(
      [linha(COMBO, 1, info('Combo A'))],
      [comp(COMBO, GIGANTE, 'Gigante'), comp(999, BROTO, 'Broto de outro combo')]);
    expect(qtd.get(GIGANTE)).toBe(1);
    expect(qtd.has(BROTO)).toBe(false);
  });

  it('guarda de qual combo veio o componente, pra mensagem de erro', () => {
    const { dentroDeCombo } = agregarEstoque(
      [linha(COMBO, 1, info('Combo Duas Pizzas'))], [comp(COMBO, BROTO, 'Broto')]);
    expect(dentroDeCombo.get(BROTO)).toBe('Combo Duas Pizzas');
    expect(dentroDeCombo.has(COMBO)).toBe(false);
  });

  it('carrinho sem combo não muda nada', () => {
    const { qtd, dentroDeCombo } = agregarEstoque([linha(ARTESANAL, 1, info('Artesanal', 5))], []);
    expect([...qtd]).toEqual([[ARTESANAL, 1]]);
    expect(dentroDeCombo.size).toBe(0);
  });
});
