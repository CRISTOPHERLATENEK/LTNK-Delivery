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

/** O que a decisão precisa saber. Nada além disso. */
export interface ContextoLancamento {
  formaPagamento: string;
  novoStatus: StatusPedido;
  /** A loja tem endereço, usuário, senha e chave OCP? */
  tefConfigurado: boolean;
  /** Já lançamos este pedido antes? */
  jaLancado: boolean;
  tipoEntrega: 'entrega' | 'retirada';
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
export function statusDeLancamento(tipoEntrega: 'entrega' | 'retirada'): StatusPedido {
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
export function descricaoDaCobranca(clienteNome: string, pedidoId: number): string {
  const nome = clienteNome.trim();
  return nome ? nome : `Pedido ${pedidoId}`;
}
