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
import { erroHttp, inteiroPositivo, textoLimpo, emailValido, agoraUTC, dataBrasilia } from '../util';
import { problemaNoSlugTenant } from '../tenants-mysql';
import { contaDoMes } from '../conta-revendedor';
import { gravarFaturaDoMes } from '../faturas';
import { competenciaDe } from '../fatura-revendedor';

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
    /*
     * Decisões que ele ainda não viu. Sem isso o revendedor só descobre a
     * recusa se abrir a lista por conta própria — e uma recusa que ninguém lê
     * vira o mesmo pedido reenviado uma semana depois.
     */
    const [naoVistas] = await poolCentral().query(
      `SELECT status, COUNT(*) AS n FROM solicitacoes_cliente
        WHERE revendedor_id = ? AND status <> 'pendente' AND visto_em = ''
        GROUP BY status`,
      [r.id],
    ) as unknown as [Array<{ status: string; n: number }>];
    const [pend] = await poolCentral().query(
      "SELECT COUNT(*) AS n FROM solicitacoes_cliente WHERE revendedor_id = ? AND status = 'pendente'",
      [r.id],
    ) as unknown as [Array<{ n: number }>];
    const [perfil] = await poolCentral().query(
      'SELECT telefone FROM revendedores WHERE id = ?', [r.id],
    ) as unknown as [Array<{ telefone: string }>];

    res.json({
      revendedor: { id: r.id, nome: r.nome, email: r.email, telefone: perfil[0]?.telefone ?? '' },
      novidades: {
        aprovadas: Number(naoVistas.find(x => x.status === 'aprovada')?.n ?? 0),
        recusadas: Number(naoVistas.find(x => x.status === 'recusada')?.n ?? 0),
        pendentes: Number(pend[0]?.n ?? 0),
      },
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

    // Mês pela data do BRASIL: em UTC, das 21h à meia-noite do último dia o
    // "faturamento do mês" já zeraria antes de o mês acabar.
    const inicioMes = dataBrasilia().slice(0, 7) + '-01T00:00:00.000Z';
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
      `SELECT id, tipo, tenant_id, nome, slug, nome_loja, dono_nome, dono_email, status,
              motivo_pedido, motivo_recusa, visto_em, criado_em, decidido_em
         FROM solicitacoes_cliente WHERE revendedor_id = ? ORDER BY id DESC`,
      [r.id],
    );
    res.json({ solicitacoes: linhas });
  } catch (e) { next(e); }
});

/* ─────────────────────────── Detalhe do cliente ─────────────────────────── */

/**
 * Um cliente dele, de perto: dono, módulos com preço, lojas, pedidos do mês.
 *
 * Rota separada da lista de propósito: estes números vêm do banco DO CLIENTE,
 * um banco por cliente. Fazer isso para todos de uma vez deixaria a lista lenta
 * na proporção do sucesso do revendedor.
 */
router.get('/clientes/:id', async (req, res, next) => {
  try {
    const r = req.revendedor!;
    const t = await meuCliente(r.id, req.params.id);

    const [mods] = await poolCentral().query(
      `SELECT COALESCE(m.nome, 'Módulo removido') AS nome, mc.preco_centavos, mc.criado_em
         FROM modulos_cliente mc
         LEFT JOIN modulos m ON m.id = mc.modulo_id
        WHERE mc.tenant_id = ? ORDER BY nome`,
      [t.id],
    ) as unknown as [Array<Record<string, unknown>>];

    const inicioMes = competenciaDe(dataBrasilia()) + '-01T00:00:00.000Z';
    let lojas: Array<Record<string, unknown>> = [];
    let pedidos = 0, faturamento = 0, ticket = 0, usuarios = 0;
    let bancoOk = true;
    try {
      const pool = abrirPool(String(t.db_nome));
      const [ls] = await pool.query('SELECT id, nome, slug, ativa FROM lojas ORDER BY nome') as any;
      lojas = ls;
      const [p] = await pool.query(
        `SELECT COUNT(*) AS n, COALESCE(SUM(total_centavos), 0) AS total
           FROM pedidos WHERE status = 'entregue' AND criado_em >= ?`,
        [inicioMes],
      ) as any;
      pedidos = Number(p[0]?.n ?? 0);
      faturamento = Number(p[0]?.total ?? 0);
      ticket = pedidos > 0 ? Math.round(faturamento / pedidos) : 0;
      const [u] = await pool.query('SELECT COUNT(*) AS n FROM usuarios') as any;
      usuarios = Number(u[0]?.n ?? 0);
    } catch {
      // Banco fora do ar não vira 500: a tela mostra o que sabe e avisa que os
      // números não carregaram. Um erro aqui esconderia até o nome do dono.
      bancoOk = false;
    }

    /*
     * O pedido de exclusão pendente vai junto: a tela precisa mostrar "já
     * pedido" em vez de oferecer o botão de novo e tomar 409 na cara do
     * revendedor.
     */
    const [exc] = await poolCentral().query(
      "SELECT id, criado_em FROM solicitacoes_cliente WHERE tenant_id = ? AND tipo = 'exclusao' AND status = 'pendente' LIMIT 1",
      [t.id],
    ) as unknown as [Array<Record<string, unknown>>];

    res.json({
      cliente: {
        id: t.id, nome: t.nome, slug: t.slug, dominio: t.dominio,
        ativo: t.ativo, criado_em: t.criado_em,
      },
      modulos: mods,
      modulos_centavos: mods.reduce((s, m) => s + (Number(m.preco_centavos) || 0), 0),
      lojas, usuarios,
      pedidos_mes: pedidos,
      faturamento_mes_centavos: faturamento,
      ticket_medio_centavos: ticket,
      banco_ok: bancoOk,
      exclusao_pendente: exc[0] ?? null,
    });
  } catch (e) { next(e); }
});

/* ──────────────────────────────── Fatura ──────────────────────────────── */

/**
 * O que ele paga ESTE mês, cliente por cliente.
 *
 * Grava o retrato na mesma passada (ver faturas.ts): a competência corrente é
 * regravada o tempo todo pra que, na virada do mês, a linha já esteja fechada
 * com um estado de dentro do próprio mês.
 */
router.get('/fatura', async (req, res, next) => {
  try {
    const r = req.revendedor!;
    const f = await gravarFaturaDoMes(r.id, r.custo_centavos);
    res.json({ competencia: competenciaDe(dataBrasilia()), custo_centavos: r.custo_centavos, ...f });
  } catch (e) { next(e); }
});

/** Meses anteriores, como foram fechados. Não recalcula nada. */
router.get('/faturas', async (req, res, next) => {
  try {
    const r = req.revendedor!;
    const atual = competenciaDe(dataBrasilia());
    const [linhas] = await poolCentral().query(
      `SELECT competencia, clientes_ativos, mensalidades_centavos, modulos_centavos,
              total_centavos, detalhe, fechada_em
         FROM faturas_revendedor
        WHERE revendedor_id = ? AND competencia < ?
        ORDER BY competencia DESC LIMIT 24`,
      [r.id, atual],
    ) as unknown as [Array<Record<string, unknown>>];
    const faturas = linhas.map(l => ({
      ...l,
      // O detalhe é JSON gravado por nós; se um dia vier torto, a fatura ainda
      // aparece com os totais em vez de derrubar a tela inteira.
      detalhe: (() => { try { return JSON.parse(String(l.detalhe || '[]')); } catch { return []; } })(),
    }));
    res.json({ faturas });
  } catch (e) { next(e); }
});

/* ───────────────────────── Pedido de exclusão ───────────────────────── */

/**
 * Pede pra APAGAR um cliente. Não apaga nada aqui.
 *
 * Apagar derruba o banco inteiro do cliente — pedidos, produtos, histórico — e
 * não tem volta. Um clique errado no painel de quem revende não pode ser a
 * última etapa disso; entra na fila do admin, do lado das solicitações de
 * cadastro.
 */
router.post('/clientes/:id/exclusao', async (req, res, next) => {
  try {
    const r = req.revendedor!;
    const t = await meuCliente(r.id, req.params.id);
    const motivo = textoLimpo(req.body.motivo, 300);
    if (motivo.length < 3) throw erroHttp(400, 'Escreva o motivo — quem aprova vai ler antes de apagar.');

    const pool = poolCentral();
    const [ja] = await pool.query(
      "SELECT id FROM solicitacoes_cliente WHERE tenant_id = ? AND tipo = 'exclusao' AND status = 'pendente'",
      [t.id],
    ) as unknown as [unknown[]];
    if (ja.length) throw erroHttp(409, 'Já existe um pedido de exclusão pendente para este cliente.');

    /*
     * Reusa a mesma tabela do cadastro. As colunas de cadastro (senha,
     * categoria) ficam vazias: são obrigatórias no schema por causa do outro
     * tipo, e inventar uma senha aqui seria pior que a string vazia.
     */
    const [ins] = await pool.query(
      `INSERT INTO solicitacoes_cliente
         (revendedor_id, tipo, tenant_id, nome, slug, nome_loja, categoria,
          dono_nome, dono_email, dono_telefone, senha_hash, motivo_pedido, criado_em)
       VALUES (?, 'exclusao', ?, ?, ?, '', '', '', '', '', '', ?, ?)`,
      [r.id, t.id, String(t.nome), String(t.slug), motivo, agoraUTC()],
    ) as unknown as [{ insertId: number }];
    res.status(201).json({ id: Number(ins.insertId) });
  } catch (e) { next(e); }
});

/* ─────────────────── Solicitações: cancelar e dar por vista ─────────────── */

/** Cancela um pedido DELE que ainda está pendente. */
router.delete('/solicitacoes/:id', async (req, res, next) => {
  try {
    const r = req.revendedor!;
    const [x] = await poolCentral().query(
      "DELETE FROM solicitacoes_cliente WHERE id = ? AND revendedor_id = ? AND status = 'pendente'",
      [req.params.id, r.id],
    ) as unknown as [{ affectedRows: number }];
    // Já decidida não volta atrás: o cliente pode ter sido provisionado, e
    // apagar a linha apagaria o registro de que aquilo aconteceu.
    if (x.affectedRows === 0) throw erroHttp(409, 'Solicitação não encontrada ou já decidida.');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Marca as decisões como lidas — some o aviso do painel. */
router.post('/solicitacoes/vistas', async (req, res, next) => {
  try {
    const r = req.revendedor!;
    await poolCentral().query(
      "UPDATE solicitacoes_cliente SET visto_em = ? WHERE revendedor_id = ? AND status <> 'pendente' AND visto_em = ''",
      [agoraUTC(), r.id],
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ──────────────────────────── Perfil e senha ──────────────────────────── */

/** Nome e telefone dele. E-mail não: é o login, e trocar login é outra coisa. */
router.put('/perfil', async (req, res, next) => {
  try {
    const r = req.revendedor!;
    const nome = textoLimpo(req.body.nome, 120);
    const telefone = textoLimpo(req.body.telefone || '', 30);
    if (nome.length < 2) throw erroHttp(400, 'Informe seu nome.');
    await poolCentral().query('UPDATE revendedores SET nome = ?, telefone = ? WHERE id = ?', [nome, telefone, r.id]);
    res.json({ ok: true, nome, telefone });
  } catch (e) { next(e); }
});

/**
 * Troca a própria senha.
 *
 * EXIGE A SENHA ATUAL. Sem isso, quem pegasse a tela aberta trocaria a senha e
 * o dono perderia a conta — o token sozinho não prova que quem está ali sabe a
 * senha.
 */
router.put('/senha', async (req, res, next) => {
  try {
    const r = req.revendedor!;
    const atual = typeof req.body.atual === 'string' ? req.body.atual : '';
    const nova = typeof req.body.nova === 'string' ? req.body.nova : '';
    if (nova.length < 6) throw erroHttp(400, 'A nova senha precisa de pelo menos 6 caracteres.');

    const [linhas] = await poolCentral().query(
      'SELECT senha_hash FROM revendedores WHERE id = ?', [r.id],
    ) as unknown as [Array<{ senha_hash: string }>];
    if (!linhas[0] || !bcrypt.compareSync(atual, linhas[0].senha_hash)) {
      throw erroHttp(403, 'Senha atual incorreta.');
    }
    await poolCentral().query(
      'UPDATE revendedores SET senha_hash = ? WHERE id = ?', [bcrypt.hashSync(nova, 10), r.id],
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
