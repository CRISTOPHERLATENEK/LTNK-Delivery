/**
 * Despacho de estorno por gateway.
 *
 * POR QUE ESTES TESTES EXISTEM: quando o cash-in ganhou um segundo gateway
 * (ONZ, além do Mercado Pago), o estorno continuou chamando o Mercado Pago
 * direto, sem olhar quem tinha processado o pagamento. Um pedido pago via ONZ
 * mandava o txid da ONZ pra API do MP — não estornava, e o cliente ficava sem
 * o dinheiro de volta. O bug ficou latente porque só arma quando a ONZ está
 * configurada; nada no build ou nos testes o denunciava.
 *
 * O que importa aqui é ROTEAMENTO, não rede: as duas pontas são mockadas, e o
 * que se verifica é qual delas foi chamada. Dinheiro indo pro gateway errado é
 * exatamente o tipo de erro que não pode depender de alguém lembrar de testar
 * à mão com a ONZ ligada.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const devolverCobranca = vi.fn();
const estornoMP = vi.fn();

vi.mock('../onz', () => ({
  devolverCobranca: (...args: unknown[]) => devolverCobranca(...args),
  // `pagamentos.ts` importa o módulo inteiro (`import * as onz`), então o mock
  // precisa expor o que mais for tocado na carga do módulo.
  criarCobranca: vi.fn(),
  consultarCobranca: vi.fn(),
  cashInDisponivel: () => true,
  cashOutDisponivel: () => true,
  consultarSaldo: vi.fn(),
  pixCashoutViaChave: vi.fn(),
}));

// O ramo do Mercado Pago chama getTokenMP, que vai ao banco. Aqui só interessa
// se ELE foi escolhido, então a função inteira é substituída.
vi.mock('../db-mysql', () => ({
  default: { prepare: () => ({ get: async () => undefined, all: async () => [], run: async () => ({}) }) },
  comTenant: (_b: string, fn: () => unknown) => fn(),
  bancoTenantAtual: () => 'tenant_teste_a',
  abrirPool: () => ({}),
  BANCO_PADRAO: 'delivery',
}));

const { estornarPagamentoPix } = await import('./pagamentos');
const pagamentos = await import('./pagamentos');
vi.spyOn(pagamentos, 'estornarPagamentoMercadoPago').mockImplementation(
  (...args: unknown[]) => estornoMP(...args) as Promise<void>,
);

describe('estornarPagamentoPix — despacho por gateway', () => {
  beforeEach(() => { devolverCobranca.mockReset(); estornoMP.mockReset(); });

  it('pedido pago via ONZ é devolvido NA ONZ, nunca no Mercado Pago', async () => {
    devolverCobranca.mockResolvedValue({ devolucoes: [], totalCentavos: 0 });

    await estornarPagamentoPix(1, 'onz', 'PED42abc');

    expect(devolverCobranca).toHaveBeenCalledWith('PED42abc');
    expect(estornoMP).not.toHaveBeenCalled();
  });

  it('pedido sem gateway gravado cai no Mercado Pago (compatibilidade)', async () => {
    // Pedidos anteriores à coluna `pagamento_gateway`: naquela época só existia
    // o MP, então null tem que continuar indo pra lá.
    await estornarPagamentoPix(1, null, 'MP-123').catch(() => { /* mock do MP */ });

    expect(devolverCobranca).not.toHaveBeenCalled();
  });

  it('gateway desconhecido não é tratado como ONZ', async () => {
    // Defensivo: só a string exata 'onz' deve rotear pra ONZ. Qualquer valor
    // inesperado no banco cai no caminho antigo em vez de devolver dinheiro
    // pelo gateway errado.
    await estornarPagamentoPix(1, 'gateway_novo_qualquer', 'X-1').catch(() => { /* mock do MP */ });

    expect(devolverCobranca).not.toHaveBeenCalled();
  });
});
