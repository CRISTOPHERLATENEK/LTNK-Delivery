/**
 * QUAL PREÇO MOSTRAR — o espelho de src/backend/preco-produto.ts.
 *
 * A regra é a MESMA dos dois lados, e é por isso que ela mora numa função em
 * cada lado em vez de estar copiada nas telas. Estava em quatro lugares só no
 * front (vitrine, card do produto, modal, PDV do balcão) e, quando a promoção
 * ganhou prazo, cada cópia era uma chance de mostrar preço promocional vencido
 * na tela enquanto o servidor cobrava o preço normal — o pior tipo de
 * divergência, porque o cliente vê um valor e paga outro.
 *
 * O front NÃO é a autoridade: quem decide o que é cobrado é o backend. Isto
 * aqui existe pra a tela não mentir.
 */

export interface PrecoDeProduto {
  preco_centavos: number;
  preco_promocional_centavos?: number | null;
  /** 'YYYY-MM-DD' — último dia da promoção. Vazio = sem prazo. */
  promo_fim?: string | null;
}

/**
 * Hoje no fuso de Brasília, 'YYYY-MM-DD'.
 *
 * Não usa a data local do dispositivo: o celular do cliente pode estar em
 * qualquer fuso (ou com a data errada), e aí a promoção apareceria ou
 * desapareceria pra ele antes do resto do mundo. O prazo é do LOJISTA, então o
 * fuso é o do Brasil, igual ao backend.
 */
export function hojeBrasilia(agoraMs: number = Date.now()): string {
  return new Date(agoraMs - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** A promoção está valendo hoje? */
export function promocaoVigente(p: PrecoDeProduto, hoje: string = hojeBrasilia()): boolean {
  const promo = p.preco_promocional_centavos;
  if (!promo || promo <= 0) return false;
  const fim = (p.promo_fim || '').trim();
  if (!fim) return true;
  return hoje <= fim;
}

/** O preço a exibir. */
export function precoVigente(p: PrecoDeProduto, hoje: string = hojeBrasilia()): number {
  return promocaoVigente(p, hoje) ? (p.preco_promocional_centavos as number) : p.preco_centavos;
}
