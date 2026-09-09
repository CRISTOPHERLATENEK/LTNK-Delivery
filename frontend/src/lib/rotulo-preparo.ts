/**
 * COMO CHAMAR O STATUS `preparando` NESTA LOJA.
 *
 * "Preparando" pressupõe cozinha. Numa conveniência ninguém prepara nada —
 * separa da prateleira — e o cliente lendo "preparando seu pedido" para uma
 * garrafa de cerveja fica esperando um preparo que não existe.
 *
 * A pergunta que decide é a mesma que decide o painel de cozinha: a loja tem
 * KDS? Se tem, tem cozinha, e "Preparando" descreve o que está acontecendo. Se
 * não tem, o que acontece é separação.
 *
 * NÃO É UMA COLUNA DE TEXTO. Deriva de `kds_liberado` de propósito: um campo
 * livre para o lojista escrever o rótulo seria mais um lugar para desatualizar,
 * e a decisão real ("esta loja monta pedido na cozinha?") já está tomada em
 * outro lugar. Uma pergunta, uma resposta.
 *
 * ESTA REGRA VIVE DUAS VEZES, aqui e em `src/backend/rotulo-preparo.ts`.
 * A duplicação é deliberada — o servidor precisa dela para a notificação que
 * ele mesmo envia, e a tela precisa dela para o acompanhamento. Um teste
 * compara os dois arquivos e falha se discordarem, porque duas versões da mesma
 * frase divergindo é como o cliente recebe "Preparando" no WhatsApp e lê
 * "Em separação" na tela do pedido.
 */

/** O rótulo curto do status `preparando`. */
export function rotuloPreparando(temKds: boolean): string {
  return temKds ? 'Preparando' : 'Em separação';
}

/**
 * A frase da notificação (push e WhatsApp) do status `preparando`.
 *
 * O emoji acompanha: chapéu de cozinheiro para quem cozinha, sacola para quem
 * separa. Emoji errado contradiz o texto no mesmo balão.
 */
export function avisoPreparando(temKds: boolean): string {
  return temKds ? '👨‍🍳 Preparando seu pedido' : '🛍️ Separando seu pedido';
}
