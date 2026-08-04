/**
 * CAIXA POR TURNO — abertura, sangria, suprimento e fechamento com conferência.
 *
 * POR QUE EXISTE: não havia nada. O PDV registrava venda e o dia terminava sem
 * ninguém conferir a gaveta contra o que o sistema diz. Diferença de dinheiro só
 * aparecia quando alguém reclamava — e aí já não dava pra saber de qual turno
 * veio, nem quem estava no caixa.
 *
 * A DECISÃO QUE MAIS IMPORTA AQUI: a conferência é só de DINHEIRO. Cartão e Pix
 * não estão na gaveta — eles caem na conta do banco e se conciliam pelo extrato,
 * em outro momento e por outra pessoa. Somar tudo no "esperado" faria toda
 * conferência fechar errada por milhares de reais, todo dia, e o operador
 * aprenderia a ignorar a divergência — que é justamente o número que deveria
 * chamar atenção quando aparece.
 */
import type { FormaPagamento } from '../tipos/modelos';

export type StatusCaixa = 'aberto' | 'fechado';
export type TipoMovimento = 'sangria' | 'suprimento';

export interface Caixa {
  id: number;
  loja_id: number;
  usuario_abertura_id: number;
  usuario_abertura_nome: string;
  aberto_em: string;
  valor_abertura_centavos: number;
  status: StatusCaixa;
  fechado_em: string;
  usuario_fechamento_nome: string;
  /** Dinheiro contado na gaveta no fechamento. */
  valor_contado_centavos: number;
  /** O que o sistema calculou que deveria haver (ver `esperadoEmDinheiro`). */
  valor_esperado_centavos: number;
  /** contado − esperado. Negativo = falta, positivo = sobra. */
  diferenca_centavos: number;
  observacoes: string;
}

export interface MovimentoCaixa {
  id: number;
  caixa_id: number;
  tipo: TipoMovimento;
  valor_centavos: number;
  motivo: string;
  usuario_nome: string;
  criado_em: string;
}

/** Vendas do turno, separadas por forma — só a primeira entra na gaveta. */
export interface VendasDoTurno {
  dinheiro_centavos: number;
  cartao_centavos: number;
  pix_centavos: number;
  quantidade: number;
}

export interface ResumoConferencia {
  abertura_centavos: number;
  vendas_dinheiro_centavos: number;
  suprimentos_centavos: number;
  sangrias_centavos: number;
  /** O que deve estar na gaveta agora. */
  esperado_centavos: number;
  /** Informativo: caiu no banco, não na gaveta. Não entra no esperado. */
  cartao_centavos: number;
  pix_centavos: number;
}

/**
 * Quanto deve haver de DINHEIRO na gaveta.
 *
 *   abertura + vendas em dinheiro + suprimentos − sangrias
 *
 * Sobre o TROCO: não entra na conta. A gaveta recebe o valor da venda e devolve
 * o troco da própria gaveta, então o saldo líquido muda exatamente pelo valor da
 * venda. Descontar troco aqui contaria a mesma saída duas vezes.
 */
export function esperadoEmDinheiro(dados: {
  aberturaCentavos: number;
  vendasDinheiroCentavos: number;
  suprimentosCentavos: number;
  sangriasCentavos: number;
}): number {
  return dados.aberturaCentavos
    + dados.vendasDinheiroCentavos
    + dados.suprimentosCentavos
    - dados.sangriasCentavos;
}

/** contado − esperado. Negativo = falta na gaveta; positivo = sobra. */
export function diferencaDeCaixa(contadoCentavos: number, esperadoCentavos: number): number {
  return contadoCentavos - esperadoCentavos;
}

/**
 * Classifica a divergência pra a UI destacar o que merece atenção.
 *
 * A TOLERÂNCIA existe porque quebra de centavos é rotina (arredondamento de
 * troco, moeda que caiu). Sem faixa, toda conferência apareceria como problema e
 * o operador pararia de olhar — o oposto do objetivo.
 */
export function classificarDiferenca(diferencaCentavos: number, toleranciaCentavos = 200): 'ok' | 'sobra' | 'falta' {
  if (Math.abs(diferencaCentavos) <= toleranciaCentavos) return 'ok';
  return diferencaCentavos > 0 ? 'sobra' : 'falta';
}

/**
 * Soma as vendas do turno por forma de pagamento.
 *
 * `cartao_entrega` é como o PDV grava cartão (ver PAGAMENTO_BALCAO em
 * rotas/lojista.ts) — nome herdado do delivery, mas no balcão significa cartão
 * na maquininha do caixa.
 */
export function somarVendas(vendas: Array<{ forma_pagamento: FormaPagamento | string; total_centavos: number }>): VendasDoTurno {
  const r: VendasDoTurno = { dinheiro_centavos: 0, cartao_centavos: 0, pix_centavos: 0, quantidade: vendas.length };
  for (const v of vendas) {
    if (v.forma_pagamento === 'dinheiro') r.dinheiro_centavos += v.total_centavos;
    else if (v.forma_pagamento === 'pix') r.pix_centavos += v.total_centavos;
    else r.cartao_centavos += v.total_centavos;
  }
  return r;
}

/** Monta o resumo completo da conferência. */
export function montarResumo(dados: {
  aberturaCentavos: number;
  vendas: VendasDoTurno;
  suprimentosCentavos: number;
  sangriasCentavos: number;
}): ResumoConferencia {
  return {
    abertura_centavos: dados.aberturaCentavos,
    vendas_dinheiro_centavos: dados.vendas.dinheiro_centavos,
    suprimentos_centavos: dados.suprimentosCentavos,
    sangrias_centavos: dados.sangriasCentavos,
    esperado_centavos: esperadoEmDinheiro({
      aberturaCentavos: dados.aberturaCentavos,
      vendasDinheiroCentavos: dados.vendas.dinheiro_centavos,
      suprimentosCentavos: dados.suprimentosCentavos,
      sangriasCentavos: dados.sangriasCentavos,
    }),
    cartao_centavos: dados.vendas.cartao_centavos,
    pix_centavos: dados.vendas.pix_centavos,
  };
}
