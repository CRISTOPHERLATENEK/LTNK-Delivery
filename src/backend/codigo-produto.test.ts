import { describe, it, expect } from 'vitest';
import { gtinValido, eanDaNfce, codigoProdutoNfce } from './codigo-produto';

describe('gtinValido', () => {
  it('aceita EAN-13 real com dígito correto', () => {
    expect(gtinValido('7891000100103')).toBe(true);  // Nestlé
    expect(gtinValido('7894900011517')).toBe(true);  // Coca-Cola lata
  });

  it('aceita EAN-8, GTIN-12 e GTIN-14', () => {
    expect(gtinValido('96385074')).toBe(true);        // EAN-8
    expect(gtinValido('036000291452')).toBe(true);    // UPC-A (12)
    expect(gtinValido('00012345678905')).toBe(true);  // GTIN-14
  });

  /**
   * O caso que motiva a validação: um dígito trocado no cadastro. Sem checar,
   * isso viraria rejeição da SEFAZ no meio da venda.
   */
  it('recusa GTIN com dígito verificador errado', () => {
    expect(gtinValido('7891000100104')).toBe(false);
    expect(gtinValido('7894900011518')).toBe(false);
  });

  it('recusa tamanho fora dos GTIN válidos', () => {
    expect(gtinValido('123')).toBe(false);
    expect(gtinValido('1234567890')).toBe(false);   // 10 dígitos: não existe
    expect(gtinValido('123456789012345')).toBe(false); // 15
  });

  it('recusa vazio, nulo e não-numérico', () => {
    expect(gtinValido('')).toBe(false);
    expect(gtinValido(null)).toBe(false);
    expect(gtinValido(undefined)).toBe(false);
    expect(gtinValido('789100010010X')).toBe(false);
    expect(gtinValido('789-1000-10010')).toBe(false);
  });

  it('ignora espaço em volta (lojista que colou o código)', () => {
    expect(gtinValido('  7891000100103  ')).toBe(true);
  });
});

describe('eanDaNfce', () => {
  it('devolve o GTIN quando é válido', () => {
    expect(eanDaNfce('7891000100103')).toBe('7891000100103');
  });

  /** "SEM GTIN" sempre passa na SEFAZ; código inválido, não. */
  it('cai para SEM GTIN quando não é um GTIN confiável', () => {
    expect(eanDaNfce('7891000100104')).toBe('SEM GTIN');
    expect(eanDaNfce('abc')).toBe('SEM GTIN');
    expect(eanDaNfce('')).toBe('SEM GTIN');
    expect(eanDaNfce(null)).toBe('SEM GTIN');
  });
});

describe('codigoProdutoNfce', () => {
  it('usa o GTIN quando o produto tem código de barras válido', () => {
    expect(codigoProdutoNfce(7, '7891000100103')).toBe('7891000100103');
  });

  it('usa P + id quando não há GTIN utilizável', () => {
    expect(codigoProdutoNfce(7, '')).toBe('P7');
    expect(codigoProdutoNfce(7, null)).toBe('P7');
    expect(codigoProdutoNfce(7, '7891000100104')).toBe('P7'); // dígito errado
  });

  /**
   * A garantia que o campo existe pra dar: MESMO produto, MESMO cProd em notas
   * diferentes — era exatamente isso que o índice do item quebrava.
   */
  it('dá o mesmo código para o mesmo produto, seja qual for a posição na venda', () => {
    expect(codigoProdutoNfce(42, null)).toBe(codigoProdutoNfce(42, null));
    expect(codigoProdutoNfce(42, null)).not.toBe(codigoProdutoNfce(43, null));
  });

  it('não devolve vazio para item sem produto no cadastro', () => {
    expect(codigoProdutoNfce(null)).toBe('DIVERSOS');
    expect(codigoProdutoNfce(0)).toBe('DIVERSOS');
    expect(codigoProdutoNfce(undefined, '')).toBe('DIVERSOS');
  });
});
