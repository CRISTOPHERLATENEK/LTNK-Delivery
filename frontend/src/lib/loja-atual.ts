/**
 * Lembra a última loja visitada pelo cliente (sessionStorage) para que
 * "Início" e o logo do header voltem pro cardápio em vez de sempre caírem
 * na landing da plataforma — "/" só mostra o cardápio quando o tenant tem
 * uma "loja padrão" configurada (ver PaginaVitrine); sem isso configurado,
 * "/" é sempre a landing de marketing, o que fazia "Início" tirar o cliente
 * do meio da compra.
 */
const CHAVE = 'ultima_loja_id';

export function registrarLojaAtual(id: string | number) {
  sessionStorage.setItem(CHAVE, String(id));
}

export function rotaInicioCliente(): string {
  const id = sessionStorage.getItem(CHAVE);
  return id ? `/loja/${id}` : '/';
}
