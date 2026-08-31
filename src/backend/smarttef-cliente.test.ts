import { describe, it, expect, beforeEach } from 'vitest';
import {
  criarOrdemPagamento, consultarOrdem, cancelarOrdem, estornarOrdem, configurarWebhook,
  ErroTef, type CredenciaisCliente,
} from './smarttef-cliente';
import { limparTokensTef } from './smarttef-auth';

const CRED: CredenciaisCliente = {
  baseUrl: 'https://api.exemplo.com.br',
  usuario: 'loja@exemplo',
  senha: 'SENHA-SECRETA',
  gatewayToken: 'GATEWAY-SECRETO',
};

/*
 * O caminho de login é injetado nos testes porque o real ainda não é conhecido —
 * `CAMINHO_LOGIN` nasce vazio de propósito. Ver `smarttef-auth`.
 */
const LOGIN = '/auth/login';
const OPCOES = (buscar: typeof fetch) => ({ buscar, caminhoLogin: LOGIN });

/** JWT de mentira com prazo largo: o cliente só precisa do Bearer resolvido. */
const JWT_FALSO = (() => {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256' })}.${b({ exp: 4000000000 })}.assinatura`;
})();

beforeEach(() => limparTokensTef());

/** Um `fetch` de mentira que grava o que recebeu e devolve o que mandarmos. */
function fetchFalso(resposta: { status?: number; corpo?: unknown; erro?: Error }) {
  const chamadas: Array<{ url: string; corpo: Record<string, unknown>; headers: Record<string, string> }> = [];
  const buscar = (async (url: string, init: RequestInit) => {
    /*
     * O LOGIN NÃO ENTRA EM `chamadas`. Assim os testes seguem falando sobre a
     * chamada de negócio em `chamadas[0]`, e a autenticação — que tem testes
     * próprios em smarttef-auth.test.ts — não desloca todos os índices.
     */
    if (String(url).endsWith(LOGIN)) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ token: JWT_FALSO }) } as Response;
    }
    chamadas.push({
      url: String(url),
      corpo: JSON.parse(String(init.body ?? '{}')),
      headers: init.headers as Record<string, string>,
    });
    if (resposta.erro) throw resposta.erro;
    return {
      ok: (resposta.status ?? 200) < 400,
      status: resposta.status ?? 200,
      json: async () => resposta.corpo ?? {},
    } as Response;
  }) as unknown as typeof fetch;
  return { buscar, chamadas };
}

describe('criarOrdemPagamento', () => {
  it('manda valor decimal, charge_id e os dois headers', async () => {
    const f = fetchFalso({ corpo: { data: { payment_identifier: 'pay-1' } } });
    const r = await criarOrdemPagamento(CRED, { valorCentavos: 6990, chargeId: 'pedido-42' }, OPCOES(f.buscar));

    expect(r.identificador).toBe('pay-1');
    expect(f.chamadas[0].url).toBe('https://api.exemplo.com.br/smarttef/commands/erp/order/create');
    expect(f.chamadas[0].corpo.value).toBe(69.9);
    expect(f.chamadas[0].corpo.charge_id).toBe('pedido-42');
    expect(f.chamadas[0].headers.Authorization).toBe(`Bearer ${JWT_FALSO}`);
    expect(f.chamadas[0].headers['ocp-apim-subscription-key']).toBe('GATEWAY-SECRETO');
  });

  it('sem serial, cai na lista geral (NRM) e não manda serial_pos', async () => {
    const f = fetchFalso({ corpo: { payment_identifier: 'p' } });
    await criarOrdemPagamento(CRED, { valorCentavos: 100, chargeId: 'x' }, OPCOES(f.buscar));
    expect(f.chamadas[0].corpo.order_type).toBe('NRM');
    expect(f.chamadas[0].corpo).not.toHaveProperty('serial_pos');
  });

  it('com serial, vai direto para o aparelho (CRD_UNICO)', async () => {
    /* order_type e serial não podem divergir: CRD_UNICO sem destino não tem
       para onde ir, NRM com serial ignora o destino. */
    const f = fetchFalso({ corpo: { payment_identifier: 'p' } });
    await criarOrdemPagamento(CRED, { valorCentavos: 100, chargeId: 'x', serialPos: ' POS9 ' }, OPCOES(f.buscar));
    expect(f.chamadas[0].corpo.order_type).toBe('CRD_UNICO');
    expect(f.chamadas[0].corpo.serial_pos).toBe('POS9');
  });

  it('installments só em crédito', async () => {
    /* Obrigatório em CREDIT; em débito é campo inválido — 400 na frente do cliente. */
    const cred = fetchFalso({ corpo: { payment_identifier: 'p' } });
    await criarOrdemPagamento(CRED, { valorCentavos: 100, chargeId: 'x', tipo: 'CREDIT', parcelas: 3 }, OPCOES(cred.buscar));
    expect(cred.chamadas[0].corpo.installments).toBe(3);

    const deb = fetchFalso({ corpo: { payment_identifier: 'p' } });
    await criarOrdemPagamento(CRED, { valorCentavos: 100, chargeId: 'x', tipo: 'DEBIT' }, OPCOES(deb.buscar));
    expect(deb.chamadas[0].corpo).not.toHaveProperty('installments');
  });

  it('sem tipo, o operador escolhe no POS', async () => {
    const f = fetchFalso({ corpo: { payment_identifier: 'p' } });
    await criarOrdemPagamento(CRED, { valorCentavos: 100, chargeId: 'x' }, OPCOES(f.buscar));
    expect(f.chamadas[0].corpo.payment_type).toBe('OTHERS');
  });

  it('crédito sem parcelas informadas vai como 1, não como ausente', async () => {
    const f = fetchFalso({ corpo: { payment_identifier: 'p' } });
    await criarOrdemPagamento(CRED, { valorCentavos: 100, chargeId: 'x', tipo: 'CREDIT' }, OPCOES(f.buscar));
    expect(f.chamadas[0].corpo.installments).toBe(1);
  });

  it('resposta sem identificador é erro INDEFINIDO', async () => {
    /* A cobrança pode existir na maquininha e não existir do nosso lado. Marcar
       como falha comum faria quem chama tentar de novo e criar a segunda. */
    const f = fetchFalso({ corpo: { data: {} } });
    await expect(criarOrdemPagamento(CRED, { valorCentavos: 100, chargeId: 'x' }, OPCOES(f.buscar)))
      .rejects.toMatchObject({ indefinido: true });
  });

  it('timeout e queda de rede são INDEFINIDOS, não falha', async () => {
    /* A requisição pode ter chegado: o servidor processou e a resposta se
       perdeu. Refazer cobraria duas vezes. */
    const f = fetchFalso({ erro: new Error('AbortError') });
    const erro = await criarOrdemPagamento(CRED, { valorCentavos: 100, chargeId: 'x' }, OPCOES(f.buscar))
      .catch(e => e);
    expect(erro).toBeInstanceOf(ErroTef);
    expect(erro.indefinido).toBe(true);
  });

  it('erro 400 da API vira a mensagem da API, e NÃO é indefinido', async () => {
    /* 400 é resposta: o servidor recebeu e recusou. Não criou nada, então
       tentar de novo com os dados corrigidos é seguro. */
    const f = fetchFalso({ status: 400, corpo: { data: { message: 'Valor obrigatório' } } });
    const erro = await criarOrdemPagamento(CRED, { valorCentavos: 100, chargeId: 'x' }, OPCOES(f.buscar))
      .catch(e => e);
    expect(erro.message).toBe('Valor obrigatório');
    expect(erro.indefinido).toBe(false);
    expect(erro.httpStatus).toBe(400);
  });

  it('401 explica o que fazer, e o erro NÃO carrega o token', async () => {
    /* Log de servidor é lido por muita gente. Quem tem o token cobra na
       maquininha de alguém. */
    const f = fetchFalso({ status: 401, corpo: null });
    const erro = await criarOrdemPagamento(CRED, { valorCentavos: 100, chargeId: 'x' }, OPCOES(f.buscar))
      .catch(e => e);
    expect(erro.message).toContain('credenciais');
    const tudo = erro.message + String(erro.stack || '');
    expect(tudo).not.toContain('TOKEN-SECRETO-DA-LOJA');
    expect(tudo).not.toContain('GATEWAY-SECRETO');
  });

  it('corpo ilegível não apaga o código HTTP', async () => {
    /* Um 401 com HTML de proxy no meio continua sendo 401. */
    /* O login responde normal; é a chamada de NEGÓCIO que volta 401 com corpo
       ilegível. Sem separar os dois, o teste passaria a falar da autenticação —
       que tem testes próprios — em vez do que ele quer provar. */
    const buscar = (async (url: string) => (String(url).endsWith(LOGIN)
      ? { ok: true, status: 200, text: async () => JSON.stringify({ token: JWT_FALSO }) }
      : { ok: false, status: 401, json: async () => { throw new Error('não é json'); } }
    ) as unknown as Response) as unknown as typeof fetch;
    const erro = await criarOrdemPagamento(CRED, { valorCentavos: 100, chargeId: 'x' }, OPCOES(buscar)).catch(e => e);
    expect(erro.httpStatus).toBe(401);
    expect(erro.message).toContain('credenciais');
  });

  it('valor inválido nem sai para a rede', async () => {
    const f = fetchFalso({ corpo: { payment_identifier: 'p' } });
    await expect(criarOrdemPagamento(CRED, { valorCentavos: 0, chargeId: 'x' }, OPCOES(f.buscar))).rejects.toThrow();
    await expect(criarOrdemPagamento(CRED, { valorCentavos: 10.5, chargeId: 'x' }, OPCOES(f.buscar))).rejects.toThrow();
    expect(f.chamadas).toHaveLength(0);
  });

  it('não tenta de novo sozinho', async () => {
    /* Retry cego numa criação de cobrança é como o cliente é cobrado duas vezes. */
    const f = fetchFalso({ erro: new Error('rede') });
    await criarOrdemPagamento(CRED, { valorCentavos: 100, chargeId: 'x' }, OPCOES(f.buscar)).catch(() => {});
    expect(f.chamadas).toHaveLength(1);
  });
});

describe('consultarOrdem', () => {
  it('devolve a transação traduzida', async () => {
    const f = fetchFalso({
      corpo: { data: { status: 'CNC', nsu_host: '9988', card_brand: 'MASTERCARD', payment_type: 'credit' } },
    });
    const t = await consultarOrdem(CRED, 'pay-1', OPCOES(f.buscar));
    expect(t.situacao).toBe('aprovado');
    expect(t.nsu).toBe('9988');
    expect(t.bandeira).toBe('MASTERCARD');
    expect(t.tipo).toBe('CREDIT');
    expect(f.chamadas[0].url).toContain('/smarttef/pooling/erp/order/get');
    expect(f.chamadas[0].corpo.payment_identifier).toBe('pay-1');
  });

  it('pendente ainda sem os campos da adquirente', async () => {
    const f = fetchFalso({ corpo: { data: { status: 'PROC_PAG', nsu_host: null } } });
    const t = await consultarOrdem(CRED, 'pay-1', OPCOES(f.buscar));
    expect(t.situacao).toBe('pendente');
    expect(t.nsu).toBe('');
  });
});

describe('cancelar, estornar e webhook', () => {
  it('cada um bate no seu endpoint', async () => {
    const c = fetchFalso({ corpo: {} });
    await cancelarOrdem(CRED, 'p1', OPCOES(c.buscar));
    expect(c.chamadas[0].url).toContain('/order/status/cancelar');

    const e = fetchFalso({ corpo: {} });
    await estornarOrdem(CRED, 'p1', OPCOES(e.buscar));
    expect(e.chamadas[0].url).toContain('/order/status/estornar');
  });

  it('o webhook registra a URL e o token que autentica o callback', async () => {
    /* É este token que volta no header Authorization do callback, e é o que nos
       deixa recusar um POST que não veio da API. */
    const f = fetchFalso({ corpo: {} });
    await configurarWebhook(CRED, { url: 'https://x.com.br/hook?t=banco', tokenAutorizacao: 'seg' }, OPCOES(f.buscar));
    expect(f.chamadas[0].url).toContain('/manager/erp/store/update');
    expect(f.chamadas[0].corpo).toMatchObject({
      webhookUrl: { url: 'https://x.com.br/hook?t=banco', authorization_token: 'seg' },
    });
  });

  it('erro em cancelamento propaga com a mensagem da API', async () => {
    const f = fetchFalso({ status: 409, corpo: { data: { message: 'Já concluída' } } });
    await expect(cancelarOrdem(CRED, 'p1', OPCOES(f.buscar))).rejects.toThrow('Já concluída');
  });
});
