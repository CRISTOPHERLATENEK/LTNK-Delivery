import { describe, it, expect } from 'vitest';
import { classificarCurvaAbc, resumirClassesAbc } from './curva-abc';

const item = (nome: string, total: number, qtd = 1) =>
  ({ nome_produto: nome, quantidade: qtd, total_centavos: total });

describe('classificarCurvaAbc', () => {
  it('ordena por faturamento, não pela ordem de entrada', () => {
    const curva = classificarCurvaAbc([item('refri', 1000), item('pizza', 9000)]);
    expect(curva.map(i => i.nome_produto)).toEqual(['pizza', 'refri']);
  });

  /**
   * O caso que o "mais vendidos" erra: refrigerante lidera em UNIDADES e é classe
   * C em dinheiro. É a razão de a curva existir.
   */
  it('separa quem vende muita unidade de quem faz o faturamento', () => {
    const curva = classificarCurvaAbc([
      item('refri', 500, 100),   // 100 unidades, R$ 5
      item('pizza', 9500, 10),   // 10 unidades, R$ 95
    ]);
    expect(curva.find(i => i.nome_produto === 'pizza')!.classe).toBe('A');
    expect(curva.find(i => i.nome_produto === 'refri')!.classe).toBe('C');
  });

  /**
   * Sem a regra "quem cruza a fronteira entra na classe de cima", uma loja com um
   * produto dominante não teria classe A nenhuma.
   */
  it('inclui na classe A o item que atravessa os 80%', () => {
    // 55% + 45%: o segundo entra com o acumulado em 55 (abaixo de 80) e leva o
    // total a 100 — é ele que atravessa a fronteira, então é A também. Dois
    // produtos, os dois essenciais: é o resultado certo, e é o que a regra
    // "quem cruza entra na classe de cima" garante.
    const curva = classificarCurvaAbc([item('metade', 5500), item('outra-metade', 4500)]);
    expect(curva.map(i => i.classe)).toEqual(['A', 'A']);
  });

  /** Onde a fronteira REALMENTE corta: o item que entra já acima de 80%. */
  it('joga em B o item que entra depois dos 80%', () => {
    const curva = classificarCurvaAbc([item('a', 8500), item('b', 1400), item('c', 100)]);
    expect(curva.map(i => i.classe)).toEqual(['A', 'B', 'C']);
  });

  it('produto único é 100% e classe A', () => {
    const curva = classificarCurvaAbc([item('so-esse', 4200)]);
    expect(curva).toHaveLength(1);
    expect(curva[0]).toMatchObject({ classe: 'A', participacao_percent: 100, acumulado_percent: 100 });
  });

  it('acumulado é monotônico e fecha em 100', () => {
    const curva = classificarCurvaAbc([
      item('a', 5000), item('b', 3000), item('c', 1500), item('d', 400), item('e', 100),
    ]);
    const acc = curva.map(i => i.acumulado_percent);
    expect(acc).toEqual([...acc].sort((x, y) => x - y));
    expect(acc[acc.length - 1]).toBe(100);
  });

  it('classifica A/B/C num cardápio com cauda longa', () => {
    const curva = classificarCurvaAbc([
      item('a', 5000), item('b', 3000),           // 50% + 30% = 80%
      item('c', 1000), item('d', 500),            // até 95%
      item('e', 300), item('f', 200),             // cauda
    ]);
    expect(curva.map(i => i.classe)).toEqual(['A', 'A', 'B', 'B', 'C', 'C']);
  });

  /** Período sem venda: lista vazia, não divisão por zero. */
  it('devolve vazio sem faturamento', () => {
    expect(classificarCurvaAbc([])).toEqual([]);
    expect(classificarCurvaAbc([item('nada', 0)])).toEqual([]);
  });

  it('não muta o array recebido', () => {
    const entrada = [item('refri', 1000), item('pizza', 9000)];
    classificarCurvaAbc(entrada);
    expect(entrada.map(i => i.nome_produto)).toEqual(['refri', 'pizza']);
  });
});

describe('resumirClassesAbc', () => {
  it('conta itens e faturamento por classe', () => {
    const curva = classificarCurvaAbc([
      item('a', 5000), item('b', 3000), item('c', 1000), item('d', 500), item('e', 500),
    ]);
    const resumo = resumirClassesAbc(curva);
    expect(resumo.map(r => r.classe)).toEqual(['A', 'B', 'C']);
    expect(resumo.reduce((s, r) => s + r.itens, 0)).toBe(5);
    expect(resumo.reduce((s, r) => s + r.total_centavos, 0)).toBe(10000);
  });

  /** Classe vazia continua na lista: some da tela = parece que não calculou. */
  it('devolve as três classes mesmo quando alguma está zerada', () => {
    const resumo = resumirClassesAbc(classificarCurvaAbc([item('so-esse', 1000)]));
    expect(resumo).toHaveLength(3);
    expect(resumo.find(r => r.classe === 'C')).toMatchObject({ itens: 0, total_centavos: 0 });
  });
});
