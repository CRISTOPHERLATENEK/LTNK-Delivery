/**
 * O QUE O GOOGLE PRECISA PARA SABER QUE A LOJA EXISTE.
 *
 * ────────────────────────── O ESTADO MEDIDO ─────────────────────────────────
 *
 * Em 16/09/2026, pedindo a vitrine do Galdério como Googlebot:
 *
 *   <title> .................. GALDERIO BEBIDAS      ✔ (o og.ts já resolvia)
 *   Open Graph ............... completo              ✔
 *   <meta description> ....... VAZIA                 ✘
 *   robots.txt ............... 404                   ✘
 *   sitemap.xml .............. 404                   ✘
 *   canonical ................ não existia           ✘
 *   dados estruturados ....... não existiam          ✘
 *
 * E a busca por "galderio bebidas delivery" não devolvia a loja — devolvia a
 * bebida "Trago do Galdério" em marketplaces.
 *
 * Sem `sitemap.xml` o Google não tem por onde COMEÇAR: a vitrine é um app que
 * monta o cardápio por JavaScript, e sem um endereço declarado ele nem entra na
 * fila de renderização.
 *
 * ──────────────────── POR QUE O CANONICAL É O CUIDADO ───────────────────────
 *
 * Canonical errado TIRA a loja do índice — é a única coisa aqui que pode
 * piorar o que já existe. Por isso a regra é a mais conservadora possível:
 *
 *   - a página aponta para ELA MESMA (a URL pedida, sem query);
 *   - EXCETO quando a loja tem domínio próprio cadastrado e está sendo servida
 *     por outro host: aí a versão oficial é o domínio dela, e o subdomínio da
 *     plataforma deixa de competir com ele pela mesma loja.
 *
 * Nunca se aponta para um domínio que a loja não tem.
 */
import db from './db-mysql';
import { lojaIdDoHost } from './dominios';

/** Os dados públicos da loja que a indexação usa. */
export interface LojaParaSeo {
  id: number;
  nome: string;
  slug: string;
  descricao: string | null;
  endereco: string | null;
  horario_funcionamento: string | null;
  logo_url: string | null;
  capa_url: string | null;
  dominio_personalizado: string | null;
}

const CAMPOS = `id, nome, slug, descricao, endereco, horario_funcionamento,
                logo_url, capa_url, dominio_personalizado`;

/**
 * A loja deste host, se houver.
 *
 * Nunca lança: indexação é acessório, e um erro aqui não pode derrubar a página
 * que o cliente está tentando abrir para comprar.
 */
export async function lojaDoHost(host?: string): Promise<LojaParaSeo | null> {
  try {
    const id = await lojaIdDoHost(host);
    if (id > 0) {
      const l = await db.prepare(
        `SELECT ${CAMPOS} FROM lojas WHERE id = ? AND status_aprovacao = 'aprovada'`
      ).get(id) as LojaParaSeo | undefined;
      if (l) return l;
    }
    /*
     * SEM DOMÍNIO PRÓPRIO, A LOJA DO TENANT É A ÚNICA QUE EXISTE.
     *
     * `lojaIdDoHost` só sabe responder por `dominio_personalizado`; no
     * subdomínio da plataforma (galderio-bebidas.maxxpedidos.com.br) quem já
     * escolheu o banco foi o middleware de Host. Então dentro deste tenant a
     * loja aprovada é ela — e é justamente o caso de TODAS as lojas hoje, que
     * é onde o robots e o sitemap mais fazem falta.
     */
    const unica = await db.prepare(
      `SELECT ${CAMPOS} FROM lojas WHERE status_aprovacao = 'aprovada' ORDER BY id LIMIT 1`
    ).get() as LojaParaSeo | undefined;
    return unica || null;
  } catch {
    return null;
  }
}

/** As áreas que NUNCA devem ser rastreadas — painéis e caminhos de sessão. */
const PROIBIDO = [
  '/api/', '/lojista', '/entregador', '/cozinha', '/painel-admin', '/revenda',
  '/conta', '/carrinho', '/pedidos', '/pedido/', '/esqueci-senha', '/redefinir-senha',
];

/**
 * O `robots.txt` do host.
 *
 * `/uploads` fica LIBERADO de propósito: são as fotos dos produtos, e é por elas
 * que a loja aparece na busca por imagens — que para comida e bebida é metade do
 * tráfego de descoberta.
 *
 * Sem loja (host da plataforma, ou tenant sem loja aprovada) o arquivo continua
 * saindo: o que muda é não ter linha de sitemap.
 */
export function robots(base: string, temLoja: boolean): string {
  const linhas = ['User-agent: *'];
  for (const p of PROIBIDO) linhas.push(`Disallow: ${p}`);
  linhas.push('Allow: /');
  if (temLoja) linhas.push('', `Sitemap: ${base}/sitemap.xml`);
  return linhas.join('\n') + '\n';
}

/** Escapa texto para dentro de XML — nome de loja com "&" quebraria o arquivo. */
function escX(v: string): string {
  return String(v || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * O `sitemap.xml` do host.
 *
 * SÓ ENTRA O QUE EXISTE COMO ENDEREÇO DE VERDADE. As rotas do app são poucas
 * (a vitrine na raiz, a vitrine por slug, termos e privacidade) — produto não
 * tem URL própria neste sistema, e declarar endereço que devolve a mesma página
 * é o jeito mais rápido de o Google classificar o site como conteúdo duplicado.
 */
export function sitemap(base: string, loja: LojaParaSeo | null): string {
  const hoje = new Date().toISOString().slice(0, 10);
  const urls: Array<{ loc: string; prioridade: string }> = [
    { loc: `${base}/`, prioridade: '1.0' },
  ];
  /* A vitrine também responde em /slug. É a mesma página, então ela entra com
     prioridade menor e com canonical apontando para a raiz. */
  if (loja?.slug) urls.push({ loc: `${base}/${loja.slug}`, prioridade: '0.8' });
  urls.push({ loc: `${base}/termos`, prioridade: '0.2' });
  urls.push({ loc: `${base}/privacidade`, prioridade: '0.2' });

  const corpo = urls.map(u =>
    `  <url>\n    <loc>${escX(u.loc)}</loc>\n    <lastmod>${hoje}</lastmod>\n` +
    `    <priority>${u.prioridade}</priority>\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${corpo}\n</urlset>\n`;
}

/**
 * A URL oficial desta página.
 *
 * Ver o cabeçalho do arquivo: auto-referência, e só sai disso quando a loja tem
 * domínio próprio e está sendo servida por outro host.
 */
export function canonical(urlCompleta: string, loja: LojaParaSeo | null): string {
  const semQuery = urlCompleta.split('?')[0].split('#')[0];
  const proprio = (loja?.dominio_personalizado || '').trim().toLowerCase();
  if (!proprio) return semQuery;
  try {
    const u = new URL(semQuery);
    if (u.hostname.toLowerCase() === proprio) return semQuery;
    return `https://${proprio}${u.pathname}`;
  } catch {
    return semQuery;
  }
}

/**
 * O CARTÃO DA LOJA NO RESULTADO DE BUSCA (JSON-LD).
 *
 * É o que faz o Google mostrar endereço e horário ao lado do link em vez de só
 * o título — e é o mesmo dado que alimenta o painel lateral no celular, que é
 * onde quase todo mundo procura "bebida perto de mim".
 *
 * Só sai com o que a loja realmente preencheu: `Store` sem endereço é melhor
 * que `Store` com endereço inventado, e campo vazio em dado estruturado é
 * motivo de o Google descartar o bloco inteiro.
 */
export function dadosEstruturados(loja: LojaParaSeo | null, base: string): string {
  if (!loja) return '';
  const abs = (v: string | null) =>
    !v ? '' : /^https?:\/\//i.test(v) ? v : base.replace(/\/$/, '') + '/' + v.replace(/^\//, '');

  const dados: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: loja.nome,
    url: base + '/',
  };
  if (loja.descricao) dados.description = loja.descricao;
  const imagem = abs(loja.capa_url) || abs(loja.logo_url);
  if (imagem) dados.image = imagem;
  if (abs(loja.logo_url)) dados.logo = abs(loja.logo_url);
  if (loja.endereco) dados.address = { '@type': 'PostalAddress', streetAddress: loja.endereco };
  /* `horario_funcionamento` é texto livre do lojista ("Segunda a Domingo 11h às
     01:00"). Vai como `openingHours` cru, que aceita string — traduzir para o
     formato "Mo-Su 11:00-01:00" exigiria interpretar português, e errar o
     horário no resultado da busca é pior que não ter horário. */
  if (loja.horario_funcionamento) dados.openingHours = loja.horario_funcionamento;

  return `<script type="application/ld+json">${JSON.stringify(dados)
    /* `</script>` dentro de string JSON fecharia a tag aqui. */
    .replace(/</g, '\\u003c')}</script>`;
}
