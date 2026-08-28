/**
 * O CADASTRO DE PRODUTO FECHA SEM AVISO E LEVA O TRABALHO JUNTO.
 *
 * Observado no painel: abrir um produto, digitar no nome, clicar fora do modal.
 * Ele fecha, a edição some, nenhum aviso. São cinco abas e ~15 campos — e quem
 * cadastra cardápio faz isso em lote, trinta itens numa sentada, com o mouse
 * andando rápido. O clique torto não é hipótese, é rotina.
 *
 * O que este módulo responde é só: "o que está na tela é diferente do que foi
 * carregado?". Fica separado da tela porque é a única parte que dá para testar
 * sem montar React, e porque errar aqui tem dois custos opostos e ambos ruins:
 *
 * - falso negativo → o aviso não aparece e o lojista perde o trabalho, que é
 *   exatamente o bug que estamos consertando;
 * - falso positivo → o aviso aparece quando nada mudou, e um aviso que mente é
 *   um aviso que a pessoa aprende a fechar sem ler. Aí ele deixa de proteger
 *   também no dia em que estiver certo.
 */

/**
 * Compara dois estados do formulário campo a campo.
 *
 * Comparação rasa de propósito: o formulário é um objeto plano de strings,
 * booleanos e nada mais. `JSON.stringify` seria mais curto e estaria errado —
 * ele depende da ORDEM das chaves, e dois objetos com os mesmos valores em
 * ordem diferente apareceriam como diferentes.
 */
export function formSujo<T extends Record<string, unknown>>(atual: T, original: T): boolean {
  const chaves = new Set([...Object.keys(atual), ...Object.keys(original)]);
  for (const k of chaves) {
    if (!Object.is(normalizar(atual[k]), normalizar(original[k]))) return true;
  }
  return false;
}

/**
 * `''`, `null` e `undefined` são a MESMA coisa para efeito de "mudou?".
 *
 * Sem isto o aviso dispara sozinho: o formulário carrega `p.descricao || ''`,
 * então um produto com descrição nula vira `''` na tela e compararia diferente
 * de `null` no original — o lojista abriria e fecharia sem tocar em nada e
 * ainda assim levaria o "descartar alterações?".
 *
 * Espaço em branco nas pontas também não conta: digitar um espaço e apagar
 * deixa o campo visualmente igual ao que era.
 */
function normalizar(v: unknown): unknown {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  return v;
}
