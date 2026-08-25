/**
 * A CHAVE QUE DECIDE SE DOIS ITENS DO CARRINHO SÃO "O MESMO".
 *
 * Ela ordenava os ids das opções. Com combo isso é um defeito de perda de dado:
 * "Calabresa na pizza 1 + Bacon na pizza 2" e o inverso têm os MESMOS ids, então
 * geravam a MESMA chave — os dois viravam `2× Combo` e uma das configurações
 * desaparecia sem aviso nenhum.
 *
 * `chaveItem` não é exportada (é detalhe do módulo do carrinho), então o teste lê
 * a regra do fonte. É varredura, e é burra de propósito: o que ela garante é que
 * a ordenação NÚMERICA cega não volte, e que o slot participe da comparação.
 *
 * O comportamento em si está coberto pelos testes de `escolhasParaEnvio`, que é
 * quem produz o que entra aqui.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * Vive no lado do BACKEND, como os outros scanners: o tsconfig do frontend não
 * inclui os tipos do Node, então teste que lê arquivo não compila lá — `tsc -b`
 * quebraria mesmo com o vitest passando.
 */
const FRONT = path.resolve(__dirname, '..', '..', 'frontend', 'src');
const fonte = fs.readFileSync(path.join(FRONT, 'lib', 'carrinho.ts'), 'utf8');

describe('chaveItem', () => {
  const corpo = (() => {
    const i = fonte.indexOf('function chaveItem(');
    return fonte.slice(i, fonte.indexOf('\n}', i));
  })();

  it('existe', () => {
    expect(corpo).toContain('function chaveItem(');
  });

  /*
   * O SLOT PARTICIPA DA CHAVE. Sem isto, duas distribuições diferentes dos
   * mesmos sabores entre as pizzas colapsam numa linha só.
   */
  it('a chave inclui o slot quando há slot', () => {
    expect(corpo).toMatch(/\$\{o\.s\}:\$\{o\.o\}/);
  });

  /*
   * PRODUTO COMUM MANTÉM A CHAVE BYTE A BYTE, com a ordenação numérica de antes.
   *
   * Não é preciosismo: o carrinho salvo no `localStorage` guarda a chave já
   * calculada. Mudar o formato faria o mesmo item entrar como LINHA NOVA em vez
   * de somar quantidade — e o cliente veria "X-Burguer" duas vezes depois do
   * deploy, sem ter feito nada.
   */
  it('mantém a ordenação numérica quando tudo é número', () => {
    expect(corpo).toMatch(/soNumeros/);
    expect(corpo).toMatch(/sort\(\(a, b\) => a - b\)/);
  });

  /* A observação continua na chave: sem ela, um X-Burguer "sem cebola" e um
     normal viravam "2×" e uma das instruções desaparecia. */
  it('a observação continua entrando', () => {
    expect(corpo).toMatch(/observacao/);
    expect(corpo).toMatch(/obs \? '\|' \+ obs : ''/);
  });
});

/**
 * O MODAL É QUEM PRODUZ O QUE ENTRA NA CHAVE, e ele tem que mandar o slot.
 *
 * Se voltasse a mandar `opcoesIds` (a lista achatada que existia antes), a chave
 * não teria slot pra comparar — e a correção acima ficaria correta e inútil.
 */
describe('o modal manda as escolhas com slot', () => {
  const modal = fs.readFileSync(
    path.join(FRONT, 'pages', 'cliente', 'modal-produto.tsx'), 'utf8');

  it('usa escolhasParaEnvio', () => {
    expect(modal).toMatch(/opcoes: escolhasParaEnvio\(slots, escolhidas\)/);
  });

  /*
   * E as escolhas são indexadas por `slot:grupo`. Com dois slots do mesmo
   * produto — "2× Pizza Artesanal", o combo mais comum de pizzaria — indexar
   * pelo id do grupo fazia escolher calabresa na pizza 1 aparecer marcado na 2.
   */
  it('indexa as escolhas por slot e grupo', () => {
    expect(modal).toMatch(/escolhidas\[chaveEscolha\(/);
    expect(modal).not.toMatch(/escolhidas\[g\.id\]/);
  });
});
