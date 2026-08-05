/**
 * CURVA ABC de produtos — classificação por participação no faturamento.
 *
 * POR QUE NÃO BASTA O "MAIS VENDIDOS": aquele ranking ordena por QUANTIDADE, e
 * quantidade não paga conta. Refrigerante lidera em unidades em quase todo
 * delivery, e responde por uma fatia pequena do faturamento; a pizza que sai 8
 * vezes por dia pode ser metade do dinheiro. Olhando só o topo por unidade, o
 * lojista otimiza o cardápio pelo item errado.
 *
 * A CLASSIFICAÇÃO (Pareto): ordena por faturamento, acumula, e corta em 80% / 95%.
 *  - A = os produtos que somam os primeiros 80% do faturamento. São poucos, e são
 *    onde falta de estoque ou preço errado dói de verdade.
 *  - B = os 15% seguintes.
 *  - C = a cauda. Cardápio grande vive cheio deles: cada um vende pouco, e juntos
 *    custam preparo, compra, espaço e atenção.
 *
 * O ITEM QUE CRUZA A FRONTEIRA ENTRA NA CLASSE DE CIMA. Sem essa regra, uma loja
 * com um único produto dominante (55% do faturamento) não teria classe A nenhuma —
 * o acumulado saltaria de 0 pra 55 e o corte de 80% cairia no segundo item. A
 * classe A tem que conter o item que leva o acumulado ATÉ o limite, não só os que
 * ficam abaixo dele.
 *
 * SOBRE LUCRO: o certo seria classificar por MARGEM, não por faturamento — produto
 * que fatura muito e dá pouco lucro é exatamente o que a curva deveria denunciar.
 * Não dá ainda: não existe custo cadastrado em nenhum lugar do sistema (ver o
 * módulo de nota de compra, que é o que traz esse dado). Enquanto isso a curva é de
 * faturamento, e a tela precisa dizer isso — chamar de "curva ABC" sem qualificar
 * faria o lojista tomar decisão de margem com número de receita.
 */

export type ClasseAbc = 'A' | 'B' | 'C';

export interface ItemFaturamento {
  nome_produto: string;
  quantidade: number;
  total_centavos: number;
}

export interface ItemCurvaAbc extends ItemFaturamento {
  classe: ClasseAbc;
  /** Participação deste item no faturamento do período (%, 1 casa). */
  participacao_percent: number;
  /** Participação acumulada até este item, na ordem da curva (%, 1 casa). */
  acumulado_percent: number;
}

export interface ResumoClasse {
  classe: ClasseAbc;
  itens: number;
  total_centavos: number;
  participacao_percent: number;
}

const LIMITE_A = 80;
const LIMITE_B = 95;

const arred1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Classifica os itens em A/B/C. Devolve na ordem da curva (maior faturamento
 * primeiro), que é a ordem em que a lista se lê.
 */
export function classificarCurvaAbc(itens: ItemFaturamento[]): ItemCurvaAbc[] {
  const total = itens.reduce((s, i) => s + i.total_centavos, 0);
  if (total <= 0) return [];

  // Cópia antes de ordenar: `sort` muta, e o chamador passa o resultado de uma
  // query que pode estar sendo usado em outro bloco do relatório.
  const ordenados = [...itens].sort((a, b) => b.total_centavos - a.total_centavos);

  let acumulado = 0;
  return ordenados.map(item => {
    const participacao = (item.total_centavos / total) * 100;
    const antes = acumulado;
    acumulado += participacao;
    // O item que ATRAVESSA a fronteira pertence à classe de baixo (a de cima na
    // hierarquia): usa o acumulado ANTES dele pra decidir.
    const classe: ClasseAbc = antes < LIMITE_A ? 'A' : antes < LIMITE_B ? 'B' : 'C';
    return {
      ...item,
      classe,
      participacao_percent: arred1(participacao),
      acumulado_percent: arred1(Math.min(acumulado, 100)),
    };
  });
}

/**
 * Resumo por classe — quantos itens e quanto dinheiro cada uma representa.
 *
 * É o número que responde "quantos produtos do meu cardápio realmente importam?".
 * Sempre devolve as três classes, mesmo vazias: classe que desaparece da tela
 * quando está zerada faz parecer que o relatório não calculou.
 */
export function resumirClassesAbc(curva: ItemCurvaAbc[]): ResumoClasse[] {
  const total = curva.reduce((s, i) => s + i.total_centavos, 0);
  return (['A', 'B', 'C'] as ClasseAbc[]).map(classe => {
    const doGrupo = curva.filter(i => i.classe === classe);
    const soma = doGrupo.reduce((s, i) => s + i.total_centavos, 0);
    return {
      classe,
      itens: doGrupo.length,
      total_centavos: soma,
      participacao_percent: total > 0 ? arred1((soma / total) * 100) : 0,
    };
  });
}
