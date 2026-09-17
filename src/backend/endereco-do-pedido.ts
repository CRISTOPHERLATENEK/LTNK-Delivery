/**
 * DE QUE ENDEREÇO O PEDIDO FALA QUANDO O CLIENTE NÃO TEM UM.
 *
 * "exemplo, retirar no local, se o cliente não ter endereço: coloca o endereço
 *  da loja no pedido."
 *
 * Num pedido de RETIRADA não existe endereço de entrega — o cliente vem buscar.
 * E o campo ficava em branco, o que não é "não se aplica": é buraco. O cupom
 * imprimia sem linha de endereço, o documento do ERP subia sem nenhuma, e quem
 * pegava o papel não sabia dizer para onde mandar o cliente que ligou.
 *
 * O endereço DA LOJA é a resposta certa, e não um remendo: na retirada é
 * literalmente para lá que a pessoa vai.
 *
 * MORA SOZINHO, puro, porque a mesma decisão é tomada em três lugares que não
 * se conhecem — o pedido que nasce no app, o que entra pelo iFood e o documento
 * que sobe para o Maxx Gestão. Com a regra escrita três vezes, um dos três ia
 * ficar para trás, e ninguém descobre isso olhando a tela: descobre quando o
 * cupom sai sem endereço.
 */

/** O que se sabe da loja para escrever o endereço. */
export interface LojaParaEndereco {
  nome: string;
  endereco?: string | null;
}

/**
 * O endereço que vale para este pedido.
 *
 * `informado` é o endereço do cliente, quando há. Vazio, em branco ou só
 * espaços contam como ausente — o banco guarda string, e `'   '` não é
 * endereço de ninguém.
 *
 * LOJA SEM ENDEREÇO CADASTRADO cai no nome dela. É pior que o endereço e muito
 * melhor que o branco: pelo menos diz onde buscar para quem conhece a loja, e é
 * o que o pedido de retirada do app já fazia desde sempre.
 */
export function enderecoDoPedido(
  informado: string | null | undefined,
  tipoEntrega: string,
  loja: LojaParaEndereco,
): string {
  const doCliente = (informado ?? '').trim();
  if (doCliente) return doCliente;

  const daLoja = (loja.endereco ?? '').trim() || (loja.nome ?? '').trim();
  if (!daLoja) return '';

  /*
   * O PREFIXO EXISTE PARA NÃO MENTIR. Sem ele, o cupom de retirada mostraria
   * o endereço da loja no mesmo lugar em que mostra o do cliente, e o
   * entregador leria como "entregar aqui" — que é a loja de onde ele acabou de
   * sair. A frase diz o que é.
   */
  return tipoEntrega === 'retirada'
    ? `Retirada no local — ${daLoja}`
    : daLoja;
}

/**
 * A OBSERVAÇÃO DO DOCUMENTO NO ERP.
 *
 * O `POST /api/documento/v1` não tem campo de endereço livre: o bloco `pessoa`
 * aceita `idPessoa`, `idEndereco` e `observacao`, e `idEndereco` é "o código do
 * endereço da pessoa" — um cadastro do CONSUMIDOR FINAL, que é a mesma pessoa
 * de todos os pedidos. Gravar o endereço da loja lá dentro colaria esse
 * endereço em TODO cliente que usa esse cadastro.
 *
 * Então vai na observação, que é o campo livre que o ERP tem e que aparece na
 * aba "Observações" da tela do Pedido de Venda — tanto em PA (Pedido) quanto em
 * PV (Pré-Venda), que é o mesmo documento com outro modelo.
 */
export function observacaoDoDocumento(
  endereco: string,
  observacaoDoPedido?: string | null,
): string {
  const partes = [(observacaoDoPedido ?? '').trim(), endereco.trim()].filter(Boolean);
  /* 200 é o teto que o resto do documento já usa para texto livre. Cortar aqui
     e não no ERP evita a recusa por tamanho, que chega como erro genérico. */
  return partes.join(' · ').slice(0, 200);
}
