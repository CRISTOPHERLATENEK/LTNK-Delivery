import { describe, it, expect } from 'vitest';
import { formSujo } from './form-sujo';

/*
 * Os casos abaixo saíram do formulário real de produto — não são combinações
 * inventadas. Cada um corresponde a algo que o `abrirEdicao` faz ao carregar
 * (`p.descricao || ''`, `!!p.destaque`, `String(p.serve_pessoas)`) e que,
 * comparado ingenuamente com a linha do banco, acusaria mudança onde não houve.
 */
const BASE = {
  nome: 'Combo Casal',
  descricao: '',
  preco: '69.90',
  destaque: true,
  serve_pessoas: '2',
  cest: '',
};

describe('formSujo', () => {
  it('objeto idêntico não está sujo', () => {
    expect(formSujo({ ...BASE }, { ...BASE })).toBe(false);
  });

  it('pega mudança em texto', () => {
    expect(formSujo({ ...BASE, nome: 'Combo Casal TESTE' }, BASE)).toBe(true);
  });

  it('pega mudança em booleano', () => {
    expect(formSujo({ ...BASE, destaque: false }, BASE)).toBe(true);
  });

  it('pega preço alterado, inclusive de 69.90 para 69.9', () => {
    /* Numericamente igual, textualmente não. O formulário guarda string e é a
       string que vai pro backend, então isto É uma alteração. */
    expect(formSujo({ ...BASE, preco: '69.9' }, BASE)).toBe(true);
  });

  it('null, undefined e vazio são a mesma coisa', () => {
    /* O caso que faria o aviso disparar sozinho: produto com descrição nula no
       banco vira '' na tela. Abrir e fechar sem tocar em nada não pode pedir
       confirmação. */
    expect(formSujo({ ...BASE, descricao: '' }, { ...BASE, descricao: null } as never)).toBe(false);
    expect(formSujo({ ...BASE, cest: undefined } as never, { ...BASE, cest: '' })).toBe(false);
  });

  it('espaço digitado e apagado não conta como alteração', () => {
    expect(formSujo({ ...BASE, nome: '  Combo Casal  ' }, BASE)).toBe(false);
  });

  it('mas espaço NO MEIO conta', () => {
    expect(formSujo({ ...BASE, nome: 'Combo  Casal' }, BASE)).toBe(true);
  });

  it('não depende da ordem das chaves', () => {
    /* JSON.stringify falharia aqui, e era a implementação óbvia. */
    const invertido = Object.fromEntries(Object.entries(BASE).reverse());
    expect(formSujo(invertido, BASE)).toBe(false);
  });

  it('campo que só existe num dos lados conta como alteração', () => {
    /* Se alguém acrescentar um campo ao formulário e esquecer de incluí-lo no
       snapshot original, o certo é AVISAR — errar para o lado de perguntar. */
    expect(formSujo({ ...BASE, novoCampo: 'x' } as never, BASE)).toBe(true);
  });

  it('campo novo vazio não conta — senão o aviso nasceria disparando', () => {
    expect(formSujo({ ...BASE, novoCampo: '' } as never, BASE)).toBe(false);
  });
});
