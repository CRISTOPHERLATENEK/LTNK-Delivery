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
  'erp-auto-emitir': {
    canal: 'beta',
    titulo: 'Emitir a NFC-e automaticamente no Maxx Gestão',
    porque: 'Emitir não tem volta, e a SEFAZ ainda recusa por dados de intermediador.',
  },
  'erp-modelo-documento': {
    canal: 'beta',
    titulo: 'Escolher como o pedido entra no Maxx Gestão (Pedido ou Pré-Venda)',
    porque: 'Qual modelo o PDV puxa varia por instalação e ainda está sendo descoberto.',
  },
  'erp-caixa': {
    canal: 'beta',
    titulo: 'Enviar o pedido para um caixa do Maxx Gestão',
    porque: 'O campo não é documentado pela API deles; funciona, mas foi descoberto na marra.',
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
  return PROFUNDIDADE[canalValido(canalDaLoja)] >= PROFUNDIDADE[f.canal];
}

/** Tudo que esta loja enxerga — para a tela não repetir a regra. */
export function funcionalidadesDoCanal(canalDaLoja: unknown): ChaveFuncionalidade[] {
  const canal = canalValido(canalDaLoja);
  return (Object.keys(FUNCIONALIDADES) as ChaveFuncionalidade[])
    .filter(k => PROFUNDIDADE[canal] >= PROFUNDIDADE[FUNCIONALIDADES[k].canal]);
}
