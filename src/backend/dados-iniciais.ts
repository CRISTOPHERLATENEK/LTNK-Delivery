/**
 * OS DADOS QUE O APP PRECISA NO BOOT, JÁ DENTRO DO HTML.
 *
 * O QUE ERA. Medido no navegador do dono da plataforma, na vitrine da Galderio:
 *
 *   0 ─── 187 ms   HTML
 *   189 ─ 305 ms   todo o JS
 *   305 ─ 593 ms   ~290 ms de React acordando
 *   593 ─ 720 ms   /api/lojas/1 e /api/tema
 *
 * As duas chamadas são a ÚLTIMA coisa antes de aparecer produto na tela — e o
 * servidor já sabia as duas respostas aos 187 ms, quando entregou o HTML. São
 * ~127 ms de ida e volta gastos para buscar o que já estava na mão.
 *
 * O QUE É AGORA. O mesmo lugar que já reescreve o HTML por requisição (og.ts,
 * que injeta as meta tags de compartilhamento) passa a injetar também um
 * `window.__DADOS_INICIAIS__` com a marca e, quando a rota é de uma loja, o
 * cardápio dela. O app nasce com os dados e renderiza sem pedir nada.
 *
 * NÃO É CACHE E NÃO SUBSTITUI AS ROTAS. O `index.html` é `no-store`, então o
 * que vai aqui é sempre fresco; e as rotas `/api/tema` e `/api/lojas/:id`
 * continuam existindo e sendo usadas — por quem navega dentro do app sem
 * recarregar, e pelo React Query revalidando em segundo plano. Isto encurta o
 * primeiro desenho, não vira fonte de verdade.
 *
 * FALHA EM SILÊNCIO, DE PROPÓSITO. Qualquer erro montando os dados devolve
 * `null` e o HTML sai sem o bloco: o app volta a buscar pela rota, exatamente
 * como antes. Uma loja que não existe, um banco lento ou um tenant sem
 * configuração não podem transformar o HTML da SPA num 500 — é justamente a
 * SPA que precisa carregar para mostrar "loja não encontrada".
 */
import { slugReservado } from './slug-reservado';

export interface DadosIniciais {
  tema?: unknown;
  cardapio?: unknown;
  /** O caminho para o qual estes dados valem. A tela confere antes de usar. */
  rota: string;
}

/**
 * Serializa para dentro de uma tag `<script>` sem deixar escapar o contexto.
 *
 * `JSON.stringify` sozinho NÃO basta: uma string de dado contendo `</script>`
 * fecha a tag e o resto vira HTML — é injeção de script a partir do nome de um
 * produto. `<!--` abre comentário e engole o resto da página. Os três escapes
 * abaixo são o conjunto mínimo conhecido para esse contexto.
 *
 * U+2028 e U+2029 entram porque sao quebras de linha validas em JavaScript
 * (e nao em JSON): sem escapar, um nome de produto com um deles quebra o script
 * em duas linhas no meio de uma string. Sao escritos como escape e nao como o
 * caractere literal de proposito: caractere invisivel em codigo-fonte some numa
 * conversao de encoding sem ninguem ver.
 */
export function paraScript(valor: unknown): string {
  return JSON.stringify(valor)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * O primeiro segmento do caminho é slug de loja?
 *
 * A vitrine mora na raiz do domínio (`/minha-loja`), então qualquer caminho de
 * UM segmento é candidato. Os nomes reservados (`/carrinho`, `/conta`,
 * `/termos`…) não são — e a lista é a mesma que o painel usa para recusar slug,
 * porque duas listas divergiriam e o sintoma seria dado da loja errada no HTML.
 */
export function slugDaRota(caminho: string): string | null {
  const partes = caminho.split('?')[0].split('/').filter(Boolean);
  if (partes.length !== 1) return null;
  const slug = decodeURIComponent(partes[0]);
  if (slugReservado(slug)) return null;
  /* Arquivo estático que escapou do middleware não é loja. */
  if (slug.includes('.')) return null;
  return slug;
}

/**
 * LIMITE DE TAMANHO DO CARDÁPIO INJETADO.
 *
 * O cardápio da Galderio são ~20 KB; o do Mostruário, ~70 KB. Injetar é trocar
 * uma ida ao servidor (~70 ms) por bytes no HTML — que é `no-store` e portanto
 * baixado inteiro em toda visita, sem cache nenhum. Acima de um certo tamanho a
 * troca deixa de compensar, principalmente em rede móvel.
 *
 * 128 KB de JSON cru (que o gzip reduz a uma fração) cobre com folga um
 * cardápio grande e barra o caso patológico — a loja com mil produtos e
 * descrições longas, onde o HTML dobraria de tamanho para economizar 70 ms.
 */
export const LIMITE_CARDAPIO_BYTES = 128 * 1024;

/**
 * Monta os dados da rota pedida. Nunca lança.
 */
export async function montarDadosIniciais(caminho: string, host?: string): Promise<DadosIniciais | null> {
  try {
    /*
     * IMPORT DINAMICO de proposito. `rotas/publico` arrasta a conexao com o
     * banco; importando no topo, este modulo deixaria de ser carregavel num
     * teste unitario — e as funcoes puras aqui (`paraScript`, `slugDaRota`,
     * `injetarDados`) sao justamente as que mais precisam de teste, porque
     * um erro nelas e injecao de script ou dado da loja errada.
     */
    const { montarTema, montarCardapio } = await import('./rotas/publico');
    const dados: DadosIniciais = { rota: caminho.split('?')[0] };

    /* A marca vale para QUALQUER rota: é ela que pinta a cor e escreve o nome
       antes de o app existir. */
    dados.tema = await montarTema(host);

    const slug = slugDaRota(caminho);
    if (slug) {
      try {
        const cardapio = await montarCardapio(slug);
        const tamanho = Buffer.byteLength(JSON.stringify(cardapio), 'utf8');
        if (tamanho <= LIMITE_CARDAPIO_BYTES) dados.cardapio = cardapio;
      } catch {
        /* Loja inexistente ou suspensa: segue sem o cardápio. O app pede pela
           rota e mostra o "loja não encontrada" dele. */
      }
    }
    return dados;
  } catch {
    return null;
  }
}

/**
 * Injeta o bloco no HTML, imediatamente antes de `</head>`.
 *
 * ANTES DO BUNDLE, e não depois: o script do app está no `<body>`, então um
 * bloco no `<head>` já executou quando o React monta. Depois do bundle seria
 * tarde — as consultas já teriam saído, que é justamente o que se quer evitar.
 */
export function injetarDados(html: string, dados: DadosIniciais | null): string {
  if (!dados) return html;
  const bloco = `<script>window.__DADOS_INICIAIS__=${paraScript(dados)}</script>`;
  return html.replace('</head>', `    ${bloco}\n  </head>`);
}
