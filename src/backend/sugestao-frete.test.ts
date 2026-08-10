import { describe, it, expect } from 'vitest';
import { sugerirFreteCentavos, BASE_CENTAVOS } from './sugestao-frete';

describe('sugerirFreteCentavos', () => {
  it('dentro do raio base cobra só a base', () => {
    expect(sugerirFreteCentavos(0)).toBe(BASE_CENTAVOS);
    expect(sugerirFreteCentavos(1.4)).toBe(BASE_CENTAVOS);
    expect(sugerirFreteCentavos(2)).toBe(BASE_CENTAVOS);
  });

  it('passando do raio, soma por km', () => {
    // 5 km = base 500 + 3 km × 150 = 950
    expect(sugerirFreteCentavos(5)).toBe(950);
  });

  it('arredonda pra cima em múltiplos de 50 centavos', () => {
    // 3,3 km = 500 + 1,3 × 150 = 695 → 700
    expect(sugerirFreteCentavos(3.3)).toBe(700);
  });

  it('cresce junto com a distância', () => {
    expect(sugerirFreteCentavos(8)).toBeGreaterThan(sugerirFreteCentavos(4));
  });

  it('entrada inválida não vira preço absurdo', () => {
    // Geocodificação falha e devolve NaN: melhor cair na base que sugerir R$ 0
    // ou um número gigante que o lojista salva sem olhar.
    expect(sugerirFreteCentavos(NaN)).toBe(BASE_CENTAVOS);
    expect(sugerirFreteCentavos(-3)).toBe(BASE_CENTAVOS);
  });
});
