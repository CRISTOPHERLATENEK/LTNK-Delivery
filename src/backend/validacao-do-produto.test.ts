import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { faltaNoProduto, campoQueFalta } from '../../frontend/src/lib/avisos-produto';

/*
 * O SUBMIT DIZENDO O QUE FALTA, E NÃO SÓ PULANDO PARA O CAMPO.
 *
 * Com cinco abas, o `required` do HTML não bloqueia nada: campo obrigatório numa
 * aba desmontada não existe no DOM. A tela já levava o foco até ele — mas sem
 * uma palavra explicando o motivo. Quem clicava em "Salvar" via a aba trocar e o
 * cursor pular, o que se lê como bug, não como validação.
 */

const form = (extra: Partial<{ nome: string; preco: string; preco_promocional: string }> = {}) => ({
  nome: 'Balde de Jack', preco: '65', preco_promocional: '', ...extra,
});

describe('o que falta, e por quê', () => {
  it('formulário completo não bloqueia', () => {
    expect(faltaNoProduto(form())).toBeNull();
    expect(campoQueFalta(form())).toBeNull();
  });

  it('nome vazio aponta o campo e diz o motivo', () => {
    const f = faltaNoProduto(form({ nome: '   ' }));
    expect(f?.campo).toBe('campo-nome');
    expect(f?.aba).toBe('item');
    expect(f?.mensagem).toMatch(/nome/i);
  });

  it('preço vazio idem', () => {
    const f = faltaNoProduto(form({ preco: '' }));
    expect(f?.campo).toBe('p-preco');
    expect(f?.mensagem).toMatch(/preço/i);
  });

  /* Promoção maior que o preço não é campo vazio, é valor inconsistente — mas
     bloqueia igual, e o lugar de olhar é o campo da promoção. */
  it('promoção maior que o preço bloqueia e aponta a promoção', () => {
    const f = faltaNoProduto(form({ preco: '10', preco_promocional: '20' }));
    expect(f?.campo).toBe('p-promo');
    expect(f?.mensagem).toMatch(/menor/i);
  });

  /* A ORDEM IMPORTA: sem nome e sem preço, quem fala é o nome — é o primeiro
     campo da tela, e mandar a pessoa para o segundo a faria subir de novo. */
  it('aponta o primeiro problema, de cima para baixo', () => {
    expect(faltaNoProduto(form({ nome: '', preco: '' }))?.campo).toBe('campo-nome');
  });

  /* A regra e o texto moram no mesmo lugar: regra que muda numa tela e texto que
     fica na outra é como a mensagem envelhece. */
  it('campoQueFalta continua sendo a mesma regra', () => {
    expect(campoQueFalta(form({ preco: '' }))).toBe('p-preco');
  });
});

const TELA = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'produtos.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('a tela mostra o erro onde ele é', () => {
  it('a mensagem fica embaixo do campo, ligada por aria-describedby', () => {
    expect(TELA).toContain("aria-describedby={erroCampo?.campo === 'campo-nome' ? 'campo-nome-erro' : undefined}");
    expect(TELA).toContain('id="campo-nome-erro"');
    expect(TELA).toContain("aria-describedby={erroCampo?.campo === 'p-preco' ? 'p-preco-erro' : undefined}");
    expect(TELA).toContain('id="p-preco-erro"');
  });

  it('o campo com erro se marca como inválido', () => {
    expect(TELA).toContain("aria-invalid={erroCampo?.campo === 'campo-nome'}");
    expect(TELA).toContain("aria-invalid={erroCampo?.campo === 'p-preco'}");
  });

  /*
   * ROLAR ALÉM DE FOCAR. O foco rola o suficiente para o CAMPO aparecer, e não
   * o suficiente para a mensagem embaixo dele aparecer — que é justamente o que
   * se quer ler.
   */
  it('rola até o campo e foca sem rolar de novo', () => {
    expect(TELA).toContain("el?.scrollIntoView({ block: 'center', behavior: 'smooth' })");
    expect(TELA).toContain('el?.focus({ preventScroll: true })');
  });

  /* Abre a aba do problema antes de focar: o campo pode estar numa aba
     desmontada, e focar o que não existe não faz nada. */
  it('abre a aba do campo antes de focar', () => {
    expect(TELA).toContain('setAba(falta.aba);');
  });

  /* Mensagem de "falta o nome" em cima de um nome já digitado é a tela
     discutindo com quem está resolvendo. */
  it('o erro some ao digitar', () => {
    const i = TELA.indexOf('function set<K extends keyof FormProduto>');
    const corpo = TELA.slice(i, i + 400);
    expect(corpo).toContain('setErroCampo(null);');
  });
});
