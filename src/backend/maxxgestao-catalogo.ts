/**
 * LER O CARDÁPIO DO MAXX GESTÃO.
 *
 * A direção é do ERP **para** o delivery, e isso é decisão de projeto, não
 * comodidade: puxando de lá, o produto chega com o perfil tributário já
 * vinculado e com o `idMercadoriaVariacao` que o documento fiscal exige. O
 * caminho contrário — cadastrar produto no ERP a partir do nosso — obrigaria
 * alguém a escolher NCM, CFOP e CSOSN no nosso cadastro, e errar isso é multa.
 *
 * O CAMINHO É `GET /api/mercadoria/v1`, PAGINADO — e isso importa.
 *
 * A listagem devolve o produto INTEIRO (os 52 campos), 50 por página. Com o
 * limite de 20 requisições por minuto, um cardápio de mil itens sai em 20
 * páginas, ou seja num minuto.
 *
 * O caminho pelo catálogo (`/mercadoria-catalogo/{id}/mercadorias/v1`) foi a
 * minha primeira escolha e era ruim: aquele endpoint devolve só INTEIROS
 * (`PublicaPagedResponseInt32`), obrigando um GET por produto — 137 produtos,
 * 137 requisições, sete minutos. Fica registrado porque a diferença entre os
 * dois não está na documentação, e a escolha errada parece razoável até alguém
 * comparar.
 *
 * A CATEGORIA vem do subgrupo (ou do grupo) da mercadoria, não das categorias
 * do catálogo: não existe endpoint que ligue item a categoria do catálogo — só
 * dá para listar as categorias e, separadamente, os ids do catálogo inteiro.
 */
import { chamarMaxxGestao, type OpcoesMaxxGestao } from './maxxgestao-cliente';

/** O envelope paginado que toda listagem deles usa. */
interface Pagina<T> {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  items: T[] | null;
}

function pagina<T>(bruto: unknown): Pagina<T> {
  const d = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  return {
    page: Number(d.page ?? 1),
    limit: Number(d.limit ?? 0),
    total: Number(d.total ?? 0),
    totalPages: Number(d.totalPages ?? 1),
    hasNext: !!d.hasNext,
    items: Array.isArray(d.items) ? (d.items as T[]) : [],
  };
}

/**
 * Percorre TODAS as páginas de uma listagem.
 *
 * `hasNext` manda, e não a conta `page < totalPages`: as duas deveriam
 * concordar, e quando não concordam quem tem razão é quem sabe se sobrou algo.
 *
 * O teto de páginas existe para um `hasNext` sempre verdadeiro não virar laço
 * infinito consumindo as 20 requisições do minuto para sempre.
 */
export async function todasAsPaginas<T>(
  ler: (pagina: number) => Promise<Pagina<T>>,
  tetoDePaginas = 200,
): Promise<T[]> {
  const tudo: T[] = [];
  for (let p = 1; p <= tetoDePaginas; p++) {
    const atual = await ler(p);
    tudo.push(...(atual.items ?? []));
    if (!atual.hasNext || (atual.items ?? []).length === 0) break;
  }
  return tudo;
}

export interface CatalogoErp {
  codigo: number;
  descricao: string;
  idTabelaPreco: number;
  ativo: boolean;
}

export async function listarCatalogos(
  token: string,
  opcoes: OpcoesMaxxGestao = {},
): Promise<CatalogoErp[]> {
  const brutos = await todasAsPaginas<Record<string, unknown>>(async p =>
    pagina(await chamarMaxxGestao(token, `/api/mercadoria-catalogo/v1?page=${p}&limit=50`, opcoes)));
  return brutos.map(c => ({
    codigo: Number(c.codigo ?? 0),
    descricao: String(c.descricao ?? ''),
    idTabelaPreco: Number(c.idTabelaPreco ?? 0),
    /* `ativo` deles é 'S'/'N', não booleano. */
    ativo: String(c.ativo ?? 'S').toUpperCase() === 'S',
  })).filter(c => c.codigo > 0);
}

export interface CategoriaErp {
  codigo: number;
  descricao: string;
  ordem: number;
  ativo: boolean;
}

export async function listarCategorias(
  token: string,
  idCatalogo: number,
  opcoes: OpcoesMaxxGestao = {},
): Promise<CategoriaErp[]> {
  const brutos = await todasAsPaginas<Record<string, unknown>>(async p =>
    pagina(await chamarMaxxGestao(
      token, `/api/mercadoria-catalogo/${idCatalogo}/categorias/v1?page=${p}&limit=50`, opcoes)));
  return brutos.map(c => ({
    codigo: Number(c.codigo ?? 0),
    descricao: String(c.descricao ?? ''),
    ordem: Number(c.ordem ?? 0),
    ativo: String(c.ativo ?? 'S').toUpperCase() === 'S',
  })).filter(c => c.codigo > 0);
}

/**
 * Um produto do ERP, só com o que nos interessa.
 *
 * `codigoMercadoriaVariacao` é O VÍNCULO. É ele que o documento fiscal exige em
 * `mercadoriaLista[].idMercadoriaVariacao`, então é ele que guardamos — não o
 * código de barras, que em restaurante quase nunca existe e quando existe muda.
 *
 * NÃO TEM PREÇO, e não é esquecimento: nenhum endpoint de leitura deles devolve
 * preço de venda (o produto tem 52 campos e nenhum é preço; `mercadoria-custo`
 * só dá custo; e a tabela de preço é PUT apenas). Por decisão do dono do
 * projeto, o preço mora no delivery.
 */
export interface ProdutoErp {
  variacao: number;
  mercadoria: number;
  descricao: string;
  descricaoAdicional: string;
  codigoBarras: string;
  ncm: string;
  cest: string;
  ativo: boolean;
}

export async function consultarMercadoria(
  token: string,
  id: number,
  opcoes: OpcoesMaxxGestao = {},
): Promise<ProdutoErp | null> {
  const d = await chamarMaxxGestao(token, `/api/mercadoria/v1/${id}`, opcoes) as Record<string, unknown> | null;
  return produtoDoErp(d);
}

/** Tradução isolada da rede, para poder ser testada com a resposta real. */
export function produtoDoErp(d: Record<string, unknown> | null): ProdutoErp | null {
  if (!d || typeof d !== 'object') return null;
  const variacao = Number(d.codigoMercadoriaVariacao ?? 0);
  const descricao = String(d.descricao ?? '').trim();
  /*
   * SEM VÍNCULO OU SEM NOME, NÃO ENTRA. Produto sem `codigoMercadoriaVariacao`
   * não pode ir para a nota depois — importá-lo criaria um item de cardápio que
   * derruba a emissão no dia da venda, longe daqui.
   */
  if (!Number.isFinite(variacao) || variacao <= 0 || !descricao) return null;
  return {
    variacao,
    mercadoria: Number(d.codigoMercadoria ?? d.idMercadoria ?? 0),
    descricao,
    descricaoAdicional: String(d.descricaoAdicional ?? '').trim(),
    codigoBarras: String(d.codigoBarras ?? '').trim(),
    ncm: String(d.ncm ?? '').trim(),
    cest: String(d.cest ?? '').trim(),
    ativo: String(d.ativo ?? 'S').toUpperCase() === 'S',
  };
}

/** Subgrupo e grupo, que é de onde sai a categoria do cardápio. */
export async function mapaDeCategorias(
  token: string,
  opcoes: OpcoesMaxxGestao = {},
): Promise<{ subgrupos: Map<number, string>; grupos: Map<number, string> }> {
  const ler = async (caminho: string) => {
    const brutos = await todasAsPaginas<Record<string, unknown>>(async p =>
      pagina(await chamarMaxxGestao(token, `${caminho}?page=${p}&limit=100`, opcoes)));
    const m = new Map<number, string>();
    for (const c of brutos) {
      const codigo = Number(c.codigo ?? 0);
      const descricao = String(c.descricao ?? '').trim();
      if (codigo > 0 && descricao) m.set(codigo, descricao);
    }
    return m;
  };
  return {
    subgrupos: await ler('/api/mercadoria-subgrupo/v1'),
    grupos: await ler('/api/mercadoria-grupo/v1'),
  };
}

/**
 * TODAS as mercadorias da empresa, com os campos que interessam.
 *
 * `limit=50` e não 500: o limite deles é de requisições, não de bytes, mas
 * página gigante é o tipo de coisa que a API corta em silêncio e devolve
 * incompleta. Cinquenta é o que a própria doc usa nos exemplos.
 */
export async function listarMercadorias(
  token: string,
  mapas: { subgrupos: Map<number, string>; grupos: Map<number, string> },
  opcoes: OpcoesMaxxGestao = {},
): Promise<Array<{ produto: ProdutoErp; categoria: string }>> {
  const brutos = await todasAsPaginas<Record<string, unknown>>(async p =>
    pagina(await chamarMaxxGestao(token, `/api/mercadoria/v1?page=${p}&limit=50`, opcoes)));
  const fora: Array<{ produto: ProdutoErp; categoria: string }> = [];
  for (const b of brutos) {
    const produto = produtoDoErp(b);
    /* Sem vínculo ou sem nome não entra — ver `produtoDoErp`. Descartar aqui é
       melhor que importar um item que derruba a emissão no dia da venda. */
    if (produto) fora.push({ produto, categoria: categoriaDoProduto(b, mapas) });
  }
  return fora;
}

/** A categoria do cardápio: subgrupo, depois grupo, depois nada. */
export function categoriaDoProduto(
  bruto: Record<string, unknown>,
  mapas: { subgrupos: Map<number, string>; grupos: Map<number, string> },
): string {
  /*
   * Subgrupo primeiro porque é o mais específico: nesta conta o grupo é
   * "Restaurantes" para tudo, enquanto o subgrupo separa SALGADINHOS, DOCES,
   * CONSERVAS — que é o que serve de categoria num cardápio.
   */
  return mapas.subgrupos.get(Number(bruto.idSubgrupo ?? 0))
    ?? mapas.grupos.get(Number(bruto.idGrupo ?? 0))
    ?? '';
}

/**
 * Quanto tempo a importação vai levar, em segundos.
 *
 * Uma requisição por produto, 20 por minuto. Serve para a tela avisar antes de
 * começar — "137 itens, cerca de 7 minutos" — em vez de deixar a pessoa olhando
 * um spinner e concluindo que travou.
 */
export function segundosEstimados(quantidadeDeProdutos: number, porPagina = 50, porMinuto = 20): number {
  if (quantidadeDeProdutos <= 0) return 0;
  const paginas = Math.ceil(quantidadeDeProdutos / porPagina);
  /* As primeiras `porMinuto` requisições saem sem espera (o balde começa
     cheio); as demais esperam 3 segundos cada. */
  const comEspera = Math.max(0, paginas - porMinuto);
  return Math.ceil((comEspera * 60) / porMinuto);
}
