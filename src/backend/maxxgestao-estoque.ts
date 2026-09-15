/**
 * O SALDO DO ERP VIRANDO ESTOQUE DO CARDÁPIO.
 *
 * Decisão pura: entram os saldos que o Maxx Gestão informou e os produtos que
 * temos, sai a lista do que gravar. Sem banco e sem rede — porque a parte
 * perigosa aqui não é ler o número, é decidir o que ele significa.
 *
 * ─────────────────── POR QUE ISTO NÃO TIRA PRODUTO DO AR ───────────────────
 *
 * MEDIDO NO CADASTRO REAL DO GALDERIO em 15/09/2026, antes de escrever uma
 * linha:
 *
 *   variações com linha de estoque .... 1.219
 *   saldo > 0 ......................... 738
 *   saldo = 0 ......................... 306
 *   saldo < 0 ......................... 175
 *
 *   produtos à venda hoje ............. 644
 *   ficariam SEM SALDO ................ 210  (33%)
 *
 * Um terço do cardápio sairia do ar no primeiro minuto — incluindo Coca-Cola
 * Zero 2L e Pepsi 2L, que a loja obviamente vende, com saldo zero. E 175 itens
 * com saldo NEGATIVO dizem o que realmente está acontecendo: o estoque do ERP
 * não é mantido item a item. Isso não é defeito da loja; é como quase todo
 * comércio usa o sistema.
 *
 * Então a sincronização GRAVA O NÚMERO e não liga o bloqueio. Quem decide que
 * um produto some quando zera é o lojista, produto a produto, pelo
 * `controla_estoque` que já existe — e o painel mostra, com o número dele, o
 * que aconteceria antes de ele ligar em massa.
 *
 * A alternativa (ligar junto) seria uma loja vazia numa sexta à noite, e o
 * lojista procurando o motivo no lugar errado.
 */

/** Um produto nosso, do jeito que esta decisão precisa ver. */
export interface ProdutoComEstoque {
  id: number;
  variacaoErp: number;
  /** O que está gravado hoje. */
  estoque: number;
  /** O bloqueio de venda está ligado NESTE produto? */
  controlaEstoque: boolean;
  /**
   * O controle foi ligado PELA SINCRONIZAÇÃO, e não pelo lojista.
   *
   * É o que torna o interruptor reversível sem apagar decisão de gente: ao
   * desligar, só volta atrás no que a sincronização tinha ligado.
   */
  estoqueDoErp: boolean;
  disponivel: boolean;
  /**
   * DE QUE ESTE PRODUTO É FEITO, quando ele é caixa/kit.
   *
   * Vazio no caso normal. Preenchido, o estoque dele é DERIVADO do componente
   * em vez de lido direto — ver `estoqueDerivado`.
   */
  composicao?: Array<{ variacao: number; quantidade: number }>;
}

export interface AjusteDeEstoque {
  id: number;
  estoque: number;
}

export interface PlanoEstoque {
  ajustar: AjusteDeEstoque[];
  /** Passam a esgotar sozinhos quando o saldo zera. */
  ligarControle: number[];
  /** Voltam a vender sem olhar saldo — só os que ESTA função havia ligado. */
  desligarControle: number[];
  /** Vinculados ao ERP que não têm linha de estoque lá. */
  semLinha: number;
  /** Já iguais — contados para a passada poder ficar calada. */
  semMudanca: number;
}

export const PLANO_ESTOQUE_VAZIO: PlanoEstoque = {
  ajustar: [], ligarControle: [], desligarControle: [], semLinha: 0, semMudanca: 0,
};

/**
 * SALDO NEGATIVO VIRA ZERO.
 *
 * O ERP admite estoque negativo (`permitirEstoqueNegativo: "S"`) e 175 itens do
 * Galderio estão assim. Gravar -4 no cardápio não descreve nada que exista: a
 * coluna alimenta "só restam N" na tela do cliente, e "só restam -4" é defeito
 * visível. Zero é a leitura honesta de "não tem".
 */
export function saldoParaEstoque(saldo: number): number {
  if (!Number.isFinite(saldo)) return 0;
  return Math.max(0, Math.floor(saldo));
}

/**
 * O QUE GRAVAR.
 *
 * Produto SEM linha de estoque no ERP é DEIXADO EM PAZ — não é zerado. "O ERP
 * não tem linha para este item" e "o ERP diz que acabou" são coisas diferentes,
 * e tratar a primeira como a segunda zeraria produto que ninguém nunca
 * inventariou. No Galderio são 16 produtos; numa loja que só inventaria bebida,
 * seriam todos os salgadinhos.
 */
/**
 * O SALDO QUE VALE PARA ESTE PRODUTO — próprio ou derivado da composição.
 *
 * UM LUGAR SÓ porque três decisões dependem dele: o que gravar, quem passa a
 * esgotar sozinho, e a conta que a tela mostra antes de o lojista ligar. Com a
 * regra repetida três vezes, a caixa entraria numa e ficaria de fora das
 * outras — e ninguém descobre isso olhando a tela.
 *
 * `null` = não dá para saber, e é diferente de zero: zero esgota o produto,
 * `null` deixa em paz.
 */
export function saldoEfetivo(
  p: ProdutoComEstoque,
  saldos: Map<number, number>,
): number | null {
  if (saldos.has(p.variacaoErp)) return saldoParaEstoque(saldos.get(p.variacaoErp) as number);
  return estoqueDerivado(p.composicao, saldos);
}

export function planejarEstoque(
  saldos: Map<number, number>,
  nossos: ProdutoComEstoque[],
  esgotarSozinho = false,
): PlanoEstoque {
  const plano: PlanoEstoque = {
    ajustar: [], ligarControle: [], desligarControle: [], semLinha: 0, semMudanca: 0,
  };

  for (const p of nossos) {
    if (p.variacaoErp <= 0) continue;

    /*
     * SALDO PRÓPRIO PRIMEIRO, COMPOSIÇÃO DEPOIS.
     *
     * A ordem importa: um produto que tem estoque próprio NO ERP é o que o ERP
     * diz que ele é. A composição só responde por quem não tem linha nenhuma —
     * a caixa, cujo saldo mora na unidade.
     */
    const novo = saldoEfetivo(p, saldos);
    if (novo === null) { plano.semLinha++; continue; }
    if (novo === p.estoque) { plano.semMudanca++; continue; }
    plano.ajustar.push({ id: p.id, estoque: novo });
  }

  const controle = planejarControleDeEstoque(saldos, nossos, esgotarSozinho);
  plano.ligarControle = controle.ligar;
  plano.desligarControle = controle.desligar;
  return plano;
}

/**
 * QUANTOS PRODUTOS SAIRIAM DO AR se o bloqueio fosse ligado para todos.
 *
 * Não muda nada — é para a tela poder dizer o número ANTES do clique. Foi essa
 * conta, feita na base do Galderio, que decidiu o desenho inteiro deste
 * arquivo: 210 de 644.
 */
export function quantosSairiamDoAr(
  saldos: Map<number, number>,
  nossos: ProdutoComEstoque[],
): { aVenda: number; sairiam: number } {
  let aVenda = 0, sairiam = 0;
  for (const p of nossos) {
    if (p.variacaoErp <= 0 || !p.disponivel) continue;
    aVenda++;
    /* SEM LINHA CONTA COMO SAIR: com o bloqueio ligado e estoque zero gravado,
       o produto some do mesmo jeito. O número na tela tem que ser o que vai
       acontecer, não o que seria elegante. */
    if ((saldoEfetivo(p, saldos) ?? 0) <= 0) sairiam++;
  }
  return { aVenda, sairiam };
}

export function planoEstoqueVazio(p: PlanoEstoque): boolean {
  return p.ajustar.length === 0 && p.ligarControle.length === 0 && p.desligarControle.length === 0;
}

/**
 * QUEM PASSA A ESGOTAR SOZINHO — e quem volta a não esgotar.
 *
 * Com o controle ligado e saldo zero, a vitrine já mostra "Esgotado" em cinza e
 * não deixa abrir o produto; com 5 ou menos, mostra "últimas unidades". Nada
 * disso é novo — o que faltava era ligar o controle nos produtos que vêm do
 * ERP.
 *
 * SÓ PRODUTO COM LINHA DE ESTOQUE NO ERP. Esta é a regra que evita o desastre:
 * produto sem linha lá tem saldo zero aqui, e ligar o controle nele o esgotaria
 * sem que ninguém tivesse dito que acabou. No Galderio são 16 produtos; numa
 * loja que só inventaria bebida, seriam todos os salgadinhos.
 *
 * E A VOLTA É POSSÍVEL PORQUE MARCAMOS QUEM LIGAMOS (`estoqueDoErp`). Sem essa
 * marca, desligar o interruptor teria duas saídas ruins: deixar tudo
 * controlando para sempre, ou desligar também os produtos que o lojista
 * controlava À MÃO antes de existir esta função — apagando uma decisão dele.
 */
export function planejarControleDeEstoque(
  saldos: Map<number, number>,
  nossos: ProdutoComEstoque[],
  esgotarSozinho: boolean,
): { ligar: number[]; desligar: number[] } {
  const ligar: number[] = [];
  const desligar: number[] = [];

  for (const p of nossos) {
    if (p.variacaoErp <= 0) continue;

    if (!esgotarSozinho) {
      /* Desligado: devolve ao normal SÓ o que esta função ligou. */
      if (p.estoqueDoErp) desligar.push(p.id);
      continue;
    }

    /* A CAIXA CONTA COMO "TEM LINHA": o saldo dela é derivado da unidade, e
       deixá-la de fora aqui seria justamente o defeito que a composição veio
       resolver — caixa vendendo para sempre com a unidade zerada. */
    const temLinha = saldoEfetivo(p, saldos) !== null;
    if (temLinha && !p.controlaEstoque) { ligar.push(p.id); continue; }
    /*
     * PERDEU A LINHA NO ERP e quem tinha ligado fomos nós: desliga. O produto
     * deixou de ser inventariado lá, e mantê-lo esgotando por um saldo que
     * ninguém mais atualiza é tirá-lo do ar para sempre, em silêncio.
     */
    if (!temLinha && p.estoqueDoErp) desligar.push(p.id);
  }
  return { ligar, desligar };
}

/**
 * A LEITURA DO ESTOQUE VEIO INTEIRA?
 *
 * O caso que isto pega: a listagem do ERP responder TRUNCADA — dizer
 * `hasNext: false` no meio, por um tropeço do lado deles. Nada falha, nada
 * lança; só chegam 300 linhas onde havia 1.070.
 *
 * O ESTRAGO NÃO É PRODUTO SUMINDO, é produto PISCANDO. As 770 linhas que
 * faltaram viram "sem linha no ERP", e com o esgotamento ligado isso significa
 * "voltar a vender" — depois a passada seguinte lê tudo e esgota de novo. Duas
 * voltas por minuto de produto entrando e saindo da vitrine, e o cliente vendo
 * preço aparecer e sumir.
 *
 * A RÉGUA É A ÚLTIMA LEITURA BOA, e não uma fração dos produtos vinculados:
 * uma loja pode legitimamente inventariar só as bebidas, e aí 10% de cobertura
 * é o normal DELA. Comparar com ela mesma é a única régua que não erra por
 * palpite sobre o negócio dos outros.
 *
 * A PRIMEIRA LEITURA SEMPRE PASSA (não há com o que comparar), e uma leitura
 * MAIOR também — cadastro cresce.
 */
export const QUEDA_MAXIMA_DA_LEITURA = 0.5;

export function leituraDeEstoqueConfiavel(agora: number, anterior: number): boolean {
  if (agora <= 0) return false;
  if (anterior <= 0) return true;
  return agora >= anterior * QUEDA_MAXIMA_DA_LEITURA;
}

/* ──────────────────── ESTOQUE DE CAIXA (produto composto) ────────────────── */

/**
 * QUANTAS CAIXAS DÁ PARA MONTAR com o que existe da unidade.
 *
 * O lojista cadastra "SCHIN CAIXA" como composição de 12× "SCHIN UNIDADE". A
 * caixa não tem saldo próprio no ERP — quem tem estoque é a unidade. Sem esta
 * conta, ela aparecia como "sem estoque cadastrado" e ficava fora do controle:
 * vendia sempre, mesmo com a unidade zerada.
 *
 * DIVISÃO INTEIRA, PARA BAIXO: 40 unidades dão 3 caixas de 12, não 3,33. A
 * fração que sobra não é caixa nenhuma, e prometer a quarta é prometer o que
 * não existe.
 *
 * O MENOR COMPONENTE MANDA. Um kit de 2 componentes só existe até o que acabar
 * primeiro — é a mesma conta de uma receita: com 10 pães e 2 hambúrgueres, dá
 * para montar 2 lanches.
 *
 * DEVOLVE `null` QUANDO NÃO DÁ PARA SABER — componente sem linha de estoque no
 * ERP. E `null` é diferente de zero: zero esgota o produto, `null` deixa ele em
 * paz. Chutar zero aqui tiraria do ar a caixa cuja unidade ninguém inventariou.
 */
export function estoqueDerivado(
  composicao: Array<{ variacao: number; quantidade: number }> | undefined,
  saldos: Map<number, number>,
): number | null {
  if (!composicao || !composicao.length) return null;
  let menor: number | null = null;
  for (const item of composicao) {
    if (!(item.quantidade > 0)) return null;
    if (!saldos.has(item.variacao)) return null;
    const disponivel = Math.floor(saldoParaEstoque(saldos.get(item.variacao) as number) / item.quantidade);
    menor = menor === null ? disponivel : Math.min(menor, disponivel);
  }
  return menor;
}
