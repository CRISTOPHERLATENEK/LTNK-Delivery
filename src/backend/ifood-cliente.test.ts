import { describe, it, expect, beforeEach } from 'vitest';
import {
  tokenDeAcesso, limparTokensIfood, pollingEventos, pollingTodasAsLojas,
  confirmarEventos, buscarPedido, credenciaisDoAmbiente, avisarStatusIfood, ErroIfood,
  type CredenciaisIfood,
} from './ifood-cliente';

const CRED: CredenciaisIfood = { clientId: 'cid-teste', clientSecret: 'SEGREDO-DO-APP' };
const BASE = 'https://api.teste';

/** `fetch` de mentira: registra o que recebeu, responde por rota. */
function fetchFalso(rotas: Array<{ contem: string; status?: number; corpo?: unknown; erro?: Error }>) {
  const chamadas: Array<{ url: string; metodo: string; headers: Record<string, string>; corpo: string }> = [];
  const buscar = (async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    chamadas.push({
      url: u,
      metodo: String(init.method ?? 'GET'),
      headers: (init.headers ?? {}) as Record<string, string>,
      corpo: String(init.body ?? ''),
    });
    const r = rotas.find(x => u.includes(x.contem));
    if (!r) throw new Error('rota não simulada: ' + u);
    if (r.erro) throw r.erro;
    const status = r.status ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => { if (r.corpo === undefined) throw new Error('sem corpo'); return r.corpo; },
    } as Response;
  }) as unknown as typeof fetch;
  return { buscar, chamadas };
}

const TOKEN_OK = { contem: '/oauth/token', corpo: { accessToken: 'jwt-abc', expiresIn: 21600 } };

beforeEach(() => limparTokensIfood());

describe('tokenDeAcesso', () => {
  it('pede o token no formato que a API exige', async () => {
    const f = fetchFalso([TOKEN_OK]);
    expect(await tokenDeAcesso(CRED, { buscar: f.buscar, baseUrl: BASE })).toBe('jwt-abc');

    const c = f.chamadas[0];
    expect(c.url).toBe(`${BASE}/authentication/v1.0/oauth/token`);
    expect(c.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    /* camelCase, fora do costume do OAuth. `grant_type` aqui dá 401 sem dizer
       o motivo. */
    expect(c.corpo).toContain('grantType=client_credentials');
    expect(c.corpo).toContain('clientId=cid-teste');
  });

  it('REUSA o token — não pede um por chamada', async () => {
    /* O erro caro: com polling a cada 30s, pedir token por ciclo troca 1
       autenticação por dia por 2.880, e o rate limit é por token. */
    const f = fetchFalso([TOKEN_OK, { contem: 'events:polling', status: 204, corpo: null }]);
    const o = { buscar: f.buscar, baseUrl: BASE };
    await pollingEventos(CRED, ['m1'], o);
    await pollingEventos(CRED, ['m1'], o);
    await pollingEventos(CRED, ['m1'], o);
    expect(f.chamadas.filter(c => c.url.includes('/oauth/token'))).toHaveLength(1);
  });

  it('renova quando falta menos de 5 minutos', async () => {
    /* Sem margem, um token que expira "em 2 segundos" passa na verificação e
       vence no meio da requisição seguinte — o 401 chega quando já não dá para
       distinguir de credencial errada. */
    const f = fetchFalso([{ contem: '/oauth/token', corpo: { accessToken: 'curto', expiresIn: 120 } }]);
    const o = { buscar: f.buscar, baseUrl: BASE };
    await tokenDeAcesso(CRED, o);
    await tokenDeAcesso(CRED, o);
    expect(f.chamadas).toHaveLength(2);
  });

  it('expiresIn ausente ou absurdo vira 6h, não NaN', async () => {
    /* NaN faria toda comparação ser falsa e o token seria renovado a cada
       chamada, em silêncio, até bater no rate limit. */
    for (const expiresIn of [undefined, 'muito', -5, 0]) {
      limparTokensIfood();
      const f = fetchFalso([{ contem: '/oauth/token', corpo: { accessToken: 't', expiresIn } }]);
      const o = { buscar: f.buscar, baseUrl: BASE };
      await tokenDeAcesso(CRED, o);
      await tokenDeAcesso(CRED, o);
      expect(f.chamadas).toHaveLength(1);
    }
  });

  it('401 explica, e o erro não carrega o segredo', async () => {
    const f = fetchFalso([{ contem: '/oauth/token', status: 401, corpo: { error: { message: 'Bad credentials' } } }]);
    const e = await tokenDeAcesso(CRED, { buscar: f.buscar, baseUrl: BASE }).catch(x => x);
    expect(e).toBeInstanceOf(ErroIfood);
    expect(e.message).toBe('Bad credentials');
    expect(e.message + String(e.stack || '')).not.toContain('SEGREDO-DO-APP');
  });

  it('token vazio na resposta é erro', async () => {
    const f = fetchFalso([{ contem: '/oauth/token', corpo: { expiresIn: 21600 } }]);
    await expect(tokenDeAcesso(CRED, { buscar: f.buscar, baseUrl: BASE })).rejects.toThrow();
  });

  it('cache é por clientId', async () => {
    const f = fetchFalso([TOKEN_OK]);
    const o = { buscar: f.buscar, baseUrl: BASE };
    await tokenDeAcesso(CRED, o);
    await tokenDeAcesso({ clientId: 'outro', clientSecret: 'x' }, o);
    expect(f.chamadas).toHaveLength(2);
  });
});

describe('pollingEventos', () => {
  it('manda o header de merchants e o Bearer', async () => {
    const f = fetchFalso([TOKEN_OK, { contem: 'events:polling', corpo: [{ id: 'e1', code: 'PLC' }] }]);
    const r = await pollingEventos(CRED, ['m1', 'm2'], { buscar: f.buscar, baseUrl: BASE });
    expect(r).toHaveLength(1);
    const c = f.chamadas.find(x => x.url.includes('events:polling'))!;
    expect(c.headers['x-polling-merchants']).toBe('m1,m2');
    expect(c.headers.Authorization).toBe('Bearer jwt-abc');
  });

  it('204 é lista vazia, não erro', async () => {
    /* É a resposta MAIS COMUM: a cada 30s, na maior parte do dia, não há
       pedido. Tratar como erro encheria o log e mascararia falha de verdade. */
    const f = fetchFalso([TOKEN_OK, { contem: 'events:polling', status: 204, corpo: null }]);
    expect(await pollingEventos(CRED, ['m1'], { buscar: f.buscar, baseUrl: BASE })).toEqual([]);
  });

  it('sem merchants não chama a rede', async () => {
    const f = fetchFalso([TOKEN_OK]);
    expect(await pollingEventos(CRED, [], { buscar: f.buscar, baseUrl: BASE })).toEqual([]);
    expect(f.chamadas).toHaveLength(0);
  });

  it('mais de 100 merchants é erro de programação, não requisição', async () => {
    const f = fetchFalso([TOKEN_OK]);
    const muitos = Array.from({ length: 101 }, (_, i) => `m${i}`);
    await expect(pollingEventos(CRED, muitos, { buscar: f.buscar, baseUrl: BASE })).rejects.toThrow(/100/);
  });

  it('403 traz a lista de lojas sem permissão', async () => {
    /* A doc manda repetir sem essas lojas. Perder a lista transformaria "uma
       loja revogou o acesso" em "o polling inteiro parou". */
    const f = fetchFalso([TOKEN_OK, {
      contem: 'events:polling', status: 403, corpo: { unauthorizedMerchants: ['m2', 'm3'] },
    }]);
    const e = await pollingEventos(CRED, ['m1', 'm2'], { buscar: f.buscar, baseUrl: BASE }).catch(x => x);
    expect(e.httpStatus).toBe(403);
    expect(e.merchantsSemPermissao).toEqual(['m2', 'm3']);
  });

  it('429 propaga o status para quem decide recuar', async () => {
    const f = fetchFalso([TOKEN_OK, { contem: 'events:polling', status: 429, corpo: { message: 'Throttling applied.' } }]);
    const e = await pollingEventos(CRED, ['m1'], { buscar: f.buscar, baseUrl: BASE }).catch(x => x);
    expect(e.httpStatus).toBe(429);
    expect(e.message).toContain('Throttling');
  });

  it('corpo que não é lista vira lista vazia', async () => {
    const f = fetchFalso([TOKEN_OK, { contem: 'events:polling', corpo: { erro: 'nada a ver' } }]);
    expect(await pollingEventos(CRED, ['m1'], { buscar: f.buscar, baseUrl: BASE })).toEqual([]);
  });
});

describe('pollingTodasAsLojas', () => {
  it('quebra em lotes de 100 e chama EM SÉRIE', async () => {
    /* A doc manda agrupar sequencialmente dentro do ciclo de 30s. Disparar
       tudo junto é como se encosta no limite de 6000 RPM. */
    const f = fetchFalso([TOKEN_OK, { contem: 'events:polling', corpo: [{ id: 'e' }] }]);
    const r = await pollingTodasAsLojas(
      CRED, Array.from({ length: 250 }, (_, i) => `m${i}`), { buscar: f.buscar, baseUrl: BASE },
    );
    const polls = f.chamadas.filter(c => c.url.includes('events:polling'));
    expect(polls).toHaveLength(3);
    expect(polls[0].headers['x-polling-merchants'].split(',')).toHaveLength(100);
    expect(polls[2].headers['x-polling-merchants'].split(',')).toHaveLength(50);
    expect(r).toHaveLength(3);
  });
});

describe('confirmarEventos', () => {
  it('manda os ids no formato de objetos', async () => {
    const f = fetchFalso([TOKEN_OK, { contem: 'acknowledgment', status: 202, corpo: {} }]);
    await confirmarEventos(CRED, ['a', 'b'], { buscar: f.buscar, baseUrl: BASE });
    const c = f.chamadas.find(x => x.url.includes('acknowledgment'))!;
    expect(c.metodo).toBe('POST');
    expect(JSON.parse(c.corpo)).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('lista vazia não gera requisição', async () => {
    /* Um POST vazio por ciclo, para sempre, é desperdício e ruído no log. */
    const f = fetchFalso([TOKEN_OK]);
    await confirmarEventos(CRED, [], { buscar: f.buscar, baseUrl: BASE });
    expect(f.chamadas).toHaveLength(0);
  });

  it('acima de 2000 é erro de programação', async () => {
    const f = fetchFalso([TOKEN_OK]);
    const ids = Array.from({ length: 2001 }, (_, i) => `e${i}`);
    await expect(confirmarEventos(CRED, ids, { buscar: f.buscar, baseUrl: BASE })).rejects.toThrow(/2000/);
  });
});

describe('avisarStatusIfood', () => {
  it('bate no endpoint da ação, com POST', async () => {
    const f = fetchFalso([TOKEN_OK, { contem: '/confirm', status: 202, corpo: {} }]);
    await avisarStatusIfood(CRED, 'ord_1', 'confirm', { buscar: f.buscar, baseUrl: BASE });
    const c = f.chamadas.find(x => x.url.includes('/confirm'))!;
    expect(c.url).toBe(`${BASE}/order/v1.0/orders/ord_1/confirm`);
    expect(c.metodo).toBe('POST');
    expect(c.headers.Authorization).toBe('Bearer jwt-abc');
  });

  it('202 é sucesso, não erro', async () => {
    /* A API responde 202 (aceito, processa depois) em todas essas ações.
       Tratar como falha faria o sistema achar que nunca avisou. */
    const f = fetchFalso([TOKEN_OK, { contem: '/dispatch', status: 202, corpo: {} }]);
    await expect(avisarStatusIfood(CRED, 'ord_1', 'dispatch', { buscar: f.buscar, baseUrl: BASE }))
      .resolves.toBeUndefined();
  });

  it('409 propaga o status para quem decide se repete', async () => {
    /* 409 = o pedido já passou desse estado. Quem chama precisa do número para
       não insistir. */
    const f = fetchFalso([TOKEN_OK, { contem: '/confirm', status: 409, corpo: { message: 'Order already confirmed' } }]);
    const e = await avisarStatusIfood(CRED, 'ord_1', 'confirm', { buscar: f.buscar, baseUrl: BASE }).catch(x => x);
    expect(e.httpStatus).toBe(409);
  });
});

describe('buscarPedido', () => {
  it('busca pelo id e escapa o caminho', async () => {
    const f = fetchFalso([TOKEN_OK, { contem: '/orders/', corpo: { id: 'o1', total: {} } }]);
    const p = await buscarPedido(CRED, 'a/b c', { buscar: f.buscar, baseUrl: BASE });
    expect(p.id).toBe('o1');
    expect(f.chamadas.find(c => c.url.includes('/orders/'))!.url).toContain('a%2Fb%20c');
  });
});

describe('credenciaisDoAmbiente', () => {
  it('sem as duas variáveis, devolve null', () => {
    const antes = { id: process.env.IFOOD_CLIENT_ID, secret: process.env.IFOOD_CLIENT_SECRET };
    try {
      delete process.env.IFOOD_CLIENT_ID;
      delete process.env.IFOOD_CLIENT_SECRET;
      expect(credenciaisDoAmbiente()).toBeNull();

      /* Meia credencial é o mesmo que nenhuma — e precisa dizer isso, senão o
         laço tentaria autenticar com secret vazio e levaria 401 em loop. */
      process.env.IFOOD_CLIENT_ID = 'x';
      expect(credenciaisDoAmbiente()).toBeNull();

      process.env.IFOOD_CLIENT_SECRET = '   ';
      expect(credenciaisDoAmbiente()).toBeNull();

      process.env.IFOOD_CLIENT_SECRET = 'y';
      expect(credenciaisDoAmbiente()).toEqual({ clientId: 'x', clientSecret: 'y' });
    } finally {
      if (antes.id === undefined) delete process.env.IFOOD_CLIENT_ID; else process.env.IFOOD_CLIENT_ID = antes.id;
      if (antes.secret === undefined) delete process.env.IFOOD_CLIENT_SECRET; else process.env.IFOOD_CLIENT_SECRET = antes.secret;
    }
  });
});
