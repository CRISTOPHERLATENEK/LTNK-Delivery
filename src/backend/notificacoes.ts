/**
 * Notificações — estrutura pronta para a fase 2.
 *
 * Hoje: cada evento relevante do pedido (aceito, saiu para entrega, entregue)
 * é gravado na tabela eventos_notificacao. As telas se atualizam por polling.
 *
 * Fase 2: um worker lê os eventos com enviado = 0 e dispara pelo canal
 * configurado (WhatsApp Cloud API ou Web Push).
 */
import db from './db-mysql';
import { agoraUTC } from './util';
import { enviarPush } from './push';

type ConteudoEvento = { id: number; cliente_id: number; cliente_nome: string; telefone: string | null };

const MENSAGENS: Record<string, (p: ConteudoEvento) => string> = {
  pedido_aceito:     (p) => `Seu pedido #${p.id} foi aceito pela loja e já vai entrar em preparo! 🍳`,
  pedido_preparando: (p) => `Seu pedido #${p.id} está sendo preparado. 👨‍🍳`,
  pedido_pronto:     (p) => `Pedido #${p.id} pronto! Logo sai para entrega. 📦`,
  saiu_para_entrega: (p) => `Boa notícia! Seu pedido #${p.id} saiu para entrega. 🛵`,
  entregue:          (p) => `Pedido #${p.id} entregue. Bom apetite! 😋`,
  pedido_recusado:   (p) => `Que pena! A loja não pôde aceitar seu pedido #${p.id}.`,
};

/** Título curto da notificação push por tipo de evento. */
const TITULOS_PUSH: Record<string, string> = {
  pedido_aceito:     '✅ Pedido aceito!',
  pedido_preparando: '👨‍🍳 Preparando seu pedido',
  pedido_pronto:     '📦 Pedido pronto!',
  saiu_para_entrega: '🛵 Saiu para entrega!',
  entregue:          '😋 Pedido entregue',
  pedido_recusado:   '😕 Pedido recusado',
};

/** Canal ativo conforme variáveis de ambiente. */
function canalConfigurado(): string {
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) return 'whatsapp';
  return 'pendente_configuracao';
}

/** Registra um evento de notificação na fila (chamado pela máquina de estados). */
export async function registrarEvento(pedidoId: number, evento: string): Promise<void> {
  const pedido = await db.prepare(
    `SELECT p.id, p.cliente_id, u.nome AS cliente_nome, u.telefone
       FROM pedidos p JOIN usuarios u ON u.id = p.cliente_id WHERE p.id = ?`
  ).get(pedidoId) as ConteudoEvento | undefined;
  if (!pedido) return;

  const fnMensagem = MENSAGENS[evento];
  const texto = fnMensagem ? fnMensagem(pedido) : `Atualização do pedido #${pedido.id}`;

  await db.prepare(
    `INSERT INTO eventos_notificacao (pedido_id, evento, canal, payload, criado_em)
     VALUES (?, ?, ?, ?, ?)`
  ).run(pedidoId, evento, canalConfigurado(), JSON.stringify({
    telefone: pedido.telefone || null,
    mensagem: texto,
  }), agoraUTC());

  // Web Push para o cliente (fire-and-forget; o "estou chegando" tem disparo próprio).
  const titulo = TITULOS_PUSH[evento];
  if (titulo) {
    enviarPush(pedido.cliente_id, {
      titulo,
      corpo: texto,
      url: `/pedido/${pedido.id}`,
      tag: `pedido-${pedido.id}`,
    }).catch(() => { /* push é best-effort */ });
  }
}

/** Avisa o lojista que entrou um pedido novo (push best-effort). */
export async function notificarLojistaNovoPedido(pedidoId: number): Promise<void> {
  const info = await db.prepare(
    `SELECT p.id, p.total_centavos, l.usuario_id
       FROM pedidos p JOIN lojas l ON l.id = p.loja_id WHERE p.id = ?`
  ).get(pedidoId) as { id: number; total_centavos: number; usuario_id: number } | undefined;
  if (!info) return;
  enviarPush(info.usuario_id, {
    titulo: '🔔 Novo pedido!',
    corpo: `Pedido #${info.id} · R$ ${(info.total_centavos / 100).toFixed(2).replace('.', ',')} — toque para ver.`,
    url: '/lojista/pedidos',
    tag: `novo-pedido-${info.id}`,
  }).catch(() => { /* best-effort */ });
}

/** FASE 2 — Envio real pela WhatsApp Cloud API (esqueleto pronto). */
export async function enviarWhatsApp(telefone: string, mensagem: string): Promise<unknown> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) {
    throw new Error('WhatsApp não configurado: defina WHATSAPP_TOKEN e WHATSAPP_PHONE_ID no .env');
  }
  const resposta = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: telefone,
      type: 'text',
      text: { body: mensagem },
    }),
  });
  if (!resposta.ok) throw new Error(`WhatsApp API respondeu ${resposta.status}`);
  return resposta.json();
}
