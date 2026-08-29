import { describe, it, expect, beforeEach } from 'vitest';
import {
  listarCatalogos, catalogoDeEntrega, listarCategorias,
  buscarItemCompleto, listarVendaveis, resumirCardapio, listarItensDaCategoria,
} from './ifood-catalogo';
import { limparTokensIfood, type CredenciaisIfood } from './ifood-cliente';

const CRED: CredenciaisIfood = { clientId: 'cid', clientSecret: 'seg' };
const BASE = 'https://api.teste';
const M = 'merch-1';

function fetchFalso(rotas: Array<{ contem: string; status?: number; corpo?: unknown }>) {
  const chamadas: string[] = [];
  const buscar = (async (url: string) => {
    const u = String(url);
    chamadas.push(u);
    const r = rotas.find(x => u.includes(x.contem));
    if (!r) throw new Error('rota não simulada: ' + u);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.corpo ?? null } as Response;
  }) as unknown as typeof fetch;
  return { buscar, chamadas };
}

const TOKEN = { contem: '/oauth/token', corpo: { accessToken: 'jwt', expiresIn: 21600 } };

/* Resposta REAL da loja de sandbox, copiada da chamada de verdade. */
const CATALOGOS_REAIS = [{
  catalogId: 'ade4dd8e-9e62-4cd8-9a44-f36176ae7db7',
  context: ['DEFAULT'],
  status: 'AVAILABLE',
  modifiedAt: '2026-08-28T20:14:46.651123Z',
  groupId: 'ffca0022-eb43-4205-9a1b-73a72f8e3f95',
}];

beforeEach(() => limparTokensIfood());

describe('listarCatalogos', () => {
  it('usa o caminho que FUNCIONA, não o da documentação', async () => {
    /*
     * A doc manda /merchants/{id}/categories?include_items=true, e isso responde
     * 404 "no Route matched" — 404 de gateway, nem chega na aplicação.
     * Confirmado chamando a API de verdade.
     */
    const f = fetchFalso([TOKEN, { contem: '/catalogs', corpo: CATALOGOS_REAIS }]);
    const r = await listarCatalogos(CRED, M, { buscar: f.buscar, baseUrl: BASE });
    expect(r[0].catalogId).toBe('ade4dd8e-9e62-4cd8-9a44-f36176ae7db7');
    expect(f.chamadas.find(u => u.includes('/catalogs'))).toBe(
      `${BASE}/catalog/v2.0/merchants/merch-1/catalogs`,
    );
  });

  it('escapa o merchantId', async () => {
    const f = fetchFalso([TOKEN, { contem: '/catalogs', corpo: [] }]);
    await listarCatalogos(CRED, 'a/b', { buscar: f.buscar, baseUrl: BASE });
    expect(f.chamadas.find(u => u.includes('/catalogs'))).toContain('a%2Fb');
  });

  it('catálogo sem id é descartado', async () => {
    const f = fetchFalso([TOKEN, { contem: '/catalogs', corpo: [{ context: ['DEFAULT'] }, CATALOGOS_REAIS[0]] }]);
    expect(await listarCatalogos(CRED, M, { buscar: f.buscar, baseUrl: BASE })).toHaveLength(1);
  });

  it('corpo que não é lista vira lista vazia', async () => {
    const f = fetchFalso([TOKEN, { contem: '/catalogs', corpo: { erro: 'x' } }]);
    expect(await listarCatalogos(CRED, M, { buscar: f.buscar, baseUrl: BASE })).toEqual([]);
  });
});

describe('catalogoDeEntrega', () => {
  it('escolhe o DEFAULT, que é o canal de delivery', async () => {
    /* Importar do INDOOR traria preço de salão para o cardápio de entrega — a
       confusão exata que o conceito de contexto existe para evitar. */
    const r = catalogoDeEntrega([
      { catalogId: 'salao', context: ['INDOOR'], status: 'AVAILABLE' },
      { catalogId: 'entrega', context: ['DEFAULT'], status: 'AVAILABLE' },
    ]);
    expect(r!.catalogId).toBe('entrega');
  });

  it('sem DEFAULT, usa o primeiro em vez de desistir', async () => {
    /* Uma loja com um catálogo só, marcado com outro contexto, ainda tem
       cardápio para importar. */
    const r = catalogoDeEntrega([{ catalogId: 'unico', context: ['WHITELABEL'], status: 'AVAILABLE' }]);
    expect(r!.catalogId).toBe('unico');
  });

  it('sem catálogo nenhum é null', () => {
    expect(catalogoDeEntrega([])).toBeNull();
  });

  it('catálogo multi-contexto conta como DEFAULT se contiver DEFAULT', () => {
    const r = catalogoDeEntrega([{ catalogId: 'x', context: ['INDOOR', 'DEFAULT'], status: 'A' }]);
    expect(r!.catalogId).toBe('x');
  });
});

describe('listarCategorias', () => {
  it('monta o caminho pelo catálogo', async () => {
    const f = fetchFalso([TOKEN, { contem: '/categories', corpo: [
      { id: 'c1', name: 'Lanches', status: 'AVAILABLE', items: [{ id: 'i1' }, { id: 'i2' }] },
    ] }]);
    const r = await listarCategorias(CRED, M, 'cat-1', { buscar: f.buscar, baseUrl: BASE });
    expect(r[0]).toMatchObject({ id: 'c1', name: 'Lanches' });
    expect(r[0].items).toHaveLength(2);
    expect(f.chamadas.find(u => u.includes('/categories'))).toBe(
      `${BASE}/catalog/v2.0/merchants/merch-1/catalogs/cat-1/categories`,
    );
  });

  it('lista VAZIA é resposta legítima, não erro', async () => {
    /*
     * O catálogo do sandbox responde exatamente isso: 200 com []. Tratar como
     * falha faria a tela dizer "erro ao importar" quando a verdade é "não há
     * nada lá" — e o lojista procuraria um problema que não existe.
     */
    const f = fetchFalso([TOKEN, { contem: '/categories', corpo: [] }]);
    expect(await listarCategorias(CRED, M, 'cat-1', { buscar: f.buscar, baseUrl: BASE })).toEqual([]);
  });

  it('categoria sem itens não quebra', async () => {
    const f = fetchFalso([TOKEN, { contem: '/categories', corpo: [{ id: 'c1', name: 'Vazia' }] }]);
    const r = await listarCategorias(CRED, M, 'cat-1', { buscar: f.buscar, baseUrl: BASE });
    expect(r[0].items).toEqual([]);
  });
});

describe('buscarItemCompleto', () => {
  it('usa o /flat, que traz grupos e opções', async () => {
    /* A listagem de categoria pode não trazer os complementos completos; para
       importar um item de verdade é este o endpoint. */
    const f = fetchFalso([TOKEN, { contem: '/flat', corpo: { item: { id: 'i1' }, optionGroups: [] } }]);
    const r = await buscarItemCompleto(CRED, M, 'i1', { buscar: f.buscar, baseUrl: BASE });
    expect(r.item).toBeDefined();
    expect(f.chamadas.find(u => u.includes('/flat'))).toContain('/items/i1/flat');
  });

  it('corpo inválido vira objeto vazio, não explode', async () => {
    const f = fetchFalso([TOKEN, { contem: '/flat', corpo: null }]);
    expect(await buscarItemCompleto(CRED, M, 'i1', { buscar: f.buscar, baseUrl: BASE })).toEqual({});
  });
});

describe('listarVendaveis', () => {
  it('busca só o que está à venda', async () => {
    const f = fetchFalso([TOKEN, { contem: 'sellableItems', corpo: [{ id: 'i1' }] }]);
    const r = await listarVendaveis(CRED, M, 'cat-1', { buscar: f.buscar, baseUrl: BASE });
    expect(r).toHaveLength(1);
  });
});

describe('resumirCardapio', () => {
  it('conta o que existe ANTES de importar', async () => {
    /*
     * Importação que começa sem prévia é importação que o lojista descobre que
     * deu errado depois de o cardápio já estar bagunçado.
     */
    const f = fetchFalso([
      TOKEN,
      { contem: '/catalogs/', corpo: [
        { id: 'c1', name: 'Lanches', items: [{ id: 'a' }, { id: 'b' }] },
        { id: 'c2', name: 'Bebidas', items: [{ id: 'c' }] },
      ] },
      { contem: '/catalogs', corpo: CATALOGOS_REAIS },
    ]);
    const r = await resumirCardapio(CRED, M, { buscar: f.buscar, baseUrl: BASE });
    expect(r).toMatchObject({ categorias: 2, itens: 3, contexto: ['DEFAULT'] });
    expect(r!.nomes).toEqual(['Lanches', 'Bebidas']);
  });

  it('loja sem catálogo devolve null', async () => {
    const f = fetchFalso([TOKEN, { contem: '/catalogs', corpo: [] }]);
    expect(await resumirCardapio(CRED, M, { buscar: f.buscar, baseUrl: BASE })).toBeNull();
  });

  it('catálogo vazio conta zero, e isso NÃO é erro', async () => {
    /* É o estado real do sandbox hoje. */
    const f = fetchFalso([
      TOKEN,
      { contem: '/catalogs/', corpo: [] },
      { contem: '/catalogs', corpo: CATALOGOS_REAIS },
    ]);
    const r = await resumirCardapio(CRED, M, { buscar: f.buscar, baseUrl: BASE });
    expect(r).toMatchObject({ categorias: 0, itens: 0 });
  });
});

describe('listarItensDaCategoria', () => {
  it('busca no endpoint que REALMENTE devolve os itens', async () => {
    /*
     * Pego na tela, não no teste: `GET /catalogs/{id}/categories` devolve as
     * categorias com `items: []` mesmo havendo itens. A importação dizia "não
     * encontrei produtos" com um item cadastrado no catálogo.
     */
    const f = fetchFalso([TOKEN, { contem: '/items', corpo: { categoryId: 'c1', items: [{ id: 'i1' }] } }]);
    const r = await listarItensDaCategoria(CRED, M, 'c1', { buscar: f.buscar, baseUrl: BASE });
    expect(r).toHaveLength(1);
    expect(f.chamadas.find(u => u.includes('/items'))).toBe(
      `${BASE}/catalog/v2.0/merchants/merch-1/categories/c1/items`,
    );
  });

  it('aceita lista crua também', async () => {
    /* A API responde envelopado numa rota e cru noutra; aceitar os dois evita
       que a leitura dependa de qual formato veio. */
    const f = fetchFalso([TOKEN, { contem: '/items', corpo: [{ id: 'i1' }, { id: 'i2' }] }]);
    expect(await listarItensDaCategoria(CRED, M, 'c1', { buscar: f.buscar, baseUrl: BASE })).toHaveLength(2);
  });

  it('categoria vazia devolve lista vazia', async () => {
    const f = fetchFalso([TOKEN, { contem: '/items', corpo: { categoryId: 'c1', items: [] } }]);
    expect(await listarItensDaCategoria(CRED, M, 'c1', { buscar: f.buscar, baseUrl: BASE })).toEqual([]);
  });
});
