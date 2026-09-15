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
    if (!saldos.has(p.variacaoErp)) { plano.semLinha++; continue; }

    const novo = saldoParaEstoque(saldos.get(p.variacaoErp) as number);
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
    if (saldoParaEstoque(saldos.get(p.variacaoErp) ?? 0) <= 0) sairiam++;
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

    const temLinha = saldos.has(p.variacaoErp);
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
