import { describe, it, expect, beforeEach } from 'vitest';
import {
  imprimirNaMaquininha, consultarImpressao, corpoDaImpressao, alvoDaImpressao,
  lerEstadoImpressao, STATUS_PENDENTE, type CredenciaisImpressao,
} from './smarttef-impressao';
import { limparTokensTef } from './smarttef-auth';

const LOGIN = '/auth/login';
const JWT_FALSO = (() => {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256' })}.${b({ exp: 4000000000 })}.assinatura`;
})();

const CRED: CredenciaisImpressao = {
  baseUrl: 'https://api.teste',
  usuario: 'loja@teste',
  senha: 'segredo',
  gatewayToken: 'GATEWAY',
  cnpj: '48.935.328/0001-26',
  serialPos: '',
};

const CUPOM = { printId: 'nota-16-115', nome: 'NFCe-16.txt', texto: 'DANFE SIMPLIFICADO\nItem 1  R$ 10,00\n' };

function fetchFalso(resposta: { status?: number; corpo?: unknown; erro?: Error }) {
  const chamadas: Array<{ url: string; corpo: Record<string, unknown>; headers: Record<string, string> }> = [];
  const buscar = (async (url: string, init: RequestInit) => {
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

const OPCOES = (buscar: typeof fetch) => ({ buscar, caminhoLogin: LOGIN });

beforeEach(() => limparTokensTef());

describe('alvoDaImpressao', () => {
  it('sem serial, cai na fila geral', () => {
    /* Certo para loja com uma maquininha só. */
    expect(alvoDaImpressao('')).toEqual({ order_type: 'NRM' });
    expect(alvoDaImpressao('   ')).toEqual({ order_type: 'NRM' });
  });

  it('com serial, vai para AQUELE aparelho', () => {
    /*
     * Numa loja com várias, a fila geral faria o cupom do cliente sair no
     * balcão enquanto o entregador espera na porta.
     */
    expect(alvoDaImpressao('PB3S249')).toEqual({ order_type: 'CRD_UNICO', serial_pos: 'PB3S249' });
  });
});

describe('corpoDaImpressao', () => {
  it('manda TEXTO, não arquivo', () => {
    /*
     * O cupom que o sistema já gera para a impressora térmica é texto. Converter
     * para PDF só para a maquininha renderizar seria trabalho a mais e uma
     * chance a mais de o layout quebrar no caminho.
     */
    const c = corpoDaImpressao(CRED, CUPOM);
    expect(c.is_from_text).toBe(true);
    expect(c.file).toEqual({ name: 'NFCe-16.txt', data: CUPOM.texto });
  });

  it('nasce PENDENTE', () => {
    /* Quem imprime é o aparelho, quando busca a fila. */
    expect(corpoDaImpressao(CRED, CUPOM).print_status).toBe(STATUS_PENDENTE);
  });

  it('o CNPJ vai só com dígitos', () => {
    /* O campo aceita 14 caracteres; com pontuação, 18 não cabem. */
    expect(corpoDaImpressao(CRED, CUPOM).cnpj).toBe('48935328000126');
  });

  it('leva o NOSSO print_id', () => {
    /* É a chave de idempotência: a mesma nota reenviada não pode virar dois
       cupons. */
    expect(corpoDaImpressao(CRED, CUPOM).print_id).toBe('nota-16-115');
  });

  it('sem storeId, não manda o campo', () => {
    /* Mandar `store_id: undefined` viraria `null` no JSON, e null não é
       "não informei". */
    expect('store_id' in corpoDaImpressao(CRED, CUPOM)).toBe(false);
    expect(corpoDaImpressao({ ...CRED, storeId: 7 }, CUPOM).store_id).toBe(7);
  });
});

describe('imprimirNaMaquininha', () => {
  it('bate no endpoint de criar impressão, com os dois headers', async () => {
    const f = fetchFalso({ corpo: { data: { print_identifier: 'prt-1' } } });
    const r = await imprimirNaMaquininha(CRED, CUPOM, OPCOES(f.buscar));
    expect(r.identificador).toBe('prt-1');
    expect(f.chamadas[0].url).toBe('https://api.teste/smarttef/commands/erp/print/create');
    expect(f.chamadas[0].headers.Authorization).toBe(`Bearer ${JWT_FALSO}`);
    expect(f.chamadas[0].headers['ocp-apim-subscription-key']).toBe('GATEWAY');
  });

  it('resposta sem identificador cai no nosso print_id', async () => {
    /* Seguro porque é ele que manda: foi ele que criou a impressão, e é por ele
       que a consulta pergunta. */
    const f = fetchFalso({ corpo: { data: { message: 'ok' } } });
    const r = await imprimirNaMaquininha(CRED, CUPOM, OPCOES(f.buscar));
    expect(r.identificador).toBe('nota-16-115');
  });

  it('cupom vazio nem sai para a rede', async () => {
    const f = fetchFalso({ corpo: {} });
    await expect(imprimirNaMaquininha(CRED, { ...CUPOM, texto: '  ' }, OPCOES(f.buscar)))
      .rejects.toThrow(/cupom/);
    expect(f.chamadas).toHaveLength(0);
  });

  it('sem print_id nem sai para a rede', async () => {
    /* Impressão sem identificador não pode ser consultada — ninguém procura o
       que não sabe que existe. */
    const f = fetchFalso({ corpo: {} });
    await expect(imprimirNaMaquininha(CRED, { ...CUPOM, printId: '' }, OPCOES(f.buscar)))
      .rejects.toThrow(/identificador/);
    expect(f.chamadas).toHaveLength(0);
  });

  it('queda de rede é INDEFINIDA, não falha', async () => {
    /* A requisição pode ter chegado. O `printId` estável evita o cupom dobrado
       se alguém reenviar. */
    const f = fetchFalso({ erro: new Error('rede caiu') });
    const e = await imprimirNaMaquininha(CRED, CUPOM, OPCOES(f.buscar)).catch(x => x);
    expect(e.indefinido).toBe(true);
  });

  it('erro da API vira a mensagem da API', async () => {
    const f = fetchFalso({ status: 400, corpo: { message: 'serial inexistente' } });
    await expect(imprimirNaMaquininha(CRED, CUPOM, OPCOES(f.buscar))).rejects.toThrow(/serial inexistente/);
  });
});

describe('lerEstadoImpressao', () => {
  it('só é impresso o que DIZ que imprimiu', () => {
    /*
     * A documentação não lista os status possíveis — só mostra `PDT` na
     * criação. Presumir impresso no desconhecido faria o sistema afirmar que o
     * cliente tem cupom quando ninguém sabe.
     */
    expect(lerEstadoImpressao({ data: { print_status: 'PRT' } }).impresso).toBe(true);
    expect(lerEstadoImpressao({ data: { print_status: 'PRINTED' } }).impresso).toBe(true);
  });

  it('pendente e desconhecido contam como NÃO impresso', () => {
    for (const s of ['PDT', 'ERR', 'QUALQUER-COISA', '']) {
      const e = lerEstadoImpressao({ data: { print_status: s } });
      expect(e.impresso, s).toBe(false);
      expect(e.pendente, s).toBe(true);
    }
  });

  it('corpo estranho não explode', () => {
    expect(lerEstadoImpressao(null).impresso).toBe(false);
    expect(lerEstadoImpressao('texto').pendente).toBe(true);
  });
});

describe('consultarImpressao', () => {
  it('pergunta pelo identificador no endpoint de consulta', async () => {
    const f = fetchFalso({ corpo: { data: { print_status: 'PRT' } } });
    const e = await consultarImpressao(CRED, 'prt-1', OPCOES(f.buscar));
    expect(e.impresso).toBe(true);
    expect(f.chamadas[0].url).toBe('https://api.teste/smarttef/pooling/erp/print/get');
    expect(f.chamadas[0].corpo.print_identifier).toBe('prt-1');
    expect(f.chamadas[0].corpo.cnpj).toBe('48935328000126');
  });
});
