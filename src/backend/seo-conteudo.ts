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
export function blocoDeConteudo(
  loja: LojaParaConteudo | null,
  itens: ItemParaSeo[],
): string {
  if (!loja?.nome) return '';

  const p: string[] = [];
  p.push('<div style="max-width:52rem;margin:0 auto;padding:2rem 1rem;'
    + 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917;line-height:1.5">');

  /*
   * UM <h1> SÓ, e é o nome da loja. É o sinal mais forte que a página tem, e o
   * app não tinha nenhum — o título vivia só no `<title>`.
   */
  p.push(`<h1 style="font-size:1.6rem;margin:0 0 .25rem">${esc(loja.nome)}</h1>`);
  if (loja.descricao) p.push(`<p style="margin:0 0 .75rem">${esc(loja.descricao)}</p>`);

  /* Endereço e horário em texto, e não só dentro do JSON-LD: o dado
     estruturado alimenta o cartão do resultado, o texto é o que ranqueia a
     busca por bairro e por "aberto agora". */
  const contato: string[] = [];
  if (loja.endereco) contato.push(`<strong>Endereço:</strong> ${esc(loja.endereco)}`);
  if (loja.horario_funcionamento) contato.push(`<strong>Horário:</strong> ${esc(loja.horario_funcionamento)}`);
  if (contato.length) {
    p.push(`<p style="margin:0 0 1.5rem;color:#57534e;font-size:.95rem">${contato.join(' &middot; ')}</p>`);
  }

  let bytes = Buffer.byteLength(p.join(''), 'utf8');
  for (const grupo of porCategoria(itens)) {
    const linhas = grupo.itens.map(i => {
      const desc = i.descricao ? ` &mdash; ${esc(i.descricao.slice(0, 120))}` : '';
      return `<li style="margin:.15rem 0">${esc(i.nome)} &middot; ${brl(i.preco_centavos)}${desc}</li>`;
    });
    const bloco = `<h2 style="font-size:1.1rem;margin:1.25rem 0 .35rem">${esc(grupo.nome)}</h2>`
      + `<ul style="margin:0;padding-left:1.1rem">${linhas.join('')}</ul>`;
    const custo = Buffer.byteLength(bloco, 'utf8');
    /* CATEGORIA INTEIRA OU NENHUMA: meia lista de energéticos é pior que
       nenhuma — parece cardápio incompleto para quem lê e para quem indexa. */
    if (bytes + custo > LIMITE_CONTEUDO_BYTES) break;
    p.push(bloco);
    bytes += custo;
  }

  p.push('</div>');
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
