import { describe, it, expect } from 'vitest';
import { numerarOpcoes, resolverDigitado } from '../../frontend/src/lib/escolha-rapida';

describe('numerarOpcoes', () => {
  it('numera contínuo entre grupos e slots', () => {
    const r = numerarOpcoes([
      { slot: 0, grupos: [{ id: 7, opcoes: [{ id: 71 }, { id: 72 }] }] },
      { slot: 1, grupos: [{ id: 9, opcoes: [{ id: 91 }] }, { id: 8, opcoes: [{ id: 81 }] }] },
    ]);
    expect(r.map(o => o.numero)).toEqual([1, 2, 3, 4]);
    /* O número tem que carregar o SLOT: com dois slots do mesmo grupo (combo de
       duas pizzas), o id do grupo sozinho não diz em qual pizza aplicar. */
    expect(r[2]).toEqual({ numero: 3, slot: 1, grupoId: 9, opcaoId: 91 });
  });

  it('lista vazia não numera nada', () => {
    expect(numerarOpcoes([])).toEqual([]);
    expect(numerarOpcoes([{ slot: 0, grupos: [] }])).toEqual([]);
  });
});

describe('resolverDigitado', () => {
  /*
   * O CASO QUE FAZ A LISTA COMPACTA VALER A PENA. Com 27 opções, "5" só pode
   * ser o 5 — aplica na hora, uma tecla por opção.
   */
  it('aplica na hora quando não há como crescer', () => {
    expect(resolverDigitado('5', 27)).toEqual({ aplicar: 5, buffer: '' });
    expect(resolverDigitado('9', 27)).toEqual({ aplicar: 9, buffer: '' });
  });

  it('espera o próximo dígito quando ainda pode crescer', () => {
    expect(resolverDigitado('1', 27)).toEqual({ aplicar: null, buffer: '1' });
    expect(resolverDigitado('2', 27)).toEqual({ aplicar: null, buffer: '2' });
    expect(resolverDigitado('12', 27)).toEqual({ aplicar: 12, buffer: '' });
    expect(resolverDigitado('27', 27)).toEqual({ aplicar: 27, buffer: '' });
  });

  /* Com poucas opções, todo dígito é imediato — inclusive o 1. */
  it('lista curta aplica sempre na hora', () => {
    expect(resolverDigitado('1', 4)).toEqual({ aplicar: 1, buffer: '' });
    expect(resolverDigitado('4', 4)).toEqual({ aplicar: 4, buffer: '' });
  });

  /*
   * Fora da lista LIMPA o buffer. Acumular faria o dígito seguinte herdar um
   * buffer inválido, e a próxima tecla também pareceria não funcionar — o
   * atendente conclui que o teclado travou.
   */
  it('fora da lista limpa em vez de acumular', () => {
    expect(resolverDigitado('9', 4)).toEqual({ aplicar: null, buffer: '' });
    expect(resolverDigitado('99', 27)).toEqual({ aplicar: null, buffer: '' });
  });

  it('zero e lixo não travam o buffer', () => {
    expect(resolverDigitado('0', 27)).toEqual({ aplicar: null, buffer: '' });
    expect(resolverDigitado('', 27)).toEqual({ aplicar: null, buffer: '' });
    expect(resolverDigitado('a', 27)).toEqual({ aplicar: null, buffer: '' });
  });

  /* 100 opções: "1" espera, "10" ainda espera (pode ser 100), "100" aplica. */
  it('funciona com três dígitos', () => {
    expect(resolverDigitado('1', 100)).toEqual({ aplicar: null, buffer: '1' });
    expect(resolverDigitado('10', 100)).toEqual({ aplicar: null, buffer: '10' });
    expect(resolverDigitado('100', 100)).toEqual({ aplicar: 100, buffer: '' });
    expect(resolverDigitado('11', 100)).toEqual({ aplicar: 11, buffer: '' });
  });
});
