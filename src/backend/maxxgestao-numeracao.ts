/**
 * O PRÓXIMO NÚMERO DO DOCUMENTO NO MAXX GESTÃO.
 *
 * ─────────────────────── O QUE ESTAVA ACONTECENDO ───────────────────────
 *
 * O delivery montava o documento sem `numero` e sem `serie`. A API não recusa —
 * a documentação do próprio campo diz:
 *
 *   numero → "Número do documento. Quando não informado, grava 0."
 *   serie  → "Série do documento. Retorna string vazia quando não informada."
 *
 * Então todo pedido que subiu daqui ficou no Gestão com **Número 0 e Série
 * vazia**, em silêncio, enquanto os do PDV entram com Número 13 e Série 1. Não
 * deu erro nenhum em lugar nenhum: a API aceitou, gravou zero e devolveu 200.
 *
 * ─────────────────────── POR QUE ISTO EXISTE ───────────────────────
 *
 * A API PÚBLICA NÃO GERA A SEQUÊNCIA. Li os 258 endpoints: não há nada que
 * devolva "o próximo número". Os únicos caminhos com "série" são de número de
 * série de MERCADORIA (rastreio de produto). `/api/empresa/configuracoes/v1`
 * devolve três campos, nenhum deles de numeração. Quem numera é o cliente.
 *
 * ─────────────────────── COMO SE DESCOBRE O ÚLTIMO ───────────────────────
 *
 * `GET /api/documento/v1` aceita `Serie`, `Modelo`, `page` e `limit` — e NÃO
 * aceita nenhum parâmetro de ordenação. A documentação não diz em que ordem a
 * lista sai, e eu não consegui medir na conta de produção.
 *
 * Então não dependo da ordem: leio AS DUAS PONTAS. Com `total` da primeira
 * resposta dá para pedir a última página, e o maior número entre as duas pontas
 * é o último da série, venha a lista crescente ou decrescente. São duas
 * chamadas em vez de uma, e é o preço de não chutar.
 */

/** O que a listagem devolve, do pouco que interessa aqui. */
export interface PaginaDocumentos {
  total?: unknown;
  items?: Array<{ numero?: unknown }>;
}

/** Número inteiro positivo, ou zero. Texto e nulo do ERP caem em zero. */
function inteiro(bruto: unknown): number {
  const n = Number(bruto ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** O maior `numero` de uma página. Página vazia vale zero. */
export function maiorNumero(pagina: PaginaDocumentos | null): number {
  let maior = 0;
  for (const item of pagina?.items ?? []) {
    const n = inteiro(item?.numero);
    if (n > maior) maior = n;
  }
  return maior;
}

/**
 * Quantas páginas a listagem tem, dado o `total` e o tamanho da página.
 *
 * `total` ausente ou zero vale UMA página: é o que a primeira leitura já
 * trouxe, e pedir a página zero seria chamada jogada fora.
 */
export function ultimaPagina(total: unknown, porPagina: number): number {
  const t = inteiro(total);
  if (t <= 0 || porPagina <= 0) return 1;
  return Math.max(1, Math.ceil(t / porPagina));
}

/**
 * A série gravada, ou o padrão.
 *
 * Série é TEXTO no ERP (o campo é string), então "1" e 1 são a mesma coisa e o
 * espaço em branco não é. Valor vazio no banco cai em `1`, que é a série do PDV
 * — a alternativa seria voltar a mandar série vazia, que é o defeito.
 */
export function serieValida(bruto: unknown): string {
  const s = String(bruto ?? '').trim();
  return s || '1';
}

/**
 * O PRÓXIMO NÚMERO, ou zero quando não deu para saber.
 *
 * ZERO É "NÃO SEI", e quem chama decide o que fazer — que não é mandar zero. A
 * distinção importa: série sem nenhum documento devolve 1 (o primeiro), e falha
 * de leitura devolve 0. Tratar as duas igual faria o primeiro pedido de uma
 * loja nova nascer com o mesmo número de um pedido cuja consulta caiu.
 */
export async function proximoNumero(
  ler: (caminho: string) => Promise<PaginaDocumentos | null>,
  serie: string,
  modelo: string,
): Promise<number> {
  const POR_PAGINA = 50;
  const filtro = `Serie=${encodeURIComponent(serie)}&Modelo=${encodeURIComponent(modelo)}`;
  const primeira = await ler(`/api/documento/v1?${filtro}&page=1&limit=${POR_PAGINA}`);
  if (!primeira) return 0;

  let maior = maiorNumero(primeira);
  const fim = ultimaPagina(primeira.total, POR_PAGINA);
  /*
   * A SEGUNDA PONTA SÓ QUANDO EXISTE. Série com menos de uma página inteira já
   * veio toda na primeira leitura — a segunda chamada devolveria os mesmos
   * documentos e gastaria uma das 20 requisições por minuto à toa.
   */
  if (fim > 1) {
    const ultima = await ler(`/api/documento/v1?${filtro}&page=${fim}&limit=${POR_PAGINA}`);
    maior = Math.max(maior, maiorNumero(ultima));
  }

  /* Série ainda sem documento nenhum começa no 1, e não no 0: zero é o número
     que os pedidos quebrados receberam, e reusá-lo misturaria os dois casos. */
  return maior + 1;
}
