/**
 * GÊMEO de `src/backend/opcoes-preco.ts` — os dois têm que mudar juntos.
 *
 * A duplicação é deliberada (mesmo caso de `lib/gtin.ts`): frontend e backend
 * compilam separados, e o servidor é quem manda no preço. Aqui a conta serve só
 * pra PRÉVIA — o que o cliente vê enquanto monta o item. Se as duas divergirem,
 * o cliente vê um preço e paga outro, que é o pior jeito de errar.
 *
 * Por isso as duas versões são curtas e idênticas de propósito: dá pra comparar
 * lado a lado sem ler o resto do sistema.
 */

export interface GrupoRegra {
  papel?: string | null;
  modo_preco?: string | null;
  max_escolhas: number;
}

export interface OpcaoRegra {
  preco_adicional_centavos: number;
  sabores?: number | null;
}

/** Quantos sabores o TAMANHO escolhido libera. `0` = ninguém definiu. */
export function saboresLiberados(
  grupos: Array<{ grupo: GrupoRegra; escolhidas: OpcaoRegra[] }>,
): number {
  for (const { grupo, escolhidas } of grupos) {
    if (grupo.papel !== 'tamanho') continue;
    for (const o of escolhidas) {
      if (o.sabores && o.sabores > 0) return o.sabores;
    }
  }
  return 0;
}

/** Limite que vale pra este grupo agora — só o de sabores depende do tamanho. */
export function maxEscolhasEfetivo(grupo: GrupoRegra, saboresPermitidos: number): number {
  if (grupo.papel === 'sabores' && saboresPermitidos > 0) return saboresPermitidos;
  return grupo.max_escolhas;
}

/** `maior`: pizza de 3 sabores custa o do mais caro. `somar`: adicionais somam. */
export function precoDoGrupo(grupo: GrupoRegra, escolhidas: OpcaoRegra[]): number {
  if (escolhidas.length === 0) return 0;
  if (grupo.modo_preco === 'maior') {
    return Math.max(...escolhidas.map(o => o.preco_adicional_centavos));
  }
  return escolhidas.reduce((s, o) => s + o.preco_adicional_centavos, 0);
}
