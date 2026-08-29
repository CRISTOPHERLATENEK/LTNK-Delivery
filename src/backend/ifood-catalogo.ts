/**
 * LEITURA DO CARDÁPIO NO IFOOD.
 *
 * Só leitura. Nada aqui altera o cardápio do lojista — o módulo de publicação é
 * outro, e a separação é deliberada: o `PUT /items` **substitui o item
 * completo**, então um erro lá apaga complementos em produção. Ler é
 * reversível; escrever não é.
 *
 * O CAMINHO DA DOCUMENTAÇÃO NÃO FUNCIONA. A página de Endpoints do iFood manda
 *
 *     GET /catalog/v2.0/merchants/{merchantId}/categories?include_items=true
 *
 * e isso responde 404 `no Route matched with those values` — 404 de gateway,
 * nem chega na aplicação deles. Confirmado chamando: o caminho real passa pelo
 * catálogo, e é preciso listar os catálogos antes para ter o id. Está escrito
 * aqui porque quem for mexer vai consultar a doc e encontrar o caminho errado.
 */
import { chamarIfood, type CredenciaisIfood, type OpcoesIfood } from './ifood-cliente';
import { traduzirItem, type ProdutoImportado } from './ifood-importar';

/**
 * Um catálogo da loja.
 *
 * `context` é a lista de canais que ele atende. O mesmo item pode ter preço e
 * disponibilidade diferentes por canal, e o nosso cardápio não tem esse
 * conceito — por isso quem importa precisa escolher um.
 */
export interface CatalogoIfood {
  catalogId: string;
  /** DEFAULT (entrega), WHITELABEL (cardápio digital), INDOOR (consumo no local). */
  context: string[];
  status: string;
  modifiedAt?: string;
}

const base = (merchantId: string) =>
  `/catalog/v2.0/merchants/${encodeURIComponent(merchantId)}`;

/** Os catálogos da loja. Sempre existe pelo menos um. */
export async function listarCatalogos(
  cred: CredenciaisIfood,
  merchantId: string,
  opcoes?: OpcoesIfood,
): Promise<CatalogoIfood[]> {
  const { corpo } = await chamarIfood(cred, `${base(merchantId)}/catalogs`, { method: 'GET' }, opcoes);
  if (!Array.isArray(corpo)) return [];
  return (corpo as Array<Record<string, unknown>>)
    .map(c => ({
      catalogId: String(c.catalogId ?? '').trim(),
      context: Array.isArray(c.context) ? c.context.map(String) : [],
      status: String(c.status ?? '').trim(),
      modifiedAt: c.modifiedAt ? String(c.modifiedAt) : undefined,
    }))
    .filter(c => c.catalogId);
}

/**
 * O catálogo de ENTREGA, que é o que interessa para importar.
 *
 * `DEFAULT` é o canal de delivery — o mesmo de onde vêm os pedidos que já
 * entram no painel. Importar do `INDOOR` (consumo no local) traria preço de
 * salão para o cardápio de entrega, que é justamente a confusão que o conceito
 * de contexto existe para evitar.
 *
 * Sem nenhum `DEFAULT`, devolve o primeiro em vez de nada: uma loja com um
 * catálogo só, marcado com outro contexto, ainda tem cardápio para importar.
 */
export function catalogoDeEntrega(catalogos: readonly CatalogoIfood[]): CatalogoIfood | null {
  if (catalogos.length === 0) return null;
  return catalogos.find(c => c.context.includes('DEFAULT')) ?? catalogos[0];
}

export interface CategoriaIfood {
  id: string;
  name: string;
  status: string;
  /** Itens vêm juntos quando pedidos — cada um já com produto e complementos. */
  items: Array<Record<string, unknown>>;
}

/**
 * As categorias do catálogo, com os itens dentro.
 *
 * Lista vazia é resposta LEGÍTIMA, não erro: o catálogo do sandbox está vazio e
 * responde `[]` com 200. Tratar isso como falha faria a tela dizer "erro ao
 * importar" quando a verdade é "não há nada lá".
 */
export async function listarCategorias(
  cred: CredenciaisIfood,
  merchantId: string,
  catalogId: string,
  opcoes?: OpcoesIfood,
): Promise<CategoriaIfood[]> {
  const { corpo } = await chamarIfood(
    cred,
    `${base(merchantId)}/catalogs/${encodeURIComponent(catalogId)}/categories`,
    { method: 'GET' },
    opcoes,
  );
  if (!Array.isArray(corpo)) return [];
  return (corpo as Array<Record<string, unknown>>)
    .map(c => ({
      id: String(c.id ?? '').trim(),
      name: String(c.name ?? '').trim(),
      status: String(c.status ?? '').trim(),
      items: Array.isArray(c.items) ? (c.items as Array<Record<string, unknown>>) : [],
    }))
    .filter(c => c.id);
}

/**
 * Os itens de UMA categoria.
 *
 * Existe porque `GET /catalogs/{id}/categories` devolve as categorias com
 * `items: []` — mesmo quando há itens. Descoberto na tela: a importação dizia
 * "não encontrei produtos" com um item cadastrado no catálogo. É este endpoint
 * que traz a lista de verdade.
 */
export async function listarItensDaCategoria(
  cred: CredenciaisIfood,
  merchantId: string,
  categoryId: string,
  opcoes?: OpcoesIfood,
): Promise<Array<Record<string, unknown>>> {
  const { corpo } = await chamarIfood(
    cred,
    `${base(merchantId)}/categories/${encodeURIComponent(categoryId)}/items`,
    { method: 'GET' },
    opcoes,
  );
  if (Array.isArray(corpo)) return corpo as Array<Record<string, unknown>>;
  const d = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  return Array.isArray(d.items) ? (d.items as Array<Record<string, unknown>>) : [];
}

/**
 * Um item com TUDO: produto, grupos de opção e opções.
 *
 * O `/flat` existe porque a listagem de categoria pode não trazer os
 * complementos completos. Para importar um item de verdade — com os grupos e as
 * opções que o cliente escolhe — é este o endpoint.
 *
 * Devolve o corpo cru de propósito: a tradução para o nosso formato precisa ser
 * escrita contra um payload REAL, e o catálogo do sandbox está vazio. Inventar
 * a tradução agora repetiria o erro que a etapa 3 já pagou.
 */
export async function buscarItemCompleto(
  cred: CredenciaisIfood,
  merchantId: string,
  itemId: string,
  opcoes?: OpcoesIfood,
): Promise<Record<string, unknown>> {
  const { corpo } = await chamarIfood(
    cred,
    `${base(merchantId)}/items/${encodeURIComponent(itemId)}/flat`,
    { method: 'GET' },
    opcoes,
  );
  return (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
}

/** Só os itens ativos e à venda. Útil para não importar o que está pausado lá. */
export async function listarVendaveis(
  cred: CredenciaisIfood,
  merchantId: string,
  catalogId: string,
  opcoes?: OpcoesIfood,
): Promise<Array<Record<string, unknown>>> {
  const { corpo } = await chamarIfood(
    cred,
    `${base(merchantId)}/catalogs/${encodeURIComponent(catalogId)}/sellableItems`,
    { method: 'GET' },
    opcoes,
  );
  return Array.isArray(corpo) ? (corpo as Array<Record<string, unknown>>) : [];
}

export interface ResumoCardapio {
  catalogId: string;
  contexto: string[];
  categorias: number;
  itens: number;
  /** Nomes das categorias, para a tela mostrar o que será importado. */
  nomes: string[];
}

/**
 * O que existe no cardápio de lá, sem importar nada.
 *
 * Existe para a tela poder mostrar "encontrei 4 categorias e 37 itens" ANTES de
 * o lojista confirmar. Importação que começa sem prévia é importação que o
 * lojista descobre que deu errado depois de o cardápio já estar bagunçado.
 */
export async function resumirCardapio(
  cred: CredenciaisIfood,
  merchantId: string,
  opcoes?: OpcoesIfood,
): Promise<ResumoCardapio | null> {
  const catalogo = catalogoDeEntrega(await listarCatalogos(cred, merchantId, opcoes));
  if (!catalogo) return null;

  const categorias = await listarCategorias(cred, merchantId, catalogo.catalogId, opcoes);
  return {
    catalogId: catalogo.catalogId,
    contexto: catalogo.context,
    categorias: categorias.length,
    itens: categorias.reduce((n, c) => n + c.items.length, 0),
    nomes: categorias.map(c => c.name).filter(Boolean),
  };
}

/**
 * O cardápio do iFood já traduzido para o nosso formato.
 *
 * Fica aqui, e não na rota, porque a importação também roda por comando no
 * servidor — e um leitor duplicado seria um leitor não testado.
 */
export async function lerCardapioIfood(
  cred: CredenciaisIfood,
  merchantId: string,
): Promise<ProdutoImportado[]> {
  const catalogo = catalogoDeEntrega(await listarCatalogos(cred, merchantId));
  if (!catalogo) return [];

  const categorias = await listarCategorias(cred, merchantId, catalogo.catalogId);
  const produtos: ProdutoImportado[] = [];
  for (const c of categorias) {
    /*
     * Os itens NÃO vêm dentro da categoria: `GET /catalogs/{id}/categories`
     * devolve `items: []` mesmo quando há itens. Pego testando na tela — a
     * importação dizia "não encontrei produtos" com um item cadastrado.
     */
    const itens = c.items.length ? c.items : await listarItensDaCategoria(cred, merchantId, c.id);
    for (const it of itens) {
      const id = String((it as Record<string, unknown>).id ?? '').trim();
      if (!id) continue;
      try {
        /*
         * Um `/flat` POR ITEM. A listagem de categoria traz o item, mas não
         * garante grupos e opções completos — e importar complemento pela
         * metade é pior que não importar: o cliente escolheria de uma lista
         * incompleta e a cozinha receberia um pedido que não fecha.
         */
        const t = traduzirItem(await buscarItemCompleto(cred, merchantId, id));
        if (t) produtos.push(t);
      } catch (e) {
        console.error(`[ifood] falha ao ler item ${id}:`, (e as Error).message);
      }
    }
  }
  return produtos;
}
