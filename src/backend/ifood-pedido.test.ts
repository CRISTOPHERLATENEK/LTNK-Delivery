import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  paraCentavos, pagamentoDoPedido, enderecoDoPedido, itensDoPedido,
  traduzirPedido, conferirTotal, telefoneEhDoCliente,
} from './ifood-pedido';

/*
 * PEDIDO DE VERDADE, não exemplo da documentação.
 *
 * Gerado no sandbox do iFood em 29/08/2026, capturado pelo nosso próprio laço de
 * polling e baixado pelo `GET /orders/{id}`. Tem duas formas de pagamento, um
 * combo com complementos de dois grupos, e o telefone de passagem — três coisas
 * que nenhum exemplo inventado por mim teria.
 */
const REAL = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'ifood-pedido-teste.json'), 'utf8'),
) as Record<string, unknown>;

describe('paraCentavos', () => {
  it('converte os decimais do iFood', () => {
    expect(paraCentavos(21.0)).toBe(2100);
    expect(paraCentavos(5)).toBe(500);
    expect(paraCentavos(0.1)).toBe(10);
  });

  it('arredonda em vez de truncar', () => {
    /* 5.1*100 dá 509.9999… em ponto flutuante. Truncar viraria R$ 5,09 — um
       centavo somindo em todo pedido com dízima. */
    expect(paraCentavos(5.1)).toBe(510);
    expect(paraCentavos(16.7)).toBe(1670);
  });

  it('meio centavo cai para baixo — limite conhecido do ponto flutuante', () => {
    /*
       Documenta o comportamento REAL, não o desejado: 1.005 não existe exato em
       binário (vira 1.00499…), então arredonda para 100 e não 101.

       Deixado assim porque o iFood manda valores com DUAS casas decimais — meio
       centavo não chega aqui. Se um dia chegar, este teste falha e aponta para
       o lugar certo, que é melhor que uma correção especulativa agora. */
    expect(paraCentavos(1.005)).toBe(100);
  });

  it('ausente ou inválido é zero, não NaN', () => {
    /* NaN gravado numa coluna INT vira erro de banco no meio da criação do
       pedido, com o cliente já tendo pago. */
    for (const v of [undefined, null, '', 'abc', {}]) expect(paraCentavos(v)).toBe(0);
  });
});

describe('pagamentoDoPedido — o pedido real tem DUAS formas', () => {
  it('escolhe a de MAIOR valor, não a primeira', () => {
    /* A ordem que o iFood devolve não é garantida. Pegar a primeira faria o
       mesmo pedido virar uma forma ou outra conforme a sorte — inclusive na
       nota fiscal. */
    const p = pagamentoDoPedido(REAL);
    expect(p.dividido).toBe(true);
    expect(p.forma).toBe('cartao_online');
  });

  it('escolhe a maior MESMO quando ela não é a primeira', () => {
    /*
     * O pedido real não prova isto: nele a primeira JÁ É a maior (17 antes de
     * 10), então "pegar a primeira" e "pegar a maior" dão o mesmo resultado.
     * Descoberto sabotando — a versão errada passava em todos os testes.
     *
     * Aqui o dinheiro vem primeiro e é o MENOR. Se a regra fosse "a primeira",
     * este pedido seria marcado como pago em espécie na entrega, quando na
     * verdade a maior parte já está paga online.
     */
    const p = pagamentoDoPedido({
      payments: {
        methods: [
          { value: 5, method: 'CASH', type: 'OFFLINE' },
          { value: 45, method: 'CREDIT', type: 'ONLINE', prepaid: true },
        ],
      },
    });
    expect(p.forma).toBe('cartao_online');
    expect(p.online).toBe(true);
  });

  it('guarda a verdade completa no detalhe', () => {
    /* Perder isso é o que faria a conferência do caixa não fechar sem ninguém
       entender por quê. */
    const p = pagamentoDoPedido(REAL);
    expect(p.detalhe).toContain('R$ 17,00');
    expect(p.detalhe).toContain('R$ 10,00');
    expect(p.detalhe).toContain('Visa');
    expect(p.detalhe).toContain('Master');
  });

  it('forma única não gera detalhe', () => {
    const p = pagamentoDoPedido({ payments: { methods: [{ value: 30, method: 'PIX', type: 'ONLINE' }] } });
    expect(p).toMatchObject({ forma: 'pix', dividido: false, detalhe: '' });
  });

  it('dinheiro na entrega não é online', () => {
    const p = pagamentoDoPedido({ payments: { methods: [{ value: 30, method: 'CASH', type: 'OFFLINE' }] } });
    expect(p).toMatchObject({ forma: 'dinheiro', online: false });
  });

  it('lê o troco quando o cliente pediu', () => {
    const p = pagamentoDoPedido({
      payments: { methods: [{ value: 30, method: 'CASH', type: 'OFFLINE', cash: { changeFor: 50 } }] },
    });
    expect(p.trocoParaCentavos).toBe(5000);
  });

  it('sem troco pedido é null, não zero', () => {
    /* Zero significaria "não precisa de troco" tanto quanto "troco de zero
       reais". null diz que o cliente não pediu. */
    const p = pagamentoDoPedido({ payments: { methods: [{ value: 30, method: 'CASH' }] } });
    expect(p.trocoParaCentavos).toBeNull();
  });

  it('vale-refeição na maquininha é cartão na entrega, não dinheiro', () => {
    /* Classificar como dinheiro faria a conferência da gaveta acusar sobra
       todo dia. */
    const p = pagamentoDoPedido({ payments: { methods: [{ value: 30, method: 'MEAL_VOUCHER', type: 'OFFLINE' }] } });
    expect(p.forma).toBe('cartao_entrega');
  });

  it('sem método declarado, assume cobrança na entrega', () => {
    /* Manda alguém conferir, em vez de dar o pedido como pago. */
    const p = pagamentoDoPedido({});
    expect(p).toMatchObject({ forma: 'dinheiro', online: false });
  });
});

describe('itensDoPedido — contra o pedido real', () => {
  it('lê os dois itens', () => {
    const itens = itensDoPedido(REAL);
    expect(itens).toHaveLength(2);
    expect(itens[0].nome).toContain('PRODUTO 1');
    expect(itens[0].precoUnitCentavos).toBe(500);
  });

  it('divide o total pela quantidade, sem multiplicar duas vezes', () => {
    /* `totalPrice` já vem multiplicado pela quantidade. Gravá-lo direto faria o
       pedido de 3 unidades cobrar o triplo do triplo. */
    const itens = itensDoPedido({
      items: [{ name: 'X', quantity: 3, unitPrice: 10, totalPrice: 30 }],
    });
    expect(itens[0].precoUnitCentavos).toBe(1000);
  });

  it('monta os complementos no formato "grupo: nome"', () => {
    /* Mesmo formato dos nossos, para o cupom e a comanda saírem iguais aos do
       cardápio próprio — a cozinha não deveria saber de onde o pedido veio. */
    const combo = itensDoPedido(REAL).find(i => i.nome.includes('COMBO'))!;
    expect(combo.opcoesTexto).toContain('Adicione mais ingredientes: Complemento 1');
    expect(combo.opcoesTexto).toContain('Deseja adicionar molhos?: Complemento 2');
  });

  it('guarda o código externo, que é como casamos com o nosso produto', () => {
    expect(itensDoPedido(REAL)[0].codigoExterno).toBe('3873');
  });

  it('quantidade nunca é zero, fracionada nem NaN', () => {
    /* `Number('x')` é NaN e `Math.max(1, NaN)` TAMBÉM é NaN — que gravado numa
       coluna INT derruba a criação do pedido no meio. Pego por este teste. */
    for (const q of [0, -1, 0.5, undefined, 'x', null, {}]) {
      const qtd = itensDoPedido({ items: [{ name: 'X', quantity: q }] })[0].quantidade;
      expect(Number.isInteger(qtd)).toBe(true);
      expect(qtd).toBeGreaterThanOrEqual(1);
    }
  });

  it('o preço unitário inclui os complementos', () => {
    /* O ACHADO do pedido real: item com unitPrice 5,00, optionsPrice 8,00 e
       customizationPrice 3,00 fecha em totalPrice 16,00. Gravar unitPrice faria
       TODO pedido com complemento cobrar menos, e a diferença só apareceria na
       conciliação semanas depois. */
    const combo = itensDoPedido(REAL).find(i => i.nome.includes('COMBO'))!;
    expect(combo.precoUnitCentavos).toBe(1600);
  });

  it('observação é cortada em 160, que é o tamanho da coluna', () => {
    const longa = 'a'.repeat(300);
    expect(itensDoPedido({ items: [{ name: 'X', observations: longa }] })[0].observacao).toHaveLength(160);
  });

  it('complemento com quantidade maior que 1 aparece com o número', () => {
    const i = itensDoPedido({
      items: [{ name: 'X', options: [{ groupName: 'Bordas', name: 'Cheddar', quantity: 2 }] }],
    });
    expect(i[0].opcoesTexto).toBe('2x Bordas: Cheddar');
  });
});

describe('enderecoDoPedido', () => {
  it('monta o endereço do pedido real', () => {
    const e = enderecoDoPedido(REAL);
    expect(e).toContain('Rua TESTE, 999999');
    expect(e).toContain('Bairro TESTE');
    expect(e).toContain('ref: TESTE');
  });

  it('pedido sem endereço não quebra', () => {
    /* Retirada não tem endereço de entrega. */
    expect(enderecoDoPedido({})).toBe('');
    expect(enderecoDoPedido({ delivery: {} })).toBe('');
  });
});

describe('traduzirPedido — o pedido real inteiro', () => {
  const p = traduzirPedido(REAL);

  it('identifica o pedido', () => {
    expect(p.ifoodId).toBe('795f9746-ff2a-4ef3-b0ac-d4e7ec50d65f');
    expect(p.displayId).toBe('2438');
    expect(p.tipoEntrega).toBe('entrega');
  });

  it('MARCA como teste', () => {
    /* Pedido de teste somado ao faturamento é número errado no lugar onde o
       lojista toma decisão. */
    expect(p.teste).toBe(true);
  });

  it('converte todos os valores', () => {
    expect(p.subtotalCentavos).toBe(2100);
    expect(p.taxaEntregaCentavos).toBe(500);
    expect(p.totalCentavos).toBe(2700);
    expect(p.descontoCentavos).toBe(0);
  });

  it('retirada não vira entrega', () => {
    expect(traduzirPedido({ ...REAL, orderType: 'TAKEOUT' }).tipoEntrega).toBe('retirada');
  });

  it('payload vazio não estoura', () => {
    /* Um pedido malformado não pode derrubar o ciclo inteiro e travar as
       outras lojas. */
    const v = traduzirPedido({});
    expect(v.totalCentavos).toBe(0);
    expect(v.itens).toEqual([]);
  });
});

describe('conferirTotal', () => {
  it('o pedido real fecha em ZERO', () => {
    /*
     * Fecha só depois de duas correções que este teste forçou: contar os
     * complementos no preço do item (R$ 16, não R$ 5) e contar a taxa de
     * serviço do iFood (R$ 1,00, que o cliente paga e o iFood fica).
     *
     * 5,00 + 16,00 + 5,00 de entrega + 1,00 de taxa = 27,00 = orderAmount.
     */
    expect(conferirTotal(traduzirPedido(REAL))).toBe(0);
  });

  it('a taxa de serviço do iFood é separada do faturamento da loja', () => {
    /* `liabilities: IFOOD 100%` no payload: o cliente paga, o iFood fica.
       Somá-la à receita da loja seria inventar dinheiro que nunca chega. */
    expect(traduzirPedido(REAL).taxasExtrasCentavos).toBe(100);
  });

  it('pedido simples fecha em zero', () => {
    const p = traduzirPedido({
      items: [{ name: 'X', quantity: 2, unitPrice: 10 }],
      total: { subTotal: 20, deliveryFee: 5, benefits: 0, orderAmount: 25 },
    });
    expect(conferirTotal(p)).toBe(0);
  });

  it('desconto entra na conta', () => {
    const p = traduzirPedido({
      items: [{ name: 'X', quantity: 1, unitPrice: 30 }],
      total: { subTotal: 30, deliveryFee: 0, benefits: 5, orderAmount: 25 },
    });
    expect(conferirTotal(p)).toBe(0);
  });
});

describe('telefoneEhDoCliente', () => {
  it('é sempre falso, e existe para quem for ligar o WhatsApp esbarrar', () => {
    /* O número vem como 0800 + localizador com expiração: é uma central que
       conecta a ligação sem revelar o número do cliente. Mandar WhatsApp para
       ele é falar com uma central. */
    expect(telefoneEhDoCliente()).toBe(false);
    expect(traduzirPedido(REAL).clienteTelefone).toContain('0800');
  });
});
