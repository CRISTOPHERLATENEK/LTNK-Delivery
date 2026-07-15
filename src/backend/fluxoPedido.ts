/**
 * Máquina de estados do pedido — fonte única da verdade do fluxo oficial.
 *   pendente -> aceito -> preparando -> pronto -> em_entrega -> entregue
 * Terminais alternativos: cancelado (pelo cliente, só em pendente) e recusado (pelo lojista).
 */
import db from './db-mysql';
import { agoraUTC, erroHttp } from './util';
import { registrarEvento } from './notificacoes';
import { Pedido, StatusPedido } from '../tipos/modelos';

export const TRANSICOES: Record<StatusPedido, StatusPedido[]> = {
  pendente:   ['aceito', 'recusado', 'cancelado'],
  aceito:     ['preparando'],
  preparando: ['pronto'],
  pronto:     ['em_entrega'],
  em_entrega: ['entregue'],
  entregue:   [],
  cancelado:  [],
  recusado:   [],
};

export const ROTULOS: Record<StatusPedido, string> = {
  pendente: 'Pendente', aceito: 'Aceito', preparando: 'Preparando',
  pronto: 'Pronto', em_entrega: 'Em entrega', entregue: 'Entregue',
  cancelado: 'Cancelado', recusado: 'Recusado',
};

const EVENTOS_NOTIFICAVEIS: Partial<Record<StatusPedido, string>> = {
  aceito: 'pedido_aceito',
  preparando: 'pedido_preparando',
  pronto: 'pedido_pronto',
  recusado: 'pedido_recusado',
  em_entrega: 'saiu_para_entrega',
  entregue: 'entregue',
};

interface OpcoesTransicao {
  /** Colunas extras para atualizar no mesmo UPDATE (ex.: motivo_recusa). */
  camposExtras?: Record<string, string | number | null>;
}

/**
 * Transição atômica de status:
 *  - valida que a transição é permitida pelo fluxo oficial
 *  - UPDATE condicional (WHERE status = ?) evita corrida entre abas
 *  - registra na linha do tempo e enfileira notificação quando aplicável
 */
export async function transicionarStatus(
  pedidoId: number,
  novoStatus: StatusPedido,
  opcoes: OpcoesTransicao = {},
): Promise<Pedido & Record<string, unknown>> {
  const pedido = await db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId) as Pedido | undefined;
  if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');

  const permitidos = TRANSICOES[pedido.status];
  if (!permitidos.includes(novoStatus)) {
    throw erroHttp(409,
      `Transição inválida: o pedido está "${ROTULOS[pedido.status]}" e não pode ir para "${ROTULOS[novoStatus]}".`);
  }

  const agora = agoraUTC();
  const extras = opcoes.camposExtras || {};
  const camposExtras = Object.keys(extras);
  const setExtras = camposExtras.map(c => `${c} = ?`).join(', ');

  const sql = `UPDATE pedidos SET status = ?, atualizado_em = ?${setExtras ? ', ' + setExtras : ''}
               WHERE id = ? AND status = ?`;
  const resultado = await db.prepare(sql).run(
    novoStatus, agora, ...camposExtras.map(c => extras[c]), pedidoId, pedido.status,
  );
  if (resultado.changes === 0) {
    throw erroHttp(409, 'O pedido foi atualizado por outra pessoa. Recarregue e tente de novo.');
  }

  await db.prepare('INSERT INTO historico_status (pedido_id, status, criado_em) VALUES (?, ?, ?)')
    .run(pedidoId, novoStatus, agora);

  // Pedido não vai mais acontecer: devolve ao estoque o que havia sido reservado
  // (só produtos que controlam estoque).
  if (novoStatus === 'cancelado' || novoStatus === 'recusado') {
    const itens = await db.prepare(
      'SELECT produto_id, quantidade FROM itens_pedido WHERE pedido_id = ?'
    ).all(pedidoId) as Array<{ produto_id: number; quantidade: number }>;
    for (const it of itens) {
      await db.prepare(
        'UPDATE produtos SET estoque = estoque + ? WHERE id = ? AND controla_estoque = 1'
      ).run(it.quantidade, it.produto_id);
    }
  }

  const eventoFila = EVENTOS_NOTIFICAVEIS[novoStatus];
  if (eventoFila) await registrarEvento(pedidoId, eventoFila);

  return { ...pedido, status: novoStatus, atualizado_em: agora, ...extras };
}
