/**
 * O PEDIDO DO IFOOD TRADUZIDO PARA O NOSSO.
 *
 * Escrito contra um pedido REAL (`fixtures/ifood-pedido-teste.json`), gerado no
 * sandbox e capturado pelo nosso próprio laço — não contra o exemplo da
 * documentação. Três coisas que só apareceram no payload de verdade:
 *
 * 1. `payments.methods` é uma LISTA. O pedido de teste veio com duas: R$ 17 num
 *    Visa e R$ 10 num Master. Nosso `forma_pagamento` é uma coluna só, com
 *    CHECK de quatro valores — não cabe, e fingir que cabe é o caminho para a
 *    NFC-e voltar a mentir.
 * 2. O telefone é um NÚMERO DE PASSAGEM do iFood (0800 + localizador, com
 *    expiração). Não é o telefone do cliente e não recebe WhatsApp.
 * 3. Valores vêm em decimal (`21.0`), não em centavos.
 */

/** Reais decimais → centavos inteiros. */
export function paraCentavos(valor: unknown): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  /*
   * `Math.round` e não `Math.trunc`: 5.1*100 dá 509.9999… em ponto flutuante, e
   * truncar viraria R$ 5,09 — um centavo somindo em todo pedido com dízima.
   */
  return Math.round(n * 100);
}

export type FormaPagamento = 'pix' | 'dinheiro' | 'cartao_entrega' | 'cartao_online';

export interface PagamentoIfood {
  forma: FormaPagamento;
  /** Já pago no iFood? Muda quem cobra na porta. */
  online: boolean;
  trocoParaCentavos: number | null;
  /** Texto para o painel quando há mais de uma forma — a coluna não comporta. */
  detalhe: string;
  /** Mais de uma forma no mesmo pedido. */
  dividido: boolean;
}

/**
 * Decide a forma de pagamento do pedido.
 *
 * A REGRA É "QUEM PAGA MAIS MANDA", e ela existe porque a coluna é uma só.
 * Escolher a primeira da lista seria arbitrário: a ordem que o iFood devolve não
 * é garantida, e o mesmo pedido poderia virar 'cartao_online' ou 'dinheiro'
 * conforme a sorte — inclusive na nota fiscal.
 *
 * `detalhe` guarda a verdade completa. Perder essa informação é o que faria a
 * conferência do caixa não fechar sem ninguém entender por quê.
 */
export function pagamentoDoPedido(pedido: Record<string, unknown>): PagamentoIfood {
  const pg = (pedido.payments ?? {}) as Record<string, unknown>;
  const metodos = (Array.isArray(pg.methods) ? pg.methods : []) as Array<Record<string, unknown>>;

  if (metodos.length === 0) {
    /* Sem método declarado, o mais seguro é assumir cobrança na entrega: manda
       alguém conferir, em vez de dar o pedido como pago. */
    return { forma: 'dinheiro', online: false, trocoParaCentavos: null, detalhe: '', dividido: false };
  }

  const traduzir = (m: Record<string, unknown>): FormaPagamento => {
    const metodo = String(m.method ?? '').toUpperCase();
    const online = String(m.type ?? '').toUpperCase() === 'ONLINE' || m.prepaid === true;
    if (metodo === 'PIX') return 'pix';
    if (metodo === 'CASH') return 'dinheiro';
    /*
     * VALE-REFEIÇÃO vira 'cartao_entrega' quando é na maquininha e
     * 'cartao_online' quando é pré-pago. Não temos categoria própria, e
     * classificar como dinheiro faria a conferência da gaveta acusar sobra
     * todo dia.
     */
    return online ? 'cartao_online' : 'cartao_entrega';
  };

  const maior = metodos.reduce((a, b) => (Number(b.value ?? 0) > Number(a.value ?? 0) ? b : a));
  const forma = traduzir(maior);

  const partes = metodos.map(m => {
    const v = paraCentavos(m.value);
    const reais = (v / 100).toFixed(2).replace('.', ',');
    const bandeira = String((m.card as Record<string, unknown> | undefined)?.brand ?? '').trim();
    const nome = String(m.method ?? '?');
    return `R$ ${reais} ${nome}${bandeira ? ` ${bandeira}` : ''}`;
  });

  /*
   * TROCO: o iFood manda `changeFor` em dinheiro. Vem só quando o cliente pediu
   * troco — ausente significa "não precisa", não "zero".
   */
  const emDinheiro = metodos.find(m => String(m.method ?? '').toUpperCase() === 'CASH');
  const troco = emDinheiro && emDinheiro.cash
    ? paraCentavos((emDinheiro.cash as Record<string, unknown>).changeFor)
    : 0;

  return {
    forma,
    online: String(maior.type ?? '').toUpperCase() === 'ONLINE' || maior.prepaid === true,
    trocoParaCentavos: troco > 0 ? troco : null,
    detalhe: metodos.length > 1 ? partes.join(' + ') : '',
    dividido: metodos.length > 1,
  };
}

/** Endereço numa linha, no formato que o painel e a impressora já usam. */
export function enderecoDoPedido(pedido: Record<string, unknown>): string {
  const d = ((pedido.delivery ?? {}) as Record<string, unknown>).deliveryAddress as Record<string, unknown> | undefined;
  if (!d) return '';
  const pedaco = (v: unknown) => String(v ?? '').trim();
  const linha = [
    [pedaco(d.streetName), pedaco(d.streetNumber)].filter(Boolean).join(', '),
    pedaco(d.complement),
    pedaco(d.neighborhood),
    [pedaco(d.city), pedaco(d.state)].filter(Boolean).join(' - '),
    pedaco(d.postalCode),
  ].filter(Boolean).join(' · ');
  const ref = pedaco(d.reference);
  return ref ? `${linha} (ref: ${ref})` : linha;
}

export interface ItemTraduzido {
  nome: string;
  quantidade: number;
  precoUnitCentavos: number;
  opcoesTexto: string;
  observacao: string;
  /** Código do produto no cardápio do lojista — é como casamos com o nosso. */
  codigoExterno: string;
}

/**
 * Traduz os itens.
 *
 * O preço unitário sai de `totalPrice / quantidade` — ver o porquê no corpo,
 * logo antes do cálculo. Em resumo: `unitPrice` não inclui os complementos.
 *
 * As opções viram texto no mesmo formato dos nossos complementos
 * (`grupo: nome`), para o cupom e a comanda saírem iguais aos do cardápio
 * próprio — a cozinha não deveria precisar saber de onde o pedido veio.
 */
export function itensDoPedido(pedido: Record<string, unknown>): ItemTraduzido[] {
  const itens = (Array.isArray(pedido.items) ? pedido.items : []) as Array<Record<string, unknown>>;
  return itens.map(i => {
    const opcoes = (Array.isArray(i.options) ? i.options : []) as Array<Record<string, unknown>>;
    const texto = opcoes.map(o => {
      const grupo = String(o.groupName ?? '').trim();
      const nome = String(o.name ?? '').trim();
      const qtd = Number(o.quantity ?? 1);
      const rotulo = grupo ? `${grupo}: ${nome}` : nome;
      return qtd > 1 ? `${qtd}x ${rotulo}` : rotulo;
    }).filter(Boolean).join(' · ');

    /*
     * `Number('x')` é NaN, e `Math.max(1, NaN)` também é NaN — que gravado numa
     * coluna INT derruba a criação do pedido no meio. O `|| 1` fecha isso.
     */
    const qtdBruta = Math.trunc(Number(i.quantity ?? 1));
    const quantidade = Number.isFinite(qtdBruta) && qtdBruta > 0 ? qtdBruta : 1;

    /*
     * O PREÇO UNITÁRIO É `totalPrice / quantidade`, NÃO `unitPrice`.
     *
     * Descoberto no pedido real: o item 2 tem `unitPrice: 5.00`,
     * `optionsPrice: 8.00` e `customizationPrice: 3.00`, fechando
     * `totalPrice: 16.00`. Gravar `unitPrice` faria TODO pedido com complemento
     * sair cobrando menos — R$ 5 em vez de R$ 16, neste caso — e a diferença só
     * apareceria na conciliação, semanas depois.
     */
    /*
     * A distinção que importa é TOTAL vs UNITÁRIO, e ela não pode virar uma
     * cadeia de fallback: `totalPrice` já vem multiplicado pela quantidade,
     * `unitPrice` não. Tratar os dois igual faz o pedido de 2 unidades cobrar
     * metade (ou o dobro), conforme qual campo veio.
     */
    const temTotal = i.totalPrice !== undefined || i.price !== undefined;
    const precoUnitCentavos = temTotal
      ? Math.round(paraCentavos(i.totalPrice ?? i.price) / quantidade)
      : paraCentavos(i.unitPrice) + paraCentavos(i.optionsPrice) + paraCentavos(i.customizationPrice);

    return {
      nome: String(i.name ?? '').trim(),
      quantidade,
      precoUnitCentavos,
      opcoesTexto: texto,
      observacao: String(i.observations ?? '').trim().slice(0, 160),
      codigoExterno: String(i.externalCode ?? '').trim(),
    };
  });
}

export interface PedidoTraduzido {
  ifoodId: string;
  /** Número curto que o cliente vê no app. */
  displayId: string;
  /** Pedido de teste do sandbox — NÃO pode contar como venda. */
  teste: boolean;
  tipoEntrega: 'entrega' | 'retirada';
  endereco: string;
  clienteNome: string;
  /** Número de passagem do iFood, não o do cliente. Ver `telefoneEhDoCliente`. */
  clienteTelefone: string;
  subtotalCentavos: number;
  taxaEntregaCentavos: number;
  /** Taxa de serviço do iFood: o cliente paga, o iFood fica. Não é receita da loja. */
  taxasExtrasCentavos: number;
  descontoCentavos: number;
  totalCentavos: number;
  pagamento: PagamentoIfood;
  itens: ItemTraduzido[];
  observacoes: string;
}

/**
 * O TELEFONE DO IFOOD NUNCA É O DO CLIENTE.
 *
 * Vem como `0800 705 6070` mais um `localizer`, e expira. É uma central que
 * conecta a ligação sem revelar o número — e é justamente por isso que **não
 * recebe WhatsApp**. Mandar mensagem para ele é falar com uma central.
 *
 * Existe como função e não como comentário solto porque quem for ligar o envio
 * automático de WhatsApp precisa esbarrar nisto.
 */
export function telefoneEhDoCliente(): boolean {
  return false;
}

export function traduzirPedido(pedido: Record<string, unknown>): PedidoTraduzido {
  const total = (pedido.total ?? {}) as Record<string, unknown>;
  const delivery = (pedido.delivery ?? {}) as Record<string, unknown>;
  const cliente = (pedido.customer ?? {}) as Record<string, unknown>;
  const fone = (cliente.phone ?? {}) as Record<string, unknown>;

  const tipo = String(pedido.orderType ?? '').toUpperCase();

  return {
    ifoodId: String(pedido.id ?? ''),
    displayId: String(pedido.displayId ?? ''),
    /*
     * `isTest` precisa sobreviver até o relatório. Pedido de teste somado ao
     * faturamento é número errado no lugar onde o lojista toma decisão.
     */
    teste: pedido.isTest === true,
    tipoEntrega: tipo === 'TAKEOUT' ? 'retirada' : 'entrega',
    endereco: enderecoDoPedido(pedido),
    clienteNome: String(cliente.name ?? '').trim(),
    clienteTelefone: [String(fone.number ?? '').trim(), String(fone.localizer ?? '').trim()]
      .filter(Boolean).join(' · '),
    subtotalCentavos: paraCentavos(total.subTotal),
    taxaEntregaCentavos: paraCentavos(total.deliveryFee),
    taxasExtrasCentavos: paraCentavos(total.additionalFees),
    /* `benefits` é o desconto (cupom do iFood ou da loja). */
    descontoCentavos: paraCentavos(total.benefits),
    totalCentavos: paraCentavos(total.orderAmount),
    pagamento: pagamentoDoPedido(pedido),
    itens: itensDoPedido(pedido),
    observacoes: String(delivery.observations ?? '').trim(),
  };
}

/**
 * As contas fecham?
 *
 * Chamado antes de gravar. Se o total do iFood não bate com a soma que
 * calculamos, ALGO na tradução está errado — e um pedido com valor errado é
 * pior que um pedido recusado: sai comida, sai nota, e a diferença só aparece
 * na conciliação semanas depois.
 *
 * Devolve a diferença em centavos (0 = fecha).
 */
export function conferirTotal(p: PedidoTraduzido): number {
  const somaItens = p.itens.reduce((s, i) => s + i.precoUnitCentavos * i.quantidade, 0);
  /*
   * `taxasExtrasCentavos` entra na conta e NÃO é receita do lojista.
   *
   * No pedido real é R$ 1,00 de "Taxa de Serviço", com `liabilities: IFOOD
   * 100%` — ou seja, o cliente paga, o iFood fica. Ela está dentro do
   * `orderAmount`, então sem contá-la aqui a conferência acusaria R$ 1,00 de
   * diferença em todo pedido; e somá-la ao faturamento da loja seria pior
   * ainda, porque esse dinheiro nunca chega nela.
   */
  const esperado = somaItens + p.taxaEntregaCentavos + p.taxasExtrasCentavos - p.descontoCentavos;
  return p.totalCentavos - esperado;
}
