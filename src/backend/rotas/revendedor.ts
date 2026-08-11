/**
 * Painel do REVENDEDOR — o mesmo painel do admin, com um recorte.
 *
 * Ele vê só os clientes com o `revendedor_id` dele. Isso não é filtro de tela:
 * toda consulta aqui já nasce com `WHERE revendedor_id = ?` amarrado à sessão,
 * nunca a um id que venha do cliente. Um parâmetro na URL decidindo de quem são
 * os dados seria só uma questão de trocar o número na barra de endereço.
 */
import { Router } from 'express';
import { autenticarRevendedor } from '../auth';
import { poolCentral } from '../tenants-mysql';
import { abrirPool } from '../db-mysql';
import { erroHttp, inteiroPositivo } from '../util';

const router = Router();
router.use(autenticarRevendedor);

/** Confere que este cliente é DELE. Devolve o tenant ou estoura 404. */
async function meuCliente(revendedorId: number, tenantId: unknown) {
  const id = inteiroPositivo(tenantId);
  if (!id) throw erroHttp(400, 'Cliente inválido.');
  const [linhas] = await poolCentral().query(
    'SELECT * FROM tenants WHERE id = ? AND revendedor_id = ?',
    [id, revendedorId],
  ) as unknown as [Array<Record<string, unknown>>];
  const t = linhas[0];
  /*
   * 404, não 403: responder "existe, mas não é seu" já contaria que aquele id
   * existe. Do lado de fora, cliente de outro revendedor e cliente inexistente
   * são a mesma coisa.
   */
  if (!t) throw erroHttp(404, 'Cliente não encontrado.');
  return t;
}

/** Quem sou eu + o resumo da conta do mês. */
router.get('/eu', async (req, res, next) => {
  try {
    const r = req.revendedor!;
    const [linhas] = await poolCentral().query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(ativo), 0) AS ativos
         FROM tenants WHERE revendedor_id = ?`,
      [r.id],
    ) as unknown as [Array<{ total: number; ativos: number }>];
    const { total, ativos } = linhas[0];
    res.json({
      revendedor: { id: r.id, nome: r.nome, email: r.email },
      clientes: Number(total),
      clientes_ativos: Number(ativos),
      custo_centavos: r.custo_centavos,
      // Só os ATIVOS entram na conta: cliente suspenso não gera cobrança.
      total_mes_centavos: r.custo_centavos * Number(ativos),
    });
  } catch (e) { next(e); }
});

/** Clientes dele, com faturamento do mês de cada um. */
router.get('/clientes', async (req, res, next) => {
  try {
    const r = req.revendedor!;
    const [tenants] = await poolCentral().query(
      'SELECT id, nome, slug, dominio, db_nome, ativo, criado_em FROM tenants WHERE revendedor_id = ? ORDER BY nome',
      [r.id],
    ) as unknown as [Array<Record<string, unknown>>];

    const inicioMes = new Date().toISOString().slice(0, 7) + '-01T00:00:00.000Z';
    const clientes = await Promise.all(tenants.map(async (t) => {
      let lojas = 0, pedidos = 0, faturamento = 0;
      try {
        const pool = abrirPool(String(t.db_nome));
        const [l] = await pool.query('SELECT COUNT(*) AS n FROM lojas') as any;
        lojas = Number(l[0]?.n ?? 0);
        const [p] = await pool.query(
          `SELECT COUNT(*) AS n, COALESCE(SUM(total_centavos), 0) AS total
             FROM pedidos WHERE status = 'entregue' AND criado_em >= ?`,
          [inicioMes],
        ) as any;
        pedidos = Number(p[0]?.n ?? 0);
        faturamento = Number(p[0]?.total ?? 0);
      } catch {
        // Banco do cliente fora do ar não derruba a lista inteira — ele aparece
        // zerado e os outros continuam visíveis.
      }
      return { ...t, lojas, pedidos_mes: pedidos, faturamento_mes_centavos: faturamento };
    }));
    res.json({ clientes });
  } catch (e) { next(e); }
});

/**
 * Suspende ou reativa um cliente DELE.
 *
 * É o mesmo `ativo` que o super admin usa: a loja sai do ar com um aviso
 * honesto (ver tenantDesativadoDoHost). Inventar um segundo tipo de bloqueio
 * daria duas regras pro mesmo estado, e alguém acabaria vendo uma loja que
 * deveria estar fora.
 */
router.post('/clientes/:id/suspender', async (req, res, next) => {
  try {
    const r = req.revendedor!;
    const t = await meuCliente(r.id, req.params.id);
    const novo = t.ativo ? 0 : 1;
    await poolCentral().query('UPDATE tenants SET ativo = ? WHERE id = ?', [novo, t.id]);
    res.json({ ok: true, ativo: novo });
  } catch (e) { next(e); }
});

export default router;
