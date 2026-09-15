/**
 * O PEDIDO VIRANDO PEÇAS, PARA O ESTOQUE DO ERP BAIXAR CERTO.
 *
 * ────────────────────────── O PROBLEMA, MEDIDO ──────────────────────────────
 *
 * O lojista vende "POTE DE JACK TRADICIONAL — R$ 65,00", e dentro dele o
 * cliente escolhe 2 gelos (entre oito sabores) e 1 energético. Cada sabor de
 * gelo é um produto de verdade no Maxx Gestão, com SKU e saldo.
 *
 * O documento que sobe para o ERP leva as linhas do PEDIDO. Complemento não é
 * linha — é texto dentro do item. Então o gelo que saiu da câmara fria nunca
 * era descontado, e o saldo de lá seguia intacto. Medido em 15/09/2026, com
 * documento Emitido:
 *
 *   produto simples ......... baixa           ✔
 *   composição do ERP ....... NÃO baixa       ✘  (o ERP não explode kit)
 *   complemento do delivery . não existe lá   ✘
 *
 * Como o ERP não resolve composição, quem tem que mandar as peças é este lado.
 *
 * ─────────────────── POR QUE SEM LINHA DE R$ 0,00 ───────────────────────────
 *
 * A saída óbvia seria mandar o pote pelo preço cheio e as peças a zero. Mas a
 * loja emite NFC-e pelo Maxx Gestão, e item zerado numa nota é exatamente o que
 * a SEFAZ implica. Então o preço do pote é RATEADO entre as peças, cada linha
 * com valor de verdade e a soma batendo no centavo.
 *
 * O nome do pote não some: vai na observação do documento.
 *
 * ──────────────────── O INTERRUPTOR É DO GRUPO ──────────────────────────────
 *
 * Nas palavras do lojista: "o energético eu não posso controlar o estoque". No
 * mesmo pote ele controla o gelo e não controla o energético. Por isso quem
 * decide é o grupo (`baixa_estoque`), e não uma regra global — e nasce
 * desligado, para nenhum cardápio existente mudar de comportamento sozinho.
 */

/** Uma opção que o cliente escolheu, do jeito que esta decisão precisa ver. */
export interface OpcaoEscolhida {
  /** Quantas vezes esta opção foi escolhida (2× gelo de coco = 2). */
  quantidade: number;
  /** O produto que ela consome, ou 0. */
  produtoId: number;
  variacaoErp: number;
  nome: string;
  /** O grupo dela baixa estoque? */
  grupoBaixaEstoque: boolean;
  /** Preço de tabela do produto vinculado, para o rateio. */
  precoTabelaCentavos: number;
}

export interface ItemDoPedido {
  nome: string;
  quantidade: number;
  precoUnitarioCentavos: number;
  variacaoErp: number;
  /** Preço de tabela do próprio item, para ele entrar no rateio. */
  precoTabelaCentavos: number;
  escolhas: OpcaoEscolhida[];
}

export interface LinhaDoDocumento {
  nome: string;
  quantidade: number;
  precoUnitarioCentavos: number;
  variacaoErp: number;
}

/**
 * QUAIS PEÇAS ESTE ITEM CONSOME — o item em si mais as opções que baixam.
 *
 * Opção sem produto vinculado, ou de grupo desligado, NÃO vira peça: ela
 * continua sendo só texto no pedido, como sempre foi.
 */
export function pecasDoItem(item: ItemDoPedido): LinhaDoDocumento[] {
  const pecas: LinhaDoDocumento[] = [];

  /* O PRÓPRIO ITEM SÓ ENTRA SE TIVER SKU. Um pote que só existe aqui não tem o
     que baixar — e mandá-lo sem vínculo derrubaria o documento inteiro, que é
     o defeito de hoje. */
  if (item.variacaoErp > 0) {
    pecas.push({
      nome: item.nome,
      quantidade: item.quantidade,
      precoUnitarioCentavos: 0, /* preenchido pelo rateio */
      variacaoErp: item.variacaoErp,
    });
  }

  for (const e of item.escolhas) {
    if (!e.grupoBaixaEstoque) continue;
    if (e.variacaoErp <= 0) continue;
    const qtd = Math.max(1, Math.round(e.quantidade)) * Math.max(1, Math.round(item.quantidade));
    /* MESMA OPÇÃO ESCOLHIDA DUAS VEZES VIRA UMA LINHA DE 2, e não duas de 1:
       "2× gelo de coco" é como o lojista pensa, e é como o estoque some. */
    const jaTem = pecas.find(p => p.variacaoErp === e.variacaoErp);
    if (jaTem) { jaTem.quantidade += qtd; continue; }
    pecas.push({ nome: e.nome, quantidade: qtd, precoUnitarioCentavos: 0, variacaoErp: e.variacaoErp });
  }
  return pecas;
}

/**
 * O PREÇO DO ITEM DIVIDIDO ENTRE AS PEÇAS, na proporção do preço de tabela.
 *
 * O pote custa R$ 65 e as peças somam mais que isso pelo preço cheio — ele é
 * promocional. Dividir proporcionalmente mantém o total exato e dá a cada linha
 * um valor que se explica ("o Jack saiu por 55 dentro do pote").
 *
 * O QUE SOBRA DO ARREDONDAMENTO é devolvido somando centavos ao PREÇO UNITÁRIO
 * das linhas — ver a explicação dentro da função. Fechar o total em valor de
 * linha não serve: o ERP monta o total a partir de unitário × quantidade.
 *
 * SEM PREÇO DE TABELA EM NENHUMA PEÇA, divide por igual: é o que sobra quando
 * não há proporção para respeitar, e é melhor que deixar tudo em zero.
 */
export function ratearPreco(
  totalCentavos: number,
  pecas: LinhaDoDocumento[],
  pesos: number[],
): LinhaDoDocumento[] {
  if (!pecas.length) return [];
  const total = Math.max(0, Math.round(totalCentavos));
  const somaPesos = pesos.reduce((s, p) => s + Math.max(0, p), 0);
  const usarPesos = somaPesos > 0;

  /*
   * A CONTA É EM PREÇO UNITÁRIO, e não em valor de linha — foi assim que a
   * primeira versão errou.
   *
   * Ela repartia o total em fatias por linha e depois dividia a fatia pela
   * quantidade: `arredondar(269 / 2) × 2 = 270`, e o documento fechava um
   * centavo acima do pedido. O ERP monta o total a partir de unitário × qtd,
   * então só valores representáveis desse jeito existem — e é neles que a
   * divisão tem que cair desde o começo.
   */
  const qtd = (i: number) => Math.max(1, Math.round(pecas[i].quantidade));
  const unitarios = pecas.map((_, i) => {
    const fatia = usarPesos
      ? total * Math.max(0, pesos[i]) / somaPesos
      : total / pecas.length;
    return Math.floor(fatia / qtd(i));
  });

  /*
   * O QUE SOBROU DO ARREDONDAMENTO É DEVOLVIDO EM CENTAVOS INTEIROS.
   *
   * Cada centavo somado ao unitário de uma linha acrescenta `quantidade` ao
   * total — então o resto é quitado com as linhas que cabem nele, das maiores
   * para as menores. Com uma linha de quantidade 1 na mesa (o próprio pote, no
   * caso real), fecha sempre exato.
   *
   * Se NENHUMA linha couber no que sobrou (todas com quantidade maior que o
   * resto), sobram 1 ou 2 centavos: é o limite do formato do ERP, não um
   * descuido. Melhor um centavo a menos no documento que um a mais na nota.
   */
  let resto = total - unitarios.reduce((t, u, i) => t + u * qtd(i), 0);
  const ordem = pecas.map((_, i) => i).sort((a, b) => qtd(b) - qtd(a));
  let mexeu = true;
  while (resto > 0 && mexeu) {
    mexeu = false;
    for (const i of ordem) {
      if (qtd(i) <= resto) { unitarios[i] += 1; resto -= qtd(i); mexeu = true; break; }
    }
  }

  return pecas.map((p, i) => ({
    nome: p.nome,
    quantidade: qtd(i),
    variacaoErp: p.variacaoErp,
    precoUnitarioCentavos: unitarios[i],
  }));
}

/**
 * O ITEM INTEIRO VIRANDO LINHAS DE DOCUMENTO.
 *
 * Quando não há nenhuma peça (nem o item tem SKU, nem alguma opção baixa),
 * devolve vazio — e quem chama trata isso como "este item não vai ao ERP", que
 * é o comportamento de hoje.
 */
export function explodirItem(item: ItemDoPedido): LinhaDoDocumento[] {
  const pecas = pecasDoItem(item);
  if (!pecas.length) return [];

  /*
   * SÓ EXPLODE QUANDO HÁ MAIS DE UMA PEÇA. Item comum — sem opção que baixa —
   * continua indo como sempre foi, com o preço que o cliente pagou. Rateio de
   * uma peça só seria o mesmo número passando por uma conta a mais.
   */
  const totalDoItem = Math.round(item.precoUnitarioCentavos) * Math.max(1, Math.round(item.quantidade));
  if (pecas.length === 1) {
    return [{ ...pecas[0], precoUnitarioCentavos: item.precoUnitarioCentavos }];
  }

  const pesos = pecas.map(p => {
    if (p.variacaoErp === item.variacaoErp) return item.precoTabelaCentavos * p.quantidade;
    const e = item.escolhas.find(x => x.variacaoErp === p.variacaoErp);
    return (e?.precoTabelaCentavos ?? 0) * p.quantidade;
  });
  return ratearPreco(totalDoItem, pecas, pesos);
}
