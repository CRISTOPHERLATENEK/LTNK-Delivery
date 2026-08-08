/**
 * Regras de preço e limite dos grupos de opções.
 *
 * Existe separado porque é conta de DINHEIRO e precisa de teste: a mesma regra
 * roda na criação do pedido (servidor, que é a verdade) e na tela do cliente
 * (prévia). Divergir entre as duas significa o cliente ver um preço e pagar
 * outro — então a regra mora num lugar só.
 */

export interface GrupoRegra {
  /** 'tamanho' | 'sabores' | '' — ver `saboresLiberados`. */
  papel?: string | null;
  /** 'maior' conta só o maior acréscimo do grupo; 'somar' (padrão) soma todos. */
  modo_preco?: string | null;
  max_escolhas: number;
}

export interface OpcaoRegra {
  preco_adicional_centavos: number;
  /** Quantos sabores esta opção libera (só nas opções de tamanho). */
  sabores?: number | null;
}

/**
 * Quantos sabores o TAMANHO escolhido libera. `0` = ninguém definiu.
 *
 * É o que substitui o `max_escolhas` fixo no grupo de sabores: numa pizzaria a
 * P aceita 1 e a G aceita 3, e esse número mora na opção de tamanho — não no
 * grupo de sabores, que não sabe qual tamanho o cliente escolheu.
 */
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

/**
 * Limite de escolhas que vale para este grupo AGORA.
 *
 * Só o grupo de sabores muda de limite conforme o tamanho; o resto usa o
 * `max_escolhas` dele. Se o tamanho não definiu nada (loja que ainda não
 * configurou), cai no `max_escolhas` — nunca em "ilimitado por acidente".
 */
export function maxEscolhasEfetivo(grupo: GrupoRegra, saboresPermitidos: number): number {
  if (grupo.papel === 'sabores' && saboresPermitidos > 0) return saboresPermitidos;
  return grupo.max_escolhas;
}

/**
 * Quanto este grupo acrescenta ao preço do item.
 *
 * `maior`: pizza de 3 sabores custa o do sabor MAIS CARO, não a soma dos três.
 * É como toda pizzaria cobra, e somar produzia um preço que não existe no
 * mundo real — três sabores de +R$10, +R$12 e +R$14 viravam +R$36 em vez de
 * +R$14.
 *
 * `somar` (padrão): adicionais, borda, bebida. Aí somar é o certo — dois bacons
 * custam dois bacons.
 */
export function precoDoGrupo(grupo: GrupoRegra, escolhidas: OpcaoRegra[]): number {
  if (escolhidas.length === 0) return 0;
  if (grupo.modo_preco === 'maior') {
    return Math.max(...escolhidas.map(o => o.preco_adicional_centavos));
  }
  return escolhidas.reduce((s, o) => s + o.preco_adicional_centavos, 0);
}
