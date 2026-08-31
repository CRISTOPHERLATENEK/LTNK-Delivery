import { describe, it, expect, beforeEach } from 'vitest';
import {
  tokenPdvMobi, listarVendas, listarProdutos, momentoParaConsulta,
  limparTokensPdvMobi, MARGEM_SEGUNDOS, BASE_PDVMOBI, type CredenciaisPdvMobi,
  enviarCobrancaPos, corpoDaCobranca, valorParaAmount,
} from './pdvmobi-cliente';

const AGORA = Date.parse('2026-08-31T12:00:00.000Z');
const BASE = 'https://api.teste';
const CRED: CredenciaisPdvMobi = {
  usuario: '48935328000126.unimaxx.pdv.mobi',
  senha: 'senha-da-api',
  chaveOcp: 'chave-ocp',
};

/** JWT de mentira. O prazo sai daqui, como na API de verdade. */
function jwt(segundosAFrente: number): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS512' })}.${b({ exp: Math.floor(AGORA / 1000) + segundosAFrente })}.assinatura`;
}

function fetchFalso(respostas: Array<{ contem?: string; status?: number; corpo?: unknown; erro?: Error }>) {
  const chamadas: Array<{ url: string; metodo: string; corpo: string; headers: Record<string, string> }> = [];
  const buscar = (async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    chamadas.push({
      url: u,
      metodo: String(init.method ?? 'GET'),
      corpo: String(init.body ?? ''),
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    const r = respostas.find(x => !x.contem || u.includes(x.contem)) ?? {};
    if (r.erro) throw r.erro;
    const status = r.status ?? 200;
    const texto = r.corpo === undefined ? '' : JSON.stringify(r.corpo);
    return { ok: status < 400, status, text: async () => texto } as Response;
  }) as unknown as typeof fetch;
  return { buscar, chamadas };
}

const AUTH_OK = { contem: '/v2/auth/token', corpo: { jwt: jwt(3600) } };

beforeEach(() => limparTokensPdvMobi());

describe('a base URL é a da coleção oficial', () => {
  it('aponta para api.poscontrole.com.br', () => {
    /* Achada no exemplo cURL da coleção Postman — não em documentação de
       visão geral, onde eu procurei primeiro e não estava. */
    expect(BASE_PDVMOBI).toBe('https://api.poscontrole.com.br');
  });
});

describe('tokenPdvMobi', () => {
  it('manda urlencoded com username e password, não JSON', async () => {
    /*
     * Está na coleção oficial. Eu havia escrito JSON com `usuario`/`senha` por
     * suposição antes de ler — o erro exato que a coleção existe para evitar.
     */
    const f = fetchFalso([AUTH_OK]);
    await tokenPdvMobi(CRED, { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA });
    const c = f.chamadas[0];
    expect(c.url).toBe(`${BASE}/v2/auth/token`);
    expect(c.metodo).toBe('POST');
    expect(c.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(c.corpo).toBe('username=48935328000126.unimaxx.pdv.mobi&password=senha-da-api');
  });

  it('a chave OCP vai no header da autenticação', async () => {
    /* Diferente do iFood: aqui a chave de gateway é exigida já no login. */
    const f = fetchFalso([AUTH_OK]);
    await tokenPdvMobi(CRED, { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA });
    expect(f.chamadas[0].headers['Ocp-Apim-Subscription-Key']).toBe('chave-ocp');
  });

  it('lê o token do campo `jwt`', async () => {
    const f = fetchFalso([AUTH_OK]);
    expect(await tokenPdvMobi(CRED, { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA })).toBe(jwt(3600));
  });

  it('não autentica duas vezes enquanto o token vale', async () => {
    const f = fetchFalso([AUTH_OK]);
    await tokenPdvMobi(CRED, { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA });
    await tokenPdvMobi(CRED, { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA + 60_000 });
    expect(f.chamadas).toHaveLength(1);
  });

  it('renova ANTES de vencer', async () => {
    /* A documentação diz "válido por 1 hora", mas o prazo é lido do token: uma
       frase de documentação não avisa quando muda. */
    const f = fetchFalso([{ contem: '/v2/auth/token', corpo: { jwt: jwt(100) } }]);
    await tokenPdvMobi(CRED, { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA });
    await tokenPdvMobi(CRED, {
      buscar: f.buscar, baseUrl: BASE,
      agoraMs: AGORA + (100 - MARGEM_SEGUNDOS + 1) * 1000,
    });
    expect(f.chamadas).toHaveLength(2);
  });

  it('cada loja tem o seu token', async () => {
    /* Chave única faria a loja B ler as vendas da loja A. */
    const f = fetchFalso([AUTH_OK]);
    await tokenPdvMobi(CRED, { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA });
    await tokenPdvMobi({ ...CRED, usuario: 'outra.pdv.mobi' }, { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA });
    expect(f.chamadas).toHaveLength(2);
  });

  it('senha errada tem mensagem própria', async () => {
    const f = fetchFalso([{ contem: '/v2/auth/token', status: 401, corpo: { message: 'x' } }]);
    await expect(tokenPdvMobi(CRED, { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA }))
      .rejects.toThrow(/recusou o usuário, a senha ou a chave OCP/);
  });

  it('resposta sem jwt não vira token vazio', async () => {
    /* Token vazio seguiria adiante e falharia como "não autorizado" longe da
       causa. */
    const f = fetchFalso([{ contem: '/v2/auth/token', corpo: { ok: true } }]);
    await expect(tokenPdvMobi(CRED, { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA }))
      .rejects.toThrow(/não devolveu o jwt/);
  });

  it('credencial incompleta nem chega a chamar', async () => {
    const f = fetchFalso([AUTH_OK]);
    await expect(tokenPdvMobi({ ...CRED, chaveOcp: '' }, { buscar: f.buscar, baseUrl: BASE }))
      .rejects.toThrow(/Faltam/);
    expect(f.chamadas).toHaveLength(0);
  });
});

describe('momentoParaConsulta', () => {
  it('usa espaço, não `T`, e não declara fuso', () => {
    /*
     * O formato exigido é `YYYY-MM-DD HH:MM:SS`. Não é ISO — e sem fuso
     * declarado o servidor entende no fuso DELE. Formatar em UTC deslocaria o
     * dia em três horas: a consulta de "hoje" perderia as vendas da noite e
     * repetiria as da madrugada seguinte.
     */
    expect(momentoParaConsulta(2026, 8, 31, 0, 0, 1)).toBe('2026-08-31 00:00:01');
    expect(momentoParaConsulta(2026, 8, 31, 23, 59, 59)).toBe('2026-08-31 23:59:59');
  });

  it('completa com zero à esquerda', () => {
    expect(momentoParaConsulta(2026, 1, 5)).toBe('2026-01-05 00:00:00');
  });
});

describe('listarVendas', () => {
  it('manda o intervalo na query e o Bearer no header', async () => {
    const f = fetchFalso([AUTH_OK, { corpo: { sales: [] } }]);
    await listarVendas(CRED, '2026-08-31 00:00:01', '2026-08-31 23:59:59',
      { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA });
    const c = f.chamadas.find(x => x.url.includes('/v2/sales'))!;
    expect(c.url).toContain('datetimeini=2026-08-31+00%3A00%3A01');
    expect(c.url).toContain('datetimeend=2026-08-31+23%3A59%3A59');
    expect(c.headers.Authorization).toBe(`Bearer ${jwt(3600)}`);
    expect(c.headers['Ocp-Apim-Subscription-Key']).toBe('chave-ocp');
  });

  it('devolve o corpo CRU, sem traduzir', async () => {
    /*
     * A documentação descreve a resposta com "typically include" e campos
     * genéricos — é ela SUPONDO, não um payload real. Traduzir a partir disso
     * repetiria o erro que o iFood pagou nove vezes. A tradução vem depois de
     * ver uma resposta de verdade.
     */
    const bruto = { qualquerCoisa: [{ campo: 'que a doc não previu' }] };
    const f = fetchFalso([AUTH_OK, { corpo: bruto }]);
    const r = await listarVendas(CRED, 'a', 'b', { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA });
    expect(r).toEqual(bruto);
  });

  it('erro da API vira a mensagem da API', async () => {
    const f = fetchFalso([AUTH_OK, { contem: '/v2/sales', status: 400, corpo: { message: 'intervalo inválido' } }]);
    await expect(listarVendas(CRED, 'a', 'b', { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA }))
      .rejects.toThrow(/intervalo inválido/);
  });
});

describe('listarProdutos', () => {
  it('bate no endpoint de produtos', async () => {
    const f = fetchFalso([AUTH_OK, { corpo: [] }]);
    await listarProdutos(CRED, { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA });
    expect(f.chamadas.some(c => c.url === `${BASE}/v2/products`)).toBe(true);
  });
});

describe('o que este cliente NÃO faz', () => {
  it('não existe função de mandar venda nem de emitir nota', async () => {
    /*
     * Não é omissão: a API não tem `POST /v2/sales` nem endpoint de NFC-e.
     * Registrado como teste porque a ideia "manda o pedido e a maquininha emite"
     * vai voltar, e a resposta está aqui.
     */
    const mod = await import('./pdvmobi-cliente');
    const nomes = Object.keys(mod).join(' ');
    expect(nomes).not.toMatch(/criarVenda|enviarVenda|emitirNota|nfce/i);
  });
});

describe('valorParaAmount', () => {
  it('sempre duas casas, com ponto', () => {
    /*
     * O exemplo oficial manda "0.10". `String(10/100)` daria "0.1" — valor com
     * uma casa decimal num campo de dinheiro é o que a maquininha aceita e o
     * conferente descobre no fim do mês.
     */
    expect(valorParaAmount(10)).toBe('0.10');
    expect(valorParaAmount(6990)).toBe('69.90');
    expect(valorParaAmount(100000)).toBe('1000.00');
  });

  it('valor zerado ou negativo nem monta corpo', () => {
    for (const v of [0, -1, NaN]) expect(() => valorParaAmount(v)).toThrow();
  });
});

describe('corpoDaCobranca', () => {
  const base = { idCobranca: 10222, valorCentavos: 10 };

  it('monta no formato exato do exemplo oficial', () => {
    expect(corpoDaCobranca({ ...base, cpf: '111.111.111-11', nome: 'Teste' })).toEqual({
      NumSerialPOS: '',
      IDCobranca: 10222,
      IDPagamento: '1',
      QTParcelas: '1',
      Extras: { CPF: '11111111111', Nome: 'Teste' },
      Amount: '0.10',
    });
  });

  it('Extras só leva o que existe', () => {
    /* CPF vazio é declarar consumidor identificado sem identificar ninguém. */
    expect(corpoDaCobranca(base).Extras).toEqual({});
    expect(corpoDaCobranca({ ...base, cpf: '  ' }).Extras).toEqual({});
  });

  it('parcelas nunca é zero', () => {
    /* "0 vezes" não existe em cartão. */
    expect(corpoDaCobranca({ ...base, parcelas: 0 }).QTParcelas).toBe('1');
    expect(corpoDaCobranca({ ...base, parcelas: 3 }).QTParcelas).toBe('3');
  });

  it('serial vazio quando não informado', () => {
    /* Vazio = qualquer aparelho da loja pega a cobrança. */
    expect(corpoDaCobranca(base).NumSerialPOS).toBe('');
    expect(corpoDaCobranca({ ...base, serialPos: 'PB3S249' }).NumSerialPOS).toBe('PB3S249');
  });
});

describe('enviarCobrancaPos', () => {
  const cobranca = { idCobranca: 10222, valorCentavos: 10 };

  it('bate em /v3/smart-tef/newItem, não em /v2', async () => {
    /*
     * O caminho é `/v3` e o grupo é `smart-tef` — não aparece na coleção
     * Postman, que só documenta `/v2`. Eu havia sondado `/v2/sales` e concluído
     * que a API não recebia venda; valia para o `/v2`, e generalizei errado.
     */
    const f = fetchFalso([AUTH_OK, { corpo: { ok: true } }]);
    await enviarCobrancaPos(CRED, cobranca, { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA });
    const c = f.chamadas.find(x => x.url.includes('newItem'))!;
    expect(c.url).toBe(`${BASE}/v3/smart-tef/newItem`);
    expect(c.metodo).toBe('POST');
    expect(c.headers.Authorization).toBe(`Bearer ${jwt(3600)}`);
    expect(c.headers['Ocp-Apim-Subscription-Key']).toBe('chave-ocp');
  });

  it('queda de rede avisa que a cobrança PODE existir', async () => {
    /*
     * A requisição pode ter chegado. Repetir criaria duas cobranças para a mesma
     * venda — e é por isso que `IDCobranca` tem que ser o do pedido, estável.
     */
    const f = fetchFalso([AUTH_OK, { contem: 'newItem', erro: new Error('rede caiu') }]);
    await expect(enviarCobrancaPos(CRED, cobranca, { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA }))
      .rejects.toThrow(/pode ter sido criada/);
  });

  it('devolve o corpo cru — a resposta ainda não foi vista', async () => {
    const bruto = { QualquerCoisa: 1 };
    const f = fetchFalso([AUTH_OK, { corpo: bruto }]);
    expect(await enviarCobrancaPos(CRED, cobranca, { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA }))
      .toEqual(bruto);
  });

  it('erro da API vira a mensagem da API', async () => {
    const f = fetchFalso([AUTH_OK, { contem: 'newItem', status: 400, corpo: { Message: 'serial invalido' } }]);
    await expect(enviarCobrancaPos(CRED, cobranca, { buscar: f.buscar, baseUrl: BASE, agoraMs: AGORA }))
      .rejects.toThrow(/serial invalido/);
  });
});
