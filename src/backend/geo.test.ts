/**
 * Testes da conversão do contorno vindo do OpenStreetMap.
 *
 * POR QUE EXISTEM: o GeoJSON usa [lon, lat] e o Leaflet usa [lat, lon]. Trocar
 * a ordem não gera erro nenhum — só joga a área de entrega pro outro lado do
 * mundo, e o sintoma aparece como "o bairro apareceu no lugar errado no mapa",
 * que é difícil de rastrear até aqui.
 */
import { describe, it, expect } from 'vitest';
import { contornoDoGeoJson, simplificar } from './geo';

describe('contornoDoGeoJson', () => {
  /**
   * Coordenadas reais de Blumenau/SC: lat ≈ -26.9, lon ≈ -49.07. Se a troca
   * estiver invertida, a latitude viria -49 (fora do Brasil, perto da Antártida)
   * — este teste falha alto em vez de deixar passar.
   */
  it('converte [lon,lat] do GeoJSON para [lat,lon] do Leaflet', () => {
    const geo = {
      type: 'Polygon',
      coordinates: [[[-49.07, -26.90], [-49.05, -26.90], [-49.05, -26.92], [-49.07, -26.92]]],
    };
    const r = contornoDoGeoJson(geo);
    expect(r).not.toBeNull();
    // Primeiro ponto: latitude tem que ser ~-26.9 (e NÃO -49).
    expect(r![0][0]).toBeCloseTo(-26.90, 5);
    expect(r![0][1]).toBeCloseTo(-49.07, 5);
    // Sanidade geográfica: latitude válida no Brasil continental.
    for (const [lat, lon] of r!) {
      expect(lat).toBeGreaterThan(-35);
      expect(lat).toBeLessThan(6);
      expect(lon).toBeLessThan(-30);
    }
  });

  /**
   * Bairro com ilha/enclave vem como MultiPolygon. Nosso modelo é um polígono
   * por área, então pegamos o maior anel (o corpo principal do bairro) em vez de
   * misturar as partes num contorno sem sentido.
   */
  it('MultiPolygon: usa o anel com mais pontos', () => {
    const pequeno = [[-49.0, -26.0], [-49.0, -26.1], [-49.1, -26.1]];
    const grande = [
      [-48.0, -25.0], [-48.1, -25.0], [-48.2, -25.1], [-48.3, -25.2], [-48.2, -25.3],
    ];
    const r = contornoDoGeoJson({ type: 'MultiPolygon', coordinates: [[pequeno], [grande]] });
    expect(r).toHaveLength(grande.length);
    expect(r![0][0]).toBeCloseTo(-25.0, 5); // veio do anel grande
  });

  it('recusa geometria que não é área', () => {
    expect(contornoDoGeoJson({ type: 'Point', coordinates: [-49, -26] })).toBeNull();
    expect(contornoDoGeoJson({ type: 'LineString', coordinates: [[-49, -26], [-48, -25]] })).toBeNull();
    expect(contornoDoGeoJson(null)).toBeNull();
    expect(contornoDoGeoJson({})).toBeNull();
  });

  it('recusa anel degenerado (menos de 3 pontos)', () => {
    expect(contornoDoGeoJson({ type: 'Polygon', coordinates: [[[-49, -26], [-48, -25]]] })).toBeNull();
  });
});

describe('simplificar', () => {
  it('não mexe em contorno pequeno', () => {
    const p: [number, number][] = [[-26, -49], [-26.1, -49], [-26.1, -49.1]];
    expect(simplificar(p, 120)).toEqual(p);
  });

  /**
   * Contorno de bairro no OSM pode ter milhares de pontos. Sem o teto, cada
   * checagem de frete no checkout percorreria tudo isso — e `poligonoValido`
   * (geometria.ts) rejeitaria acima de 200 pontos, fazendo a área salva
   * simplesmente não funcionar.
   */
  it('corta contorno gigante no teto, preservando o início', () => {
    const enorme: [number, number][] = Array.from({ length: 3000 }, (_, i) => [-26 - i / 100000, -49]);
    const r = simplificar(enorme, 120);
    expect(r).toHaveLength(120);
    expect(r[0]).toEqual(enorme[0]);
  });
});
