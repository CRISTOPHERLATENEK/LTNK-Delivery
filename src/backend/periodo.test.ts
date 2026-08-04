import { describe, it, expect } from 'vitest';
import {
  resolverPeriodo, intervaloUtcDeDatas, dataLocalDe, dataValida, rotuloPeriodo,
} from './periodo';

/**
 * Estes testes existem porque o bug antigo era INVISÍVEL: o relatório mostrava um
 * número plausível, só não era o do dia que o lojista pensava. Ele comparava com a
 * gaveta, não fechava, e não havia erro nenhum pra investigar.
 *
 * `agora` é sempre injetado — teste de "mês passado" que depende do relógio
 * quebra no dia 1º e ninguém entende por quê.
 */
const em = (iso: string) => new Date(iso);

describe('dataLocalDe — o dia é o de BRASÍLIA, não o UTC', () => {
  it('23h de Brasília ainda é o mesmo dia (mesmo já sendo o dia seguinte em UTC)', () => {
    // 2026-03-10 02:00Z = 2026-03-09 23:00 em Brasília
    expect(dataLocalDe(em('2026-03-10T02:00:00Z'))).toBe('2026-03-09');
  });
  it('meio-dia é trivial', () => {
    expect(dataLocalDe(em('2026-03-10T15:00:00Z'))).toBe('2026-03-10');
  });
  it('00:30 de Brasília já é o dia novo', () => {
    expect(dataLocalDe(em('2026-03-10T03:30:00Z'))).toBe('2026-03-10');
  });
});

describe('intervaloUtcDeDatas', () => {
  it('um dia local vira 03:00Z até 02:59:59.999Z do dia seguinte', () => {
    const i = intervaloUtcDeDatas('2026-03-10', '2026-03-10');
    expect(i.inicio).toBe('2026-03-10T03:00:00.000Z');
    expect(i.fim).toBe('2026-03-11T02:59:59.999Z');
  });

  it('AS VENDAS DE JANTAR ficam no dia certo — era o bug do corte em UTC', () => {
    const i = intervaloUtcDeDatas('2026-03-10', '2026-03-10');
    // Venda às 22h de Brasília do dia 10 = 2026-03-11T01:00Z
    const vendaJantar = '2026-03-11T01:00:00.000Z';
    expect(vendaJantar >= i.inicio && vendaJantar <= i.fim).toBe(true);
  });

  it('venda às 20h59 do dia anterior NÃO entra', () => {
    const i = intervaloUtcDeDatas('2026-03-10', '2026-03-10');
    const antes = '2026-03-10T02:59:00.000Z'; // 23h59 do dia 9 em Brasília
    expect(antes >= i.inicio).toBe(false);
  });

  it('intervalo de vários dias cobre do primeiro 00:00 ao último 23:59', () => {
    const i = intervaloUtcDeDatas('2026-03-01', '2026-03-31');
    expect(i.inicio).toBe('2026-03-01T03:00:00.000Z');
    expect(i.fim).toBe('2026-04-01T02:59:59.999Z');
  });
});

describe('resolverPeriodo', () => {
  const agora = em('2026-03-10T15:00:00Z'); // 12h de Brasília, dia 10

  it('hoje = o dia 10 inteiro, não as últimas 24h', () => {
    const i = resolverPeriodo('hoje', undefined, agora);
    expect([i.de, i.ate]).toEqual(['2026-03-10', '2026-03-10']);
  });

  it('ontem', () => {
    const i = resolverPeriodo('ontem', undefined, agora);
    expect([i.de, i.ate]).toEqual(['2026-03-09', '2026-03-09']);
  });

  it('semana = últimos 7 dias incluindo hoje', () => {
    const i = resolverPeriodo('semana', undefined, agora);
    expect([i.de, i.ate]).toEqual(['2026-03-04', '2026-03-10']);
  });

  it('mes = mês CORRENTE do dia 1º, não últimos 30 dias', () => {
    const i = resolverPeriodo('mes', undefined, agora);
    expect([i.de, i.ate]).toEqual(['2026-03-01', '2026-03-10']);
  });

  it('mes_passado = fevereiro inteiro, respeitando o último dia do mês', () => {
    const i = resolverPeriodo('mes_passado', undefined, agora);
    expect([i.de, i.ate]).toEqual(['2026-02-01', '2026-02-28']);
  });

  it('mes_passado em março de ano BISSEXTO fecha em 29', () => {
    const i = resolverPeriodo('mes_passado', undefined, em('2024-03-15T15:00:00Z'));
    expect([i.de, i.ate]).toEqual(['2024-02-01', '2024-02-29']);
  });

  it('mes_passado em janeiro volta pra dezembro do ano anterior', () => {
    const i = resolverPeriodo('mes_passado', undefined, em('2026-01-10T15:00:00Z'));
    expect([i.de, i.ate]).toEqual(['2025-12-01', '2025-12-31']);
  });

  it('personalizado usa as datas informadas', () => {
    const i = resolverPeriodo('personalizado', { de: '2026-01-05', ate: '2026-01-20' }, agora);
    expect([i.de, i.ate]).toEqual(['2026-01-05', '2026-01-20']);
  });

  it('datas INVERTIDAS são trocadas, em vez de devolver intervalo vazio', () => {
    // O usuário trocou os campos de lugar; não pediu "nenhum dado".
    const i = resolverPeriodo('personalizado', { de: '2026-01-20', ate: '2026-01-05' }, agora);
    expect([i.de, i.ate]).toEqual(['2026-01-05', '2026-01-20']);
  });

  it('data inválida cai em hoje em vez de quebrar', () => {
    const i = resolverPeriodo('personalizado', { de: '2026-13-45', ate: 'abacaxi' }, agora);
    expect([i.de, i.ate]).toEqual(['2026-03-10', '2026-03-10']);
  });
});

describe('dataValida', () => {
  it('aceita data real', () => expect(dataValida('2026-02-28')).toBe(true));
  it('recusa mês 13 e dia 32', () => {
    expect(dataValida('2026-13-01')).toBe(false);
    expect(dataValida('2026-01-32')).toBe(false);
  });
  it('recusa 29 de fevereiro em ano não bissexto', () => {
    expect(dataValida('2026-02-29')).toBe(false);
    expect(dataValida('2024-02-29')).toBe(true);
  });
  it('recusa formato solto e não-string', () => {
    expect(dataValida('10/03/2026')).toBe(false);
    expect(dataValida(20260310)).toBe(false);
    expect(dataValida(null)).toBe(false);
  });
});

describe('rotuloPeriodo', () => {
  it('um dia mostra só a data', () => {
    expect(rotuloPeriodo(intervaloUtcDeDatas('2026-03-10', '2026-03-10'))).toBe('10/03/2026');
  });
  it('intervalo mostra os dois extremos', () => {
    expect(rotuloPeriodo(intervaloUtcDeDatas('2026-03-01', '2026-03-31'))).toBe('01/03/2026 a 31/03/2026');
  });
});
