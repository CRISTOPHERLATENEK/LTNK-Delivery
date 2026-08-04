/**
 * Períodos de relatório — em DIA DE CALENDÁRIO e no fuso de Brasília.
 *
 * DOIS BUGS QUE ISSO CORRIGE, e o segundo é o que fazia o relatório nunca bater
 * com a conferência de caixa:
 *
 * 1. "dia" eram as ÚLTIMAS 24 HORAS, não hoje. Às 10h da manhã, o faturamento
 *    "de hoje" incluía o jantar de ontem. O lojista comparava com a gaveta e a
 *    conta não fechava — sem nenhum erro aparente pra investigar.
 *
 * 2. O corte era em UTC. Como o Brasil está em UTC−3, o "dia" UTC começa às 21h
 *    de Brasília do dia anterior: as vendas das 21h à meia-noite caíam no dia
 *    seguinte do relatório. Isso desloca faturamento de jantar — justamente o
 *    horário de pico de um delivery.
 *
 * Guardamos `criado_em` como ISO-8601 UTC, então o cálculo é: montar o intervalo
 * em data local, converter as bordas pra UTC e comparar string com string (ISO
 * ordena lexicograficamente = cronologicamente).
 */

/** Brasília, UTC−3. Sem horário de verão (extinto no Brasil em 2019). */
const OFFSET_BR_HORAS = 3;

export type NomePeriodo = 'hoje' | 'ontem' | 'semana' | 'mes' | 'mes_passado' | 'personalizado';

export interface IntervaloUtc {
  /** ISO UTC inclusivo. */
  inicio: string;
  /** ISO UTC inclusivo (fim do último dia). */
  fim: string;
  /** Datas locais (YYYY-MM-DD) que o intervalo cobre — pra rótulo na tela. */
  de: string;
  ate: string;
}

/** Data local (YYYY-MM-DD) de um instante UTC. */
export function dataLocalDe(instante: Date): string {
  const d = new Date(instante.getTime() - OFFSET_BR_HORAS * 3600_000);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD válido? Rejeita mês 13, dia 32 e texto solto. */
export function dataValida(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Soma dias a uma data local YYYY-MM-DD. */
function somarDias(data: string, dias: number): string {
  const d = new Date(data + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Converte um intervalo de datas LOCAIS no intervalo UTC correspondente.
 * `de` começa 00:00 local; `ate` termina 23:59:59.999 local.
 */
export function intervaloUtcDeDatas(de: string, ate: string): IntervaloUtc {
  // 00:00 local = 03:00 UTC do mesmo dia (UTC−3).
  const inicio = new Date(Date.parse(de + 'T00:00:00Z') + OFFSET_BR_HORAS * 3600_000);
  // Fim do dia local: 00:00 do dia SEGUINTE menos 1ms, já em UTC.
  const fim = new Date(Date.parse(somarDias(ate, 1) + 'T00:00:00Z') + OFFSET_BR_HORAS * 3600_000 - 1);
  return { inicio: inicio.toISOString(), fim: fim.toISOString(), de, ate };
}

/**
 * Resolve o período pedido em um intervalo UTC.
 *
 * `agora` é injetável pra o teste não depender do relógio — sem isso, um teste de
 * "mês passado" quebraria no dia 1º e ninguém saberia por quê.
 */
export function resolverPeriodo(
  nome: NomePeriodo,
  personalizado?: { de?: unknown; ate?: unknown },
  agora: Date = new Date(),
): IntervaloUtc {
  const hoje = dataLocalDe(agora);

  if (nome === 'personalizado') {
    const de = dataValida(personalizado?.de) ? personalizado!.de as string : hoje;
    const ate = dataValida(personalizado?.ate) ? personalizado!.ate as string : hoje;
    // Datas invertidas: troca em vez de devolver intervalo vazio. O usuário
    // trocou os campos de lugar, não pediu "nenhum dado".
    return de <= ate ? intervaloUtcDeDatas(de, ate) : intervaloUtcDeDatas(ate, de);
  }

  if (nome === 'ontem') {
    const d = somarDias(hoje, -1);
    return intervaloUtcDeDatas(d, d);
  }

  if (nome === 'semana') {
    // Últimos 7 dias FECHANDO hoje (inclui hoje). Não é "semana do calendário"
    // de propósito: o lojista pensa em "última semana", não em "desde domingo".
    return intervaloUtcDeDatas(somarDias(hoje, -6), hoje);
  }

  if (nome === 'mes') {
    // Mês CORRENTE, do dia 1º até hoje — não "últimos 30 dias". É o número que
    // o lojista compara com o extrato e com a conta do contador.
    return intervaloUtcDeDatas(hoje.slice(0, 8) + '01', hoje);
  }

  if (nome === 'mes_passado') {
    const primeiroDesteMes = hoje.slice(0, 8) + '01';
    const ultimoDoPassado = somarDias(primeiroDesteMes, -1);
    return intervaloUtcDeDatas(ultimoDoPassado.slice(0, 8) + '01', ultimoDoPassado);
  }

  // 'hoje'
  return intervaloUtcDeDatas(hoje, hoje);
}

/** Rótulo legível do intervalo, pra cabeçalho e nome de arquivo exportado. */
export function rotuloPeriodo(i: IntervaloUtc): string {
  const br = (d: string) => d.split('-').reverse().join('/');
  return i.de === i.ate ? br(i.de) : `${br(i.de)} a ${br(i.ate)}`;
}
