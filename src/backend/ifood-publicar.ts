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

import { randomUUID } from 'crypto';

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
  /* Injetável só para o teste poder prever os ids. */
  novoId: () => string = () => randomUUID(),
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
  /*
   * OS IDS SÃO GERADOS POR QUEM CHAMA — a API não os cria.
   *
   * Descoberto publicando de verdade: item novo sem id responde `FullItemDto is
   * not valid`, sem dizer o que falta. É o sétimo caso em que esta API exige
   * algo que a documentação não mostra. O `id` do item, o `productId` e o id de
   * cada produto de complemento precisam vir prontos, em UUID.
   */
  const idItem = String(itemAtual.id ?? '') || novoId();
  const idProdutoPrincipal = String(itemAtual.productId ?? '') || String(produtoPrincipal.id ?? '') || novoId();

  const item: Record<string, unknown> = {
    ...itemAtual,
    id: idItem,
    productId: idProdutoPrincipal,
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
      const idOpcao = String(atualO.id ?? '') || novoId();
      optionIds.push(idOpcao);

      /* A opção aponta para OUTRO produto — no iFood o complemento também é um
         produto. Preservar esse `productId` evita criar um produto novo por
         complemento a cada publicação; quando não existe, é preciso criar um,
         porque a opção não pode apontar para o vazio. */
      const produtoDaOpcao = produtosAtuais.find(p => String(p.id ?? '') === String(atualO.productId ?? ''));
      const idProdutoOpcao = String(produtoDaOpcao?.id ?? '') || novoId();
      produtos.push({
        ...(produtoDaOpcao ?? {}),
        id: idProdutoOpcao,
        name: o.nome,
        externalCode: o.codigoExterno,
      });

      opcoes.push({
        ...atualO,
        id: idOpcao,
        productId: idProdutoOpcao,
        index: j,
        status: STATUS(o.disponivel),
        externalCode: o.codigoExterno,
        price: { ...(atualO.price as Record<string, unknown> ?? {}), value: centavosParaPreco(o.precoAdicionalCentavos) },
      });
    });

    const idGrupo = String(atualG.id ?? '') || novoId();
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
    id: idProdutoPrincipal,
    name: nosso.nome,
    description: nosso.descricao,
    externalCode: nosso.codigoBarras,
    optionGroups: idsDosGrupos,
  });

  return { item, products: produtos, optionGroups: grupos, options: opcoes };
}

/**
 * Abaixo ou igual a isto, o produto NUNCA foi precificado aqui.
 *
 * Mesmo marcador da importação, que grava 1 centavo porque o CHECK da coluna
 * exige > 0. Vale repetir por que ele importa tanto nesta direção: uma loja que
 * importou o cardápio do iFood e ainda não precificou, ao ligar a publicação,
 * mandaria os próprios produtos de volta a R$ 0,01 — e desta vez para o lado
 * onde o cliente compra de verdade. Pego no primeiro ensaio contra a API real.
 */
export const PRECO_NAO_DEFINIDO_CENTAVOS = 1;

export interface PlanoPublicacao {
  /** Não existem lá: entram como item novo. */
  criar: ProdutoDaqui[];
  /** Existem lá e mudaram: `PUT` por cima do que já está. */
  atualizar: Array<{ produto: ProdutoDaqui; itemId: string }>;
  /** Sem código de barras: não há como ligar os dois lados. */
  semCodigo: string[];
  /** Ainda com o preço-marcador da importação: publicar seria vender a R$ 0,01. */
  semPreco: string[];
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
  const plano: PlanoPublicacao = { criar: [], atualizar: [], semCodigo: [], semPreco: [], soExistemNoIfood: [] };
  const usados = new Set<string>();

  for (const p of nossos) {
    const codigo = p.codigoBarras.trim();
    if (!codigo) { plano.semCodigo.push(p.nome); continue; }

    /*
     * O produto que nunca foi precificado aqui NÃO vai. Antes de existir esta
     * guarda, o ensaio contra a API real mostrou que o X-Bacon — importado do
     * iFood e ainda sem preço — seria publicado de volta a R$ 0,01.
     */
    if (p.precoCentavos <= PRECO_NAO_DEFINIDO_CENTAVOS) {
      plano.semPreco.push(p.nome);
      usados.add(codigo);
      continue;
    }

    const itemId = itensDeLa.get(codigo);
    if (itemId) { plano.atualizar.push({ produto: p, itemId }); usados.add(codigo); }
    else plano.criar.push(p);
  }

  for (const [codigo] of itensDeLa) {
    if (!usados.has(codigo)) plano.soExistemNoIfood.push(codigo);
  }

  return plano;
}
