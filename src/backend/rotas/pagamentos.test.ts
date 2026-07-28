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
// `linhaLoja` deixa cada teste decidir o que o SELECT da loja devolve (usado
// pra simular loja com/sem credenciais próprias da ONZ).
let linhaLoja: Record<string, unknown> | undefined;
vi.mock('../db-mysql', () => ({
  default: { prepare: () => ({ get: async () => linhaLoja, all: async () => [], run: async () => ({}) }) },
  comTenant: (_b: string, fn: () => unknown) => fn(),
  bancoTenantAtual: () => 'tenant_teste_a',
  abrirPool: () => ({}),
  BANCO_PADRAO: 'delivery',
}));

// Os segredos da loja ficam criptografados no banco; aqui o "decifrar" é só
// remover o prefixo, o que mantém o teste sem dependência de APP_SECRET.
vi.mock('../cripto', () => ({
  criptografar: (v: string) => `cif:${v}`,
  descriptografar: (v: string) => {
    if (!String(v).startsWith('cif:')) throw new Error('valor não decifrável');
    return String(v).slice(4);
  },
}));

const { estornarPagamentoPix } = await import('./pagamentos');
const pagamentos = await import('./pagamentos');
vi.spyOn(pagamentos, 'estornarPagamentoMercadoPago').mockImplementation(
  (...args: unknown[]) => estornoMP(...args) as Promise<void>,
);

describe('estornarPagamentoPix — despacho por gateway', () => {
  beforeEach(() => { devolverCobranca.mockReset(); estornoMP.mockReset(); linhaLoja = undefined; });

  it('pedido pago via ONZ é devolvido NA ONZ, nunca no Mercado Pago', async () => {
    devolverCobranca.mockResolvedValue({ devolucoes: [], totalCentavos: 0 });

    await estornarPagamentoPix(1, 'onz', 'PED42abc');

    expect(devolverCobranca).toHaveBeenCalledWith('PED42abc', null);
    expect(estornoMP).not.toHaveBeenCalled();
  });

  /**
   * Cada cliente tem a PRÓPRIA conta na ONZ, então a devolução precisa sair da
   * conta que recebeu. Se as credenciais da loja não fossem repassadas, o
   * estorno iria pra conta da plataforma e a ONZ recusaria (txid inexistente
   * lá) — cliente sem o dinheiro de volta e ninguém saberia por quê.
   */
  it('devolve usando as credenciais DA LOJA quando ela tem conta própria', async () => {
    linhaLoja = {
      onz_client_id: 'cif:id-da-loja',
      onz_client_secret: 'cif:secret-da-loja',
      onz_pix_key: 'chave-pix-da-loja',
    };
    devolverCobranca.mockResolvedValue({ devolucoes: [], totalCentavos: 0 });

    await estornarPagamentoPix(7, 'onz', 'PED99xyz');

    expect(devolverCobranca).toHaveBeenCalledWith('PED99xyz', {
      clientId: 'id-da-loja',
      clientSecret: 'secret-da-loja',
      chavePix: 'chave-pix-da-loja',
    });
  });

  /**
   * Credencial ilegível (APP_SECRET trocado, dado corrompido) não pode derrubar
   * o estorno: cai na conta da plataforma em vez de estourar exceção.
   */
  it('credencial ilegível cai no fallback da plataforma, sem quebrar', async () => {
    linhaLoja = { onz_client_id: 'lixo', onz_client_secret: 'lixo', onz_pix_key: 'k' };
    devolverCobranca.mockResolvedValue({ devolucoes: [], totalCentavos: 0 });

    await estornarPagamentoPix(7, 'onz', 'PED55aaa');

    expect(devolverCobranca).toHaveBeenCalledWith('PED55aaa', null);
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
