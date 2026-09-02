/**
 * LER O CARDÁPIO DO MAXX GESTÃO.
 *
 * A direção é do ERP **para** o delivery, e isso é decisão de projeto, não
 * comodidade: puxando de lá, o produto chega com o perfil tributário já
 * vinculado e com o `idMercadoriaVariacao` que o documento fiscal exige. O
 * caminho contrário — cadastrar produto no ERP a partir do nosso — obrigaria
 * alguém a escolher NCM, CFOP e CSOSN no nosso cadastro, e errar isso é multa.
 *
 * `GET /api/mercadoria/v1` É BUSCA, NÃO LISTAGEM — e essa é a pegadinha.
 *
 * Sem o parâmetro `filtro` ele devolve `total: 0`. Não é "nenhum produto": é
 * "nenhum resultado para busca vazia". Numa conta com 1.108 mercadorias
 * cadastradas, a nossa primeira importação disse "nada para importar" — e o
 * erro parecia estar no cadastro do cliente.
 *
 * COM filtro ele devolve o produto INTEIRO (52 campos), até 100 por página. E
 * uma letra sozinha cobre quase tudo: na conta conferida, `filtro=a` traz 1.034
 * dos 1.108 em 11 requisições. Por isso a leitura é uma VARREDURA por vogais e
 * dígitos, com deduplicação — não um GET por produto.
 *
 * O caminho por ids (`/mercadoria-secao/{id}/mercadorias/v1`, que devolve os
 * 1.108 como inteiros) continua servindo para UMA coisa: saber o que existe lá,
 * e portanto o que sumiu daqui. Para os dados do produto ele custaria uma
 * requisição por item — 1.108 a 20 por minuto é quase uma hora.
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
  /**
   * O código interno (SKU) — a `Referência` da tela deles.
   *
   * NÃO é o identificador do documento fiscal: esse é o `variacao`. A
   * referência serve para gente reconhecer o produto, e no cadastro conferido
   * ela vem VAZIA em todos os itens. Fica lida porque o dia em que for
   * preenchida ninguém vai lembrar de voltar aqui.
   */
  referencia: string;
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
    /* Variação primeiro: quando as duas existem, a da variação é a específica. */
    referencia: (String(d.referenciaVariacao ?? '').trim()
      || String(d.referenciaMercadoria ?? '').trim()),
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
 * As letras da varredura.
 *
 * TRÊS LETRAS, E O NÚMERO VEIO DE MEDIÇÃO. Na conta real (1.108 mercadorias):
 * `a` traz 1.044 e `a` + `e` juntas dão 1.111 únicos — ou seja, o catálogo
 * inteiro. A terceira é folga para contas com nomes atípicos.
 *
 * Cada letra a mais custa UM MINUTO de espera, porque só cabem 20 requisições
 * por minuto e uma letra gasta 11. A lista original tinha quinze letras: quinze
 * minutos para não trazer nada além do que duas já trazem.
 *
 * A ordem importa: a primeira letra já traz a maior parte, então uma importação
 * interrompida no meio deixa o cardápio quase completo em vez de aleatório.
 */
export const LETRAS_VARREDURA = ['a', 'e', 'o'];

/**
 * Busca mercadorias por um filtro, com todas as páginas.
 *
 * `limit=100` porque é o teto deles: pedir 500 devolve 100 e a página 1 de 11
 * viraria 1 de 11 do mesmo jeito — só sem a gente saber.
 */
export async function buscarMercadorias(
  token: string,
  filtro: string,
  mapas: { subgrupos: Map<number, string>; grupos: Map<number, string> },
  opcoes: OpcoesMaxxGestao = {},
): Promise<Array<{ produto: ProdutoErp; categoria: string }>> {
  const brutos = await todasAsPaginas<Record<string, unknown>>(async p =>
    pagina(await chamarMaxxGestao(
      token, `/api/mercadoria/v1?filtro=${encodeURIComponent(filtro)}&page=${p}&limit=100`, opcoes)));
  const fora: Array<{ produto: ProdutoErp; categoria: string }> = [];
  for (const b of brutos) {
    const produto = produtoDoErp(b);
    /* Sem vínculo ou sem nome não entra — ver `produtoDoErp`. Descartar aqui é
       melhor que importar um item que derruba a emissão no dia da venda. */
    if (produto) fora.push({ produto, categoria: categoriaDoProduto(b, mapas) });
  }
  return fora;
}

/**
 * OS IDS DE UM CATÁLOGO — `GET /api/mercadoria-catalogo/{id}/mercadorias/v1`.
 *
 * Só ids (`PublicaPagedResponseInt32`), e é o suficiente: a varredura por letra
 * já traz os produtos inteiros, então o catálogo serve para PENEIRAR — importar
 * "RESTAURANTE" em vez das 1.108 mercadorias da empresa.
 *
 * Usar este endpoint para buscar os DADOS custaria uma requisição por produto:
 * 820 itens a 20 por minuto é quarenta minutos.
 */
export async function idsDoCatalogo(
  token: string,
  idCatalogo: number,
  opcoes: OpcoesMaxxGestao = {},
): Promise<Set<number>> {
  const brutos = await todasAsPaginas<unknown>(async p =>
    pagina(await chamarMaxxGestao(
      token, `/api/mercadoria-catalogo/${idCatalogo}/mercadorias/v1?page=${p}&limit=100`, opcoes)));
  const ids = new Set<number>();
  for (const b of brutos) {
    const n = Number(b);
    /* Repetido acontece quando o produto está em mais de uma categoria do mesmo
       catálogo. */
    if (Number.isFinite(n) && n > 0) ids.add(n);
  }
  return ids;
}

/**
 * TODOS os códigos de mercadoria que existem na empresa, pela seção.
 *
 * Só ids, e é o suficiente para o que ele serve: saber o que ainda existe lá, e
 * portanto o que pode ser pausado aqui. Usar isto para trazer os DADOS custaria
 * uma requisição por produto.
 */
export async function idsDaSecao(
  token: string,
  idSecao: number,
  opcoes: OpcoesMaxxGestao = {},
): Promise<Set<number>> {
  const brutos = await todasAsPaginas<unknown>(async p =>
    pagina(await chamarMaxxGestao(
      token, `/api/mercadoria-secao/${idSecao}/mercadorias/v1?page=${p}&limit=100`, opcoes)));
  const ids = new Set<number>();
  for (const b of brutos) {
    const n = Number(b);
    if (Number.isFinite(n) && n > 0) ids.add(n);
  }
  return ids;
}

/**
 * OS PREÇOS DE UMA TABELA — `GET /api/tabela-preco/{id}/mercadorias/v1`.
 *
 * Eu havia afirmado que não existia leitura de preço de venda, e estava errado:
 * olhei só `/api/mercadoria-tabela-preco/v1`, que é PUT, e generalizei. O
 * produto (52 campos) realmente não traz preço — ele mora na tabela, e a tabela
 * tem endpoint de leitura próprio.
 *
 * Devolve centavos, não reais: dinheiro em ponto flutuante é como se perde um
 * centavo por item sem ninguém notar.
 */
export async function precosDaTabela(
  token: string,
  idTabela: number,
  opcoes: OpcoesMaxxGestao = {},
): Promise<Map<number, number>> {
  const brutos = await todasAsPaginas<Record<string, unknown>>(async p =>
    pagina(await chamarMaxxGestao(
      token, `/api/tabela-preco/${idTabela}/mercadorias/v1?page=${p}&limit=100`, opcoes)));
  const precos = new Map<number, number>();
  for (const b of brutos) {
    const variacao = Number(b.codigoMercadoriaVariacao ?? 0);
    const reais = Number(b.valPreco ?? 0);
    /* Preço zero ou negativo não é preço: fica de fora e o produto cai no
       marcador de 1 centavo, que é visivelmente errado e pede atenção. */
    if (variacao > 0 && Number.isFinite(reais) && reais > 0) {
      precos.set(variacao, Math.round(reais * 100));
    }
  }
  return precos;
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
export function segundosEstimados(quantidadeDeProdutos: number, porPagina = 100, porMinuto = 20): number {
  if (quantidadeDeProdutos <= 0) return 0;
  const paginas = Math.ceil(quantidadeDeProdutos / porPagina);
  /* As primeiras `porMinuto` requisições saem sem espera (o balde começa
     cheio); as demais esperam 3 segundos cada. */
  const comEspera = Math.max(0, paginas - porMinuto);
  return Math.ceil((comEspera * 60) / porMinuto);
}
