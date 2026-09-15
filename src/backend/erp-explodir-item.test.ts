import { describe, it, expect } from 'vitest';
import {
  explodirItem, pecasDoItem, ratearPreco,
  type ItemDoPedido, type OpcaoEscolhida,
} from './erp-explodir-item';

/*
 * O PEDIDO VIRANDO PEÇAS PARA O ESTOQUE DO ERP BAIXAR.
 *
 * O caso real: "POTE DE JACK TRADICIONAL — R$ 65,00", e dentro dele o cliente
 * escolhe 2 gelos (entre oito sabores) e 1 energético. Cada sabor de gelo é um
 * produto no Maxx Gestão, com SKU e saldo.
 *
 * O documento do ERP leva as linhas do PEDIDO, e complemento não é linha — é
 * texto dentro do item. Então o gelo que saiu da câmara fria nunca era
 * descontado. E o ERP não resolve isso sozinho: medido em 15/09/2026, com
 * documento Emitido, ele baixa produto simples mas NÃO explode composição.
 *
 * O interruptor é do GRUPO porque no mesmo pote o lojista controla o gelo e não
 * controla o energético — nas palavras dele, "pra mim não ter que ficar fazendo
 * gambiarra".
 */

const opcao = (extra: Partial<OpcaoEscolhida> = {}): OpcaoEscolhida => ({
  quantidade: 1, produtoId: 0, variacaoErp: 0, nome: 'opção',
  grupoBaixaEstoque: true, precoTabelaCentavos: 0, ...extra,
});
const item = (extra: Partial<ItemDoPedido> = {}): ItemDoPedido => ({
  nome: 'POTE DE JACK TRADICIONAL', quantidade: 1, precoUnitarioCentavos: 6500,
  variacaoErp: 1203, precoTabelaCentavos: 18500, escolhas: [], ...extra,
});

describe('quais peças o item consome', () => {
  it('o pote e os dois gelos escolhidos', () => {
    const p = pecasDoItem(item({
      escolhas: [
        opcao({ quantidade: 2, variacaoErp: 580, nome: 'Gelo de coco' }),
        opcao({ quantidade: 1, variacaoErp: 91, nome: 'Baly melancia' }),
      ],
    }));
    expect(p.map(x => [x.variacaoErp, x.quantidade])).toEqual([[1203, 1], [580, 2], [91, 1]]);
  });

  /*
   * O INTERRUPTOR DO GRUPO MANDA. É o pedido literal do lojista: no mesmo pote,
   * o gelo baixa e o energético não.
   */
  it('grupo desligado não vira peça', () => {
    const p = pecasDoItem(item({
      escolhas: [
        opcao({ quantidade: 2, variacaoErp: 580, nome: 'Gelo de coco' }),
        opcao({ quantidade: 1, variacaoErp: 91, nome: 'Baly', grupoBaixaEstoque: false }),
      ],
    }));
    expect(p.map(x => x.variacaoErp)).toEqual([1203, 580]);
  });

  /* Opção sem produto vinculado continua sendo só texto, como sempre foi. */
  it('opção sem vínculo não vira peça', () => {
    const p = pecasDoItem(item({ escolhas: [opcao({ variacaoErp: 0, nome: 'Sem gelo' })] }));
    expect(p.map(x => x.variacaoErp)).toEqual([1203]);
  });

  /*
   * MESMA OPÇÃO DUAS VEZES VIRA UMA LINHA DE 2, e não duas de 1: "2× gelo de
   * coco" é como o lojista pensa e é como o estoque some.
   */
  it('a mesma opção repetida soma numa linha só', () => {
    const p = pecasDoItem(item({
      escolhas: [
        opcao({ quantidade: 1, variacaoErp: 580, nome: 'Gelo de coco' }),
        opcao({ quantidade: 1, variacaoErp: 580, nome: 'Gelo de coco' }),
      ],
    }));
    expect(p.find(x => x.variacaoErp === 580)?.quantidade).toBe(2);
  });

  /* Dois potes = o dobro de tudo dentro deles. */
  it('a quantidade do item multiplica as peças', () => {
    const p = pecasDoItem(item({
      quantidade: 3,
      escolhas: [opcao({ quantidade: 2, variacaoErp: 580, nome: 'Gelo' })],
    }));
    expect(p.map(x => [x.variacaoErp, x.quantidade])).toEqual([[1203, 3], [580, 6]]);
  });

  /*
   * O PRÓPRIO ITEM SÓ ENTRA SE TIVER SKU. Um pote que só existe no delivery não
   * tem o que baixar — e mandá-lo sem vínculo derruba o documento inteiro, que
   * é o defeito de hoje ("estes produtos não vieram do Maxx Gestão").
   */
  it('item sem SKU não vira peça, mas as opções dele viram', () => {
    const p = pecasDoItem(item({
      variacaoErp: 0,
      escolhas: [opcao({ quantidade: 2, variacaoErp: 580, nome: 'Gelo' })],
    }));
    expect(p.map(x => x.variacaoErp)).toEqual([580]);
  });
});

describe('o rateio do preço', () => {
  /*
   * SEM LINHA DE R$ 0,00. A loja emite NFC-e pelo Maxx Gestão, e item zerado
   * numa nota é o que a SEFAZ implica — por isso o preço do pote é dividido
   * entre as peças em vez de o pote levar tudo e as peças irem a zero.
   */
  it('a soma das linhas bate exatamente com o item', () => {
    const linhas = explodirItem(item({
      precoUnitarioCentavos: 6500,
      precoTabelaCentavos: 18500,
      escolhas: [
        opcao({ quantidade: 2, variacaoErp: 580, nome: 'Gelo de coco', precoTabelaCentavos: 400 }),
        opcao({ quantidade: 1, variacaoErp: 91, nome: 'Baly melancia', precoTabelaCentavos: 1400 }),
      ],
    }));
    const soma = linhas.reduce((t, l) => t + l.precoUnitarioCentavos * l.quantidade, 0);
    expect(soma).toBe(6500);
    expect(linhas).toHaveLength(3);
  });

  /* O caro leva a maior fatia — é o que faz o valor de cada linha se explicar. */
  it('divide na proporção do preço de tabela', () => {
    const linhas = ratearPreco(6500, [
      { nome: 'Jack', quantidade: 1, precoUnitarioCentavos: 0, variacaoErp: 1 },
      { nome: 'Gelo', quantidade: 2, precoUnitarioCentavos: 0, variacaoErp: 2 },
    ], [18500, 800]);
    expect(linhas[0].precoUnitarioCentavos).toBeGreaterThan(linhas[1].precoUnitarioCentavos * 2);
    const soma = linhas.reduce((t, l) => t + l.precoUnitarioCentavos * l.quantidade, 0);
    expect(soma).toBeLessThanOrEqual(6500);
  });

  /*
   * SEM PREÇO DE TABELA EM NENHUMA PEÇA, divide por igual: é o que sobra quando
   * não há proporção a respeitar, e é melhor que deixar tudo em zero.
   */
  it('sem peso, divide por igual', () => {
    const linhas = ratearPreco(900, [
      { nome: 'a', quantidade: 1, precoUnitarioCentavos: 0, variacaoErp: 1 },
      { nome: 'b', quantidade: 1, precoUnitarioCentavos: 0, variacaoErp: 2 },
      { nome: 'c', quantidade: 1, precoUnitarioCentavos: 0, variacaoErp: 3 },
    ], [0, 0, 0]);
    expect(linhas.map(l => l.precoUnitarioCentavos)).toEqual([300, 300, 300]);
  });

  /* O centavo que sobra vai numa linha só, não espalhado em todas: uma
     diferença é mais fácil de conferir que três. */
  it('o resto da divisão não some nem duplica', () => {
    const linhas = ratearPreco(1000, [
      { nome: 'a', quantidade: 1, precoUnitarioCentavos: 0, variacaoErp: 1 },
      { nome: 'b', quantidade: 1, precoUnitarioCentavos: 0, variacaoErp: 2 },
      { nome: 'c', quantidade: 1, precoUnitarioCentavos: 0, variacaoErp: 3 },
    ], [1, 1, 1]);
    const soma = linhas.reduce((t, l) => t + l.precoUnitarioCentavos * l.quantidade, 0);
    expect(soma).toBe(1000);
  });
});

describe('item comum não é mexido', () => {
  /*
   * SÓ EXPLODE QUANDO HÁ MAIS DE UMA PEÇA. Produto sem opção que baixa continua
   * indo ao ERP exatamente como sempre foi, pelo preço que o cliente pagou —
   * rateio de uma peça só seria o mesmo número passando por uma conta a mais,
   * com risco de arredondar o que não precisava.
   */
  it('produto sozinho mantém o preço que o cliente pagou', () => {
    const linhas = explodirItem(item({ precoUnitarioCentavos: 5700, escolhas: [] }));
    expect(linhas).toEqual([{
      nome: 'POTE DE JACK TRADICIONAL', quantidade: 1,
      precoUnitarioCentavos: 5700, variacaoErp: 1203,
    }]);
  });

  it('com complemento que não baixa, também não mexe', () => {
    const linhas = explodirItem(item({
      precoUnitarioCentavos: 5700,
      escolhas: [opcao({ variacaoErp: 91, grupoBaixaEstoque: false })],
    }));
    expect(linhas).toHaveLength(1);
    expect(linhas[0].precoUnitarioCentavos).toBe(5700);
  });

  /* Nada que baixe e nem SKU no item: vazio, e quem chama trata como "não vai
     ao ERP" — o comportamento de hoje. */
  it('sem peça nenhuma, devolve vazio', () => {
    expect(explodirItem(item({ variacaoErp: 0, escolhas: [] }))).toEqual([]);
  });
});

describe('a soma fecha no centavo, inclusive com peça de quantidade 2', () => {
  /*
   * O DEFEITO QUE ESTE TESTE PRENDE, encontrado pela própria suíte enquanto o
   * módulo era escrito:
   *
   * A primeira versão repartia o total em fatias POR LINHA e depois dividia a
   * fatia pela quantidade. `arredondar(269 / 2) × 2 = 270` — e o documento do
   * ERP fechava um centavo ACIMA do pedido.
   *
   * Um centavo parece nada até virar divergência entre a nota e o pedido, numa
   * loja que emite NFC-e. O ERP monta o total a partir de unitário × qtd, então
   * a conta precisa nascer em preço unitário.
   */
  const soma = (linhas: Array<{ precoUnitarioCentavos: number; quantidade: number }>) =>
    linhas.reduce((t, l) => t + l.precoUnitarioCentavos * l.quantidade, 0);

  it('o pote com 2 gelos e 1 energético fecha exato', () => {
    const linhas = explodirItem(item({
      precoUnitarioCentavos: 6500, precoTabelaCentavos: 18500,
      escolhas: [
        opcao({ quantidade: 2, variacaoErp: 580, nome: 'Gelo de coco', precoTabelaCentavos: 400 }),
        opcao({ quantidade: 1, variacaoErp: 91, nome: 'Baly', precoTabelaCentavos: 1400 }),
      ],
    }));
    expect(soma(linhas)).toBe(6500);
  });

  /* Vários preços e quantidades, para o acerto não depender de um caso feliz. */
  it('fecha exato em muitas combinações', () => {
    for (const total of [100, 999, 1234, 4567, 6500, 7777, 10001]) {
      for (const q of [1, 2, 3, 5, 7]) {
        const linhas = explodirItem(item({
          precoUnitarioCentavos: total, precoTabelaCentavos: 18500,
          escolhas: [
            opcao({ quantidade: q, variacaoErp: 580, precoTabelaCentavos: 400 }),
            opcao({ quantidade: 1, variacaoErp: 91, precoTabelaCentavos: 1400 }),
          ],
        }));
        expect(soma(linhas), `total ${total} com ${q} gelos`).toBe(total);
      }
    }
  });

  /* Nenhuma linha pode sair negativa por causa do acerto do resto. */
  it('nenhum preço unitário fica negativo', () => {
    const linhas = explodirItem(item({
      precoUnitarioCentavos: 1, precoTabelaCentavos: 18500,
      escolhas: [opcao({ quantidade: 3, variacaoErp: 580, precoTabelaCentavos: 400 })],
    }));
    for (const l of linhas) expect(l.precoUnitarioCentavos).toBeGreaterThanOrEqual(0);
  });
});

describe('o nome do item não some do documento', () => {
  /*
   * O POTE DEIXA DE SER UMA LINHA COM PREÇO PRÓPRIO quando ele explode, mas não
   * pode sumir: quem abre o documento no Maxx Gestão veria "GELO DE COCO · 2 ·
   * R$ 7,50" solto, sem como saber que aquilo é metade de um pote de R$ 65 —
   * nem por que o gelo saiu por um preço que não é o da tabela.
   */
  it('cada peça leva o nome do item na observação', () => {
    const linhas = explodirItem(item({
      nome: 'POTE DE JACK TRADICIONAL',
      escolhas: [
        opcao({ quantidade: 2, variacaoErp: 580, nome: 'Gelo de coco', precoTabelaCentavos: 400 }),
      ],
    }));
    expect(linhas.length).toBeGreaterThan(1);
    for (const l of linhas) expect(l.observacao).toBe('POTE DE JACK TRADICIONAL');
  });

  /* Item que não explodiu não ganha observação: ele JÁ é a própria linha, e
     repetir o nome dele ali seria ruído em toda venda comum. */
  it('item comum não ganha observação', () => {
    const linhas = explodirItem(item({ escolhas: [] }));
    expect(linhas[0].observacao).toBeUndefined();
  });
});
