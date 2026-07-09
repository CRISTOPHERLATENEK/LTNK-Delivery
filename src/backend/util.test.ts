import { describe, it, expect } from 'vitest';
import { cpfValido, cpfDigitos, emailValido } from './util';

describe('cpfDigitos', () => {
  it('remove máscara e mantém só os dígitos', () => {
    expect(cpfDigitos('111.444.777-35')).toBe('11144477735');
  });
  it('trunca em 11 dígitos (ignora excesso)', () => {
    expect(cpfDigitos('123456789012345')).toBe('12345678901');
  });
  it('devolve string vazia pra entrada não-string', () => {
    expect(cpfDigitos(undefined)).toBe('');
    expect(cpfDigitos(12345)).toBe('');
  });
});

describe('cpfValido', () => {
  it('aceita CPFs com dígito verificador correto', () => {
    expect(cpfValido('11144477735')).toBe(true);
    expect(cpfValido('390.533.447-05')).toBe(true); // com máscara
    expect(cpfValido('12345678909')).toBe(true);
  });
  it('rejeita dígito verificador errado', () => {
    expect(cpfValido('11144477736')).toBe(false);
    expect(cpfValido('39053344706')).toBe(false);
  });
  it('rejeita sequências repetidas (formato válido, CPF inexistente na prática)', () => {
    expect(cpfValido('11111111111')).toBe(false);
    expect(cpfValido('00000000000')).toBe(false);
    expect(cpfValido('99999999999')).toBe(false);
  });
  it('rejeita tamanho errado', () => {
    expect(cpfValido('123456789')).toBe(false);
    expect(cpfValido('123456789012')).toBe(false);
    expect(cpfValido('')).toBe(false);
  });
});

describe('emailValido', () => {
  it('aceita e-mails bem formados', () => {
    expect(emailValido('nome@dominio.com')).toBe(true);
    expect(emailValido('nome.sobrenome@sub.dominio.com.br')).toBe(true);
  });
  it('rejeita e-mails malformados', () => {
    expect(emailValido('sem-arroba.com')).toBe(false);
    expect(emailValido('sem-dominio@')).toBe(false);
    expect(emailValido('espaço no meio@dominio.com')).toBe(false);
    expect(emailValido(undefined)).toBe(false);
    expect(emailValido(123)).toBe(false);
  });
});
