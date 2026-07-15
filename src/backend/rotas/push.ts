/**
 * Inscrição em Web Push — compartilhada por qualquer usuário autenticado
 * (cliente recebe status do pedido; lojista recebe novos pedidos).
 */
import { Router } from 'express';
import { autenticar } from '../auth';
import { salvarInscricao, removerInscricao } from '../push';

const router = Router();
router.use(autenticar);

/** Registra a inscrição de push do dispositivo atual. */
router.post('/inscrever', async (req, res, next) => {
  try {
    await salvarInscricao(req.usuario!.id, req.body?.inscricao);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/** Remove a inscrição (usuário desativou notificações neste dispositivo). */
router.post('/cancelar', async (req, res, next) => {
  try {
    const endpoint = req.body?.endpoint;
    if (endpoint) await removerInscricao(endpoint);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
