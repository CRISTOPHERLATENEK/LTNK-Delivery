/**
 * Pagamentos — integração Mercado Pago Pix (token por loja ou global via env).
 */
import { Router } from 'express';
import crypto from 'crypto';
import db, { abrirPool, comTenant } from '../db-mysql';
import { agoraUTC } from '../util';
import { notificarLojistaNovoPedido } from '../notificacoes';
import { descriptografar } from '../cripto';
import { tenantPorDbNome } from '../tenants-mysql';
import { Pedido } from '../../tipos/modelos';

const router = Router();

const BANCO_CENTRAL = process.env.MYSQL_DATABASE_CENTRAL || process.env.MYSQL_DATABASE || '';

/**
 * Token da plataforma (fallback quando a loja não tem o próprio): configurável
 * pelo admin com um token de teste (TEST-) e um de produção (APP_USR-) lado a
 * lado, e um modo ativo escolhendo qual dos dois vale — assim dá pra testar o
 * Pix sem risco de gerar cobrança real, e trocar pra produção só apertando um
 * botão. Cai no MERCADOPAGO_ACCESS_TOKEN do .env se nada estiver configurado
 * (compatibilidade com o que já estava em produção antes dessa tela existir).
 */
async function tokenPlataformaMP(): Promise<string | null> {
  if (!BANCO_CENTRAL) return process.env.MERCADOPAGO_ACCESS_TOKEN || null;
  const [rows] = await abrirPool(BANCO_CENTRAL).query(
    "SELECT chave, valor FROM configuracoes WHERE chave IN ('mercadopago_modo', 'mercadopago_token_teste', 'mercadopago_token_producao')"
  );
  const cfg: Record<string, string> = {};
  for (const r of rows as { chave: string; valor: string }[]) cfg[r.chave] = r.valor;
  const modo = cfg.mercadopago_modo === 'teste' ? 'teste' : 'producao';
  const cifrado = modo === 'teste' ? cfg.mercadopago_token_teste : cfg.mercadopago_token_producao;
  if (cifrado) {
    try { return descriptografar(cifrado); } catch { /* chave trocada/corrompido */ }
  }
  return process.env.MERCADOPAGO_ACCESS_TOKEN || null;
}

/** Obtém o token MP da loja (DB, criptografado) ou cai no token da plataforma. */
export async function getTokenMP(lojaId: number): Promise<string | null> {
  const row = await db.prepare('SELECT mercadopago_token FROM lojas WHERE id = ?').get(lojaId) as
    { mercadopago_token: string | null } | undefined;
  if (row?.mercadopago_token) {
    try { return descriptografar(row.mercadopago_token); } catch { /* chave trocada/corrompido */ }
  }
  return tokenPlataformaMP();
}

/** Pix online está disponível para essa loja? */
export async function pagamentoOnlineAtivo(lojaId: number): Promise<boolean> {
  return !!(await getTokenMP(lojaId));
}

export interface DadosPagador {
  email: string;
}

/** Dados do Pix retornados pro cliente: copia-e-cola + imagem do QR. */
export interface PixGerado {
  pagamento_id: string;
  status: string;
  qr_code: string;
  qr_code_base64: string;
}

/**
 * Cria um pagamento Pix no Mercado Pago e devolve o QR pronto pra exibir.
 * `notificationUrl` (opcional) é a URL que o MP chama ao mudar o status — deve
 * carregar o tenant dono do pedido (?t=<banco>) pra o webhook confirmar no
 * banco certo no modelo SILO (ver rota /webhook/mercadopago abaixo).
 */
export async function criarPagamentoMercadoPago(lojaId: number, pedido: Pedido, dadosPagador: DadosPagador, notificationUrl?: string): Promise<PixGerado> {
  const token = await getTokenMP(lojaId);
  if (!token) {
    throw new Error('Mercado Pago não configurado para esta loja.');
  }
  const resposta = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `pedido-${pedido.id}`,
    },
    body: JSON.stringify({
      transaction_amount: pedido.total_centavos / 100,
      description: `Pedido #${pedido.id}`,
      payment_method_id: 'pix',
      payer: { email: dadosPagador.email },
      external_reference: String(pedido.id),
      ...(notificationUrl ? { notification_url: notificationUrl } : {}),
    }),
  });
  if (!resposta.ok) throw new Error(`Mercado Pago respondeu ${resposta.status}`);
  const dados = await resposta.json() as {
    id: number | string;
    status: string;
    point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string } };
  };
  const td = dados.point_of_interaction?.transaction_data;
  return {
    pagamento_id: String(dados.id),
    status: dados.status,
    qr_code: td?.qr_code || '',
    qr_code_base64: td?.qr_code_base64 || '',
  };
}

/**
 * Estorna (reembolso total) um pagamento Pix aprovado direto na API do
 * Mercado Pago. Lança com a mensagem de erro do MP se recusar (ex.: prazo de
 * estorno do Pix expirado, ou o pagamento já foi estornado antes).
 */
export async function estornarPagamentoMercadoPago(lojaId: number, pagamentoGatewayId: string): Promise<void> {
  const token = await getTokenMP(lojaId);
  if (!token) throw new Error('Mercado Pago não configurado para esta loja.');
  const resposta = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(pagamentoGatewayId)}/refunds`,
    { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } },
  );
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => ({}));
    throw new Error(corpo.message || `Mercado Pago recusou o estorno (HTTP ${resposta.status}).`);
  }
}

async function processarWebhookMP(pagamentoId: string): Promise<void> {
  // Descobre qual loja gerou esse pagamento para usar o token certo.
  const pedidoRow = await db.prepare(
    'SELECT loja_id FROM pedidos WHERE pagamento_gateway_id = ?'
  ).get(pagamentoId) as { loja_id: number } | undefined;
  const token = pedidoRow ? await getTokenMP(pedidoRow.loja_id) : await tokenPlataformaMP();
  if (!token) return;

  const resposta = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(pagamentoId)}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!resposta.ok) return;
  const pagamento = await resposta.json() as { status: string; external_reference: string };

  const pedidoId = Number(pagamento.external_reference);
  const aprovado = pagamento.status === 'approved';
  if (!pedidoId) return;

  // UPDATE condicional idempotente: só "vence" a PRIMEIRA aprovação (o MP
  // reenvia o mesmo webhook várias vezes). Assim o lojista é notificado 1x só.
  const r = await db.prepare(
    `UPDATE pedidos SET pagamento_status = ?, pagamento_gateway = 'mercadopago',
            pagamento_gateway_id = ?, atualizado_em = ?
      WHERE id = ? AND pagamento_status <> ?`
  ).run(aprovado ? 'aprovado' : 'recusado', pagamentoId, agoraUTC(), pedidoId,
        aprovado ? 'aprovado' : 'recusado');

  // O webhook do MP é assíncrono e pode chegar DEPOIS do cliente já ter
  // cancelado o pedido (ex.: cancelou rápido enquanto o pagamento ainda
  // estava em processamento). Marca pagamento_status normalmente (útil pro
  // lojista saber que precisa estornar), mas não avisa "novo pedido" pra um
  // pedido que já morreu.
  if (aprovado && r.changes > 0) {
    const pedido = await db.prepare('SELECT status FROM pedidos WHERE id = ?').get(pedidoId) as { status: string } | undefined;
    if (pedido?.status !== 'cancelado') {
      await notificarLojistaNovoPedido(pedidoId);
    }
  }
}

/**
 * Valida o header `x-signature` do webhook contra `MERCADOPAGO_WEBHOOK_SECRET`
 * (algoritmo documentado pelo MP: HMAC-SHA256 de um manifest com id/request-id/
 * ts). Opt-in de propósito — sem o secret configurado, aceita como sempre
 * aceitou (mitigado por sempre reconsultar o pagamento na API do MP antes de
 * confiar em qualquer coisa do corpo da notificação); com o secret, rejeita
 * notificação forjada/sem assinatura válida.
 */
function assinaturaMpValida(req: import('express').Request, dataId: string): boolean {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return true;
  const cabecalho = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  if (typeof cabecalho !== 'string' || typeof requestId !== 'string') return false;
  const partes: Record<string, string> = {};
  for (const par of cabecalho.split(',')) {
    const [k, v] = par.trim().split('=');
    if (k && v) partes[k] = v;
  }
  if (!partes.ts || !partes.v1) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  try {
    const a = Buffer.from(esperado);
    const b = Buffer.from(partes.v1);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

router.post('/webhook/mercadopago', async (req, res) => {
  try {
    // MP manda o id tanto no corpo quanto (em alguns formatos) na query
    // ?data.id=... — o manifest da assinatura é calculado sobre o valor da
    // QUERY quando presente (documentação do MP).
    const pagamentoId = (req.query['data.id'] as string | undefined) || (req.body && req.body.data && req.body.data.id);
    if (!pagamentoId) return res.status(200).json({ recebido: true });
    if (!assinaturaMpValida(req, String(pagamentoId))) {
      console.warn('[mercadopago] webhook com assinatura inválida, ignorado');
      return res.status(200).json({ recebido: true }); // 200 pro MP não ficar re-tentando; só não processa
    }

    // SILO (um banco por tenant): a notification_url que gravamos no pagamento
    // traz ?t=<banco> do tenant dono do pedido. Sem isso, o webhook rodaria no
    // banco resolvido pelo Host (o domínio que o MP chamou) — que pode não ser
    // o do pedido, e a confirmação cairia no banco errado. Validamos `t` contra
    // o registro de tenants antes de trocar de contexto (nunca abrir banco
    // arbitrário a mando de quem chamou o webhook).
    const t = typeof req.query.t === 'string' ? req.query.t : '';
    const tenant = t ? await tenantPorDbNome(t) : undefined;

    if (tenant) await comTenant(tenant.db_nome, () => processarWebhookMP(String(pagamentoId)));
    else await processarWebhookMP(String(pagamentoId));

    res.status(200).json({ recebido: true });
  } catch {
    res.status(200).json({ recebido: true });
  }
});

export default router;
