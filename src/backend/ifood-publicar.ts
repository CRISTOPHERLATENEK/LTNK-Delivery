/**
 * PUBLICAR O CARDÁPIO DAQUI NO IFOOD.
 *
 * A direção oposta da sincronização, e a perigosa. Ler é reversível; isto não
 * é: a documentação do iFood é explícita de que **`PUT /items` substitui o item
 * completo — campos omitidos são REMOVIDOS**. Um item publicado sem o bloco de
 * complementos apaga os complementos daquele item no cardápio de verdade da
 * loja, com o cliente comprando do outro lado.
 *
 * DAÍ A REGRA CENTRAL DESTE MÓDULO: nunca montar um payload do zero. Publicar é
 * LER o item como ele está lá, sobrepor só os campos que são nossos, e devolver
 * o resto intacto. Tudo que existe no iFood e não existe no nosso modelo —
 * `contextModifiers` com preço de Cardápio Digital, campos que a API adicionar
 * amanhã — sobrevive por ser copiado, não por ser previsto.
 *
 * O contrário disso é a falha clássica desta integração: um payload "limpo",
 * montado a partir do nosso banco, que funciona lindamente no teste e apaga o
 * preço de outro canal em produção.
 *
 * O que este módulo NÃO cobre, de propósito: pizza e combo. Os dois têm
 * modelagem própria no iFood e não coincidem com `combo_itens` nem com
 * `fracoes` daqui. Item simples com complementos já resolve a maior parte do
 * cardápio, e pizza mal mapeada é pedido com sabor errado saindo da cozinha.
 */

/** O produto como ele existe aqui, com tudo que a publicação precisa. */
export interface ProdutoDaqui {
  id: number;
  nome: string;
  descricao: string;
  /** Vira `externalCode` lá. É a chave que liga os dois lados. */
  codigoBarras: string;
  precoCentavos: number;
  disponivel: boolean;
  grupos: Array<{
    nome: string;
    codigoExterno: string;
    obrigatorio: boolean;
    maxEscolhas: number;
    opcoes: Array<{
      nome: string;
      codigoExterno: string;
      precoAdicionalCentavos: number;
      disponivel: boolean;
    }>;
  }>;
}

/** Centavos → o decimal que o iFood usa em `price.value`. */
export function centavosParaPreco(centavos: number): number {
  /*
   * Divisão em ponto flutuante erra: 1999/100 dá 19.990000000000002, e o iFood
   * recebe um preço com doze casas. Arredondar em duas resolve — e duas casas é
   * o que existe em dinheiro.
   */
  return Math.round(centavos) / 100;
}

const STATUS = (disponivel: boolean) => (disponivel ? 'AVAILABLE' : 'UNAVAILABLE');

/**
 * O corpo do `PUT /items`, montado SOBRE o que já existe lá.
 *
 * `atual` é a resposta do `GET /items/{id}/flat`, ou `null` para item novo.
 * Cada bloco começa como cópia do que veio de lá e só depois recebe os nossos
 * campos: é isso que faz `contextModifiers` e qualquer coisa que a API criar
 * amanhã sobreviverem sem este arquivo saber que existem.
 */
export function montarPayloadItem(
  nosso: ProdutoDaqui,
  categoryId: string,
  atual: Record<string, unknown> | null,
): Record<string, unknown> {
  const flat = (atual ?? {}) as {
    item?: Record<string, unknown>;
    products?: Array<Record<string, unknown>>;
    optionGroups?: Array<Record<string, unknown>>;
    options?: Array<Record<string, unknown>>;
  };

  const itemAtual = flat.item ?? {};
  const produtosAtuais = flat.products ?? [];
  const gruposAtuais = flat.optionGroups ?? [];
  const opcoesAtuais = flat.options ?? [];

  const produtoPrincipal = produtosAtuais.find(
    p => String(p.id ?? '') === String(itemAtual.productId ?? ''),
  ) ?? {};

  /*
   * `productId` é OBRIGATÓRIO e não está documentado — descoberto criando o
   * item de teste, depois de o `POST` responder "PostProductDto is not valid"
   * sem dizer o que faltava. Preservar o de lá também evita criar um produto
   * novo a cada publicação, deixando órfãos no catálogo da loja.
   */
  const item: Record<string, unknown> = {
    ...itemAtual,
    categoryId: String(itemAtual.categoryId ?? categoryId),
    externalCode: nosso.codigoBarras,
    status: STATUS(nosso.disponivel),
    price: { ...(itemAtual.price as Record<string, unknown> ?? {}), value: centavosParaPreco(nosso.precoCentavos) },
  };

  const produtos: Array<Record<string, unknown>> = [];
  const grupos: Array<Record<string, unknown>> = [];
  const opcoes: Array<Record<string, unknown>> = [];

  /*
   * Os grupos ficam na RAIZ e o produto os referencia por id — não dentro do
   * item, como a documentação e o próprio assistente do iFood sugerem. Foi o
   * que fez o item de teste finalmente ser aceito.
   */
  const idsDosGrupos: string[] = [];

  nosso.grupos.forEach((g, i) => {
    const atualG = gruposAtuais.find(x => String(x.externalCode ?? '') === g.codigoExterno) ?? {};
    const optionIds: string[] = [];

    g.opcoes.forEach((o, j) => {
      const atualO = opcoesAtuais.find(x => String(x.externalCode ?? '') === o.codigoExterno) ?? {};
      const idOpcao = String(atualO.id ?? '') || `opcao-${g.codigoExterno}-${j}`;
      optionIds.push(idOpcao);

      /* A opção aponta para OUTRO produto — no iFood o complemento também é um
         produto. Sem preservar esse `productId`, cada publicação criaria um
         produto novo por complemento. */
      const produtoDaOpcao = produtosAtuais.find(p => String(p.id ?? '') === String(atualO.productId ?? ''));
      if (produtoDaOpcao) produtos.push({ ...produtoDaOpcao, name: o.nome });

      opcoes.push({
        ...atualO,
        id: idOpcao,
        index: j,
        status: STATUS(o.disponivel),
        externalCode: o.codigoExterno,
        price: { ...(atualO.price as Record<string, unknown> ?? {}), value: centavosParaPreco(o.precoAdicionalCentavos) },
      });
    });

    const idGrupo = String(atualG.id ?? '') || `grupo-${g.codigoExterno}`;
    idsDosGrupos.push(idGrupo);
    grupos.push({
      ...atualG,
      id: idGrupo,
      name: g.nome,
      externalCode: g.codigoExterno,
      index: i,
      status: 'AVAILABLE',
      /* `min > 0` é como o obrigatório existe lá: não há interruptor. */
      min: g.obrigatorio ? 1 : 0,
      max: Math.max(1, g.maxEscolhas),
      /* Nenhum exemplo da documentação mostra este campo, e sem ele o grupo é
         recusado. */
      optionGroupType: String(atualG.optionGroupType ?? 'DEFAULT'),
      optionIds,
    });
  });

  produtos.unshift({
    ...produtoPrincipal,
    name: nosso.nome,
    description: nosso.descricao,
    externalCode: nosso.codigoBarras,
    optionGroups: idsDosGrupos,
  });

  return { item, products: produtos, optionGroups: grupos, options: opcoes };
}

export interface PlanoPublicacao {
  /** Não existem lá: entram como item novo. */
  criar: ProdutoDaqui[];
  /** Existem lá e mudaram: `PUT` por cima do que já está. */
  atualizar: Array<{ produto: ProdutoDaqui; itemId: string }>;
  /** Sem código de barras: não há como ligar os dois lados. */
  semCodigo: string[];
  /** Estão lá e não aqui. Só relatório — publicar não apaga. */
  soExistemNoIfood: string[];
}

/**
 * O que publicar, comparando pelo código.
 *
 * Produto sem código de barras fica de fora e é reportado: sem chave, a única
 * alternativa seria casar por nome, e um nome parecido publicaria por cima do
 * item errado — do lado onde o cliente compra.
 *
 * Nada é apagado do iFood, mesma decisão da sincronização e pelo mesmo motivo:
 * isto roda sozinho, e um cardápio apagado no domingo à noite não tem desfazer.
 */
export function planejarPublicacao(
  nossos: readonly ProdutoDaqui[],
  itensDeLa: ReadonlyMap<string, string>,
): PlanoPublicacao {
  const plano: PlanoPublicacao = { criar: [], atualizar: [], semCodigo: [], soExistemNoIfood: [] };
  const usados = new Set<string>();

  for (const p of nossos) {
    const codigo = p.codigoBarras.trim();
    if (!codigo) { plano.semCodigo.push(p.nome); continue; }

    const itemId = itensDeLa.get(codigo);
    if (itemId) { plano.atualizar.push({ produto: p, itemId }); usados.add(codigo); }
    else plano.criar.push(p);
  }

  for (const [codigo] of itensDeLa) {
    if (!usados.has(codigo)) plano.soExistemNoIfood.push(codigo);
  }

  return plano;
}
