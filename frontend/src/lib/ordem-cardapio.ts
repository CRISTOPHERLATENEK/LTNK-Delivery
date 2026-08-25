/**
 * Reposicionar um nome dentro de uma lista ordenada — categorias e
 * subcategorias do cardápio.
 *
 * GÊMEO de `src/backend/ordem-cardapio.ts`. A cópia existe porque os dois lados
 * não compartilham build; um teste no backend falha se divergirem.
 *
 * O servidor é quem grava a ordem. Esta cópia serve à prévia otimista do
 * arrasto: o lojista solta a fileira e a lista tem que se acomodar NA HORA, com
 * exatamente o mesmo resultado que o servidor vai devolver. Divergir aqui não dá
 * erro — dá a fileira pulando de lugar meio segundo depois de solta, que parece
 * bug mesmo quando a gravação deu certo.
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
