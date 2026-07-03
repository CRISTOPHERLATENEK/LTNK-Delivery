/**
 * Módulo do ADMIN: dashboard, aprovação/suspensão de lojas, todos os pedidos,
 * gestão de usuários, comissão, repasses e banners do carrossel.
 */
import { Router } from 'express';
import db, { abrirBanco, arquivoTenantAtual } from '../db';
import bcrypt from 'bcryptjs';
import { autenticar, exigirPerfil, exigirSuperAdmin } from '../auth';
import { textoLimpo, inteiroPositivo, erroHttp, agoraUTC, emailValido } from '../util';
import { criptografar } from '../cripto';
import { validarCertificado, } from '../assinatura';
import { caminhoCertificado } from './lojista';
import * as fs from 'fs';
import multer from 'multer';
import { listarTenants, criarTenant, atualizarTenant, ehMaster } from '../tenants';
import { Banner } from '../../tipos/modelos';

const router = Router();
router.use(autenticar, exigirPerfil('admin'));

router.get('/dashboard', (_req, res) => {
  const hoje = new Date().toISOString().slice(0, 10);

  type Resumo = { qtd: number; faturamento: number };
  const pedidosHoje = db.prepare(
    `SELECT COUNT(*) AS qtd, COALESCE(SUM(total_centavos), 0) AS faturamento
       FROM pedidos WHERE criado_em >= ? AND status NOT IN ('cancelado','recusado')`
  ).get(hoje + 'T00:00:00.000Z') as Resumo;

  const comissaoHoje = db.prepare(
    `SELECT COALESCE(SUM(comissao_centavos), 0) AS comissao
       FROM pedidos WHERE criado_em >= ? AND status = 'entregue'`
  ).get(hoje + 'T00:00:00.000Z') as { comissao: number };

  const lojas = db.prepare(
    `SELECT
       SUM(CASE WHEN status_aprovacao = 'aprovada' THEN 1 ELSE 0 END) AS ativas,
       SUM(CASE WHEN status_aprovacao = 'pendente' THEN 1 ELSE 0 END) AS pendentes,
       SUM(CASE WHEN status_aprovacao = 'suspensa' THEN 1 ELSE 0 END) AS suspensas
     FROM lojas`
  ).get() as { ativas: number | null; pendentes: number | null; suspensas: number | null };

  const usuarios = db.prepare('SELECT COUNT(*) AS total FROM usuarios').get() as { total: number };
  const emAndamento = db.prepare(
    `SELECT COUNT(*) AS qtd FROM pedidos
      WHERE status IN ('pendente','aceito','preparando','pronto','em_entrega')`
  ).get() as { qtd: number };

  // Série de vendas dos últimos 14 dias (preenche dias sem venda com zero).
  const inicio14 = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const brutos = db.prepare(
    `SELECT substr(criado_em, 1, 10) AS dia, COUNT(*) AS pedidos,
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
  const top_lojas = db.prepare(
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
});

// ----- Lojas ---------------------------------------------------------------

router.get('/lojas', (_req, res) => {
  const lojas = db.prepare(
    `SELECT l.*, u.nome AS dono_nome, u.email AS dono_email
       FROM lojas l JOIN usuarios u ON u.id = l.usuario_id
      ORDER BY CASE l.status_aprovacao WHEN 'pendente' THEN 0 ELSE 1 END, l.id DESC`
  ).all();
  res.json({ lojas });
});

router.post('/lojas/:id/aprovar', (req, res, next) => {
  try {
    const info = db.prepare("UPDATE lojas SET status_aprovacao = 'aprovada' WHERE id = ?")
      .run(req.params.id);
    if (info.changes === 0) throw erroHttp(404, 'Loja não encontrada.');
    res.json({ ok: true, mensagem: 'Loja aprovada.' });
  } catch (e) { next(e); }
});

router.post('/lojas/:id/suspender', (req, res, next) => {
  try {
    const info = db.prepare("UPDATE lojas SET status_aprovacao = 'suspensa', aberta = 0 WHERE id = ?")
      .run(req.params.id);
    if (info.changes === 0) throw erroHttp(404, 'Loja não encontrada.');
    res.json({ ok: true, mensagem: 'Loja suspensa.' });
  } catch (e) { next(e); }
});

/** Cria uma nova loja + sua conta de responsável (lojista). */
router.post('/lojas', exigirSuperAdmin, (req, res, next) => {
  try {
    const nomeLoja = textoLimpo(req.body.nome, 120);
    const categoria = textoLimpo(req.body.categoria || 'Outros', 50) || 'Outros';
    const nomeDono = textoLimpo(req.body.dono_nome, 120);
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    const telefone = textoLimpo(req.body.telefone || '', 30);
    if (nomeLoja.length < 2) throw erroHttp(400, 'Informe o nome da loja.');
    if (nomeDono.length < 2) throw erroHttp(400, 'Informe o nome do responsável.');
    if (!emailValido(email)) throw erroHttp(400, 'E-mail inválido.');
    if (senha.length < 6) throw erroHttp(400, 'Senha mínima de 6 caracteres.');
    if (db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email)) {
      throw erroHttp(409, 'Já existe conta com este e-mail.');
    }
    const hash = bcrypt.hashSync(senha, 10);
    const criar = db.transaction(() => {
      const u = db.prepare(
        `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, loja_id, criado_em)
         VALUES (?, ?, ?, 'lojista', ?, NULL, ?)`
      ).run(nomeDono, email, hash, telefone, agoraUTC());
      const uid = Number(u.lastInsertRowid);
      const l = db.prepare(
        `INSERT INTO lojas (usuario_id, nome, descricao, categoria, endereco,
                            taxa_entrega_centavos, tempo_estimado_min, horario_funcionamento,
                            status_aprovacao, aberta, criado_em)
         VALUES (?, ?, '', ?, '', 0, 40, '', 'aprovada', 0, ?)`
      ).run(uid, nomeLoja, categoria, agoraUTC());
      return { usuario_id: uid, loja_id: Number(l.lastInsertRowid) };
    });
    res.status(201).json(criar());
  } catch (e) { next(e); }
});

/**
 * Exclui uma loja. Bloqueia se houver pedidos (preserva o histórico
 * financeiro) — nesse caso o admin deve suspender. Sem pedidos, apaga em
 * cascata: produtos/grupos/opções, zonas, banners, favoritos, avaliações e a
 * conta do responsável (se não tiver outra loja).
 */
router.delete('/lojas/:id', exigirSuperAdmin, (req, res, next) => {
  try {
    const lojaId = inteiroPositivo(req.params.id);
    if (!lojaId) throw erroHttp(400, 'Loja inválida.');
    const loja = db.prepare('SELECT id, usuario_id FROM lojas WHERE id = ?').get(lojaId) as
      { id: number; usuario_id: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');

    const nPedidos = (db.prepare('SELECT COUNT(*) AS n FROM pedidos WHERE loja_id = ?')
      .get(lojaId) as { n: number }).n;
    if (nPedidos > 0) {
      throw erroHttp(409,
        `Esta loja tem ${nPedidos} pedido(s) no histórico. Suspenda em vez de excluir — assim o histórico financeiro é preservado.`);
    }

    const apagar = db.transaction(() => {
      db.prepare(
        `DELETE FROM opcoes_itens WHERE grupo_id IN (
           SELECT g.id FROM grupos_opcoes g JOIN produtos p ON p.id = g.produto_id WHERE p.loja_id = ?)`
      ).run(lojaId);
      db.prepare(
        'DELETE FROM grupos_opcoes WHERE produto_id IN (SELECT id FROM produtos WHERE loja_id = ?)'
      ).run(lojaId);
      db.prepare('DELETE FROM produtos WHERE loja_id = ?').run(lojaId);
      db.prepare('DELETE FROM zonas_entrega WHERE loja_id = ?').run(lojaId);
      db.prepare('DELETE FROM banners WHERE loja_id = ?').run(lojaId);
      db.prepare('DELETE FROM favoritos WHERE loja_id = ?').run(lojaId);
      db.prepare('DELETE FROM avaliacoes WHERE loja_id = ?').run(lojaId);
      // Clientes isolados nesta loja (white label) deixam de apontar para ela.
      db.prepare('UPDATE usuarios SET loja_id = NULL WHERE loja_id = ?').run(lojaId);
      db.prepare('DELETE FROM lojas WHERE id = ?').run(lojaId);
      // Remove o responsável se ele não tiver outra loja.
      const outra = db.prepare('SELECT id FROM lojas WHERE usuario_id = ?').get(loja.usuario_id);
      if (!outra) db.prepare("DELETE FROM usuarios WHERE id = ? AND perfil = 'lojista'").run(loja.usuario_id);
    });
    apagar();
    res.json({ ok: true, mensagem: 'Loja excluída.' });
  } catch (e) { next(e); }
});

/** Vendas detalhadas de UMA loja (resumo financeiro + pedidos recentes). */
router.get('/lojas/:id/vendas', (req, res, next) => {
  try {
    const lojaId = inteiroPositivo(req.params.id);
    if (!lojaId) throw erroHttp(400, 'Loja inválida.');
    const loja = db.prepare('SELECT id, nome FROM lojas WHERE id = ?').get(lojaId);
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');

    const params: (string | number)[] = [lojaId];
    let filtro = '';
    if (req.query.de)  { filtro += ' AND p.criado_em >= ?'; params.push(textoLimpo(req.query.de, 10) + 'T00:00:00.000Z'); }
    if (req.query.ate) { filtro += ' AND p.criado_em <= ?'; params.push(textoLimpo(req.query.ate, 10) + 'T23:59:59.999Z'); }

    const entregues = db.prepare(
      `SELECT COUNT(*) AS pedidos,
              COALESCE(SUM(p.total_centavos), 0)    AS faturamento_centavos,
              COALESCE(SUM(p.comissao_centavos), 0) AS comissao_centavos,
              COALESCE(SUM(p.total_centavos - p.comissao_centavos), 0) AS repasse_centavos
         FROM pedidos p WHERE p.loja_id = ? AND p.status = 'entregue'${filtro}`
    ).get(...params) as { pedidos: number; faturamento_centavos: number; comissao_centavos: number; repasse_centavos: number };

    const emAndamento = (db.prepare(
      `SELECT COUNT(*) AS n FROM pedidos p
        WHERE p.loja_id = ? AND p.status IN ('pendente','aceito','preparando','pronto','em_entrega')${filtro}`
    ).get(...params) as { n: number }).n;

    const cancelados = (db.prepare(
      `SELECT COUNT(*) AS n FROM pedidos p
        WHERE p.loja_id = ? AND p.status IN ('cancelado','recusado')${filtro}`
    ).get(...params) as { n: number }).n;

    const recentes = db.prepare(
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

router.get('/pedidos', (req, res) => {
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

  res.json({ pedidos: db.prepare(sql).all(...params) });
});

/** Detalhe de um pedido (itens + linha do tempo) para o admin. */
router.get('/pedidos/:id', (req, res, next) => {
  try {
    const pedido = db.prepare(
      `SELECT p.*, l.nome AS loja_nome, c.nome AS cliente_nome, c.telefone AS cliente_telefone,
              e.nome AS entregador_nome
         FROM pedidos p
         JOIN lojas l ON l.id = p.loja_id
         JOIN usuarios c ON c.id = p.cliente_id
         LEFT JOIN usuarios e ON e.id = p.entregador_id
        WHERE p.id = ?`
    ).get(req.params.id);
    if (!pedido) throw erroHttp(404, 'Pedido não encontrado.');
    const itens = db.prepare(
      'SELECT nome_produto, preco_unit_centavos, quantidade, opcoes_texto FROM itens_pedido WHERE pedido_id = ?'
    ).all((pedido as { id: number }).id);
    const historico = db.prepare(
      'SELECT status, criado_em FROM historico_status WHERE pedido_id = ? ORDER BY id'
    ).all((pedido as { id: number }).id);
    res.json({ pedido, itens, historico });
  } catch (e) { next(e); }
});

// ----- Usuários ------------------------------------------------------------

router.get('/usuarios', (_req, res) => {
  const usuarios = db.prepare(
    'SELECT id, nome, email, perfil, telefone, bloqueado, criado_em FROM usuarios ORDER BY id'
  ).all();
  res.json({ usuarios });
});

router.post('/usuarios/:id/bloquear-desbloquear', (req, res, next) => {
  try {
    const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?')
      .get(req.params.id) as { id: number; bloqueado: number } | undefined;
    if (!usuario) throw erroHttp(404, 'Usuário não encontrado.');
    if (usuario.id === req.usuario!.id) throw erroHttp(400, 'Você não pode bloquear a si mesmo.');

    const novo = usuario.bloqueado ? 0 : 1;
    db.prepare('UPDATE usuarios SET bloqueado = ? WHERE id = ?').run(novo, usuario.id);
    res.json({ ok: true, bloqueado: !!novo });
  } catch (e) { next(e); }
});

// ----- Gestão de admins (somente super admin) ------------------------------

/** GET /api/admin/admins — lista todos os admins (super + operacionais). */
router.get('/admins', exigirSuperAdmin, (_req, res) => {
  const admins = db.prepare(
    `SELECT id, nome, email, telefone, super_admin, bloqueado, criado_em
       FROM usuarios WHERE perfil = 'admin' ORDER BY super_admin DESC, id`
  ).all();
  res.json({ admins });
});

/** POST /api/admin/admins — cria admin operacional (sem poder de marca/comissão). */
router.post('/admins', exigirSuperAdmin, (req, res, next) => {
  try {
    const nome = textoLimpo(req.body.nome, 120);
    const email = textoLimpo(req.body.email, 200).toLowerCase();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    const telefone = textoLimpo(req.body.telefone, 30);
    if (nome.length < 2) throw erroHttp(400, 'Informe o nome.');
    if (!emailValido(email)) throw erroHttp(400, 'E-mail inválido.');
    if (senha.length < 6) throw erroHttp(400, 'Senha precisa ter pelo menos 6 caracteres.');

    const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    if (existe) throw erroHttp(409, 'Já existe uma conta com este e-mail.');

    // super_admin SEMPRE 0 — promoção precisa ser feita manualmente no banco
    // (segurança extra: a UI não pode "criar outro super admin")
    const info = db.prepare(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, super_admin, criado_em)
       VALUES (?, ?, ?, 'admin', ?, 0, ?)`
    ).run(nome, email, bcrypt.hashSync(senha, 10), telefone, agoraUTC());
    res.status(201).json({ admin_id: Number(info.lastInsertRowid) });
  } catch (e) { next(e); }
});

/** DELETE /api/admin/admins/:id — remove admin operacional. */
router.delete('/admins/:id', exigirSuperAdmin, (req, res, next) => {
  try {
    const alvo = db.prepare("SELECT * FROM usuarios WHERE id = ? AND perfil = 'admin'")
      .get(req.params.id) as { id: number; super_admin: number } | undefined;
    if (!alvo) throw erroHttp(404, 'Admin não encontrado.');
    if (alvo.id === req.usuario!.id) throw erroHttp(400, 'Você não pode remover sua própria conta.');
    if (alvo.super_admin) throw erroHttp(400, 'Não é possível remover um super admin pela UI.');

    db.prepare('DELETE FROM usuarios WHERE id = ?').run(alvo.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Comissão e repasses -------------------------------------------------

router.get('/comissao', (_req, res) => {
  const r = db.prepare("SELECT valor FROM configuracoes WHERE chave = 'comissao_percentual'")
    .get() as { valor: string };
  res.json({ comissao_percentual: Number(r.valor) });
});

router.put('/comissao', exigirSuperAdmin, (req, res, next) => {
  try {
    const pct = Number(req.body.comissao_percentual);
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) {
      throw erroHttp(400, 'Informe um percentual entre 0 e 50.');
    }
    db.prepare("UPDATE configuracoes SET valor = ? WHERE chave = 'comissao_percentual'").run(String(pct));
    res.json({ ok: true, comissao_percentual: pct });
  } catch (e) { next(e); }
});

router.get('/repasses', (req, res) => {
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

  res.json({ repasses: db.prepare(sql).all(...params) });
});

/** Define (ou limpa, enviando null/vazio) a comissão específica de uma loja. */
router.put('/lojas/:id/comissao', exigirSuperAdmin, (req, res, next) => {
  try {
    const loja = db.prepare('SELECT id FROM lojas WHERE id = ?').get(req.params.id) as { id: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');
    const bruto = req.body.comissao_percentual;
    let valor: number | null = null;
    if (bruto !== null && bruto !== undefined && bruto !== '') {
      valor = Number(bruto);
      if (!Number.isFinite(valor) || valor < 0 || valor > 50) {
        throw erroHttp(400, 'Informe um percentual entre 0 e 50 (ou vazio para usar a comissão padrão).');
      }
    }
    db.prepare('UPDATE lojas SET comissao_percentual = ? WHERE id = ?').run(valor, loja.id);
    res.json({ ok: true, comissao_percentual: valor });
  } catch (e) { next(e); }
});

// ----- Configuração fiscal de uma loja (super admin) ----------------------

const uploadCertAdmin = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

/** Lê configuração fiscal de uma loja (sem segredos). */
router.get('/lojas/:id/fiscal', exigirSuperAdmin, (req, res, next) => {
  try {
    const loja = db.prepare('SELECT * FROM lojas WHERE id = ?').get(req.params.id) as any;
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
router.put('/lojas/:id/fiscal', exigirSuperAdmin, (req, res, next) => {
  try {
    const loja = db.prepare('SELECT id FROM lojas WHERE id = ?').get(req.params.id) as { id: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');
    const b = req.body;
    const txt = (v: unknown, n: number) => textoLimpo(v, n);
    db.prepare(
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
      db.prepare('UPDATE lojas SET nfce_csc = ? WHERE id = ?').run(criptografar(b.csc.trim()), loja.id);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Upload do certificado A1 para uma loja (super admin). */
router.post('/lojas/:id/fiscal/certificado', exigirSuperAdmin, uploadCertAdmin.single('certificado'), (req, res, next) => {
  try {
    const loja = db.prepare('SELECT id FROM lojas WHERE id = ?').get(req.params.id) as { id: number } | undefined;
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
    db.prepare('UPDATE lojas SET nfce_cert_senha = ?, nfce_cert_titular = ?, nfce_cert_validade = ? WHERE id = ?')
      .run(criptografar(senha), cert.titular, cert.validade, loja.id);
    res.json({ ok: true, titular: cert.titular, validade: cert.validade });
  } catch (e) { next(e); }
});

/** Lista campos fiscais de todos os produtos de uma loja. */
router.get('/lojas/:id/fiscal/produtos', exigirSuperAdmin, (req, res, next) => {
  try {
    const loja = db.prepare('SELECT id FROM lojas WHERE id = ?').get(req.params.id) as { id: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');
    const produtos = db.prepare(
      `SELECT id, nome, categoria, ncm, cfop, csosn, origem, unidade_comercial, cest
         FROM produtos WHERE loja_id = ? AND excluido = 0 ORDER BY categoria, nome`
    ).all(loja.id);
    res.json({ produtos });
  } catch (e) { next(e); }
});

/** Atualiza campos fiscais de um produto de uma loja. */
router.put('/lojas/:id/fiscal/produtos/:prodId', exigirSuperAdmin, (req, res, next) => {
  try {
    const loja = db.prepare('SELECT id FROM lojas WHERE id = ?').get(req.params.id) as { id: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');
    const prod = db.prepare('SELECT id FROM produtos WHERE id = ? AND loja_id = ?').get(req.params.prodId, loja.id) as { id: number } | undefined;
    if (!prod) throw erroHttp(404, 'Produto não encontrado.');
    const txt = (v: unknown, n: number) => textoLimpo(v, n);
    db.prepare(
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
router.get('/repasses/csv', (req, res) => {
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

  const linhas = db.prepare(sql).all(...params) as Array<{
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
});

// ----- Entregadores (visão da plataforma) ----------------------------------

/** Lista entregadores com métricas de entregas concluídas. */
router.get('/entregadores', (_req, res) => {
  const entregadores = db.prepare(
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
});

// ----- Monitor ao vivo (pedidos em andamento de todas as lojas) ------------

router.get('/monitor', (_req, res) => {
  const pedidos = db.prepare(
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
});

// ----- Marca / White label da plataforma -----------------------------------

router.get('/tema', (_req, res) => {
  const valor = (chave: string, padrao = ''): string => {
    const r = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave) as { valor: string } | undefined;
    return r?.valor ?? padrao;
  };
  res.json({
    nome:          valor('marca_nome', 'Delivery Já'),
    slogan:        valor('marca_slogan', 'Peça das melhores lojas da sua região'),
    logo_url:      valor('marca_logo_url'),
    favicon_url:   valor('marca_favicon_url'),
    cor_primaria:  valor('marca_cor_primaria', '#dc2640'),
    loja_id:       Number(valor('loja_padrao_id', '0')),
  });
});

/** PUT /api/admin/tema — só o super admin edita a marca da plataforma. */
router.put('/tema', exigirSuperAdmin, (req, res, next) => {
  try {
    const stmt = db.prepare('UPDATE configuracoes SET valor = ? WHERE chave = ?');

    const nome = textoLimpo(req.body.nome, 60);
    if (req.body.nome !== undefined && nome.length < 2) throw erroHttp(400, 'Informe um nome de marca.');
    if (req.body.nome !== undefined) stmt.run(nome, 'marca_nome');

    if (req.body.slogan !== undefined) stmt.run(textoLimpo(req.body.slogan, 120), 'marca_slogan');

    if (req.body.logo_url !== undefined) {
      const v = textoLimpo(req.body.logo_url, 500);
      if (v && !/^https?:\/\//i.test(v) && !v.startsWith('/uploads/')) throw erroHttp(400, 'URL do logo inválida (use https://… ou faça upload).');
      stmt.run(v, 'marca_logo_url');
    }
    if (req.body.favicon_url !== undefined) {
      const v = textoLimpo(req.body.favicon_url, 500);
      if (v && !/^https?:\/\//i.test(v) && !v.startsWith('/uploads/')) throw erroHttp(400, 'URL do favicon inválida (use https://… ou faça upload).');
      stmt.run(v, 'marca_favicon_url');
    }
    if (req.body.cor_primaria !== undefined) {
      const cor = textoLimpo(req.body.cor_primaria, 20);
      if (!/^#[0-9a-fA-F]{6}$/.test(cor)) throw erroHttp(400, 'Use uma cor em formato hexadecimal (#RRGGBB).');
      stmt.run(cor, 'marca_cor_primaria');
    }
    if (req.body.loja_id !== undefined) {
      const id = parseInt(String(req.body.loja_id), 10);
      if (isNaN(id) || id < 0) throw erroHttp(400, 'ID de loja inválido.');
      stmt.run(String(id), 'loja_padrao_id');
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Lojistas (visão drill-down do super admin) --------------------------

router.get('/lojistas', (_req, res) => {
  const lojistas = db.prepare(`
    SELECT l.id, l.nome AS loja_nome, l.status_aprovacao, l.aberta,
           l.logo_url, l.categoria, l.criado_em AS loja_criada_em,
           u.id AS usuario_id, u.nome AS dono_nome, u.email AS dono_email, u.telefone AS dono_telefone,
           (SELECT COUNT(*) FROM pedidos p WHERE p.loja_id = l.id AND p.status NOT IN ('cancelado','recusado')) AS total_pedidos,
           (SELECT COALESCE(SUM(p.total_centavos),0) FROM pedidos p WHERE p.loja_id = l.id AND p.status = 'entregue') AS faturamento_centavos,
           (SELECT COUNT(*) FROM usuarios c WHERE c.loja_id = l.id AND c.perfil = 'cliente') AS total_clientes
      FROM lojas l
      JOIN usuarios u ON u.id = l.usuario_id
     ORDER BY l.criado_em DESC`).all();
  res.json({ lojistas });
});

router.get('/lojistas/:id/clientes', (req, res, next) => {
  try {
    const loja = db.prepare('SELECT id FROM lojas WHERE id = ?').get(req.params.id) as { id: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');
    const clientes = db.prepare(`
      SELECT id, nome, email, telefone, criado_em
        FROM usuarios
       WHERE loja_id = ? AND perfil = 'cliente'
       ORDER BY criado_em DESC LIMIT 200`).all(loja.id);
    res.json({ clientes });
  } catch (e) { next(e); }
});

router.get('/lojistas/:id/pedidos', (req, res, next) => {
  try {
    const loja = db.prepare('SELECT id FROM lojas WHERE id = ?').get(req.params.id) as { id: number } | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');
    const pedidos = db.prepare(`
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

router.get('/lojas/:id/produtos', (req, res) => {
  const produtos = db.prepare(
    `SELECT id, nome, categoria FROM produtos
      WHERE loja_id = ? AND excluido = 0
      ORDER BY categoria, nome`
  ).all(req.params.id);
  res.json({ produtos });
});

// ----- Banners do carrossel ------------------------------------------------

router.get('/banners', (_req, res) => {
  const banners = db.prepare(
    `SELECT b.*, l.nome AS loja_nome, p.nome AS produto_nome
       FROM banners b
       LEFT JOIN lojas l ON l.id = b.loja_id
       LEFT JOIN produtos p ON p.id = b.produto_id
      ORDER BY b.ordem, b.id`
  ).all();
  res.json({ banners });
});

router.post('/banners', (req, res, next) => {
  try {
    const titulo = textoLimpo(req.body.titulo, 120);
    const imagem = textoLimpo(req.body.imagem, 500);
    if (titulo.length < 2) throw erroHttp(400, 'Informe um título descritivo.');
    if (!/^https?:\/\//i.test(imagem) && !imagem.startsWith('/uploads/')) throw erroHttp(400, 'Informe uma URL de imagem válida.');

    const info = db.prepare(
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

router.put('/banners/:id', (req, res, next) => {
  try {
    const banner = db.prepare('SELECT * FROM banners WHERE id = ?')
      .get(req.params.id) as Banner | undefined;
    if (!banner) throw erroHttp(404, 'Banner não encontrado.');

    const titulo = req.body.titulo !== undefined ? textoLimpo(req.body.titulo, 120) : banner.titulo;
    if (titulo.length < 2) throw erroHttp(400, 'Título inválido.');

    let imagem = banner.imagem;
    if (req.body.imagem !== undefined) {
      imagem = textoLimpo(req.body.imagem, 500);
      if (!/^https?:\/\//i.test(imagem) && !imagem.startsWith('/uploads/')) throw erroHttp(400, 'URL de imagem inválida.');
    }

    db.prepare(
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

router.delete('/banners/:id', (req, res, next) => {
  try {
    const info = db.prepare('DELETE FROM banners WHERE id = ?').run(req.params.id);
    if (info.changes === 0) throw erroHttp(404, 'Banner não encontrado.');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- Tenants (clientes do SaaS — multi-tenant SILO) ---------------------
// Só o tenant MASTER (banco padrão) gerencia os outros, e apenas super admin.

/** Garante que a requisição veio do painel principal (tenant master). */
function exigirMaster(): void {
  if (!ehMaster(arquivoTenantAtual())) {
    throw erroHttp(403, 'Apenas o painel principal gerencia os clientes.');
  }
}

/** Lista os tenants com nº de lojas de cada um. */
router.get('/tenants', exigirSuperAdmin, (_req, res, next) => {
  try {
    exigirMaster();
    const tenants = listarTenants().map(t => {
      let lojas = 0;
      try {
        const r = abrirBanco(t.db_arquivo).prepare('SELECT COUNT(*) AS n FROM lojas').get() as { n: number };
        lojas = r.n;
      } catch { /* banco ainda não acessível */ }
      return { ...t, lojas };
    });
    res.json({ tenants });
  } catch (e) { next(e); }
});

/** Cria um cliente novo — provisiona o .db (schema criado ao abrir). */
router.post('/tenants', exigirSuperAdmin, (req, res, next) => {
  try {
    exigirMaster();
    const nome = textoLimpo(req.body.nome, 120);
    const slug = textoLimpo(req.body.slug, 60).toLowerCase().replace(/[^a-z0-9-]/g, '');
    const dominio = textoLimpo(req.body.dominio || '', 120);
    if (nome.length < 2) throw erroHttp(400, 'Informe o nome do cliente.');
    if (slug.length < 2) throw erroHttp(400, 'Informe um slug válido (mín. 2 caracteres).');
    let tenant;
    try {
      tenant = criarTenant({ nome, slug, dominio: dominio || null });
    } catch (e) {
      throw erroHttp(409, 'Já existe um cliente com esse slug ou domínio.');
    }
    // Provisiona o banco já com o schema (abrir cria + migra).
    abrirBanco(tenant.db_arquivo);
    res.status(201).json({ tenant });
  } catch (e) { next(e); }
});

/** Atualiza nome/domínio/ativo de um tenant. */
router.put('/tenants/:id', exigirSuperAdmin, (req, res, next) => {
  try {
    exigirMaster();
    const id = inteiroPositivo(req.params.id);
    if (!id) throw erroHttp(400, 'ID inválido.');
    try {
      atualizarTenant(id, {
        nome: req.body.nome !== undefined ? textoLimpo(req.body.nome, 120) : undefined,
        dominio: req.body.dominio !== undefined ? textoLimpo(req.body.dominio || '', 120) : undefined,
        ativo: req.body.ativo !== undefined ? (req.body.ativo ? 1 : 0) : undefined,
      });
    } catch (e) {
      throw erroHttp(409, 'Não foi possível atualizar (domínio já em uso?).');
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
