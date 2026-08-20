/**
 * Os avisos do cadastro de produto. São a diferença entre a pessoa corrigir
 * enquanto digita e descobrir o erro depois de enviar tudo.
 */
import { describe, it, expect } from 'vitest';
import {
  erroPrecoPromocional, nomeJaUsado, eanJaUsado, outrosProdutos, sugestoesFaltantes,
} from './avisos-produto';

const LISTA = [
  { id: 1, nome: 'X-Salada', codigo_barras: '7891234567890' },
  { id: 2, nome: 'Coca 350ml', codigo_barras: '' },
  { id: 3, nome: 'Batata', codigo_barras: null },
];

describe('erroPrecoPromocional', () => {
  it('promocional menor que o normal está certo', () => {
    expect(erroPrecoPromocional('39.90', '29.90')).toBeNull();
  });

  /* Igual não desconta nada E acende o selo de promoção — promete o que não dá. */
  it('promocional IGUAL ao normal é recusado', () => {
    expect(erroPrecoPromocional('39.90', '39.90')).toMatch(/MENOR/);
  });

  it('promocional maior é recusado', () => {
    expect(erroPrecoPromocional('39.90', '49.90')).toMatch(/MENOR/);
  });

  it('zero ou negativo é recusado com mensagem própria', () => {
    expect(erroPrecoPromocional('39.90', '0')).toMatch(/maior que zero/);
    expect(erroPrecoPromocional('39.90', '-5')).toMatch(/maior que zero/);
  });

  it('campo vazio não é erro — a pessoa ainda está preenchendo', () => {
    expect(erroPrecoPromocional('39.90', '')).toBeNull();
    expect(erroPrecoPromocional('', '29.90')).toBeNull();
  });

  it('texto que não é número não inventa erro', () => {
    expect(erroPrecoPromocional('39.90', 'abc')).toBeNull();
  });
});

describe('nomeJaUsado', () => {
  it('acha o repetido ignorando caixa e espaço', () => {
    expect(nomeJaUsado('  x-salada ', LISTA)).toBe('X-Salada');
    expect(nomeJaUsado('X-SALADA', LISTA)).toBe('X-Salada');
  });

  it('nome novo não acusa nada', () => {
    expect(nomeJaUsado('X-Bacon', LISTA)).toBeNull();
  });

  it('uma letra não acusa — a pessoa acabou de começar a digitar', () => {
    expect(nomeJaUsado('X', LISTA)).toBeNull();
  });
});

describe('eanJaUsado', () => {
  it('acha o código repetido', () => {
    expect(eanJaUsado('7891234567890', LISTA)).toBe('X-Salada');
  });

  /* Vários produtos sem código é normal (PLU de balança, item sem EAN) e não
     pode acusar duplicidade entre eles. */
  it('vazio nunca é duplicado, nem contra produto sem código', () => {
    expect(eanJaUsado('', LISTA)).toBeNull();
    expect(eanJaUsado('   ', LISTA)).toBeNull();
  });

  it('código novo não acusa', () => {
    expect(eanJaUsado('7899999999999', LISTA)).toBeNull();
  });
});

describe('outrosProdutos', () => {
  /* Sem isso, editar sem mudar o nome acusaria o próprio produto. */
  it('exclui o produto que está sendo editado', () => {
    expect(outrosProdutos(LISTA, 1).map(p => p.id)).toEqual([2, 3]);
  });

  it('em produto novo, todos contam', () => {
    expect(outrosProdutos(LISTA, 'novo')).toHaveLength(3);
  });

  it('lista ainda carregando não quebra', () => {
    expect(outrosProdutos(undefined, 'novo')).toEqual([]);
  });
});

describe('sugestoesFaltantes', () => {
  const BORDAS = ['Sem borda', 'Catupiry', 'Cheddar'];

  it('grupo vazio oferece todas', () => {
    expect(sugestoesFaltantes(BORDAS, [])).toEqual(BORDAS);
  });

  /* O comportamento que o lojista pediu: continuar oferecendo o resto. */
  it('depois de adicionar uma, as outras CONTINUAM na lista', () => {
    expect(sugestoesFaltantes(BORDAS, [{ nome: 'Catupiry' }]))
      .toEqual(['Sem borda', 'Cheddar']);
  });

  /* Opção digitada à mão também tira o chip, senão o botão gera duplicata. */
  it('casa ignorando caixa e espaço', () => {
    expect(sugestoesFaltantes(BORDAS, [{ nome: '  catupiry ' }, { nome: 'CHEDDAR' }]))
      .toEqual(['Sem borda']);
  });

  it('com todas usadas, não sobra nada (a fileira some sozinha)', () => {
    expect(sugestoesFaltantes(BORDAS, BORDAS.map(nome => ({ nome })))).toEqual([]);
  });

  it('grupo sem sugestões cadastradas não quebra', () => {
    expect(sugestoesFaltantes(undefined, [{ nome: 'X' }])).toEqual([]);
  });

  it('opção com nome nulo não atrapalha o casamento', () => {
    expect(sugestoesFaltantes(BORDAS, [{ nome: null }])).toEqual(BORDAS);
  });
});
