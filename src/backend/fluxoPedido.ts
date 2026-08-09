/**
 * Máquina de estados do pedido — fonte única da verdade do fluxo oficial.
 *   pendente -> aceito -> preparando -> pronto -> em_entrega -> entregue
 * Terminais alternativos: cancelado (pelo cliente, só em pendente) e recusado (pelo lojista).
 */
import db from './db-mysql';
import { agoraUTC, erroHttp } from './util';
import { registrarEvento, notificarEntregadoresCorridaDisponivel } from './notificacoes';
import { Pedido, StatusPedido } from '../tipos/modelos';

/**
 * Endereço público da loja, pra montar o link de acompanhamento.
 *
 * Prefere o domínio próprio do lojista: é o que o cliente reconhece, e é o
 * único que funciona se a loja não usa o endereço padrão da plataforma. Cai no
 * URL_PUBLICA do ambiente quando não há domínio configurado, e devolve `null`
 * se não houver nenhum dos dois — sem link é melhor que link quebrado.
 */
async function urlPublicaDaLoja(lojaId: number): Promise<string | null> {
  try {
    const l = await db.prepare('SELECT dominio_personalizado FROM lojas WHERE id = ?')
      .get(lojaId) as { dominio_personalizado: string | null } | undefined;
    if (l?.dominio_personalizado) return `https://${l.dominio_personalizado}`;
  } catch { /* segue pro ambiente */ }
  return process.env.URL_PUBLICA || null;
}

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

  /*
   * AVISO NO WHATSAPP a cada troca de status.
   *
   * Aqui porque `transicionarStatus` é o ponto único por onde TODO status passa
   * — o mesmo motivo já registrado logo abaixo pro pool de entregadores. Em
   * qualquer outro lugar, algum caminho ficaria de fora.
   *
   * Até aqui o WhatsApp mandava a confirmação e sumia: o cliente ficava sem
   * notícia justamente entre 'confirmado' e a comida na porta, que é quando ele
   * fica ansioso. O push cobre quem tem o app; o WhatsApp alcança quem fechou.
   *
   * Best-effort: falha de mensagem não pode derrubar a transição do pedido.
   */
  {
    // Sem domínio configurado a mensagem vai MESMO ASSIM, só sem o link:
    // 'saiu para entrega' é útil por si só, e calar por falta de link seria
    // trocar um aviso incompleto por nenhum.
    const base = await urlPublicaDaLoja(pedido.loja_id);
    const { avisarStatusWhatsApp } = await import('./whatsapp');
    avisarStatusWhatsApp(pedidoId, novoStatus, base ?? '')
      .catch(e => console.warn('[WhatsApp] aviso de status falhou:', e));
  }

  const eventoFila = EVENTOS_NOTIFICAVEIS[novoStatus];
  if (eventoFila) await registrarEvento(pedidoId, eventoFila);

  /**
   * Pedido PRONTO e sem entregador = corrida entrou no pool aberto: avisa os
   * entregadores. Feito aqui porque `transicionarStatus` é o ponto único por onde
   * todo status passa — em qualquer outro lugar, algum caminho ficaria de fora.
   *
   * Não avisa quando o lojista já atribuiu alguém (`entregador_id` preenchido):
   * nesse caso o push direto ao escolhido já é enviado em rotas/lojista.ts, e
   * chamar os outros só geraria corrida para algo que não está disponível.
   */
  if (novoStatus === 'pronto' && !pedido.entregador_id) {
    notificarEntregadoresCorridaDisponivel(pedidoId).catch(e =>
      console.error('[entregador] falha ao avisar corrida disponível:', e));
  }

  return { ...pedido, status: novoStatus, atualizado_em: agora, ...extras };
}
