import { describe, it, expect } from 'vitest';
import { dataBrasilia, inicioDoDiaBR } from './util';

/** Instante UTC a partir de uma hora de Brasília — o inverso do que a função faz. */
const noBrasil = (iso: string) => Date.parse(`${iso}-03:00`);

describe('dataBrasilia', () => {
  it('das 21h à meia-noite ainda é HOJE no Brasil, não amanhã', () => {
    /*
     * É o bug que motivou a função: 31/07 21:00 no Brasil é 01/08 00:00 em UTC.
     * Quem lia a data do UTC mandava a fatura de julho três horas antes de
     * julho acabar, deixando de fora as vendas do fim da noite.
     */
    expect(dataBrasilia(noBrasil('2026-07-31T21:00:00'))).toBe('2026-07-31');
    expect(dataBrasilia(noBrasil('2026-07-31T23:59:59'))).toBe('2026-07-31');
  });

  it('vira o dia à meia-noite de Brasília, não à do UTC', () => {
    expect(dataBrasilia(noBrasil('2026-08-01T00:00:00'))).toBe('2026-08-01');
  });

  it('de manhã e de tarde bate com o UTC', () => {
    // Fora da faixa das 21h, os dois concordam — a correção não muda o resto.
    expect(dataBrasilia(noBrasil('2026-08-18T09:00:00'))).toBe('2026-08-18');
    expect(dataBrasilia(noBrasil('2026-08-18T15:30:00'))).toBe('2026-08-18');
  });

  it('vira o ano na hora certa', () => {
    expect(dataBrasilia(noBrasil('2025-12-31T22:00:00'))).toBe('2025-12-31');
    expect(dataBrasilia(noBrasil('2026-01-01T00:30:00'))).toBe('2026-01-01');
  });

  it('devolve só a data, sem hora', () => {
    expect(dataBrasilia(noBrasil('2026-08-18T15:30:00'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('inicioDoDiaBR', () => {
  it('é a meia-noite de Brasília expressa em UTC', () => {
    // criado_em é gravado em UTC; o dia do lojista começa às 03:00Z.
    expect(inicioDoDiaBR(noBrasil('2026-08-18T15:30:00'))).toBe('2026-08-18T03:00:00.000Z');
  });

  it('às 21h ainda aponta pra meia-noite de HOJE, não de amanhã', () => {
    /*
     * O bug que isso conserta: com o corte em `<data UTC>T00:00:00.000Z`, às 21h
     * o filtro virava "criado_em >= agora" e a lista de vendas do dia esvaziava
     * na hora de fechar o caixa.
     */
    expect(inicioDoDiaBR(noBrasil('2026-08-18T21:00:00'))).toBe('2026-08-18T03:00:00.000Z');
    expect(inicioDoDiaBR(noBrasil('2026-08-18T23:59:00'))).toBe('2026-08-18T03:00:00.000Z');
  });

  it('vira depois da meia-noite local', () => {
    expect(inicioDoDiaBR(noBrasil('2026-08-19T00:10:00'))).toBe('2026-08-19T03:00:00.000Z');
  });

  it('uma venda das 22h fica DENTRO do dia', () => {
    // O teste que prova a correção do ponto de vista do dado: o instante da
    // venda tem que ser >= o corte.
    const venda = new Date(noBrasil('2026-08-18T22:00:00')).toISOString();
    expect(venda >= inicioDoDiaBR(noBrasil('2026-08-18T22:05:00'))).toBe(true);
  });
});
