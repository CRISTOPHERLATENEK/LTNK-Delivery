/**
 * Módulo do ADMIN: dashboard, aprovação/suspensão de lojas, todos os pedidos,
 * gestão de usuários, comissão, repasses e banners do carrossel.
 */
import { Router } from 'express';
import { slugUnico } from '../slug-loja';
import { contaDoMes, type ClienteNaConta } from '../conta-revendedor';
import db, { comTenant, comTransacao, bancoTenantAtual, abrirPool } from '../db-mysql';
import bcrypt from 'bcryptjs';
import { autenticar, exigirPerfil, exigirSuperAdmin, gerarTokenImpersonado } from '../auth';
import { textoLimpo, inteiroPositivo, erroHttp, ErroHttp, agoraUTC, emailValido, cpfValido, cpfDigitos, telefoneDigitos, reaisParaCentavos } from '../util';
import { criptografar, descriptografar } from '../cripto';
import { montarLandingAdmin, salvarLanding } from '../landing-campos';
import { garantirSessaoPlataforma, obterQrPlataforma, solicitarCodigoPlataforma, statusSessaoPlataforma, desconectarPlataforma } from '../whatsapp-nao-oficial';
import { validarCertificado, } from '../assinatura';
import { caminhoCertificado } from './lojista';
import * as fs from 'fs';
import multer from 'multer';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import { Tenant, listarTenants, criarTenant, atualizarTenant, tenantPorId, removerTenant, ehMaster, urlDoTenant, problemaNoSlugTenant, poolCentral } from '../tenants-mysql';
import {
  listarAssinaturas, salvarAssinatura, registrarPagamento, historicoPagamentos,
  processarVencimentos, statusCalculado, diasDeAtraso,
} from '../assinaturas';
import { geocodificarTexto } from '../geo';

/**
 * WBAPI (WhatsApp não-oficial) é sessão ÚNICA da plataforma, não por tenant —
 * por isso lê/grava sempre no banco central (nunca no `db` proxy, que resolve
 * pro tenant da requisição). Mesmo raciocínio de ../whatsapp-nao-oficial.ts.
 */
const BANCO_CENTRAL = process.env.MYSQL_DATABASE_CENTRAL || process.env.MYSQL_DATABASE || '';
import zlib from 'zlib';
import { Banner } from '../../tipos/modelos';

const router = Router();
router.use(autenticar, exigirPerfil('admin'));

/**
 * Registra uma ação administrativa no log de auditoria. Nunca lança — uma
 * falha ao gravar o log não pode derrubar a ação principal que já aconteceu.
 */
async function registrarAuditoria(
  req: import('express').Request,
  acao: string,
  opts?: { alvoTipo?: string; alvoId?: number | null; alvoDesc?: string; detalhes?: string },
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO admin_auditoria (admin_id, admin_nome, admin_email, acao, alvo_tipo, alvo_id, alvo_desc, detalhes, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.usuario!.id, req.usuario!.nome, req.usuario!.email, acao,
      opts?.alvoTipo || '', opts?.alvoId ?? null, opts?.alvoDesc || '', opts?.detalhes || '',
      agoraUTC(),
    );
  } catch { /* log é best-effort */ }
}

/**
 * Roda a MESMA consulta no banco de cada cliente e junta tudo, marcando de qual
 * cliente veio cada linha.
 *
 * Os dados de operação (pedidos, entregadores, lojistas) moram no banco de cada
 * cliente — o banco central só guarda o cadastro da plataforma. Sem isso, o
 * painel do dono da plataforma mostrava zero pedidos e faturamento R$ 0,00
 * enquanto os clientes vendiam normalmente; a tela de Lojas já agregava, e era
 * a única, o que deixava o painel se contradizendo.
 *
 * Devolve `null` quando não é o caso de agregar (admin operacional, ou já
 * dentro de um cliente) — aí o chamador segue com a consulta local de sempre.
 *
 * Um cliente com banco fora do ar não derruba a tela inteira: aquele cliente
 * entra como lista vazia e os outros aparecem.
 */
async function agregarClientes<T extends Record<string, unknown>>(
  req: import('express').Request,
  consulta: () => Promise<unknown>,
): Promise<Array<T & { tenant_id: number; tenant_nome: string; tenant_slug: string }> | null> {
  if (!ehMaster(bancoTenantAtual()) || !req.usuario?.super_admin) return null;
  const tenants = await listarTenants();
  const listas = await Promise.all(tenants.map(async (t) => {
    try {
      const linhas = await comTenant(t.db_nome, consulta) as T[];
      return linhas.map(l => ({ ...l, tenant_id: t.id, tenant_nome: t.nome, tenant_slug: t.slug }));
    } catch { return []; }
  }));
  return listas.flat();
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const hoje = new Date().toISOString().slice(0, 10);

    /*
     * No painel master os números são a SOMA de todos os clientes.
     *
     * Cada bloco vira uma consulta que roda em cada banco e é somada aqui —
     * `serie_vendas` e `top_lojas` precisam ser agrupados de novo depois de
     * juntos, senão o mesmo dia apareceria uma vez por cliente.
     */
    const agregado = await agregarClientes(req, async () => [{
      pedidos_hoje: await db.prepare(
        `SELECT COUNT(*) AS qtd, COALESCE(SUM(total_centavos), 0) AS faturamento
           FROM pedidos WHERE criado_em >= ? AND status NOT IN ('cancelado','recusado')`
      ).get(hoje + 'T00:00:00.000Z'),
      comissao_hoje: await db.prepare(
        `SELECT COALESCE(SUM(comissao_centavos), 0) AS comissao
           FROM pedidos WHERE criado_em >= ? AND status = 'entregue'`
      ).get(hoje + 'T00:00:00.000Z'),
      lojas: await db.prepare(
        `SELECT
           SUM(CASE WHEN status_aprovacao = 'aprovada' THEN 1 ELSE 0 END) AS ativas,
           SUM(CASE WHEN status_aprovacao = 'pendente' THEN 1 ELSE 0 END) AS pendentes,
           SUM(CASE WHEN status_aprovacao = 'suspensa' THEN 1 ELSE 0 END) AS suspensas
         FROM lojas`
      ).get(),
      usuarios: await db.prepare('SELECT COUNT(*) AS total FROM usuarios').get(),
      em_andamento: await db.prepare(
        `SELECT COUNT(*) AS qtd FROM pedidos
          WHERE status IN ('pendente','aceito','preparando','pronto','em_entrega')`
      ).get(),
      serie: await db.prepare(
        `SELECT SUBSTRING(criado_em, 1, 10) AS dia, COUNT(*) AS pedidos,
                COALESCE(SUM(total_centavos), 0) AS total
           FROM pedidos
          WHERE criado_em >= ? AND status NOT IN ('cancelado','recusado')
          GROUP BY dia`
      ).all(new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10) + 'T00:00:00.000Z'),
      top: await db.prepare(
        `SELECT l.id, l.nome, COUNT(p.id) AS pedidos,
                COALESCE(SUM(p.total_centavos), 0) AS total_centavos
           FROM lojas l JOIN pedidos p ON p.loja_id = l.id AND p.status = 'entregue'
          GROUP BY l.id, l.nome`
      ).all(),
    }]);

    if (agregado) {
      const n = (v: unknown) => Number(v) || 0;
      const soma = (f: (b: any) => unknown) => agregado.reduce((s, b) => s + n(f(b)), 0);

      const porDiaAg = new Map<string, { pedidos: number; total: number }>();
      for (const b of agregado as any[]) {
        for (const d of b.serie as Array<{ dia: string; pedidos: number; total: number }>) {
          const at = porDiaAg.get(d.dia) ?? { pedidos: 0, total: 0 };
          porDiaAg.set(d.dia, { pedidos: at.pedidos + n(d.pedidos), total: at.total + n(d.total) });
        }
      }
      const serie: Array<{ dia: string; pedidos: number; total_centavos: number }> = [];
      for (let i = 13; i >= 0; i--) {
        const dia = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
        const b = porDiaAg.get(dia);
        serie.push({ dia, pedidos: b?.pedidos ?? 0, total_centavos: b?.total ?? 0 });
      }

      // Loja de clientes diferentes pode ter o MESMO id — a chave do top é
      // cliente+loja, senão duas lojas viravam uma só na soma.
      const top = (agregado as any[])
        .flatMap(b => (b.top as any[]).map(l => ({ ...l, tenant_nome: b.tenant_nome })))
        .map(l => ({ ...l, pedidos: n(l.pedidos), total_centavos: n(l.total_centavos) }))
        .sort((a, b) => b.total_centavos - a.total_centavos)
        .slice(0, 5);

      res.json({
        pedidos_hoje: soma(b => b.pedidos_hoje?.qtd),
        faturamento_hoje_centavos: soma(b => b.pedidos_hoje?.faturamento),
        comissao_hoje_centavos: soma(b => b.comissao_hoje?.comissao),
        pedidos_em_andamento: soma(b => b.em_andamento?.qtd),
        lojas_ativas: soma(b => b.lojas?.ativas),
        lojas_pendentes: soma(b => b.lojas?.pendentes),
        lojas_suspensas: soma(b => b.lojas?.suspensas),
        total_usuarios: soma(b => b.usuarios?.total),
        serie_vendas: serie,
        top_lojas: top,
      });
      return;
    }

    type Resumo = { qtd: number; faturamento: number };
    const pedidosHoje = await db.prepare(
      `SELECT COUNT(*) AS qtd, COALESCE(SUM(total_centavos), 0) AS faturamento
         FROM pedidos WHERE criado_em >= ? AND status NOT IN ('cancelado','recusado')`
    ).get(hoje + 'T00:00:00.000Z') as Resumo;

    const comissaoHoje = await db.prepare(
      `SELECT COALESCE(SUM(comissao_centavos), 0) AS comissao
         FROM pedidos WHERE criado_em >= ? AND status = 'entregue'`
    ).get(hoje + 'T00:00:00.000Z') as { comissao: number };

    const lojas = await db.prepare(
      `SELECT
         SUM(CASE WHEN status_aprovacao = 'aprovada' THEN 1 ELSE 0 END) AS ativas,
         SUM(CASE WHEN status_aprovacao = 'pendente' THEN 1 ELSE 0 END) AS pendentes,
         SUM(CASE WHEN status_aprovacao = 'suspensa' THEN 1 ELSE 0 END) AS suspensas
       FROM lojas`
    ).get() as { ativas: number | null; pendentes: number | null; suspensas: number | null };

    const usuarios = await db.prepare('SELECT COUNT(*) AS total FROM usuarios').get() as { total: number };
    const emAndamento = await db.prepare(
      `SELECT COUNT(*) AS qtd FROM pedidos
        WHERE status IN ('pendente','aceito','preparando','pronto','em_entrega')`
    ).get() as { qtd: number };

    // Série de vendas dos últimos 14 dias (preenche dias sem venda com zero).
    const inicio14 = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const brutos = await db.prepare(
      `SELECT SUBSTRING(criado_em, 1, 10) AS dia, COUNT(*) AS pedidos,
              COALESCE(SUM(total_centavos), 0) AS total
         FROM pedidos
        WHERE criado_em >= ? AND status NOT IN ('cancelado','recusado')
        GROUP BY dia`
    ).all(inicio14 + 'T00:00:00.000Z') as Array<{ dia: string; pedidos: number; total: number }>;
    const porDia = new Map(brutos.map(b => [b.dia, b]));
    const serie_vendas: Array<{ dia: string; pedidos: number; total_centavos: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const dia = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const b = porDia.get(dia);
      serie_vendas.push({ dia, pedidos: b?.pedidos ?? 0, total_centavos: b?.total ?? 0 });
    }

    // Top 5 lojas por faturamento entregue (todo o período).
    const top_lojas = await db.prepare(
      `SELECT l.id, l.nome, COUNT(p.id) AS pedidos,
              COALESCE(SUM(p.total_centavos), 0) AS total_centavos
         FROM lojas l JOIN pedidos p ON p.loja_id = l.id AND p.status = 'entregue'
        GROUP BY l.id, l.nome
        ORDER BY total_centavos DESC
        LIMIT 5`
    ).all();

    res.json({
      pedidos_hoje: pedidosHoje.qtd,
      faturamento_hoje_centavos: pedidosHoje.faturamento,
      comissao_hoje_centavos: comissaoHoje.comissao,
      pedidos_em_andamento: emAndamento.qtd,
      lojas_ativas: lojas.ativas || 0,
      lojas_pendentes: lojas.pendentes || 0,
      lojas_suspensas: lojas.suspensas || 0,
      total_usuarios: usuarios.total,
      serie_vendas,
      top_lojas,
    });
  } catch (e) { next(e); }
});

// ----- Lojas ---------------------------------------------------------------

/**
 * Middleware opcional: se vier `tenant_id` (corpo ou query) E a requisição
 * for do super admin no painel principal, troca o banco pra aquele tenant
 * antes de seguir pra rota — assim as ações de UMA loja (aprovar, suspender,
 * comissão, domínio, WhatsApp, fiscal…) funcionam em cima de QUALQUER
 * cliente/tenant a partir do painel master, sem duplicar cada rota. Fora
 * desse caso (sem tenant_id, ou admin comum, ou já dentro de um tenant),
 * segue no contexto já resolvido pelo Host — comportamento de sempre.
 */
async function comTenantDaLoja(req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) {
  try {
    const tenantId = inteiroPositivo((req.body && req.body.tenant_id) ?? req.query.tenant_id);
    if (!tenantId || !ehMaster(bancoTenantAtual()) || !req.usuario?.super_admin) return next();
    const tenant = await tenantPorId(tenantId);
    if (!tenant) return next(erroHttp(404, 'Cliente não encontrado.'));
    await comTenant(tenant.db_nome, async () => next());
  } catch (e) { next(e); }
}
router.use('/lojas', comTenantDaLoja);
/*
 * Mesma coisa pro detalhe de um pedido: a lista do painel master vem de vários
 * clientes e o id 77 existe em mais de um deles — sem o `tenant_id` junto, o
 * drawer abriria o pedido 77 do cliente errado.
 */
router.use('/pedidos', comTenantDaLoja);
/* Idem pros clientes e pedidos de UM lojista, abertos no drawer. */
router.use('/lojistas', comTenantDaLoja);
/*
 * E pras ações sobre um usuário — este é o mais perigoso da lista.
 *
 * Entregadores e clientes agora vêm de vários clientes da plataforma, e o id 5
 * existe em todos eles. Sem trocar de banco, "bloquear o entregador 5" acertaria
 * o usuário 5 do banco central: pessoa errada, banco errado, e o entregador que
 * se queria bloquear continuaria trabalhando.
 */
router.use('/usuarios', comTenantDaLoja);

/**
 * Lista lojas. Chamado do painel MASTER por um super admin, agrega as lojas
 * de TODOS os tenants (cada card já sabe seu tenant_id, usado nas ações
 * abaixo). Fora desse caso, lista só as lojas do tenant atual — comportamento
 * de sempre, preservado pra admins operacionais dentro de um tenant.
 */
router.get('/lojas', async (req, res, next) => {
  try {
    if (ehMaster(bancoTenantAtual()) && req.usuario?.super_admin) {
      const tenants = await listarTenants();
      const listas = await Promise.all(tenants.map(async (t) => {
        try {
          const linhas = await comTenant(t.db_nome, async () => db.prepare(
            `SELECT l.*, u.nome AS dono_nome, u.email AS dono_email
               FROM lojas l JOIN usuarios u ON u.id = l.usuario_id`
          ).all()) as Record<string, unknown>[];
          return linhas.map(l => ({ ...l, tenant_id: t.id, tenant_nome: t.nome, tenant_slug: t.slug }));
        } catch { return []; }
      }));
      const lojas = listas.flat().sort((a: any, b: any) =>
        (a.status_aprovacao === 'pendente' ? 0 : 1) - (b.status_aprovacao === 'pendente' ? 0 : 1) || b.id - a.id);
      res.json({ lojas });
      return;
    }
    const lojas = await db.prepare(
      `SELECT l.*, u.nome AS dono_nome, u.email AS dono_email
         FROM lojas l JOIN usuarios u ON u.id = l.usuario_id
        ORDER BY CASE l.status_aprovacao WHEN 'pendente' THEN 0 ELSE 1 END, l.id DESC`
    ).all();
    res.json({ lojas });
  } catch (e) { next(e); }
});

router.post('/lojas/:id/aprovar', async (req, res, next) => {
  try {
    const loja = await db.prepare('SELECT nome FROM lojas WHERE id = ?').get(req.params.id) as { nome: string } | undefined;
    const info = await db.prepare("UPDATE lojas SET status_aprovacao = 'aprovada' WHERE id = ?")
      .run(req.params.id);
    if (info.changes === 0) throw erroHttp(404, 'Loja não encontrada.');
    await registrarAuditoria(req, 'loja.aprovar', { alvoTipo: 'loja', alvoId: Number(req.params.id), alvoDesc: loja?.nome || '' });
    res.json({ ok: true, mensagem: 'Loja aprovada.' });
  } catch (e) { next(e); }
});

router.post('/lojas/:id/suspender', async (req, res, next) => {
  try {
    const loja = await db.prepare('SELECT nome FROM lojas WHERE id = ?').get(req.params.id) as { nome: string } | undefined;
    const info = await db.prepare("UPDATE lojas SET status_aprovacao = 'suspensa', aberta = 0 WHERE id = ?")
      .run(req.params.id);
    if (info.changes === 0) throw erroHttp(404, 'Loja não encontrada.');
    await registrarAuditoria(req, 'loja.suspender', { alvoTipo: 'loja', alvoId: Number(req.params.id), alvoDesc: loja?.nome || '' });
    res.json({ ok: true, mensagem: 'Loja suspensa.' });
  } catch (e) { next(e); }
});

/** Cria uma nova loja + sua conta de responsável (lojista). */
router.post('/lojas', exigirSuperAdmin, async (req, res, next) => {
  try {
    const nomeLoja = textoLimpo(req.body.nome, 120);
    const categoria = textoLimpo(req.body.categoria || 'Outros', 50) || 'Outros';
    const descricao = textoLimpo(req.body.descricao || '', 300);
    const endereco = textoLimpo(req.body.endereco || '', 200);
    const taxaEntrega = Math.max(0, Math.round(Number(req.body.taxa_entrega_centavos) || 0));
    const tempoEstimado = Math.max(1, Math.round(Number(req.body.tempo_estimado_min) || 40));
    const nomeDono = textoLimpo(req.body.dono_nome, 120);
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    const telefone = textoLimpo(req.body.telefone || '', 30);
    if (nomeLoja.length < 2) throw erroHttp(400, 'Informe o nome da loja.');
    if (nomeDono.length < 2) throw erroHttp(400, 'Informe o nome do responsável.');
    if (!emailValido(email)) throw erroHttp(400, 'E-mail inválido.');
    if (senha.length < 6) throw erroHttp(400, 'Senha mínima de 6 caracteres.');
    if (await db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email)) {
      throw erroHttp(409, 'Já existe conta com este e-mail.');
    }
    const hash = bcrypt.hashSync(senha, 10);
    const resultado = await comTransacao(async (tx) => {
      const u = await tx.prepare(
        `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, loja_id, criado_em)
         VALUES (?, ?, ?, 'lojista', ?, NULL, ?)`
      ).run(nomeDono, email, hash, telefone, agoraUTC());
      const uid = Number(u.lastInsertRowid);
      const l = await tx.prepare(
        `INSERT INTO lojas (usuario_id, nome, descricao, categoria, endereco,
                            taxa_entrega_centavos, tempo_estimado_min, horario_funcionamento,
                            status_aprovacao, aberta, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', 'aprovada', 0, ?)`
      ).run(uid, nomeLoja, descricao, categoria, endereco, taxaEntrega, tempoEstimado, agoraUTC());
      return { usuario_id: uid, loja_id: Number(l.lastInsertRowid) };
    });
    await registrarAuditoria(req, 'loja.criar', { alvoTipo: 'loja', alvoId: resultado.loja_id, alvoDesc: nomeLoja, detalhes: `dono: ${email}` });
    res.status(201).json(resultado);
  } catch (e) { next(e); }
});

/**
 * Exclui uma loja. Bloqueia se houver pedidos (preserva o histórico
 * financeiro) — nesse caso o admin deve suspender. Sem pedidos, apaga em
 * cascata TODAS as tabelas que referenciam loja_id/usuario_id — a lista
 * cresceu com o tempo (PDV de mesa, cozinha, cupons, categorias, notas
 * fiscais) e esquecer uma delas quebra a exclusão com FOREIGN KEY constraint
 * failed no meio da transação.
 */
router.delete('/lojas/:id', exigirSuperAdmin, async (req, res, next) => {
  try {
    const lojaId = inteiroPositivo(req.params.id);
    if (!lojaId) throw erroHttp(400, 'Loja inválida.');
    const loja = await db.prepare('SELECT id, usuario_id, nome FROM lojas WHERE id = ?').get(lojaId) as
      { id: number; usuario_id: number; nome: string } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');

    const nPedidos = (await db.prepare('SELECT COUNT(*) AS n FROM pedidos WHERE loja_id = ?')
      .get(lojaId) as { n: number }).n;
    if (nPedidos > 0) {
      throw erroHttp(409,
        `Esta loja tem ${nPedidos} pedido(s) no histórico. Suspenda em vez de excluir — assim o histórico financeiro é preservado.`);
    }

    await comTransacao(async (tx) => {
      // PDV de mesa (comanda_itens → comandas → mesas, nessa ordem por causa das FKs)
      await tx.prepare(
        'DELETE FROM comanda_itens WHERE comanda_id IN (SELECT id FROM comandas WHERE loja_id = ?)'
      ).run(lojaId);
      await tx.prepare('DELETE FROM comandas WHERE loja_id = ?').run(lojaId);
      await tx.prepare('DELETE FROM mesas WHERE loja_id = ?').run(lojaId);
      // Cozinha (KDS): ticket_itens → tickets, e as contas de login da cozinha
      await tx.prepare(
        'DELETE FROM cozinha_ticket_itens WHERE ticket_id IN (SELECT id FROM cozinha_tickets WHERE loja_id = ?)'
      ).run(lojaId);
      await tx.prepare('DELETE FROM cozinha_tickets WHERE loja_id = ?').run(lojaId);
      await tx.prepare('DELETE FROM cozinha_contas WHERE loja_id = ?').run(lojaId);
      // Cupons, categorias e notas fiscais emitidas pela loja
      await tx.prepare('DELETE FROM cupons WHERE loja_id = ?').run(lojaId);
      await tx.prepare('DELETE FROM categorias WHERE loja_id = ?').run(lojaId);
      await tx.prepare('DELETE FROM notas_fiscais WHERE loja_id = ?').run(lojaId);
      // Cardápio (opções → grupos → produtos)
      await tx.prepare(
        `DELETE FROM opcoes_itens WHERE grupo_id IN (
           SELECT g.id FROM grupos_opcoes g JOIN produtos p ON p.id = g.produto_id WHERE p.loja_id = ?)`
      ).run(lojaId);
      await tx.prepare(
        'DELETE FROM grupos_opcoes WHERE produto_id IN (SELECT id FROM produtos WHERE loja_id = ?)'
      ).run(lojaId);
      await tx.prepare('DELETE FROM produtos WHERE loja_id = ?').run(lojaId);
      await tx.prepare('DELETE FROM zonas_entrega WHERE loja_id = ?').run(lojaId);
      await tx.prepare('DELETE FROM banners WHERE loja_id = ?').run(lojaId);
      await tx.prepare('DELETE FROM favoritos WHERE loja_id = ?').run(lojaId);
      await tx.prepare('DELETE FROM avaliacoes WHERE loja_id = ?').run(lojaId);
      // Clientes isolados nesta loja (white label) deixam de apontar para ela.
      await tx.prepare('UPDATE usuarios SET loja_id = NULL WHERE loja_id = ?').run(lojaId);
      await tx.prepare('DELETE FROM lojas WHERE id = ?').run(lojaId);
      // Remove o responsável se ele não tiver outra loja (inclui o que referencia a conta dele).
      const outra = await tx.prepare('SELECT id FROM lojas WHERE usuario_id = ?').get(loja.usuario_id);
      if (!outra) {
        await tx.prepare('DELETE FROM push_inscricoes WHERE usuario_id = ?').run(loja.usuario_id);
        await tx.prepare('DELETE FROM enderecos WHERE usuario_id = ?').run(loja.usuario_id);
        await tx.prepare("DELETE FROM usuarios WHERE id = ? AND perfil = 'lojista'").run(loja.usuario_id);
      }
    });
    await registrarAuditoria(req, 'loja.excluir', { alvoTipo: 'loja', alvoId: lojaId, alvoDesc: loja.nome });
    res.json({ ok: true, mensagem: 'Loja excluída.' });
  } catch (e) { next(e); }
});

/** Vendas detalhadas de UMA loja (resumo financeiro + pedidos recentes). */
router.get('/lojas/:id/vendas', async (req, res, next) => {
  try {
    const lojaId = inteiroPositivo(req.params.id);
    if (!lojaId) throw erroHttp(400, 'Loja inválida.');
    const loja = await db.prepare('SELECT id, nome FROM lojas WHERE id = ?').get(lojaId);
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');

    const params: (string | number)[] = [lojaId];
    let filtro = '';
    if (req.query.de)  { filtro += ' AND p.criado_em >= ?'; params.push(textoLimpo(req.query.de, 10) + 'T00:00:00.000Z'); }
    if (req.query.ate) { filtro += ' AND p.criado_em <= ?'; params.push(textoLimpo(req.query.ate, 10) + 'T23:59:59.999Z'); }

    const entregues = await db.prepare(
      `SELECT COUNT(*) AS pedidos,
              COALESCE(SUM(p.total_centavos), 0)    AS faturamento_centavos,
              COALESCE(SUM(p.comissao_centavos), 0) AS comissao_centavos,
              COALESCE(SUM(p.total_centavos - p.comissao_centavos), 0) AS repasse_centavos
         FROM pedidos p WHERE p.loja_id = ? AND p.status = 'entregue'${filtro}`
    ).get(...params) as { pedidos: number; faturamento_centavos: number; comissao_centavos: number; repasse_centavos: number };

    const emAndamento = (await db.prepare(
      `SELECT COUNT(*) AS n FROM pedidos p
        WHERE p.loja_id = ? AND p.status IN ('pendente','aceito','preparando','pronto','em_entrega')${filtro}`
    ).get(...params) as { n: number }).n;

    const cancelados = (await db.prepare(
      `SELECT COUNT(*) AS n FROM pedidos p
        WHERE p.loja_id = ? AND p.status IN ('cancelado','recusado')${filtro}`
    ).get(...params) as { n: number }).n;

    const recentes = await db.prepare(
      `SELECT p.id, p.status, p.total_centavos, p.criado_em, c.nome AS cliente_nome
         FROM pedidos p JOIN usuarios c ON c.id = p.cliente_id
        WHERE p.loja_id = ?${filtro}
        ORDER BY p.id DESC LIMIT 20`
    ).all(...params);

    const ticket = entregues.pedidos ? Math.round(entregues.faturamento_centavos / entregues.pedidos) : 0;

    res.json({
      loja,
      resumo: {
        ...entregues,
        ticket_medio_centavos: ticket,
        em_andamento: emAndamento,
        cancelados,
      },
      recentes,
    });
  } catch (e) { next(e); }
});

// ----- Pedidos (todos, com filtros) ----------------------------------------

/** Monta a consulta da lista/CSV a partir dos filtros da tela. */
function consultaPedidos(req: import('express').Request, limite: number) {
  let sql = `SELECT p.*, l.nome AS loja_nome, c.nome AS cliente_nome, e.nome AS entregador_nome
               FROM pedidos p
               JOIN lojas l ON l.id = p.loja_id
               JOIN usuarios c ON c.id = p.cliente_id
               LEFT JOIN usuarios e ON e.id = p.entregador_id
              WHERE 1 = 1`;
  const params: (string | number)[] = [];
  if (req.query.loja_id) { sql += ' AND p.loja_id = ?'; params.push(String(req.query.loja_id)); }
  if (req.query.status)  { sql += ' AND p.status = ?'; params.push(textoLimpo(req.query.status, 20)); }
  if (req.query.de)      { sql += ' AND p.criado_em >= ?'; params.push(textoLimpo(req.query.de, 10) + 'T00:00:00.000Z'); }
  if (req.query.ate)     { sql += ' AND p.criado_em <= ?'; params.push(textoLimpo(req.query.ate, 10) + 'T23:59:59.999Z'); }
  sql += ' ORDER BY p.id DESC';
  if (limite) sql += ` LIMIT ${limite}`;
  return { sql, params };
}

router.get('/pedidos', async (req, res, next) => {
  try {
    /*
     * O teto de 500 é por CLIENTE, não do total: cortar 500 no fim da soma
     * esconderia clientes inteiros — os do fim da fila nunca apareceriam.
     * Depois de juntos, ordena pela data (o id só é comparável dentro de um
     * mesmo cliente) e corta em 500.
     */
    const agregado = await agregarClientes(req, async () => {
      const { sql, params } = consultaPedidos(req, 500);
      return db.prepare(sql).all(...params);
    });
    if (agregado) {
      const pedidos = agregado
        .sort((a: any, b: any) => String(b.criado_em).localeCompare(String(a.criado_em)))
        .slice(0, 500);
      res.json({ pedidos });
      return;
    }
    const { sql, params } = consultaPedidos(req, 500);
    res.json({ pedidos: await db.prepare(sql).all(...params) });
  } catch (e) { next(e); }
});

/**
 * Mesma consulta da lista, em CSV — pros mesmos filtros da tela.
 *
 * DECLARADO ANTES de `/pedidos/:id`: o Express casa na ordem, e ali "csv"
 * entraria como id e devolveria 404.
 *
 * Sem o LIMIT 500 da lista: exportar é justamente o caso em que se quer o
 * período inteiro, e quem exporta já escolheu as datas.
 */
router.get('/pedidos/csv', async (req, res, next) => {
  try {
    // Sem limite: exportar é justamente o caso em que se quer o período
    // inteiro, e quem exporta já escolheu as datas.
    const rodar = async () => {
      const { sql, params } = consultaPedidos(req, 0);
      return db.prepare(sql).all(...params);
    };
    const agregado = await agregarClientes(req, rodar);
    const linhas = (agregado
      ? agregado.sort((a: any, b: any) => String(b.criado_em).localeCompare(String(a.criado_em)))
      : await rodar()) as Array<Record<string, unknown>>;

    const reais = (c: unknown) => ((Number(c) || 0) / 100).toFixed(2).replace('.', ',');
    const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    // A coluna do cliente só existe quando a exportação junta vários — dentro
    // de um cliente só, seria uma coluna repetindo o mesmo nome em toda linha.
    const cabecalho = [
      ...(agregado ? ['Cliente da plataforma'] : []),
      'Pedido', 'Data', 'Status', 'Loja', 'Cliente', 'Entregador', 'Pagamento',
      'Subtotal (R$)', 'Entrega (R$)', 'Total (R$)', 'Comissao (R$)', 'Endereco',
    ];
    const corpo = linhas.map(p => [
      ...(agregado ? [esc(p.tenant_nome)] : []),
      p.id,
      esc(p.criado_em),
      esc(p.status),
      esc(p.loja_nome),
      esc(p.cliente_nome),
      esc(p.entregador_nome),
      esc(p.forma_pagamento),
      esc(reais(p.subtotal_centavos)),
      esc(reais(p.taxa_entrega_centavos)),
      esc(reais(p.total_centavos)),
      esc(reais(p.comissao_centavos)),
      esc(p.endereco_entrega),
    ].join(';'));
    // BOM + ';' + CRLF: é o que o Excel em pt-BR abre sem pedir importação.
    const csv = '﻿' + [cabecalho.join(';'), ...corpo].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pedidos-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (e) { next(e); }
});

/** Detalhe de um pedido (itens + linha do tempo) para o admin. */
router.get('/pedidos/:id', async (req, res, next) => {
  try {
    const pedido = await db.prepare(
      `SELECT p.*, l.nome AS loja_nome, c.nome AS cliente_nome, c.telefone AS cliente_telefone,
              e.nome AS entregador_nome
         FROM pedidos p
         JOIN lojas l ON l.id = p.loja_id
         JOIN usuarios c ON c.id = p.cliente_id
         LEFT JOIN usuarios e ON e.id = p.entregador_id
        WHERE p.id = ?`
    ).get(req.params.id);
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    const itens = await db.prepare(
      'SELECT nome_produto, preco_unit_centavos, quantidade, opcoes_texto, observacao FROM itens_pedido WHERE pedido_id = ?'
    ).all((pedido as { id: number }).id);
    const historico = await db.prepare(
      'SELECT status, criado_em FROM historico_status WHERE pedido_id = ? ORDER BY id'
    ).all((pedido as { id: number }).id);
    res.json({ pedido, itens, historico });
  } catch (e) { next(e); }
});

// ----- Usuários ------------------------------------------------------------

router.get('/usuarios', async (_req, res, next) => {
  try {
    const usuarios = await db.prepare(
      'SELECT id, nome, email, perfil, telefone, bloqueado, criado_em FROM usuarios ORDER BY id'
    ).all();
    res.json({ usuarios });
  } catch (e) { next(e); }
});

/**
 * POST /api/admin/usuarios — cria uma conta de cliente pelo admin (super
 * admin). Mesma validação do autocadastro público (POST /auth/registrar):
 * CPF obrigatório e válido, e-mail opcional (gera um sintético se vazio,
 * já que a coluna é NOT NULL UNIQUE), telefone único se informado.
 * loja_id opcional isola o cliente numa loja específica (white label).
 */
router.post('/usuarios', exigirSuperAdmin, async (req, res, next) => {
  try {
    const nome = textoLimpo(req.body.nome, 120);
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    const telefone = telefoneDigitos(req.body.telefone);
    const cpf = cpfDigitos(req.body.cpf);
    const lojaId = req.body.loja_id ? inteiroPositivo(req.body.loja_id) : null;

    if (nome.length < 2) throw erroHttp(400, 'Informe o nome do cliente.');
    if (senha.length < 6) throw erroHttp(400, 'Senha mínima de 6 caracteres.');
    if (!cpfValido(cpf)) throw erroHttp(400, 'Informe um CPF válido.');
    if (email && !emailValido(email)) throw erroHttp(400, 'E-mail inválido.');

    const cpfExiste = await db.prepare('SELECT id FROM usuarios WHERE cpf = ?').get(cpf);
    if (cpfExiste) throw erroHttp(409, 'Já existe uma conta com este CPF.');
    if (telefone) {
      const telExiste = await db.prepare('SELECT id FROM usuarios WHERE telefone = ?').get(telefone);
      if (telExiste) throw erroHttp(409, 'Já existe uma conta com este telefone.');
    }
    const emailFinal = email || `${cpf}@cliente.local`;
    const emailExiste = await db.prepare('SELECT id FROM usuarios WHERE email = ?').get(emailFinal);
    if (emailExiste) throw erroHttp(409, 'Já existe uma conta com este e-mail.');

    const info = await db.prepare(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, loja_id, cpf, criado_em)
       VALUES (?, ?, ?, 'cliente', ?, ?, ?, ?)`
    ).run(nome, emailFinal, bcrypt.hashSync(senha, 10), telefone, lojaId, cpf, agoraUTC());

    const usuarioId = Number(info.lastInsertRowid);
    await registrarAuditoria(req, 'cliente.criar', { alvoTipo: 'cliente', alvoId: usuarioId, alvoDesc: `${nome} (${emailFinal})` });
    res.status(201).json({ usuario_id: usuarioId });
  } catch (e) { next(e); }
});

/** PUT /api/admin/usuarios/:id — edita nome/e-mail/telefone de um cliente existente. */
router.put('/usuarios/:id', exigirSuperAdmin, async (req, res, next) => {
  try {
    const alvo = await db.prepare("SELECT * FROM usuarios WHERE id = ? AND perfil = 'cliente'")
      .get(req.params.id) as { id: number; nome: string; email: string } | undefined;
    if (!alvo) throw erroHttp(404, 'Cliente não encontrado.');

    const nome = req.body.nome !== undefined ? textoLimpo(req.body.nome, 120) : alvo.nome;
    if (nome.length < 2) throw erroHttp(400, 'Informe o nome do cliente.');

    let email = alvo.email;
    if (req.body.email !== undefined) {
      const v = textoLimpo(req.body.email, 200).toLowerCase();
      if (v && !emailValido(v)) throw erroHttp(400, 'E-mail inválido.');
      email = v || alvo.email;
      if (email !== alvo.email) {
        const existe = await db.prepare('SELECT id FROM usuarios WHERE email = ? AND id != ?').get(email, alvo.id);
        if (existe) throw erroHttp(409, 'Já existe uma conta com este e-mail.');
      }
    }

    let telefone: string | undefined;
    if (req.body.telefone !== undefined) {
      telefone = telefoneDigitos(req.body.telefone);
      if (telefone) {
        const existe = await db.prepare('SELECT id FROM usuarios WHERE telefone = ? AND id != ?').get(telefone, alvo.id);
        if (existe) throw erroHttp(409, 'Já existe uma conta com este telefone.');
      }
    }

    if (telefone !== undefined) {
      await db.prepare('UPDATE usuarios SET nome = ?, email = ?, telefone = ? WHERE id = ?').run(nome, email, telefone, alvo.id);
    } else {
      await db.prepare('UPDATE usuarios SET nome = ?, email = ? WHERE id = ?').run(nome, email, alvo.id);
    }
    await registrarAuditoria(req, 'cliente.editar', { alvoTipo: 'cliente', alvoId: alvo.id, alvoDesc: `${nome} (${email})` });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** POST /api/admin/usuarios/:id/resetar-senha — define uma nova senha pro cliente. */
router.post('/usuarios/:id/resetar-senha', exigirSuperAdmin, async (req, res, next) => {
  try {
    const alvo = await db.prepare("SELECT * FROM usuarios WHERE id = ? AND perfil = 'cliente'")
      .get(req.params.id) as { id: number; nome: string; email: string } | undefined;
    if (!alvo) throw erroHttp(404, 'Cliente não encontrado.');
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (senha.length < 6) throw erroHttp(400, 'Senha mínima de 6 caracteres.');
    await db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(bcrypt.hashSync(senha, 10), alvo.id);
    await registrarAuditoria(req, 'cliente.resetar_senha', { alvoTipo: 'cliente', alvoId: alvo.id, alvoDesc: `${alvo.nome} (${alvo.email})` });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/usuarios/:id/bloquear-desbloquear', async (req, res, next) => {
  try {
    const usuario = await db.prepare('SELECT * FROM usuarios WHERE id = ?')
      .get(req.params.id) as { id: number; nome: string; email: string; perfil: string; bloqueado: number; super_admin: 0 | 1 } | undefined;
    if (!usuario) throw erroHttp(404, 'Usuário não encontrado.');
    if (usuario.id === req.usuario!.id) throw erroHttp(400, 'Você não pode bloquear a si mesmo.');
    // Um admin operacional (não-super) não pode bloquear um super admin —
    // sem essa checagem, ele conseguia trancar o dono da plataforma fora.
    if (usuario.super_admin && !req.usuario!.super_admin) {
      throw erroHttp(403, 'Só um super admin pode bloquear/desbloquear outro super admin.');
    }

    const novo = usuario.bloqueado ? 0 : 1;
    await db.prepare('UPDATE usuarios SET bloqueado = ? WHERE id = ?').run(novo, usuario.id);
    await registrarAuditoria(req, novo ? 'usuario.bloquear' : 'usuario.desbloquear', {
      alvoTipo: usuario.perfil, alvoId: usuario.id, alvoDesc: `${usuario.nome} (${usuario.email})`,
    });
    res.json({ ok: true, bloqueado: !!novo });
  } catch (e) { next(e); }
});

// ----- Gestão de admins (somente super admin) ------------------------------

/** GET /api/admin/admins — lista todos os admins (super + operacionais). */
router.get('/admins', exigirSuperAdmin, async (_req, res, next) => {
  try {
    const admins = await db.prepare(
      `SELECT id, nome, email, telefone, super_admin, bloqueado, criado_em
         FROM usuarios WHERE perfil = 'admin' ORDER BY super_admin DESC, id`
    ).all();
    res.json({ admins });
  } catch (e) { next(e); }
});

/** POST /api/admin/admins — cria admin operacional (sem poder de marca/comissão). */
router.post('/admins', exigirSuperAdmin, async (req, res, next) => {
  try {
    const nome = textoLimpo(req.body.nome, 120);
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    const telefone = textoLimpo(req.body.telefone, 30);
    if (nome.length < 2) throw erroHttp(400, 'Informe o nome.');
    if (!emailValido(email)) throw erroHttp(400, 'E-mail inválido.');
    if (senha.length < 6) throw erroHttp(400, 'Senha precisa ter pelo menos 6 caracteres.');

    const existe = await db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    if (existe) throw erroHttp(409, 'Já existe uma conta com este e-mail.');

    // super_admin SEMPRE 0 na criação — promoção exige uma ação separada
    // (POST /admins/:id/promover) com confirmação de senha do super admin.
    const info = await db.prepare(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, super_admin, criado_em)
       VALUES (?, ?, ?, 'admin', ?, 0, ?)`
    ).run(nome, email, bcrypt.hashSync(senha, 10), telefone, agoraUTC());
    await registrarAuditoria(req, 'admin.criar', { alvoTipo: 'admin', alvoId: Number(info.lastInsertRowid), alvoDesc: `${nome} (${email})` });
    res.status(201).json({ admin_id: Number(info.lastInsertRowid) });
  } catch (e) { next(e); }
});

/** DELETE /api/admin/admins/:id — remove admin operacional. */
router.delete('/admins/:id', exigirSuperAdmin, async (req, res, next) => {
  try {
    const alvo = await db.prepare("SELECT * FROM usuarios WHERE id = ? AND perfil = 'admin'")
      .get(req.params.id) as { id: number; nome: string; email: string; super_admin: number } | undefined;
    if (!alvo) throw erroHttp(404, 'Admin não encontrado.');
    if (alvo.id === req.usuario!.id) throw erroHttp(400, 'Você não pode remover sua própria conta.');
    if (alvo.super_admin) throw erroHttp(400, 'Não é possível remover um super admin pela UI.');

    await db.prepare('DELETE FROM usuarios WHERE id = ?').run(alvo.id);
    await registrarAuditoria(req, 'admin.remover', { alvoTipo: 'admin', alvoId: alvo.id, alvoDesc: `${alvo.nome} (${alvo.email})` });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * POST /api/admin/admins/:id/promover — promove um admin operacional a super
 * admin. Exige a SENHA do super admin que está fazendo a promoção (não a do
 * alvo) como segunda confirmação — evita que uma sessão sequestrada ou um
 * clique acidental crie outro dono do SaaS sem intenção explícita.
 */
router.post('/admins/:id/promover', exigirSuperAdmin, async (req, res, next) => {
  try {
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (!senha) throw erroHttp(400, 'Confirme sua senha para promover outro super admin.');
    const eu = await db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(req.usuario!.id) as { senha_hash: string };
    if (!bcrypt.compareSync(senha, eu.senha_hash)) throw erroHttp(401, 'Senha incorreta.');

    const alvo = await db.prepare("SELECT * FROM usuarios WHERE id = ? AND perfil = 'admin'")
      .get(req.params.id) as { id: number; nome: string; email: string; super_admin: number } | undefined;
    if (!alvo) throw erroHttp(404, 'Admin não encontrado.');
    if (alvo.super_admin) throw erroHttp(400, 'Este admin já é super admin.');

    await db.prepare('UPDATE usuarios SET super_admin = 1 WHERE id = ?').run(alvo.id);
    await registrarAuditoria(req, 'admin.promover', { alvoTipo: 'admin', alvoId: alvo.id, alvoDesc: `${alvo.nome} (${alvo.email})` });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * POST /api/admin/admins/:id/rebaixar — remove poderes de super admin de
 * outro admin (nunca de si mesmo — evita ficar sem nenhum super admin ativo
 * por engano). Também exige senha de confirmação.
 */
router.post('/admins/:id/rebaixar', exigirSuperAdmin, async (req, res, next) => {
  try {
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (!senha) throw erroHttp(400, 'Confirme sua senha para rebaixar um super admin.');
    const eu = await db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(req.usuario!.id) as { senha_hash: string };
    if (!bcrypt.compareSync(senha, eu.senha_hash)) throw erroHttp(401, 'Senha incorreta.');

    const alvo = await db.prepare("SELECT * FROM usuarios WHERE id = ? AND perfil = 'admin'")
      .get(req.params.id) as { id: number; nome: string; email: string; super_admin: number } | undefined;
    if (!alvo) throw erroHttp(404, 'Admin não encontrado.');
    if (alvo.id === req.usuario!.id) throw erroHttp(400, 'Você não pode rebaixar a si mesmo.');
    if (!alvo.super_admin) throw erroHttp(400, 'Este admin já não é super admin.');

    const restantes = (await db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE perfil = 'admin' AND super_admin = 1")
      .get() as { n: number }).n;
    if (restantes <= 1) throw erroHttp(400, 'Não é possível rebaixar o único super admin restante.');

    await db.prepare('UPDATE usuarios SET super_admin = 0 WHERE id = ?').run(alvo.id);
    await registrarAuditoria(req, 'admin.rebaixar', { alvoTipo: 'admin', alvoId: alvo.id, alvoDesc: `${alvo.nome} (${alvo.email})` });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * PUT /api/admin/minha-senha — o admin logado (super ou operacional) troca a
 * própria senha. Exige a senha atual como confirmação.
 */
router.put('/minha-senha', exigirPerfil('admin'), async (req, res, next) => {
  try {
    const atual = typeof req.body.senha_atual === 'string' ? req.body.senha_atual : '';
    const nova = typeof req.body.senha_nova === 'string' ? req.body.senha_nova : '';
    if (nova.length < 6) throw erroHttp(400, 'A nova senha precisa ter pelo menos 6 caracteres.');

    const eu = await db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?')
      .get(req.usuario!.id) as { senha_hash: string } | undefined;
    if (!eu || !bcrypt.compareSync(atual, eu.senha_hash)) {
      throw erroHttp(400, 'Senha atual incorreta.');
    }
    await db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?')
      .run(bcrypt.hashSync(nova, 10), req.usuario!.id);
    await registrarAuditoria(req, 'admin.trocar_senha', { alvoTipo: 'admin', alvoId: req.usuario!.id, alvoDesc: req.usuario!.email });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * POST /api/admin/2fa/resetar — reseta o 2FA da própria conta (perdeu o
 * celular / trocou de aparelho): exige a senha atual, apaga o secret e os
 * códigos de backup. O próximo login cai automaticamente na tela de
 * configurar o 2FA de novo (2FA continua obrigatório, isso só reconfigura).
 */
router.post('/2fa/resetar', exigirPerfil('admin'), async (req, res, next) => {
  try {
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    const eu = await db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?')
      .get(req.usuario!.id) as { senha_hash: string } | undefined;
    if (!eu || !bcrypt.compareSync(senha, eu.senha_hash)) {
      throw erroHttp(401, 'Senha incorreta.');
    }
    await db.prepare('UPDATE usuarios SET totp_secret = NULL, totp_ativo = 0, totp_backup_codes = NULL WHERE id = ?')
      .run(req.usuario!.id);
    await registrarAuditoria(req, 'admin.2fa_resetar', { alvoTipo: 'admin', alvoId: req.usuario!.id, alvoDesc: req.usuario!.email });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Comissão e repasses -------------------------------------------------

router.get('/comissao', async (_req, res, next) => {
  try {
    const r = await db.prepare("SELECT valor FROM configuracoes WHERE chave = 'comissao_percentual'")
      .get() as { valor: string } | undefined;
    res.json({ comissao_percentual: Number(r?.valor ?? '0') });
  } catch (e) { next(e); }
});

router.put('/comissao', exigirSuperAdmin, async (req, res, next) => {
  try {
    const pct = Number(req.body.comissao_percentual);
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) {
      throw erroHttp(400, 'Informe um percentual entre 0 e 50.');
    }
    // Upsert: a chave pode não existir se a linha padrão nunca foi criada (ex.: banco recém-provisionado).
    await db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)')
      .run('comissao_percentual', String(pct));
    await registrarAuditoria(req, 'comissao.alterar', { detalhes: `nova comissão global: ${pct}%` });
    res.json({ ok: true, comissao_percentual: pct });
  } catch (e) { next(e); }
});

/** Consulta de repasses por loja — a lista e o CSV usam a mesma. */
function consultaRepasses(req: import('express').Request) {
  let sql = `SELECT l.id AS loja_id, l.nome AS loja_nome,
                      COUNT(p.id) AS pedidos,
                      COALESCE(SUM(p.total_centavos), 0)    AS faturamento_centavos,
                      COALESCE(SUM(p.comissao_centavos), 0) AS comissao_centavos,
                      COALESCE(SUM(p.total_centavos - p.comissao_centavos), 0) AS repasse_centavos
                 FROM lojas l
               LEFT JOIN pedidos p ON p.loja_id = l.id AND p.status = 'entregue'`;
  const params: string[] = [];
  const filtros: string[] = [];
  if (req.query.de)  { filtros.push('p.criado_em >= ?'); params.push(textoLimpo(req.query.de, 10) + 'T00:00:00.000Z'); }
  if (req.query.ate) { filtros.push('p.criado_em <= ?'); params.push(textoLimpo(req.query.ate, 10) + 'T23:59:59.999Z'); }
  if (filtros.length) sql += ' AND ' + filtros.join(' AND ');
  sql += ' GROUP BY l.id, l.nome ORDER BY faturamento_centavos DESC';
  return { sql, params };
}

router.get('/repasses', async (req, res, next) => {
  try {
    const rodar = async () => {
      const { sql, params } = consultaRepasses(req);
      return db.prepare(sql).all(...params);
    };
    const agregado = await agregarClientes(req, rodar);
    const repasses = agregado
      ? agregado.sort((a: any, b: any) => Number(b.faturamento_centavos) - Number(a.faturamento_centavos))
      : await rodar();
    res.json({ repasses });
  } catch (e) { next(e); }
});

/**
 * PUT /api/admin/lojas/:id/detalhes — endereço + visual básico (cor, logo,
 * capa), usado pelo assistente de criação de cliente (Admin → Clientes) pra
 * completar o cadastro em etapas, sem precisar logar como lojista. Aceita
 * `?tenant_id=` como qualquer rota de /lojas (ver comTenantDaLoja acima).
 */
router.put('/lojas/:id/detalhes', exigirSuperAdmin, async (req, res, next) => {
  try {
    const loja = await db.prepare('SELECT id FROM lojas WHERE id = ?').get(req.params.id) as { id: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');

    const endereco = req.body.endereco !== undefined ? textoLimpo(req.body.endereco, 200) : undefined;
    const taxaEntrega = req.body.taxa_entrega_centavos !== undefined ? Math.max(0, Math.round(Number(req.body.taxa_entrega_centavos) || 0)) : undefined;
    const tempoEstimado = req.body.tempo_estimado_min !== undefined ? Math.max(1, Math.round(Number(req.body.tempo_estimado_min) || 40)) : undefined;
    const corMarca = req.body.cor_marca !== undefined ? textoLimpo(req.body.cor_marca, 20) : undefined;
    const corSecundaria = req.body.cor_secundaria !== undefined ? textoLimpo(req.body.cor_secundaria, 20) : undefined;
    const logoUrl = req.body.logo_url !== undefined ? textoLimpo(req.body.logo_url, 500) : undefined;
    const capaUrl = req.body.capa_url !== undefined ? textoLimpo(req.body.capa_url, 500) : undefined;

    let lat: number | null | undefined;
    let lon: number | null | undefined;
    if (endereco) {
      const coord = await geocodificarTexto(endereco).catch(() => null); // best-effort — nunca bloqueia o salvamento
      if (coord) { lat = coord.lat; lon = coord.lon; }
    }

    const campos: string[] = [];
    const valores: unknown[] = [];
    const set = (col: string, v: unknown) => { if (v !== undefined) { campos.push(`${col} = ?`); valores.push(v); } };
    set('endereco', endereco);
    set('taxa_entrega_centavos', taxaEntrega);
    set('tempo_estimado_min', tempoEstimado);
    set('cor_marca', corMarca);
    set('cor_secundaria', corSecundaria);
    set('logo_url', logoUrl);
    set('capa_url', capaUrl);
    set('lat', lat);
    set('lon', lon);
    if (campos.length === 0) { res.json({ ok: true }); return; }
    valores.push(loja.id);
    await db.prepare(`UPDATE lojas SET ${campos.join(', ')} WHERE id = ?`).run(...valores);

    await registrarAuditoria(req, 'loja.detalhes', { alvoTipo: 'loja', alvoId: loja.id });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Define (ou limpa, enviando null/vazio) a comissão específica de uma loja. */
router.put('/lojas/:id/comissao', exigirSuperAdmin, async (req, res, next) => {
  try {
    const loja = await db.prepare('SELECT id FROM lojas WHERE id = ?').get(req.params.id) as { id: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');
    const bruto = req.body.comissao_percentual;
    let valor: number | null = null;
    if (bruto !== null && bruto !== undefined && bruto !== '') {
      valor = Number(bruto);
      if (!Number.isFinite(valor) || valor < 0 || valor > 50) {
        throw erroHttp(400, 'Informe um percentual entre 0 e 50 (ou vazio para usar a comissão padrão).');
      }
    }
    await db.prepare('UPDATE lojas SET comissao_percentual = ? WHERE id = ?').run(valor, loja.id);
    await registrarAuditoria(req, 'loja.comissao', { alvoTipo: 'loja', alvoId: loja.id, detalhes: valor === null ? 'voltou para o padrão' : `${valor}%` });
    res.json({ ok: true, comissao_percentual: valor });
  } catch (e) { next(e); }
});

/**
 * PUT /api/admin/lojas/:id/dominio — o super admin também pode definir o
 * domínio próprio de qualquer loja (não só o lojista) — útil quando é a
 * própria plataforma que vende/gerencia o domínio pro cliente. Mesma
 * validação usada no self-service do lojista (PUT /lojista/loja).
 */
router.put('/lojas/:id/dominio', exigirSuperAdmin, async (req, res, next) => {
  try {
    const loja = await db.prepare('SELECT id FROM lojas WHERE id = ?').get(req.params.id) as { id: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');

    let d = textoLimpo(req.body.dominio_personalizado || '', 200).toLowerCase()
      .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    if (d && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(d)) {
      throw erroHttp(400, 'Domínio inválido. Use o formato "suaempresa.com.br", sem https:// nem barras.');
    }
    if (d) {
      const conflito = await db.prepare('SELECT id FROM lojas WHERE dominio_personalizado = ? AND id != ?').get(d, loja.id);
      if (conflito) throw erroHttp(409, 'Este domínio já está sendo usado por outra loja.');
    }

    await db.prepare('UPDATE lojas SET dominio_personalizado = ? WHERE id = ?').run(d || null, loja.id);
    await registrarAuditoria(req, 'loja.dominio', { alvoTipo: 'loja', alvoId: loja.id, detalhes: d || '(removido)' });
    res.json({ ok: true, dominio_personalizado: d || null });
  } catch (e) { next(e); }
});

/**
 * PUT /api/admin/lojas/:id/whatsapp-permissoes — o admin decide QUAIS
 * métodos de WhatsApp essa loja pode usar. O lojista só vê/escolhe entre o
 * que estiver liberado aqui (frontend esconde as opções não permitidas).
 * Revogar uma permissão também desliga o método se ele era o ativo, pra
 * não deixar a loja "configurada" num método que o admin acabou de proibir.
 */
router.put('/lojas/:id/whatsapp-permissoes', exigirSuperAdmin, async (req, res, next) => {
  try {
    const loja = await db.prepare('SELECT id, whatsapp_metodo_ativo FROM lojas WHERE id = ?').get(req.params.id) as
      { id: number; whatsapp_metodo_ativo: string } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');

    const permiteOficial = req.body.permite_oficial !== undefined ? (req.body.permite_oficial ? 1 : 0) : undefined;
    const permiteNaoOficial = req.body.permite_nao_oficial !== undefined ? (req.body.permite_nao_oficial ? 1 : 0) : undefined;

    const atual = await db.prepare('SELECT whatsapp_permite_oficial, whatsapp_permite_nao_oficial FROM lojas WHERE id = ?')
      .get(loja.id) as { whatsapp_permite_oficial: number; whatsapp_permite_nao_oficial: number };
    const novoOficial = permiteOficial ?? atual.whatsapp_permite_oficial;
    const novoNaoOficial = permiteNaoOficial ?? atual.whatsapp_permite_nao_oficial;

    let metodoAtivo = loja.whatsapp_metodo_ativo;
    if ((metodoAtivo === 'oficial' && !novoOficial) || (metodoAtivo === 'nao_oficial' && !novoNaoOficial)) {
      metodoAtivo = 'nenhum';
    }

    await db.prepare(
      'UPDATE lojas SET whatsapp_permite_oficial = ?, whatsapp_permite_nao_oficial = ?, whatsapp_metodo_ativo = ? WHERE id = ?'
    ).run(novoOficial, novoNaoOficial, metodoAtivo, loja.id);
    await registrarAuditoria(req, 'loja.whatsapp_permissoes', {
      alvoTipo: 'loja', alvoId: loja.id,
      detalhes: `oficial=${novoOficial ? 'sim' : 'não'}, não oficial=${novoNaoOficial ? 'sim' : 'não'}`,
    });
    res.json({ ok: true, permite_oficial: !!novoOficial, permite_nao_oficial: !!novoNaoOficial });
  } catch (e) { next(e); }
});

// ----- Configuração fiscal de uma loja (super admin) ----------------------

const uploadCertAdmin = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

/** Lê configuração fiscal de uma loja (sem segredos). */
router.get('/lojas/:id/fiscal', exigirSuperAdmin, async (req, res, next) => {
  try {
    const loja = await db.prepare('SELECT * FROM lojas WHERE id = ?').get(req.params.id) as any;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');
    const temCert = fs.existsSync(caminhoCertificado(loja.id));
    res.json({
      config: {
        ativo: loja.nfce_ativo, cnpj: loja.nfce_cnpj, ie: loja.nfce_ie,
        razao_social: loja.nfce_razao_social, nome_fantasia: loja.nfce_nome_fantasia,
        crt: loja.nfce_crt, uf: loja.nfce_uf, cmun: loja.nfce_cmun, municipio: loja.nfce_municipio,
        logradouro: loja.nfce_logradouro, numero: loja.nfce_numero, bairro: loja.nfce_bairro, cep: loja.nfce_cep,
        csc_id: loja.nfce_csc_id, ambiente: loja.nfce_ambiente, serie: loja.nfce_serie,
        proximo_numero: loja.nfce_proximo_numero,
        ncm_padrao: loja.nfce_ncm_padrao || '21069090',
        cfop_padrao: loja.nfce_cfop_padrao || '5102',
        csosn_padrao: loja.nfce_csosn_padrao || '102',
        tem_csc: !!loja.nfce_csc,
      },
      certificado: {
        instalado: temCert,
        titular: loja.nfce_cert_titular || null,
        validade: loja.nfce_cert_validade || null,
      },
    });
  } catch (e) { next(e); }
});

/** Salva configuração fiscal de uma loja. */
router.put('/lojas/:id/fiscal', exigirSuperAdmin, async (req, res, next) => {
  try {
    const loja = await db.prepare('SELECT id FROM lojas WHERE id = ?').get(req.params.id) as { id: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');
    const b = req.body;
    const txt = (v: unknown, n: number) => textoLimpo(v, n);
    await db.prepare(
      `UPDATE lojas SET
         nfce_ativo = ?, nfce_cnpj = ?, nfce_ie = ?, nfce_razao_social = ?, nfce_nome_fantasia = ?,
         nfce_crt = ?, nfce_uf = ?, nfce_cmun = ?, nfce_municipio = ?,
         nfce_logradouro = ?, nfce_numero = ?, nfce_bairro = ?, nfce_cep = ?,
         nfce_csc_id = ?, nfce_ambiente = ?, nfce_serie = ?,
         nfce_ncm_padrao = ?, nfce_cfop_padrao = ?, nfce_csosn_padrao = ?
       WHERE id = ?`
    ).run(
      b.ativo ? 1 : 0,
      txt(b.cnpj, 14).replace(/\D/g, ''), txt(b.ie, 20), txt(b.razao_social, 120), txt(b.nome_fantasia, 120),
      Number(b.crt) || 1, txt(b.uf, 2).toUpperCase(), txt(b.cmun, 7).replace(/\D/g, ''), txt(b.municipio, 80),
      txt(b.logradouro, 120), txt(b.numero, 20), txt(b.bairro, 80), txt(b.cep, 8).replace(/\D/g, ''),
      txt(b.csc_id, 10), Number(b.ambiente) === 1 ? 1 : 2, Number(b.serie) || 1,
      txt(b.ncm_padrao, 8).replace(/\D/g, '') || '21069090',
      txt(b.cfop_padrao, 4).replace(/\D/g, '') || '5102',
      txt(b.csosn_padrao, 3).replace(/\D/g, '') || '102',
      loja.id,
    );
    if (typeof b.csc === 'string' && b.csc.trim()) {
      await db.prepare('UPDATE lojas SET nfce_csc = ? WHERE id = ?').run(criptografar(b.csc.trim()), loja.id);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Upload do certificado A1 para uma loja (super admin). */
router.post('/lojas/:id/fiscal/certificado', exigirSuperAdmin, uploadCertAdmin.single('certificado'), async (req, res, next) => {
  try {
    const loja = await db.prepare('SELECT id FROM lojas WHERE id = ?').get(req.params.id) as { id: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');
    if (!req.file) throw erroHttp(400, 'Envie o arquivo .pfx.');
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (!senha) throw erroHttp(400, 'Informe a senha do certificado.');
    let cert;
    try {
      cert = validarCertificado(req.file.buffer, senha);
    } catch (err) {
      throw erroHttp(400, err instanceof Error ? err.message : 'Certificado inválido.');
    }
    // 0600: chave privada de assinatura. Sem o mode explicito o umask (0022)
    // grava 0644 — legivel por qualquer usuario do servidor.
    fs.writeFileSync(caminhoCertificado(loja.id), req.file.buffer, { mode: 0o600 });
    await db.prepare('UPDATE lojas SET nfce_cert_senha = ?, nfce_cert_titular = ?, nfce_cert_validade = ? WHERE id = ?')
      .run(criptografar(senha), cert.titular, cert.validade, loja.id);
    res.json({ ok: true, titular: cert.titular, validade: cert.validade });
  } catch (e) { next(e); }
});

/** Lista campos fiscais de todos os produtos de uma loja. */
router.get('/lojas/:id/fiscal/produtos', exigirSuperAdmin, async (req, res, next) => {
  try {
    const loja = await db.prepare('SELECT id FROM lojas WHERE id = ?').get(req.params.id) as { id: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');
    const produtos = await db.prepare(
      `SELECT id, nome, categoria, ncm, cfop, csosn, origem, unidade_comercial, cest
         FROM produtos WHERE loja_id = ? AND excluido = 0 ORDER BY categoria, nome`
    ).all(loja.id);
    res.json({ produtos });
  } catch (e) { next(e); }
});

/** Atualiza campos fiscais de um produto de uma loja. */
router.put('/lojas/:id/fiscal/produtos/:prodId', exigirSuperAdmin, async (req, res, next) => {
  try {
    const loja = await db.prepare('SELECT id FROM lojas WHERE id = ?').get(req.params.id) as { id: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');
    const prod = await db.prepare('SELECT id FROM produtos WHERE id = ? AND loja_id = ?').get(req.params.prodId, loja.id) as { id: number } | undefined;
    if (!prod) throw erroHttp(404, 'Produto não encontrado.');
    const txt = (v: unknown, n: number) => textoLimpo(v, n);
    await db.prepare(
      `UPDATE produtos SET ncm = ?, cfop = ?, csosn = ?, origem = ?, unidade_comercial = ?, cest = ? WHERE id = ?`
    ).run(
      txt(req.body.ncm, 8).replace(/\D/g, ''),
      txt(req.body.cfop, 4).replace(/\D/g, ''),
      txt(req.body.csosn, 3).replace(/\D/g, ''),
      txt(req.body.origem, 1),
      txt(req.body.unidade_comercial, 6).toUpperCase() || 'UN',
      txt(req.body.cest, 7).replace(/\D/g, ''),
      prod.id,
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Exporta os repasses do período em CSV (abre direto no Excel/Sheets). */
router.get('/repasses/csv', async (req, res, next) => {
  try {
    const rodar = async () => {
      const { sql, params } = consultaRepasses(req);
      return db.prepare(sql).all(...params);
    };
    const agregado = await agregarClientes(req, rodar);
    const linhas = (agregado
      ? agregado.sort((a: any, b: any) => Number(b.faturamento_centavos) - Number(a.faturamento_centavos))
      : await rodar()) as Array<{
        loja_nome: string; pedidos: number; faturamento_centavos: number;
        comissao_centavos: number; repasse_centavos: number; tenant_nome?: string;
      }>;
    const reais = (c: number) => (Number(c) / 100).toFixed(2).replace('.', ',');
    const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const cabecalho = [
      ...(agregado ? ['Cliente da plataforma'] : []),
      'Loja', 'Pedidos', 'Faturamento (R$)', 'Comissao (R$)', 'Repasse (R$)',
    ];
    const corpo = linhas.map(l => [
      ...(agregado ? [esc(l.tenant_nome)] : []),
      esc(l.loja_nome), l.pedidos, esc(reais(l.faturamento_centavos)), esc(reais(l.comissao_centavos)), esc(reais(l.repasse_centavos)),
    ].join(';'));
    const csv = '﻿' + [cabecalho.join(';'), ...corpo].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="repasses-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (e) { next(e); }
});

// ----- Entregadores (visão da plataforma) ----------------------------------

/** Lista entregadores com métricas de entregas concluídas. */
router.get('/entregadores', async (req, res, next) => {
  try {
    const rodar = async () => db.prepare(
      `SELECT u.id, u.nome, u.email, u.telefone, u.bloqueado, u.criado_em,
              COALESCE(e.entregas, 0) AS entregas,
              COALESCE(e.ativas, 0)   AS ativas
         FROM usuarios u
         LEFT JOIN (
           SELECT entregador_id,
                  SUM(CASE WHEN status = 'entregue'   THEN 1 ELSE 0 END) AS entregas,
                  SUM(CASE WHEN status = 'em_entrega' THEN 1 ELSE 0 END) AS ativas
             FROM pedidos WHERE entregador_id IS NOT NULL GROUP BY entregador_id
         ) e ON e.entregador_id = u.id
        WHERE u.perfil = 'entregador'
        ORDER BY u.nome`
    ).all();
    const agregado = await agregarClientes(req, rodar);
    const entregadores = agregado
      ? agregado.sort((a: any, b: any) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'))
      : await rodar();
    res.json({ entregadores });
  } catch (e) { next(e); }
});

// ----- Monitor ao vivo (pedidos em andamento de todas as lojas) ------------

router.get('/monitor', async (req, res, next) => {
  try {
    const rodar = async () => db.prepare(
      `SELECT p.id, p.status, p.total_centavos, p.criado_em, p.origem,
              l.nome AS loja_nome,
              c.nome AS cliente_nome,
              e.nome AS entregador_nome
         FROM pedidos p
         JOIN lojas l    ON l.id = p.loja_id
         JOIN usuarios c ON c.id = p.cliente_id
         LEFT JOIN usuarios e ON e.id = p.entregador_id
        WHERE p.status IN ('pendente','aceito','preparando','pronto','em_entrega')
          AND p.origem = 'app'
        ORDER BY p.criado_em ASC`
    ).all();
    // Mais antigo primeiro — a coluna é uma fila de espera, e o que está
    // parado há mais tempo é o que precisa de atenção.
    const agregado = await agregarClientes(req, rodar);
    const pedidos = agregado
      ? agregado.sort((a: any, b: any) => String(a.criado_em).localeCompare(String(b.criado_em)))
      : await rodar();
    res.json({ pedidos });
  } catch (e) { next(e); }
});

// ----- Marca / White label da plataforma -----------------------------------

router.get('/tema', async (_req, res, next) => {
  try {
    const valor = async (chave: string, padrao = ''): Promise<string> => {
      const r = await db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave) as { valor: string } | undefined;
      return r?.valor ?? padrao;
    };
    res.json({
      nome:              await valor('marca_nome', 'Delivery Já'),
      slogan:            await valor('marca_slogan', 'Peça das melhores lojas da sua região'),
      logo_url:          await valor('marca_logo_url'),
      favicon_url:       await valor('marca_favicon_url'),
      cor_primaria:      await valor('marca_cor_primaria', '#dc2640'),
      cor_secundaria:    await valor('marca_cor_secundaria'),
      raio:              await valor('marca_raio', 'suave'),
      fonte:             await valor('marca_fonte', 'inter'),
      descricao:         await valor('marca_descricao'),
      og_image:          await valor('marca_og_image'),
      login_banner_url:  await valor('marca_login_banner_url'),
      loja_id:           Number(await valor('loja_padrao_id', '0')),
    });
  } catch (e) { next(e); }
});

/** PUT /api/admin/tema — só o super admin edita a marca da plataforma. */
router.put('/tema', exigirSuperAdmin, async (req, res, next) => {
  try {
    // Upsert: as chaves padrão só existem depois de rodar o provisionamento de tenant
    // (inicializarSchema) — um UPDATE puro falha silenciosamente (0 linhas afetadas)
    // se a chave nunca foi criada, então sempre criamos a linha se faltar.
    const set = (valor: string, chave: string) =>
      db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)')
        .run(chave, valor);

    const nome = textoLimpo(req.body.nome, 60);
    if (req.body.nome !== undefined && nome.length < 2) throw erroHttp(400, 'Informe um nome de marca.');
    if (req.body.nome !== undefined) await set(nome, 'marca_nome');

    if (req.body.slogan !== undefined) await set(textoLimpo(req.body.slogan, 120), 'marca_slogan');

    if (req.body.logo_url !== undefined) {
      const v = textoLimpo(req.body.logo_url, 500);
      if (v && !/^https?:\/\//i.test(v) && !v.startsWith('/uploads/')) throw erroHttp(400, 'URL do logo inválida (use https://… ou faça upload).');
      await set(v, 'marca_logo_url');
    }
    if (req.body.favicon_url !== undefined) {
      const v = textoLimpo(req.body.favicon_url, 500);
      if (v && !/^https?:\/\//i.test(v) && !v.startsWith('/uploads/')) throw erroHttp(400, 'URL do favicon inválida (use https://… ou faça upload).');
      await set(v, 'marca_favicon_url');
    }
    if (req.body.login_banner_url !== undefined) {
      const v = textoLimpo(req.body.login_banner_url, 500);
      if (v && !/^https?:\/\//i.test(v) && !v.startsWith('/uploads/')) throw erroHttp(400, 'URL do banner de login inválida (use https://… ou faça upload).');
      // upsert: a chave pode não existir em bancos antigos criados antes deste campo.
      await db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)')
        .run('marca_login_banner_url', v);
    }
    if (req.body.cor_primaria !== undefined) {
      const cor = textoLimpo(req.body.cor_primaria, 20);
      if (!/^#[0-9a-fA-F]{6}$/.test(cor)) throw erroHttp(400, 'Use uma cor em formato hexadecimal (#RRGGBB).');
      await set(cor, 'marca_cor_primaria');
    }
    // Os 5 campos abaixo já eram editáveis na tela de Marca e já eram aplicados
    // pelo frontend (lib/tema.ts), mas não eram persistidos aqui — o admin
    // salvava e o valor sumia. Listas de valores aceitos espelham RaioMarca /
    // FonteMarca em frontend/src/types.ts.
    if (req.body.cor_secundaria !== undefined) {
      const cor = textoLimpo(req.body.cor_secundaria, 20);
      // Vazio é válido: significa "derivar da primária" (ver aplicarPaleta).
      if (cor && !/^#[0-9a-fA-F]{6}$/.test(cor)) throw erroHttp(400, 'Cor secundária inválida (use #RRGGBB ou deixe vazio).');
      await set(cor, 'marca_cor_secundaria');
    }
    if (req.body.raio !== undefined) {
      const v = textoLimpo(req.body.raio, 20);
      if (!['reto', 'suave', 'redondo'].includes(v)) throw erroHttp(400, 'Estilo de cantos inválido.');
      await set(v, 'marca_raio');
    }
    if (req.body.fonte !== undefined) {
      const v = textoLimpo(req.body.fonte, 20);
      if (!['inter', 'poppins', 'montserrat', 'roboto', 'sistema'].includes(v)) throw erroHttp(400, 'Fonte inválida.');
      await set(v, 'marca_fonte');
    }
    if (req.body.descricao !== undefined) {
      await set(textoLimpo(req.body.descricao, 200), 'marca_descricao');
    }
    if (req.body.og_image !== undefined) {
      const v = textoLimpo(req.body.og_image, 500);
      if (v && !/^https?:\/\//i.test(v) && !v.startsWith('/uploads/')) throw erroHttp(400, 'URL da imagem de compartilhamento inválida (use https://… ou faça upload).');
      await set(v, 'marca_og_image');
    }
    if (req.body.loja_id !== undefined) {
      const id = parseInt(String(req.body.loja_id), 10);
      if (isNaN(id) || id < 0) throw erroHttp(400, 'ID de loja inválido.');
      await set(String(id), 'loja_padrao_id');
    }
    await registrarAuditoria(req, 'marca.editar');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Configurações gerais da plataforma (contato de suporte, termos) -----

router.get('/configuracoes-gerais', async (_req, res, next) => {
  try {
    const valor = async (chave: string): Promise<string> => {
      const r = await db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave) as { valor: string } | undefined;
      return r?.valor ?? '';
    };
    const valorCentral = async (chave: string): Promise<string> => {
      if (!BANCO_CENTRAL) return '';
      const [rows] = await abrirPool(BANCO_CENTRAL).query('SELECT valor FROM configuracoes WHERE chave = ?', [chave]);
      return (rows as { valor: string }[])[0]?.valor ?? '';
    };
    // Token nunca volta em texto puro — só os últimos 8 caracteres, pra confirmar
    // visualmente qual token está salvo sem expor o segredo inteiro.
    const mascararTokenCentral = async (chave: string): Promise<string | null> => {
      const cifrado = await valorCentral(chave);
      if (!cifrado) return null;
      try { return '****' + descriptografar(cifrado).slice(-8); } catch { return null; }
    };
    const modoMP = await valorCentral('mercadopago_modo');
    res.json({
      suporte_email:    await valor('suporte_email'),
      suporte_telefone: await valor('suporte_telefone'),
      termos_url:       await valor('termos_url'),
      wbapi_server:      await valorCentral('wbapi_server'),
      wbapi_session_id:  await valorCentral('wbapi_session_id'),
      // A chave nunca é devolvida — só se está configurada ou não (mesmo padrão do token oficial da Meta).
      wbapi_configurado: !!(await valorCentral('wbapi_api_key')),
      mercadopago_modo: modoMP === 'teste' ? 'teste' : 'producao',
      mercadopago_token_teste_mascarado:    await mascararTokenCentral('mercadopago_token_teste'),
      mercadopago_token_producao_mascarado: await mascararTokenCentral('mercadopago_token_producao'),
    });
  } catch (e) { next(e); }
});

router.put('/configuracoes-gerais', exigirSuperAdmin, async (req, res, next) => {
  try {
    const upsert = (chave: string, valor: string) =>
      db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)')
        .run(chave, valor);
    const upsertCentral = (chave: string, valor: string) => {
      if (!BANCO_CENTRAL) throw erroHttp(500, 'MYSQL_DATABASE_CENTRAL não configurado.');
      return abrirPool(BANCO_CENTRAL).query(
        'INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)',
        [chave, valor],
      );
    };

    if (req.body.suporte_email !== undefined) {
      const v = textoLimpo(req.body.suporte_email, 200);
      if (v && !emailValido(v)) throw erroHttp(400, 'E-mail de suporte inválido.');
      await upsert('suporte_email', v);
    }
    if (req.body.suporte_telefone !== undefined) {
      await upsert('suporte_telefone', textoLimpo(req.body.suporte_telefone, 30));
    }
    if (req.body.termos_url !== undefined) {
      const v = textoLimpo(req.body.termos_url, 500);
      if (v && !/^https?:\/\//i.test(v)) throw erroHttp(400, 'URL dos termos de uso inválida (use https://…).');
      await upsert('termos_url', v);
    }
    if (req.body.wbapi_server !== undefined) {
      const v = textoLimpo(req.body.wbapi_server, 300);
      if (v && !/^https?:\/\//i.test(v)) throw erroHttp(400, 'URL do servidor WBAPI inválida (use https://…).');
      await upsertCentral('wbapi_server', v);
    }
    if (req.body.wbapi_session_id !== undefined) {
      await upsertCentral('wbapi_session_id', textoLimpo(req.body.wbapi_session_id, 100));
    }
    // Só re-criptografa e salva se veio um valor novo não-vazio — campo em branco no form significa "não mexer".
    if (typeof req.body.wbapi_api_key === 'string' && req.body.wbapi_api_key.trim()) {
      /*
       * TIRA O RÓTULO COLADO JUNTO. Aconteceu de verdade: a chave foi salva como
       * "X-Api-Key j9871RVMA14c7aCC0" porque quem copiou pegou a linha inteira da
       * mensagem do fornecedor. O header saía "X-Api-Key: X-Api-Key j987..." e
       * toda chamada dava 401 — sem nada na tela indicando o motivo.
       *
       * Limpar aqui é melhor que avisar: ninguém olha um campo de senha, e o
       * erro só aparecia horas depois, na primeira mensagem que não saiu.
       */
      const chaveLimpa = req.body.wbapi_api_key
        .trim()
        .replace(/^x-api-key\s*[:=]?\s*/i, '')
        .trim();
      await upsertCentral('wbapi_api_key', criptografar(chaveLimpa));
    }
    if (req.body.mercadopago_modo !== undefined) {
      if (req.body.mercadopago_modo !== 'teste' && req.body.mercadopago_modo !== 'producao') {
        throw erroHttp(400, 'Modo do Mercado Pago inválido (use "teste" ou "producao").');
      }
      await upsertCentral('mercadopago_modo', req.body.mercadopago_modo);
    }
    if (typeof req.body.mercadopago_token_teste === 'string' && req.body.mercadopago_token_teste.trim()) {
      const v = req.body.mercadopago_token_teste.trim();
      if (!v.startsWith('TEST-')) throw erroHttp(400, 'O token de teste deve começar com TEST-.');
      await upsertCentral('mercadopago_token_teste', criptografar(v));
    }
    if (typeof req.body.mercadopago_token_producao === 'string' && req.body.mercadopago_token_producao.trim()) {
      const v = req.body.mercadopago_token_producao.trim();
      if (!v.startsWith('APP_USR-')) throw erroHttp(400, 'O token de produção deve começar com APP_USR-.');
      await upsertCentral('mercadopago_token_producao', criptografar(v));
    }
    await registrarAuditoria(req, 'configuracoes.editar');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Landing page do produto (domínio principal, sem loja padrão) -----
//
// A lista de campos, os defaults e as validações vivem em ../landing-campos —
// fonte ÚNICA compartilhada com o GET /api/tema (rotas/publico.ts). Campo novo
// se declara lá e passa a funcionar nos três caminhos sozinho.

const lerConfig = async (chave: string): Promise<string> => {
  const r = await db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave) as { valor: string } | undefined;
  return r?.valor ?? '';
};

const gravarConfig = (chave: string, valor: string) =>
  db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)')
    .run(chave, valor);

router.get('/landing', async (_req, res, next) => {
  try {
    res.json(await montarLandingAdmin(lerConfig));
  } catch (e) { next(e); }
});

router.put('/landing', exigirSuperAdmin, async (req, res, next) => {
  try {
    await salvarLanding(req.body ?? {}, gravarConfig);
    await registrarAuditoria(req, 'landing.editar');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- WhatsApp não-oficial (WBAPI) — sessão única compartilhada da plataforma ---

router.post('/whatsapp-nao-oficial/conectar', exigirSuperAdmin, async (req, res, next) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const inicio = await garantirSessaoPlataforma(baseUrl);
    if (!inicio.ok) throw erroHttp(400, inicio.erro || 'Falha ao iniciar a sessão do WhatsApp.');
    const qr = await obterQrPlataforma();
    if (!qr.ok) throw erroHttp(400, qr.erro || 'Falha ao obter o QR code.');
    res.json({ ok: true, qr: qr.qr });
  } catch (e) { next(e); }
});

router.post('/whatsapp-nao-oficial/codigo', exigirSuperAdmin, async (req, res, next) => {
  try {
    const telefone = textoLimpo(req.body.telefone, 20);
    if (!telefone.replace(/\D/g, '')) throw erroHttp(400, 'Informe o número do WhatsApp.');
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    await garantirSessaoPlataforma(baseUrl);
    const r = await solicitarCodigoPlataforma(telefone);
    if (!r.ok) throw erroHttp(400, r.erro || 'Falha ao solicitar o código.');
    res.json({ ok: true, codigo: r.codigo });
  } catch (e) { next(e); }
});

router.get('/whatsapp-nao-oficial/status', exigirSuperAdmin, async (_req, res, next) => {
  try {
    const r = await statusSessaoPlataforma();
    res.json({ status: r.conectado ? 'conectado' : 'desconectado', numero: r.numero || null });
  } catch (e) { next(e); }
});

router.post('/whatsapp-nao-oficial/desconectar', exigirSuperAdmin, async (_req, res, next) => {
  try {
    await desconectarPlataforma();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Backup ----------------------------------------------------------------

/** Roda um comando e resolve quando ele terminar com código 0, rejeita caso contrário. */
function rodar(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let erro = '';
    p.stderr.on('data', d => { erro += d.toString(); });
    p.on('error', reject);
    p.on('close', codigo => codigo === 0 ? resolve() : reject(new Error(erro || `${cmd} terminou com código ${codigo}`)));
  });
}

/**
 * Baixa um .tar.gz com backup completo: um dump SQL (`mysqldump`) de cada
 * banco MySQL — o central (registro de tenants) e o de cada tenant — mais a
 * pasta `dados/` do disco (uploads e certificados A1, que continuam sendo
 * arquivo mesmo depois da migração pro MySQL).
 *
 * Estratégia: monta um diretório temporário com os .sql + uma cópia de
 * `dados/`, empacota tudo com `tar` (streaming direto pra resposta) e limpa o
 * temporário no final. As credenciais do MySQL vão num arquivo temporário
 * `--defaults-extra-file` (não em argv/env), pra não aparecerem em `ps`.
 */
router.get('/backup', exigirSuperAdmin, async (req, res, next) => {
  const raiz = process.cwd();
  const tmpBase = path.join(os.tmpdir(), `backup-${Date.now()}-${process.pid}`);
  const cnfPath = `${tmpBase}.cnf`;
  try {
    exigirMaster();

    const host = process.env.MYSQL_HOST || '127.0.0.1';
    const porta = process.env.MYSQL_PORT || '3306';
    const usuario = process.env.MYSQL_USER || '';
    const senha = process.env.MYSQL_PASSWORD || '';
    if (!usuario) throw erroHttp(500, 'MYSQL_USER não configurado neste servidor.');

    const tenants = await listarTenants();
    const bancos = [...new Set(tenants.map(t => t.db_nome).filter(Boolean))];
    if (bancos.length === 0) throw erroHttp(404, 'Nenhum banco de tenant encontrado.');

    fs.mkdirSync(tmpBase, { recursive: true });
    fs.writeFileSync(cnfPath, `[client]\nhost=${host}\nport=${porta}\nuser=${usuario}\npassword=${senha}\n`, { mode: 0o600 });

    for (const nomeBanco of bancos) {
      const destino = path.join(tmpBase, `${nomeBanco}.sql`);
      await rodar('mysqldump', [
        `--defaults-extra-file=${cnfPath}`,
        '--single-transaction', '--routines', '--events', '--skip-lock-tables',
        '--result-file=' + destino,
        nomeBanco,
      ]);
    }

    const pastaDados = path.join(raiz, 'dados');
    if (fs.existsSync(pastaDados)) {
      fs.cpSync(pastaDados, path.join(tmpBase, 'dados'), { recursive: true });
    }

    await registrarAuditoria(req, 'backup.baixar', { detalhes: `${bancos.length} banco(s)` });

    const nomeArquivo = `backup-completo-${new Date().toISOString().slice(0, 10)}.tar.gz`;
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);

    const limpar = () => fs.rm(tmpBase, { recursive: true, force: true }, () => fs.rm(cnfPath, { force: true }, () => {}));

    const processo = spawn('tar', ['-czf', '-', '-C', path.dirname(tmpBase), path.basename(tmpBase)]);
    processo.stdout.pipe(res);
    processo.stderr.on('data', d => console.warn('[Backup] tar stderr:', d.toString()));
    processo.on('error', (e) => {
      console.error('[Backup] Falha ao iniciar o tar:', e);
      limpar();
      if (!res.headersSent) next(erroHttp(500, 'Não foi possível gerar o backup (tar indisponível no servidor).'));
    });
    processo.on('close', (codigo) => {
      limpar();
      if (codigo !== 0 && !res.headersSent) next(erroHttp(500, `tar terminou com código ${codigo}.`));
    });
  } catch (e) {
    fs.rm(tmpBase, { recursive: true, force: true }, () => fs.rm(cnfPath, { force: true }, () => {}));
    next(e instanceof ErroHttp ? e : erroHttp(500, e instanceof Error ? e.message : 'Falha ao gerar o backup (mysqldump indisponível?).'));
  }
});

// ----- Lojistas (visão drill-down do super admin) --------------------------

router.get('/lojistas', async (req, res, next) => {
  try {
    const rodar = async () => db.prepare(`
      SELECT l.id, l.nome AS loja_nome, l.status_aprovacao, l.aberta,
             l.logo_url, l.categoria, l.criado_em AS loja_criada_em,
             u.id AS usuario_id, u.nome AS dono_nome, u.email AS dono_email, u.telefone AS dono_telefone,
             u.bloqueado AS dono_bloqueado,
             (SELECT COUNT(*) FROM pedidos p WHERE p.loja_id = l.id AND p.status NOT IN ('cancelado','recusado')) AS total_pedidos,
             (SELECT COALESCE(SUM(p.total_centavos),0) FROM pedidos p WHERE p.loja_id = l.id AND p.status = 'entregue') AS faturamento_centavos,
             (SELECT COUNT(*) FROM usuarios c WHERE c.loja_id = l.id AND c.perfil = 'cliente') AS total_clientes
        FROM lojas l
        JOIN usuarios u ON u.id = l.usuario_id
       ORDER BY l.criado_em DESC`).all();
    const agregado = await agregarClientes(req, rodar);
    const lojistas = agregado
      ? agregado.sort((a: any, b: any) => String(b.loja_criada_em).localeCompare(String(a.loja_criada_em)))
      : await rodar();
    res.json({ lojistas });
  } catch (e) { next(e); }
});

router.get('/lojistas/:id/clientes', async (req, res, next) => {
  try {
    const loja = await db.prepare('SELECT id FROM lojas WHERE id = ?').get(req.params.id) as { id: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');
    const clientes = await db.prepare(`
      SELECT id, nome, email, telefone, bloqueado, criado_em
        FROM usuarios
       WHERE loja_id = ? AND perfil = 'cliente'
       ORDER BY criado_em DESC LIMIT 200`).all(loja.id);
    res.json({ clientes });
  } catch (e) { next(e); }
});

router.get('/lojistas/:id/pedidos', async (req, res, next) => {
  try {
    const loja = await db.prepare('SELECT id FROM lojas WHERE id = ?').get(req.params.id) as { id: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');
    const pedidos = await db.prepare(`
      SELECT p.id, p.status, p.total_centavos, p.criado_em,
             c.nome AS cliente_nome, c.email AS cliente_email
        FROM pedidos p
        JOIN usuarios c ON c.id = p.cliente_id
       WHERE p.loja_id = ?
       ORDER BY p.id DESC LIMIT 50`).all(loja.id);
    res.json({ pedidos });
  } catch (e) { next(e); }
});

// NOTA: a criação de lojista foi UNIFICADA em POST /lojas — o acesso do
// responsável é cadastrado sempre dentro da loja, garantindo o vínculo
// loja↔lojista. Não há mais criação avulsa de lojista (evita lojas-fantasma).

// ----- Produtos de uma loja (para seletor no form de banners) ---------------

router.get('/lojas/:id/produtos', async (req, res, next) => {
  try {
    const produtos = await db.prepare(
      `SELECT id, nome, categoria FROM produtos
        WHERE loja_id = ? AND excluido = 0
        ORDER BY categoria, nome`
    ).all(req.params.id);
    res.json({ produtos });
  } catch (e) { next(e); }
});

// ----- Banners do carrossel ------------------------------------------------

router.get('/banners', async (_req, res, next) => {
  try {
    const banners = await db.prepare(
      `SELECT b.*, l.nome AS loja_nome, p.nome AS produto_nome
         FROM banners b
         LEFT JOIN lojas l ON l.id = b.loja_id
         LEFT JOIN produtos p ON p.id = b.produto_id
        ORDER BY b.ordem, b.id`
    ).all();
    res.json({ banners });
  } catch (e) { next(e); }
});

router.post('/banners', async (req, res, next) => {
  try {
    const titulo = textoLimpo(req.body.titulo, 120);
    const imagem = textoLimpo(req.body.imagem, 500);
    if (titulo.length < 2) throw erroHttp(400, 'Informe um título descritivo.');
    if (!/^https?:\/\//i.test(imagem) && !imagem.startsWith('/uploads/')) throw erroHttp(400, 'Informe uma URL de imagem válida.');

    const info = await db.prepare(
      `INSERT INTO banners (titulo, subtitulo, imagem, loja_id, produto_id, link_url, ordem, ativo, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(titulo,
          textoLimpo(req.body.subtitulo ?? '', 200),
          imagem,
          inteiroPositivo(req.body.loja_id) || null,
          inteiroPositivo(req.body.produto_id) || null,
          textoLimpo(req.body.link_url, 500) || null,
          inteiroPositivo(req.body.ordem) || 0,
          req.body.ativo === 0 ? 0 : 1,
          agoraUTC());
    res.status(201).json({ banner_id: Number(info.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.put('/banners/:id', async (req, res, next) => {
  try {
    const banner = await db.prepare('SELECT * FROM banners WHERE id = ?')
      .get(req.params.id) as Banner | undefined;
    if (!banner) throw erroHttp(404, 'Banner não encontrado.');

    const titulo = req.body.titulo !== undefined ? textoLimpo(req.body.titulo, 120) : banner.titulo;
    if (titulo.length < 2) throw erroHttp(400, 'Título inválido.');

    let imagem = banner.imagem;
    if (req.body.imagem !== undefined) {
      imagem = textoLimpo(req.body.imagem, 500);
      if (!/^https?:\/\//i.test(imagem) && !imagem.startsWith('/uploads/')) throw erroHttp(400, 'URL de imagem inválida.');
    }

    await db.prepare(
      `UPDATE banners
          SET titulo = ?, subtitulo = ?, imagem = ?, loja_id = ?, produto_id = ?, link_url = ?, ordem = ?, ativo = ?
        WHERE id = ?`
    ).run(titulo,
          req.body.subtitulo !== undefined ? textoLimpo(req.body.subtitulo, 200) : (banner as any).subtitulo ?? '',
          imagem,
          req.body.loja_id !== undefined ? (inteiroPositivo(req.body.loja_id) || null) : banner.loja_id,
          req.body.produto_id !== undefined ? (inteiroPositivo(req.body.produto_id) || null) : (banner as any).produto_id ?? null,
          req.body.link_url !== undefined ? (textoLimpo(req.body.link_url, 500) || null) : banner.link_url,
          req.body.ordem !== undefined ? (inteiroPositivo(req.body.ordem) || 0) : banner.ordem,
          req.body.ativo !== undefined ? (req.body.ativo ? 1 : 0) : banner.ativo,
          banner.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/banners/:id', async (req, res, next) => {
  try {
    const info = await db.prepare('DELETE FROM banners WHERE id = ?').run(req.params.id);
    if (info.changes === 0) throw erroHttp(404, 'Banner não encontrado.');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Tenants (clientes do SaaS — multi-tenant SILO) ---------------------
// Só o tenant MASTER (banco padrão) gerencia os outros, e apenas super admin.

/** Garante que a requisição veio do painel principal (tenant master). */
function exigirMaster(): void {
  if (!ehMaster(bancoTenantAtual())) {
    throw erroHttp(403, 'Apenas o painel principal gerencia os clientes.');
  }
}

/**
 * Deriva o nome do banco MySQL do tenant a partir do slug (sanitizado).
 * O prefixo padrão ('tenant_') precisa bater com o GRANT feito pro usuário
 * do app no servidor (CREATE/DROP escopado a `tenant\_%`) — é o que permite
 * criarTenant() provisionar o banco sozinho (ver tenants-mysql.ts).
 */
function dbNomeDoTenant(slug: string): string {
  const prefixo = process.env.MYSQL_TENANT_PREFIX || 'tenant_';
  return `${prefixo}${slug.replace(/-/g, '_')}`;
}

/**
 * Exclui um cliente — apaga o registro e o banco dele.
 *
 * A confirmação (digitar o slug) é exigida AQUI também, não só na tela: a
 * proteção que só existe no frontend não protege de um clique errado em outro
 * lugar do sistema, nem de uma requisição repetida por engano.
 */
router.delete('/tenants/:id', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const id = inteiroPositivo(req.params.id);
    if (!id) throw erroHttp(400, 'Cliente inválido.');
    const tenant = await tenantPorId(id);
    if (!tenant) throw erroHttp(404, 'Cliente não encontrado.');

    const confirmacao = textoLimpo(req.query.confirmacao ?? req.body?.confirmacao, 60);
    if (confirmacao !== tenant.slug) {
      throw erroHttp(400, `Confirmação incorreta: digite o identificador "${tenant.slug}" para excluir.`);
    }

    let resultado;
    try {
      resultado = await removerTenant(id);
    } catch (e) {
      throw erroHttp(409, e instanceof Error ? e.message : 'Não foi possível excluir o cliente.');
    }

    // Auditoria ANTES da resposta: se o registro do que foi apagado se perder,
    // não sobra rastro de quem apagou o quê — e o dado já não existe mais.
    await registrarAuditoria(req, 'cliente.excluir', {
      alvoTipo: 'tenant', alvoId: id,
      alvoDesc: `${resultado.nome} (${tenant.slug})${resultado.bancoApagado ? ' — banco apagado' : ' — banco preservado'}`,
    });
    res.json({ ok: true, banco_apagado: resultado.bancoApagado });
  } catch (e) { next(e); }
});

/* ───────────────────── Módulos adicionais (cobrança) ─────────────────────
 *
 * COBRANÇA, não permissão. Ligar um módulo num cliente soma na conta do
 * revendedor; não habilita nem bloqueia nada no painel do lojista.
 */

router.get('/modulos', exigirSuperAdmin, async (_req, res, next) => {
  try {
    exigirMaster();
    const [linhas] = await poolCentral().query(
      `SELECT m.*, (SELECT COUNT(*) FROM modulos_cliente mc WHERE mc.modulo_id = m.id) AS clientes
         FROM modulos m ORDER BY m.nome`,
    );
    res.json({ modulos: linhas });
  } catch (e) { next(e); }
});

router.post('/modulos', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const nome = textoLimpo(req.body.nome, 80);
    if (nome.length < 2) throw erroHttp(400, 'Informe o nome do módulo.');
    const [r] = await poolCentral().query(
      'INSERT INTO modulos (nome, descricao, preco_centavos, criado_em) VALUES (?, ?, ?, ?)',
      [nome, textoLimpo(req.body.descricao || '', 200), reaisParaCentavos(req.body.preco ?? 0) || 0, agoraUTC()],
    ) as unknown as [{ insertId: number }];
    await registrarAuditoria(req, 'modulo.criar', { alvoTipo: 'modulo', alvoId: Number(r.insertId), alvoDesc: nome });
    res.status(201).json({ id: Number(r.insertId) });
  } catch (e) { next(e); }
});

router.put('/modulos/:id', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const nome = textoLimpo(req.body.nome, 80);
    if (nome.length < 2) throw erroHttp(400, 'Informe o nome do módulo.');
    /*
     * Reajuste vale só pros PRÓXIMOS. Os clientes que já têm o módulo mantêm o
     * preço copiado no momento em que foi ligado — senão um reajuste mudaria
     * retroativamente o que já foi combinado, e a conta do mês passado deixaria
     * de bater com o que foi cobrado.
     */
    const [r] = await poolCentral().query(
      'UPDATE modulos SET nome = ?, descricao = ?, preco_centavos = ? WHERE id = ?',
      [nome, textoLimpo(req.body.descricao || '', 200), reaisParaCentavos(req.body.preco ?? 0) || 0, req.params.id],
    ) as unknown as [{ affectedRows: number }];
    if (r.affectedRows === 0) throw erroHttp(404, 'Módulo não encontrado.');
    await registrarAuditoria(req, 'modulo.editar', { alvoTipo: 'modulo', alvoId: Number(req.params.id), alvoDesc: nome });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/modulos/:id', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const pool = poolCentral();
    // Some das contas futuras junto: deixar o vínculo órfão faria a conta somar
    // um módulo que não existe mais, sem nome pra mostrar na linha.
    await pool.query('DELETE FROM modulos_cliente WHERE modulo_id = ?', [req.params.id]);
    const [r] = await pool.query('DELETE FROM modulos WHERE id = ?', [req.params.id]) as unknown as [{ affectedRows: number }];
    if (r.affectedRows === 0) throw erroHttp(404, 'Módulo não encontrado.');
    await registrarAuditoria(req, 'modulo.remover', { alvoTipo: 'modulo', alvoId: Number(req.params.id), alvoDesc: '' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Módulos ligados num cliente. */
router.get('/tenants/:id/modulos', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const [linhas] = await poolCentral().query(
      `SELECT mc.modulo_id, mc.preco_centavos, m.nome
         FROM modulos_cliente mc JOIN modulos m ON m.id = mc.modulo_id
        WHERE mc.tenant_id = ? ORDER BY m.nome`,
      [req.params.id],
    );
    res.json({ modulos: linhas });
  } catch (e) { next(e); }
});

/** Liga ou desliga um módulo num cliente. */
router.put('/tenants/:id/modulos/:moduloId', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const pool = poolCentral();
    const ligar = !!req.body.ligado;
    if (!ligar) {
      await pool.query('DELETE FROM modulos_cliente WHERE tenant_id = ? AND modulo_id = ?', [req.params.id, req.params.moduloId]);
      await registrarAuditoria(req, 'modulo.desligar', { alvoTipo: 'tenant', alvoId: Number(req.params.id), alvoDesc: String(req.params.moduloId) });
      return res.json({ ok: true, ligado: false });
    }
    const [mods] = await pool.query('SELECT preco_centavos FROM modulos WHERE id = ?', [req.params.moduloId]) as unknown as [Array<{ preco_centavos: number }>];
    if (!mods[0]) throw erroHttp(404, 'Módulo não encontrado.');
    // Preço COPIADO agora — ver comentário do reajuste acima.
    await pool.query(
      `INSERT INTO modulos_cliente (tenant_id, modulo_id, preco_centavos, criado_em) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE preco_centavos = VALUES(preco_centavos)`,
      [req.params.id, req.params.moduloId, mods[0].preco_centavos, agoraUTC()],
    );
    await registrarAuditoria(req, 'modulo.ligar', { alvoTipo: 'tenant', alvoId: Number(req.params.id), alvoDesc: String(req.params.moduloId) });
    res.json({ ok: true, ligado: true });
  } catch (e) { next(e); }
});

/* ────────────── Solicitações de cliente (fila do revendedor) ────────────── */

/** Fila de solicitações. Pendentes primeiro — é o que exige ação. */
router.get('/solicitacoes', exigirSuperAdmin, async (_req, res, next) => {
  try {
    exigirMaster();
    const [linhas] = await poolCentral().query(
      `SELECT s.*, r.nome AS revendedor_nome
         FROM solicitacoes_cliente s
         LEFT JOIN revendedores r ON r.id = s.revendedor_id
        ORDER BY (s.status = 'pendente') DESC, s.id DESC`,
    );
    // A senha em hash não sai daqui: ninguém precisa dela na tela, e mandar
    // hash pro navegador é oferecer material pra quebrar offline.
    const solicitacoes = (linhas as Array<Record<string, unknown>>).map(({ senha_hash, ...resto }) => resto);
    res.json({ solicitacoes });
  } catch (e) { next(e); }
});

/**
 * Aprova: provisiona o cliente AGORA, já vinculado ao revendedor que pediu.
 *
 * Reusa `provisionarCliente` — a mesma função da criação manual. Duas formas de
 * nascer cliente dariam duas chances de esquecer o slug ou a loja padrão.
 */
router.post('/solicitacoes/:id/aprovar', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const pool = poolCentral();
    const [linhas] = await pool.query('SELECT * FROM solicitacoes_cliente WHERE id = ?', [req.params.id]) as unknown as [Array<Record<string, any>>];
    const s = linhas[0];
    if (!s) throw erroHttp(404, 'Solicitação não encontrada.');
    if (s.status !== 'pendente') throw erroHttp(409, `Esta solicitação já foi ${s.status}.`);

    const { tenant, lojaId } = await provisionarCliente({
      nome: s.nome, slug: s.slug, dominio: null,
      nomeLoja: s.nome_loja, categoria: s.categoria,
      nomeDono: s.dono_nome, email: s.dono_email, telefone: s.dono_telefone,
      senhaHash: s.senha_hash,
      revendedorId: s.revendedor_id,
    });

    await pool.query(
      "UPDATE solicitacoes_cliente SET status = 'aprovada', tenant_id = ?, decidido_em = ? WHERE id = ?",
      [tenant.id, agoraUTC(), s.id],
    );
    await registrarAuditoria(req, 'solicitacao.aprovar', { alvoTipo: 'tenant', alvoId: tenant.id, alvoDesc: `${s.nome} (${s.slug})` });
    res.json({ ok: true, tenant, loja_id: lojaId });
  } catch (e) { next(e); }
});

/** Recusa com motivo. Nada foi provisionado, então não há o que desfazer. */
router.post('/solicitacoes/:id/recusar', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    // Motivo OBRIGATÓRIO: recusa sem explicação faz o revendedor reenviar o
    // mesmo pedido, e a fila vira um ciclo.
    const motivo = textoLimpo(req.body.motivo, 300);
    if (motivo.length < 3) throw erroHttp(400, 'Escreva o motivo da recusa — o revendedor vai ler.');

    const pool = poolCentral();
    const [r] = await pool.query(
      "UPDATE solicitacoes_cliente SET status = 'recusada', motivo_recusa = ?, decidido_em = ? WHERE id = ? AND status = 'pendente'",
      [motivo, agoraUTC(), req.params.id],
    ) as unknown as [{ affectedRows: number }];
    if (r.affectedRows === 0) throw erroHttp(409, 'Solicitação não encontrada ou já decidida.');
    await registrarAuditoria(req, 'solicitacao.recusar', { alvoTipo: 'solicitacao', alvoId: Number(req.params.id), alvoDesc: motivo });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ───────────────────────── Revendedores ─────────────────────────
 *
 * Quem traz clientes e cobra deles por fora. Moram no banco CENTRAL, junto de
 * `tenants`: um revendedor atravessa vários clientes, e guardá-lo no banco de
 * um deles seria escolher um dono arbitrário.
 */

/** Lista revendedores com quantos clientes cada um tem. */
router.get('/revendedores', exigirSuperAdmin, async (_req, res, next) => {
  try {
    exigirMaster();
    const pool = poolCentral();
    const [linhas] = await pool.query(
      `SELECT r.id, r.nome, r.email, r.telefone, r.documento, r.custo_centavos,
              r.ativo, r.bloqueado, r.criado_em,
              (SELECT COUNT(*) FROM tenants t WHERE t.revendedor_id = r.id) AS clientes
         FROM revendedores r
        ORDER BY r.nome`,
    ) as unknown as [Array<Record<string, unknown>>];

    /*
     * A conta sai do módulo testado (conta-revendedor.ts), não de um SUM na
     * consulta: a regra "cliente suspenso não paga nada, nem módulo" precisa
     * ser a MESMA aqui e no painel do revendedor. Duas somas separadas divergem
     * no dia em que uma delas esquecer o `ativo`.
     */
    const [vinculos] = await pool.query(
      `SELECT t.revendedor_id, t.id AS tenant_id, t.ativo,
              COALESCE(SUM(mc.preco_centavos), 0) AS modulos_centavos
         FROM tenants t
         LEFT JOIN modulos_cliente mc ON mc.tenant_id = t.id
        WHERE t.revendedor_id IS NOT NULL
        GROUP BY t.revendedor_id, t.id, t.ativo`,
    ) as unknown as [Array<{ revendedor_id: number; ativo: number; modulos_centavos: number }>];

    const porRevendedor = new Map<number, ClienteNaConta[]>();
    for (const v of vinculos) {
      const lista = porRevendedor.get(v.revendedor_id) ?? [];
      lista.push({ ativo: !!v.ativo, modulos: [Number(v.modulos_centavos) || 0] });
      porRevendedor.set(v.revendedor_id, lista);
    }

    const revendedores = linhas.map(r => ({
      ...r,
      ...contaDoMes(Number(r.custo_centavos) || 0, porRevendedor.get(Number(r.id)) ?? []),
    }));
    res.json({ revendedores });
  } catch (e) { next(e); }
});

router.post('/revendedores', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const nome = textoLimpo(req.body.nome, 120);
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (nome.length < 2) throw erroHttp(400, 'Informe o nome do revendedor.');
    if (!emailValido(email)) throw erroHttp(400, 'E-mail inválido.');
    if (senha.length < 6) throw erroHttp(400, 'Senha: mínimo 6 caracteres.');

    const pool = poolCentral();
    try {
      const [r] = await pool.query(
        `INSERT INTO revendedores (nome, email, senha_hash, telefone, documento, custo_centavos, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nome, email, bcrypt.hashSync(senha, 10), textoLimpo(req.body.telefone || '', 30),
         textoLimpo(req.body.documento || '', 20).replace(/\D/g, ''),
         reaisParaCentavos(req.body.custo ?? 0) || 0, agoraUTC()],
      );
      await registrarAuditoria(req, 'revendedor.criar', { alvoTipo: 'revendedor', alvoId: Number((r as { insertId: number }).insertId), alvoDesc: nome });
      res.status(201).json({ id: Number((r as { insertId: number }).insertId) });
    } catch (e) {
      // E-mail é UNIQUE: sem esta mensagem o admin via um erro cru de banco.
      if (e instanceof Error && /Duplicate/i.test(e.message)) throw erroHttp(409, 'Já existe um revendedor com esse e-mail.');
      throw e;
    }
  } catch (e) { next(e); }
});

router.put('/revendedores/:id', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const pool = poolCentral();
    const [atualRows] = await pool.query('SELECT * FROM revendedores WHERE id = ?', [req.params.id]);
    const atual = (atualRows as Array<Record<string, unknown>>)[0];
    if (!atual) throw erroHttp(404, 'Revendedor não encontrado.');

    const nome = req.body.nome !== undefined ? textoLimpo(req.body.nome, 120) : String(atual.nome);
    if (nome.length < 2) throw erroHttp(400, 'Informe o nome do revendedor.');
    const telefone = req.body.telefone !== undefined ? textoLimpo(req.body.telefone, 30) : String(atual.telefone);
    const documento = req.body.documento !== undefined ? textoLimpo(req.body.documento, 20).replace(/\D/g, '') : String(atual.documento);
    const custo = req.body.custo !== undefined ? (reaisParaCentavos(req.body.custo) || 0) : Number(atual.custo_centavos);
    const bloqueado = req.body.bloqueado !== undefined ? (req.body.bloqueado ? 1 : 0) : Number(atual.bloqueado);

    await pool.query(
      'UPDATE revendedores SET nome = ?, telefone = ?, documento = ?, custo_centavos = ?, bloqueado = ? WHERE id = ?',
      [nome, telefone, documento, custo, bloqueado, req.params.id],
    );

    // Senha só muda quando vem no corpo — campo vazio no formulário não pode
    // virar uma senha em branco.
    if (typeof req.body.senha === 'string' && req.body.senha.length > 0) {
      if (req.body.senha.length < 6) throw erroHttp(400, 'Senha: mínimo 6 caracteres.');
      await pool.query('UPDATE revendedores SET senha_hash = ? WHERE id = ?', [bcrypt.hashSync(req.body.senha, 10), req.params.id]);
    }
    await registrarAuditoria(req, 'revendedor.editar', { alvoTipo: 'revendedor', alvoId: Number(req.params.id), alvoDesc: nome });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/revendedores/:id', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const pool = poolCentral();
    /*
     * Remover o revendedor SOLTA os clientes dele, não os apaga.
     * São lojas atendendo gente; o vínculo comercial acabou, a operação não.
     */
    await pool.query('UPDATE tenants SET revendedor_id = NULL WHERE revendedor_id = ?', [req.params.id]);
    const [r] = await pool.query('DELETE FROM revendedores WHERE id = ?', [req.params.id]);
    if ((r as { affectedRows: number }).affectedRows === 0) throw erroHttp(404, 'Revendedor não encontrado.');
    await registrarAuditoria(req, 'revendedor.remover', { alvoTipo: 'revendedor', alvoId: Number(req.params.id), alvoDesc: '' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Vincula (ou desvincula, com revendedor_id null) um cliente a um revendedor. */
router.put('/tenants/:id/revendedor', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const revendedorId = req.body.revendedor_id ? inteiroPositivo(req.body.revendedor_id) : null;
    const pool = poolCentral();
    if (revendedorId) {
      const [existe] = await pool.query('SELECT id FROM revendedores WHERE id = ?', [revendedorId]);
      if ((existe as unknown[]).length === 0) throw erroHttp(404, 'Revendedor não encontrado.');
    }
    const [r] = await pool.query('UPDATE tenants SET revendedor_id = ? WHERE id = ?', [revendedorId, req.params.id]);
    if ((r as { affectedRows: number }).affectedRows === 0) throw erroHttp(404, 'Cliente não encontrado.');
    await registrarAuditoria(req, 'cliente.revendedor', { alvoTipo: 'tenant', alvoId: Number(req.params.id), alvoDesc: String(revendedorId ?? 'sem revendedor') });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Lista os tenants com nº de lojas de cada um. */
router.get('/tenants', exigirSuperAdmin, async (_req, res, next) => {
  try {
    exigirMaster();
    const todos = await listarTenants();
    // Nome do revendedor junto: a lista mostra `revendedor_id`, e um número não
    // diz nada pra quem está olhando a tela.
    const [revs] = await poolCentral().query('SELECT id, nome FROM revendedores') as any;
    const nomeRev = new Map<number, string>((revs as Array<{ id: number; nome: string }>).map(r => [r.id, r.nome]));
    const tenants = await Promise.all(todos.map(async (t) => {
      let lojas = 0;
      try {
        const pool = abrirPool(t.db_nome);
        const [rows] = await pool.query('SELECT COUNT(*) AS n FROM lojas') as any;
        lojas = rows[0]?.n ?? 0;
      } catch { /* banco ainda não acessível */ }
      // `url` calculada aqui e não no frontend: a regra (domínio próprio, senão
      // subdomínio sob DOMINIO_BASE) vive em `urlDoTenant`, e DOMINIO_BASE é
      // variável de servidor — o painel não tem como saber. Sem isto, quem cadastra
      // um cliente sem domínio próprio não descobre qual endereço mandar pra ele.
      return { ...t, lojas, url: urlDoTenant(t), revendedor_nome: t.revendedor_id ? (nomeRev.get(t.revendedor_id) || '') : '' };
    }));
    res.json({ tenants });
  } catch (e) { next(e); }
});

/**
 * Cria um cliente novo — registra o tenant (o banco MySQL precisa já existir,
 * criado manualmente no hPanel com o nome derivado do slug — ver
 * dbNomeDoTenant) E JÁ CRIA o primeiro lojista responsável dentro desse banco.
 * Sem isso, o tenant nascia vazio e ninguém conseguia entrar nele.
 */
/**
 * Provisiona um cliente: cria o tenant (banco + schema) e o primeiro lojista
 * dentro dele.
 *
 * EXTRAÍDA da rota pra ser reusada pela APROVAÇÃO de solicitação do
 * revendedor. Duplicar isso significaria duas formas de nascer cliente — e a
 * segunda esqueceria o slug ou o `loja_padrao_id`, que é exatamente o bug que
 * deixou o primeiro cliente sem endereço.
 */
export interface DadosCliente {
  nome: string; slug: string; dominio: string | null;
  nomeLoja: string; categoria: string;
  nomeDono: string; email: string; telefone: string;
  /** Já em hash — a senha em claro não trafega nem fica guardada em fila. */
  senhaHash: string;
  revendedorId?: number | null;
}

export async function provisionarCliente(d: DadosCliente): Promise<{ tenant: Tenant; lojaId: number }> {
  let tenant;
  try {
    tenant = await criarTenant({ nome: d.nome, slug: d.slug, dominio: d.dominio, dbNome: dbNomeDoTenant(d.slug) });
  } catch (e) {
    throw erroHttp(409, e instanceof Error ? e.message : 'Já existe um cliente com esse slug ou domínio.');
  }

  if (d.revendedorId) {
    await poolCentral().query('UPDATE tenants SET revendedor_id = ? WHERE id = ?', [d.revendedorId, tenant.id]);
  }

  // O 1º lojista nasce DENTRO do banco deste tenant — não no banco atual.
  let lojaId: number;
  try {
    lojaId = await comTenant(tenant.db_nome, async () => comTransacao(async (tx) => {
      const u = await tx.prepare(
        `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, loja_id, criado_em)
         VALUES (?, ?, ?, 'lojista', ?, NULL, ?)`
      ).run(d.nomeDono, d.email, d.senhaHash, d.telefone, agoraUTC());
      const uid = Number(u.lastInsertRowid);
      const l = await tx.prepare(
        `INSERT INTO lojas (usuario_id, nome, descricao, categoria, endereco,
                            taxa_entrega_centavos, tempo_estimado_min, horario_funcionamento,
                            status_aprovacao, aberta, criado_em)
         VALUES (?, ?, '', ?, '', 0, 40, '', 'aprovada', 0, ?)`
      ).run(uid, d.nomeLoja, d.categoria, agoraUTC());
      const novaLojaId = Number(l.lastInsertRowid);

      /*
       * O CLIENTE JÁ NASCE COM ENDEREÇO. Sem SLUG e sem `loja_padrao_id`, a
       * loja fica inalcançável: nem `/nome-da-loja`, e a raiz do subdomínio cai
       * na landing de VENDAS da plataforma em vez da loja do cliente.
       */
      const jaUsados = (await tx.prepare('SELECT slug FROM lojas WHERE slug IS NOT NULL').all() as Array<{ slug: string }>)
        .map(r => r.slug);
      await tx.prepare('UPDATE lojas SET slug = ? WHERE id = ?')
        .run(slugUnico(d.nomeLoja, jaUsados, novaLojaId), novaLojaId);
      await tx.prepare(
        "INSERT INTO configuracoes (chave, valor) VALUES ('loja_padrao_id', ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)"
      ).run(String(novaLojaId));

      return novaLojaId;
    }));
  } catch {
    throw erroHttp(500, 'Cliente provisionado, mas falhou ao criar o responsável. Contate o suporte.');
  }
  return { tenant, lojaId };
}

router.post('/tenants', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const nome = textoLimpo(req.body.nome, 120);
    const slug = textoLimpo(req.body.slug, 60).toLowerCase().replace(/[^a-z0-9-]/g, '');
    const dominio = textoLimpo(req.body.dominio || '', 120);
    const nomeLoja = textoLimpo(req.body.nome_loja || nome, 120);
    const categoria = textoLimpo(req.body.categoria || 'Outros', 50) || 'Outros';
    const nomeDono = textoLimpo(req.body.dono_nome, 120);
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    const telefone = textoLimpo(req.body.telefone || '', 30);
    if (nome.length < 2) throw erroHttp(400, 'Informe o nome do cliente.');
    const problemaSlug = problemaNoSlugTenant(slug);
    if (problemaSlug) throw erroHttp(400, problemaSlug);
    if (nomeDono.length < 2) throw erroHttp(400, 'Informe o nome do responsável pela loja.');
    if (!emailValido(email)) throw erroHttp(400, 'E-mail do responsável inválido.');
    if (senha.length < 6) throw erroHttp(400, 'Senha do responsável: mínimo 6 caracteres.');

    const { tenant, lojaId } = await provisionarCliente({
      nome, slug, dominio: dominio || null, nomeLoja, categoria,
      nomeDono, email, telefone, senhaHash: bcrypt.hashSync(senha, 10),
      revendedorId: req.body.revendedor_id ? inteiroPositivo(req.body.revendedor_id) : null,
    });

    await registrarAuditoria(req, 'tenant.criar', { alvoTipo: 'tenant', alvoId: tenant.id, alvoDesc: nome });
    res.status(201).json({ tenant, loja_id: lojaId });
  } catch (e) { next(e); }
});

/** Atualiza nome/domínio/ativo de um tenant. */
router.put('/tenants/:id', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const id = inteiroPositivo(req.params.id);
    if (!id) throw erroHttp(400, 'ID inválido.');
    try {
      await atualizarTenant(id, {
        nome: req.body.nome !== undefined ? textoLimpo(req.body.nome, 120) : undefined,
        dominio: req.body.dominio !== undefined ? textoLimpo(req.body.dominio || '', 120) : undefined,
        ativo: req.body.ativo !== undefined ? (req.body.ativo ? 1 : 0) : undefined,
      });
    } catch (e) {
      throw erroHttp(409, 'Não foi possível atualizar (domínio já em uso?).');
    }
    await registrarAuditoria(req, 'tenant.editar', { alvoTipo: 'tenant', alvoId: id });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * Emite um token de lojista pra entrar no painel de qualquer cliente direto
 * do painel principal, sem precisar da senha dele nem de configurar domínio
 * nenhum — o token carrega o banco do tenant (ver gerarTokenImpersonado),
 * então funciona em `/lojista?entrar=...` em cima do domínio que estiver
 * usando agora mesmo.
 */
router.post('/tenants/:id/impersonar', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const id = inteiroPositivo(req.params.id);
    if (!id) throw erroHttp(400, 'ID inválido.');
    const tenant = await tenantPorId(id);
    if (!tenant) throw erroHttp(404, 'Cliente não encontrado.');
    if (ehMaster(tenant.db_nome)) throw erroHttp(400, 'O painel principal não tem uma loja pra entrar.');

    const lojista = await comTenant(tenant.db_nome, async () => {
      return await db.prepare(
        "SELECT id, perfil FROM usuarios WHERE perfil = 'lojista' ORDER BY id LIMIT 1"
      ).get() as { id: number; perfil: 'lojista' } | undefined;
    });
    if (!lojista) throw erroHttp(404, 'Esse cliente ainda não tem um lojista responsável cadastrado.');

    const token = gerarTokenImpersonado(lojista, tenant.db_nome);
    await registrarAuditoria(req, 'tenant.impersonar', { alvoTipo: 'tenant', alvoId: id, alvoDesc: tenant.nome });
    // O front decide com isso se abre a aba aqui mesmo ou troca de domínio
    // primeiro: null quando o tenant não tem domínio próprio nem DOMINIO_BASE
    // configurado, e aí o token no localStorage (mesmo domínio) é o único jeito.
    res.json({ token, redirecionar: urlDoTenant(tenant) });
  } catch (e) { next(e); }
});

/**
 * Backup de UM tenant só: dump SQL (mysqldump) do banco MySQL dele, comprimido
 * em .sql.gz e enviado direto (sem arquivo temporário — mysqldump | gzip |
 * resposta). Diferente do backup geral (todos os tenants + uploads/certs).
 */
router.get('/tenants/:id/backup', exigirSuperAdmin, async (req, res, next) => {
  const cnfPath = path.join(os.tmpdir(), `backup-tenant-${Date.now()}-${process.pid}.cnf`);
  try {
    exigirMaster();
    const id = inteiroPositivo(req.params.id);
    if (!id) throw erroHttp(400, 'ID inválido.');
    const tenant = await tenantPorId(id);
    if (!tenant) throw erroHttp(404, 'Cliente não encontrado.');

    const host = process.env.MYSQL_HOST || '127.0.0.1';
    const porta = process.env.MYSQL_PORT || '3306';
    const usuario = process.env.MYSQL_USER || '';
    const senha = process.env.MYSQL_PASSWORD || '';
    if (!usuario) throw erroHttp(500, 'MYSQL_USER não configurado neste servidor.');
    fs.writeFileSync(cnfPath, `[client]\nhost=${host}\nport=${porta}\nuser=${usuario}\npassword=${senha}\n`, { mode: 0o600 });

    await registrarAuditoria(req, 'backup.baixar', { alvoTipo: 'tenant', alvoId: id, alvoDesc: tenant.nome });

    const nomeArquivo = `backup-${tenant.slug}-${new Date().toISOString().slice(0, 10)}.sql.gz`;
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);

    const limpar = () => fs.rm(cnfPath, { force: true }, () => {});

    const dump = spawn('mysqldump', [
      `--defaults-extra-file=${cnfPath}`,
      '--single-transaction', '--routines', '--events', '--skip-lock-tables',
      tenant.db_nome,
    ]);
    dump.stderr.on('data', d => console.warn('[Backup tenant] mysqldump stderr:', d.toString()));
    dump.on('error', (e) => {
      console.error('[Backup tenant] Falha ao iniciar o mysqldump:', e);
      limpar();
      if (!res.headersSent) next(erroHttp(500, 'Não foi possível gerar o backup (mysqldump indisponível no servidor).'));
    });
    dump.on('close', (codigo) => {
      limpar();
      if (codigo !== 0 && !res.headersSent) next(erroHttp(500, `mysqldump terminou com código ${codigo}.`));
    });
    dump.stdout.pipe(zlib.createGzip()).pipe(res);
  } catch (e) {
    fs.rm(cnfPath, { force: true }, () => {});
    next(e instanceof ErroHttp ? e : erroHttp(500, e instanceof Error ? e.message : 'Falha ao gerar o backup.'));
  }
});

// ----- Auditoria (log de ações administrativas) -----------------------------

router.get('/auditoria', exigirSuperAdmin, async (req, res, next) => {
  try {
    let sql = 'SELECT * FROM admin_auditoria WHERE 1 = 1';
    const params: (string | number)[] = [];
    if (req.query.admin_id) { sql += ' AND admin_id = ?'; params.push(Number(req.query.admin_id)); }
    if (req.query.acao)     { sql += ' AND acao LIKE ?'; params.push(`${String(req.query.acao)}%`); }
    if (req.query.de)       { sql += ' AND criado_em >= ?'; params.push(textoLimpo(req.query.de, 10) + 'T00:00:00.000Z'); }
    if (req.query.ate)      { sql += ' AND criado_em <= ?'; params.push(textoLimpo(req.query.ate, 10) + 'T23:59:59.999Z'); }
    sql += ' ORDER BY id DESC LIMIT 500';
    res.json({ registros: await db.prepare(sql).all(...params) });
  } catch (e) { next(e); }
});

export default router;

/* ══════════════════ ASSINATURAS (plataforma cobra o lojista) ══════════════════
 *
 * Protegidas por `exigirSuperAdmin` + `exigirMaster()`, o mesmo par das rotas de
 * tenant: são dados da PLATAFORMA, não de uma loja. Admin comum de um tenant não
 * pode ver nem mexer em quanto os outros clientes pagam.
 */

/** Lista assinaturas com o status recalculado pra hoje (a tela mostra a verdade de agora). */
router.get('/assinaturas', exigirSuperAdmin, async (_req, res, next) => {
  try {
    exigirMaster();
    const pool = poolCentral();
    const assinaturas = (await listarAssinaturas(pool)).map(a => ({
      ...a,
      // O status gravado é do último job; este é o de AGORA. Sem isso, uma
      // assinatura que venceu hoje apareceria "ativa" até a madrugada.
      status_agora: statusCalculado(a),
      dias_atraso: diasDeAtraso(a.vence_em),
    }));
    // Tenants ainda sem assinatura: são justamente os que precisam de atenção.
    const todos = await listarTenants();
    const comAssinatura = new Set(assinaturas.map(a => a.tenant_id));
    const semAssinatura = todos.filter(t => !comAssinatura.has(t.id))
      .map(t => ({ tenant_id: t.id, tenant_nome: t.nome, tenant_slug: t.slug, tenant_ativo: t.ativo }));
    res.json({ assinaturas, sem_assinatura: semAssinatura });
  } catch (e) { next(e); }
});

/** Cria ou atualiza a assinatura de um tenant. */
router.put('/assinaturas/:tenantId', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const tenantId = inteiroPositivo(req.params.tenantId);
    if (!tenantId) throw erroHttp(400, 'Tenant inválido.');
    if (!(await tenantPorId(tenantId))) throw erroHttp(404, 'Tenant não encontrado.');

    const STATUS = ['teste', 'ativa', 'inadimplente', 'suspensa', 'cancelada'] as const;
    const status = STATUS.includes(req.body?.status) ? req.body.status : 'teste';
    const valor = Math.max(0, inteiroPositivo(req.body?.valor_centavos) || 0);
    // 1–28: ver `proximoVencimento` — dia 29+ escorrega em fevereiro e atrasa a
    // cobrança um mês inteiro sem ninguém notar.
    const dia = Math.min(28, Math.max(1, inteiroPositivo(req.body?.dia_vencimento) || 5));
    const tolerancia = Math.min(60, Math.max(0, Math.trunc(Number(req.body?.dias_tolerancia)) || 0));

    await salvarAssinatura(poolCentral(), {
      tenantId,
      plano: textoLimpo(req.body?.plano, 60) || 'mensal',
      valorCentavos: valor,
      diaVencimento: dia,
      diasTolerancia: tolerancia,
      status,
      observacoes: textoLimpo(req.body?.observacoes, 500),
    });
    await registrarAuditoria(req, 'assinatura.salvar', {
      alvoTipo: 'tenant', alvoId: tenantId,
      alvoDesc: `${status} · R$ ${(valor / 100).toFixed(2)}`,
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Registra um pagamento e avança o vencimento (reativa o acesso na hora). */
router.post('/assinaturas/:id/pagamento', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const id = inteiroPositivo(req.params.id);
    if (!id) throw erroHttp(400, 'Assinatura inválida.');
    const valor = Math.max(0, inteiroPositivo(req.body?.valor_centavos) || 0);
    if (!valor) throw erroHttp(400, 'Informe o valor recebido.');
    const forma = ['pix', 'manual'].includes(req.body?.forma) ? req.body.forma : 'manual';

    await registrarPagamento(poolCentral(), {
      assinaturaId: id,
      valorCentavos: valor,
      forma,
      referencia: textoLimpo(req.body?.referencia, 120),
    });
    await registrarAuditoria(req, 'assinatura.pagamento', {
      alvoTipo: 'assinatura', alvoId: id,
      alvoDesc: `R$ ${(valor / 100).toFixed(2)} · ${forma}`,
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Histórico de pagamentos de uma assinatura. */
router.get('/assinaturas/:id/pagamentos', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const id = inteiroPositivo(req.params.id);
    if (!id) throw erroHttp(400, 'Assinatura inválida.');
    res.json({ pagamentos: await historicoPagamentos(poolCentral(), id) });
  } catch (e) { next(e); }
});

/** Roda o job de vencimentos agora (o mesmo que corre de madrugada). */
router.post('/assinaturas/processar', exigirSuperAdmin, async (req, res, next) => {
  try {
    exigirMaster();
    const r = await processarVencimentos(poolCentral());
    await registrarAuditoria(req, 'assinatura.processar', {
      alvoTipo: 'plataforma',
      alvoDesc: `${r.verificadas} verificada(s), ${r.suspensos} suspenso(s), ${r.reativados} reativado(s)`,
    });
    res.json(r);
  } catch (e) { next(e); }
});
