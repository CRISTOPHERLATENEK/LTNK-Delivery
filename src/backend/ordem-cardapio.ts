/**
 * Reposicionar um nome dentro de uma lista ordenada — categorias e
 * subcategorias do cardápio.
 *
 * Mora aqui, puro e sem banco, porque é a parte que erra em silêncio: índice
 * 0 contra "1ª fileira", mover pra frente contra mover pra trás (remover antes
 * de inserir desloca o alvo em um), e nome que ainda não está na lista. Nada
 * disso aparece num teste de rota — o INSERT passa, a tela só sai torta.
 */

/**
 * Devolve a lista com `nome` na `posicao` pedida, contando a partir de 1.
 *
 * `posicao` fora do intervalo é GRAMPEADA, não recusada: a lista pode ter
 * mudado desde que a tela foi carregada (outro aparelho, outra aba), e recusar
 * transformaria uma corrida inofensiva em erro na cara do lojista. Grampear
 * põe no extremo mais próximo, que é o que ele quis dizer.
 *
 * Se `nome` não estiver na lista, é INSERIDO — é o caso da subcategoria criada
 * na hora, no mesmo formulário em que a posição é escolhida.
 */
export function reordenar(lista: string[], nome: string, posicao: number): string[] {
  /*
   * REMOVER PRIMEIRO, DEPOIS INSERIR.
   *
   * A alternativa — calcular o índice de destino na lista original — erra ao
   * mover pra baixo: tirar o item desloca em um tudo que vinha depois dele, e
   * "mandar pra 5ª" pousaria na 4ª. Removendo antes, `posicao - 1` é o índice
   * final direto, nos dois sentidos.
   */
  const sem = lista.filter(n => n !== nome);
  const alvo = Math.max(0, Math.min(sem.length, Math.trunc(posicao) - 1));
  sem.splice(alvo, 0, nome);
  return sem;
}
