import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * O TROCO PRECISA APARECER PARA QUEM PREPARA O PEDIDO.
 *
 * "na hora do pagamento não aparece se vai precisar de troco."
 *
 * O dado existia em todo o caminho, e três das quatro pontas já o mostravam:
 *
 *   cliente informa no checkout ..... sim (`troco_para` em carrinho.tsx)
 *   banco guarda ................... sim (`pedidos.troco_para_centavos`)
 *   cupom impresso ................. sim ("Dinheiro / troco R$ 50,00")
 *   app do entregador .............. sim ("troco para R$ 50,00")
 *   PAINEL DO LOJISTA .............. NÃO — o cartão dizia só "Dinheiro"
 *
 * E o painel é justamente onde o pedido é PREPARADO. Quem separa a nota de
 * troco na gaveta está nessa tela; descobrir na hora da entrega é tarde.
 *
 * A causa não era falta de dado: a consulta do lojista usa `SELECT p.*`, então
 * o campo sempre chegou. Faltava desenhar.
 */

const RAIZ = path.join(__dirname, '..', '..');
const PAINEL = fs.readFileSync(path.join(RAIZ, 'frontend/src/pages/lojista/painel.tsx'), 'utf8');
const ENTREGADOR = fs.readFileSync(path.join(RAIZ, 'frontend/src/pages/entregador/index.tsx'), 'utf8');

describe('troco no painel do lojista', () => {
  it('o cartão do pedido mostra o troco', () => {
    expect(PAINEL).toContain('troco_para_centavos');
    expect(PAINEL).toMatch(/troco p\//);
  });

  /*
   * ZERO NÃO É TROCO. O campo é opcional no checkout, e "não informado" chega
   * como 0 ou nulo — um "troco para R$ 0,00" parece instrução e não é. O app do
   * entregador já tinha aprendido isso; o comentário lá registra o "0 solto na
   * tela" que apareceu antes da guarda.
   */
  it('não anuncia troco quando não foi informado', () => {
    expect(PAINEL).toMatch(/troco_para_centavos \?\? 0\) > 0/);
  });

  /* Só faz sentido em dinheiro: em Pix ou cartão não há troco a separar. */
  it('só aparece no pagamento em dinheiro', () => {
    const i = PAINEL.indexOf('troco p/');
    const antes = PAINEL.slice(Math.max(0, i - 400), i);
    expect(antes).toContain("forma_pagamento === 'dinheiro'");
  });

  /* A ponta que já funcionava continua funcionando. */
  it('o app do entregador segue mostrando', () => {
    expect(ENTREGADOR).toContain('troco_para_centavos');
  });
});

const CARRINHO = fs.readFileSync(path.join(RAIZ, 'frontend/src/pages/cliente/carrinho.tsx'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(RAIZ, 'src/backend/schema-mysql.ts'), 'utf8');
const CLIENTE = fs.readFileSync(path.join(RAIZ, 'src/backend/rotas/cliente.ts'), 'utf8');

/*
 * A PERGUNTA, E NÃO SÓ O VALOR.
 *
 * "no caso se vai precisar de troco" — o que faltava não era quanto, era SE.
 * O campo antigo era "Troco para quanto? (opcional)", e em branco significava
 * duas coisas ao mesmo tempo: "não preciso" e "não respondi". Quem separa a
 * nota na gaveta não tinha como distinguir.
 */
describe('a pergunta do troco no checkout', () => {
  it('pergunta antes de pedir o valor', () => {
    expect(CARRINHO).toContain('Vai precisar de troco?');
    expect(CARRINHO).toContain('Não preciso');
  });

  /* Perguntar "para quanto" a quem acabou de dizer que não precisa é pergunta
     sem sentido — e deixaria um valor contradizendo a resposta. */
  it('o valor só aparece depois do sim', () => {
    expect(CARRINHO).toMatch(/precisaTroco === true && \(/);
    expect(CARRINHO).toMatch(/setPrecisaTroco\(v\); if \(!v\) setTroco\(''\)/);
  });

  /*
   * OBRIGATÓRIA, MAS SEM MATAR O BOTÃO.
   *
   * Esta tela já teve o defeito do botão que não fazia nada e não dizia por quê
   * — está documentado no `disabled` dela. Exigir a resposta desabilitando
   * repetiria o erro; o bloqueio é por aviso, com rolagem até a pergunta.
   */
  it('exige a resposta por aviso, não desabilitando', () => {
    expect(CARRINHO).toMatch(/pagamento === 'dinheiro' && precisaTroco === null/);
    expect(CARRINHO).toContain('Falta dizer se vai precisar de troco.');
    const i = CARRINHO.indexOf('disabled={enviando ||');
    expect(CARRINHO.slice(i, i + 160)).not.toContain('precisaTroco');
  });
});

describe('os três estados chegam ao fim', () => {
  /* Sem DEFAULT na coluna: pedido gravado antes disto fica nulo, que é a
     verdade sobre ele. Um default 0 diria que o cliente recusou. */
  it('a coluna aceita nulo', () => {
    expect(SCHEMA).toContain("['pedidos', 'precisa_troco', 'precisa_troco TINYINT']");
    expect(SCHEMA).not.toContain('precisa_troco TINYINT NOT NULL');
  });

  /* Em Pix ou cartão a pergunta não existe — responder por ele seria inventar. */
  it('só grava a resposta quando o pagamento é dinheiro', () => {
    expect(CLIENTE).toMatch(/formaPagamento === 'dinheiro' && req\.body\.precisa_troco !== undefined/);
  });

  it('o painel mostra "sem troco" quando o cliente disse que não', () => {
    expect(PAINEL).toMatch(/precisa_troco === 0/);
    expect(PAINEL).toContain('sem troco');
  });

  it('o cupom impresso também', () => {
    expect(PAINEL).toContain('SEM TROCO');
  });

  it('o app do entregador também', () => {
    expect(ENTREGADOR).toMatch(/precisa_troco === 0/);
    expect(ENTREGADOR).toContain('não precisa');
  });
});
