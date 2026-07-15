/**
 * Pagamentos — integração Mercado Pago Pix (token por loja ou global via env).
 */
import { Router } from 'express';
import db from '../db-mysql';
import { agoraUTC } from '../util';
import { notificarLojistaNovoPedido } from '../notificacoes';
import { descriptografar } from '../cripto';
import { Pedido } from '../../tipos/modelos';

const router = Router();

/** Obtém o token MP da loja (DB, criptografado) ou cai no env global. */
export async function getTokenMP(lojaId: number): Promise<string | null> {
  const row = await db.prepare('SELECT mercadopago_token FROM lojas WHERE id = ?').get(lojaId) as
    { mercadopago_token: string | null } | undefined;
  if (row?.mercadopago_token) {
    try { return descriptografar(row.mercadopago_token); } catch { /* chave trocada/corrompido */ }
  }
  return process.env.MERCADOPAGO_ACCESS_TOKEN || null;
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

/** Cria um pagamento Pix no Mercado Pago e devolve o QR pronto pra exibir. */
export async function criarPagamentoMercadoPago(lojaId: number, pedido: Pedido, dadosPagador: DadosPagador): Promise<PixGerado> {
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

router.post('/webhook/mercadopago', async (req, res) => {
  try {
    const pagamentoId = req.body && req.body.data && req.body.data.id;
    if (!pagamentoId) return res.status(200).json({ recebido: true });

    // Descobre qual loja gerou esse pagamento para usar o token certo.
    const pedidoRow = await db.prepare(
      'SELECT loja_id FROM pedidos WHERE pagamento_gateway_id = ?'
    ).get(String(pagamentoId)) as { loja_id: number } | undefined;
    const token = pedidoRow ? await getTokenMP(pedidoRow.loja_id) : process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!token) return res.status(200).json({ recebido: true, integracao: 'desativada' });

    const resposta = await fetch(`https://api.mercadopago.com/v1/payments/${pagamentoId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!resposta.ok) return res.status(200).json({ recebido: true });
    const pagamento = await resposta.json() as { status: string; external_reference: string };

    const pedidoId = Number(pagamento.external_reference);
    const aprovado = pagamento.status === 'approved';
    if (pedidoId) {
      // Estado anterior — só notifica o lojista na PRIMEIRA aprovação.
      const antes = await db.prepare('SELECT pagamento_status FROM pedidos WHERE id = ?')
        .get(pedidoId) as { pagamento_status: string } | undefined;
      await db.prepare(
        `UPDATE pedidos SET pagamento_status = ?, pagamento_gateway = 'mercadopago',
                pagamento_gateway_id = ?, atualizado_em = ?
          WHERE id = ?`
      ).run(aprovado ? 'aprovado' : 'recusado', String(pagamentoId), agoraUTC(), pedidoId);

      if (aprovado && antes && antes.pagamento_status !== 'aprovado') {
        await notificarLojistaNovoPedido(pedidoId);
      }
    }
    res.status(200).json({ recebido: true });
  } catch {
    res.status(200).json({ recebido: true });
  }
});

export default router;
