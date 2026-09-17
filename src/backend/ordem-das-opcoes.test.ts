import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * A ORDEM DOS ITENS DENTRO DE UM COMPLEMENTO.
 *
 * Pedido do lojista: "quero poder arrastar cada produto pra onde eu quiser
 * também, ou clicar na seta pra cima ou pra baixo".
 *
 * Antes não existia: a ordem era a de cadastro, e mudá-la significava apagar e
 * recadastrar na sequência certa. Num grupo de dezesseis energéticos, isso é
 * dezesseis cadastros para trocar dois de lugar.
 *
 * E não é detalhe de cadastro: a ordem aqui é a ordem em que o CLIENTE lê a
 * lista, e o que está em cima é o que mais sai.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const LOJISTA = semComentarios(ler('src', 'backend', 'rotas', 'lojista.ts'));
const TELA = semComentarios(ler('frontend', 'src', 'pages', 'lojista', 'produtos.tsx'));

const ROTA = (() => {
  const i = LOJISTA.indexOf("router.put('/grupos/:id/opcoes/ordem'");
  expect(i).toBeGreaterThan(0);
  return LOJISTA.slice(i, LOJISTA.indexOf("router.put('/opcoes/:id'", i));
})();

describe('a rota da ordem', () => {
  /* `meuGrupo` é a autorização: sem ela, um id de grupo de outra loja
     reordenaria o cardápio dela. */
  it('confere que o grupo é da loja', () => {
    expect(ROTA).toContain('const grupo = await meuGrupo(loja, req.params.id)');
  });

  /*
   * RECEBE A LISTA INTEIRA, como a reordenação do combo. Mandar só "este foi do
   * 5 para o 2" obrigaria o servidor a recalcular o resto — e a conta feita nos
   * dois lados é a conta que diverge.
   */
  it('recebe a lista inteira e regrava tudo', () => {
    expect(ROTA).toContain('req.body.ordem');
    expect(ROTA).toMatch(/UPDATE opcoes_itens SET ordem = \? WHERE id = \? AND grupo_id = \?/);
    expect(ROTA).toContain('comTransacao');
  });

  /*
   * ID QUE NÃO É DO GRUPO É IGNORADO, não recusado: o `grupo_id` no WHERE já
   * protege, e derrubar a requisição inteira por um id velho de aba aberta faria
   * o arrasto falhar sem que a pessoa entendesse por quê.
   */
  it('ignora id que não é do grupo', () => {
    expect(ROTA).toContain('const validos = new Set(meus.map(m => m.id))');
    expect(ROTA).toContain('pedidos.filter(id => validos.has(id))');
  });

  /*
   * QUEM NÃO VEIO NA LISTA VAI PARA O FIM, e não some: uma aba desatualizada
   * mandaria uma lista sem o item criado há dez segundos, e sem esta linha ele
   * ficaria com a ordem antiga no meio dos novos.
   */
  it('o que não veio na lista não desaparece', () => {
    expect(ROTA).toContain('const resto = meus.map(m => m.id).filter(id => !nova.includes(id))');
    expect(ROTA).toContain('[...nova, ...resto]');
  });
});

describe('a tela', () => {
  it('dá para arrastar', () => {
    expect(TELA).toContain('onDragStart={() => setArrastandoOpcao(o.id)}');
    expect(TELA).toContain('moverOpcao(grupo, arrastandoOpcao, o.id)');
  });

  /*
   * AS SETAS NÃO SÃO REDUNDÂNCIA. `draggable` do HTML5 é inerte em toque — no
   * celular a alça não faz nada — e invisível para quem navega por teclado. É a
   * mesma razão pela qual as categorias já tinham setas ao lado da alça.
   */
  it('dá para mover com as setas, uma posição por vez', () => {
    expect(TELA).toContain('const anterior = grupo.opcoes[iNoGrupo - 1]');
    expect(TELA).toContain('const proximo = grupo.opcoes[iNoGrupo + 1]');
    expect(TELA).toContain('anterior && moverOpcao(grupo, o.id, anterior.id)');
    expect(TELA).toContain('proximo && moverOpcao(grupo, o.id, proximo.id)');
  });

  /* A seta do primeiro e a do último não têm para onde ir. */
  it('as pontas não oferecem movimento impossível', () => {
    expect(TELA).toContain('disabled={!anterior}');
    expect(TELA).toContain('disabled={!proximo}');
  });

  /* A ordem enviada é a do GRUPO inteiro, mesmo com a lista quebrada em seções
     na tela: `ordem` é uma coluna só, e mandar a ordem de uma seção deixaria o
     resto do grupo com a numeração antiga. */
  it('manda a ordem do grupo inteiro', () => {
    const i = TELA.indexOf('async function moverOpcao');
    const corpo = TELA.slice(i, TELA.indexOf('\n  }', i));
    expect(corpo).toContain('grupo.opcoes.map(x => String(x.id))');
    expect(corpo).toContain('/opcoes/ordem');
  });
});
