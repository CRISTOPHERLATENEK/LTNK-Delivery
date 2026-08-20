/**
 * AVISOS DO CADASTRO DE PRODUTO — o que a tela diz antes de enviar.
 *
 * O backend é a autoridade e continua validando tudo. Isto existe pra a pessoa
 * descobrir o problema ENQUANTO digita, e não depois de enviar um formulário
 * inteiro e receber a recusa de volta.
 *
 * Módulo separado porque é regra, não JSX: aqui dá pra testar cada caso sem
 * montar o modal, e é o único jeito de garantir que "promocional igual ao
 * normal" continua sendo recusado depois de alguém mexer no componente.
 *
 * A DISTINÇÃO QUE IMPORTA: `erro` impede intenção errada (preço promocional que
 * não é promoção nenhuma). `aviso` só chama atenção — nome repetido pode ser
 * intenção ("Coca 350ml" e "Coca 600ml"), e bloquear seria o sistema achando
 * que sabe mais que o lojista sobre o cardápio dele.
 */

export interface ProdutoExistente {
  id: number;
  nome: string;
  codigo_barras?: string | null;
}

/**
 * Preço promocional que não é promoção.
 *
 * Igual TAMBÉM é recusado, não só maior: promocional idêntico ao normal não
 * desconta nada e ainda acende o selo de promoção no app, prometendo desconto
 * que não existe.
 */
export function erroPrecoPromocional(preco: string, promocional: string): string | null {
  if (!promocional.trim() || !preco.trim()) return null;
  const promo = Number(promocional);
  const normal = Number(preco);
  if (!Number.isFinite(promo) || !Number.isFinite(normal)) return null;
  if (promo <= 0) return 'O preço promocional tem que ser maior que zero.';
  if (promo >= normal) return 'O preço promocional tem que ser MENOR que o normal.';
  return null;
}

/** Nome já usado por outro produto da loja. Devolve o nome achado, ou null. */
export function nomeJaUsado(nome: string, outros: ProdutoExistente[]): string | null {
  const alvo = nome.trim().toLowerCase();
  if (alvo.length < 2) return null;
  const igual = outros.find(p => (p.nome || '').trim().toLowerCase() === alvo);
  return igual ? igual.nome : null;
}

/**
 * Código de barras já usado por outro produto da loja.
 *
 * Sem `toLowerCase`: EAN é numérico, e normalizar caixa aqui esconderia um
 * código com letra (que não deveria existir) em vez de deixá-lo visível.
 */
export function eanJaUsado(codigo: string, outros: ProdutoExistente[]): string | null {
  const alvo = codigo.trim();
  if (!alvo) return null;
  const igual = outros.find(p => (p.codigo_barras || '').trim() === alvo);
  return igual ? igual.nome : null;
}

/**
 * Os outros produtos da loja — o de fora exclui o que está sendo editado.
 *
 * Sem isso, editar um produto sem mudar o nome acusaria ele mesmo como
 * duplicado, e o aviso apareceria em toda edição.
 */
export function outrosProdutos<T extends { id: number }>(
  lista: T[] | undefined, editando: number | 'novo' | null,
): T[] {
  return (lista ?? []).filter(p => p.id !== editando);
}
