/**
 * Domínio(s) base da plataforma — de onde saem os endereços `<slug>.<base>`.
 *
 * ACEITA UMA LISTA, não um valor só. Trocar o domínio principal com um valor
 * único quebra em silêncio todo endereço já entregue: no instante da troca,
 * `cris.dominioantigo` deixa de ser reconhecido como o cliente Cris e cai no
 * tenant padrão — sem erro, sem log, mostrando a loja errada.
 *
 * O PRIMEIRO da lista é o CANÔNICO: é ele que aparece no painel, nos links que
 * se entrega ao cliente e nos redirecionamentos. Os demais continuam sendo
 * reconhecidos, o que dá uma transição sem data marcada — dá pra aposentar o
 * antigo quando quiser, tirando ele da lista.
 */

/** Lê a variável de ambiente em lista normalizada (minúsculo, sem `www.`). */
export function basesDe(valor: string | undefined): string[] {
  return (valor || '')
    .split(',')
    .map(d => d.trim().toLowerCase().replace(/^www\./, ''))
    .filter(Boolean);
}

/**
 * O slug do tenant embutido num host, ou null quando o host não é subdomínio
 * de nenhuma das bases.
 *
 * Recusa subdomínio de segundo nível (`a.b.base`): `resolverPorHost` casa o
 * resultado com a coluna `slug`, e um ponto ali nunca casaria — mas devolver
 * "a.b" faria a consulta rodar à toa a cada requisição de nomes que não são
 * cliente nenhum.
 */
export function slugDoHost(host: string, bases: string[]): string | null {
  for (const base of bases) {
    if (!base || !host.endsWith('.' + base)) continue;
    const sub = host.slice(0, -(base.length + 1));
    if (sub && !sub.includes('.')) return sub;
  }
  return null;
}

/** Endereço `https://<slug>.<base canônica>`, ou null sem base configurada. */
export function urlDeSlug(slug: string, bases: string[]): string | null {
  return bases[0] ? `https://${slug}.${bases[0]}` : null;
}
