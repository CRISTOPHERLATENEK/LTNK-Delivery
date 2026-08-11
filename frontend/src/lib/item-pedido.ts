/**
 * O que aparece embaixo do nome de um item do pedido.
 *
 * São DUAS coisas com origens diferentes: os complementos escolhidos
 * (`opcoes_texto`, montado pelo servidor) e a observação que o cliente
 * escreveu ("sem cebola"). A comanda da cozinha, o cupom e a tela do lojista
 * precisam mostrar as duas — e mostrar IGUAL, senão o que o cozinheiro lê no
 * papel não é o que o atendente vê na tela.
 *
 * A OBSERVAÇÃO VEM PRIMEIRO: é a instrução que muda o preparo, e numa comanda
 * lida de relance é ela que não pode ficar depois de uma lista de adicionais.
 *
 * Cópia de src/backend/detalhe-item.ts (onde estão os testes) — mesma decisão
 * que opcoes-preco.ts: os dois lados não compartilham build, e importar do
 * backend arrastaria ele pro bundle do navegador.
 */
export function detalheItem(item: { opcoes_texto?: string | null; observacao?: string | null }): string {
  const obs = (item.observacao || '').trim();
  const opc = (item.opcoes_texto || '').trim();
  return [obs && `Obs.: ${obs}`, opc].filter(Boolean).join(' · ');
}
