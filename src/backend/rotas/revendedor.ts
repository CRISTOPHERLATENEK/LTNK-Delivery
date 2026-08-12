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
import bcrypt from 'bcryptjs';
import { erroHttp, inteiroPositivo, textoLimpo, emailValido, agoraUTC } from '../util';
import { problemaNoSlugTenant } from '../tenants-mysql';
import { contaDoMes } from '../conta-revendedor';

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
    /*
     * MESMO cálculo que o admin vê (conta-revendedor.ts). Se cada lado somasse
     * do seu jeito, o revendedor veria um valor e a cobrança sairia outro — e a
     * discussão seria sobre qual das duas telas está certa.
     */
    const [linhas] = await poolCentral().query(
      `SELECT t.id, t.ativo, COALESCE(SUM(mc.preco_centavos), 0) AS modulos_centavos
         FROM tenants t
         LEFT JOIN modulos_cliente mc ON mc.tenant_id = t.id
        WHERE t.revendedor_id = ?
        GROUP BY t.id, t.ativo`,
      [r.id],
    ) as unknown as [Array<{ ativo: number; modulos_centavos: number }>];

    const conta = contaDoMes(r.custo_centavos, linhas.map(t => ({
      ativo: !!t.ativo,
      modulos: [Number(t.modulos_centavos) || 0],
    })));
    res.json({
      revendedor: { id: r.id, nome: r.nome, email: r.email },
      clientes: linhas.length,
      custo_centavos: r.custo_centavos,
      ...conta,
      // Mantido pelo nome antigo pra não quebrar a tela já publicada.
      total_mes_centavos: conta.total_centavos,
    });
  } catch (e) { next(e); }
});

/** Clientes dele, com faturamento do mês de cada um. */
router.get('/clientes', async (req, res, next) => {
  try {
    const r = req.revendedor!;
    const [tenants] = await poolCentral().query(
      `SELECT t.id, t.nome, t.slug, t.dominio, t.db_nome, t.ativo, t.criado_em,
              COALESCE(SUM(mc.preco_centavos), 0) AS modulos_centavos,
              COALESCE(GROUP_CONCAT(m.nome ORDER BY m.nome SEPARATOR ', '), '') AS modulos_nomes
         FROM tenants t
         LEFT JOIN modulos_cliente mc ON mc.tenant_id = t.id
         LEFT JOIN modulos m ON m.id = mc.modulo_id
        WHERE t.revendedor_id = ?
        GROUP BY t.id, t.nome, t.slug, t.dominio, t.db_nome, t.ativo, t.criado_em
        ORDER BY t.nome`,
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

/* ─────────────────── Solicitações de cliente novo ─────────────────── */

/**
 * Pede um cliente novo. NÃO cria nada — entra na fila do super admin.
 *
 * Valida aqui o que dá pra validar agora (slug livre, e-mail, senha), pra o
 * revendedor descobrir o problema no momento de preencher, e não dias depois
 * numa recusa. O que só a aprovação sabe (banco alcançável) fica pra lá.
 */
router.post('/solicitacoes', async (req, res, next) => {
  try {
    const r = req.revendedor!;
    const nome = textoLimpo(req.body.nome, 120);
    const slug = textoLimpo(req.body.slug, 60).toLowerCase().replace(/[^a-z0-9-]/g, '');
    const nomeLoja = textoLimpo(req.body.nome_loja || nome, 120);
    const categoria = textoLimpo(req.body.categoria || 'Outros', 50) || 'Outros';
    const donoNome = textoLimpo(req.body.dono_nome, 120);
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const telefone = textoLimpo(req.body.telefone || '', 30);
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';

    if (nome.length < 2) throw erroHttp(400, 'Informe o nome do cliente.');
    const problemaSlug = problemaNoSlugTenant(slug);
    if (problemaSlug) throw erroHttp(400, problemaSlug);
    if (donoNome.length < 2) throw erroHttp(400, 'Informe o nome do responsável pela loja.');
    if (!emailValido(email)) throw erroHttp(400, 'E-mail do responsável inválido.');
    if (senha.length < 6) throw erroHttp(400, 'Senha do responsável: mínimo 6 caracteres.');

    const pool = poolCentral();
    // Slug já em uso, ou já pedido por alguém: avisa AGORA. Descobrir isso na
    // recusa, dias depois, faria o revendedor refazer tudo.
    const [existe] = await pool.query('SELECT id FROM tenants WHERE slug = ?', [slug]) as unknown as [unknown[]];
    if (existe.length) throw erroHttp(409, `O identificador "${slug}" já está em uso. Escolha outro.`);
    const [pendente] = await pool.query(
      "SELECT id FROM solicitacoes_cliente WHERE slug = ? AND status = 'pendente'", [slug],
    ) as unknown as [unknown[]];
    if (pendente.length) throw erroHttp(409, `Já existe uma solicitação pendente com o identificador "${slug}".`);

    const [ins] = await pool.query(
      `INSERT INTO solicitacoes_cliente
         (revendedor_id, nome, slug, nome_loja, categoria, dono_nome, dono_email, dono_telefone, senha_hash, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.id, nome, slug, nomeLoja, categoria, donoNome, email, telefone, bcrypt.hashSync(senha, 10), agoraUTC()],
    ) as unknown as [{ insertId: number }];
    res.status(201).json({ id: Number(ins.insertId) });
  } catch (e) { next(e); }
});

/** As solicitações DELE, com o motivo quando recusada. */
router.get('/solicitacoes', async (req, res, next) => {
  try {
    const r = req.revendedor!;
    const [linhas] = await poolCentral().query(
      `SELECT id, nome, slug, nome_loja, dono_nome, dono_email, status, motivo_recusa, criado_em, decidido_em
         FROM solicitacoes_cliente WHERE revendedor_id = ? ORDER BY id DESC`,
      [r.id],
    );
    res.json({ solicitacoes: linhas });
  } catch (e) { next(e); }
});

export default router;
