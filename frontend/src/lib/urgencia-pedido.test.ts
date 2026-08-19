import { describe, it, expect } from 'vitest';
import { urgenciaPedido, MINUTOS_ATENCAO, MINUTOS_ATRASADO } from './urgencia-pedido';

/** Instante "agora" fixo, e um pedido criado N minutos e S segundos antes dele. */
const AGORA = Date.parse('2026-08-19T12:00:00.000Z');
const criadoHa = (min: number, seg = 0) => new Date(AGORA - (min * 60 + seg) * 1000).toISOString();

describe('urgenciaPedido', () => {
  it('cronômetro em m:ss, com o segundo sempre em dois dígitos', () => {
    // "3:7" pareceria dado quebrado; e com granularidade de minuto a tela
    // parecia travada por 60s.
    expect(urgenciaPedido(criadoHa(3, 7), AGORA).rotulo).toBe('3:07');
    expect(urgenciaPedido(criadoHa(0, 0), AGORA).rotulo).toBe('0:00');
  });

  it('as três faixas mudam exatamente no limite', () => {
    expect(urgenciaPedido(criadoHa(MINUTOS_ATENCAO - 1), AGORA).faixa).toContain('green');
    expect(urgenciaPedido(criadoHa(MINUTOS_ATENCAO), AGORA).faixa).toContain('amber');
    expect(urgenciaPedido(criadoHa(MINUTOS_ATRASADO - 1), AGORA).faixa).toContain('amber');
    expect(urgenciaPedido(criadoHa(MINUTOS_ATRASADO), AGORA).faixa).toContain('red');
  });

  it('só a faixa vermelha marca atrasado', () => {
    expect(urgenciaPedido(criadoHa(9, 59), AGORA).atrasado).toBe(false);
    expect(urgenciaPedido(criadoHa(10), AGORA).atrasado).toBe(true);
  });

  it('pedido com data no futuro não vira tempo negativo', () => {
    // Relógio do aparelho adiantado em relação ao servidor: sem o piso em zero,
    // o cronômetro mostraria "-1:-30" e a faixa quebraria.
    const futuro = new Date(AGORA + 90_000).toISOString();
    expect(urgenciaPedido(futuro, AGORA)).toMatchObject({ min: 0, rotulo: '0:00', atrasado: false });
  });

  it('descreve o tempo em palavras pra leitor de tela', () => {
    // "12:34" lido em voz alta não comunica urgência.
    expect(urgenciaPedido(criadoHa(0, 20), AGORA).descricao).toBe('acabou de chegar');
    expect(urgenciaPedido(criadoHa(12), AGORA).descricao).toContain('atrasado');
  });
});
