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
 * Bordas UTC de UM dia local, para filtro com apenas um dos lados preenchido.
 *
 * Existem porque vários filtros aceitam só "de" ou só "até", e montar a borda à
 * mão (`data + 'T00:00:00.000Z'`) é exatamente o bug que este módulo existe pra
 * evitar: em UTC−3, esse corte pega as 21h do dia anterior e perde as 21h do
 * próprio dia — o horário de pico de um delivery.
 */
export function inicioUtcDaData(dataLocal: string): string {
  return intervaloUtcDeDatas(dataLocal, dataLocal).inicio;
}
export function fimUtcDaData(dataLocal: string): string {
  return intervaloUtcDeDatas(dataLocal, dataLocal).fim;
}

/** Dias que um intervalo cobre, contando as duas pontas. */
function diasDoIntervalo(de: string, ate: string): number {
  const ms = Date.parse(ate + 'T00:00:00Z') - Date.parse(de + 'T00:00:00Z');
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * O intervalo IMEDIATAMENTE ANTERIOR, do mesmo tamanho.
 *
 * POR QUE COMPARAR: número sozinho não informa. "R$ 766 hoje" não diz se o dia foi
 * bom; "R$ 766, 12% acima de ontem" diz. É a diferença entre relatório que se olha
 * e relatório que se usa.
 *
 * MESMO NÚMERO DE DIAS, colado no início: "esta semana" (7 dias) compara com os 7
 * dias anteriores, não com "a semana passada do calendário". Isso importa no meio
 * da semana — quarta-feira, "esta semana" tem 3 dias, e comparar com uma semana
 * fechada de 7 mostraria uma queda de 60% que é só aritmética.
 */
export function periodoAnterior(intervalo: IntervaloUtc): IntervaloUtc {
  const dias = diasDoIntervalo(intervalo.de, intervalo.ate);
  const ate = somarDias(intervalo.de, -1);
  const de = somarDias(ate, -(dias - 1));
  return intervaloUtcDeDatas(de, ate);
}

/**
 * Variação percentual entre dois valores, arredondada a 1 casa.
 *
 * Base ZERO devolve null, não "+100%" nem "+∞": sair de 0 pra qualquer coisa não é
 * percentual de crescimento, é a primeira venda. A tela mostra "sem base de
 * comparação" em vez de um número que parece informação e não é.
 */
export function variacaoPercentual(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
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
