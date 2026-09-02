/**
 * MONTAR O DOCUMENTO FISCAL DO PEDIDO NO MAXX GESTÃO.
 *
 * Decisão pura: entram o pedido e seus itens, sai o corpo do
 * `POST /api/documento/v1`. Sem banco e sem rede, porque um erro aqui não dá
 * exceção — dá nota fiscal errada, e nota fiscal errada se descobre no mês
 * seguinte.
 *
 * O CAMINHO SÃO TRÊS CHAMADAS: criar como `PV` (pedido de venda) →
 * `transformar` (vira modelo fiscal) → `emitir`. Elas não são intercambiáveis e
 * a ordem não é negociável.
 *
 * A REGRA QUE MANDA: NA DÚVIDA, NÃO EMITE.
 *
 * Item sem vínculo com a mercadoria do ERP, forma de pagamento sem
 * correspondente, valor que não fecha — tudo isso PARA a emissão e reporta o
 * motivo. A alternativa seria emitir com um palpite no lugar do dado que falta,
 * e um documento fiscal com palpite dentro é pior que nenhum: o primeiro se
 * emite depois, o segundo se corrige com carta de correção ou cancelamento.
 */

/** Um item do pedido, do jeito que a montagem precisa ver. */
export interface ItemPedido {
  nome: string;
  quantidade: number;
  precoUnitarioCentavos: number;
  /** O vínculo com a mercadoria do ERP. Zero = produto que nasceu no delivery. */
  variacaoErp: number;
}

export interface DadosDoPedido {
  id: number;
  totalCentavos: number;
  formaPagamento: string;
  tipoEntrega: 'entrega' | 'retirada';
  itens: ItemPedido[];
}

export interface ConfigDocumento {
  /** Natureza de operação (1 = VENDA DE MERCADORIA DENTRO DO ESTADO, CFOP 5102). */
  idNaturezaOperacao: number;
  /** Consumidor final padrão da empresa (`idPessoaPadrao` das configurações). */
  idPessoa: number;
  /** A forma de pagamento no ERP que corresponde à do pedido. */
  idPagamento: number;
  /** Momento do documento, em ISO. Injetável para o teste não depender do relógio. */
  dataHora: string;
}

/** O que impede a emissão, em português, para virar log e tela. */
export type Impedimento = string;

export interface Montagem {
  corpo: Record<string, unknown> | null;
  impedimentos: Impedimento[];
}

/** Centavos → o número decimal que o ERP espera. */
export function valorDoErp(centavos: number): number {
  return Math.round(centavos) / 100;
}

/**
 * O corpo do documento, ou os motivos para não emitir.
 *
 * Devolve os DOIS num objeto em vez de lançar exceção: quem chama precisa
 * registrar todos os motivos de uma vez. Lançar no primeiro problema faria a
 * pessoa consertar um item, tentar de novo, descobrir o segundo, e assim por
 * diante — em cardápio grande isso é uma tarde.
 */
export function montarDocumento(
  pedido: DadosDoPedido,
  config: ConfigDocumento,
): Montagem {
  const impedimentos: Impedimento[] = [];

  if (!pedido.itens.length) impedimentos.push('o pedido não tem itens');
  if (config.idNaturezaOperacao <= 0) impedimentos.push('a natureza de operação não está configurada');
  if (config.idPessoa <= 0) impedimentos.push('o consumidor final padrão do ERP não foi encontrado');

  /*
   * FORMA DE PAGAMENTO SEM CORRESPONDENTE PARA A EMISSÃO.
   *
   * É o `idPagamento` do ERP que carrega o `tPag` da NFC-e. Mandar zero, ou o
   * primeiro da lista "para não falhar", produziria uma nota com a forma de
   * pagamento errada — que a SEFAZ autoriza, porque o código é válido, e que só
   * aparece numa fiscalização.
   */
  if (config.idPagamento <= 0) {
    impedimentos.push(`a forma de pagamento "${pedido.formaPagamento}" não está ligada à natureza de operação no ERP`);
  }

  const semVinculo = pedido.itens.filter(i => !(i.variacaoErp > 0));
  if (semVinculo.length) {
    /*
     * Nomear os produtos, não contar. "3 itens sem vínculo" manda a pessoa
     * procurar quais; "X-Bacon, Açaí, Coca" ela já sabe onde mexer.
     */
    const nomes = semVinculo.map(i => i.nome || '(sem nome)').join(', ');
    impedimentos.push(`estes produtos não vieram do Maxx Gestão e não podem ir na nota: ${nomes}`);
  }

  const somaItens = pedido.itens.reduce(
    (t, i) => t + Math.round(i.precoUnitarioCentavos) * Math.max(1, Math.round(i.quantidade)), 0);

  if (impedimentos.length) return { corpo: null, impedimentos };

  const mercadoriaLista = pedido.itens.map(i => {
    const qtd = Math.max(1, Math.round(i.quantidade));
    const unitario = valorDoErp(i.precoUnitarioCentavos);
    return {
      idMercadoriaVariacao: i.variacaoErp,
      qtd,
      valUnitarioBruto: unitario,
      valUnitarioLiquido: unitario,
      valTotalBruto: valorDoErp(i.precoUnitarioCentavos * qtd),
      valTotalLiquido: valorDoErp(i.precoUnitarioCentavos * qtd),
      observacao: '',
    };
  });

  /*
   * O PAGAMENTO LEVA A SOMA DOS ITENS, não o total do pedido.
   *
   * O total do pedido inclui a taxa de entrega, e a taxa não é mercadoria: se
   * ela entrar no pagamento sem estar em item nenhum, o documento não fecha —
   * pagamento maior que a soma das mercadorias. Frete na NFC-e tem campo
   * próprio, e enquanto ele não estiver mapeado a nota sai só com as
   * mercadorias, que é o que temos com certeza.
   */
  const corpo: Record<string, unknown> = {
    documento: {
      idNaturezaOperacao: config.idNaturezaOperacao,
      /* `PV` = pedido de venda. `modelo` só aceita PA, PV, OC ou CN — modelo
         fiscal é o que o `transformar` faz depois, não o que se pede aqui. */
      modelo: 'PV',
      dataHora: config.dataHora,
      /* A IDEMPOTÊNCIA. Gravamos o id do nosso pedido para poder perguntar "já
         mandei este?" antes de mandar de novo — sem isso, uma retentativa gera
         dois documentos fiscais para a mesma venda. */
      idExterno: String(pedido.id),
    },
    pessoa: { idPessoa: config.idPessoa },
    pedido: {
      idExterno: String(pedido.id),
      tipoEntrega: pedido.tipoEntrega === 'retirada' ? 'R' : 'E',
    },
    mercadoriaLista,
    pagamentoLista: [{
      idPagamento: config.idPagamento,
      valor: valorDoErp(somaItens),
      valAcrescimo: 0,
      valDesconto: 0,
    }],
  };

  return { corpo, impedimentos: [] };
}

/**
 * A soma dos itens bate com o total do pedido?
 *
 * Serve para AVISAR, não para impedir: a diferença normal é a taxa de entrega, e
 * bloquear a nota por causa dela deixaria toda venda com frete sem documento.
 * Mas a diferença precisa aparecer no log — no dia em que ela for outra coisa
 * (desconto não registrado, item somado errado), é por aqui que se descobre.
 */
export function diferencaDoTotal(pedido: DadosDoPedido): number {
  const soma = pedido.itens.reduce(
    (t, i) => t + Math.round(i.precoUnitarioCentavos) * Math.max(1, Math.round(i.quantidade)), 0);
  return Math.round(pedido.totalCentavos) - soma;
}
