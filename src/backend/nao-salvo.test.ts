import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { mesmoConteudo } from '../../frontend/src/lib/nao-salvo';

/*
 * `mesmoConteudo` decide se a tela está suja. Errar pra QUALQUER lado é ruim de
 * um jeito específico: falso positivo pede confirmação a quem não digitou nada
 * (e ensina o lojista a clicar "sair" sem ler), falso negativo perde a edição
 * em silêncio.
 */
describe('mesmoConteudo', () => {
  it('iguais são iguais', () => {
    expect(mesmoConteudo({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true);
  });

  /*
   * O CASO QUE `JSON.stringify` CRU ERRA. A ordem das chaves depende do caminho
   * — objeto vindo do servidor vs. montado por `setState` — e comparar as
   * strings direto marcaria a tela como suja sem ninguém ter tocado nela.
   */
  it('ordem das chaves não conta', () => {
    expect(mesmoConteudo({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(mesmoConteudo({ x: { p: 1, q: 2 } }, { x: { q: 2, p: 1 } })).toBe(true);
  });

  /* Campo opcional que o servidor não mandou e a tela inicializou como
     `undefined` não é edição. */
  it('undefined e ausente são a mesma coisa', () => {
    expect(mesmoConteudo({ a: 1, t: undefined }, { a: 1 })).toBe(true);
  });

  it('diferença real é detectada', () => {
    expect(mesmoConteudo({ a: 1 }, { a: 2 })).toBe(false);
    expect(mesmoConteudo({ a: 1 }, { a: '1' })).toBe(false);
    expect(mesmoConteudo({ a: 1 }, { a: 1, b: 1 })).toBe(false);
  });

  /* A ordem do ARRAY conta: os turnos do dia são uma lista ordenada, e trocar
     almoço por janta é edição de verdade. */
  it('ordem de array conta', () => {
    expect(mesmoConteudo([{ abre: '11:00' }, { abre: '18:00' }],
      [{ abre: '18:00' }, { abre: '11:00' }])).toBe(false);
  });

  it('aguenta agenda inteira', () => {
    const a = [{ dia: 3, aberto: true, abre: '11:00', fecha: '15:00', turnos: [{ abre: '11:00', fecha: '15:00' }] }];
    const b = [{ turnos: [{ fecha: '15:00', abre: '11:00' }], fecha: '15:00', abre: '11:00', aberto: true, dia: 3 }];
    expect(mesmoConteudo(a, b)).toBe(true);
  });
});

/*
 * O aviso não pode ser silenciosamente removido das telas que o têm: é uma
 * proteção invisível quando funciona, então nada na tela denuncia a ausência.
 */
describe('as telas de configuração usam o aviso', () => {
  const cfg = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'loja-config.tsx'), 'utf8');

  it('o hook é importado e usado', () => {
    expect(cfg).toMatch(/import \{[^}]*useAvisoNaoSalvo[^}]*\} from '@\/lib\/nao-salvo'/);
    expect((cfg.match(/useAvisoNaoSalvo\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  /* `marcarSalvo` tem que ser chamado no CARREGAMENTO também — só no save, a
     tela nasceria suja e avisaria sobre edição que não existe. */
  it('marca o ponto salvo mais de uma vez por tela (carregar e gravar)', () => {
    expect((cfg.match(/marcarSalvo\(\)/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});
