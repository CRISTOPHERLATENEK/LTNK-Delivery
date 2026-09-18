/**
 * O QUE O BUSCADOR LÊ QUANDO ABRE A LOJA.
 *
 * Medido em produção, no HTML cru de galderio-bebidas.maxxpedidos.com.br:
 *
 *   texto visível no `<body>`: 0 caracteres
 *
 * Zero. O `<head>` estava impecável — título, descrição, Open Graph, canonical,
 * JSON-LD — e o corpo era `<div id="root"></div>`. Tudo o que a loja vende
 * existia apenas depois de o navegador baixar e executar um bundle de 400 KB.
 *
 * O Google até executa JavaScript, mas isso o põe numa segunda fila, que pode
 * demorar dias e que ele abandona quando a página custa caro. E mesmo quando
 * roda, o que sobra para ranquear é o nome da loja: as 569 palavras que
 * interessam — "balde de whisky", "energético", "Jack Daniel's" — nunca
 * chegaram a ser texto em lugar nenhum.
 *
 * ────────────────────────── NÃO É CLOAKING ──────────────────────────
 *
 * O bloco vai DENTRO do `#root`, visível, com o mesmo conteúdo que o app
 * mostra. Quando o React monta, ele substitui — é assim que `createRoot`
 * funciona. Ninguém vê uma coisa e o robô outra; o que existe é uma versão em
 * texto simples da mesma página, que fica no ar até o bundle chegar.
 *
 * E ela SUBSTITUI A TELA EM BRANCO: era isso que estava ali nesse intervalo.
 * Quem entra com rede ruim passa a ler o cardápio antes de o app existir, e
 * quem desligou o JavaScript passa a conseguir ler a loja.
 */

/** Um item do cardápio, reduzido ao que vira texto. */
export interface ItemParaSeo {
  nome: string;
  categoria: string | null;
  descricao: string | null;
  preco_centavos: number;
}

export interface LojaParaConteudo {
  nome: string;
  descricao: string | null;
  endereco: string | null;
  horario_funcionamento: string | null;
}

/**
 * TETO DE BYTES DO BLOCO.
 *
 * O HTML é `no-store`: baixa inteiro em toda visita, sem cache. Uma loja com
 * mil produtos e descrições longas dobraria a página para agradar o buscador —
 * e pagaria isso no 3G de todo cliente. 48 KB cobrem algumas centenas de itens
 * e barram o caso patológico; o corte é por CATEGORIA inteira, para não haver
 * lista pela metade.
 */
export const LIMITE_CONTEUDO_BYTES = 48 * 1024;

function esc(v: string): string {
  return String(v || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function brl(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Agrupa preservando a ordem em que as categorias aparecem — que é a ordem do
 * cardápio, escolhida pelo lojista, e não uma alfabética que ninguém pediu.
 */
function porCategoria(itens: ItemParaSeo[]): Array<{ nome: string; itens: ItemParaSeo[] }> {
  const mapa = new Map<string, ItemParaSeo[]>();
  for (const i of itens) {
    const cat = (i.categoria || 'Outros').trim() || 'Outros';
    const lista = mapa.get(cat);
    if (lista) lista.push(i); else mapa.set(cat, [i]);
  }
  return [...mapa].map(([nome, lista]) => ({ nome, itens: lista }));
}

/**
 * O bloco em HTML, ou string vazia quando não há loja.
 *
 * Estilo INLINE e sóbrio de propósito: o CSS do app ainda não carregou quando
 * isto aparece, e uma folha de estilo só para este bloco seria mais um pedido
 * de rede na frente do que importa.
 */
/**
 * O ESTILO DO BLOCO, embutido.
 *
 * `<style>` e não `style=` em cada tag porque agora tem `prefers-color-scheme`
 * e `:hover`, que atributo inline não faz. Continua sem pedido de rede: são
 * 700 bytes no mesmo HTML.
 *
 * FUNDO E COR PRÓPRIOS, explícitos. Sem isso o bloco herdava o tema do app —
 * e no escuro saía texto quase preto sobre fundo quase preto. Foi o que o
 * lojista viu no primeiro F5.
 */
const ESTILO = `<style>
#seo-inicial{background:#fff;color:#1c1917;min-height:60vh;
 font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.5}
#seo-inicial .i{max-width:40rem;margin:0 auto;padding:4rem 1.25rem}
#seo-inicial h1{font-size:1.5rem;margin:0 0 .35rem;letter-spacing:-.01em}
#seo-inicial p{margin:0 0 .6rem}
#seo-inicial .ap{color:#57534e;font-size:.9rem}
#seo-inicial summary{cursor:pointer;color:#57534e;font-size:.9rem;margin-top:1.5rem}
#seo-inicial h2{font-size:1rem;margin:1.1rem 0 .3rem}
#seo-inicial ul{margin:0;padding-left:1.1rem;font-size:.9rem}
#seo-inicial li{margin:.12rem 0}
@media (prefers-color-scheme:dark){
 #seo-inicial{background:#0c0a09;color:#e7e5e4}
 #seo-inicial .ap,#seo-inicial summary{color:#a8a29e}
}
/*
 * ─────────── A VARIANTE "TELA DE CARREGAMENTO" (landing) ───────────
 *
 * "isso aqui me irrita, tem como isso não aparecer quando carrega?"
 *
 * NÃO, e é importante dizer por quê: o texto TEM que estar no HTML — é ele que
 * o buscador lê, e é a coisa que a landing não tinha. Escondê-lo por CSS seria
 * texto invisível para pessoa e visível para robô, que é o padrão que o Google
 * pune. O que dá para mudar é a APARÊNCIA do instante em que ele existe.
 *
 * E o que incomodava não era ele existir: era parecer PÁGINA QUEBRADA. Texto
 * cru alinhado à esquerda, sem marca nenhuma, no lugar onde deveria haver um
 * site. Centralizado, com a logo em cima e o resto discreto, o mesmo conteúdo
 * lê como "carregando" — que é o que de fato está acontecendo.
 *
 * Só a landing usa esta variante. O bloco da loja fica como está: ele já foi
 * ajustado depois do retorno do lojista e ninguém reclamou dele.
 */
/* A TELA INTEIRA, e centralizado: com 60vh o bloco terminava no meio e sobrava
   uma faixa do fundo do body embaixo — o que parece página cortada, exatamente
   a impressão que esta variante existe para desfazer.
   (Sem crase neste arquivo: o CSS mora dentro de um template literal.) */
#seo-inicial.carregando{min-height:100vh;display:flex;align-items:center;justify-content:center}
#seo-inicial.carregando .i{max-width:34rem;text-align:center;padding:2rem 1.25rem}
#seo-inicial.carregando .logo{max-height:56px;max-width:220px;width:auto;margin:0 auto .9rem;display:block}
#seo-inicial.carregando h1{font-size:1.15rem;font-weight:600;opacity:.75}
#seo-inicial.carregando p{font-size:.95rem;opacity:.6}
#seo-inicial.carregando summary{display:inline-block;margin-top:2rem;opacity:.55}
/* Conteúdo aberto volta a ser texto de leitura: centralizar lista é ruim de ler. */
#seo-inicial.carregando details[open] summary{margin-bottom:.5rem}
#seo-inicial.carregando details ul,#seo-inicial.carregando details h2{text-align:left}
#seo-inicial .giro{width:22px;height:22px;margin:1.6rem auto 0;border-radius:50%;
 border:2px solid currentColor;border-top-color:transparent;opacity:.25;
 animation:seogiro .8s linear infinite}
@keyframes seogiro{to{transform:rotate(360deg)}}
/* Quem pediu menos animação no sistema não recebe um anel girando na cara. */
@media (prefers-reduced-motion:reduce){#seo-inicial .giro{animation:none}}
</style>`;

/**
 * O bloco em HTML, ou string vazia quando não há loja.
 */
export function blocoDeConteudo(
  loja: LojaParaConteudo | null,
  itens: ItemParaSeo[],
): string {
  if (!loja?.nome) return '';

  const p: string[] = [ESTILO, '<div id="seo-inicial"><div class="i">'];

  /*
   * UM <h1> SÓ, e é o nome da loja. É o sinal mais forte que a página tem, e o
   * app não tinha nenhum — o título vivia só no `<title>`.
   */
  p.push(`<h1>${esc(loja.nome)}</h1>`);
  if (loja.descricao) p.push(`<p>${esc(loja.descricao)}</p>`);

  /* Endereço e horário em texto, e não só dentro do JSON-LD: o dado
     estruturado alimenta o cartão do resultado, o texto é o que ranqueia a
     busca por bairro e por "aberto agora". */
  const contato: string[] = [];
  if (loja.endereco) contato.push(`<strong>Endereço:</strong> ${esc(loja.endereco)}`);
  if (loja.horario_funcionamento) contato.push(`<strong>Horário:</strong> ${esc(loja.horario_funcionamento)}`);
  if (contato.length) p.push(`<p class="ap">${contato.join(' &middot; ')}</p>`);

  /*
   * ─────────── O CARDÁPIO FICA ATRÁS DE UM <details> ───────────
   *
   * A primeira versão despejava a lista inteira aberta, e foi exatamente isso
   * que o lojista viu ao dar F5: vinte mil caracteres de cardápio em texto
   * cru piscando antes de o app montar. Não parecia carregamento, parecia
   * defeito — e a tela que ele mostra para o cliente é a primeira impressão
   * da loja dele.
   *
   * `<details>` NÃO É ESCONDER DO BUSCADOR. É o mesmo padrão de um acordeão de
   * FAQ: o texto está no HTML, o elemento é padrão, e qualquer pessoa abre com
   * um clique. O Google indexa conteúdo de acordeão — o que ele penaliza é
   * texto invisível por CSS, que não é o caso.
   *
   * O que sobra visível é o nome, a descrição e o endereço: uma tela de
   * carregamento com a cara da loja, no lugar da tela em branco que havia
   * antes deste trabalho.
   */
  const corpo: string[] = [];
  let bytes = 0;
  for (const grupo of porCategoria(itens)) {
    const linhas = grupo.itens.map(i => {
      const desc = i.descricao ? ` &mdash; ${esc(i.descricao.slice(0, 120))}` : '';
      return `<li>${esc(i.nome)} &middot; ${brl(i.preco_centavos)}${desc}</li>`;
    });
    const bloco = `<h2>${esc(grupo.nome)}</h2><ul>${linhas.join('')}</ul>`;
    const custo = Buffer.byteLength(bloco, 'utf8');
    /* CATEGORIA INTEIRA OU NENHUMA: meia lista de energéticos é pior que
       nenhuma — parece cardápio incompleto para quem lê e para quem indexa. */
    if (bytes + custo > LIMITE_CONTEUDO_BYTES) break;
    corpo.push(bloco);
    bytes += custo;
  }
  if (corpo.length) {
    p.push(`<details><summary>Ver o cardápio</summary>${corpo.join('')}</details>`);
  }

  p.push('</div></div>');
  return p.join('');
}

/* ───────────────────── A LANDING DA PLATAFORMA ───────────────────── */

/**
 * O QUE O BUSCADOR LÊ NA LANDING — e por que ela ficou de fora até agora.
 *
 * `blocoSeoDoTenant` devolve vazio quando não há loja (server.ts), então todo
 * este trabalho valia para `galderio-bebidas.maxxpedidos.com.br` e não valia
 * para `maxxpedidos.com.br`. Medido no HTML público em 18/09/2026:
 *
 *   nenhum <h1>, nenhum <h2>, nenhum parágrafo
 *   texto fora de script/style: 310 caracteres — e eram COMENTÁRIOS do código
 *
 * Ou seja: a página que vende a plataforma era, para o Google, uma folha em
 * branco. O diagnóstico que chegou de fora ("o site não aparece em buscas") é
 * consequência disto, não uma causa separada.
 *
 * O TEXTO JÁ EXISTIA, e é este o ponto: 24 campos `landing_*` preenchidos no
 * banco — recursos, planos, dúvidas, como funciona. Nada aqui é redação nova;
 * é o que o admin escreveu no editor e o que o visitante já lê na tela. Pelo
 * mesmo motivo do bloco da loja, NÃO É CLOAKING: mesmo conteúdo, dentro do
 * `#root`, substituído quando o React monta.
 */
export interface LandingParaConteudo {
  /** Logo da marca. Vazio = a tela de carregamento fica só com o texto. */
  logo: string;
  titulo: string;
  subtitulo: string;
  recursos: Array<{ titulo: string; desc?: string }>;
  comoFunciona: Array<{ titulo: string; desc?: string }>;
  planos: Array<{ nome: string; preco?: string; recursos?: string[] }>;
  faq: Array<{ pergunta: string; resposta: string }>;
  segmentos: string[];
}

/** `<h2>` + lista, ou nada quando a lista está vazia. */
function secao(titulo: string, linhas: string[]): string {
  return linhas.length ? `<h2>${esc(titulo)}</h2><ul>${linhas.join('')}</ul>` : '';
}

export function blocoDaLanding(d: LandingParaConteudo | null): string {
  if (!d?.titulo) return '';

  const p: string[] = [ESTILO, '<div id="seo-inicial" class="carregando"><div class="i">'];
  /* A logo vem primeiro e é o que dá cara de marca ao instante de carregamento.
     `alt` vazio porque o nome já está no `<h1>` logo abaixo: repetir faria o
     leitor de tela anunciar a marca duas vezes seguidas. */
  if (d.logo) p.push(`<img class="logo" src="${esc(d.logo)}" alt="" />`);
  p.push(`<h1>${esc(d.titulo)}</h1>`);
  if (d.subtitulo) p.push(`<p>${esc(d.subtitulo)}</p>`);

  /*
   * O MESMO `<details>` DO BLOCO DA LOJA, e pela mesma lição: a primeira versão
   * de lá despejava tudo aberto, e o que o lojista viu no F5 foi um muro de
   * texto cru piscando antes do app montar — parecia defeito, não carregamento.
   * Visível fica a chamada; o resto abre em um clique e o buscador lê igual.
   */
  const corpo: string[] = [];
  let bytes = 0;
  const juntar = (bloco: string) => {
    if (!bloco) return;
    const custo = Buffer.byteLength(bloco, 'utf8');
    if (bytes + custo > LIMITE_CONTEUDO_BYTES) return;
    corpo.push(bloco);
    bytes += custo;
  };

  const linhaTituloDesc = (i: { titulo: string; desc?: string }) =>
    `<li>${esc(i.titulo)}${i.desc ? ` &mdash; ${esc(i.desc)}` : ''}</li>`;

  juntar(secao('O que o sistema faz', d.recursos.map(linhaTituloDesc)));
  juntar(secao('Como funciona', d.comoFunciona.map(linhaTituloDesc)));
  juntar(secao('Planos', d.planos.map(pl => {
    /* Os recursos do plano entram na mesma linha: é o texto que responde "o que
       vem no plano", e é por ele que alguém chega pesquisando. */
    const itens = (pl.recursos || []).length ? ` &mdash; ${esc((pl.recursos || []).join(', '))}` : '';
    return `<li>${esc(pl.nome)}${pl.preco ? ` &middot; ${esc(pl.preco)}` : ''}${itens}</li>`;
  })));
  juntar(secao('Para que tipo de negócio', d.segmentos.map(s => `<li>${esc(s)}</li>`)));
  /*
   * A FAQ POR ÚLTIMO E INTEIRA — pergunta E resposta.
   *
   * É o texto mais valioso da página para busca: são as frases que as pessoas
   * realmente digitam ("precisa de CNPJ", "tem taxa por pedido", "funciona com
   * a minha impressora"), com a resposta ao lado.
   */
  juntar(secao('Dúvidas frequentes', d.faq.map(f =>
    `<li><strong>${esc(f.pergunta)}</strong> ${esc(f.resposta)}</li>`)));

  if (corpo.length) {
    p.push(`<details><summary>Ver o que o sistema faz</summary>${corpo.join('')}</details>`);
  }

  /* O anel por último: é ele que transforma "página de texto" em "está
     carregando" na leitura de quem chega. Some junto com o resto quando o React
     monta — não é o spinner do app, é o do instante que antecede o app. */
  p.push('<div class="giro" aria-hidden="true"></div>');

  p.push('</div></div>');
  return p.join('');
}

/**
 * Põe o bloco dentro do `#root`.
 *
 * DENTRO, e não antes: assim quem limpa é o próprio React, sem uma linha de
 * JavaScript escrita para isso. `createRoot(...).render()` esvazia o
 * contêiner antes de desenhar — o bloco vive exatamente até o app existir.
 *
 * HTML sem `#root` sai como veio. Não é hipótese teórica: é o que acontece se
 * alguém mudar o `index.html`, e cair aqui não pode derrubar a página.
 */
export function injetarConteudo(html: string, bloco: string): string {
  if (!bloco) return html;
  const alvo = '<div id="root"></div>';
  if (!html.includes(alvo)) return html;
  return html.replace(alvo, `<div id="root">${bloco}</div>`);
}
