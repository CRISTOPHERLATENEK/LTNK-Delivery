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
import * as onz from '../onz';
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

/**
 * Obtém o token MP da loja: cada loja usa sua PRÓPRIA conta (Mercado Pago,
 * Sicoob, etc. — não tem token compartilhado entre lojas), com um par
 * teste/produção e um modo ativo, igual ao token da plataforma. `mercadopago_token`
 * é o campo antigo (uma loja, um token só) — mantido como fallback pra quem
 * configurou antes dessa tela existir. Só cai no token da plataforma se a loja
 * não tiver configurado nada disso ainda.
 */
export async function getTokenMP(lojaId: number): Promise<string | null> {
  const row = await db.prepare(
    'SELECT mercadopago_token, mercadopago_token_teste, mercadopago_token_producao, mercadopago_modo FROM lojas WHERE id = ?'
  ).get(lojaId) as {
    mercadopago_token: string | null; mercadopago_token_teste: string | null;
    mercadopago_token_producao: string | null; mercadopago_modo: string;
  } | undefined;
  if (row) {
    const cifrado = row.mercadopago_modo === 'teste' ? row.mercadopago_token_teste : row.mercadopago_token_producao;
    if (cifrado) {
      try { return descriptografar(cifrado); } catch { /* chave trocada/corrompido */ }
    }
    if (row.mercadopago_token) {
      try { return descriptografar(row.mercadopago_token); } catch { /* chave trocada/corrompido */ }
    }
  }
  return tokenPlataformaMP();
}

/** Pix online está disponível para essa loja? */
export type GatewayPix = 'mercadopago' | 'onz';

/** Gateway de Pix online escolhido pela loja (coluna lojas.pagamento_gateway). */
export async function gatewayDaLoja(lojaId: number): Promise<GatewayPix> {
  const row = await db.prepare('SELECT pagamento_gateway FROM lojas WHERE id = ?').get(lojaId) as
    { pagamento_gateway: string | null } | undefined;
  return row?.pagamento_gateway === 'onz' ? 'onz' : 'mercadopago';
}

/**
 * Pix online disponível pra essa loja? Depende do gateway escolhido:
 *  - mercadopago: precisa de token (da loja ou o da plataforma/env);
 *  - onz: precisa das credenciais ONZ de cash-in no ambiente.
 */
export async function pagamentoOnlineAtivo(lojaId: number): Promise<boolean> {
  const gateway = await gatewayDaLoja(lojaId);
  if (gateway === 'onz') return onz.cashInDisponivel();
  return !!(await getTokenMP(lojaId));
}

/**
 * Cria a cobrança Pix no gateway da loja e devolve o QR pronto pra exibir —
 * ponto único de despacho (o checkout não precisa saber qual gateway é).
 * `notificationUrl` é usada só pelo Mercado Pago (a ONZ recebe o webhook por
 * uma URL registrada previamente na conta, no padrão Bacen).
 */
export async function criarCobrancaPix(
  lojaId: number, pedido: Pedido, dadosPagador: DadosPagador, notificationUrl?: string,
): Promise<PixGerado & { gateway: GatewayPix }> {
  const gateway = await gatewayDaLoja(lojaId);
  if (gateway === 'onz') {
    const cob = await onz.criarCobranca({
      pedidoId: pedido.id,
      valorCentavos: pedido.total_centavos,
      descricao: `Pedido #${pedido.id}`,
    });
    return {
      gateway: 'onz',
      // txid é o identificador que o webhook/consulta da ONZ usa.
      pagamento_id: cob.txid,
      status: cob.status,
      qr_code: cob.copiaECola,
      qr_code_base64: (cob.qrPngDataUrl || '').replace(/^data:image\/png;base64,/, ''),
    };
  }
  const pix = await criarPagamentoMercadoPago(lojaId, pedido, dadosPagador, notificationUrl);
  return { ...pix, gateway: 'mercadopago' };
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
 * Estorna um pagamento Pix aprovado NO GATEWAY QUE O PROCESSOU — ponto único
 * de despacho, espelhando `criarCobrancaPix`.
 *
 * POR QUE ISTO EXISTE: o cash-in ganhou dois gateways (Mercado Pago e ONZ),
 * mas o estorno continuou chamando o Mercado Pago direto, sem olhar quem tinha
 * processado. Um pedido pago via ONZ mandava o txid da ONZ pra API do MP: não
 * estornava, e o cliente ficava sem o dinheiro de volta.
 *
 * O gateway vem do PRÓPRIO PEDIDO (`pedidos.pagamento_gateway`, gravado no
 * checkout), e não da configuração atual da loja — se o lojista trocar de
 * gateway depois, os pedidos antigos ainda precisam ser estornados onde foram
 * pagos.
 */
export async function estornarPagamentoPix(
  lojaId: number, gateway: string | null | undefined, pagamentoGatewayId: string,
): Promise<void> {
  if (gateway === 'onz') {
    await onz.devolverCobranca(pagamentoGatewayId);
    return;
  }
  // Sem gateway gravado = pedido anterior ao campo, quando só existia o MP.
  await estornarPagamentoMercadoPago(lojaId, pagamentoGatewayId);
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

/** Comparação de token resistente a timing (mesmo padrão do webhook do WhatsApp). */
function tokenConfere(recebido: string, esperado: string): boolean {
  if (!esperado) return false;
  const a = Buffer.from(recebido), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Confirma um Pix recebido da ONZ (cash-in) e avisa o lojista.
 * Idempotente: o UPDATE condicional só "vence" a primeira confirmação, então
 * reenvios do webhook (a ONZ re-tenta) não notificam o lojista duas vezes.
 */
async function confirmarPixOnz(txid: string, valorCentavos: number): Promise<void> {
  const pedido = await db.prepare(
    "SELECT id, total_centavos FROM pedidos WHERE pagamento_gateway = 'onz' AND pagamento_gateway_id = ?"
  ).get(txid) as { id: number; total_centavos: number } | undefined;
  if (!pedido) return; // txid desconhecido (outro sistema/ambiente) — ignora

  // Confere o valor: pagamento a menos NÃO aprova o pedido (evita liberar
  // pedido pago parcialmente). Fica em 'aguardando' pro lojista resolver.
  if (valorCentavos > 0 && valorCentavos < pedido.total_centavos) {
    console.warn(`[onz] Pix de ${valorCentavos} < total ${pedido.total_centavos} do pedido ${pedido.id} — não aprovado.`);
    return;
  }

  const r = await db.prepare(
    `UPDATE pedidos SET pagamento_status = 'aprovado', atualizado_em = ?
      WHERE id = ? AND pagamento_status <> 'aprovado'`
  ).run(agoraUTC(), pedido.id);
  if (r.changes > 0) await notificarLojistaNovoPedido(pedido.id);
}

/**
 * Webhook de Pix recebido da ONZ (cash-in), no padrão Bacen: o corpo traz
 * `{ pix: [{ txid, valor, endToEndId, ... }] }`.
 *
 * Autenticação: token secreto na URL (?tk=). O padrão Bacen prevê mTLS do PSP,
 * mas atrás de proxy/CDN o certificado do cliente não chega até aqui — o token
 * cumpre o papel de garantir que só a ONZ (que registrou a URL) consegue postar.
 * O `?t=` carrega o tenant dono do pedido (modelo SILO, um banco por tenant).
 */
router.post('/webhook/onz', async (req, res) => {
  res.status(200).json({ ok: true }); // responde rápido — o PSP não deve re-tentar por nossa lentidão
  try {
    const tk = typeof req.query.tk === 'string' ? req.query.tk : '';
    if (!tokenConfere(tk, process.env.ONZ_WEBHOOK_TOKEN || '')) return;

    const t = typeof req.query.t === 'string' ? req.query.t : '';
    const tenant = t ? await tenantPorDbNome(t) : undefined;

    const lista = Array.isArray((req.body as { pix?: unknown[] })?.pix) ? (req.body as { pix: Array<Record<string, unknown>> }).pix : [];
    const processar = async () => {
      for (const p of lista) {
        const txid = String(p.txid || '');
        const valorCentavos = Math.round(Number(p.valor || 0) * 100);
        if (txid) await confirmarPixOnz(txid, valorCentavos);
      }
    };
    if (tenant) await comTenant(tenant.db_nome, processar);
    else await processar();
  } catch (e) {
    console.error('[onz] webhook falhou:', e);
  }
});

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
