import { describe, it, expect, beforeEach } from 'vitest';
import {
  tokenTef, expiraDoJwt, tokenDaResposta, limparTokensTef,
  CAMINHO_LOGIN, MARGEM_SEGUNDOS,
} from './smarttef-auth';

const AGORA = Date.parse('2026-08-31T12:00:00.000Z');
const CRED = { baseUrl: 'https://api.teste', usuario: 'loja@teste', senha: 'segredo' };
const CAMINHO = '/auth/login';

/** JWT de mentira: só o miolo importa, a assinatura nunca é conferida aqui. */
function jwt(payload: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256' })}.${b(payload)}.assinatura`;
}

function fetchFalso(respostas: Array<{ status?: number; corpo?: unknown }>) {
  const chamadas: Array<{ url: string; metodo: string; corpo: string }> = [];
  let i = 0;
  const buscar = (async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url: String(url), metodo: String(init.method ?? 'GET'), corpo: String(init.body ?? '') });
    const r = respostas[Math.min(i++, respostas.length - 1)];
    const status = r.status ?? 200;
    const texto = r.corpo === undefined ? '' : JSON.stringify(r.corpo);
    return { ok: status < 400, status, text: async () => texto } as Response;
  }) as unknown as typeof fetch;
  return { buscar, chamadas };
}

beforeEach(() => limparTokensTef());

describe('sem o caminho de login, não inventa', () => {
  it('o caminho nasce VAZIO', () => {
    /*
     * Não está na documentação pública e o suporte ainda não respondeu.
     * Preencher com palpite seria pior que ficar parado: endereço errado nesta
     * API não dá erro legível, dá venda falhada com o cliente no balcão.
     */
    expect(CAMINHO_LOGIN).toBe('');
  });

  it('recusa a chamada com mensagem clara em vez de tentar', async () => {
    const f = fetchFalso([{ corpo: { token: jwt({ exp: 1 }) } }]);
    await expect(tokenTef(CRED, { buscar: f.buscar })).rejects.toThrow(/endereço de autenticação/);
    expect(f.chamadas).toHaveLength(0);
  });
});

describe('expiraDoJwt', () => {
  it('lê o prazo do próprio token', () => {
    /* O prazo sai do JWT, não da resposta: assim a renovação não depende do
       formato do envelope, que eu ainda não conheço. */
    const t = jwt({ exp: Math.floor(AGORA / 1000) + 3600 });
    expect(expiraDoJwt(t, AGORA)).toBe((Math.floor(AGORA / 1000) + 3600) * 1000);
  });

  it('token já vencido vale null, não vale "válido"', () => {
    /* Tratar como válido faria a primeira venda falhar sem explicação. */
    expect(expiraDoJwt(jwt({ exp: Math.floor(AGORA / 1000) - 10 }), AGORA)).toBeNull();
  });

  it('token estranho não explode', () => {
    for (const t of ['', 'abc', 'a.b', 'a.####.c', jwt({ semExp: 1 })]) {
      expect(expiraDoJwt(t, AGORA)).toBeNull();
    }
  });
});

describe('tokenDaResposta', () => {
  it('aceita os nomes de campo que essas APIs usam', () => {
    /* Ainda não vi a resposta real. Encolher esta lista depois é seguro;
       adivinhar UM nome agora é falhar na primeira chamada sem saber por quê. */
    expect(tokenDaResposta({ token: 'a' })).toBe('a');
    expect(tokenDaResposta({ access_token: 'b' })).toBe('b');
    expect(tokenDaResposta({ accessToken: 'c' })).toBe('c');
    expect(tokenDaResposta({ jwt: 'd' })).toBe('d');
    expect(tokenDaResposta({ data: { token: 'e' } })).toBe('e');
  });

  it('resposta sem token devolve vazio', () => {
    expect(tokenDaResposta({ ok: true })).toBe('');
    expect(tokenDaResposta(null)).toBe('');
  });
});

describe('tokenTef', () => {
  it('autentica e devolve o token', async () => {
    const t = jwt({ exp: Math.floor(AGORA / 1000) + 3600 });
    const f = fetchFalso([{ corpo: { token: t } }]);
    const r = await tokenTef(CRED, { buscar: f.buscar, agoraMs: AGORA, caminho: CAMINHO });
    expect(r).toBe(t);
    expect(f.chamadas[0].url).toBe('https://api.teste/auth/login');
    expect(f.chamadas[0].metodo).toBe('POST');
    expect(JSON.parse(f.chamadas[0].corpo)).toEqual({ usuario: 'loja@teste', senha: 'segredo' });
  });

  it('não pede token duas vezes enquanto o primeiro vale', async () => {
    /* Uma chamada de login por venda multiplicaria a latência do PDV e o risco
       de bater em limite da API deles. */
    const f = fetchFalso([{ corpo: { token: jwt({ exp: Math.floor(AGORA / 1000) + 3600 }) } }]);
    await tokenTef(CRED, { buscar: f.buscar, agoraMs: AGORA, caminho: CAMINHO });
    await tokenTef(CRED, { buscar: f.buscar, agoraMs: AGORA + 60_000, caminho: CAMINHO });
    expect(f.chamadas).toHaveLength(1);
  });

  it('renova ANTES de vencer, não depois', async () => {
    /*
     * Token que expira no meio da chamada é o mesmo que token vencido — e aí a
     * venda já foi. Por isso a margem.
     */
    const t1 = jwt({ exp: Math.floor(AGORA / 1000) + 100 });
    const t2 = jwt({ exp: Math.floor(AGORA / 1000) + 9999 });
    const f = fetchFalso([{ corpo: { token: t1 } }, { corpo: { token: t2 } }]);
    await tokenTef(CRED, { buscar: f.buscar, agoraMs: AGORA, caminho: CAMINHO });
    const r = await tokenTef(CRED, {
      buscar: f.buscar, caminho: CAMINHO,
      agoraMs: AGORA + (100 - MARGEM_SEGUNDOS + 1) * 1000,
    });
    expect(r).toBe(t2);
    expect(f.chamadas).toHaveLength(2);
  });

  it('cada loja tem o seu token', async () => {
    /* Cache por usuário: com uma chave só, a loja B usaria o token da loja A e
       venderia na conta de outra pessoa. */
    const f = fetchFalso([
      { corpo: { token: jwt({ exp: Math.floor(AGORA / 1000) + 3600, quem: 'a' }) } },
      { corpo: { token: jwt({ exp: Math.floor(AGORA / 1000) + 3600, quem: 'b' }) } },
    ]);
    const a = await tokenTef(CRED, { buscar: f.buscar, agoraMs: AGORA, caminho: CAMINHO });
    const b = await tokenTef({ ...CRED, usuario: 'outra@loja' }, { buscar: f.buscar, agoraMs: AGORA, caminho: CAMINHO });
    expect(a).not.toBe(b);
    expect(f.chamadas).toHaveLength(2);
  });

  it('senha errada tem mensagem própria', async () => {
    /*
     * "Falhou ao autenticar" mandaria o lojista procurar rede, endereço e
     * firewall — quando o problema é a senha, que ele resolve em dez segundos.
     */
    const f = fetchFalso([{ status: 401, corpo: { erro: 'x' } }]);
    await expect(tokenTef(CRED, { buscar: f.buscar, agoraMs: AGORA, caminho: CAMINHO }))
      .rejects.toThrow(/recusou o usuário e a senha/);
  });

  it('token sem exp legível ganha prazo curto, e renova', async () => {
    const f = fetchFalso([{ corpo: { token: 'nao-e-jwt' } }, { corpo: { token: 'nao-e-jwt-2' } }]);
    await tokenTef(CRED, { buscar: f.buscar, agoraMs: AGORA, caminho: CAMINHO }, 300);
    await tokenTef(CRED, { buscar: f.buscar, agoraMs: AGORA + 300_000, caminho: CAMINHO }, 300);
    expect(f.chamadas).toHaveLength(2);
  });

  it('resposta sem token não vira token vazio', async () => {
    /* Token vazio seguiria adiante e falharia como "não autorizado" na venda,
       longe da causa. */
    const f = fetchFalso([{ corpo: { ok: true } }]);
    await expect(tokenTef(CRED, { buscar: f.buscar, agoraMs: AGORA, caminho: CAMINHO }))
      .rejects.toThrow(/não devolveu token/);
  });

  it('credencial incompleta nem chega a chamar', async () => {
    const f = fetchFalso([{ corpo: { token: 'x' } }]);
    await expect(tokenTef({ ...CRED, senha: '' }, { buscar: f.buscar, caminho: CAMINHO }))
      .rejects.toThrow(/Faltam/);
    expect(f.chamadas).toHaveLength(0);
  });
});
