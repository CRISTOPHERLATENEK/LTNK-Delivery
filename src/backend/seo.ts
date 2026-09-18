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
  /** Coordenada geocodificada do endereço. Vira `geo` no dado estruturado. */
  lat?: number | null;
  lon?: number | null;
}

const CAMPOS = `id, nome, slug, descricao, endereco, horario_funcionamento,
                logo_url, capa_url, dominio_personalizado, lat, lon`;

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
  /*
   * `/slug` NÃO ENTRA MAIS.
   *
   * A vitrine também responde nele, mas é a MESMA página — e o próprio
   * cabeçalho desta função diz que declarar endereço que devolve a mesma
   * página é o jeito mais rápido de o site ser classificado como conteúdo
   * duplicado. A regra estava escrita e quebrada na linha seguinte.
   *
   * O endereço continua funcionando para quem já tem o link; o que muda é
   * parar de OFERECÊ-LO ao buscador como se fosse outra página. O canonical
   * dele aponta para a raiz — ver `canonical`.
   */
  /*
   * AS PÁGINAS DE CONTEÚDO SÓ EXISTEM ONDE NÃO HÁ LOJA.
   *
   * No domínio de um cliente, `/planos` não é a nossa página de planos — é o
   * endereço da loja dele, e oferecê-lo ao buscador mandaria o Google a uma
   * página que não é a que estamos declarando. Elas são da PLATAFORMA.
   *
   * Prioridade maior que a dos documentos legais porque é conteúdo que se
   * quer que apareça, não obrigação que se cumpre.
   */
  if (!loja) {
    urls.push({ loc: `${base}/planos`, prioridade: '0.8' });
  }
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

  /*
   * ─────────── `/slug` APONTA PARA A RAIZ, e isto estava só no comentário.
   *
   * O `sitemap` já dizia, por escrito, "canonical apontando para a raiz" — e
   * nada aqui fazia isso. Medido em produção:
   *
   *   /                 → canonical /
   *   /galderiobebidas  → canonical /galderiobebidas
   *
   * São a MESMA página (a raiz do tenant mostra o cardápio direto, ver
   * `vitrine.tsx`), com dois endereços, os dois no sitemap, cada um se
   * declarando oficial. Isso é conteúdo duplicado do manual: o Google escolhe
   * um por conta própria e divide entre os dois o pouco de sinal que uma loja
   * nova tem — links, cliques, tempo na página.
   *
   * A raiz vence porque é o endereço que o lojista divulga, o que está no QR
   * code e o que o cliente digita.
   */
  const daLoja = (loja?.slug || '').trim().toLowerCase();
  let alvo = semQuery;
  if (daLoja) {
    try {
      const u = new URL(semQuery);
      if (decodeURIComponent(u.pathname).replace(/^\//, '').toLowerCase() === daLoja) {
        alvo = `${u.protocol}//${u.host}/`;
      }
    } catch { /* URL estranha segue como veio */ }
  }

  const proprio = (loja?.dominio_personalizado || '').trim().toLowerCase();
  if (!proprio) return alvo;
  try {
    const u = new URL(alvo);
    if (u.hostname.toLowerCase() === proprio) return alvo;
    return `https://${proprio}${u.pathname}`;
  } catch {
    return alvo;
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
/** Dia da semana em português → o código de duas letras do schema.org. */
const DIAS: Array<[RegExp, string]> = [
  [/^(domingo|dom)$/, 'Su'],
  [/^(segunda|segunda-feira|seg)$/, 'Mo'],
  [/^(terca|terça|terca-feira|terça-feira|ter)$/, 'Tu'],
  [/^(quarta|quarta-feira|qua)$/, 'We'],
  [/^(quinta|quinta-feira|qui)$/, 'Th'],
  [/^(sexta|sexta-feira|sex)$/, 'Fr'],
  [/^(sabado|sábado|sab|sáb)$/, 'Sa'],
];

function codigoDoDia(bruto: string): string | null {
  const limpo = bruto.trim().toLowerCase();
  for (const [re, cod] of DIAS) if (re.test(limpo)) return cod;
  return null;
}

/** "11h", "11", "11:00", "01:00", "9h30" → "11:00" / "09:30". */
function hora(bruto: string): string | null {
  const m = /^(\d{1,2})\s*(?:[h:]\s*(\d{2})?)?$/.exec(bruto.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (!(h >= 0 && h <= 23) || !(min >= 0 && min <= 59)) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * O HORÁRIO LIVRE DO LOJISTA NO FORMATO DO SCHEMA.ORG, OU NADA.
 *
 * O campo é texto solto ("Segunda a Domingo 11h às 01:00", "Ter a Dom, 18:00 às
 * 23:30") porque é o que aparece no cardápio para o cliente ler. O schema.org
 * quer "Mo-Su 11:00-01:00".
 *
 * TRADUZ SÓ O PADRÃO QUE RECONHECE POR INTEIRO, e devolve `null` em qualquer
 * outro caso. Meio-termo aqui é o pior dos dois: o Google mostraria ao lado do
 * link um horário que a loja não pratica, e o cliente chegaria na porta fechada
 * — o tipo de erro que não volta como reclamação, volta como cliente que não
 * volta. Não reconhecendo, o campo some e o resto do cartão continua de pé.
 */
export function horarioSchema(bruto: string | null | undefined): string | null {
  const texto = (bruto || '').trim();
  if (!texto) return null;
  /* "Segunda a Domingo 11h às 01:00" / "Seg a Sáb, das 9h às 18h" */
  const m = /^([a-zà-ú-]+)\s*(?:a|à|até|-)\s*([a-zà-ú-]+)[\s,]*(?:das\s*)?(\d{1,2}(?:\s*[h:]\s*\d{2})?h?)\s*(?:às|as|ate|até|-|a)\s*(\d{1,2}(?:\s*[h:]\s*\d{2})?h?)\s*$/i
    .exec(texto.replace(/\s+/g, ' '));
  if (!m) return null;
  const de = codigoDoDia(m[1]);
  const ate = codigoDoDia(m[2]);
  const abre = hora(m[3].replace(/h$/i, ''));
  const fecha = hora(m[4].replace(/h$/i, ''));
  if (!de || !ate || !abre || !fecha) return null;
  return `${de}-${ate} ${abre}-${fecha}`;
}

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
  /*
   * O HORÁRIO SÓ SAI SE DER PARA TRADUZIR — ver `horarioSchema`.
   *
   * Antes ia o texto cru do lojista ("Segunda a Domingo 11h às 01:00"). O
   * `openingHours` do schema.org tem formato ("Mo-Su 11:00-01:00"), e valor
   * fora do formato não é ignorado: derruba a validação do bloco INTEIRO, e
   * junto vão embora o endereço e a imagem que o campo devia acompanhar.
   *
   * Não dando para traduzir, o campo simplesmente não sai — o resto do cartão
   * continua valendo, que é o oposto do que acontecia.
   */
  const horario = horarioSchema(loja.horario_funcionamento);
  if (horario) dados.openingHours = horario;

  /*
   * A COORDENADA JÁ EXISTIA NO BANCO, geocodificada quando o lojista salvou o
   * endereço — e nunca tinha saído daqui. É ela que põe a loja no mapa do
   * "bebida perto de mim", que no celular é quase toda a busca local.
   */
  if (typeof loja.lat === 'number' && typeof loja.lon === 'number'
      && Number.isFinite(loja.lat) && Number.isFinite(loja.lon)) {
    dados.geo = { '@type': 'GeoCoordinates', latitude: loja.lat, longitude: loja.lon };
  }

  return `<script type="application/ld+json">${JSON.stringify(dados)
    /* `</script>` dentro de string JSON fecharia a tag aqui. */
    .replace(/</g, '\\u003c')}</script>`;
}
