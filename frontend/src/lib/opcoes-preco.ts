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

/* ─────────────────────────────────────────────────────────────────────────
 * SEÇÕES DENTRO DO GRUPO ('Tradicionais', 'Especiais', 'Doces'…)
 *
 * Pizzaria separa sabor por faixa, mas o LIMITE e o PREÇO são do conjunto: três
 * grupos de sabor deixariam a pizza de 3 sabores aceitar 3 de cada, e o
 * modo_preco 'maior' — que é calculado dentro do grupo — somaria três "maiores".
 * Então a seção separa na TELA, dentro de um grupo só.
 * ───────────────────────────────────────────────────────────────────────── */

export interface OpcaoComSecao {
  secao?: string | null;
}

/**
 * Agrupa as opções por seção, preservando a ordem em que chegaram.
 *
 * As SEM seção vêm primeiro, com rótulo vazio: é o estado de toda opção
 * cadastrada antes desta coluna, e empurrá-las pro fim mudaria a ordem de um
 * cardápio que já está no ar.
 *
 * A ordem das seções é a de PRIMEIRA APARIÇÃO, não alfabética: 'Tradicionais'
 * antes de 'Especiais' é escolha do lojista (ele ordena as opções), e alfabético
 * inverteria isso sem ele pedir.
 */
export function agruparPorSecao<T extends OpcaoComSecao>(opcoes: T[]): Array<{ secao: string; opcoes: T[] }> {
  const ordem: string[] = [];
  const mapa = new Map<string, T[]>();
  for (const o of opcoes) {
    const secao = (o.secao || '').trim();
    if (!mapa.has(secao)) { mapa.set(secao, []); ordem.push(secao); }
    mapa.get(secao)!.push(o);
  }
  // Sem seção em NENHUMA opção: devolve um bloco só, sem rótulo — a tela não
  // deve ganhar cabeçalho por causa de um recurso que a loja não usa.
  return ordem.map(secao => ({ secao, opcoes: mapa.get(secao)! }));
}
