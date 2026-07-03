/**
 * Módulo da COZINHA (KDS — Kitchen Display System).
 *
 * Login independente que pertence a UMA loja. O cozinheiro só vê os pedidos
 * em preparo da sua loja e só pode avançá-los (iniciar preparo → pronto).
 * Nunca enxerga faturamento, config ou qualquer dado financeiro.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import db from '../db';
import { gerarTokenCozinha, autenticarCozinha } from '../auth';
import { textoLimpo, erroHttp, agoraUTC } from '../util';
import { transicionarStatus } from '../fluxoPedido';

const router = Router();

const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { erro: 'Muitas tentativas de login. Aguarde 15 minutos e tente novamente.' },
});

interface ContaRow {
  id: number; nome: string; email: string; senha_hash: string;
  bloqueado: number; loja_id: number; loja_nome: string;
}

router.post('/login', limiteLogin, (req, res, next) => {
  try {
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';

    const conta = db.prepare(
      `SELECT c.id, c.nome, c.email, c.senha_hash, c.bloqueado, c.loja_id, l.nome AS loja_nome
         FROM cozinha_contas c JOIN lojas l ON l.id = c.loja_id
        WHERE c.email = ?`
    ).get(email) as ContaRow | undefined;

    if (!conta || !bcrypt.compareSync(senha, conta.senha_hash)) {
      throw erroHttp(401, 'E-mail ou senha incorretos.');
    }
    if (conta.bloqueado) throw erroHttp(403, 'Este acesso da cozinha foi desativado.');

    res.json({
      token: gerarTokenCozinha(conta),
      conta: { id: conta.id, nome: conta.nome, email: conta.email,
               loja_id: conta.loja_id, loja_nome: conta.loja_nome },
    });
  } catch (e) { next(e); }
});

// A partir daqui, tudo exige conta de cozinha autenticada.
router.use(autenticarCozinha);

router.get('/eu', (req, res, next) => {
  try {
    const c = req.cozinha!;
    const loja = db.prepare('SELECT nome FROM lojas WHERE id = ?').get(c.loja_id) as { nome: string } | undefined;
    res.json({ conta: { id: c.id, nome: c.nome, loja_id: c.loja_id, loja_nome: loja?.nome || '' } });
  } catch (e) { next(e); }
});

/**
 * Fila unificada da cozinha:
 *  - delivery: pedidos do app 'aceito'/'preparando'
 *  - mesa/PDV: tickets enviados pelo lojista ('na_fila'/'preparando')
 * Tudo normalizado para { fonte, id, referencia, etapa, itens, observacao }.
 * Os mais antigos primeiro (FIFO).
 */
router.get('/pedidos', (req, res, next) => {
  try {
    const c = req.cozinha!;

    const delivery = db.prepare(
      `SELECT p.id, p.status, p.observacoes, p.criado_em
         FROM pedidos p
        WHERE p.loja_id = ? AND p.origem = 'app' AND p.status IN ('aceito','preparando')`
    ).all(c.loja_id) as Array<{ id: number; status: string; observacoes: string; criado_em: string }>;
    const itensDelivery = db.prepare('SELECT nome_produto, quantidade, opcoes_texto FROM itens_pedido WHERE pedido_id = ?');

    const tickets = db.prepare(
      `SELECT id, origem, referencia, status, observacao, criado_em
         FROM cozinha_tickets
        WHERE loja_id = ? AND status IN ('na_fila','preparando')`
    ).all(c.loja_id) as Array<{ id: number; origem: string; referencia: string; status: string; observacao: string; criado_em: string }>;
    const itensTicket = db.prepare('SELECT nome_produto, quantidade, observacao FROM cozinha_ticket_itens WHERE ticket_id = ?');

    const fila = [
      ...delivery.map(p => ({
        fonte: 'delivery',
        id: p.id,
        referencia: `#${p.id}`,
        etapa: p.status === 'aceito' ? 'novo' : 'preparando',
        observacao: p.observacoes || '',
        criado_em: p.criado_em,
        itens: (itensDelivery.all(p.id) as Array<{ nome_produto: string; quantidade: number; opcoes_texto: string }>)
          .map(i => ({ nome_produto: i.nome_produto, quantidade: i.quantidade, detalhe: i.opcoes_texto || '' })),
      })),
      ...tickets.map(t => ({
        fonte: t.origem,
        id: t.id,
        referencia: t.referencia,
        etapa: t.status === 'na_fila' ? 'novo' : 'preparando',
        observacao: t.observacao || '',
        criado_em: t.criado_em,
        itens: (itensTicket.all(t.id) as Array<{ nome_produto: string; quantidade: number; observacao: string }>)
          .map(i => ({ nome_produto: i.nome_produto, quantidade: i.quantidade, detalhe: i.observacao || '' })),
      })),
    ].sort((a, b) => (a.criado_em < b.criado_em ? -1 : 1));

    res.json({ pedidos: fila });
  } catch (e) { next(e); }
});

const ACOES_COZINHA: Record<string, 'preparando' | 'pronto'> = {
  preparar: 'preparando',
  pronto:   'pronto',
};

/** Avança um pedido de DELIVERY (preparar / pronto) — usa a máquina de estados oficial. */
router.post('/pedidos/:id/acao', (req, res, next) => {
  try {
    const c = req.cozinha!;
    const acao = textoLimpo(req.body.acao, 20);
    const novoStatus = ACOES_COZINHA[acao];
    if (!novoStatus) throw erroHttp(400, 'Ação inválida. Use: preparar ou pronto.');

    const pedido = db.prepare(
      "SELECT id FROM pedidos WHERE id = ? AND loja_id = ? AND origem = 'app'"
    ).get(req.params.id, c.loja_id) as { id: number } | undefined;
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');

    const atualizado = transicionarStatus(pedido.id, novoStatus);
    res.json({ pedido: atualizado });
  } catch (e) { next(e); }
});

/** Avança um TICKET de mesa/PDV (preparar / pronto). Some da fila quando fica pronto. */
router.post('/tickets/:id/acao', (req, res, next) => {
  try {
    const c = req.cozinha!;
    const acao = textoLimpo(req.body.acao, 20);
    const novoStatus = ACOES_COZINHA[acao];
    if (!novoStatus) throw erroHttp(400, 'Ação inválida. Use: preparar ou pronto.');

    const ticket = db.prepare('SELECT id, status FROM cozinha_tickets WHERE id = ? AND loja_id = ?')
      .get(req.params.id, c.loja_id) as { id: number; status: string } | undefined;
    if (!ticket) throw erroHttp(404, 'Comanda da cozinha não encontrada.');
    if (ticket.status === 'pronto') throw erroHttp(409, 'Esta comanda já está pronta.');

    if (novoStatus === 'pronto') {
      db.prepare("UPDATE cozinha_tickets SET status = 'pronto', pronto_em = ? WHERE id = ?").run(agoraUTC(), ticket.id);
    } else {
      db.prepare("UPDATE cozinha_tickets SET status = 'preparando' WHERE id = ?").run(ticket.id);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
