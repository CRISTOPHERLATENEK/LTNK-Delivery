import { describe, it, expect } from 'vitest';
import { tipoPagamentoNfce } from './tipo-pagamento-nfce';

describe('tipoPagamentoNfce', () => {
  it('débito online sai como débito, não como crédito', () => {
    // O bug que motivou tudo: débito era declarado como tPag 03 (crédito).
    expect(tipoPagamentoNfce('cartao_online', 'debit_card'))
      .toEqual({ tipo: 'cartao_debito', ehPalpite: false });
  });

  it('crédito online sai como crédito', () => {
    expect(tipoPagamentoNfce('cartao_online', 'credit_card'))
      .toEqual({ tipo: 'cartao_credito', ehPalpite: false });
  });

  it('pré-pago conta como débito — o dinheiro sai na hora', () => {
    expect(tipoPagamentoNfce('cartao_online', 'prepaid_card'))
      .toEqual({ tipo: 'cartao_debito', ehPalpite: false });
  });

  it('saldo do Mercado Pago vai como outros, não como cartão inventado', () => {
    expect(tipoPagamentoNfce('cartao_online', 'account_money'))
      .toEqual({ tipo: 'outros', ehPalpite: false });
  });

  it('dinheiro e Pix não dependem do gateway', () => {
    expect(tipoPagamentoNfce('dinheiro', null)).toEqual({ tipo: 'dinheiro', ehPalpite: false });
    expect(tipoPagamentoNfce('pix', null)).toEqual({ tipo: 'pix', ehPalpite: false });
  });

  it('cartão online sem tipo gravado cai em crédito, mas ASSUMIDO', () => {
    // Pedidos anteriores à coluna: não dá pra afirmar, e a nota precisa sair.
    expect(tipoPagamentoNfce('cartao_online', null))
      .toEqual({ tipo: 'cartao_credito', ehPalpite: true });
  });

  it('maquininha na entrega é palpite — o sistema não fala com ela', () => {
    expect(tipoPagamentoNfce('cartao_entrega', null))
      .toEqual({ tipo: 'cartao_credito', ehPalpite: true });
  });

  it('tipo desconhecido do gateway não vira certeza', () => {
    expect(tipoPagamentoNfce('cartao_online', 'coisa_nova').ehPalpite).toBe(true);
  });
});
