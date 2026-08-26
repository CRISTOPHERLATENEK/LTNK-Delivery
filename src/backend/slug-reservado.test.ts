import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SLUGS_RESERVADOS, slugReservado } from './slug-reservado';

describe('slugReservado', () => {
  it('barra os que colidem com rota', () => {
    expect(slugReservado('pedidos')).toBe(true);
    expect(slugReservado('carrinho')).toBe(true);
    expect(slugReservado('api')).toBe(true);
  });

  it('não barra nome de loja de verdade', () => {
    expect(slugReservado('unimaxx-mostruario')).toBe(false);
    expect(slugReservado('pizzaria-da-paula')).toBe(false);
    /* Só o segmento INTEIRO colide: `/pedidos-do-ze` não casa com `/pedidos`. */
    expect(slugReservado('pedidos-do-ze')).toBe(false);
  });

  it('ignora caixa e espaço em volta', () => {
    expect(slugReservado('  Pedidos ')).toBe(true);
  });

  /*
   * O JEITO DE ESTA LISTA APODRECER é alguém criar uma rota em `App.tsx` e não
   * lembrar daqui — e o sintoma só aparece na loja de um cliente, meses depois.
   * Este teste lê as rotas de verdade e falha se alguma não estiver na lista.
   */
  it('cobre todas as rotas estáticas de topo do app', () => {
    const app = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'frontend', 'src', 'App.tsx'), 'utf8');
    const rotas = [...app.matchAll(/path="\/([a-z0-9-]+)/g)].map(m => m[1]);
    expect(rotas.length).toBeGreaterThan(5);
    const faltando = [...new Set(rotas)].filter(r => !SLUGS_RESERVADOS.includes(r));
    expect(faltando).toEqual([]);
  });
});

/*
 * A LISTA PODE ESTAR PERFEITA E A ROTA NÃO CHAMAR NINGUÉM.
 *
 * Sem isto, apagar a checagem da rota deixa todos os testes acima passando: a
 * lista continua correta, só não é consultada por nada.
 */
describe('a rota de configuração da loja usa a lista', () => {
  const lojista = fs.readFileSync(
    path.resolve(__dirname, 'rotas', 'lojista.ts'), 'utf8');
  const codigo = lojista.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('recusa slug reservado antes de gravar', () => {
    expect(codigo).toMatch(/slugReservado\(s\)/);
    const checagem = codigo.indexOf('slugReservado(s)');
    const grava = codigo.indexOf('UPDATE lojas SET', checagem);
    expect(checagem).toBeGreaterThan(-1);
    /* A checagem tem que vir ANTES do UPDATE: depois dele, a rota devolveria
       erro com o slug já gravado. */
    expect(grava).toBeGreaterThan(checagem);
  });
});
