/**
 * QUAL PREÇO VALE AGORA — a regra de promoção, num lugar só.
 *
 * POR QUE ESTE ARQUIVO EXISTE. A decisão "tem promoção? então o preço é o
 * promocional" estava COPIADA em nove lugares: vitrine, modal do produto,
 * criação do pedido, repetir pedido, PDV do balcão, comanda de mesa, consulta
 * pública de promoções, o selo na lista do lojista e o cardápio público.
 *
 * Enquanto a regra era "promo > 0", copiar era só feio. No dia em que a
 * promoção ganhou PRAZO, virou perigoso: bastava um dos nove não checar a data
 * pra promoção vencida continuar sendo cobrada ali — e o lugar mais provável de
 * esquecer é justamente o que cobra (criação do pedido), porque é o que menos
 * aparece na tela.
 *
 * Então a regra mora aqui, e `preco-produto.test.ts` tem um teste que VARRE o
 * código-fonte procurando a expressão copiada. Se alguém replicar a decisão de
 * novo, o teste quebra. Não é elegância: é a única forma de impedir que a
 * décima cópia nasça sem a data.
 *
 * O PRAZO É POR DIA, NÃO POR HORA, e no fuso de Brasília: `promo_fim` guarda
 * 'YYYY-MM-DD' e vale ATÉ o fim daquele dia. Promoção que termina "domingo"
 * tem que valer domingo inteiro — se comparasse por instante UTC, ela morreria
 * às 21h de sábado no horário de quem está vendendo.
 *
 * `promo_fim` vazio = promoção sem prazo, o comportamento de antes desta
 * coluna existir. Nenhum produto já cadastrado muda de preço por causa disto.
 */

/** O mínimo que a regra precisa saber de um produto. */
export interface PrecoDeProduto {
  preco_centavos: number;
  preco_promocional_centavos?: number | null;
  /** 'YYYY-MM-DD' — último dia em que a promoção vale. Vazio/nulo = sem prazo. */
  promo_fim?: string | null;
}

/**
 * A promoção está valendo hoje?
 *
 * `hojeBR` no formato 'YYYY-MM-DD' (use `dataBrasilia()` do util). Comparação
 * de string funciona porque o formato é ordenável — e evita construir Date, que
 * é onde entra fuso horário sem ninguém pedir.
 */
export function promocaoVigente(p: PrecoDeProduto, hojeBR: string): boolean {
  const promo = p.preco_promocional_centavos;
  if (!promo || promo <= 0) return false;
  const fim = (p.promo_fim || '').trim();
  if (!fim) return true;            // sem prazo: vale sempre
  return hojeBR <= fim;             // vale ATÉ o fim daquele dia, inclusive
}

/** O preço que deve ser cobrado agora. */
export function precoVigente(p: PrecoDeProduto, hojeBR: string): number {
  return promocaoVigente(p, hojeBR) ? (p.preco_promocional_centavos as number) : p.preco_centavos;
}

/**
 * O MESMO teste, em SQL, pra usar em WHERE e ORDER BY.
 *
 * Existe porque duas consultas precisam filtrar promoção no banco (a vitrine de
 * ofertas e o cardápio público) e trazer 500 produtos pro Node só pra descartar
 * 480 seria desperdício. Mesma ideia do `DATA_FISCAL` em xml-contador.ts:
 * fragmento nomeado em vez de condição solta repetida.
 *
 * O `?` recebe a data de hoje (dataBrasilia()) — não usa CURRENT_DATE de
 * propósito: o servidor pode estar em UTC, e aí a promoção viraria no horário
 * errado. Quem manda no fuso é a aplicação, num lugar só.
 *
 * `alias` é o prefixo da tabela na consulta ('p' em `FROM produtos p`).
 */
export function sqlPromocaoVigente(alias = 'p'): string {
  const a = alias ? `${alias}.` : '';
  return `(${a}preco_promocional_centavos IS NOT NULL AND ${a}preco_promocional_centavos > 0
           AND (${a}promo_fim IS NULL OR ${a}promo_fim = '' OR ${a}promo_fim >= ?))`;
}
