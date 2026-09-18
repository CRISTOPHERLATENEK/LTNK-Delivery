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
import db, { comTenant, BANCO_PADRAO } from './db-mysql';
import { lojaIdDoHost } from './dominios';

export interface MetaOg {
  /**
   * O NOME. Curto, é a marca — vai no `og:site_name` e no rótulo do ícone do
   * iPhone, onde frase comprida não cabe nem faz sentido.
   */
  titulo: string;
  /**
   * O TÍTULO DA PÁGINA PARA BUSCA. Vazio = usa o nome.
   *
   * Existe porque os dois querem coisas diferentes: "Maxx Pedidos" é o que
   * identifica a marca dentro do sistema, e "Maxx Pedidos | Sistema para
   * delivery, PDV e NFC-e" é o que alguém que AINDA NÃO conhece a marca
   * digitaria no Google. Antes era um campo só, e mudar o `<title>` para o
   * segundo derramaria a frase comprida no cabeçalho do painel, no rodapé e no
   * `alt` da logo — que é onde `marca_nome` também é usado.
   */
  tituloBusca: string;
  descricao: string;
  imagem: string;
  tipo: 'website' | 'article';
  /**
   * A COR DA BARRA DO NAVEGADOR (`theme-color`), que também é a do splash do
   * app instalado. Vazio = mantém a que está no `index.html`.
   *
   * Vem junto das meta tags porque é a mesma pergunta que elas respondem — "de
   * quem é esta página?" — e tem a mesma resposta: da loja quando o domínio é
   * dela, da plataforma quando não é.
   */
  cor: string;
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

type LinhaLoja = {
  nome: string; descricao: string | null; logo_url: string | null; capa_url: string | null;
  cor_marca: string | null;
};

/**
 * `status_aprovacao = 'aprovada'` e NÃO `aprovada = 1`: essa coluna não existe.
 * A primeira versão deste arquivo usava o nome errado, então toda consulta de
 * vitrine estourava erro de SQL, caía no catch e devolvia o cartão genérico — a
 * feature parecia entregue e não funcionava fora de /pedido/:id.
 */
const CAMPOS_LOJA = 'nome, descricao, logo_url, capa_url, cor_marca';
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
    tituloBusca: await config('marca_titulo_busca'),
    /*
     * O SLOGAN É O PLANO B DA DESCRIÇÃO — mesma ideia que `metaDaLoja` já
     * aplicava à loja, que faltava aqui em cima.
     *
     * Medido em maxxpedidos.com.br em 18/09/2026: `marca_descricao` vazia no
     * banco, e o que ia pro ar era `<meta name="description" content="" />`,
     * `og:description` e `twitter:description` idem. Link mandado no WhatsApp
     * virava um cartão só com o título.
     *
     * E o texto existia o tempo todo, na linha de baixo do mesmo formulário:
     * `marca_slogan` estava preenchido ("Conheça o melhor APP de Delivery da
     * Região."). Não inventa nada — usa o que o admin já escreveu, e só quando
     * não há descrição.
     */
    descricao: (await config('marca_descricao')) || (await config('marca_slogan')),
    // `marca_og_image` já existia e é editável no admin (Marca) justamente pra
    // isto — imagem feita no formato do cartão. Logo é só o plano B.
    imagem: (await config('marca_og_image')) || (await config('marca_logo_url')),
    tipo: 'website',
    cor: await config('marca_cor_primaria'),
  };
}

function metaDaLoja(loja: LinhaLoja, tipo: MetaOg['tipo'] = 'website'): MetaOg {
  return {
    titulo: loja.nome,
    // Capa antes do logo: o cartão do WhatsApp é largo, e logo quadrado pequeno
    // fica com bordas vazias enormes. Capa é a imagem feita pra esse formato.
    imagem: loja.capa_url || loja.logo_url || '',
    /*
     * DESCRIÇÃO VAZIA TEM PLANO B, e o plano B é o nome da loja numa frase.
     *
     * Medido no Galdério em 16/09/2026: a coluna está vazia, e o resultado era
     * `<meta name="description" content="" />` — para o Google, uma página sem
     * descrição nenhuma, e para o WhatsApp um cartão só com o título. A frase
     * abaixo não inventa nada: usa o nome que a loja já tem.
     *
     * Não substitui o texto do lojista — só aparece quando não há texto.
     */
    /* A loja não tem título de busca próprio: o nome dela já é o termo que
       alguém procura ("pizzaria tal"), diferente da plataforma. */
    tituloBusca: '',
    descricao: loja.descricao || `Peça online na ${loja.nome}. Cardápio, preços e entrega.`,
    tipo,
    /* No domínio da loja, a barra do navegador é da COR DELA — é o mesmo
       white-label do título e da imagem logo acima. */
    cor: loja.cor_marca || '',
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
    /* Banco fora, tenant sem a tabela, slug estranho: cai no genérico. Cor
       vazia de propósito — sem banco não há cor da marca para saber, e manter a
       do arquivo é melhor que arriscar a errada. */
    return { titulo: 'Delivery', tituloBusca: '', descricao: '', imagem: '', tipo: 'website', cor: '' };
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
export function injetarMeta(
  html: string, meta: MetaOg, urlBase: string, urlCompleta: string,
  /* Tags de indexação (canonical, JSON-LD) — ver seo.ts. Lista vazia mantém o
     comportamento anterior, que é o que vale para toda rota que não é vitrine. */
  extras: string[] = [],
): string {
  const imagem = urlAbsoluta(meta.imagem, urlBase);
  /*
   * DUAS COISAS DIFERENTES, e por isso duas variáveis.
   *
   * `titulo` é o NOME da marca e fica onde nome é o que se espera: no
   * `og:site_name` (o "de qual site é este link") e no rótulo do ícone na tela
   * de início do iPhone, que tem espaço para poucas letras.
   *
   * `paraBusca` é o título da PÁGINA, e vai onde alguém lê para decidir se
   * clica: a aba do navegador, o resultado do Google e o cartão do link. Quem
   * ainda não conhece a marca não procura pelo nome dela.
   */
  const paraBusca = meta.tituloBusca.trim() || meta.titulo;
  const tags = [
    `<meta property="og:type" content="${meta.tipo}" />`,
    `<meta property="og:site_name" content="${esc(meta.titulo)}" />`,
    `<meta property="og:title" content="${esc(paraBusca)}" />`,
    `<meta property="og:description" content="${esc(meta.descricao)}" />`,
    `<meta property="og:url" content="${esc(urlCompleta)}" />`,
    ...(imagem ? [
      `<meta property="og:image" content="${esc(imagem)}" />`,
      // summary_large_image sem imagem vira cartão vazio no Twitter/X.
      `<meta name="twitter:card" content="summary_large_image" />`,
    ] : [`<meta name="twitter:card" content="summary" />`]),
    `<meta name="twitter:title" content="${esc(paraBusca)}" />`,
    `<meta name="twitter:description" content="${esc(meta.descricao)}" />`,
    ...(imagem ? [`<meta name="twitter:image" content="${esc(imagem)}" />`] : []),
    ...extras,
  ].join('\n    ');

  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(paraBusca)}</title>`)
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
    )
    /*
     * A COR DA BARRA DO NAVEGADOR SEGUE A MARCA, e estava fixa no `index.html`.
     *
     * Medido em maxxpedidos.com.br em 18/09/2026: `theme-color` saía `#dc2640`
     * — o vermelho que era o padrão antigo — enquanto a cor escolhida no painel
     * era `#ffa200`. O laranja pintava o site inteiro e parava exatamente na
     * borda da página: a barra do Chrome no celular e o splash do app instalado
     * continuavam vermelhos.
     *
     * E o defeito não era de um cliente: a cor é configurável por tenant, e a
     * tag ignorava a escolha de TODOS. É o mesmo vazamento de white-label que o
     * título e o `apple-mobile-web-app-title` acima já consertaram.
     *
     * Cor vazia mantém a do arquivo, e só hexadecimal entra — um valor torto no
     * banco produziria uma tag inválida, e tag inválida é pior que a cor velha.
     */
    .replace(
      /<meta\s+name="theme-color"[^>]*>/i,
      /^#[0-9a-f]{3,8}$/i.test(meta.cor.trim())
        ? `<meta name="theme-color" content="${esc(meta.cor.trim())}" />`
        : '$&',
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
/**
 * Contato de suporte da PLATAFORMA, pra estampar na página de suspensão.
 *
 * Lê do banco MASTER explicitamente, com `comTenant`: a página de suspensão é
 * servida ANTES do contexto de tenant existir (é justamente o caso em que nenhum
 * tenant ativo casou com o host), então `db` sem contexto lançaria.
 *
 * Reusa `suporte_email`/`suporte_telefone`, que já existem e já são editáveis em
 * Painel admin › Marca — criar campo novo daria duas fontes pro mesmo dado e uma
 * delas ficaria desatualizada.
 *
 * Nunca lança: sem contato configurado, a página sai sem o bloco em vez de dar 500.
 */
export async function contatoSuporte(): Promise<{ email: string; telefone: string }> {
  try {
    return await comTenant(BANCO_PADRAO, async () => {
      const ler = async (chave: string) => {
        const r = await db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave) as { valor: string } | undefined;
        return (r?.valor || '').trim();
      };
      return { email: await ler('suporte_email'), telefone: await ler('suporte_telefone') };
    });
  } catch {
    return { email: '', telefone: '' };
  }
}

/** Só dígitos, pro link do WhatsApp. Assume Brasil quando falta o país. */
function whatsappUrl(telefone: string): string {
  const d = telefone.replace(/\D/g, '');
  if (d.length < 10) return '';
  return `https://wa.me/${d.length <= 11 ? '55' + d : d}`;
}

/**
 * Página servida no domínio de um cliente SUSPENSO.
 *
 * Sem marca da plataforma de propósito: o domínio é do lojista, e estampar a
 * nossa logo (ou pior, a landing de vendas) no endereço dele é constrangedor pra
 * ele e expõe preço pra concorrente. Diz o necessário e nada mais.
 *
 * O CONTATO vem do admin (ver `contatoSuporte`). Sem ele, a página dizia "entre
 * em contato com o suporte" sem dizer COM QUEM — o lojista ficava sabendo que
 * está suspenso e sem saber pra quem ligar, o que só atrasa o pagamento.
 *
 * HTML puro, sem depender do bundle React: o app do tenant nem deve carregar aqui.
 */
export function paginaSuspensa(nomeLoja: string, contato?: { email: string; telefone: string }): string {
  const nome = esc(nomeLoja || 'Esta loja');
  const zap = whatsappUrl(contato?.telefone || '');
  const email = (contato?.email || '').trim();

  const acoes = [
    zap ? `<a class="botao" href="${esc(zap)}">Falar no WhatsApp</a>` : '',
    email ? `<a class="link" href="mailto:${esc(email)}">${esc(email)}</a>` : '',
    !zap && !email ? '<p>Entre em contato com o suporte para reativar.</p>' : '',
  ].filter(Boolean).join('');

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
  .botao { display:inline-block; margin-top:1rem; padding:.75rem 1.25rem; border-radius:.75rem;
           background:#e8e8ea; color:#0b0b0c; font-weight:700; text-decoration:none }
  .link { display:block; margin-top:.75rem; color:#a9a9b2 }
</style>
</head><body><div class="caixa">
  <div class="marca">${nome}</div>
  <h1>Loja temporariamente indisponível</h1>
  <p>O acesso a este endereço está suspenso no momento.</p>
  <p>Se você é o responsável pela loja, fale com o suporte para reativar.</p>
  ${acoes}
</div></body></html>`;
}
