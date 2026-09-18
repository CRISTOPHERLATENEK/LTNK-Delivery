/**
 * Endpoints públicos que recebem eventos de serviços externos (webhooks) —
 * sem middleware de autenticação (o chamador não tem sessão nossa), a
 * validação é por um token no query string.
 */
import { Router } from 'express';
import crypto from 'crypto';
import db, { comTenant } from '../db-mysql';
import { agoraUTC } from '../util';
import { segredoWebhook } from '../whatsapp-nao-oficial';
import { tenantPorDbNome } from '../tenants-mysql';

const router = Router();

/** Comparação de token resistente a timing (evita descobrir o segredo byte a byte). */
function tokenConfere(recebido: string, esperado: string): boolean {
  if (!esperado) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Evento 'message' de uma sessão de WhatsApp (WBAPI).
 *
 * DE QUAL CLIENTE VEIO, e por que agora isso precisa estar na URL: enquanto
 * existia UMA sessão pra plataforma inteira, não havia o que descobrir. Com
 * cada cliente podendo ter a própria conexão, a chamada chega do provedor —
 * de fora, sem passar pelo domínio de ninguém — e o banco seria o que o Host
 * resolvesse, ou seja, o cliente errado. Por isso `registrarWebhook` carimba
 * `?cliente=<banco>` no endereço que registra em cada sessão.
 *
 * O PARÂMETRO É CONFERIDO CONTRA A LISTA DE TENANTS. Ele vem de fora, e sem a
 * conferência viraria um jeito de escolher em qual banco gravar — o token já
 * autentica a chamada, mas autenticar não é autorizar a apontar pra qualquer
 * lugar. Nome que não é de um tenant conhecido cai no comportamento de antes.
 *
 * Sem o parâmetro (sessão da plataforma, que continua valendo de reserva), a
 * resposta não tem como saber de qual loja é sozinha — segue roteada pro PEDIDO
 * ATIVO mais recente daquele telefone, caindo na mesma tabela
 * `mensagens_pedido` do chat interno, como sempre foi.
 *
 * O formato exato do payload não está documentado publicamente — os campos
 * abaixo são best-effort (nomes mais comuns em APIs estilo WAHA/Baileys) e
 * podem precisar de ajuste ao ver um evento real chegando.
 */
router.post('/whatsapp', async (req, res) => {
  res.status(200).json({ ok: true }); // responde rápido — o provedor não deve re-tentar por nossa causa
  try {
    const token = String(req.query.token || '');
    if (!token || !tokenConfere(token, await segredoWebhook())) return;

    const cliente = String(req.query.cliente || '').trim();
    if (cliente) {
      const tenant = await tenantPorDbNome(cliente);
      if (tenant?.ativo) {
        await comTenant(tenant.db_nome, () => processarMensagem(req.body));
        return;
      }
    }
    await processarMensagem(req.body);
  } catch (e) {
    console.warn('[Webhook WhatsApp] Erro ao processar evento:', e);
  }
});

/** O corpo do evento, já dentro do banco certo. Nunca lança pra fora. */
async function processarMensagem(body: unknown): Promise<void> {
  const corpo: any = body || {};
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
}

export default router;
