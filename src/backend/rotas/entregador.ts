/**
 * Módulo do ENTREGADOR: corridas, aceite ATÔMICO, entrega ativa, histórico.
 */
import { Router } from 'express';
import db from '../db';
import { autenticar, exigirPerfil } from '../auth';
import { agoraUTC, erroHttp } from '../util';
import { registrarEvento } from '../notificacoes';
import { enviarPush } from '../push';
import { emitirNfcePedido } from './lojista';

const router = Router();
router.use(autenticar, exigirPerfil('entregador'));

router.get('/corridas', (_req, res) => {
  const corridas = db.prepare(
    `SELECT p.id, p.endereco_entrega, p.taxa_entrega_centavos, p.total_centavos,
            p.forma_pagamento, p.troco_para_centavos, p.criado_em,
            l.nome AS loja_nome, l.endereco AS loja_endereco
       FROM pedidos p JOIN lojas l ON l.id = p.loja_id
      WHERE p.status = 'pronto' AND p.entregador_id IS NULL
      ORDER BY p.id`
  ).all();
  res.json({ corridas });
});

/**
 * Aceite ATÔMICO: o UPDATE só efetiva se o pedido ainda estiver "pronto" sem
 * entregador. SQLite serializa escritas, então apenas um entregador vence.
 */
router.post('/corridas/:id/aceitar', (req, res, next) => {
  try {
    const ativa = db.prepare(
      "SELECT id FROM pedidos WHERE entregador_id = ? AND status = 'em_entrega'"
    ).get(req.usuario!.id) as { id: number } | undefined;
    if (ativa) throw erroHttp(409, `Você já está com a entrega #${ativa.id} em andamento. Conclua-a primeiro.`);

    const agora = agoraUTC();
    const resultado = db.prepare(
      `UPDATE pedidos
          SET entregador_id = ?, status = 'em_entrega', atualizado_em = ?
        WHERE id = ? AND status = 'pronto' AND entregador_id IS NULL`
    ).run(req.usuario!.id, agora, req.params.id);

    if (resultado.changes === 0) {
      throw erroHttp(409, 'Essa corrida não está mais disponível (outro entregador aceitou primeiro).');
    }

    db.prepare('INSERT INTO historico_status (pedido_id, status, criado_em) VALUES (?, ?, ?)')
      .run(req.params.id, 'em_entrega', agora);
    registrarEvento(Number(req.params.id), 'saiu_para_entrega');

    res.json({ ok: true, mensagem: 'Corrida aceita! Boa entrega.' });
  } catch (e) { next(e); }
});

router.get('/atual', (req, res) => {
  const pedido = db.prepare(
    `SELECT p.id, p.endereco_entrega, p.taxa_entrega_centavos, p.total_centavos,
            p.forma_pagamento, p.troco_para_centavos, p.observacoes,
            l.nome AS loja_nome, l.endereco AS loja_endereco,
            u.nome AS cliente_nome, u.telefone AS cliente_telefone
       FROM pedidos p
       JOIN lojas l ON l.id = p.loja_id
       JOIN usuarios u ON u.id = p.cliente_id
      WHERE p.entregador_id = ? AND p.status = 'em_entrega'`
  ).get(req.usuario!.id);
  res.json({ pedido: pedido || null });
});

/**
 * Rastreamento ao vivo: o entregador reporta sua posição GPS enquanto a
 * entrega está em andamento. Só grava se o pedido for dele e estiver em_entrega.
 */
router.post('/corridas/:id/localizacao', (req, res, next) => {
  try {
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw erroHttp(400, 'Coordenadas inválidas.');
    }
    const resultado = db.prepare(
      `UPDATE pedidos
          SET entregador_lat = ?, entregador_lng = ?, entregador_local_em = ?
        WHERE id = ? AND entregador_id = ? AND status = 'em_entrega'`
    ).run(lat, lng, agoraUTC(), req.params.id, req.usuario!.id);
    if (resultado.changes === 0) {
      throw erroHttp(409, 'Esta entrega não está em andamento com você.');
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * "Estou chegando": avisa o cliente que o entregador está próximo.
 * Marca o pedido e dispara uma notificação push (funciona com o app fechado).
 */
router.post('/corridas/:id/chegando', async (req, res, next) => {
  try {
    const pedido = db.prepare(
      `SELECT p.id, p.cliente_id, l.nome AS loja_nome
         FROM pedidos p JOIN lojas l ON l.id = p.loja_id
        WHERE p.id = ? AND p.entregador_id = ? AND p.status = 'em_entrega'`
    ).get(req.params.id, req.usuario!.id) as
      { id: number; cliente_id: number; loja_nome: string } | undefined;
    if (!pedido) throw erroHttp(409, 'Esta entrega não está em andamento com você.');

    db.prepare('UPDATE pedidos SET aviso_chegada_em = ? WHERE id = ?')
      .run(agoraUTC(), pedido.id);

    registrarEvento(pedido.id, 'entregador_chegando');

    await enviarPush(pedido.cliente_id, {
      titulo: '🛵 Seu pedido está chegando!',
      corpo: `O entregador da ${pedido.loja_nome} está quase aí. Prepare-se para receber!`,
      url: `/pedido/${pedido.id}`,
      tag: `chegando-${pedido.id}`,
    });

    res.json({ ok: true, mensagem: 'Cliente avisado!' });
  } catch (e) { next(e); }
});

router.post('/corridas/:id/entregar', (req, res, next) => {
  try {
    const agora = agoraUTC();
    const resultado = db.prepare(
      `UPDATE pedidos SET status = 'entregue', atualizado_em = ?
        WHERE id = ? AND entregador_id = ? AND status = 'em_entrega'`
    ).run(agora, req.params.id, req.usuario!.id);
    if (resultado.changes === 0) {
      throw erroHttp(409, 'Esta entrega não está em andamento com você.');
    }
    db.prepare('INSERT INTO historico_status (pedido_id, status, criado_em) VALUES (?, ?, ?)')
      .run(req.params.id, 'entregue', agora);
    registrarEvento(Number(req.params.id), 'entregue');
    // Auto-emite a NFC-e da venda entregue (se a loja tiver NFC-e ativa + certificado).
    // Fire-and-forget: não bloqueia nem falha a confirmação de entrega.
    emitirNfcePedido(Number(req.params.id)).catch(() => { /* nota fica registrada com o erro */ });
    res.json({ ok: true, mensagem: 'Entrega confirmada. Obrigado!' });
  } catch (e) { next(e); }
});

router.get('/historico', (req, res) => {
  const periodo = ['dia', 'semana', 'mes'].includes(req.query.periodo as string)
    ? (req.query.periodo as 'dia' | 'semana' | 'mes') : 'semana';
  const dias = { dia: 1, semana: 7, mes: 30 }[periodo];
  const inicio = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

  type Entrega = { id: number; endereco_entrega: string; taxa_entrega_centavos: number; atualizado_em: string; loja_nome: string };
  const entregas = db.prepare(
    `SELECT p.id, p.endereco_entrega, p.taxa_entrega_centavos, p.atualizado_em,
            l.nome AS loja_nome
       FROM pedidos p JOIN lojas l ON l.id = p.loja_id
      WHERE p.entregador_id = ? AND p.status = 'entregue' AND p.atualizado_em >= ?
      ORDER BY p.id DESC`
  ).all(req.usuario!.id, inicio) as Entrega[];

  const totalFretes = entregas.reduce((soma, e) => soma + e.taxa_entrega_centavos, 0);
  res.json({ periodo, entregas, total_fretes_centavos: totalFretes });
});

export default router;
