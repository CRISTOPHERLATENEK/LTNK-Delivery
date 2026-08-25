/**
 * A CONTA DA REDUÇÃO DE IMAGEM.
 *
 * `reduzirImagem` depende de `canvas` e `createImageBitmap`, que não existem
 * fora do navegador — então o que se testa é a DECISÃO: quanto encolher, e se
 * vale encolher. É onde os erros doem:
 *
 *  - encolher de menos deixa o cardápio pesando 50 MB no 4G do cliente;
 *  - encolher de mais entrega foto borrada num produto que precisa vender;
 *  - reprocessar o que já estava bom corta qualidade de graça.
 */
import { describe, it, expect } from 'vitest';
import { dimensoesReduzidas, precisaReduzir } from './reduzir-imagem';

describe('dimensoesReduzidas', () => {
  it('não mexe no que já cabe', () => {
    expect(dimensoesReduzidas(800, 600)).toEqual({ largura: 800, altura: 600 });
    expect(dimensoesReduzidas(1280, 1280)).toEqual({ largura: 1280, altura: 1280 });
  });

  it('encolhe pelo lado MAIOR, mantendo a proporção', () => {
    /* Foto de celular deitada: 4000×3000 → 1280×960. */
    expect(dimensoesReduzidas(4000, 3000)).toEqual({ largura: 1280, altura: 960 });
    /* Em pé: o lado maior é a altura. */
    expect(dimensoesReduzidas(3000, 4000)).toEqual({ largura: 960, altura: 1280 });
  });

  it('quadrada continua quadrada', () => {
    expect(dimensoesReduzidas(2000, 2000)).toEqual({ largura: 1280, altura: 1280 });
  });

  /*
   * Uma imagem absurdamente esticada arredondaria pra ZERO no lado curto, e o
   * canvas recusa desenhar com dimensão 0 — o upload quebraria em vez de
   * encolher.
   */
  it('lado curto nunca chega a zero', () => {
    const r = dimensoesReduzidas(4000, 3);
    expect(r.largura).toBe(1280);
    expect(r.altura).toBeGreaterThanOrEqual(1);
  });

  it('respeita um teto diferente quando passado', () => {
    expect(dimensoesReduzidas(2000, 1000, 500)).toEqual({ largura: 500, altura: 250 });
  });
});

describe('precisaReduzir', () => {
  const MB = 1024 * 1024;

  /* O caso que motivou tudo: foto de celular, 3 MB, 4000px. */
  it('foto de celular precisa', () => {
    expect(precisaReduzir('image/jpeg', 3 * MB, 4000, 3000)).toBe(true);
  });

  /* Dimensão pequena mas peso alto: PNG de print. O JPEG resolve em 80 KB. */
  it('peso alto sozinho já justifica', () => {
    expect(precisaReduzir('image/png', 2 * MB, 800, 600)).toBe(true);
  });

  /* Dimensão grande mas arquivo leve (WebP bem comprimido) ainda vale encolher:
     o navegador do cliente decodifica 4000px na memória pra desenhar 44. */
  it('dimensão grande sozinha já justifica', () => {
    expect(precisaReduzir('image/webp', 100 * 1024, 3000, 2000)).toBe(true);
  });

  /* Reprocessar o que já está bom só perde qualidade. */
  it('imagem já adequada passa intacta', () => {
    expect(precisaReduzir('image/jpeg', 120 * 1024, 900, 900)).toBe(false);
  });

  /*
   * GIF FICA FORA. Desenhar num canvas achata a animação no primeiro quadro: o
   * lojista subiria um GIF animado e receberia imagem parada, sem aviso. Perder
   * a animação em silêncio é pior que um arquivo maior.
   */
  it('GIF nunca é reduzido, nem grande', () => {
    expect(precisaReduzir('image/gif', 5 * MB, 4000, 3000)).toBe(false);
  });

  /* SVG é vetor: já é pequeno, e rasterizar destrói a razão de ele existir. */
  it('SVG nunca é reduzido', () => {
    expect(precisaReduzir('image/svg+xml', 2 * MB, 4000, 4000)).toBe(false);
  });

  it('aceita limites próprios', () => {
    expect(precisaReduzir('image/jpeg', 10 * 1024, 600, 600, 500, 900 * 1024)).toBe(true);
    expect(precisaReduzir('image/jpeg', 10 * 1024, 400, 400, 500, 900 * 1024)).toBe(false);
  });
});
