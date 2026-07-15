/**
 * Endpoints públicos que recebem eventos de serviços externos (webhooks) —
 * sem middleware de autenticação (o chamador não tem sessão nossa), a
 * validação é por um token no query string.
 */
import { Router } from 'express';
import db from '../db-mysql';
import { agoraUTC } from '../util';
import { segredoWebhook } from '../whatsapp-nao-oficial';

const router = Router();

/**
 * Evento 'message' da sessão de WhatsApp compartilhada (WBAPI). Como é UM
 * número pra toda a plataforma, a resposta do cliente não tem como saber "de
 * qual loja" sozinha — por isso ela é roteada pro PEDIDO ATIVO mais recente
 * daquele telefone e cai na mesma tabela `mensagens_pedido` do chat interno
 * já existente, aparecendo pro lojista/entregador certo sem misturar lojas.
 *
 * O formato exato do payload não está documentado publicamente — os campos
 * abaixo são best-effort (nomes mais comuns em APIs estilo WAHA/Baileys) e
 * podem precisar de ajuste ao ver um evento real chegando.
 */
router.post('/whatsapp', async (req, res) => {
  res.status(200).json({ ok: true }); // responde rápido — o provedor não deve re-tentar por nossa causa
  try {
    const token = String(req.query.token || '');
    if (!token || token !== segredoWebhook()) return;

    const corpo: any = req.body || {};
    const evento = corpo.event ?? corpo.type;
    if (evento && evento !== 'message') return;

    const payload = corpo.payload ?? corpo.data ?? corpo;
    if (payload?.fromMe === true) return; // não ecoa mensagem que a própria sessão mandou

    const de = String(payload?.from ?? payload?.chatId ?? payload?.sender ?? '');
    const texto = String(payload?.body ?? payload?.text ?? payload?.message ?? '').trim();
    if (!de || !texto) return;

    const digitos = de.replace(/@.*/, '').replace(/\D/g, '');
    if (!digitos) return;
    const semDDI = digitos.startsWith('55') ? digitos.slice(2) : digitos;

    const pedido = await db.prepare(
      `SELECT p.id FROM pedidos p JOIN usuarios u ON u.id = p.cliente_id
        WHERE (u.telefone = ? OR u.telefone = ?)
          AND p.status NOT IN ('entregue', 'cancelado', 'recusado')
        ORDER BY p.id DESC LIMIT 1`
    ).get(digitos, semDDI) as { id: number } | undefined;
    if (!pedido) return;

    await db.prepare(
      `INSERT INTO mensagens_pedido (pedido_id, remetente, texto, criado_em) VALUES (?, 'cliente', ?, ?)`
    ).run(pedido.id, texto.slice(0, 500), agoraUTC());
  } catch (e) {
    console.warn('[Webhook WhatsApp] Erro ao processar evento:', e);
  }
});

export default router;
