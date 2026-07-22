/**
 * Lembra a última loja visitada pelo cliente (sessionStorage) para que
 * "Início" e o logo do header voltem pro cardápio em vez de sempre caírem
 * na landing da plataforma — "/" só mostra o cardápio quando o tenant tem
 * uma "loja padrão" configurada (ver PaginaVitrine); sem isso configurado,
 * "/" é sempre a landing de marketing, o que fazia "Início" tirar o cliente
 * do meio da compra.
 */
const CHAVE = 'ultima_loja_id';
const CHAVE_COR = 'ultima_loja_cor';

export function registrarLojaAtual(id: string | number) {
  sessionStorage.setItem(CHAVE, String(id));
}

/**
 * Guarda a cor de marca da última loja vista (por loja.tsx/pedido.tsx, que
 * têm o dado fresco da API) — páginas que não sabem a cor da loja em si
 * (carrinho, lista de pedidos, conta) reaplicam esse valor em vez de cair na
 * cor padrão da plataforma.
 */
export function registrarCorLoja(cor: string, corSecundaria?: string | null) {
  sessionStorage.setItem(CHAVE_COR, JSON.stringify({ cor, corSecundaria: corSecundaria || null }));
}

export function corLojaAtual(): { cor: string; corSecundaria: string | null } | null {
  const bruto = sessionStorage.getItem(CHAVE_COR);
  if (!bruto) return null;
  try { return JSON.parse(bruto); } catch { return null; }
}

/**
 * @param lojaDominio Id da loja já amarrada ao domínio atual (marca.loja_id),
 *   se houver — nesse caso a própria "/" já mostra o cardápio, então prefere
 *   a raiz limpa em vez de "/:id" quando é a mesma loja.
 */
export function rotaInicioCliente(lojaDominio?: number): string {
  const id = sessionStorage.getItem(CHAVE);
  if (!id) return '/';
  if (lojaDominio && Number(id) === lojaDominio) return '/';
  return `/${id}`;
}

/** Id numérico da loja que o cliente está navegando/comprando agora, se houver. */
export function lojaAtualId(): number | null {
  const id = sessionStorage.getItem(CHAVE);
  return id ? Number(id) : null;
}
