import { describe, it, expect } from 'vitest';
import { fatorDaEscala, alturaLogo, ESCALA_PADRAO } from './logo-escala';

describe('fatorDaEscala', () => {
  it('o padrão (50) é exatamente 1× — quem não mexer não vê mudança', () => {
    expect(fatorDaEscala(ESCALA_PADRAO)).toBe(1);
  });

  it('as pontas são metade e dobro', () => {
    expect(fatorDaEscala(0)).toBe(0.5);
    expect(fatorDaEscala(100)).toBe(2);
  });

  it('cresce sem pular no meio da barra', () => {
    // As duas retas se encontram no 50; um degrau ali apareceria como a logo
    // saltando de tamanho enquanto se arrasta a barra.
    expect(fatorDaEscala(49)).toBeCloseTo(0.99, 5);
    expect(fatorDaEscala(51)).toBeCloseTo(1.02, 5);
  });

  it('valor fora da faixa é preso nas pontas, não extrapolado', () => {
    // Um 500 vindo de requisição adulterada não pode virar logo de 220px
    // cobrindo a tela inteira.
    expect(fatorDaEscala(500)).toBe(2);
    expect(fatorDaEscala(-80)).toBe(0.5);
  });

  it('dado inválido cai no padrão em vez de sumir com a logo', () => {
    // Multiplicador zero apagaria a marca do lojista por causa de uma linha
    // torta no banco.
    expect(fatorDaEscala(null)).toBe(1);
    expect(fatorDaEscala(undefined)).toBe(1);
    expect(fatorDaEscala(NaN)).toBe(1);
    expect(fatorDaEscala('abc' as unknown as number)).toBe(1);
  });

  it('string numérica funciona — o valor chega do JSON', () => {
    expect(fatorDaEscala('100' as unknown as number)).toBe(2);
  });
});

describe('alturaLogo', () => {
  it('mantém a altura base no padrão', () => {
    expect(alturaLogo(44, 50)).toBe(44);
    expect(alturaLogo(56, 50)).toBe(56);
  });

  it('cada superfície escala a partir da SUA base', () => {
    // Altura fixa igualaria o cabeçalho de 44px com a landing de 56px, apagando
    // a diferença que existe de propósito.
    expect(alturaLogo(44, 100)).toBe(88);
    expect(alturaLogo(56, 100)).toBe(112);
    expect(alturaLogo(44, 0)).toBe(22);
  });

  it('arredonda pra px inteiro', () => {
    expect(alturaLogo(45, 30)).toBe(36);
    expect(Number.isInteger(alturaLogo(37, 77))).toBe(true);
  });
});
