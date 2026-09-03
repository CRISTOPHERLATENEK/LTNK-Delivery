/**
 * MONTAR O DOCUMENTO FISCAL DO PEDIDO NO MAXX GESTÃO.
 *
 * Decisão pura: entram o pedido e seus itens, sai o corpo do
 * `POST /api/documento/v1`. Sem banco e sem rede, porque um erro aqui não dá
 * exceção — dá nota fiscal errada, e nota fiscal errada se descobre no mês
 * seguinte.
 *
 * O QUE MANDAMOS É O PEDIDO, NÃO A NOTA.
 *
 * Uma chamada: `POST /documento` com `modelo: 'PA'` (Pedido de Venda) e os
 * itens. `transformar` e `emitir` existem na API e chegaram a ser chamados
 * aqui, mas quem conclui a parte fiscal é o ERP — decisão do dono do projeto,
 * e a certa: natureza de operação, forma de pagamento e tributação são
 * configuração de lá, e cada uma que a gente tentasse resolver daqui seria um
 * palpite sobre cadastro que não é nosso.
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

/**
 * OS MODELOS QUE UM PEDIDO PODE SER — dois, não os quatro que a API aceita.
 *
 * `OC` (Orçamento) e `CN` (Condicional) também são aceitos pelo ERP e ficaram
 * FORA de propósito: nenhum dos dois é uma venda fechada. Orçamento é proposta
 * e condicional é mercadoria que pode voltar; um pedido pago no app entrando
 * como qualquer um dos dois viraria uma venda que o faturamento do lojista não
 * reconhece — e ele descobriria pelo caixa não fechando.
 *
 *   PA → Pedido de Venda (padrão)
 *   PV → Pré-Venda: o que o PDV normalmente puxa para finalizar no caixa
 */
export const MODELOS_DOCUMENTO = ['PA', 'PV'] as const;
export type ModeloDocumento = typeof MODELOS_DOCUMENTO[number];

/** O modelo gravado, ou o padrão. Valor estranho no banco NÃO vira documento
    estranho: cai em `PA`, que é o comportamento conhecido. */
export function modeloValido(bruto: unknown): ModeloDocumento {
  const v = String(bruto ?? '').trim().toUpperCase();
  return (MODELOS_DOCUMENTO as readonly string[]).includes(v) ? v as ModeloDocumento : 'PA';
}

export interface ConfigDocumento {
  /** Natureza de operação (1 = VENDA DE MERCADORIA DENTRO DO ESTADO, CFOP 5102). */
  idNaturezaOperacao: number;
  /** Consumidor final padrão da empresa (`idPessoaPadrao` das configurações). */
  idPessoa: number;
  /**
   * O USUÁRIO DO ERP QUE ASSINA O DOCUMENTO. Obrigatório: sem ele a criação é
   * recusada com "idUsuario deve ser maior que zero".
   *
   * E não dá para pedir ao lojista: `GET /api/usuario/v1` devolve e-mail e
   * `codigoExterno`, NÃO o id — mandar o código externo (4000) volta "Usuario
   * 4000 nao encontrado para a organizacao do token". O valor é descoberto
   * lendo um documento que já existe no ERP; ver `maxxgestao-emitir`.
   */
  idUsuario: number;
  /**
   * A forma de pagamento no ERP, quando dá para resolver. Zero = manda sem.
   *
   * NÃO IMPEDE MAIS. Enquanto nós emitíamos a nota, forma errada seria `tPag`
   * errado e por isso a ausência bloqueava; agora quem emite é o ERP, e forma
   * de pagamento é cadastro dele. Bloquear o envio por causa disso deixava o
   * pedido sem chegar lá — que é o oposto do que se quer.
   */
  idPagamento: number;
  /**
   * O MODELO DO DOCUMENTO, escolhido pelo lojista.
   *
   * Existe porque decide QUEM enxerga o pedido do outro lado, e a resposta não
   * está na documentação nem no código: o MeuChef (o PDV da própria Maxx
   * Gestão) puxa uma fila só, e qual modelo entra nela é coisa de instalação.
   * Fixo no código, descobrir isso exigia um deploy por tentativa.
   */
  modelo: ModeloDocumento;
  /**
   * O CAIXA do ERP, ou 0 para não mandar.
   *
   * É o que faz o documento pertencer à operação do PDV: medido, todo documento
   * do MeuChef tem `idCaixa` e os nossos vinham com 0. Mandar 0 explicitamente
   * seria pior que omitir — 0 não é um caixa.
   */
  idCaixa: number;
  /**
   * Momento do documento, em HORÁRIO DE BRASÍLIA — não UTC.
   *
   * Os documentos do ERP vêm em hora local ("2026-09-02T11:12:22.521", sem
   * fuso), então mandar UTC coloca o pedido três horas no futuro: um pedido das
   * 18h aparece às 21h no Gestão, e no fim do dia cai no dia seguinte.
   *
   * Injetável para o teste não depender do relógio.
   */
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
  if (config.idUsuario <= 0) impedimentos.push('não consegui descobrir o usuário do ERP que assina o documento');

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
      idUsuario: config.idUsuario,
      /*
       * `PA` = PEDIDO DE VENDA, e o valor foi lido do ERP, não deduzido.
       *
       * `modelo` aceita PA, PV, OC ou CN, e a documentação não diz o que cada
       * um significa. Criei um documento de cada e li o `modeloDescricao` de
       * volta:
       *
       *   PA → Pedido de Venda      PV → Pré-Venda
       *   OC → Orçamento            CN → Condicional
       *
       * Estava indo `PV`, e os primeiros pedidos apareceram no Gestão como
       * "Pré-Venda" — que é outro documento na operação de quem usa o ERP.
       *
       * Hoje vem da configuração da loja: `PA` continua o padrão (é o que está
       * em produção e o que você conferiu no Gestão), e `PV` existe para o
       * pedido cair na fila do PDV, se for lá que ele precisa aparecer.
       */
      modelo: config.modelo,
      /*
       * OS DOIS CAMPOS JUNTOS, e só quando há caixa.
       *
       * `idCaixaAbertura` acompanha o `idCaixa` porque foi assim que o teste
       * pegou (documento 2749 voltou com os dois iguais), e é assim que os
       * documentos do PDV aparecem. Mandar só um deixaria o documento meio
       * dentro da operação do caixa.
       */
      ...(config.idCaixa > 0
        ? { idCaixa: config.idCaixa, idCaixaAbertura: config.idCaixa }
        : {}),
      dataHora: config.dataHora,
      /* A IDEMPOTÊNCIA. Gravamos o id do nosso pedido para poder perguntar "já
         mandei este?" antes de mandar de novo — sem isso, uma retentativa gera
         dois documentos fiscais para a mesma venda. */
      idExterno: String(pedido.id),
    },
    pessoa: { idPessoa: config.idPessoa },
    pedido: {
      idExterno: String(pedido.id),
      /*
       * D OU B, e não E/R como eu supus: o ERP recusa com "tipoEntrega
       * invalido. Valores aceitos: D ou B". D de delivery, B de balcão.
       */
      tipoEntrega: pedido.tipoEntrega === 'retirada' ? 'B' : 'D',
    },
    mercadoriaLista,
    /*
     * O PAGAMENTO VAI EM TRÊS LISTAS, e o ERP exige as três juntas.
     *
     * Descoberto na recusa: "Quando houver pagamento informado, deve existir
     * pelo menos uma parcela". Ou seja, `pagamentoLista` sozinha não fecha — o
     * financeiro do ERP quer a parcela (o que se deve) e o vínculo parcela ↔
     * pagamento (o que foi recebido). Faz sentido: sem a parcela, o valor
     * entraria como recebimento sem contrapartida.
     *
     * `idSequencia` e `idParcela` são a chave: um pagamento à vista é sequência
     * 1, parcela 1, e é isso que os três blocos apontam entre si.
     *
     * `status: 'B'` (aceitos: P, B ou C) = baixada. O documento só é mandado
     * quando o pedido fecha, então o dinheiro já entrou — deixar como pendente
     * criaria uma conta a receber que ninguém vai receber, porque já foi paga.
     */
    ...(config.idPagamento > 0
      ? {
        pagamentoLista: [{
          idSequencia: 1,
          idPagamento: config.idPagamento,
          valor: valorDoErp(somaItens),
          valAcrescimo: 0,
          valDesconto: 0,
        }],
        parcelaLista: [{
          idSequencia: 1,
          idParcela: 1,
          valBase: valorDoErp(somaItens),
          valParcela: valorDoErp(somaItens),
          dtVencimento: config.dataHora.slice(0, 10),
          status: 'B',
        }],
        parcelaPagamentoLista: [{
          idSequencia: 1,
          idParcela: 1,
          idSequenciaPagamento: 1,
          idPagamento: config.idPagamento,
          dtPagamento: config.dataHora.slice(0, 10),
          valPagamento: valorDoErp(somaItens),
        }],
      }
      : {}),
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
