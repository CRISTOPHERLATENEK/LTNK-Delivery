import { describe, it, expect } from 'vitest';
import { validarHorarioJson } from './agenda-validacao';

const ler = (bruto: unknown) => JSON.parse(validarHorarioJson(bruto));

describe('validarHorarioJson', () => {
  it('aceita string JSON e array, e devolve string', () => {
    const esperado = [{ dia: 3, aberto: true, abre: '18:00', fecha: '23:00', turnos: [{ abre: '18:00', fecha: '23:00' }] }];
    expect(ler('[{"dia":3,"aberto":true,"abre":"18:00","fecha":"23:00"}]')).toEqual(esperado);
    expect(ler([{ dia: 3, aberto: true, abre: '18:00', fecha: '23:00' }])).toEqual(esperado);
  });

  it('recusa o que não é agenda', () => {
    expect(() => validarHorarioJson('{ não é json')).toThrow();
    expect(() => validarHorarioJson({ dia: 3 })).toThrow();
  });

  /* Dia fora de 0–6 é descartado: viraria uma regra que `lojaAbertaPorAgenda`
     nunca encontra, ocupando espaço e confundindo quem for depurar. */
  it('descarta dia fora da semana', () => {
    expect(ler([{ dia: 9, aberto: true, abre: '18:00', fecha: '23:00' }])).toEqual([]);
    expect(ler([{ dia: -1, aberto: true, abre: '18:00', fecha: '23:00' }])).toEqual([]);
  });

  /*
   * O CASO QUE FECHA A LOJA SEM NINGUÉM PEDIR.
   *
   * Turno com hora inválida é DESCARTADO, não convertido pra 00:00 — um par
   * 00:00–00:00 no meio da lista é uma janela vazia que fecha a loja num
   * horário que o lojista nunca digitou.
   */
  it('turno com hora inválida é descartado, não virado em 00:00', () => {
    const r = ler([{
      dia: 3, aberto: true, abre: '11:00', fecha: '15:00',
      turnos: [{ abre: '11:00', fecha: '15:00' }, { abre: '99:99', fecha: '23:00' }],
    }]);
    expect(r[0].turnos).toEqual([{ abre: '11:00', fecha: '15:00' }]);
  });

  it('guarda os dois turnos e os ordena', () => {
    const r = ler([{
      dia: 3, aberto: true, abre: '00:00', fecha: '00:00',
      turnos: [{ abre: '18:00', fecha: '23:00' }, { abre: '11:00', fecha: '15:00' }],
    }]);
    expect(r[0].turnos).toEqual([{ abre: '11:00', fecha: '15:00' }, { abre: '18:00', fecha: '23:00' }]);
    /* `abre`/`fecha` recebem o PRIMEIRO turno: é por eles que agenda gravada
       antes de `turnos` existir continua sendo lida. */
    expect(r[0].abre).toBe('11:00');
    expect(r[0].fecha).toBe('15:00');
  });

  it('agenda sem turnos ganha o turno derivado de abre/fecha', () => {
    const r = ler([{ dia: 1, aberto: true, abre: '09:00', fecha: '18:00' }]);
    expect(r[0].turnos).toEqual([{ abre: '09:00', fecha: '18:00' }]);
  });

  /* Lista enorme vinda do cliente não pode virar JSON gigante gravado a cada
     save — o teto é do servidor, não da tela. */
  it('limita a quantidade de turnos', () => {
    const muitos = Array.from({ length: 20 }, (_, i) => ({
      abre: `${String(i).padStart(2, '0')}:00`, fecha: `${String(i).padStart(2, '0')}:30`,
    }));
    const r = ler([{ dia: 1, aberto: true, abre: '00:00', fecha: '00:00', turnos: muitos }]);
    expect(r[0].turnos.length).toBeLessThanOrEqual(4);
  });

  it('dia fechado é preservado como fechado', () => {
    const r = ler([{ dia: 0, aberto: false, abre: '18:00', fecha: '23:00' }]);
    expect(r[0].aberto).toBe(false);
  });

  /* Nada válido sobrando devolve 00:00–00:00 em vez de `turnos: []`: dia sem
     turno nenhum faria `turnosDoDia` cair no par abre/fecha e ler `undefined`. */
  it('sem nenhum turno válido, sobra um par neutro', () => {
    const r = ler([{ dia: 1, aberto: true, abre: 'xx', fecha: 'yy' }]);
    expect(r[0].abre).toBe('00:00');
    expect(r[0].fecha).toBe('00:00');
  });
});
