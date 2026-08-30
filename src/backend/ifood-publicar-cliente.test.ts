import { describe, it, expect, beforeEach } from 'vitest';
import { publicarItem, mudarStatusItem, conferirLote, loteDeuCerto } from './ifood-publicar-cliente';
import { limparTokensIfood, type CredenciaisIfood } from './ifood-cliente';

const CRED: CredenciaisIfood = { clientId: 'cid', clientSecret: 'seg' };
const BASE = 'https://api.teste';
const M = 'merch-1';

function fetchFalso(rotas: Array<{ contem: string; status?: number; corpo?: unknown }>) {
  const chamadas: Array<{ url: string; metodo: string; corpo: string }> = [];
  const buscar = (async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    chamadas.push({ url: u, metodo: String(init.method ?? 'GET'), corpo: String(init.body ?? '') });
    const r = rotas.find(x => u.includes(x.contem));
    if (!r) throw new Error('rota não simulada: ' + u);
    const status = r.status ?? 200;
    const cru = r.corpo === undefined ? '' : JSON.stringify(r.corpo);
    return { ok: status < 400, status, text: async () => cru, json: async () => r.corpo ?? null } as Response;
  }) as unknown as typeof fetch;
  return { buscar, chamadas };
}

const TOKEN = { contem: '/oauth/token', corpo: { accessToken: 'jwt', expiresIn: 21600 } };

beforeEach(() => limparTokensIfood());

describe('publicarItem', () => {
  it('usa PUT e manda o payload inteiro', async () => {
    const f = fetchFalso([TOKEN, { contem: '/items', corpo: { id: 'i1' } }]);
    await publicarItem(CRED, M, { item: { externalCode: 'XB-001' } }, { buscar: f.buscar, baseUrl: BASE });
    const c = f.chamadas.find(x => x.url.includes('/items'))!;
    expect(c.metodo).toBe('PUT');
    expect(c.url).toBe(`${BASE}/catalog/v2.0/merchants/merch-1/items`);
    expect(JSON.parse(c.corpo)).toEqual({ item: { externalCode: 'XB-001' } });
  });

  it('erro do iFood chega como erro, não como sucesso silencioso', async () => {
    const f = fetchFalso([TOKEN, { contem: '/items', status: 400, corpo: { message: 'payload inválido' } }]);
    await expect(publicarItem(CRED, M, {}, { buscar: f.buscar, baseUrl: BASE }))
      .rejects.toThrow(/payload inválido/);
  });
});

describe('mudarStatusItem', () => {
  it('usa o caminho POR ITEM, não o lote da documentação', async () => {
    /*
     * `PATCH /items/status` responde `PatchItemStatusDto is not valid`. Testei
     * quatro formatos de corpo contra a API real e os quatro foram recusados;
     * `PATCH /items/{id}/status` com `{ status }` responde 200.
     */
    const f = fetchFalso([TOKEN, { contem: '/status', corpo: {} }]);
    await mudarStatusItem(CRED, M, 'i1', false, { buscar: f.buscar, baseUrl: BASE });
    const c = f.chamadas.find(x => x.url.includes('/status'))!;
    expect(c.metodo).toBe('PATCH');
    expect(c.url).toBe(`${BASE}/catalog/v2.0/merchants/merch-1/items/i1/status`);
    expect(JSON.parse(c.corpo)).toEqual({ status: 'UNAVAILABLE' });
  });

  it('reativar manda AVAILABLE', async () => {
    const f = fetchFalso([TOKEN, { contem: '/status', corpo: {} }]);
    await mudarStatusItem(CRED, M, 'i1', true, { buscar: f.buscar, baseUrl: BASE });
    expect(JSON.parse(f.chamadas.find(x => x.url.includes('/status'))!.corpo)).toEqual({ status: 'AVAILABLE' });
  });
});

describe('conferirLote', () => {
  it('lote ainda rodando não conta como terminado', async () => {
    const f = fetchFalso([TOKEN, { contem: '/batch/', corpo: { status: 'PROCESSING' } }]);
    const e = await conferirLote(CRED, M, 'b1', { buscar: f.buscar, baseUrl: BASE });
    expect(e.terminou).toBe(false);
    expect(loteDeuCerto(e)).toBe(false);
  });

  it('sucesso PARCIAL não é sucesso', async () => {
    /*
     * A resposta 200 do lote não significa que aplicou: a API manda consultar
     * até COMPLETED, e `failureCount: 5` é sucesso parcial. Em preço, isso é
     * item vendendo pelo valor errado com 200 no log dizendo que deu certo.
     */
    const f = fetchFalso([TOKEN, { contem: '/batch/', corpo: { status: 'COMPLETED', successCount: 10, failureCount: 5 } }]);
    const e = await conferirLote(CRED, M, 'b1', { buscar: f.buscar, baseUrl: BASE });
    expect(e.terminou).toBe(true);
    expect(loteDeuCerto(e)).toBe(false);
    expect(e.falhas).toBe(5);
  });

  it('COMPLETED sem falha é sucesso', async () => {
    const f = fetchFalso([TOKEN, { contem: '/batch/', corpo: { status: 'COMPLETED', successCount: 3, failureCount: 0 } }]);
    expect(loteDeuCerto(await conferirLote(CRED, M, 'b1', { buscar: f.buscar, baseUrl: BASE }))).toBe(true);
  });

  it('contagem ausente não vira NaN', () => {
    /* NaN em comparação é sempre falso: o lote passaria por bem-sucedido sem
       ninguém ter contado nada. */
    return conferirLote(CRED, M, 'b1', {
      buscar: fetchFalso([TOKEN, { contem: '/batch/', corpo: { status: 'COMPLETED' } }]).buscar,
      baseUrl: BASE,
    }).then(e => {
      expect(e.falhas).toBe(0);
      expect(loteDeuCerto(e)).toBe(true);
    });
  });
});
