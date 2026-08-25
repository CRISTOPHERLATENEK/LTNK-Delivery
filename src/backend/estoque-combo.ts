/**
 * Quanto cada produto sai do estoque num pedido — contando o que os combos
 * consomem dos seus componentes.
 *
 * Mora aqui, puro, porque é aritmética que erra em silêncio: um combo com dois
 * slots da mesma pizza tem que baixar DUAS unidades, e um combo pedido 3× tem
 * que baixar 6. Nenhum desses erros gera exceção — geram estoque mentindo, que
 * só aparece no fim do dia com o número parado e o forno vazio.
 */

export interface InfoEstoque {
  nome: string;
  controla_estoque?: number;
  estoque?: number | null;
}

/** Uma linha do carrinho, já validada. */
export interface LinhaCarrinho {
  produtoId: number;
  quantidade: number;
  info: InfoEstoque;
}

/** Uma linha de `combo_itens` com os dados de estoque do componente. */
export interface ComponenteCombo {
  combo_id: number;
  produto_id: number;
  nome: string;
  controla_estoque: number;
  estoque: number | null;
}

export interface Agregado {
  /** produto -> unidades a baixar. */
  qtd: Map<number, number>;
  /** produto -> nome e estoque, cobrindo carrinho E componentes. */
  info: Map<number, InfoEstoque>;
  /** componente -> nome do combo que o puxou (o primeiro, pra mensagem). */
  dentroDeCombo: Map<number, string>;
}

export function agregarEstoque(
  linhas: LinhaCarrinho[],
  componentes: ComponenteCombo[],
): Agregado {
  const qtd = new Map<number, number>();
  const info = new Map<number, InfoEstoque>();
  const dentroDeCombo = new Map<number, string>();

  for (const linha of linhas) {
    qtd.set(linha.produtoId, (qtd.get(linha.produtoId) || 0) + linha.quantidade);
    info.set(linha.produtoId, linha.info);
  }

  /*
   * Segundo passo, e não dentro do primeiro: assim a linha do carrinho SEMPRE
   * vence no `info`, mesmo que o componente tenha sido visto antes. A pizza
   * pode ser vendida avulsa E dentro do combo no mesmo pedido, e a linha do
   * carrinho é a fonte mais completa.
   */
  for (const linha of linhas) {
    for (const c of componentes) {
      if (c.combo_id !== linha.produtoId) continue;
      /* CADA LINHA DE `combo_itens` SOMA. Dois slots do mesmo produto são duas
         linhas — é assim que "2× Pizza Artesanal" consome duas unidades. */
      qtd.set(c.produto_id, (qtd.get(c.produto_id) || 0) + linha.quantidade);
      if (!info.has(c.produto_id)) {
        info.set(c.produto_id, {
          nome: c.nome, controla_estoque: c.controla_estoque, estoque: c.estoque,
        });
      }
      if (!dentroDeCombo.has(c.produto_id)) dentroDeCombo.set(c.produto_id, linha.info.nome);
    }
  }

  return { qtd, info, dentroDeCombo };
}
