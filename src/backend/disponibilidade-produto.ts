/**
 * Em quais canais um produto está à venda.
 *
 * Cardápio (delivery/retirada) e PDV (balcão) eram a MESMA chave: pausar um
 * item no delivery tirava ele também do balcão, e vice-versa. Mas as duas
 * coisas se decidem por motivos diferentes — o prato que só sai no salão, o
 * combo de entrega que não faz sentido no balcão, o item que acabou pro
 * delivery mas ainda dá pra vender pra quem está na loja.
 *
 * Módulo puro pra que a regra de "o que herda o quê" fique testável sem banco:
 * é justamente onde um engano silencioso coloca à venda algo que o lojista
 * tinha pausado de propósito.
 */

export interface CanaisVenda {
  /** Aparece no cardápio (delivery e retirada). */
  cardapio: 0 | 1;
  /** Aparece na tela de venda do balcão. */
  pdv: 0 | 1;
}

const bit = (v: unknown): 0 | 1 => (v ? 1 : 0);

/**
 * Resolve os canais a partir do corpo da requisição e do estado atual.
 *
 * `atual` vazio = produto novo. Campo ausente no corpo NUNCA vira 1 por
 * omissão: herda o que já está gravado, e num produto novo herda o `cardapio`
 * recém-decidido — quem cadastra um item já pausado não o quer vendendo no
 * balcão.
 */
export function resolverCanais(
  corpo: { disponivel?: unknown; disponivel_pdv?: unknown },
  atual: { disponivel?: unknown; disponivel_pdv?: unknown } = {},
): CanaisVenda {
  const cardapio: 0 | 1 = corpo.disponivel !== undefined
    ? bit(corpo.disponivel)
    : (atual.disponivel !== undefined && atual.disponivel !== null ? bit(atual.disponivel) : 1);

  const pdv: 0 | 1 = corpo.disponivel_pdv !== undefined
    ? bit(corpo.disponivel_pdv)
    : (atual.disponivel_pdv !== undefined && atual.disponivel_pdv !== null
        ? bit(atual.disponivel_pdv)
        : cardapio);

  return { cardapio, pdv };
}

/** Vende em algum canal — o que o interruptor "pausar produto" liga/desliga. */
export function vendeEmAlgumCanal(c: CanaisVenda): boolean {
  return c.cardapio === 1 || c.pdv === 1;
}
