import { describe, it, expect } from 'vitest';
import { emailAnonimo, ehAnonimizado, dadosAnonimos } from './anonimizacao';

describe('emailAnonimo', () => {
  it('é único por conta — a coluna email tem índice único', () => {
    // Um valor fixo funcionaria na primeira exclusão e explodiria na segunda.
    expect(emailAnonimo(7)).not.toBe(emailAnonimo(8));
  });

  it('usa domínio que nunca entrega e-mail', () => {
    // .invalid é reservado pela RFC 2606: não resolve nem por acidente, então
    // nada é enviado depois pra quem pediu pra sair.
    expect(emailAnonimo(7)).toBe('removido-7@anonimizado.invalid');
  });

  it('id fracionário não gera e-mail com ponto', () => {
    expect(emailAnonimo(7.9)).toBe('removido-7@anonimizado.invalid');
  });
});

describe('ehAnonimizado', () => {
  it('reconhece conta já anonimizada', () => {
    // Pedir exclusão duas vezes não pode dar erro nem reprocessar.
    expect(ehAnonimizado(emailAnonimo(3))).toBe(true);
  });

  it('não confunde e-mail de gente com o marcador', () => {
    expect(ehAnonimizado('joao@gmail.com')).toBe(false);
    expect(ehAnonimizado('removido-1@gmail.com')).toBe(false);
  });

  it('ignora diferença de caixa', () => {
    expect(ehAnonimizado('REMOVIDO-1@ANONIMIZADO.INVALID')).toBe(true);
  });

  it('vazio ou nulo não é conta anonimizada', () => {
    expect(ehAnonimizado('')).toBe(false);
    expect(ehAnonimizado(null)).toBe(false);
    expect(ehAnonimizado(undefined)).toBe(false);
  });
});

describe('dadosAnonimos', () => {
  it('telefone e CPF saem VAZIOS, não nulos', () => {
    /*
     * As colunas telefone_unico e cpf_unico são geradas com NULLIF(coluna, ''):
     * vazio vira NULL no índice único e várias contas anonimizadas convivem.
     * Nulo direto na coluna base também funcionaria, mas vazio é o que o resto
     * do código já trata como "não informado".
     */
    const d = dadosAnonimos(5);
    expect(d.telefone).toBe('');
    expect(d.cpf).toBe('');
  });

  it('não deixa vestígio do dado antigo', () => {
    const d = dadosAnonimos(5);
    expect(d.nome).toBe('Cliente removido');
    expect(Object.values(d).join(' ')).not.toMatch(/\d{11}/);
  });

  it('o resultado é reconhecido como anonimizado', () => {
    expect(ehAnonimizado(dadosAnonimos(9).email)).toBe(true);
  });
});
