import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * CATEGORIA RECOLHIDA NA VITRINE — "igual ao cadastro de produto".
 *
 * O pedido do lojista foi literal: clicar na categoria e ela abrir os produtos,
 * "senao vai ficar ruim de ver tudo", e igual ao que o cadastro ja faz. Entao o
 * que este arquivo protege nao e o desenho da faixa: e a regra ser UMA, usada
 * pelas duas telas, e a categoria fechada nao custar nada.
 *
 * A REGRA EM SI tem teste proprio, ao lado dela, em
 * `frontend/src/lib/recolher-categorias.test.ts`. Aqui e a ligacao entre
 * arquivos — e isso nenhum teste de unidade ve.
 *
 * OS NUMEROS SAO DAS LOJAS REAIS, medidos em 10/09/2026 (so itens a venda):
 *   Galderio Bebidas ... 458 em 13 categorias, a maior com 60  -> recolhido
 *   Mostruario .........  36                                   -> aberto
 */

const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ler = (p: string) => fs.readFileSync(path.join(__dirname, '../../frontend/src', p), 'utf8');
const VITRINE = semComentarios(ler('pages/cliente/loja.tsx'));
const CADASTRO = semComentarios(ler('pages/lojista/produtos.tsx'));

describe('a vitrine e o cadastro decidem pela mesma regra', () => {
  it('as duas telas chamam a mesma função', () => {
    expect(VITRINE).toContain('comecarRecolhido(');
    expect(CADASTRO).toContain('comecarRecolhido(');
  });

  /*
   * E NENHUMA DELAS TEM O NÚMERO SOLTO. Esta é a asserção que impede a volta do
   * `filtrados.length > 150` no meio do JSX, que era como o cadastro decidia
   * antes — e era por isso que a vitrine podia discordar dele.
   */
  it('nenhuma das duas compara com o limite na mão', () => {
    for (const tela of [VITRINE, CADASTRO]) {
      expect(tela).not.toMatch(/length\s*>\s*150/);
      expect(tela).not.toMatch(/>\s*LIMITE_RECOLHER/);
    }
  });
});

describe('o recolhimento na vitrine', () => {
  /*
   * FECHADA NÃO DESENHA PRODUTO. Se a categoria fechada ainda montasse o grid
   * e só escondesse com CSS, o ganho seria zero no que mais custa: são 458
   * cards com foto, e o cliente da loja está no 4G.
   */
  it('categoria fechada não monta o grid', () => {
    expect(VITRINE).toContain('{!aberta ? null : subs.length > 0 ? (');
  });

  /* A contagem fica visível fechada: "Águas" sem número não diz se vale o
     toque, e a pessoa abre categoria vazia para descobrir. */
  it('mostra quantos itens a categoria tem', () => {
    const i = VITRINE.indexOf('aria-expanded={aberta}');
    expect(VITRINE.slice(i, i + 700)).toContain('{prods.length}');
  });

  /* O estado guarda só a exceção: inicializar "todas abertas" dependeria de os
     dados já terem chegado na montagem, e sobreviveria a uma troca de loja
     falando de categoria que não existe mais. */
  it('o padrão vem da regra, não de um conjunto pré-montado', () => {
    expect(VITRINE).toContain('abertas[cat] ?? !recolherPorPadrao');
  });

  /* Leitor de tela precisa saber que aquilo abre e fecha — sem isso a faixa é
     um texto que por acaso responde ao toque. */
  it('a faixa se anuncia como algo que abre e fecha', () => {
    expect(VITRINE).toContain('aria-expanded={aberta}');
    expect(VITRINE).toContain("aria-controls={'cat-' + cat}");
  });

  /*
   * BUSCA E FILTRO NÃO SÃO AFETADOS. Quem digita "coca" ou toca na faixa de
   * categorias já disse o que quer: entregar isso fechado seria pedir dois
   * toques para a mesma resposta.
   */
  it('só o modo sem filtro é recolhido', () => {
    const i = VITRINE.indexOf('{semFiltro ? (');
    const j = VITRINE.indexOf(') : catSemSubfiltro ? (');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    const depois = VITRINE.slice(j);
    expect(depois).not.toContain('categoriaAberta(');
  });
});
