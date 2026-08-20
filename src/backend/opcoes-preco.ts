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

/* ─────────────────────────────────────────────────────────────────────────
 * O PREÇO QUE O CARD DEVE MOSTRAR
 *
 * O card mostrava `preco_centavos` seco. Num produto com grupo OBRIGATÓRIO cujas
 * opções todas têm acréscimo — a pizza em que todo tamanho soma — esse número é
 * um preço que ninguém consegue pagar: o mínimo real é o preço mais o menor
 * acréscimo obrigatório. O cliente via R$ 39,90, abria o item e o mínimo era
 * R$ 54,90.
 *
 * Duas coisas saem daqui:
 *  - `precoMinimoItem`: o menor total possível, contando os grupos obrigatórios.
 *  - `precoVariavel`: se existe mais de um total possível. É o que decide entre
 *    mostrar "R$ 39,90" e "a partir de R$ 39,90" — e "a partir de" num item de
 *    preço fixo é ruído, então a distinção importa.
 * ───────────────────────────────────────────────────────────────────────── */

export interface GrupoParaMinimo extends GrupoRegra {
  obrigatorio: 0 | 1 | boolean;
  opcoes: OpcaoRegra[];
}

/**
 * Quanto este grupo acrescenta, no mínimo, se for obrigatório.
 *
 * Grupo opcional contribui 0 — o cliente pode não escolher nada. Grupo
 * obrigatório contribui o MENOR acréscimo entre as opções dele, e isso vale
 * tanto pra `somar` quanto pra `maior`: escolher só a opção mais barata dá o
 * mesmo mínimo nos dois modos.
 *
 * Grupo obrigatório SEM opções contribui 0 em vez de quebrar — cardápio pela
 * metade é estado real (o lojista criou o grupo e ainda não cadastrou os itens),
 * e não é o card do cliente que deve estourar por causa disso.
 */
function minimoDoGrupo(grupo: GrupoParaMinimo): number {
  if (!grupo.obrigatorio) return 0;
  const precos = (grupo.opcoes || []).map(o => o.preco_adicional_centavos || 0);
  if (precos.length === 0) return 0;
  return Math.min(...precos);
}

/** O menor total possível do item, já contando os grupos obrigatórios. */
export function precoMinimoItem(precoBase: number, grupos: GrupoParaMinimo[] = []): number {
  return grupos.reduce((total, g) => total + minimoDoGrupo(g), precoBase);
}

/**
 * O total do item pode variar?
 *
 * Varia quando existe QUALQUER opção com acréscimo maior que o mínimo daquele
 * grupo — ou seja, quando o cliente consegue chegar a mais de um total. Um
 * grupo obrigatório em que todas as opções custam o mesmo NÃO faz variar: o
 * preço é único, só é mais alto que o preço base.
 *
 * Grupo opcional com qualquer acréscimo faz variar (pode escolher ou não).
 */
export function precoVariavel(grupos: GrupoParaMinimo[] = []): boolean {
  return grupos.some(g => {
    const precos = (g.opcoes || []).map(o => o.preco_adicional_centavos || 0);
    if (precos.length === 0) return false;
    const min = g.obrigatorio ? Math.min(...precos) : 0;
    return precos.some(p => p > min);
  });
}
