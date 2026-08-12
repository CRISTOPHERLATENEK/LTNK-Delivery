/**
 * Rotas públicas (sem login): banners, vitrine, destaques e cardápio.
 */
import { Router } from 'express';
import db, { bancoTenantAtual } from '../db-mysql';
import { erroHttp } from '../util';
import { chavePublicaVapid } from '../push';
import { ehMaster, lerRodapeCredito } from '../tenants-mysql';
import { montarLandingPublica } from '../landing-campos';
import { lojaIdDoHost } from '../dominios';
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
    //
    // A regra mora em dominios.ts porque o Open Graph (og.ts) precisa da MESMA
    // resposta: com a decisão duplicada, o cartão do link no WhatsApp podia
    // dizer uma coisa e a página abrir com a marca de outra.
    const lojaId = await lojaIdDoHost(req.headers.host);

    /*
     * Identidade da LOJA no domínio dela, não a da plataforma.
     *
     * O QUE ESTAVA ERRADO: este endpoint é o que pinta `--primary` no boot de
     * TODO o app, e devolvia sempre `marca_cor_primaria` (padrão '#dc2640').
     * Num domínio white-label isso significava que o KDS, o app do entregador e
     * todas as telas de LOGIN saíam no vermelho da plataforma mesmo com a loja
     * tendo escolhido outra cor em Visual → Cores. O painel do lojista e a
     * vitrine do cliente não sofriam porque carregam a loja e reaplicam a cor
     * por conta própria — as telas que NÃO carregam a loja (e as que rodam antes
     * do login, quando não há como carregar) ficavam com a cor errada.
     *
     * A regra do favicon já era esta desde antes; a cor só não tinha vindo com
     * ela. Vale a mesma razão: quem paga white-label espera o domínio dele
     * inteiro com a marca dele.
     */
    let favicon = await valor('marca_favicon_url');
    let corPrimaria = await valor('marca_cor_primaria', '#dc2640');
    let corSecundaria = await valor('marca_cor_secundaria');
    let nome = await valor('marca_nome', 'Delivery Já');
    let slogan = await valor('marca_slogan', 'Peça das melhores lojas da sua região');
    let logo = await valor('marca_logo_url');
    const mostrarNome = (await valor('marca_mostrar_nome', '1')) !== '0';
    const credito = await lerRodapeCredito();
    let descricao = await valor('marca_descricao');

    if (lojaId > 0) {
      const loja = await db.prepare(
        'SELECT nome, descricao, favicon_url, logo_url, cor_marca, cor_secundaria FROM lojas WHERE id = ?'
      ).get(lojaId) as {
        nome: string; descricao: string; favicon_url: string; logo_url: string;
        cor_marca: string; cor_secundaria: string;
      } | undefined;

      // O FAVICON DA LOJA GANHA DO DA PLATAFORMA aqui, e não o contrário: no
      // domínio dela, tudo o mais (nome, logo, cores) já é dela. Manter o ícone da
      // plataforma por cima deixaria a marca alheia justamente no lugar mais
      // visível — a aba do navegador, que fica aberta o dia inteiro.
      if (loja?.favicon_url?.trim()) favicon = loja.favicon_url.trim();
      // Só sobrescreve o que a loja realmente escolheu: coluna vazia (default do
      // schema) mantém a cor da plataforma, senão o domínio cairia no preto/vazio.
      if (loja?.cor_marca?.trim()) {
        corPrimaria = loja.cor_marca.trim();
        // A secundária acompanha a primária da LOJA — misturar a secundária da
        // plataforma com a primária da loja dá um par de cores que ninguém
        // escolheu, e é o tipo de coisa que só aparece num botão perdido.
        corSecundaria = loja.cor_secundaria?.trim() || '';
      }
      if (loja?.nome?.trim()) {
        nome = loja.nome.trim();
        // SLOGAN DA PLATAFORMA SAI JUNTO. Ele é texto de marketplace ("Peça das
        // melhores lojas da sua região") e virava título de aba com o nome da
        // loja na frente — anunciando um marketplace no domínio de quem paga
        // white-label justamente pra não parecer estar dentro de um.
        slogan = '';
      }
      if (loja?.logo_url?.trim()) logo = loja.logo_url.trim();
      if (loja?.descricao?.trim()) descricao = loja.descricao.trim();
    }

    // Conteúdo da landing page do produto (só relevante quando lojaId=0, mas
    // sempre incluído — barato e evita um segundo round-trip no boot).
    res.json({
      nome,
      slogan,
      logo_url:          logo,
      mostrar_nome:      mostrarNome,
      // Do banco CENTRAL, não de `configuracoes`: é o crédito da plataforma e
      // vale igual pra todos os clientes. Ver lerRodapeCredito.
      rodape_credito_texto:    credito.texto,
      rodape_credito_logo_url: credito.logo_url,
      rodape_credito_url:      credito.url,
      rodape_credito_botao:     credito.botao_texto,
      rodape_credito_copyright: credito.copyright,
      favicon_url:       favicon,
      cor_primaria:      corPrimaria,
      cor_secundaria:    corSecundaria,
      raio:              await valor('marca_raio', 'suave'),
      fonte:             await valor('marca_fonte', 'inter'),
      descricao,
      og_image:          await valor('marca_og_image'),
      login_banner_url:  await valor('marca_login_banner_url'),
      loja_id:           lojaId,
      // Só o tenant master (banco padrão da plataforma) expõe o painel admin
      // — domínio de loja/demo não deve nem mostrar a tela de login dele.
      eh_master:         ehMaster(bancoTenantAtual()),
      // Conteúdo da landing: derivado da fonte única (../landing-campos),
      // a mesma usada pelo GET/PUT de /api/admin/landing.
      ...(await montarLandingPublica(valor)),
      // Usados no rodapé da landing — mesmos campos já editáveis em Marca → Configurações gerais.
      suporte_email:     await valor('suporte_email'),
      suporte_telefone:  await valor('suporte_telefone'),
      termos_url:        await valor('termos_url'),
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
              logo_url, capa_url, favicon_url, cor_marca, cor_secundaria, slug,
              categoria_estilo, categoria_formato, categoria_tamanho,
              categoria_todos_imagem, categoria_foto_auto,
              horario_json, minimo_pedido_centavos, nota_media, nota_qtd, visual_json,
              aceita_retirada
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
      'SELECT nome, icone, imagem, ordem FROM categorias WHERE loja_id = ?'
    ).all(loja.id) as Array<{ nome: string; icone: string; imagem: string; ordem: number }>;
    const metaMapa = new Map(reg.map(r => [r.nome, r]));
    const fotoAuto = (loja as unknown as { categoria_foto_auto?: number }).categoria_foto_auto !== 0;
    const categorias_meta = Object.keys(cardapio).map(nome => ({
      nome,
      icone: metaMapa.get(nome)?.icone || '',
      ordem: metaMapa.get(nome)?.ordem ?? 999,
      /*
       * A escolhida pelo lojista VENCE. Sem ela, cai na foto do 1º produto —
       * mas só se a foto automática estiver ligada (é o padrão, e o
       * comportamento de sempre). Desligada, fica vazio e a vitrine mostra o
       * ícone: é assim que a faixa fica consistente sem exigir imagem pra
       * toda categoria.
       */
      imagem: metaMapa.get(nome)?.imagem
        || (fotoAuto ? (cardapio[nome].find(p => p.foto_url)?.foto_url) : '')
        || '',
    })).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));

    // Zonas de entrega (taxa por bairro) — o cliente usa para prever o frete.
    const zonas = await db.prepare(
      'SELECT bairro, taxa_centavos FROM zonas_entrega WHERE loja_id = ? AND poligono_json IS NULL ORDER BY bairro'
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
