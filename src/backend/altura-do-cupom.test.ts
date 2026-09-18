import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { regraDePagina } from '../../frontend/src/lib/impressao';

/*
 * O CUPOM SAÍA NUMA FOLHA INTEIRA.
 *
 * "porque sai esse tamanho gigante na impressão? o tamanho tem que ser de
 *  acordo com as informações que existe no pedido."
 *
 * Os cupons declaravam `@page { size: 80mm auto }` desde sempre, e `auto` NÃO
 * FUNCIONA: o CSS aceita `auto` SOZINHO ou DUAS medidas — misturar uma medida
 * com a palavra `auto` é sintaxe inválida. O navegador descarta a declaração
 * inteira e cai no papel do sistema. No diálogo do lojista: um cupom de 7 cm no
 * meio de uma folha, e "1 folha de papel".
 *
 * Numa bobina térmica isso não é só feio: a impressora avança a folha inteira
 * antes de cortar, e cada pedido gasta 20 cm de bobina para imprimir 7.
 *
 * A altura só se sabe DEPOIS de montar a página — depende de quantos itens o
 * pedido tem, de quantos complementos cada item tem e de quantas linhas o
 * endereço ocupa. Por isso é medida no documento pronto; a CONTA, que é o que
 * erra, mora numa função pura e é verificada aqui sem navegador nenhum.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const IMPRESSAO = semComentarios(ler('frontend', 'src', 'lib', 'impressao.ts'));

const CUPOM = '<style>@page { size: 80mm auto; margin: 2mm; }</style>';

describe('a altura vem do conteúdo', () => {
  /* 96px = 1in = 25.4mm é a régua do CSS, não uma aproximação. 300px = 79,375mm
     → 80 arredondando para cima, + 2mm de margem em cima, + 2mm embaixo, + 1 de
     folga = 85. */
  it('converte px em mm pela régua do CSS', () => {
    expect(regraDePagina(CUPOM, 300)).toBe('@page { size: 80mm 85mm; }');
  });

  /*
   * A MARGEM ENTRA DUAS VEZES: o conteúdo cabe na área ENTRE as margens.
   * Somando uma só, a última linha do cupom cai para uma segunda folha — o
   * defeito oposto, e mais irritante, porque só aparece no pedido comprido.
   */
  it('soma a margem de cima e a de baixo', () => {
    const semMargem = '<style>@page { size: 80mm auto; margin: 0 }</style>';
    /* Mesmos 300px: 80 + 0 + 1 contra 80 + 4 + 1. A diferença é exatamente as
       duas margens. */
    expect(regraDePagina(semMargem, 300)).toBe('@page { size: 80mm 81mm; }');
  });

  /* Arredonda para CIMA. Um milímetro de papel a mais é barato; uma segunda
     folha com uma linha é um corte a mais na bobina e um cupom no lixo. */
  it('nunca corta o último milímetro', () => {
    /* 301px = 79,64mm → 80, não 79. */
    expect(regraDePagina(CUPOM, 301)).toBe('@page { size: 80mm 85mm; }');
    expect(regraDePagina(CUPOM, 380)).toBe('@page { size: 80mm 106mm; }');
  });

  /* Pedido comprido cresce a folha, que é o ponto: "de acordo com as
     informações que existe no pedido". */
  it('pedido maior, papel maior', () => {
    const curto = regraDePagina(CUPOM, 200)!;
    const longo = regraDePagina(CUPOM, 900)!;
    expect(Number(/(\d+)mm; \}/.exec(curto)![1])).toBeLessThan(Number(/(\d+)mm; \}/.exec(longo)![1]));
  });

  /* A largura NÃO é inventada: vem do `@page` que o próprio cupom declarou. É
     o que faz valer para 58mm sem passar parâmetro novo. */
  it('respeita a largura declarada pelo cupom', () => {
    const bobina58 = '<style>@page { size: 58mm auto; margin: 2mm; }</style>';
    expect(regraDePagina(bobina58, 300)).toContain('size: 58mm');
  });
});

describe('o que não dá para calcular fica como estava', () => {
  /*
   * SEM `@page` NÃO É CUPOM DE BOBINA. Forçar tamanho num documento comum
   * quebraria a impressão dele — e há chamadas que passam HTML sem regra
   * nenhuma.
   */
  it('HTML sem @page não é tocado', () => {
    expect(regraDePagina('<p>oi</p>', 300)).toBeNull();
  });

  it('@page sem medida de largura não é tocado', () => {
    expect(regraDePagina('<style>@page { margin: 2mm }</style>', 300)).toBeNull();
  });

  /* Altura zero, negativa ou não numérica é medição que falhou — e papel de
     zero milímetro não imprime nada. */
  it('medição inválida devolve null', () => {
    expect(regraDePagina(CUPOM, 0)).toBeNull();
    expect(regraDePagina(CUPOM, -5)).toBeNull();
    expect(regraDePagina(CUPOM, NaN)).toBeNull();
    expect(regraDePagina(CUPOM, Infinity)).toBeNull();
  });
});

describe('como a regra é aplicada', () => {
  /*
   * ANTES DO `print()`: o diálogo lê o `@page` no momento em que abre, e
   * injetar depois não muda mais nada — o preview já estaria montado.
   */
  it('entra antes de mandar imprimir', () => {
    const iAjuste = IMPRESSAO.indexOf('ajustarAlturaDaPagina(doc, html);');
    const iPrint = IMPRESSAO.indexOf('w.print();');
    expect(iAjuste).toBeGreaterThan(0);
    expect(iAjuste).toBeLessThan(iPrint);
  });

  /* Só `size`: `margin` e o resto continuam vindo da regra original, pela
     cascata. Repetir a margem aqui seria a mesma decisão em dois lugares. */
  it('sobrescreve só o tamanho', () => {
    expect(regraDePagina(CUPOM, 300)).not.toContain('margin');
  });

  /*
   * MEDIÇÃO É MELHORIA, NÃO REQUISITO. Falhar aqui não pode impedir o cupom de
   * sair: sem ela, volta a sair na folha do sistema, como saía antes.
   */
  it('falha em silêncio', () => {
    const i = IMPRESSAO.indexOf('function ajustarAlturaDaPagina(');
    const corpo = IMPRESSAO.slice(i, IMPRESSAO.indexOf('export function abrirEImprimir', i));
    expect(corpo).toContain('try {');
    expect(corpo).toContain('} catch {');
    expect(corpo).not.toContain('throw');
  });

  /*
   * ─────── MEDE O `body`, E NÃO O `documentElement` ───────
   *
   * A primeira versão pegava `Math.max(body, documentElement)`, que parecia a
   * escolha cuidadosa. Medido no navegador, com o cupom real do pedido #4:
   *
   *   body.scrollHeight ............. 241px  (63,8mm — o cupom)
   *   documentElement.scrollHeight ... 800px  (a altura do IFRAME)
   *
   * `documentElement.scrollHeight` nunca é menor que o viewport, e o viewport
   * aqui é o iframe de 800px onde a impressão acontece. O `Math.max` escolhia
   * sempre os 800 e produzia uma folha de 217mm — praticamente a A4 que se veio
   * consertar. E o teste unitário passava, porque a CONTA estava certa: o
   * número que entrava nela é que não era o do cupom.
   */
  it('mede o body, e não o viewport do iframe', () => {
    expect(IMPRESSAO).toContain('regraDePagina(html, doc.body?.scrollHeight ?? 0)');
    const i = IMPRESSAO.indexOf('function ajustarAlturaDaPagina(');
    const corpo = IMPRESSAO.slice(i, IMPRESSAO.indexOf('export function abrirEImprimir', i));
    expect(corpo).not.toContain('documentElement');
    expect(corpo).not.toContain('Math.max(');
  });

  /*
   * O CUPOM MEDIDO NO NAVEGADOR: 241px de conteúdo com 2mm de margem viram uma
   * folha de 69mm. O número está aqui para não voltar a ser 217 sem ninguém
   * perceber.
   */
  it('o cupom do pedido #4 dá 69mm, não 217', () => {
    expect(regraDePagina(CUPOM, 241)).toBe('@page { size: 80mm 69mm; }');
  });
});

describe('os quatro geradores de cupom passam por aqui', () => {
  /*
   * Todos chamam `abrirEImprimir`, então nenhum precisou mudar. O `auto` segue
   * escrito neles de propósito: é o valor que vale enquanto a medição não
   * aconteceu (e quando ela não acontece).
   */
  it('a correção é num lugar só', () => {
    expect((IMPRESSAO.match(/ajustarAlturaDaPagina\(/g) || []).length).toBe(2);
    const PAINEL = ler('frontend', 'src', 'pages', 'lojista', 'painel.tsx');
    expect(PAINEL).toContain('despacharImpressao(html, larguraMm, blocos)');
  });
});
