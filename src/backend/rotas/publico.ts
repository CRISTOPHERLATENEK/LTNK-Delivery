/**
 * Rotas públicas (sem login): banners, vitrine, destaques e cardápio.
 */
import { Router } from 'express';
import db from '../db-mysql';
import { erroHttp } from '../util';
import { chavePublicaVapid } from '../push';
import { GrupoComOpcoes, Loja, OpcaoItem, Produto } from '../../tipos/modelos';

const router = Router();

/**
 * GET /api/push/chave-publica — chave pública VAPID para o navegador se
 * inscrever em notificações push. Pública por natureza.
 */
router.get('/push/chave-publica', (_req, res) => {
  res.json({ chave: chavePublicaVapid() });
});

/**
 * GET /api/tema — identidade visual da plataforma (white label).
 * Endpoint público sem autenticação — o frontend carrega no boot e aplica
 * via CSS variables antes da primeira renderização.
 */
router.get('/tema', async (req, res, next) => {
  try {
    const valor = async (chave: string, padrao = ''): Promise<string> => {
      const r = await db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave) as { valor: string } | undefined;
      return r?.valor ?? padrao;
    };

    // Domínio próprio de uma loja (ex.: pizzariadapaula.com.br) tem prioridade
    // sobre o "loja única" global do admin — cada loja pode ter o domínio dela
    // enquanto o domínio principal continua mostrando o marketplace inteiro.
    let lojaId = Number(await valor('loja_padrao_id', '0'));
    const host = (req.headers.host || '').split(':')[0].toLowerCase().replace(/^www\./, '');
    if (host) {
      const lojaDominio = await db.prepare(
        "SELECT id FROM lojas WHERE dominio_personalizado = ? AND status_aprovacao = 'aprovada'"
      ).get(host) as { id: number } | undefined;
      if (lojaDominio) lojaId = lojaDominio.id;
    }

    // Favicon: se o admin não definiu um favicon próprio da plataforma e o
    // domínio é white-label de uma loja, usa o favicon dessa loja (reforça a
    // identidade de "site próprio" de quem paga white-label).
    let favicon = await valor('marca_favicon_url');
    if (!favicon && lojaId > 0) {
      const loja = await db.prepare('SELECT favicon_url FROM lojas WHERE id = ?').get(lojaId) as { favicon_url: string } | undefined;
      favicon = loja?.favicon_url || '';
    }
    res.json({
      nome:              await valor('marca_nome', 'Delivery Já'),
      slogan:            await valor('marca_slogan', 'Peça das melhores lojas da sua região'),
      logo_url:          await valor('marca_logo_url'),
      favicon_url:       favicon,
      cor_primaria:      await valor('marca_cor_primaria', '#dc2640'),
      login_banner_url:  await valor('marca_login_banner_url'),
      loja_id:           lojaId,
    });
  } catch (e) { next(e); }
});

router.get('/banners', async (_req, res, next) => {
  try {
    const banners = await db.prepare(
      `SELECT b.id, b.titulo, b.subtitulo, b.imagem, b.loja_id, b.produto_id, b.link_url,
              l.nome AS loja_nome, p.nome AS produto_nome
         FROM banners b
         LEFT JOIN lojas l ON l.id = b.loja_id
         LEFT JOIN produtos p ON p.id = b.produto_id
        WHERE b.ativo = 1
          AND (b.loja_id IS NULL OR l.status_aprovacao = 'aprovada')
        ORDER BY b.ordem, b.id`
    ).all();
    res.json({ banners });
  } catch (e) { next(e); }
});

router.get('/destaques', async (_req, res, next) => {
  try {
    const promocoes = await db.prepare(
      `SELECT p.id, p.nome, p.descricao, p.preco_centavos, p.preco_promocional_centavos,
              p.foto_url, p.serve_pessoas, p.destaque,
              l.id AS loja_id, l.nome AS loja_nome, l.categoria AS loja_categoria
         FROM produtos p JOIN lojas l ON l.id = p.loja_id
        WHERE p.disponivel = 1 AND p.excluido = 0
          AND p.preco_promocional_centavos IS NOT NULL
          AND p.preco_promocional_centavos > 0
          AND (p.controla_estoque = 0 OR p.estoque > 0)
          AND l.status_aprovacao = 'aprovada' AND l.aberta = 1
        ORDER BY (p.preco_centavos - p.preco_promocional_centavos) DESC
        LIMIT 8`
    ).all();

    const categorias = await db.prepare(
      `SELECT categoria, COUNT(*) AS qtd
         FROM lojas WHERE status_aprovacao = 'aprovada'
        GROUP BY categoria ORDER BY qtd DESC, categoria`
    ).all();

    res.json({ promocoes, categorias });
  } catch (e) { next(e); }
});

router.get('/lojas', async (req, res, next) => {
  try {
    let sql = `SELECT id, nome, descricao, categoria, endereco,
                      taxa_entrega_centavos, tempo_estimado_min, horario_funcionamento, aberta,
                      logo_url, capa_url, cor_marca, slug,
                      horario_json, minimo_pedido_centavos, nota_media, nota_qtd
                 FROM lojas
                WHERE status_aprovacao = 'aprovada'`;
    const params: (string | number)[] = [];
    if (req.query.categoria) {
      sql += ' AND categoria = ?';
      params.push(String(req.query.categoria).slice(0, 50));
    }
    if (req.query.busca) {
      sql += ' AND (nome LIKE ? OR descricao LIKE ?)';
      const padrao = '%' + String(req.query.busca).slice(0, 80) + '%';
      params.push(padrao, padrao);
    }
    sql += ' ORDER BY aberta DESC, nome';
    res.json({ lojas: await db.prepare(sql).all(...params) });
  } catch (e) { next(e); }
});

/**
 * Busca global: encontra produtos (e lojas) por nome/descrição em todas as
 * lojas aprovadas. Usada pela barra de busca da vitrine.
 */
router.get('/buscar', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q.length < 2) return res.json({ produtos: [], lojas: [] });
    const padrao = '%' + q + '%';

    const produtos = await db.prepare(
      `SELECT p.id, p.nome, p.descricao, p.preco_centavos, p.preco_promocional_centavos,
              p.foto_url, p.destaque,
              l.id AS loja_id, l.nome AS loja_nome, l.aberta AS loja_aberta
         FROM produtos p JOIN lojas l ON l.id = p.loja_id
        WHERE p.disponivel = 1 AND p.excluido = 0
          AND l.status_aprovacao = 'aprovada'
          AND (p.nome LIKE ? OR p.descricao LIKE ?)
        ORDER BY l.aberta DESC, p.destaque DESC, p.nome
        LIMIT 30`
    ).all(padrao, padrao);

    const lojas = await db.prepare(
      `SELECT id, nome, descricao, categoria, taxa_entrega_centavos, tempo_estimado_min,
              aberta, logo_url, capa_url, nota_media, nota_qtd
         FROM lojas
        WHERE status_aprovacao = 'aprovada' AND (nome LIKE ? OR descricao LIKE ?)
        ORDER BY aberta DESC, nome
        LIMIT 10`
    ).all(padrao, padrao);

    res.json({ produtos, lojas });
  } catch (e) { next(e); }
});

router.get('/lojas/:id', async (req, res, next) => {
  try {
    // Aceita tanto ID numérico (/loja/2) quanto slug (/loja/pizzaria-da-paula).
    const param = req.params.id;
    const porNumero = /^\d+$/.test(param);
    const loja = await db.prepare(
      `SELECT id, nome, descricao, categoria, endereco,
              taxa_entrega_centavos, tempo_estimado_min, horario_funcionamento, aberta,
              logo_url, capa_url, favicon_url, cor_marca, cor_secundaria, slug, categoria_estilo,
              horario_json, minimo_pedido_centavos, nota_media, nota_qtd, visual_json
         FROM lojas
        WHERE ${porNumero ? 'id = ?' : 'slug = ?'} AND status_aprovacao = 'aprovada'`
    ).get(param) as Loja | undefined;
    if (!loja) throw erroHttp(404, 'Loja não encontrada.');

    const produtos = await db.prepare(
      `SELECT id, nome, descricao, categoria, subcategoria, preco_centavos,
              preco_promocional_centavos, serve_pessoas, destaque, foto_url,
              controla_estoque, estoque
         FROM produtos
        WHERE loja_id = ? AND disponivel = 1 AND excluido = 0
        ORDER BY categoria, subcategoria, destaque DESC, nome`
    ).all(loja.id) as (Produto & { grupos?: GrupoComOpcoes[] })[];

    for (const p of produtos) {
      const gruposBrutos = await db.prepare(
        `SELECT id, nome, tipo, obrigatorio, max_escolhas
           FROM grupos_opcoes WHERE produto_id = ? ORDER BY ordem, id`
      ).all(p.id) as GrupoComOpcoes[];
      const grupos = [];
      for (const g of gruposBrutos) {
        const opcoes = await db.prepare(
          `SELECT id, nome, preco_adicional_centavos
             FROM opcoes_itens WHERE grupo_id = ? AND disponivel = 1 ORDER BY ordem, id`
        ).all(g.id) as OpcaoItem[];
        if (opcoes.length > 0) grupos.push({ ...g, opcoes });
      }
      p.grupos = grupos;
    }

    const cardapio: Record<string, typeof produtos> = {};
    for (const p of produtos) {
      (cardapio[p.categoria] = cardapio[p.categoria] || []).push(p);
    }

    // Metadados das categorias (ícone + ordem) para a vitrine. Mescla o registro
    // com as categorias que só existem nos produtos (ícone vazio, ordem alta).
    const reg = await db.prepare(
      'SELECT nome, icone, ordem FROM categorias WHERE loja_id = ?'
    ).all(loja.id) as Array<{ nome: string; icone: string; ordem: number }>;
    const metaMapa = new Map(reg.map(r => [r.nome, r]));
    const categorias_meta = Object.keys(cardapio).map(nome => ({
      nome,
      icone: metaMapa.get(nome)?.icone || '',
      ordem: metaMapa.get(nome)?.ordem ?? 999,
      // Imagem da categoria = foto do 1º produto dela que tenha foto (estilo iFood).
      imagem: (cardapio[nome].find(p => p.foto_url)?.foto_url) || '',
    })).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));

    // Zonas de entrega (taxa por bairro) — o cliente usa para prever o frete.
    const zonas = await db.prepare(
      'SELECT bairro, taxa_centavos FROM zonas_entrega WHERE loja_id = ? ORDER BY bairro'
    ).all(loja.id);

    // Banners promocionais criados pelo próprio lojista.
    const banners = await db.prepare(
      `SELECT id, titulo, subtitulo, imagem, produto_id, link_url, botao_texto
         FROM banners WHERE loja_id = ? AND ativo = 1 ORDER BY ordem, id`
    ).all(loja.id);

    res.json({ loja, cardapio, categorias_meta, zonas, banners });
  } catch (e) { next(e); }
});

export default router;
