import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
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

/*
 * O GÊMEO DO FRONTEND NÃO PODE DIVERGIR.
 *
 * `frontend/src/lib/ordem-cardapio.ts` é cópia deliberada: os dois lados não
 * compartilham build, e importar o backend arrastaria ele pro bundle do
 * navegador. O preço da cópia é este teste.
 *
 * A divergência aqui não gera erro nenhum — gera a fileira que o lojista acabou
 * de soltar pulando pra outra posição quando a resposta do servidor chega,
 * porque a prévia otimista calculou uma ordem e o servidor gravou outra.
 */
describe('reordenar não pode divergir do gêmeo do frontend', () => {
  const corpo = (texto: string) => {
    const i = texto.indexOf('export function reordenar');
    if (i < 0) return null;
    return texto.slice(i, texto.indexOf('\n}', i) + 2)
      .split('\n')
      .filter(l => !/^\s*(\/\*|\*|\/\/)/.test(l))   // tira comentário
      .map(l => l.trimEnd())
      .join('\n');
  };
  it('é idêntica nos dois lados', () => {
    const a = corpo(fs.readFileSync(path.resolve(__dirname, 'ordem-cardapio.ts'), 'utf8'));
    const b = corpo(fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'ordem-cardapio.ts'), 'utf8'));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b).toBe(a);
  });
});

/*
 * A ORDENAÇÃO DE PRODUTO TEM DUAS ARMADILHAS QUE O TESTE DE UNIDADE NÃO PEGA,
 * porque vivem no SQL.
 */
describe('rota de ordem — produto', () => {
  const lojista = fs.readFileSync(
    path.resolve(__dirname, 'rotas', 'lojista.ts'), 'utf8');
  const rota = lojista.slice(lojista.indexOf("router.put('/ordem-cardapio'"));
  const codigo = rota.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /*
   * `NULL = NULL` é DESCONHECIDO, não verdadeiro. Com `=`, o produto sem
   * subcategoria não casaria com ele mesmo: a lista de irmãos viria vazia,
   * `reordenar` devolveria só ele, e a gravação zeraria a ordem dos outros da
   * faixa. O `<=>` é o igual que trata NULL como valor.
   */
  it('compara a faixa com <=>, que é seguro com NULL', () => {
    expect(codigo).toMatch(/categoria <=> \? AND subcategoria <=> \?/);
    expect(codigo).not.toMatch(/AND subcategoria = \?/);
  });

  /* Identificar produto por nome moveria o errado quando dois compartilham
     nome na mesma faixa — o que duplicar item produz. */
  it('identifica o produto por id, não por nome', () => {
    expect(codigo).toMatch(/SELECT id FROM produtos/);
    expect(codigo).toMatch(/UPDATE produtos SET ordem = \? WHERE id = \? AND loja_id = \?/);
  });

  /* A gravação precisa ser cercada por loja_id: sem isso, um id de outra loja
     no corpo da requisição reordenaria o cardápio alheio. */
  it('a gravação é cercada por loja_id', () => {
    const ups = codigo.match(/UPDATE produtos SET ordem[^`]*/g) || [];
    expect(ups.length).toBe(1);
    expect(ups[0]).toContain('loja_id = ?');
  });
});
