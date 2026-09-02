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
 * 3. NUNCA PUBLICA SOZINHO. Produto novo entra pausado, com o marcador de
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
  }>;
  atualizar: Array<{
    id: number; nome?: string; descricao?: string; categoria?: string;
    /** Só vem preenchido quando o nosso preço ainda é o marcador. */
    precoCentavos?: number;
  }>;
  /** Estavam vinculados e saíram do catálogo do ERP: pausar, nunca apagar. */
  pausar: number[];
  /** Já iguais. Contados só para a tela poder dizer "nada mudou". */
  semMudanca: number;
}

export const PLANO_VAZIO: PlanoImportacao = { criar: [], atualizar: [], pausar: [], semMudanca: 0 };

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
  const plano: PlanoImportacao = { criar: [], atualizar: [], pausar: [], semMudanca: 0 };

  const porVariacao = new Map<number, ProdutoNosso>();
  for (const p of nossos) if (p.variacaoErp > 0) porVariacao.set(p.variacaoErp, p);

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

    const nosso = porVariacao.get(produto.variacao);
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
    if (produto.descricao !== nosso.nome) { campos.nome = produto.descricao; mudou = true; }
    if (produto.descricaoAdicional !== nosso.descricao) { campos.descricao = produto.descricaoAdicional; mudou = true; }
    if (item.categoria && item.categoria !== nosso.categoria) { campos.categoria = item.categoria; mudou = true; }

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

/** O plano não faz nada? Para a tela não dizer "importado" sem ter importado. */
export function planoVazio(p: PlanoImportacao): boolean {
  return p.criar.length === 0 && p.atualizar.length === 0 && p.pausar.length === 0;
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
  if (!partes.length) return p.semMudanca ? `Nada mudou — ${p.semMudanca} já estavam iguais.` : 'Nada para importar.';
  const frase = partes.join(', ');
  /* O aviso do preço vai JUNTO do sucesso, não numa tela de ajuda: produto novo
     entra a R$ 0,01 e pausado, e quem acabou de importar é quem precisa saber. */
  return p.criar.length
    ? `${frase}. Os novos entraram pausados, a R$ 0,01 — defina o preço antes de publicar.`
    : `${frase}.`;
}
