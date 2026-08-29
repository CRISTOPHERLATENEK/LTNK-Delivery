/**
 * MANTER O IFOOD SABENDO — os dois sentidos.
 *
 * Até aqui o pedido só ENTRAVA. Isso deixava dois buracos que a homologação
 * testa explicitamente, e que em produção custam pedido:
 *
 * - O lojista aceita no painel e o iFood não fica sabendo. **A confirmação tem
 *   8 minutos**; passou disso, o iFood cancela sozinho — a comida foi feita e o
 *   pedido não existe mais.
 * - O cliente cancela no app e nós não ficamos sabendo. A cozinha continua
 *   produzindo, e o entregador sai com um pedido cancelado.
 *
 * As traduções ficam aqui, puras, porque a tabela "nosso status ↔ ação no
 * iFood" é onde um erro fica invisível: chamar `dispatch` quando era
 * `readyToPickup` devolve 202 do mesmo jeito, e o pedido trava no app do
 * cliente sem ninguém entender.
 */

/** As ações de saída, na ordem do ciclo de vida do iFood. */
export type AcaoIfood =
  | 'confirm'
  | 'startPreparation'
  | 'readyToPickup'
  | 'dispatch'
  | 'requestCancellation';

/** Status nossos que valem alguma coisa lá. */
export type StatusNosso =
  | 'pendente' | 'aceito' | 'preparando' | 'pronto'
  | 'em_entrega' | 'entregue' | 'cancelado' | 'recusado';

/**
 * O que avisar ao iFood quando o pedido muda de status aqui.
 *
 * `null` = não avisa nada, e isso é resposta legítima na maioria dos casos:
 * 'pendente' é o estado em que ele nasce, e 'entregue' o iFood conclui sozinho
 * (4h para entrega própria). Inventar uma chamada para cada status seria pedir
 * 404 e ruído no log.
 *
 * O TIPO DE ENTREGA DECIDE O "PRONTO", e é aqui que se erra sem perceber:
 * `readyToPickup` é obrigatório em retirada e `dispatch` é o de entrega
 * própria. Os dois devolvem 202. Trocar um pelo outro não dá erro — o pedido
 * simplesmente trava na tela do cliente.
 */
export function acaoParaStatus(
  status: StatusNosso,
  tipoEntrega: 'entrega' | 'retirada',
): AcaoIfood | null {
  switch (status) {
    case 'aceito': return 'confirm';
    case 'preparando': return 'startPreparation';
    case 'pronto': return tipoEntrega === 'retirada' ? 'readyToPickup' : null;
    /*
     * 'em_entrega' só existe em entrega própria — em retirada o cliente vem
     * buscar. Mandar `dispatch` num pedido de retirada seria dizer que saiu
     * para entrega algo que ninguém levou.
     */
    case 'em_entrega': return tipoEntrega === 'entrega' ? 'dispatch' : null;
    case 'cancelado':
    case 'recusado':
      return 'requestCancellation';
    default: return null;
  }
}

/** O caminho do endpoint para uma ação. */
export function caminhoDaAcao(orderId: string, acao: AcaoIfood): string {
  return `/order/v1.0/orders/${encodeURIComponent(orderId)}/${acao}`;
}

/**
 * O evento do iFood muda o nosso status para quê?
 *
 * Só devolve status para os eventos que representam decisão de FORA — o cliente
 * cancelou, o iFood concluiu. Os que refletem o que nós mesmos fizemos
 * (CONFIRMED depois do nosso `confirm`) devolvem `null`: aplicar de volta um
 * eco do próprio comando é como o pedido volta para um estado que já passou.
 *
 * A exceção que justifica a regra: a documentação avisa que a loja pode usar o
 * Gestor de Pedidos do iFood ao mesmo tempo que a gente. Um CONFIRMED pode ter
 * vindo de lá. Ainda assim não avançamos por ele — quem manda no nosso fluxo é
 * o lojista no nosso painel, e voltar 'preparando' para 'aceito' por causa de
 * um eco atrasado seria pior que ignorar.
 */
export function statusParaEvento(code: string, fullCode?: string): StatusNosso | null {
  const c = String(code ?? '').trim().toUpperCase();
  const f = String(fullCode ?? '').trim().toUpperCase();

  if (c === 'CAN' || f === 'CANCELLED') return 'cancelado';
  /*
   * CONCLUDED vira 'entregue'. O iFood conclui sozinho depois de 4h em entrega
   * própria — então este evento chega mesmo que ninguém tenha marcado nada, e é
   * a única forma de o pedido sair da tela do lojista sem intervenção.
   */
  if (c === 'CON' || f === 'CONCLUDED') return 'entregue';

  return null;
}

/**
 * Vale a pena tentar de novo depois deste erro?
 *
 * Distinção que evita os dois extremos ruins: insistir para sempre num pedido
 * que o iFood já cancelou (e levar bloqueio), ou desistir de uma confirmação
 * por causa de uma oscilação de rede — com os 8 minutos correndo.
 *
 * 409 é o caso mais importante: significa que o pedido não está no estado que
 * a ação espera. Já foi confirmado, já foi cancelado, já passou. Repetir não
 * muda nada.
 */
export function vaiAdiantarTentarDeNovo(httpStatus: number): boolean {
  if (httpStatus === 0) return true;               // rede caiu — pode ter nem chegado
  if (httpStatus === 429) return true;             // limite; espera e volta
  if (httpStatus >= 500) return true;              // problema do lado deles
  if (httpStatus === 401) return true;             // token vencido, renova e repete
  return false;                                    // 400, 404, 409: repetir não muda
}

/**
 * Prazo de confirmação, em minutos.
 *
 * Não é número escolhido por nós — está na documentação: "Confirme o
 * recebimento em 8 minutos". Passou disso, o iFood cancela e a comida já pode
 * ter sido feita.
 */
export const MINUTOS_PARA_CONFIRMAR = 8;

/** Quanto tempo resta para confirmar, em segundos. Negativo = já passou. */
export function segundosParaConfirmar(criadoEmISO: string, agora = new Date()): number {
  const criado = Date.parse(criadoEmISO);
  if (Number.isNaN(criado)) return 0;
  return Math.round((criado + MINUTOS_PARA_CONFIRMAR * 60_000 - agora.getTime()) / 1000);
}
