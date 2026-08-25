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

/*
 * AS BORDAS DA COMPOSIÇÃO — duplicar e excluir.
 *
 * As duas falhavam em SILÊNCIO, que é o que as torna caras: nenhuma erro,
 * nenhum aviso, e o estrago só aparece quando o cliente recebe o pedido.
 */
describe('composição de combo: duplicar e excluir', () => {
  const lojista = fs.readFileSync(path.resolve(__dirname, 'rotas', 'lojista.ts'), 'utf8');
  const trecho = (de: string, ate: string) => {
    const i = lojista.indexOf(de);
    return lojista.slice(i, lojista.indexOf(ate, i));
  };

  /*
   * Sem copiar `combo_itens`, a cópia mantinha preço e grupos do slot 0 mas
   * deixava de ser combo: o cliente pagava o combo e recebia só a bebida.
   */
  it('duplicar leva a composição junto', () => {
    const rota = trecho("router.post('/produtos/:id/duplicar'", "router.post('/produtos/bulk'");
    expect(rota).toMatch(/SELECT slot, produto_id, rotulo FROM combo_itens WHERE combo_id = \?/);
    expect(rota).toMatch(/INSERT INTO combo_itens \(combo_id, slot, produto_id, rotulo\)/);
  });

  /* Sem `vendido_sozinho`, duplicar um componente oculto publicava a cópia no
     cardápio por um preço que só faz sentido dentro do combo. */
  it('duplicar preserva vendido_sozinho', () => {
    const rota = trecho("router.post('/produtos/:id/duplicar'", "router.post('/produtos/bulk'");
    expect(rota).toMatch(/unidade_comercial, cest, vendido_sozinho, criado_em/);
    expect(rota).toMatch(/original\.vendido_sozinho/);
  });

  /*
   * A GUARDA PRECISA VIR ANTES DO UPDATE. Depois dele o produto já estaria
   * marcado como excluído — a rota devolveria erro com o estrago feito.
   */
  it('excluir recusa componente de combo, antes de marcar como excluído', () => {
    const rota = trecho("router.delete('/produtos/:id'", "router.post('/produtos/:id/duplicar'");
    const guarda = rota.indexOf('FROM combo_itens ci');
    const update = rota.indexOf('UPDATE produtos SET excluido = 1');
    expect(guarda).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(update);
    /* Cercada por loja_id: sem isso, um combo de OUTRA loja bloquearia a
       exclusão aqui — e pior, vazaria o nome dele na mensagem de erro. */
    expect(rota).toMatch(/c\.loja_id = \?/);
    /* Só combo vivo bloqueia: combo já excluído travaria a exclusão do
       componente pra sempre, sem tela nenhuma onde desfazer. */
    expect(rota).toMatch(/c\.id = ci\.combo_id AND c\.excluido = 0/);
  });
});

/*
 * A EXCLUSÃO EM MASSA É A OUTRA PORTA PRA MESMA SALA.
 *
 * Guardar só o `DELETE /produtos/:id` deixava o modo "Selecionar" apagar o
 * componente do combo em lote — mesmo estrago, caminho diferente. É o tipo de
 * buraco que sobrevive a uma correção porque ninguém procura a segunda rota.
 */
describe('exclusão em massa respeita a composição', () => {
  const lojista = fs.readFileSync(path.resolve(__dirname, 'rotas', 'lojista.ts'), 'utf8');
  const rota = lojista.slice(
    lojista.indexOf("router.post('/produtos/bulk'"),
    lojista.indexOf("router.post('/produtos/:id/combo'"));

  it('filtra os componentes antes de apagar', () => {
    expect(rota).toMatch(/JOIN combo_itens ci ON ci\.produto_id = p\.id/);
    const filtro = rota.indexOf('const podem = ids.filter');
    const update = rota.indexOf('SET excluido = 1');
    expect(filtro).toBeGreaterThan(-1);
    expect(filtro).toBeLessThan(update);
  });

  /* Sem devolver os nomes, a tela mostraria "28 excluídos" de 30 e o lojista
     não saberia quais dois seguiram vivos dentro de um combo. */
  it('devolve os pulados para a tela poder dizer quais foram', () => {
    expect(rota).toMatch(/bloqueados: bloqueados\.map\(b => b\.nome\)/);
  });

  /* O UPDATE tem que usar a lista FILTRADA, não a original — reaproveitar
     `placeholders` aqui apagaria justamente quem a guarda excluiu. */
  it('apaga usando a lista filtrada', () => {
    const upd = rota.slice(rota.indexOf('SET excluido = 1'));
    expect(upd).toMatch(/podem\.map\(\(\) => '\?'\)\.join\(','\)/);
    expect(upd).toMatch(/\.run\(loja\.id, \.\.\.podem\)/);
  });
});
