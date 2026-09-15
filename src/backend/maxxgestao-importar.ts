/**
 * O QUE FAZER COM O CARDÁPIO QUE VEIO DO ERP.
 *
 * Decisão pura: entra produto do Maxx Gestão e o cardápio que já existe no
 * delivery, sai um plano. Sem banco, sem rede — para poder ser testada com
 * casos que na produção aparecem uma vez por ano.
 *
 * TRÊS COISAS QUE ESTE MÓDULO NUNCA FAZ, e cada uma custou dinheiro em algum
 * lugar antes de virar regra:
 *
 * 1. NUNCA SOBRESCREVE PREÇO DE VERDADE. O preço do ERP entra na CRIAÇÃO, e
 *    numa atualização só quando o nosso ainda é o marcador de R$ 0,01 — ou
 *    seja, quando ninguém precificou ainda. Reimportar não pode desfazer o
 *    trabalho de quem ajustou o preço de delivery, que costuma ser diferente do
 *    balcão.
 * 2. NUNCA APAGA. Produto que saiu do catálogo do ERP é PAUSADO, não excluído:
 *    excluir levaria embora o histórico de pedidos que aponta para ele.
 * 3. NUNCA DESFAZ EDIÇÃO DO LOJISTA. Nome, descrição e categoria só são
 *    atualizados enquanto ninguém os tocou aqui — ver `EspelhoErp`.
 * 4. NUNCA PUBLICA SOZINHO. Produto novo entra pausado, com o marcador de
 *    R$ 0,01 — visivelmente errado, que é o ponto. Um produto a um centavo
 *    pausado grita "me preencha"; qualquer valor plausível passaria batido e
 *    seria vendido a esse valor.
 */
import type { ProdutoErp } from './maxxgestao-catalogo';

/** Um produto do delivery, do jeito que a decisão precisa ver. */
export interface ProdutoNosso {
  id: number;
  nome: string;
  descricao: string;
  categoria: string;
  /** O vínculo com o ERP. Zero = produto que nasceu aqui. */
  variacaoErp: number;
  disponivel: boolean;
  /** Em centavos. `PRECO_MARCADOR` significa "ninguém precificou ainda". */
  precoCentavos: number;
  /** O código interno que já está gravado aqui. */
  sku: string;
  /**
   * O CÓDIGO DE BARRAS, e ele está aqui por um motivo específico.
   *
   * O casamento com o ERP era só por `variacaoErp`. Quando o vínculo se perde
   * — produto cadastrado à mão antes de ligar o ERP, recadastro lá que troca a
   * variação, alguém zerando o campo — o mesmo produto passa a parecer NOVO, e
   * o plano manda criá-lo. Aí o banco recusa pelo índice único de EAN por loja
   * e a gravação inteira morre, levando junto todas as atualizações legítimas
   * da passada. Medido no Mostruário em 14/09/2026:
   * `Duplicate entry '1-7622210533005' for key 'uq_produto_ean'`.
   *
   * Com o código de barras aqui, esse produto é RECONHECIDO e RELIGADO em vez
   * de duplicado.
   */
  codigoBarras: string;
  /**
   * O QUE O ERP DISSE POR ÚLTIMO. Vazio em produto que nasceu aqui.
   *
   * Comparar o nosso valor com ESTE, e não com o do ERP, é o que separa "o ERP
   * renomeou o produto" de "o lojista renomeou o produto". Sem o espelho as
   * duas situações são a mesma comparação, e aí só existem dois
   * comportamentos: sobrescrever sempre (perde a edição de quem usa) ou nunca
   * atualizar (o cardápio congela desatualizado).
   */
  espelho?: EspelhoErp;
}

/** Nome, descrição e categoria como vieram do ERP na última importação. */
export interface EspelhoErp {
  nome: string;
  descricao: string;
  categoria: string;
}

/**
 * O campo pode ser atualizado?
 *
 * Só quando o nosso valor é IGUAL ao que o ERP mandou por último — ou seja,
 * ninguém mexeu nele aqui. Editado uma vez, o campo passa a ser do lojista para
 * sempre; e é o certo: quem encurtou "SALGADINHO BITES SNACKS CEBOLA 90GR" para
 * "Bites Cebola" fez isso porque o nome do ERP não serve na vitrine dele.
 *
 * Produto sem espelho (nasceu aqui, ou foi importado antes deste campo existir)
 * é tratado como NÃO EDITADO: é o comportamento antigo, e mudar isso de uma vez
 * congelaria nome e categoria de mil produtos que ninguém tocou.
 */
export function podeAtualizar(nosso: string, espelhado: string | undefined): boolean {
  if (espelhado === undefined) return true;
  return nosso === espelhado;
}

/**
 * O PREÇO QUE GRITA "ME PREENCHA".
 *
 * O CHECK da coluna exige `preco_centavos > 0`, então zero não entra. Um
 * centavo é visivelmente errado de propósito: qualquer valor plausível passaria
 * batido e o produto seria vendido por ele.
 *
 * Também é o SINAL de que ninguém precificou — é o que permite a importação
 * preencher o preço depois sem risco de pisar em cima de decisão de gente.
 */
export const PRECO_MARCADOR = 1;

/** Produto do ERP junto da categoria em que ele aparece no catálogo. */
export interface ItemDoCatalogo {
  produto: ProdutoErp;
  categoria: string;
  /** Em centavos, da tabela de preço do ERP. Ausente = ele não tem preço. */
  precoCentavos?: number;
}

export interface PlanoImportacao {
  criar: Array<{
    variacao: number; nome: string; descricao: string; categoria: string;
    codigoBarras: string;
    /** Do ERP; `PRECO_MARCADOR` quando ele não tem preço para este produto. */
    precoCentavos: number;
    sku: string;
    /** O que o ERP mandou — o produto nasce com o espelho igual ao valor. */
    espelho: EspelhoErp;
  }>;
  atualizar: Array<{
    id: number; nome?: string; descricao?: string; categoria?: string;
    /** Só vem preenchido quando o nosso preço ainda é o marcador. */
    precoCentavos?: number;
    sku?: string;
    /** O que o ERP diz hoje, para a próxima importação comparar. */
    espelho?: EspelhoErp;
  }>;
  /** Estavam vinculados e saíram do catálogo do ERP: pausar, nunca apagar. */
  pausar: number[];
  /**
   * PRODUTOS QUE JÁ EXISTIAM AQUI E FORAM RECONHECIDOS PELO CÓDIGO DE BARRAS.
   *
   * Não é criação nem edição de conteúdo: é acertar o vínculo que faltava. Vem
   * separado para a tela poder dizer "religados" — um número que explica por
   * que um cardápio que parecia ter 100 produtos novos na verdade tinha zero.
   */
  religar: Array<{ id: number; variacao: number }>;
  /** Já iguais. Contados só para a tela poder dizer "nada mudou". */
  semMudanca: number;
}

export const PLANO_VAZIO: PlanoImportacao = { criar: [], atualizar: [], pausar: [], religar: [], semMudanca: 0 };

/** O plano. */
export function planejarImportacao(
  doErp: ItemDoCatalogo[],
  nossos: ProdutoNosso[],
  opcoes: {
    /**
     * Pausar o que não apareceu? Só com a lista COMPLETA do ERP.
     *
     * A leitura é uma varredura por letra, em pedaços, para caber no limite de
     * requisições. Num pedaço, "não apareceu" significa "ainda não chegou a
     * vez" — pausar aí tiraria do ar metade do cardápio a cada importação.
     */
    pausarAusentes?: boolean;
  } = {},
): PlanoImportacao {
  const pausarAusentes = opcoes.pausarAusentes !== false;
  const plano: PlanoImportacao = { criar: [], atualizar: [], pausar: [], religar: [], semMudanca: 0 };

  const porVariacao = new Map<number, ProdutoNosso>();
  for (const p of nossos) if (p.variacaoErp > 0) porVariacao.set(p.variacaoErp, p);

  /*
   * O SEGUNDO JEITO DE RECONHECER O MESMO PRODUTO: o código de barras.
   *
   * O primeiro (a variação do ERP) falha sempre que o vínculo se perde, e aí o
   * produto parece novo — o plano manda criar, o banco recusa pelo índice único
   * de EAN por loja, e a gravação INTEIRA morre. O código de barras é o que o
   * ERP e o cardápio têm em comum sem depender de vínculo nenhum.
   *
   * SÓ PRODUTO AINDA NÃO VINCULADO entra neste índice. Um já ligado a outra
   * variação é outro produto do ERP que por acaso repete o EAN (acontece com
   * embalagem diferente do mesmo item); roubá-lo daqui trocaria dois produtos
   * de lugar em silêncio — muito pior que a duplicata que estamos evitando.
   *
   * O PRIMEIRO GANHA quando dois produtos nossos repetem o mesmo EAN: o índice
   * único impede isso hoje, mas cadastro antigo pode ter escapado, e escolher
   * em silêncio é melhor que derrubar a passada.
   */
  const porCodigoBarras = new Map<string, ProdutoNosso>();
  for (const p of nossos) {
    const ean = (p.codigoBarras || '').trim();
    if (!ean || p.variacaoErp > 0) continue;
    if (!porCodigoBarras.has(ean)) porCodigoBarras.set(ean, p);
  }
  /** Já usados nesta passada — um produto nosso não pode casar com dois do ERP. */
  const religados = new Set<number>();

  const vistos = new Set<number>();

  for (const item of doErp) {
    const { produto } = item;
    vistos.add(produto.variacao);

    /*
     * INATIVO NO ERP NÃO ENTRA, mas se já entrou antes, é pausado — não
     * ignorado. Ignorar deixaria à venda no app um produto que a loja desativou
     * no sistema dela, e a pessoa procuraria o motivo no lugar errado.
     */
    if (!produto.ativo) {
      const nosso = porVariacao.get(produto.variacao);
      if (nosso?.disponivel) plano.pausar.push(nosso.id);
      continue;
    }

    /*
     * PELA VARIAÇÃO PRIMEIRO, PELO CÓDIGO DE BARRAS DEPOIS. A ordem importa: a
     * variação é o vínculo explícito, o EAN é o reconhecimento de última hora.
     */
    let nosso = porVariacao.get(produto.variacao);
    if (!nosso) {
      const ean = (produto.codigoBarras || '').trim();
      const achado = ean ? porCodigoBarras.get(ean) : undefined;
      if (achado && !religados.has(achado.id)) {
        religados.add(achado.id);
        plano.religar.push({ id: achado.id, variacao: produto.variacao });
        /* Daqui para baixo ele é tratado como qualquer produto vinculado: o
           vínculo é que estava faltando, não o produto. */
        nosso = { ...achado, variacaoErp: produto.variacao };
      }
    }
    if (!nosso) {
      plano.criar.push({
        variacao: produto.variacao,
        nome: produto.descricao,
        descricao: produto.descricaoAdicional,
        categoria: item.categoria,
        codigoBarras: produto.codigoBarras,
        /* Sem preço no ERP, nasce no marcador — não em zero, que o banco
           recusa, nem num valor inventado, que seria vendido. */
        precoCentavos: item.precoCentavos && item.precoCentavos > 0 ? item.precoCentavos : PRECO_MARCADOR,
        sku: produto.referencia,
        /* Nasce com o espelho IGUAL ao que foi gravado: a primeira importação
           não pode parecer edição do lojista. */
        espelho: {
          nome: produto.descricao,
          descricao: produto.descricaoAdicional,
          categoria: item.categoria,
        },
      });
      continue;
    }

    /*
     * SÓ O QUE MUDOU VAI NO UPDATE.
     *
     * Mandar todos os campos sempre faria a data de alteração de todo o
     * cardápio mudar a cada importação — e aí "o que mexeram ontem?" deixa de
     * ter resposta. O `semMudanca` existe para a tela poder dizer "nada mudou"
     * em vez de "137 produtos atualizados" depois de não fazer nada.
     */
    const campos: PlanoImportacao['atualizar'][number] = { id: nosso.id };
    let mudou = false;

    /*
     * PREÇO SÓ POR CIMA DO MARCADOR.
     *
     * É o que conserta os produtos que já entraram a R$ 0,01 sem fechar a porta
     * para quem precificou: se o nosso preço não é mais o marcador, alguém
     * decidiu, e decisão de gente não é sobrescrita por importação.
     */
    if (nosso.precoCentavos === PRECO_MARCADOR
        && item.precoCentavos && item.precoCentavos > PRECO_MARCADOR) {
      campos.precoCentavos = item.precoCentavos;
      mudou = true;
    }
    /*
     * NOME, DESCRIÇÃO E CATEGORIA: só enquanto ninguém editou aqui.
     *
     * A comparação é contra o ESPELHO (o que o ERP disse por último), não
     * contra o valor do ERP agora. Antes era contra o valor atual, e o efeito
     * era invisível e caro: o lojista encurtava um nome para caber na vitrine e
     * a importação seguinte devolvia o nome de sistema, sem avisar.
     */
    if (produto.descricao !== nosso.nome && podeAtualizar(nosso.nome, nosso.espelho?.nome)) {
      campos.nome = produto.descricao; mudou = true;
    }
    if (produto.descricaoAdicional !== nosso.descricao && podeAtualizar(nosso.descricao, nosso.espelho?.descricao)) {
      campos.descricao = produto.descricaoAdicional; mudou = true;
    }
    if (item.categoria && item.categoria !== nosso.categoria && podeAtualizar(nosso.categoria, nosso.espelho?.categoria)) {
      campos.categoria = item.categoria; mudou = true;
    }

    /*
     * O ESPELHO É ATUALIZADO SEMPRE que o ERP mudou, mesmo quando o valor não
     * foi aplicado. Ele registra o que o ERP diz hoje — não o que está na nossa
     * tela. Deixá-lo velho faria a próxima importação recomparar contra um
     * valor que já não existe lá.
     */
    const espelhoNovo: EspelhoErp = {
      nome: produto.descricao,
      descricao: produto.descricaoAdicional,
      categoria: item.categoria || (nosso.espelho?.categoria ?? ''),
    };
    if (!nosso.espelho
        || nosso.espelho.nome !== espelhoNovo.nome
        || nosso.espelho.descricao !== espelhoNovo.descricao
        || nosso.espelho.categoria !== espelhoNovo.categoria) {
      campos.espelho = espelhoNovo;
      mudou = true;
    }

    /*
     * SKU SÓ QUANDO O ERP TEM UM. Referência vazia lá não é ordem para apagar a
     * daqui — se alguém preencheu o código interno no nosso cadastro, uma
     * importação de um ERP com o campo em branco levaria embora.
     */
    if (produto.referencia && produto.referencia !== nosso.sku) {
      campos.sku = produto.referencia;
      mudou = true;
    }

    if (mudou) plano.atualizar.push(campos);
    else plano.semMudanca++;
  }

  /*
   * O QUE SAIU DO CATÁLOGO.
   *
   * Só entra aqui produto que TEM vínculo com o ERP. Produto que nasceu no
   * delivery (`variacaoErp = 0`) não é da conta desta importação — pausá-lo
   * seria apagar do ar o cardápio que o lojista montou à mão.
   */
  if (pausarAusentes) {
    for (const nosso of nossos) {
      if (nosso.variacaoErp > 0 && !vistos.has(nosso.variacaoErp) && nosso.disponivel) {
        plano.pausar.push(nosso.id);
      }
    }
  }

  return plano;
}

/**
 * PENEIRA PELO CATÁLOGO.
 *
 * A varredura por letra traz a empresa inteira; o catálogo diz quais daqueles
 * produtos entram. Feito aqui, e não na leitura, porque ler por catálogo
 * custaria uma requisição por produto.
 *
 * Conjunto vazio devolve tudo: "catálogo sem itens" e "não filtrar" são
 * situações diferentes, e quem chama só passa o conjunto quando escolheu um
 * catálogo de verdade.
 */
export function peneirarPorCatalogo(
  itens: ItemDoCatalogo[],
  idsDoCatalogo: Set<number>,
): ItemDoCatalogo[] {
  if (idsDoCatalogo.size === 0) return itens;
  return itens.filter(i => idsDoCatalogo.has(i.produto.variacao));
}

/** O plano não faz nada? Para a tela não dizer "importado" sem ter importado. */
export function planoVazio(p: PlanoImportacao): boolean {
  return p.religar.length === 0 && p.criar.length === 0 && p.atualizar.length === 0 && p.pausar.length === 0;
}

/**
 * Resumo em português para o lojista.
 *
 * Frase montada e não contadores soltos: "3 novos, 2 atualizados" é lido; "3 |
 * 2 | 0" precisa de legenda.
 */
export function resumoDoPlano(p: PlanoImportacao): string {
  const partes: string[] = [];
  if (p.criar.length) partes.push(`${p.criar.length} produto${p.criar.length > 1 ? 's' : ''} novo${p.criar.length > 1 ? 's' : ''}`);
  if (p.atualizar.length) partes.push(`${p.atualizar.length} atualizado${p.atualizar.length > 1 ? 's' : ''}`);
  if (p.pausar.length) partes.push(`${p.pausar.length} pausado${p.pausar.length > 1 ? 's' : ''}`);
  /* RELIGADO NÃO É NOVO NEM EDITADO: é o vínculo que faltava. Sem a palavra
     própria, o lojista leria "100 novos" num cardápio que não ganhou nenhum. */
  if (p.religar.length) partes.push(`${p.religar.length} religado${p.religar.length > 1 ? 's' : ''} ao ERP`);
  if (!partes.length) return p.semMudanca ? `Nada mudou — ${p.semMudanca} já estavam iguais.` : 'Nada para importar.';
  const frase = partes.join(', ');
  /* O aviso do preço vai JUNTO do sucesso, não numa tela de ajuda: produto novo
     entra a R$ 0,01 e pausado, e quem acabou de importar é quem precisa saber. */
  return p.criar.length
    ? `${frase}. Os novos entraram pausados, a R$ 0,01 — defina o preço antes de publicar.`
    : `${frase}.`;
}
