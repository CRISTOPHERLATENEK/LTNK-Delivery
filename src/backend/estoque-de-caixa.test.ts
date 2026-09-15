import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  estoqueDerivado, saldoEfetivo, planejarEstoque, planejarControleDeEstoque,
  quantosSairiamDoAr, type ProdutoComEstoque,
} from './maxxgestao-estoque';

/*
 * O ESTOQUE DA CAIXA DE CERVEJA.
 *
 * O lojista cadastra "SCHIN CAIXA" no Maxx Gestão como COMPOSIÇÃO de 12×
 * "SCHIN UNIDADE". A caixa NÃO TEM saldo próprio lá — quem tem estoque é a
 * unidade, e a disponibilidade da caixa é derivada.
 *
 * Isto apareceu primeiro como "16 produtos sem estoque cadastrado", e o meu
 * diagnóstico estava errado: eu disse que nunca tinham sido inventariados e
 * mandei o lojista fazer entrada de estoque neles. Ele mandou o print da aba
 * Composição/Kit e mostrou o que era. Medido depois, no cadastro real:
 *
 *   SKOL CAIXA      12× var 6  (97 un)  →  8 caixas
 *   ORIGINAL CAIXA  12× var 2  (120 un) → 10 caixas
 *   SCHIN CAIXA     12× var 5  (40 un)  →  3 caixas
 *   ITAIPAVA CAIXA  12× var 13 (0 un)   →  0 → esgotado
 *
 * Dos 16, NOVE eram caixas. Os outros seis eram mesmo sem estoque.
 */

const nosso = (id: number, extra: Partial<ProdutoComEstoque> = {}): ProdutoComEstoque => ({
  id, variacaoErp: id, estoque: 0, controlaEstoque: false, estoqueDoErp: false,
  disponivel: true, ...extra,
});
const caixa = (id: number, componente: number, qtd: number, extra: Partial<ProdutoComEstoque> = {}) =>
  nosso(id, { composicao: [{ variacao: componente, quantidade: qtd }], ...extra });

describe('quantas caixas dá para montar', () => {
  it('divide o saldo da unidade pela quantidade', () => {
    expect(estoqueDerivado([{ variacao: 5, quantidade: 12 }], new Map([[5, 40]]))).toBe(3);
    expect(estoqueDerivado([{ variacao: 2, quantidade: 12 }], new Map([[2, 120]]))).toBe(10);
  });

  /* 40 unidades dão 3 caixas de 12, não 3,33: a fração que sobra não é caixa
     nenhuma, e prometer a quarta é prometer o que não existe. */
  it('arredonda para baixo', () => {
    expect(estoqueDerivado([{ variacao: 5, quantidade: 12 }], new Map([[5, 47]]))).toBe(3);
    expect(estoqueDerivado([{ variacao: 5, quantidade: 12 }], new Map([[5, 11]]))).toBe(0);
  });

  it('unidade zerada esgota a caixa', () => {
    expect(estoqueDerivado([{ variacao: 13, quantidade: 12 }], new Map([[13, 0]]))).toBe(0);
  });

  /* Negativo passa pela mesma régua do resto: conta como zero. */
  it('unidade negativa também esgota', () => {
    expect(estoqueDerivado([{ variacao: 5, quantidade: 12 }], new Map([[5, -30]]))).toBe(0);
  });

  /*
   * O MENOR COMPONENTE MANDA — é a conta de uma receita: com 10 pães e 2
   * hambúrgueres dá para montar 2 lanches.
   */
  it('kit de vários componentes vale o que acabar primeiro', () => {
    const comp = [{ variacao: 1, quantidade: 1 }, { variacao: 2, quantidade: 1 }];
    expect(estoqueDerivado(comp, new Map([[1, 10], [2, 2]]))).toBe(2);
  });

  /*
   * SEM SABER O SALDO DO COMPONENTE, DEVOLVE `null` — e `null` é diferente de
   * zero: zero esgota o produto, `null` deixa em paz. Chutar zero tiraria do ar
   * a caixa cuja unidade ninguém inventariou.
   */
  it('componente sem linha de estoque não vira zero', () => {
    expect(estoqueDerivado([{ variacao: 9, quantidade: 12 }], new Map([[5, 40]]))).toBeNull();
  });

  it('produto sem composição devolve null', () => {
    expect(estoqueDerivado(undefined, new Map([[5, 40]]))).toBeNull();
    expect(estoqueDerivado([], new Map([[5, 40]]))).toBeNull();
  });

  it('quantidade inválida não vira divisão por zero', () => {
    expect(estoqueDerivado([{ variacao: 5, quantidade: 0 }], new Map([[5, 40]]))).toBeNull();
  });
});

describe('a composição ganha do saldo próprio', () => {
  /*
   * O CASO HEINEKEN, que o lojista achou em uma hora e derrubou a primeira
   * versão desta regra:
   *
   *   HEINEKEN CAIXA (var 716) É composição de 12× HEINEKEN LATA (var 715)
   *   HEINEKEN LATA ............ 35 unidades → dá 2 caixas
   *   MAS a caixa TEM linha de estoque própria, com saldo 0
   *
   * Com "saldo próprio primeiro" (o que eu escrevi antes), o zero ganhava e a
   * caixa aparecia ESGOTADA com 35 latas na prateleira.
   *
   * O zero da caixa é RESÍDUO, não informação: no modo "Multiplicar Quantidade
   * pelo Estoque" quem movimenta é o componente, e o registro do kit fica
   * parado. As outras nove caixas do cadastro nem linha têm — a Heineken tem
   * porque um dia alguém mexeu nela.
   */
  it('caixa com saldo próprio ZERO vale pelo componente', () => {
    const heineken = caixa(716, 715, 12);
    expect(saldoEfetivo(heineken, new Map([[716, 0], [715, 35]]))).toBe(2);
  });

  it('e vale pelo componente mesmo com saldo próprio positivo', () => {
    /* O registro do kit não é mantido; o do componente é. */
    const p = caixa(1004, 5, 12);
    expect(saldoEfetivo(p, new Map([[1004, 7], [5, 120]]))).toBe(10);
  });

  it('sem composição, o saldo próprio responde', () => {
    expect(saldoEfetivo(nosso(9, { estoque: 0 }), new Map([[9, 42]]))).toBe(42);
  });

  /* Composição que não dá para resolver (componente sem linha) CAI no saldo
     próprio, em vez de deixar o produto sem resposta. */
  it('composição irresolvível cai no saldo próprio', () => {
    const p = caixa(1004, 999, 12);
    expect(saldoEfetivo(p, new Map([[1004, 7]]))).toBe(7);
  });
});

describe('a caixa entra no ciclo como qualquer produto', () => {
  it('o saldo derivado é gravado', () => {
    const p = planejarEstoque(new Map([[5, 40]]), [caixa(1004, 5, 12)]);
    expect(p.ajustar).toEqual([{ id: 1004, estoque: 3 }]);
    expect(p.semLinha).toBe(0);
  });

  /*
   * E PASSA A ESGOTAR SOZINHO. Deixá-la de fora aqui seria justamente o defeito
   * que a composição veio resolver: caixa vendendo para sempre com a unidade
   * zerada.
   */
  it('a caixa também passa a esgotar quando o lojista liga', () => {
    const { ligar } = planejarControleDeEstoque(
      new Map([[5, 0]]), [caixa(1004, 5, 12)], true);
    expect(ligar).toEqual([1004]);
  });

  it('a conta da tela conta a caixa', () => {
    const { aVenda, sairiam } = quantosSairiamDoAr(
      new Map([[5, 0], [6, 97]]),
      [caixa(1004, 5, 12), caixa(1000, 6, 12)],
    );
    expect(aVenda).toBe(2);
    expect(sairiam).toBe(1);
  });

  /* Caixa cujo componente ninguém inventariou continua fora do controle — não
     vira esgotada por falta de informação. */
  it('caixa sem saldo do componente fica em paz', () => {
    const p = planejarEstoque(new Map(), [caixa(1004, 5, 12, { estoque: 9 })]);
    expect(p.ajustar).toEqual([]);
    expect(p.semLinha).toBe(1);
  });
});

describe('a composição é lida de hora em hora, não a cada 2 minutos', () => {
  const ciclo = fs.readFileSync(path.join(__dirname, 'maxxgestao-sincronizar-ciclo.ts'), 'utf8');
  const semComentarios = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const C = semComentarios(ciclo);

  /*
   * A composição muda uma vez por ano; relê-la a cada passada de estoque
   * custaria uma chamada por caixa a cada 2 minutos, do mesmo balde de 20 por
   * minuto que emite a NFC-e. Guardada, a conta sai de graça — os saldos dos
   * componentes já vêm na listagem que a passada faz de qualquer jeito.
   */
  it('a descoberta mora na passada de cadastro', () => {
    const iCadastro = C.indexOf('export async function sincronizarLojaErp');
    const iChamada = C.indexOf('await descobrirComposicoes(');
    const iEstoque = C.indexOf('export async function sincronizarEstoqueDaLoja');
    expect(iChamada).toBeGreaterThan(iCadastro);
    expect(iChamada).toBeLessThan(iEstoque);
  });

  it('a passada de estoque NÃO consulta composição', () => {
    const i = C.indexOf('export async function sincronizarEstoqueDaLoja');
    const corpo = C.slice(i, C.indexOf('\n}', C.indexOf('catch (e)', i)));
    expect(corpo).not.toContain('composicaoDoProduto');
    expect(corpo).not.toContain('descobrirComposicoes');
  });

  /*
   * PERGUNTA PRIMEIRO DE QUEM NÃO TEM SALDO PRÓPRIO — e isto não é otimização,
   * é o que faz a função chegar às caixas.
   *
   * Medido no Galderio: sem a prioridade, a fila anda na ordem do banco e as 20
   * primeiras perguntas caem em produtos que já têm saldo. A caixa está no fim
   * do cadastro; a 20 por hora, ela só seria alcançada em 56 horas. Produto com
   * saldo próprio nunca precisa de composição.
   */
  it('a fila é sem-linha, depois zerados, depois o resto', () => {
    const i = C.indexOf('export async function descobrirComposicoes');
    const corpo = C.slice(i, i + 1800);
    expect(corpo).toContain('!saldos.has(p.variacao)');
    /* O SALDO ZERO É A SEGUNDA FILA por causa da HEINEKEN CAIXA: ela tem
       registro próprio com 0 e é composição de 12 latas. "Tem saldo" não
       exclui "é kit". */
    expect(corpo).toMatch(/<= 0\)/);
    expect(corpo).toMatch(/\[\.\.\.semLinha, \.\.\.zerados, \.\.\.resto\]/);
  });

  /* A passada lê os saldos UMA vez e usa nas duas coisas: reler custaria 13
     chamadas do mesmo balde para receber a mesma resposta. */
  it('os saldos são lidos uma vez só por passada', () => {
    const i = C.indexOf('export async function sincronizarLojaErp');
    const corpo = C.slice(i, C.indexOf('export async function descobrirComposicoes'));
    const leituras = [...corpo.matchAll(/saldosDoLocal\(/g)];
    expect(leituras.length).toBe(1);
  });

  /* Teto por passada: uma loja com centenas de kits não pode gastar o
     orçamento do ERP de uma vez. */
  it('pergunta no máximo 60 por passada', () => {
    /* SUBIU DE 20 PARA 60 quando ficou claro que TODO produto precisa ser
       perguntado, e não só os sem saldo (caso Heineken): a 20 por hora o
       cadastro do Galderio levaria 56 horas; a 60, leva 19. E 60 chamadas são
       5% do orçamento de uma hora. */
    expect(C).toContain('export const COMPOSICOES_POR_PASSADA = 60;');
    const i = C.indexOf('export async function descobrirComposicoes');
    expect(C.slice(i, i + 700)).toContain('.slice(0, COMPOSICOES_POR_PASSADA)');
  });

  /*
   * PRODUTO NÃO COMPOSTO É MARCADO TAMBÉM. Sem isso ele voltaria para a fila
   * toda hora, para sempre, gastando uma chamada para reouvir "não é composto".
   */
  it('produto sem composição também é gravado', () => {
    const i = C.indexOf('export async function descobrirComposicoes');
    const corpo = C.slice(i, i + 900);
    /* A gravação está FORA do `if (itens.length)` — ela roda sempre. */
    expect(corpo).toMatch(/await gravarComposicao\(lojaId, p\.id, itens\);\s*\n\s*if \(itens\.length\)/);
  });
});

describe('só o modo que eu sei traduzir vira conta', () => {
  /*
   * O ERP tem outros tipos de composição além de "Multiplicar Quantidade pelo
   * Estoque" (`M`). É o único que existe nas caixas conferidas e o único cuja
   * conta eu sei estar certa. Os outros voltam vazios em vez de virar palpite —
   * estoque errado numa loja é venda que não existe.
   */
  it('outros tipos de composição são ignorados', () => {
    const cat = fs.readFileSync(path.join(__dirname, 'maxxgestao-catalogo.ts'), 'utf8');
    const i = cat.indexOf('export async function composicaoDoProduto');
    expect(i).toBeGreaterThan(0);
    const corpo = cat.slice(i, cat.indexOf('\n}', cat.indexOf('return itens;', i)));
    expect(corpo).toMatch(/tipoComposicaoEntrada[^\n]*!== 'M'\) continue;/);
  });

  /* 404 é RESPOSTA: este produto não é composto. */
  it('404 vira "não é composto", e o resto sobe', () => {
    const cat = fs.readFileSync(path.join(__dirname, 'maxxgestao-catalogo.ts'), 'utf8');
    const i = cat.indexOf('export async function composicaoDoProduto');
    const corpo = cat.slice(i, i + 900);
    expect(corpo).toMatch(/httpStatus === 404\) return \[\];/);
    expect(corpo).toContain('throw e;');
  });
});
