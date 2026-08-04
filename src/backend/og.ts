/**
 * Meta tags de compartilhamento (Open Graph) por rota.
 *
 * PROBLEMA QUE ISSO RESOLVE: o servidor devolvia o MESMO index.html estático pra
 * toda rota do app, então todo link compartilhado — vitrine da loja, pedido do
 * cliente — mostrava o título e o texto da PLATAFORMA. O cliente recebia no
 * WhatsApp a confirmação do pedido dele na "Unimaxx - Mostruário" com o cartão
 * dizendo "Delivery Já — Sistema de gestão de delivery com app próprio, NFC-e
 * integrada, KDS e PDV". Além de não ser a marca da loja, é a nossa peça de
 * venda B2B aparecendo pro consumidor final — o oposto de white-label.
 *
 * Por que tem que ser no SERVIDOR: WhatsApp, Facebook e Telegram não executam
 * JavaScript. Eles leem o HTML cru da resposta. Trocar as tags via React não tem
 * efeito nenhum no cartão do link.
 *
 * Onde cada texto é editado (nada aqui é fixo no código):
 *   loja      → Painel do lojista › Configurações da loja (nome, descrição, logo)
 *   marca     → Painel admin › Marca (nome, descrição, logo)
 */
import db from './db-mysql';
import { lojaIdDoHost } from './dominios';

export interface MetaOg {
  titulo: string;
  descricao: string;
  imagem: string;
  tipo: 'website' | 'article';
}

/**
 * Rotas de 1 nível que são do APP, não slug de loja.
 *
 * Conferido contra os `<Route path>` do App.tsx: o painel admin mora em
 * `/painel-admin`, e aqui estava só `admin` — então `/painel-admin` disparava
 * busca de loja com esse slug. Consulta desperdiçada, e se alguma loja tivesse
 * esse slug o link do painel mostraria o cartão dela.
 *
 * `api` e `uploads` nunca chegam aqui (são interceptados antes), mas ficam como
 * defesa: se a ordem dos middlewares mudar, não vira busca de loja.
 */
const ROTAS_RESERVADAS = new Set([
  'conta', 'carrinho', 'pedidos', 'pedido', 'lojista', 'entregador', 'cozinha',
  'painel-admin', 'admin', 'demo', 'esqueci-senha', 'redefinir-senha',
  'uploads', 'api',
]);

type LinhaLoja = { nome: string; descricao: string | null; logo_url: string | null; capa_url: string | null };

/**
 * `status_aprovacao = 'aprovada'` e NÃO `aprovada = 1`: essa coluna não existe.
 * A primeira versão deste arquivo usava o nome errado, então toda consulta de
 * vitrine estourava erro de SQL, caía no catch e devolvia o cartão genérico — a
 * feature parecia entregue e não funcionava fora de /pedido/:id.
 */
const CAMPOS_LOJA = 'nome, descricao, logo_url, capa_url';
const SO_APROVADA = "status_aprovacao = 'aprovada'";

async function lojaPorId(id: number | string): Promise<LinhaLoja | undefined> {
  return await db.prepare(
    `SELECT ${CAMPOS_LOJA} FROM lojas WHERE id = ? AND ${SO_APROVADA}`
  ).get(id) as LinhaLoja | undefined;
}

async function lojaPorSlug(slug: string): Promise<LinhaLoja | undefined> {
  return await db.prepare(
    `SELECT ${CAMPOS_LOJA} FROM lojas WHERE slug = ? AND ${SO_APROVADA}`
  ).get(slug) as LinhaLoja | undefined;
}

async function config(chave: string): Promise<string> {
  const r = await db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave) as { valor: string } | undefined;
  return r?.valor || '';
}

/** Marca da plataforma (ou do tenant white-label) — o padrão quando não há loja. */
async function metaDaMarca(): Promise<MetaOg> {
  return {
    titulo: (await config('marca_nome')) || 'Delivery',
    descricao: await config('marca_descricao'),
    // `marca_og_image` já existia e é editável no admin (Marca) justamente pra
    // isto — imagem feita no formato do cartão. Logo é só o plano B.
    imagem: (await config('marca_og_image')) || (await config('marca_logo_url')),
    tipo: 'website',
  };
}

function metaDaLoja(loja: LinhaLoja, tipo: MetaOg['tipo'] = 'website'): MetaOg {
  return {
    titulo: loja.nome,
    // Capa antes do logo: o cartão do WhatsApp é largo, e logo quadrado pequeno
    // fica com bordas vazias enormes. Capa é a imagem feita pra esse formato.
    imagem: loja.capa_url || loja.logo_url || '',
    descricao: loja.descricao || '',
    tipo,
  };
}

/**
 * Resolve as meta tags do caminho pedido. Roda DENTRO do contexto de tenant
 * (o middleware de Host já resolveu), então as consultas caem no banco certo.
 *
 * Nunca lança: um link com preview genérico é ruim, um 500 na página é pior.
 */
export async function metaDaRota(caminho: string, host?: string): Promise<MetaOg> {
  try {
    const partes = caminho.split('/').filter(Boolean);

    /**
     * DOMÍNIO PRÓPRIO DA LOJA vence tudo — vale pros domínios de hoje e pros que
     * forem cadastrados amanhã, sem tocar em código: quem decide é a coluna
     * `dominio_personalizado`.
     *
     * Vem ANTES das regras de caminho porque em pizzariadapaula.com.br QUALQUER
     * rota é daquela loja: a raiz, /carrinho, /conta, /pedidos. Se ficasse
     * depois, /conta nesse domínio cairia no genérico e o cliente veria a marca
     * da plataforma no link do próprio site da pizzaria.
     *
     * A exceção é /pedido/:id, tratada abaixo: ali a loja é a do PEDIDO. Num
     * marketplace o cliente pede de várias lojas pelo mesmo domínio, então o
     * pedido é uma informação mais específica que o host.
     */
    const ehRotaDePedido = partes[0] === 'pedido' && !!partes[1];
    if (!ehRotaDePedido) {
      const idDoHost = await lojaIdDoHost(host);
      if (idDoHost > 0) {
        const l = await lojaPorId(idDoHost);
        if (l) return metaDaLoja(l);
      }
    }

    // /pedido/:id — o link que o cliente recebe pra acompanhar. Mostra a marca da
    // LOJA onde ele comprou, que é o que ele reconhece.
    if (partes[0] === 'pedido' && partes[1]) {
      const p = await db.prepare(
        `SELECT l.nome, l.descricao, l.logo_url, l.capa_url
           FROM pedidos p JOIN lojas l ON l.id = p.loja_id
          WHERE p.id = ?`
      ).get(partes[1]) as LinhaLoja | undefined;
      if (p) return metaDaLoja(p, 'article');
    }

    // /demo/:slug — vitrine de demonstração de uma loja.
    if (partes[0] === 'demo' && partes[1]) {
      const l = await lojaPorSlug(partes[1]);
      if (l) return metaDaLoja(l);
    }

    // /:slug ou /:id — vitrine da loja na raiz do domínio.
    if (partes.length === 1 && !ROTAS_RESERVADAS.has(partes[0])) {
      const alvo = partes[0];
      const l = /^\d+$/.test(alvo) ? await lojaPorId(alvo) : await lojaPorSlug(alvo);
      if (l) return metaDaLoja(l);
    }

    return await metaDaMarca();
  } catch {
    // Banco fora, tenant sem a tabela, slug estranho: cai no genérico.
    return { titulo: 'Delivery', descricao: '', imagem: '', tipo: 'website' };
  }
}

/** Escapa pra atributo HTML. Nome e descrição vêm do lojista — sem isto, um
 *  `"` na descrição fecharia o atributo e injetaria markup na página servida. */
function esc(v: string): string {
  return String(v || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** URL absoluta: og:image relativo é ignorado por WhatsApp e Facebook. */
function urlAbsoluta(valor: string, base: string): string {
  if (!valor) return '';
  if (/^https?:\/\//i.test(valor)) return valor;
  return base.replace(/\/$/, '') + '/' + valor.replace(/^\//, '');
}

/**
 * Injeta as tags no HTML do app. Substitui o <title> e o
 * <meta name="description"> existentes em vez de duplicar — dois títulos deixam
 * o resultado à sorte de qual o robô lê primeiro.
 */
export function injetarMeta(html: string, meta: MetaOg, urlBase: string, urlCompleta: string): string {
  const imagem = urlAbsoluta(meta.imagem, urlBase);
  const tags = [
    `<meta property="og:type" content="${meta.tipo}" />`,
    `<meta property="og:site_name" content="${esc(meta.titulo)}" />`,
    `<meta property="og:title" content="${esc(meta.titulo)}" />`,
    `<meta property="og:description" content="${esc(meta.descricao)}" />`,
    `<meta property="og:url" content="${esc(urlCompleta)}" />`,
    ...(imagem ? [
      `<meta property="og:image" content="${esc(imagem)}" />`,
      // summary_large_image sem imagem vira cartão vazio no Twitter/X.
      `<meta name="twitter:card" content="summary_large_image" />`,
    ] : [`<meta name="twitter:card" content="summary" />`]),
    `<meta name="twitter:title" content="${esc(meta.titulo)}" />`,
    `<meta name="twitter:description" content="${esc(meta.descricao)}" />`,
    ...(imagem ? [`<meta name="twitter:image" content="${esc(imagem)}" />`] : []),
  ].join('\n    ');

  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(meta.titulo)}</title>`)
    .replace(
      /<meta\s+name="description"[^>]*>/i,
      `<meta name="description" content="${esc(meta.descricao)}" />\n    ${tags}`,
    )
    // Nome do ícone na tela de início do iPhone. Estava fixo no index.html, então
    // o cliente que instalasse o app da pizzaria ficava com "Delivery Já" embaixo
    // do ícone — mesmo vazamento de white-label do cartão do link. (O manifest do
    // Android já era dinâmico; o iOS usa esta tag.)
    .replace(
      /<meta\s+name="apple-mobile-web-app-title"[^>]*>/i,
      `<meta name="apple-mobile-web-app-title" content="${esc(meta.titulo)}" />`,
    );
}

/**
 * Página servida no domínio de um cliente SUSPENSO.
 *
 * Sem marca da plataforma de propósito: o domínio é do lojista, e estampar a
 * nossa logo (ou pior, a landing de vendas) no endereço dele é constrangedor pra
 * ele e expõe preço pra concorrente. Diz o necessário e nada mais.
 *
 * HTML puro, sem depender do bundle React: o app do tenant nem deve carregar aqui.
 */
export function paginaSuspensa(nomeLoja: string): string {
  const nome = String(nomeLoja || 'Esta loja')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${nome} — temporariamente indisponível</title>
<style>
  :root { color-scheme: light dark }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; padding:24px;
         font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
         background:#0b0b0c; color:#e8e8ea }
  .caixa { max-width:30rem; text-align:center }
  h1 { font-size:1.35rem; margin:0 0 .5rem }
  p { margin:.5rem 0; color:#a9a9b2 }
  .marca { font-weight:800; font-size:1.05rem; color:#e8e8ea; margin-bottom:1.25rem }
</style>
</head><body><div class="caixa">
  <div class="marca">${nome}</div>
  <h1>Loja temporariamente indisponível</h1>
  <p>O acesso a este endereço está suspenso no momento.</p>
  <p>Se você é o responsável pela loja, entre em contato com o suporte para reativar.</p>
</div></body></html>`;
}
