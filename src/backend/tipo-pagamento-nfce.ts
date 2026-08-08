/**
 * De que forma o pedido foi pago, na linguagem da NFC-e.
 *
 * POR QUE ISTO EXISTE: o sistema tinha um balde só chamado "cartão", que virava
 * sempre tPag **03 (crédito)**. Quem pagava no **débito** saía declarado como
 * crédito na nota — e sem nenhum erro aparecendo, porque 03 é um código válido e
 * a SEFAZ autoriza normalmente. Documento fiscal com informação errada é o tipo
 * de problema que só aparece na fiscalização.
 *
 * O dado sempre existiu: o Mercado Pago devolve `payment_type_id` em todo
 * pagamento. A gente lia só o `status` e jogava o resto fora.
 */

/** Chaves aceitas pelo montador do XML (ver TPAG em nfce.ts). */
export type TipoPagNfce = 'dinheiro' | 'pix' | 'cartao_credito' | 'cartao_debito' | 'outros';

/**
 * Traduz a forma do pedido + o tipo devolvido pelo gateway.
 *
 * `tipoGateway` é o `payment_type_id` do Mercado Pago, e só existe em pagamento
 * online. Quando falta (pedido antigo, ou cartão na maquininha), cai em crédito
 * — que é o comportamento de antes e o caso mais comum, mas é PALPITE, e está
 * marcado como tal em `ehPalpite`.
 */
export function tipoPagamentoNfce(
  formaPagamento: string,
  tipoGateway?: string | null,
): { tipo: TipoPagNfce; ehPalpite: boolean } {
  if (formaPagamento === 'dinheiro') return { tipo: 'dinheiro', ehPalpite: false };
  if (formaPagamento === 'pix') return { tipo: 'pix', ehPalpite: false };

  if (formaPagamento === 'cartao_online') {
    switch (tipoGateway) {
      case 'credit_card': return { tipo: 'cartao_credito', ehPalpite: false };
      case 'debit_card': return { tipo: 'cartao_debito', ehPalpite: false };
      /*
       * Cartão PRÉ-PAGO é cartão de débito pra fins de tPag: o dinheiro sai na
       * hora, não vira fatura. Declarar crédito seria errado do mesmo jeito.
       */
      case 'prepaid_card': return { tipo: 'cartao_debito', ehPalpite: false };
      /*
       * Saldo em conta do Mercado Pago não é cartão nem dinheiro em espécie.
       * Vai como 99 (outros), com a descrição exigida pelo leiaute — melhor um
       * "outros" honesto que um crédito inventado.
       */
      case 'account_money': return { tipo: 'outros', ehPalpite: false };
      case 'bank_transfer': return { tipo: 'pix', ehPalpite: false };
      default: return { tipo: 'cartao_credito', ehPalpite: true };
    }
  }

  // `cartao_entrega`: maquininha do entregador. O sistema não conversa com ela,
  // então não há como saber se foi crédito ou débito sem alguém informar.
  return { tipo: 'cartao_credito', ehPalpite: formaPagamento === 'cartao_entrega' };
}
