import { describe, it, expect } from 'vitest';
import { lojaAbertaPorAgenda, proximaAbertura, proximaAberturaISO, turnosDoDia } from './util';

/* Brasília é UTC-3: 18:00 daqui é 21:00 UTC. Os testes montam o instante em
   UTC de propósito — é assim que o servidor recebe, e fixar o "agora" é o que
   torna esta função testável. */
const brt = (dataISO: string, hhmm: string) => {
  /* Soma as 3h em MILISSEGUNDOS, não no texto: `23:00` + 3 viraria a string
     "26:00", que é data inválida — e `new Date` de string inválida não lança,
     devolve `Invalid Date`, então o teste falharia num ponto sem relação. */
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${dataISO}T00:00:00Z`) + (h + 3) * 3600000 + m * 60000);
};
// 2026-08-26 é uma quarta-feira (dia 3).
const QUA = '2026-08-26', QUI = '2026-08-27';

const dia = (d: number, abre: string, fecha: string, turnos?: Array<{ abre: string; fecha: string }>) =>
  ({ dia: d, aberto: true, abre, fecha, ...(turnos ? { turnos } : {}) });
const json = (...dias: unknown[]) => JSON.stringify(dias);

describe('turnosDoDia', () => {
  it('sem `turnos`, o dia tem um turno só — a agenda antiga segue valendo', () => {
    expect(turnosDoDia(dia(3, '18:00', '23:00'))).toEqual([{ abre: '18:00', fecha: '23:00' }]);
  });

  it('lista vazia cai no par abre/fecha, não vira dia sem horário', () => {
    expect(turnosDoDia({ dia: 3, aberto: true, abre: '18:00', fecha: '23:00', turnos: [] }))
      .toEqual([{ abre: '18:00', fecha: '23:00' }]);
  });

  it('ordena por abertura', () => {
    const r = turnosDoDia(dia(3, '18:00', '23:00', [
      { abre: '18:00', fecha: '23:00' }, { abre: '11:00', fecha: '15:00' },
    ]));
    expect(r.map(t => t.abre)).toEqual(['11:00', '18:00']);
  });
});

describe('lojaAbertaPorAgenda', () => {
  const almocoEJanta = json(dia(3, '11:00', '15:00', [
    { abre: '11:00', fecha: '15:00' }, { abre: '18:00', fecha: '23:00' },
  ]));

  it('aberta no almoço', () => expect(lojaAbertaPorAgenda(almocoEJanta, brt(QUA, '12:00'))).toBe(true));

  /* O CASO QUE NÃO EXISTIA. Com um turno só por dia, 16:00 estaria "aberta"
     (11–23) e o pedido cairia com a cozinha vazia. */
  it('FECHADA no intervalo entre almoço e janta', () => {
    expect(lojaAbertaPorAgenda(almocoEJanta, brt(QUA, '16:00'))).toBe(false);
  });

  it('aberta de novo na janta', () => expect(lojaAbertaPorAgenda(almocoEJanta, brt(QUA, '19:30'))).toBe(true));
  it('fechada antes de abrir', () => expect(lojaAbertaPorAgenda(almocoEJanta, brt(QUA, '09:00'))).toBe(false));

  /* Turno que vira a madrugada, agora dentro de `turnos`. */
  it('madrugada continua funcionando', () => {
    const noturno = json(dia(3, '18:00', '02:00'));
    expect(lojaAbertaPorAgenda(noturno, brt(QUA, '23:00'))).toBe(true);
    expect(lojaAbertaPorAgenda(noturno, brt(QUI, '01:00'))).toBe(true);
    expect(lojaAbertaPorAgenda(noturno, brt(QUI, '03:00'))).toBe(false);
  });

  it('agenda inválida devolve null e não sobrescreve o manual', () => {
    expect(lojaAbertaPorAgenda('', brt(QUA, '12:00'))).toBe(null);
    expect(lojaAbertaPorAgenda('nao é json', brt(QUA, '12:00'))).toBe(null);
    expect(lojaAbertaPorAgenda('[]', brt(QUA, '12:00'))).toBe(null);
  });

  it('dia marcado como fechado não abre', () => {
    expect(lojaAbertaPorAgenda(json({ dia: 3, aberto: false, abre: '11:00', fecha: '23:00' }),
      brt(QUA, '12:00'))).toBe(false);
  });
});

describe('próxima abertura', () => {
  const almocoEJanta = json(dia(3, '11:00', '15:00', [
    { abre: '11:00', fecha: '15:00' }, { abre: '18:00', fecha: '23:00' },
  ]));

  /* No intervalo, a próxima abertura é a JANTA — não a semana que vem. Sem
     iterar os turnos, o laço via só o primeiro (11:00), julgava "já passou" e
     pulava o dia inteiro. */
  it('no intervalo, aponta a janta do mesmo dia', () => {
    expect(proximaAbertura(almocoEJanta, brt(QUA, '16:00'))).toBe('abre qua 18:00');
    expect(proximaAberturaISO(almocoEJanta, brt(QUA, '16:00'))).toBe('2026-08-26T21:00:00.000Z');
  });

  it('depois de fechar, aponta o mesmo dia da semana seguinte', () => {
    expect(proximaAberturaISO(almocoEJanta, brt(QUI, '01:00'))).toBe('2026-09-02T14:00:00.000Z');
  });

  it('sem dia aberto, não há próxima abertura', () => {
    expect(proximaAbertura(json({ dia: 3, aberto: false, abre: '11:00', fecha: '15:00' }), brt(QUA, '12:00'))).toBe('');
    expect(proximaAberturaISO('[]', brt(QUA, '12:00'))).toBe(null);
  });
});
