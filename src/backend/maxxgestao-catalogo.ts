/**
 * LER O CARDÁPIO DO MAXX GESTÃO.
 *
 * A direção é do ERP **para** o delivery, e isso é decisão de projeto, não
 * comodidade: puxando de lá, o produto chega com o perfil tributário já
 * vinculado e com o `idMercadoriaVariacao` que o documento fiscal exige. O
 * caminho contrário — cadastrar produto no ERP a partir do nosso — obrigaria
 * alguém a escolher NCM, CFOP e CSOSN no nosso cadastro, e errar isso é multa.
 *
 * O CAMINHO É EM DOIS SALTOS, e o segundo é caro:
 *
 *   catálogo → categorias → lista de IDS → um GET por produto
 *
 * `/mercadoria-catalogo/{id}/mercadorias/v1` devolve só inteiros
 * (`PublicaPagedResponseInt32`), não os produtos. Ou seja: um produto = uma
 * requisição, e o limite é de 20 por minuto. Cardápio de 100 itens leva cinco
 * minutos — por isso toda leitura aqui passa pelo limitador de
 * `maxxgestao-cliente`, e por isso a importação precisa poder ser retomada.
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
 * Os IDS dos produtos de um catálogo. Só os ids — é o que o endpoint devolve.
 *
 * Vem antes dos produtos de propósito: com a lista na mão dá para dizer "são
 * 137 itens, isto vai levar 7 minutos" ANTES de começar, em vez de descobrir no
 * meio. Numa importação que dura minutos, saber o tamanho é metade da paciência.
 */
export async function idsDoCatalogo(
  token: string,
  idCatalogo: number,
  opcoes: OpcoesMaxxGestao = {},
): Promise<number[]> {
  const brutos = await todasAsPaginas<unknown>(async p =>
    pagina(await chamarMaxxGestao(
      token, `/api/mercadoria-catalogo/${idCatalogo}/mercadorias/v1?page=${p}&limit=200`, opcoes)));
  const vistos = new Set<number>();
  for (const b of brutos) {
    const n = Number(b);
    /* Repetido acontece quando o produto está em mais de uma categoria do mesmo
       catálogo. Importar duas vezes criaria produto duplicado no delivery. */
    if (Number.isFinite(n) && n > 0) vistos.add(n);
  }
  return [...vistos];
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

/**
 * Quanto tempo a importação vai levar, em segundos.
 *
 * Uma requisição por produto, 20 por minuto. Serve para a tela avisar antes de
 * começar — "137 itens, cerca de 7 minutos" — em vez de deixar a pessoa olhando
 * um spinner e concluindo que travou.
 */
export function segundosEstimados(quantidadeDeProdutos: number, porMinuto = 20): number {
  if (quantidadeDeProdutos <= 0) return 0;
  /* As primeiras `porMinuto` saem sem espera (o balde começa cheio); as demais
     esperam 3 segundos cada. */
  const comEspera = Math.max(0, quantidadeDeProdutos - porMinuto);
  return Math.ceil((comEspera * 60) / porMinuto);
}
