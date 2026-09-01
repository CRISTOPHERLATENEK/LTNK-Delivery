/**
 * QUANDO LANÇAR O PEDIDO NA MAQUININHA.
 *
 * A regra mora aqui, longe da rede e do banco, porque errar nela custa dinheiro
 * de duas formas opostas — e as duas são fáceis de cometer:
 *
 * - LANÇAR DEMAIS: um pedido pago no Pix vira cobrança na maquininha, o
 *   entregador passa o cartão do cliente, e ele paga duas vezes. O sistema não
 *   percebe, porque as duas cobranças "deram certo".
 * - LANÇAR DE MENOS: o entregador chega sem a cobrança e digita o valor na mão,
 *   que é exatamente o que a integração existe para acabar.
 *
 * SÓ `cartao_entrega` VAI. As outras três formas não passam pela maquininha:
 * Pix e cartão online já foram pagos antes de o pedido sair, e dinheiro não tem
 * cartão envolvido. Isso não é economia de chamada — é a diferença entre cobrar
 * uma vez e cobrar duas.
 */
import type { StatusPedido } from '../tipos/modelos';

/** Quem emite a NFC-e da loja. */
export type EmissorNfce = 'sistema' | 'maquininha';

/** O que a decisão precisa saber. Nada além disso. */
export interface ContextoLancamento {
  formaPagamento: string;
  novoStatus: StatusPedido;
  /** A loja tem endereço, usuário, senha e chave OCP? */
  tefConfigurado: boolean;
  /** Já lançamos este pedido antes? */
  jaLancado: boolean;
  tipoEntrega: 'entrega' | 'retirada';
  /**
   * QUEM EMITE A NOTA MUDA O QUE VAI PARA O APARELHO.
   *
   * Com `sistema` (o padrão, e o caso de todas as lojas menos as que pediram o
   * contrário), a maquininha existe só para COBRAR: vai o que precisa de
   * cartão, e mais nada.
   *
   * Com `maquininha`, ela também EMITE — e uma venda que não chega lá é uma
   * venda sem nota fiscal. Aí todo pedido precisa subir, inclusive os que já
   * foram pagos no Pix ou no cartão online, porque a nota deles também sai de
   * lá.
   */
  emissorNfce: EmissorNfce;
}

/**
 * O dinheiro já entrou antes de o pedido sair?
 *
 * Estas duas formas são cobradas no app, no ato. `dinheiro` e `cartao_entrega`
 * são recebidas na porta, e por isso não entram aqui.
 */
export function ehPagoOnline(formaPagamento: string): boolean {
  return formaPagamento === 'pix' || formaPagamento === 'cartao_online';
}

/**
 * O MOMENTO É A SAÍDA PARA ENTREGA, não o aceite.
 *
 * Lançar no aceite encheria a lista de precontas do aparelho com pedidos que
 * ainda estão na cozinha — e o entregador teria que achar o dele no meio. Na
 * saída, a preconta que aparece é a que ele vai cobrar em minutos.
 *
 * Em RETIRADA não existe "saiu para entrega": o cliente vem buscar, e o
 * pagamento acontece no balcão, pelo PDV. Por isso o status de gatilho é outro.
 */
export function statusDeLancamento(
  tipoEntrega: 'entrega' | 'retirada',
  jaPago = false,
): StatusPedido {
  /*
   * PEDIDO JÁ PAGO SOBE QUANDO FICA PRONTO, não quando sai.
   *
   * Ele só vai para o aparelho quando a maquininha é quem emite a nota, e a
   * nota tem que ir DENTRO da sacola. Esperar o "saiu para entrega" seria pedir
   * ao operador que emitisse o cupom de um pedido que já está na rua.
   */
  if (jaPago) return 'pronto';
  return tipoEntrega === 'retirada' ? 'pronto' : 'em_entrega';
}

export function deveLancarNaMaquininha(c: ContextoLancamento): boolean {
  /*
   * `jaLancado` é a guarda mais importante do arquivo. O `newItem` do PDV MOBI
   * NÃO é idempotente — provado chamando duas vezes com o mesmo `IDCobranca` e
   * recebendo dois itens na mesma preconta. Sem esta trava, uma reentrada de
   * status (o lojista clica duas vezes, o pedido volta a 'em_entrega') dobraria
   * o valor a cobrar do cliente.
   */
  if (c.jaLancado) return false;
  if (!c.tefConfigurado) return false;

  const pago = ehPagoOnline(c.formaPagamento);

  if (c.emissorNfce === 'maquininha') {
    /*
     * AQUI A MAQUININHA É O EMISSOR FISCAL, e não deixar um pedido subir é
     * deixá-lo sem nota. Por isso todas as formas passam — inclusive as já
     * pagas, que sobem para serem FINALIZADAS (Faturado, `tPag` 99), não
     * cobradas. A trava contra a cobrança em dobro dessas está na descrição,
     * que chega no aparelho marcada como PAGO.
     */
    return c.novoStatus === statusDeLancamento(c.tipoEntrega, pago);
  }

  /* Emissor = sistema: a maquininha só cobra. Um pedido já pago que subisse
     aqui viraria cobrança na mão do entregador, e o cliente pagaria duas vezes. */
  if (c.formaPagamento !== 'cartao_entrega') return false;
  return c.novoStatus === statusDeLancamento(c.tipoEntrega);
}

/**
 * O identificador da cobrança é o ID DO PEDIDO.
 *
 * Estável por natureza, numérico como o campo exige, e único na loja. Um
 * contador próprio seria um segundo número para conciliar — e no dia de
 * investigar uma cobrança errada, ninguém quer traduzir "preconta 990020" para
 * "pedido 85".
 */
export function idCobrancaDoPedido(pedidoId: number): number {
  return pedidoId;
}

/**
 * O que aparece na preconta, para o entregador reconhecer.
 *
 * Nome do cliente, não "Pedido 85": quem olha a tela do aparelho na porta da
 * casa está conferindo com a pessoa à sua frente, não com o nosso banco.
 */
export function descricaoDaCobranca(
  clienteNome: string,
  pedidoId: number,
  jaPago = false,
): string {
  const nome = clienteNome.trim() || `Pedido ${pedidoId}`;
  /*
   * O "PAGO" É UMA TRAVA, NÃO UM ENFEITE.
   *
   * Quando a maquininha emite a nota, pedidos já pagos no app sobem para o
   * aparelho — e ali eles ficam idênticos a uma cobrança de verdade. Quem está
   * na frente da tela precisa ver, antes de escolher a forma, que este não
   * pode ser cobrado de novo: é Faturado, não crédito. Sem essa marca, o erro
   * de um toque é o cliente pagando duas vezes pelo mesmo pedido.
   */
  return jaPago ? `${nome} · PAGO` : nome;
}
