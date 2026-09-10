/**
 * OS DADOS QUE O SERVIDOR MANDOU DENTRO DO HTML.
 *
 * O servidor injeta `window.__DADOS_INICIAIS__` com a marca e, quando a rota
 * pedida é a de uma loja, o cardápio dela (ver `src/backend/dados-iniciais.ts`).
 * Sem isso, o app só descobria as duas coisas depois de baixar e executar o
 * bundle inteiro — medido no navegador do dono da plataforma: as chamadas
 * começavam aos 593 ms e terminavam aos 720 ms, e até lá a tela era esqueleto.
 *
 * SÓ VALEM PARA A ROTA EM QUE A PÁGINA ABRIU. O bloco carrega o caminho para o
 * qual foi montado, e quem consome confere. Sem essa checagem, navegar de uma
 * loja para outra dentro do app (sem recarregar) mostraria o cardápio da
 * primeira na página da segunda — dado certo no lugar errado, que é pior que
 * dado nenhum porque parece que funcionou.
 *
 * SÃO CONSUMIDOS UMA VEZ. Depois de lidos, somem. O que veio no HTML é uma foto
 * do instante da carga; a partir daí quem manda são as rotas de API, que o
 * React Query já revalida. Deixar o bloco vivo faria uma volta ao início da
 * navegação ressuscitar dado velho.
 */

interface Bloco {
  tema?: unknown;
  cardapio?: unknown;
  rota?: string;
}

declare global {
  interface Window { __DADOS_INICIAIS__?: Bloco }
}

/** Lê o bloco e o apaga. Devolve `null` quando não veio nada. */
function consumir(): Bloco | null {
  if (typeof window === 'undefined') return null;
  const b = window.__DADOS_INICIAIS__;
  if (!b || typeof b !== 'object') return null;
  delete window.__DADOS_INICIAIS__;
  return b;
}

/*
 * Lido no MÓDULO, não a cada chamada: o `delete` acima só funciona uma vez, e
 * dois consumidores (o tema e a página da loja) precisam ver o mesmo bloco.
 */
const BLOCO = consumir();

/** A marca vinda do HTML, ou `null`. Vale para qualquer rota. */
export function temaInicial<T>(): T | null {
  return (BLOCO?.tema as T) ?? null;
}

/**
 * O cardápio vindo do HTML, SE for o da loja pedida.
 *
 * `idOuSlug` é o que está na URL agora. A comparação é contra o caminho para o
 * qual o servidor montou o bloco — não contra o slug de dentro do cardápio,
 * porque a URL aceita tanto id numérico quanto slug e os dois precisam casar
 * com o que a página está pedindo.
 */
export function cardapioInicial<T>(idOuSlug: string | undefined): T | null {
  if (!idOuSlug || !BLOCO?.cardapio || !BLOCO.rota) return null;
  const daRota = BLOCO.rota.split('/').filter(Boolean);
  if (daRota.length !== 1) return null;
  if (decodeURIComponent(daRota[0]) !== idOuSlug) return null;
  return BLOCO.cardapio as T;
}
