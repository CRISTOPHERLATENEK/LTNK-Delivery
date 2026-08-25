import { describe, it, expect } from 'vitest';
import { reordenar } from './ordem-cardapio';

const L = ['Bebidas', 'Combos', 'Lanches', 'Pizzas'];

describe('reordenar', () => {
  it('leva pra primeira fileira', () => {
    expect(reordenar(L, 'Pizzas', 1)).toEqual(['Pizzas', 'Bebidas', 'Combos', 'Lanches']);
  });

  /* O caso que o cálculo ingênuo erra: mover PRA BAIXO. Tirar o item desloca
     quem vem depois, e sem remover antes o alvo pousa uma casa acima. */
  it('mover pra baixo pousa na fileira pedida, não uma acima', () => {
    expect(reordenar(L, 'Bebidas', 3)).toEqual(['Combos', 'Lanches', 'Bebidas', 'Pizzas']);
    expect(reordenar(L, 'Bebidas', 4)).toEqual(['Combos', 'Lanches', 'Pizzas', 'Bebidas']);
  });

  it('mover pra cima também', () => {
    expect(reordenar(L, 'Lanches', 2)).toEqual(['Bebidas', 'Lanches', 'Combos', 'Pizzas']);
  });

  it('ficar onde já está não mexe em nada', () => {
    expect(reordenar(L, 'Combos', 2)).toEqual(L);
  });

  it('posição fora do intervalo grampeia no extremo, sem perder ninguém', () => {
    expect(reordenar(L, 'Pizzas', 0)).toEqual(['Pizzas', 'Bebidas', 'Combos', 'Lanches']);
    expect(reordenar(L, 'Pizzas', -7)).toEqual(['Pizzas', 'Bebidas', 'Combos', 'Lanches']);
    expect(reordenar(L, 'Bebidas', 99)).toEqual(['Combos', 'Lanches', 'Pizzas', 'Bebidas']);
    expect(reordenar(L, 'Bebidas', 99)).toHaveLength(L.length);
  });

  /* Subcategoria criada no mesmo formulário em que a posição é escolhida: ela
     ainda não existe na lista e precisa ENTRAR, não ser ignorada. */
  it('nome ausente é inserido na posição', () => {
    expect(reordenar(L, 'Doces', 2)).toEqual(['Bebidas', 'Doces', 'Combos', 'Lanches', 'Pizzas']);
    expect(reordenar([], 'Doces', 1)).toEqual(['Doces']);
  });

  it('não muda a lista recebida', () => {
    const orig = [...L];
    reordenar(L, 'Pizzas', 1);
    expect(L).toEqual(orig);
  });
});
