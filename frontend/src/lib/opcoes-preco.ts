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
  /**
   * Necessário pra distinguir REPETIÇÃO de sabor diferente: 2/4 do mesmo sabor
   * de +R$16 custa +R$16 uma vez, não duas. Opcional pra não quebrar chamada
   * antiga, que nunca repete opção.
   */
  id?: number;
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
  const partes = contarFracoes(escolhidas);
  const totalFracoes = escolhidas.length;

  switch (grupo.modo_preco) {
    /*
     * `maior`: pizza de 3 sabores custa o do sabor MAIS CARO, não a soma dos
     * três. Somar produzia um preço que não existe no mundo real — três sabores
     * de +R$10, +R$12 e +R$14 viravam +R$36 em vez de +R$14.
     */
    case 'maior':
      return Math.max(...partes.map(p => p.opcao.preco_adicional_centavos));

    /*
     * `proporcional`: o acréscimo entra na medida do espaço que o sabor ocupa.
     * Meia pizza de um sabor de +R$16 custa +R$8. Depende das frações existirem
     * — antes delas, esta política não tinha o que calcular.
     *
     * Arredonda no FIM, sobre a soma, e não a cada sabor: arredondar por parcela
     * faz três frações de 1/3 de +R$10 darem 3×334 = R$10,02.
     */
    case 'proporcional': {
      const centavos = partes.reduce(
        (s, p) => s + p.opcao.preco_adicional_centavos * (p.fracoes / totalFracoes), 0);
      return Math.round(centavos);
    }

    /*
     * `somar` (padrão): 100% do acréscimo de cada sabor DISTINTO — é o que a
     * pizzaria brasileira cobra, e o que o app de referência do mercado faz
     * (R$ 94,90 + R$ 16,00 = R$ 110,90 mesmo o sabor ocupando 1/2).
     *
     * Por sabor distinto e não por fração: 2/4 do mesmo sabor de +R$16 custa
     * +R$16 uma vez. Cobrar por fração seria dobrar o acréscimo por causa de
     * uma escolha de tamanho de pedaço.
     *
     * Pra adicional e borda (onde não há repetição) o resultado é idêntico ao
     * de antes desta mudança.
     */
    default:
      return partes.reduce((s, p) => s + p.opcao.preco_adicional_centavos, 0);
  }
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

/* ─────────────────────────────────────────────────────────────────────────
 * FRAÇÕES — o mesmo sabor ocupando mais de um pedaço
 *
 * Antes, cada sabor entrava uma vez só: a escolha era uma lista de ids e o teste
 * era `includes`. Não existia "2/4 de calabresa + 1/4 bacon + 1/4 frango", que é
 * o pedido mais comum de pizza grande.
 *
 * A REPRESENTAÇÃO É REPETIÇÃO NA LISTA: escolher calabresa duas vezes põe o id
 * dela duas vezes. O comprimento da lista continua sendo o número de frações,
 * então o limite (`escolhidas.length > max`) continua valendo sem mudar nada.
 *
 * `id` entrou em OpcaoRegra porque a política de preço precisa saber o que é
 * REPETIÇÃO e o que é sabor DIFERENTE: 2/4 de um sabor de +R$16 custa +R$16 uma
 * vez, não duas.
 * ───────────────────────────────────────────────────────────────────────── */

/** Uma opção e quantas frações ela ocupa. */
export interface FracaoEscolhida {
  opcao: OpcaoRegra;
  fracoes: number;
}

/**
 * Agrupa a lista (com repetição) em opções distintas + quantas frações cada uma
 * ocupa, preservando a ordem de primeira escolha.
 *
 * Sem `id`, cai no índice — assim as chamadas antigas, que nunca repetem,
 * continuam funcionando com 1 fração cada.
 */
export function contarFracoes(escolhidas: OpcaoRegra[]): FracaoEscolhida[] {
  const ordem: Array<string | number> = [];
  const mapa = new Map<string | number, FracaoEscolhida>();
  escolhidas.forEach((opcao, i) => {
    const chave = opcao.id ?? `#${i}`;
    const ja = mapa.get(chave);
    if (ja) { ja.fracoes += 1; return; }
    mapa.set(chave, { opcao, fracoes: 1 });
    ordem.push(chave);
  });
  return ordem.map(k => mapa.get(k)!);
}
