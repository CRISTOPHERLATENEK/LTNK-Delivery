/**
 * Módulo do ADMIN: dashboard, aprovação/suspensão de lojas, todos os pedidos,
 * gestão de usuários, comissão, repasses e banners do carrossel.
 */
import { Router } from 'express';
import db, { comTenant, comTransacao, bancoTenantAtual, abrirPool } from '../db-mysql';
import bcrypt from 'bcryptjs';
import { autenticar, exigirPerfil, exigirSuperAdmin } from '../auth';
import { textoLimpo, inteiroPositivo, erroHttp, agoraUTC, emailValido, cpfValido, cpfDigitos, telefoneDigitos } from '../util';
import { criptografar } from '../cripto';
import { garantirSessaoPlataforma, obterQrPlataforma, solicitarCodigoPlataforma, statusSessaoPlataforma, desconectarPlataforma } from '../whatsapp-nao-oficial';
import { validarCertificado, } from '../assinatura';
import { caminhoCertificado } from './lojista';
import * as fs from 'fs';
import multer from 'multer';
import { spawn } from 'child_process';
import path from 'path';
import { listarTenants, criarTenant, atualizarTenant, ehMaster } from '../tenants-mysql';
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

router.get('/dashboard', async (_req, res, next) => {
  try {
    const hoje = new Date().toISOString().slice(0, 10);

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

router.get('/lojas', async (_req, res, next) => {
  try {
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

router.get('/pedidos', async (req, res, next) => {
  try {
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
    sql += ' ORDER BY p.id DESC LIMIT 500';

    res.json({ pedidos: await db.prepare(sql).all(...params) });
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
      'SELECT nome_produto, preco_unit_centavos, quantidade, opcoes_texto FROM itens_pedido WHERE pedido_id = ?'
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
      .get(req.params.id) as { id: number; nome: string; email: string; perfil: string; bloqueado: number } | undefined;
    if (!usuario) throw erroHttp(404, 'Usuário não encontrado.');
    if (usuario.id === req.usuario!.id) throw erroHttp(400, 'Você não pode bloquear a si mesmo.');

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

// ----- Comissão e repasses -------------------------------------------------

router.get('/comissao', async (_req, res, next) => {
  try {
    const r = await db.prepare("SELECT valor FROM configuracoes WHERE chave = 'comissao_percentual'")
      .get() as { valor: string } | undefined;
    res.json({ comissao_percentual: Number(r?.valor ?? '10') });
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

router.get('/repasses', async (req, res, next) => {
  try {
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

    res.json({ repasses: await db.prepare(sql).all(...params) });
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
    fs.writeFileSync(caminhoCertificado(loja.id), req.file.buffer);
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
    let sql = `SELECT l.nome AS loja_nome,
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

    const linhas = await db.prepare(sql).all(...params) as Array<{
      loja_nome: string; pedidos: number; faturamento_centavos: number; comissao_centavos: number; repasse_centavos: number;
    }>;
    const reais = (c: number) => (c / 100).toFixed(2).replace('.', ',');
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const cabecalho = ['Loja', 'Pedidos', 'Faturamento (R$)', 'Comissao (R$)', 'Repasse (R$)'];
    const corpo = linhas.map(l =>
      [esc(l.loja_nome), l.pedidos, esc(reais(l.faturamento_centavos)), esc(reais(l.comissao_centavos)), esc(reais(l.repasse_centavos))].join(';'),
    );
    const csv = '﻿' + [cabecalho.join(';'), ...corpo].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="repasses-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (e) { next(e); }
});

// ----- Entregadores (visão da plataforma) ----------------------------------

/** Lista entregadores com métricas de entregas concluídas. */
router.get('/entregadores', async (_req, res, next) => {
  try {
    const entregadores = await db.prepare(
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
    res.json({ entregadores });
  } catch (e) { next(e); }
});

// ----- Monitor ao vivo (pedidos em andamento de todas as lojas) ------------

router.get('/monitor', async (_req, res, next) => {
  try {
    const pedidos = await db.prepare(
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
    res.json({
      suporte_email:    await valor('suporte_email'),
      suporte_telefone: await valor('suporte_telefone'),
      termos_url:       await valor('termos_url'),
      wbapi_server:      await valor('wbapi_server'),
      wbapi_session_id:  await valor('wbapi_session_id'),
      // A chave nunca é devolvida — só se está configurada ou não (mesmo padrão do token oficial da Meta).
      wbapi_configurado: !!(await valor('wbapi_api_key')),
    });
  } catch (e) { next(e); }
});

router.put('/configuracoes-gerais', exigirSuperAdmin, async (req, res, next) => {
  try {
    const upsert = (chave: string, valor: string) =>
      db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)')
        .run(chave, valor);

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
      await upsert('wbapi_server', v);
    }
    if (req.body.wbapi_session_id !== undefined) {
      await upsert('wbapi_session_id', textoLimpo(req.body.wbapi_session_id, 100));
    }
    // Só re-criptografa e salva se veio um valor novo não-vazio — campo em branco no form significa "não mexer".
    if (typeof req.body.wbapi_api_key === 'string' && req.body.wbapi_api_key.trim()) {
      await upsert('wbapi_api_key', criptografar(req.body.wbapi_api_key.trim()));
    }
    await registrarAuditoria(req, 'configuracoes.editar');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Landing page do produto (domínio principal, sem loja padrão) -----

const LANDING_ICONES = ['store', 'palette', 'bike', 'chefhat', 'receipt', 'smartphone', 'check', 'star', 'shield', 'users'] as const;

const LANDING_RECURSOS_PADRAO = [
  { icone: 'store', titulo: 'Multi-lojas', desc: 'Cada loja com seu próprio painel, cardápio e domínio.' },
  { icone: 'palette', titulo: 'White label', desc: 'Cores, logo e visual totalmente personalizáveis por loja.' },
  { icone: 'bike', titulo: 'Rastreio ao vivo', desc: 'Entregador com GPS em tempo real, do jeito que o cliente vê no mapa.' },
  { icone: 'chefhat', titulo: 'Cozinha (KDS)', desc: 'Painel de produção próprio, sem misturar com o financeiro.' },
  { icone: 'receipt', titulo: 'NFC-e integrada', desc: 'Emissão fiscal direto na venda, sem depender de outro sistema.' },
  { icone: 'smartphone', titulo: 'PDV + Comandas', desc: 'Venda no balcão e mesas do salão, tudo no mesmo lugar.' },
];

const LANDING_BENEFICIOS_PADRAO = ['Sem taxa de setup', 'Cada loja com domínio próprio', 'Suporte a Pix, cartão e dinheiro'];

const LANDING_SEM_PADRAO = ['Desorganização no atendimento', 'Falhas de comunicação', 'Erros nos pedidos'];
const LANDING_COM_PADRAO = ['Agilidade e organização nos pedidos', 'Cada loja com sua própria operação', 'Menos erro, mais venda'];

const LANDING_SEGMENTOS_PADRAO = ['Pizzaria', 'Hamburgueria', 'Açaiteria', 'Padaria', 'Sorveteria', 'Sushiteria'];

const LANDING_DEPOIMENTOS_PADRAO: { texto: string; nome: string; negocio: string }[] = [];

const LANDING_DESTAQUES_PADRAO: { imagem_url: string; titulo: string; desc: string }[] = [
  { imagem_url: '', titulo: 'Painel completo em um só lugar', desc: 'Pedidos, cardápio, entregadores e financeiro organizados no painel — sem planilha, sem bagunça, sem sistema separado pra cada coisa.' },
  { imagem_url: '', titulo: 'Cliente acompanha o pedido ao vivo', desc: 'Do aceite da loja até o entregador saindo pra entrega, o cliente vê tudo em tempo real, com mapa e status atualizado sozinho.' },
  { imagem_url: '', titulo: 'Nota fiscal sem sair do sistema', desc: 'Emita a NFC-e direto na hora da venda, sem precisar de outro programa nem digitar os dados de novo.' },
];

router.get('/landing', async (_req, res, next) => {
  try {
    const valor = async (chave: string): Promise<string> => {
      const r = await db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave) as { valor: string } | undefined;
      return r?.valor ?? '';
    };
    const recursosRaw = await valor('landing_recursos_json');
    const beneficiosRaw = await valor('landing_beneficios_json');
    const semRaw = await valor('landing_comparativo_sem_json');
    const comRaw = await valor('landing_comparativo_com_json');
    const segmentosRaw = await valor('landing_segmentos_json');
    const depoimentosRaw = await valor('landing_depoimentos_json');
    const destaquesRaw = await valor('landing_destaques_json');
    res.json({
      cta_texto: (await valor('landing_cta_texto')) || 'Ver demonstração',
      recursos: recursosRaw ? JSON.parse(recursosRaw) : LANDING_RECURSOS_PADRAO,
      beneficios: beneficiosRaw ? JSON.parse(beneficiosRaw) : LANDING_BENEFICIOS_PADRAO,
      comparativo_sem: semRaw ? JSON.parse(semRaw) : LANDING_SEM_PADRAO,
      comparativo_com: comRaw ? JSON.parse(comRaw) : LANDING_COM_PADRAO,
      segmentos: segmentosRaw ? JSON.parse(segmentosRaw) : LANDING_SEGMENTOS_PADRAO,
      depoimentos: depoimentosRaw ? JSON.parse(depoimentosRaw) : LANDING_DEPOIMENTOS_PADRAO,
      destaques: destaquesRaw ? JSON.parse(destaquesRaw) : LANDING_DESTAQUES_PADRAO,
    });
  } catch (e) { next(e); }
});

router.put('/landing', exigirSuperAdmin, async (req, res, next) => {
  try {
    const upsert = (chave: string, valor: string) =>
      db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)')
        .run(chave, valor);

    if (req.body.cta_texto !== undefined) {
      await upsert('landing_cta_texto', textoLimpo(req.body.cta_texto, 60));
    }
    if (req.body.recursos !== undefined) {
      if (!Array.isArray(req.body.recursos) || req.body.recursos.length > 9) {
        throw erroHttp(400, 'Lista de recursos inválida (máximo 9 itens).');
      }
      const recursos = req.body.recursos.map((r: unknown) => {
        const item = r as { icone?: unknown; titulo?: unknown; desc?: unknown };
        const icone = LANDING_ICONES.includes(item.icone as typeof LANDING_ICONES[number]) ? item.icone : 'store';
        const titulo = textoLimpo(item.titulo, 60);
        const desc = textoLimpo(item.desc, 160);
        if (!titulo) throw erroHttp(400, 'Todo recurso precisa de um título.');
        return { icone, titulo, desc };
      });
      await upsert('landing_recursos_json', JSON.stringify(recursos));
    }
    if (req.body.beneficios !== undefined) {
      if (!Array.isArray(req.body.beneficios) || req.body.beneficios.length > 6) {
        throw erroHttp(400, 'Lista de benefícios inválida (máximo 6 itens).');
      }
      const beneficios = req.body.beneficios.map((b: unknown) => textoLimpo(b, 80)).filter(Boolean);
      await upsert('landing_beneficios_json', JSON.stringify(beneficios));
    }
    if (req.body.comparativo_sem !== undefined) {
      if (!Array.isArray(req.body.comparativo_sem) || req.body.comparativo_sem.length > 6) {
        throw erroHttp(400, 'Lista "sem a plataforma" inválida (máximo 6 itens).');
      }
      await upsert('landing_comparativo_sem_json', JSON.stringify(req.body.comparativo_sem.map((b: unknown) => textoLimpo(b, 80)).filter(Boolean)));
    }
    if (req.body.comparativo_com !== undefined) {
      if (!Array.isArray(req.body.comparativo_com) || req.body.comparativo_com.length > 6) {
        throw erroHttp(400, 'Lista "com a plataforma" inválida (máximo 6 itens).');
      }
      await upsert('landing_comparativo_com_json', JSON.stringify(req.body.comparativo_com.map((b: unknown) => textoLimpo(b, 80)).filter(Boolean)));
    }
    if (req.body.segmentos !== undefined) {
      if (!Array.isArray(req.body.segmentos) || req.body.segmentos.length > 16) {
        throw erroHttp(400, 'Lista de segmentos inválida (máximo 16 itens).');
      }
      await upsert('landing_segmentos_json', JSON.stringify(req.body.segmentos.map((s: unknown) => textoLimpo(s, 40)).filter(Boolean)));
    }
    if (req.body.depoimentos !== undefined) {
      if (!Array.isArray(req.body.depoimentos) || req.body.depoimentos.length > 12) {
        throw erroHttp(400, 'Lista de depoimentos inválida (máximo 12 itens).');
      }
      const depoimentos = req.body.depoimentos.map((d: unknown) => {
        const item = d as { texto?: unknown; nome?: unknown; negocio?: unknown };
        const texto = textoLimpo(item.texto, 300);
        const nome = textoLimpo(item.nome, 60);
        const negocio = textoLimpo(item.negocio, 60);
        if (!texto || !nome) throw erroHttp(400, 'Todo depoimento precisa de texto e nome.');
        return { texto, nome, negocio };
      });
      await upsert('landing_depoimentos_json', JSON.stringify(depoimentos));
    }
    if (req.body.destaques !== undefined) {
      if (!Array.isArray(req.body.destaques) || req.body.destaques.length > 4) {
        throw erroHttp(400, 'Lista de destaques inválida (máximo 4 itens).');
      }
      const destaques = req.body.destaques.map((d: unknown) => {
        const item = d as { imagem_url?: unknown; titulo?: unknown; desc?: unknown };
        const imagemUrl = textoLimpo(item.imagem_url, 500);
        const titulo = textoLimpo(item.titulo, 80);
        const desc = textoLimpo(item.desc, 240);
        if (!titulo) throw erroHttp(400, 'Todo destaque precisa de um título.');
        return { imagem_url: imagemUrl, titulo, desc };
      });
      await upsert('landing_destaques_json', JSON.stringify(destaques));
    }
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

/**
 * Baixa um .tar.gz de toda a pasta `dados/` (bancos SQLite legados, se ainda
 * existirem no disco, mais certificados A1). Existe porque, em hospedagens
 * "Web App Node.js" gerenciadas (ex.: Hostinger), o disco do app é recriado
 * do zero a cada deploy — só sobrevive o que está no repositório git.
 * Com a migração pro MySQL, o backup de dados de verdade é feito pelo
 * `mysqldump` (fora desta rota) — isto aqui continua útil pra levar os
 * certificados A1 (que ainda são arquivo em disco) em qualquer migração.
 *
 * Usa o `tar` do sistema (streaming direto pra resposta, sem bufferizar em
 * memória) em vez de uma lib de zip — evita dependência nova e funciona tanto
 * no Linux de produção quanto no Windows moderno (que já traz um `tar`).
 */
router.get('/backup', exigirSuperAdmin, async (req, res, next) => {
  try {
    const raiz = process.cwd();
    const pastaDados = path.join(raiz, 'dados');
    if (!fs.existsSync(pastaDados)) throw erroHttp(404, 'Pasta de dados não encontrada neste servidor.');

    await registrarAuditoria(req, 'backup.baixar');

    const nomeArquivo = `backup-dados-${new Date().toISOString().slice(0, 10)}.tar.gz`;
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);

    const processo = spawn('tar', ['-czf', '-', '-C', raiz, 'dados']);
    processo.stdout.pipe(res);
    processo.stderr.on('data', d => console.warn('[Backup] tar stderr:', d.toString()));
    processo.on('error', (e) => {
      console.error('[Backup] Falha ao iniciar o tar:', e);
      if (!res.headersSent) next(erroHttp(500, 'Não foi possível gerar o backup (tar indisponível no servidor).'));
    });
    processo.on('close', (codigo) => {
      if (codigo !== 0 && !res.headersSent) next(erroHttp(500, `tar terminou com código ${codigo}.`));
    });
  } catch (e) { next(e); }
});

// ----- Lojistas (visão drill-down do super admin) --------------------------

router.get('/lojistas', async (_req, res, next) => {
  try {
    const lojistas = await db.prepare(`
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

/** Lista os tenants com nº de lojas de cada um. */
router.get('/tenants', exigirSuperAdmin, async (_req, res, next) => {
  try {
    exigirMaster();
    const todos = await listarTenants();
    const tenants = await Promise.all(todos.map(async (t) => {
      let lojas = 0;
      try {
        const pool = abrirPool(t.db_nome);
        const [rows] = await pool.query('SELECT COUNT(*) AS n FROM lojas') as any;
        lojas = rows[0]?.n ?? 0;
      } catch { /* banco ainda não acessível */ }
      return { ...t, lojas };
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
    if (slug.length < 2) throw erroHttp(400, 'Informe um slug válido (mín. 2 caracteres).');
    if (nomeDono.length < 2) throw erroHttp(400, 'Informe o nome do responsável pela loja.');
    if (!emailValido(email)) throw erroHttp(400, 'E-mail do responsável inválido.');
    if (senha.length < 6) throw erroHttp(400, 'Senha do responsável: mínimo 6 caracteres.');

    let tenant;
    try {
      tenant = await criarTenant({ nome, slug, dominio: dominio || null, dbNome: dbNomeDoTenant(slug) });
    } catch (e) {
      throw erroHttp(409, e instanceof Error ? e.message : 'Já existe um cliente com esse slug ou domínio.');
    }

    // Cadastra o 1º lojista DENTRO do banco deste tenant — não do banco atual (o do super admin).
    let lojaId: number;
    try {
      lojaId = await comTenant(tenant.db_nome, async () => {
        const hash = bcrypt.hashSync(senha, 10);
        return comTransacao(async (tx) => {
          const u = await tx.prepare(
            `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, loja_id, criado_em)
             VALUES (?, ?, ?, 'lojista', ?, NULL, ?)`
          ).run(nomeDono, email, hash, telefone, agoraUTC());
          const uid = Number(u.lastInsertRowid);
          const l = await tx.prepare(
            `INSERT INTO lojas (usuario_id, nome, descricao, categoria, endereco,
                                taxa_entrega_centavos, tempo_estimado_min, horario_funcionamento,
                                status_aprovacao, aberta, criado_em)
             VALUES (?, ?, '', ?, '', 0, 40, '', 'aprovada', 0, ?)`
          ).run(uid, nomeLoja, categoria, agoraUTC());
          return Number(l.lastInsertRowid);
        });
      });
    } catch (e) {
      throw erroHttp(500, 'Cliente provisionado, mas falhou ao criar o responsável. Contate o suporte.');
    }

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
