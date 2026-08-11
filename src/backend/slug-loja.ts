/**
 * Slug (endereço) de uma loja a partir do nome dela.
 *
 * A loja criada junto com o cliente nascia com `slug` NULL: sem slug e sem
 * domínio próprio, ela não tinha endereço nenhum — nem `/nome-da-loja` nem
 * nada. Gerar aqui, na criação, é o que faz o cliente já nascer acessível.
 *
 * Módulo puro porque as regras se contradizem em silêncio: o formato aceito
 * pelo painel do lojista (mínimo 3 caracteres, sem começar ou terminar em
 * hífen), a lista de nomes que colidem com rotas do app, e a unicidade. Um
 * slug inválido gerado aqui só apareceria quando o lojista tentasse editá-lo e
 * o painel recusasse o valor que o próprio sistema criou.
 */

/**
 * Nomes que NÃO podem virar slug de loja porque são rotas reais do app — um
 * `/carrinho` de loja engoliria a página do carrinho.
 *
 * Espelha SLUGS_RESERVADOS em rotas/lojista.ts.
 */
export const SLUGS_RESERVADOS = new Set([
  'demo', 'carrinho', 'pedidos', 'pedido', 'conta', 'esqueci-senha',
  'redefinir-senha', 'lojista', 'entregador', 'cozinha', 'painel-admin', 'api',
]);

/** Formato aceito pelo painel do lojista — mantido idêntico de propósito. */
const FORMATO = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

/**
 * Transforma um nome em slug candidato: sem acento, minúsculo, só letras,
 * números e hífen. Devolve '' quando não sobra nada usável.
 */
export function slugDeNome(nome: string): string {
  const base = (nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    // O corte em 60 pode deixar um hífen na ponta.
    .replace(/-+$/g, '');
  return FORMATO.test(base) ? base : '';
}

/**
 * Slug livre para este nome, dado o que já existe.
 *
 * Nome curto ("Bar", "Zé") ou só de símbolos não passa no formato — nesses
 * casos cai em `loja-<id>`, que é feio mas funciona, em vez de deixar a loja
 * sem endereço. Colisão e nome reservado ganham sufixo numérico.
 */
export function slugUnico(nome: string, existentes: Iterable<string>, idDaLoja: number): string {
  const usados = new Set(existentes);
  const base = slugDeNome(nome);
  const candidato = base && !SLUGS_RESERVADOS.has(base) ? base : `loja-${idDaLoja}`;

  if (!usados.has(candidato) && !SLUGS_RESERVADOS.has(candidato)) return candidato;
  for (let i = 2; i < 100; i++) {
    const tentativa = `${candidato}-${i}`;
    if (!usados.has(tentativa)) return tentativa;
  }
  // 99 lojas com o mesmo nome no mesmo cliente: o id é único por definição.
  return `loja-${idDaLoja}`;
}
