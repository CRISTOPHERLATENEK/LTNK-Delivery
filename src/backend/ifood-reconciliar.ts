/**
 * RECONCILIAÇÃO DE PEDIDOS DO IFOOD.
 *
 * Existe por um caso REAL, não por precaução: o pedido #85 estava cancelado no
 * iFood e continuou em "preparando" aqui. Varri dois mil registros de log e o
 * evento de cancelamento NUNCA chegou — nem recusado, nem nada. A cozinha teria
 * seguido montando um pedido que não existe mais.
 *
 * Não dá para saber qual das duas causas foi, e não importa: o bloqueio da
 * Cloudflare comeu ciclos de polling naquele dia, ou o sandbox cancelou sem
 * emitir evento. As duas terminam igual, e é o mesmo motivo pelo qual o Pix e o
 * cartão já têm reconciliação: evento perdido não avisa que se perdeu.
 *
 * O QUE DÁ PARA PERGUNTAR É MENOS DO QUE PARECE. Não existe endpoint de status
 * de pedido — testei `/status`, `/events` e `/tracking`, todos 404, e o
 * `GET /orders/{id}` responde 200 sem nenhum campo de estado. O único sinal
 * confiável é o `/cancellationReasons`: num pedido cancelado ele responde
 * `400 — Order ... is already cancelled`.
 *
 * Por isso esta reconciliação detecta UM caso só: cancelado lá, ativo aqui. É o
 * caro — o que faz comida ser produzida e jogada fora. "Concluído lá e ativo
 * aqui" fica de fora porque não há como perguntar, e porque o estrago é outro:
 * ninguém cozinha por causa dele.
 */

/** A mensagem que o iFood devolve quando o pedido já foi cancelado. */
const MARCAS_DE_CANCELADO = ['already cancelled', 'already canceled', 'is cancelled', 'is canceled'];

/**
 * O erro que veio do `/cancellationReasons` significa "este pedido está
 * cancelado lá"?
 *
 * Casar por trecho da MENSAGEM é frágil, e é assumido: se o iFood mudar o
 * texto, paramos de detectar. A alternativa seria tratar todo 400 como
 * cancelamento — e aí qualquer erro de validação cancelaria um pedido que a
 * cozinha está produzindo. Entre deixar de consertar e cancelar o que está
 * certo, a escolha não é difícil.
 */
export function ehPedidoCanceladoLa(erro: { httpStatus?: number; message?: string }): boolean {
  if (erro.httpStatus !== 400) return false;
  const m = String(erro.message ?? '').toLowerCase();
  return MARCAS_DE_CANCELADO.some(marca => m.includes(marca));
}

/** Status nossos que ainda podem receber um cancelamento vindo de lá. */
export const STATUS_ATIVOS = ['pendente', 'aceito', 'preparando', 'pronto', 'em_entrega'] as const;

/**
 * Não conferir cedo demais nem tarde demais.
 *
 * O MÍNIMO existe porque pedido recém-criado ainda está sendo confirmado, e
 * perguntar por ele a cada ciclo só gasta chamada. O MÁXIMO existe porque
 * pedido antigo e ainda ativo aqui é problema de operação, não de evento
 * perdido — e varrer o histórico inteiro a cada dez minutos cresce sem limite
 * conforme a plataforma cresce.
 */
export const MINUTOS_MINIMOS = 5;
export const HORAS_MAXIMAS = 24;

export interface PedidoParaConferir {
  id: number;
  status: string;
  orderId: string;
  criadoEm: string;
}

export function pedidosParaConferir(
  linhas: readonly PedidoParaConferir[],
  agoraMs: number,
): PedidoParaConferir[] {
  return linhas.filter(p => {
    if (!p.orderId.trim()) return false;
    if (!(STATUS_ATIVOS as readonly string[]).includes(p.status)) return false;
    const criado = Date.parse(p.criadoEm);
    /*
     * Data ilegível NÃO é motivo para pular: um pedido preso com data estranha
     * é exatamente o que ninguém vai notar. Confere.
     */
    if (!Number.isFinite(criado)) return true;
    const idadeMin = (agoraMs - criado) / 60_000;
    return idadeMin >= MINUTOS_MINIMOS && idadeMin <= HORAS_MAXIMAS * 60;
  });
}
