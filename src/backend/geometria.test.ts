/**
 * Testes da geometria das áreas de entrega.
 *
 * POR QUE EXISTEM: erro aqui é silencioso e custa dinheiro — cobra frete errado
 * ou recusa cliente que deveria ser atendido, e nada no build denuncia. Os casos
 * cobertos são justamente os que quebram implementação ingênua: polígono
 * côncavo, vértice em ordem invertida e ponto logo fora da borda.
 */
import { describe, it, expect } from 'vitest';
import { pontoDentroDoPoligono, poligonoValido, distanciaKm, type Ponto } from './geometria';

// Quadrado simples de 1 grau, cantos em (0,0) e (1,1).
const QUADRADO: Ponto[] = [[0, 0], [0, 1], [1, 1], [1, 0]];

describe('pontoDentroDoPoligono', () => {
  it('aceita ponto no centro', () => {
    expect(pontoDentroDoPoligono([0.5, 0.5], QUADRADO)).toBe(true);
  });

  it('recusa ponto fora', () => {
    expect(pontoDentroDoPoligono([2, 2], QUADRADO)).toBe(false);
    expect(pontoDentroDoPoligono([-0.1, 0.5], QUADRADO)).toBe(false);
  });

  it('recusa ponto logo além da borda (1 metro fora conta como fora)', () => {
    expect(pontoDentroDoPoligono([0.5, 1.00001], QUADRADO)).toBe(false);
  });

  /**
   * Ordem dos vértices não deve importar: o editor de mapa gera na ordem em que
   * o lojista clicou, que pode ser horária ou anti-horária.
   */
  it('funciona com os vértices em ordem invertida', () => {
    const invertido = [...QUADRADO].reverse();
    expect(pontoDentroDoPoligono([0.5, 0.5], invertido)).toBe(true);
    expect(pontoDentroDoPoligono([2, 2], invertido)).toBe(false);
  });

  /**
   * Polígono côncavo (formato "C"): o vão do meio está FORA da área, ainda que
   * dentro da caixa que envolve o desenho. É o caso real de um bairro cortado
   * por um rio ou morro — e o que uma checagem por "caixa" erraria.
   */
  it('respeita o vão de um polígono côncavo', () => {
    const c: Ponto[] = [[0, 0], [0, 3], [1, 3], [1, 1], [2, 1], [2, 3], [3, 3], [3, 0]];
    expect(pontoDentroDoPoligono([1.5, 0.5], c)).toBe(true);  // na base do "C"
    expect(pontoDentroDoPoligono([1.5, 2], c)).toBe(false);    // no vão
  });

  it('polígono degenerado (menos de 3 pontos) não contém nada', () => {
    expect(pontoDentroDoPoligono([0.5, 0.5], [[0, 0], [1, 1]])).toBe(false);
    expect(pontoDentroDoPoligono([0.5, 0.5], [])).toBe(false);
  });
});

describe('poligonoValido', () => {
  it('aceita polígono bem formado', () => {
    expect(poligonoValido([[0, 0], [0, 1], [1, 1]])).toEqual([[0, 0], [0, 1], [1, 1]]);
  });

  it('recusa o que não delimita área', () => {
    expect(poligonoValido([[0, 0], [1, 1]])).toBeNull();
    expect(poligonoValido('nao é lista')).toBeNull();
    expect(poligonoValido(null)).toBeNull();
  });

  it('recusa coordenada fora da faixa válida ou não numérica', () => {
    expect(poligonoValido([[0, 0], [0, 1], [91, 1]])).toBeNull();      // lat > 90
    expect(poligonoValido([[0, 0], [0, 1], [1, 181]])).toBeNull();     // lon > 180
    expect(poligonoValido([[0, 0], [0, 1], ['x', 1]])).toBeNull();
  });

  it('recusa payload absurdamente grande', () => {
    const enorme = Array.from({ length: 201 }, (_, i) => [i / 1000, 0]);
    expect(poligonoValido(enorme)).toBeNull();
  });
});

describe('distanciaKm', () => {
  it('mesmo ponto = zero', () => {
    expect(distanciaKm([-26.9, -49.07], [-26.9, -49.07])).toBeCloseTo(0, 5);
  });

  it('bate com a distância real conhecida (Blumenau → Joinville ~ 70 km)', () => {
    const d = distanciaKm([-26.9194, -49.0661], [-26.3045, -48.8487]);
    expect(d).toBeGreaterThan(60);
    expect(d).toBeLessThan(80);
  });
});
