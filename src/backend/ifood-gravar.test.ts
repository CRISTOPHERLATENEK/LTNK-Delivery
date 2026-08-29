import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { gravarPedidoIfood, type DepsGravar, type DadosPedido } from './ifood-gravar';

const REAL = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'ifood-pedido-teste.json'), 'utf8'),
) as Record<string, unknown>;

function montar(over: Partial<DepsGravar> = {}) {
  const inseridos: DadosPedido[] = [];
  const avisos: string[] = [];
  const deps: DepsGravar = {
    pedidoExistente: over.pedidoExistente ?? (async () => null),
    consumidorIfood: over.consumidorIfood ?? (async () => 99),
    produtoPorCodigo: over.produtoPorCodigo ?? (async () => null),
    inserir: over.inserir ?? (async d => { inseridos.push(d); return 1234; }),
    registrar: over.registrar ?? ((n, m) => { if (n === 'erro') avisos.push(m); }),
  };
  return { deps, inseridos, avisos };
}

describe('gravarPedidoIfood — o pedido real', () => {
  it('cria o pedido com os valores certos', async () => {
    const { deps, inseridos } = montar();
    const r = await gravarPedidoIfood(7, REAL, deps);

    expect(r).toMatchObject({ pedidoId: 1234, criado: true });
    expect(inseridos[0]).toMatchObject({
      lojaId: 7,
      clienteId: 99,
      origem: 'ifood',
      status: 'pendente',
      tipoEntrega: 'entrega',
      subtotalCentavos: 2100,
      taxaEntregaCentavos: 500,
      totalCentavos: 2700,
      gatewayId: '795f9746-ff2a-4ef3-b0ac-d4e7ec50d65f',
    });
    expect(inseridos[0].itens).toHaveLength(2);
  });

  it('nasce PENDENTE, não aceito', async () => {
    /* PLACED diz que o cliente pediu, não que a loja aceitou — e a confirmação
       tem SLA no iFood. Criar já aceito seria confirmar em nome do lojista sem
       ele ter visto. */
    const { deps, inseridos } = montar();
    await gravarPedidoIfood(7, REAL, deps);
    expect(inseridos[0].status).toBe('pendente');
  });

  it('pago online vira pagamento aprovado', async () => {
    const { deps, inseridos } = montar();
    await gravarPedidoIfood(7, REAL, deps);
    expect(inseridos[0].pagamentoStatus).toBe('aprovado');
  });

  it('pago na entrega NÃO vira aprovado', async () => {
    /* Marcar tudo como aprovado faria o entregador não cobrar quem devia pagar. */
    const { deps, inseridos } = montar();
    await gravarPedidoIfood(7, {
      ...REAL,
      payments: { methods: [{ value: 27, method: 'CASH', type: 'OFFLINE' }] },
    }, deps);
    expect(inseridos[0].pagamentoStatus).toBe('na_entrega');
    expect(inseridos[0].formaPagamento).toBe('dinheiro');
  });

  it('põe o número do iFood nas observações', async () => {
    /* Sem o displayId na tela ninguém casa uma reclamação do cliente com o
       pedido daqui. */
    const { deps, inseridos } = montar();
    await gravarPedidoIfood(7, REAL, deps);
    expect(inseridos[0].observacoes).toContain('iFood #2438');
  });

  it('marca visivelmente que é pedido de TESTE', async () => {
    const { deps, inseridos } = montar();
    await gravarPedidoIfood(7, REAL, deps);
    expect(inseridos[0].observacoes).toContain('PEDIDO DE TESTE');
  });

  it('registra o pagamento dividido, que a coluna não comporta', async () => {
    const { deps, inseridos } = montar();
    await gravarPedidoIfood(7, REAL, deps);
    expect(inseridos[0].observacoes).toContain('R$ 17,00');
    expect(inseridos[0].observacoes).toContain('R$ 10,00');
  });
});

describe('gravarPedidoIfood — não duplicar', () => {
  it('pedido que já existe não é criado de novo', async () => {
    /* A deduplicação de eventos não basta: dois eventos DIFERENTES podem se
       referir ao mesmo pedido. Sem esta trava, a cozinha produz duas vezes. */
    const { deps, inseridos } = montar({ pedidoExistente: async () => 555 });
    const r = await gravarPedidoIfood(7, REAL, deps);
    expect(r).toMatchObject({ pedidoId: 555, criado: false });
    expect(inseridos).toHaveLength(0);
  });

  it('procura pelo id do iFood, não pelo do evento', async () => {
    let procurado = '';
    const { deps } = montar({ pedidoExistente: async id => { procurado = id; return null; } });
    await gravarPedidoIfood(7, REAL, deps);
    expect(procurado).toBe('795f9746-ff2a-4ef3-b0ac-d4e7ec50d65f');
  });

  it('pedido sem id não é gravado', async () => {
    const { deps, inseridos } = montar();
    const r = await gravarPedidoIfood(7, { ...REAL, id: '' }, deps);
    expect(r.criado).toBe(false);
    expect(inseridos).toHaveLength(0);
  });
});

describe('gravarPedidoIfood — as contas precisam fechar', () => {
  it('RECUSA quando o total não bate', async () => {
    /* Gravar assim mesmo é o pior desfecho: a comida sai, a nota sai, e a
       diferença só aparece na conciliação semanas depois. */
    const { deps, inseridos, avisos } = montar();
    const r = await gravarPedidoIfood(7, {
      ...REAL,
      total: { subTotal: 21, deliveryFee: 5, benefits: 0, additionalFees: 1, orderAmount: 99 },
    }, deps);
    expect(r.criado).toBe(false);
    expect(r.motivo).toContain('divergência');
    expect(inseridos).toHaveLength(0);
    expect(avisos.join(' ')).toContain('não fecham');
  });

  it('tolera 1 centavo de arredondamento', async () => {
    /* Arredondamento de item existe. Recusar um pedido bom por um centavo seria
       pior que aceitá-lo. */
    const { deps, inseridos } = montar();
    const r = await gravarPedidoIfood(7, {
      ...REAL,
      total: { subTotal: 21, deliveryFee: 5, benefits: 0, additionalFees: 1, orderAmount: 27.01 },
    }, deps);
    expect(r.criado).toBe(true);
    expect(inseridos).toHaveLength(1);
  });
});

describe('gravarPedidoIfood — produto que não existe aqui', () => {
  it('grava o pedido mesmo assim, com produto_id nulo', async () => {
    /* O cardápio do iFood é mantido lá e pode divergir do nosso. Recusar o
       pedido inteiro transformaria um problema de cadastro num pedido perdido,
       com o cliente já tendo pago. */
    const { deps, inseridos } = montar({ produtoPorCodigo: async () => null });
    const r = await gravarPedidoIfood(7, REAL, deps);
    expect(r.criado).toBe(true);
    expect(inseridos[0].itens.every(i => i.produtoId === null)).toBe(true);
    /* O nome vem do iFood, então cozinha e cupom continuam corretos. */
    expect(inseridos[0].itens[0].nome).toContain('PRODUTO 1');
  });

  it('mas AVISA, porque não há baixa de estoque', async () => {
    const { deps, avisos } = montar({ produtoPorCodigo: async () => null });
    await gravarPedidoIfood(7, REAL, deps);
    expect(avisos.join(' ')).toContain('sem baixa de estoque');
    expect(avisos.join(' ')).toContain('3873');
  });

  it('casa pelo código externo quando o produto existe', async () => {
    const { deps, inseridos, avisos } = montar({
      produtoPorCodigo: async (_l, cod) => (cod === '3873' ? 42 : null),
    });
    await gravarPedidoIfood(7, REAL, deps);
    expect(inseridos[0].itens[0].produtoId).toBe(42);
    /* O segundo item continua sem casar, e o aviso fala só dele. */
    expect(avisos.join(' ')).toContain('COMBO');
    expect(avisos.join(' ')).not.toContain('3873');
  });

  it('item sem código externo nem tenta buscar', async () => {
    let buscas = 0;
    const { deps } = montar({ produtoPorCodigo: async () => { buscas++; return null; } });
    await gravarPedidoIfood(7, { ...REAL, items: [{ name: 'X', quantity: 1, totalPrice: 27 }],
      total: { subTotal: 27, deliveryFee: 0, benefits: 0, additionalFees: 0, orderAmount: 27 } }, deps);
    expect(buscas).toBe(0);
  });
});

describe('gravarPedidoIfood — retirada', () => {
  it('sem endereço, usa um texto em vez de gravar vazio', async () => {
    /* `endereco_entrega` é NOT NULL, e string vazia na tela do entregador é
       pior que uma frase. */
    const { deps, inseridos } = montar();
    await gravarPedidoIfood(7, { ...REAL, orderType: 'TAKEOUT', delivery: {} }, deps);
    expect(inseridos[0].tipoEntrega).toBe('retirada');
    expect(inseridos[0].enderecoEntrega).toBe('Retirada no balcão');
  });
});
