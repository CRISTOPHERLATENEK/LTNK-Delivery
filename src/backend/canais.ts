/**
 * CANAIS DE LIBERAÇÃO — como uma novidade chega até os lojistas.
 *
 * Cada loja fica num canal: `estavel` (o padrão), `beta` ou `teste`. Uma
 * funcionalidade nova nasce em `teste`, sobe para `beta` quando aguenta uso
 * real, e vira `estavel` quando não há mais o que descobrir. Quem está em
 * estável só vê o que já foi provado nos outros dois.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O CANAL NÃO GOVERNA SEGURANÇA. Isto é a regra mais importante do arquivo.
 *
 * Correção de segurança sai para TODO MUNDO no mesmo deploy, sem passar por
 * canal nenhum. É por isso que este desenho é um binário só servindo todos os
 * clientes, e não três versões do código rodando lado a lado: com três
 * versões, uma falha de segurança precisaria ser corrigida, construída e
 * publicada três vezes, e o canal mais lento seria exatamente a janela que o
 * atacante usa. Manter versões paralelas é confortável até o dia do incidente.
 *
 * Então: `funcionalidadeLiberada` decide se um RECURSO aparece. Nunca a use
 * para decidir autenticação, permissão, validação de entrada, limite de
 * requisição ou qualquer coisa cuja ausência seja uma brecha.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const CANAIS = ['estavel', 'beta', 'teste'] as const;
export type Canal = typeof CANAIS[number];

/**
 * Quanto MAIOR o número, mais coisa a loja enxerga.
 *
 * `teste` contém `beta`, que contém `estavel`. Não são três conjuntos
 * separados: são três profundidades do mesmo conjunto. Se fossem separados,
 * uma loja em teste deixaria de ver o que já é estável — e o lojista que topou
 * testar seria punido perdendo funcionalidade que todo mundo tem.
 */
const PROFUNDIDADE: Record<Canal, number> = { estavel: 0, beta: 1, teste: 2 };

export const ROTULO_CANAL: Record<Canal, string> = {
  estavel: 'Recomendado',
  beta: 'Beta',
  teste: 'Teste',
};

export const DESCRICAO_CANAL: Record<Canal, string> = {
  estavel: 'Só o que já foi provado em beta e teste. É o padrão de todo cliente novo.',
  beta: 'Recebe as novidades antes, depois de passarem pelo teste. Pode encontrar aresta.',
  teste: 'Recebe tudo assim que existe, inclusive o que ainda vai mudar. Para uso interno.',
};

/** O canal gravado, ou o padrão. Valor estranho no banco cai em `estavel`. */
export function canalValido(bruto: unknown): Canal {
  const v = String(bruto ?? '').trim().toLowerCase();
  return (CANAIS as readonly string[]).includes(v) ? v as Canal : 'estavel';
}

export interface Funcionalidade {
  /** O canal MÍNIMO em que ela aparece. */
  canal: Canal;
  titulo: string;
  /** Por que ela ainda não é estável — some quando vira `estavel`. */
  porque?: string;
  /**
   * Quando ela entrou no canal atual (AAAA-MM-DD).
   *
   * Existe para uma pergunta que ninguém conseguia responder: "há quanto tempo
   * isso está em beta?". Sem ela, funcionalidade em canal vira gaveta — fica
   * ali para sempre porque nada lembra de decidir. A tela mostra "em beta há 40
   * dias", e quarenta dias parados numa tela incomodam o suficiente para
   * alguém promover ou desistir.
   */
  desde: string;
}

/** Há quantos dias esta funcionalidade está no canal em que está. */
export function diasNoCanal(chave: string, agora = Date.now()): number {
  const f = (FUNCIONALIDADES as Record<string, Funcionalidade>)[chave];
  if (!f?.desde) return 0;
  const t = Date.parse(`${f.desde}T00:00:00Z`);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((agora - t) / 86_400_000));
}

/**
 * O CATÁLOGO. Mora no código, não no banco, e por dois motivos.
 *
 * O primeiro é que a chave é usada em `if`s espalhados pelo servidor: no banco,
 * um erro de digitação viraria funcionalidade desligada em silêncio, e o
 * TypeScript não teria como avisar.
 *
 * O segundo é que promover uma funcionalidade de canal É UMA MUDANÇA DE
 * COMPORTAMENTO para milhares de lojas. Isso merece commit, revisão e a
 * possibilidade de voltar atrás com `git revert` — não um clique numa tela às
 * onze da noite.
 */
export const FUNCIONALIDADES = {
  /*
   * AS QUATRO SUBIRAM DE BETA PARA ESTAVEL EM 14/09/2026, de uma vez, por
   * decisao do Cristopher: o que tinha subido para beta tinha que chegar ao
   * Recomendado.
   *
   * O QUE ISSO MUDA, EXATAMENTE: cada uma destas chaves esconde um AJUSTE na
   * tela do Maxx Gestao (e a rota que grava esse ajuste). Promover faz o
   * controle APARECER para toda loja — nao liga nada. O valor de cada ajuste
   * continua como esta gravado, e so muda se o lojista mexer.
   *
   * O `porque` saiu junto: ele existia para responder "por que isto ainda nao
   * e estavel?", pergunta que deixou de existir.
   */
  'erp-auto-emitir': {
    canal: 'estavel',
    titulo: 'Emitir a NFC-e automaticamente no Maxx Gestão',
    desde: '2026-09-14',
  },
  'erp-modelo-documento': {
    canal: 'estavel',
    titulo: 'Escolher como o pedido entra no Maxx Gestão (Pedido ou Pré-Venda)',
    desde: '2026-09-14',
  },
  'erp-status-documento': {
    canal: 'estavel',
    titulo: 'Escolher em que status o pedido fica no Maxx Gestão (Rascunho ou Emitido)',
    desde: '2026-09-14',
  },
  'erp-caixa': {
    canal: 'estavel',
    titulo: 'Enviar o pedido para um caixa do Maxx Gestão',
    desde: '2026-09-14',
  },
  /*
   * NASCE EM BETA, e nao em estavel junto das outras quatro.
   *
   * As quatro subiram porque ja tinham rodado em beta. Esta e nova, e o que ela
   * faz e diferente em natureza: e a unica que ESCREVE NO CARDAPIO SOZINHA, de
   * hora em hora, sem ninguem olhando — inclusive PAUSANDO produto que sumiu do
   * cadastro do ERP. Um engano aqui nao aparece como erro na tela: aparece como
   * produto fora do ar na hora do almoco.
   *
   * Sai de beta quando tiver rodado uma semana numa loja de verdade com o
   * lojista conferindo o que ela mexeu.
   */
  'erp-sincronizar-auto': {
    canal: 'beta',
    titulo: 'Sincronizar o cardápio com o Maxx Gestão sozinho, de hora em hora',
    porque: 'É a única que escreve no cardápio sem ninguém olhando — inclusive pausando produto que saiu do ERP.',
    desde: '2026-09-14',
  },
} as const satisfies Record<string, Funcionalidade>;

export type ChaveFuncionalidade = keyof typeof FUNCIONALIDADES;

/**
 * Esta loja enxerga esta funcionalidade?
 *
 * Chave desconhecida devolve `false`, não `true`: funcionalidade que ninguém
 * cadastrou não deve aparecer para ninguém. O contrário faria um erro de
 * digitação ligar o recurso para a base inteira.
 */
export function funcionalidadeLiberada(chave: string, canalDaLoja: unknown): boolean {
  const f = (FUNCIONALIDADES as Record<string, Funcionalidade>)[chave];
  if (!f) return false;
  return enxerga(canalDaLoja, f.canal);
}

/**
 * A REGRA DA PROFUNDIDADE, sozinha: quem esta neste canal enxerga o que nasceu
 * naquele?
 *
 * Ela existe separada porque a regra precisa continuar provada mesmo quando o
 * catalogo esvazia um degrau. Em 14/09/2026 todas as funcionalidades subiram
 * para estavel, e o teste de "estavel NAO ve o que esta em beta" ficou sem
 * sujeito — passaria a valer por vacuidade, que e o jeito silencioso de um
 * teste parar de testar. Com esta funcao, a ordem continua verificada por si.
 */
export function enxerga(canalDaLoja: unknown, canalDaFuncionalidade: Canal): boolean {
  return PROFUNDIDADE[canalValido(canalDaLoja)] >= PROFUNDIDADE[canalDaFuncionalidade];
}

/** Tudo que esta loja enxerga — para a tela não repetir a regra. */
export function funcionalidadesDoCanal(canalDaLoja: unknown): ChaveFuncionalidade[] {
  const canal = canalValido(canalDaLoja);
  return (Object.keys(FUNCIONALIDADES) as ChaveFuncionalidade[])
    .filter(k => PROFUNDIDADE[canal] >= PROFUNDIDADE[FUNCIONALIDADES[k].canal]);
}
