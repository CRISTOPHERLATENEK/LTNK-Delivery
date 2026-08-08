import { describe, it, expect } from 'vitest';
import { saboresLiberados, maxEscolhasEfetivo, precoDoGrupo } from './opcoes-preco';

const tamanho = { papel: 'tamanho', modo_preco: 'somar', max_escolhas: 1 };
const sabores = { papel: 'sabores', modo_preco: 'maior', max_escolhas: 1 };
const adicionais = { papel: '', modo_preco: 'somar', max_escolhas: 0 };

describe('saboresLiberados', () => {
  it('pega o número da opção de tamanho escolhida', () => {
    expect(saboresLiberados([
      { grupo: tamanho, escolhidas: [{ preco_adicional_centavos: 2000, sabores: 3 }] },
      { grupo: sabores, escolhidas: [] },
    ])).toBe(3);
  });

  it('devolve 0 quando o tamanho não define nada', () => {
    expect(saboresLiberados([
      { grupo: tamanho, escolhidas: [{ preco_adicional_centavos: 0, sabores: 0 }] },
    ])).toBe(0);
  });

  it('ignora grupos que não são de tamanho', () => {
    // Um adicional com `sabores` preenchido por engano não pode mandar no limite.
    expect(saboresLiberados([
      { grupo: adicionais, escolhidas: [{ preco_adicional_centavos: 400, sabores: 9 }] },
    ])).toBe(0);
  });
});

describe('maxEscolhasEfetivo', () => {
  it('o grupo de sabores obedece ao tamanho', () => {
    expect(maxEscolhasEfetivo(sabores, 3)).toBe(3);
  });

  it('sem tamanho definido, cai no max do grupo — nunca em ilimitado', () => {
    expect(maxEscolhasEfetivo({ ...sabores, max_escolhas: 2 }, 0)).toBe(2);
  });

  it('grupos comuns não são afetados pelo tamanho', () => {
    expect(maxEscolhasEfetivo({ ...adicionais, max_escolhas: 5 }, 3)).toBe(5);
  });
});

describe('precoDoGrupo', () => {
  it('sabores: cobra o MAIOR acréscimo, não a soma', () => {
    // O caso que motivou tudo: 10 + 12 + 14 dava R$ 36 em vez de R$ 14.
    expect(precoDoGrupo(sabores, [
      { preco_adicional_centavos: 1000 },
      { preco_adicional_centavos: 1200 },
      { preco_adicional_centavos: 1400 },
    ])).toBe(1400);
  });

  it('sabores comuns (todos zerados) não acrescentam nada', () => {
    expect(precoDoGrupo(sabores, [
      { preco_adicional_centavos: 0 },
      { preco_adicional_centavos: 0 },
    ])).toBe(0);
  });

  it('um sabor especial no meio de comuns cobra só o especial', () => {
    expect(precoDoGrupo(sabores, [
      { preco_adicional_centavos: 0 },
      { preco_adicional_centavos: 1200 },
      { preco_adicional_centavos: 0 },
    ])).toBe(1200);
  });

  it('adicionais somam — dois bacons custam dois bacons', () => {
    expect(precoDoGrupo(adicionais, [
      { preco_adicional_centavos: 400 },
      { preco_adicional_centavos: 400 },
    ])).toBe(800);
  });

  it('nada escolhido não acrescenta nada', () => {
    expect(precoDoGrupo(sabores, [])).toBe(0);
    expect(precoDoGrupo(adicionais, [])).toBe(0);
  });
});
