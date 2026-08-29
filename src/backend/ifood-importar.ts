/**
 * O ITEM DO IFOOD TRADUZIDO PARA UM PRODUTO NOSSO.
 *
 * Escrito contra `fixtures/ifood-item-flat.json` — um item REAL, criado no
 * sandbox e lido de volta pelo `/flat`. Não contra os exemplos da documentação,
 * que nesta API já erraram cinco vezes seguidas (caminho de escrita, campo
 * obrigatório ausente, posição dos grupos, referência do grupo e o
 * `optionGroupType` que nenhum exemplo mostra).
 *
 * A estrutura de lá é achatada e ligada por id: o `item` aponta para um
 * `product`, o `product` lista os `optionGroups` que usa, cada grupo lista os
 * `optionIds`, e cada `option` aponta para OUTRO `product`. Nada disso é
 * aninhado — reconstruir a árvore é o trabalho deste módulo.
 */

/** O que vem do `GET /items/{id}/flat`. */
export interface ItemFlat {
  item?: Record<string, unknown>;
  products?: Array<Record<string, unknown>>;
  optionGroups?: Array<Record<string, unknown>>;
  options?: Array<Record<string, unknown>>;
}

export interface OpcaoImportada {
  nome: string;
  codigoExterno: string;
  precoCentavos: number;
  disponivel: boolean;
}

export interface GrupoImportado {
  nome: string;
  codigoExterno: string;
  min: number;
  max: number;
  opcoes: OpcaoImportada[];
}

export interface ProdutoImportado {
  nome: string;
  descricao: string;
  /** É por ele que o PEDIDO casa com o produto: vai para `codigo_barras`. */
  codigoExterno: string;
  /** Preço do iFood, em centavos. Ver `precoParaImportar`. */
  precoIfoodCentavos: number;
  disponivel: boolean;
  fotoUrl: string;
  grupos: GrupoImportado[];
}

/** Reais decimais → centavos. Mesmo cuidado do pedido: arredonda, não trunca. */
export function precoParaCentavos(v: unknown): number {
  const n = Number((v as Record<string, unknown> | undefined)?.value ?? v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/**
 * O PREÇO DO IFOOD NÃO VAI PARA O CARDÁPIO PRÓPRIO.
 *
 * O lojista normalmente sobe o preço no iFood para absorver a comissão. Trazer
 * esse valor para o cardápio direto faz o cliente que compra no link da loja
 * pagar uma comissão que ali não existe — a integração passaria de "poupa
 * digitação" para "sabota a margem", e ninguém perceberia porque o número
 * parece certo.
 *
 * Devolve o preço do iFood apenas como REFERÊNCIA, para a tela mostrar ao lado
 * do campo vazio. A decisão continua sendo do lojista.
 */
export function precoParaImportar(): null {
  return null;
}

/**
 * Reconstrói a árvore do item.
 *
 * Índices por id porque a estrutura de lá é achatada: procurar em lista dentro
 * de laço vira O(n²) num cardápio de centenas de itens, e importação lenta é
 * importação que o lojista cancela no meio.
 */
export function traduzirItem(flat: ItemFlat): ProdutoImportado | null {
  const item = flat.item ?? {};
  const produtos = new Map<string, Record<string, unknown>>();
  for (const p of flat.products ?? []) {
    const id = String(p.id ?? '').trim();
    if (id) produtos.set(id, p);
  }

  const principal = produtos.get(String(item.productId ?? '').trim());
  /*
   * Sem o produto principal não há o que importar. Acontece se o payload vier
   * truncado — e criar produto com nome vazio é pior que pular: entra no
   * cardápio como uma linha em branco que ninguém sabe de onde veio.
   */
  if (!principal) return null;

  const gruposPorId = new Map<string, Record<string, unknown>>();
  for (const g of flat.optionGroups ?? []) {
    const id = String(g.id ?? '').trim();
    if (id) gruposPorId.set(id, g);
  }
  const opcoesPorId = new Map<string, Record<string, unknown>>();
  for (const o of flat.options ?? []) {
    const id = String(o.id ?? '').trim();
    if (id) opcoesPorId.set(id, o);
  }

  /*
   * QUEM DIZ min/max É O PRODUTO, não o grupo.
   *
   * O mesmo grupo pode ser usado por vários produtos com limites diferentes —
   * "Adicionais" pode ser até 2 num lanche e até 5 noutro. O grupo na raiz
   * também traz min/max, mas o que vale para ESTE produto é o da referência
   * dentro dele. Ler do grupo faria o limite de um produto vazar para o outro.
   */
  const refs = Array.isArray(principal.optionGroups)
    ? (principal.optionGroups as Array<Record<string, unknown>>)
    : [];

  const grupos: GrupoImportado[] = [];
  for (const ref of refs) {
    const g = gruposPorId.get(String(ref.id ?? '').trim());
    if (!g) continue;

    const opcoes: OpcaoImportada[] = [];
    for (const oid of (Array.isArray(g.optionIds) ? g.optionIds : []) as unknown[]) {
      const o = opcoesPorId.get(String(oid ?? '').trim());
      if (!o) continue;
      /* A opção aponta para um PRODUTO — é dele que vem o nome. A opção sozinha
         só tem id, preço e status. */
      const po = produtos.get(String(o.productId ?? '').trim());
      const nome = String(po?.name ?? '').trim();
      if (!nome) continue;
      opcoes.push({
        nome,
        codigoExterno: String(o.externalCode ?? po?.externalCode ?? '').trim(),
        precoCentavos: precoParaCentavos(o.price),
        disponivel: String(o.status ?? '').toUpperCase() === 'AVAILABLE',
      });
    }

    /* Grupo sem opção legível não vira grupo: no nosso cadastro ele apareceria
       como uma pergunta sem resposta possível. */
    if (opcoes.length === 0) continue;

    grupos.push({
      nome: String(g.name ?? '').trim(),
      codigoExterno: String(g.externalCode ?? '').trim(),
      min: Math.max(0, Math.trunc(Number(ref.min ?? g.min ?? 0)) || 0),
      max: Math.max(1, Math.trunc(Number(ref.max ?? g.max ?? 1)) || 1),
      opcoes,
    });
  }

  return {
    nome: String(principal.name ?? '').trim(),
    descricao: String(principal.description ?? '').trim(),
    codigoExterno: String(principal.externalCode ?? item.externalCode ?? '').trim(),
    precoIfoodCentavos: precoParaCentavos(item.price),
    disponivel: String(item.status ?? '').toUpperCase() === 'AVAILABLE',
    /* `imagePath` vem vazio quando não há foto, e é caminho relativo do CDN
       deles quando há. Guardamos como veio; quem consome decide o que fazer. */
    fotoUrl: String(principal.imagePath ?? '').trim(),
    grupos,
  };
}

export interface PlanoImportacao {
  /** Produtos que ainda não existem aqui — serão criados. */
  novos: ProdutoImportado[];
  /** Já existem, casados pelo código externo — serão pulados. */
  jaExistem: Array<{ produto: ProdutoImportado; produtoId: number }>;
  /** Sem código externo: não dá para casar com segurança. */
  semCodigo: ProdutoImportado[];
}

/**
 * Decide o que fazer com cada item ANTES de gravar.
 *
 * A tela mostra isso para o lojista confirmar. Importar sem prévia é como o
 * cardápio vira duas cópias de tudo — e desfazer isso é trabalho manual, item
 * por item.
 *
 * O CASAMENTO É PELO CÓDIGO EXTERNO, nunca pelo nome. "X-Bacon" e "X Bacon"
 * são o mesmo produto para uma pessoa e produtos diferentes para uma
 * comparação de texto; errar para o lado de duplicar é reversível na mão,
 * errar para o lado de mesclar sobrescreve o cadastro que o lojista já tinha.
 *
 * Item sem código externo vai para uma lista própria em vez de virar "novo":
 * ele PODE já existir aqui, e nós não temos como saber. Quem decide é o
 * lojista, olhando.
 */
export function planejarImportacao(
  itens: readonly ProdutoImportado[],
  existentesPorCodigo: ReadonlyMap<string, number>,
): PlanoImportacao {
  const plano: PlanoImportacao = { novos: [], jaExistem: [], semCodigo: [] };
  /* Dois itens do iFood com o MESMO código externo: o segundo não é novo, é
     repetido. Sem isto a importação criaria os dois. */
  const vistos = new Set<string>();

  for (const p of itens) {
    if (!p.nome) continue;
    if (!p.codigoExterno) { plano.semCodigo.push(p); continue; }

    const existente = existentesPorCodigo.get(p.codigoExterno);
    if (existente !== undefined) { plano.jaExistem.push({ produto: p, produtoId: existente }); continue; }

    if (vistos.has(p.codigoExterno)) { plano.jaExistem.push({ produto: p, produtoId: -1 }); continue; }
    vistos.add(p.codigoExterno);
    plano.novos.push(p);
  }

  return plano;
}
