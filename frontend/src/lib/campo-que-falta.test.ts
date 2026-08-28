import { describe, it, expect } from 'vitest';
import { campoQueFalta } from './avisos-produto';

const OK = { nome: 'Pizza Calabresa', preco: '45.00', preco_promocional: '' };

describe('campoQueFalta', () => {
  it('produto completo não falta nada', () => {
    expect(campoQueFalta(OK)).toBeNull();
  });

  it('nome vazio aponta o nome', () => {
    expect(campoQueFalta({ ...OK, nome: '' })).toBe('campo-nome');
  });

  it('nome só com espaços também', () => {
    /* `required` do HTML aceita "   ". O produto entraria sem nome no cardápio. */
    expect(campoQueFalta({ ...OK, nome: '   ' })).toBe('campo-nome');
  });

  it('preço vazio aponta o preço', () => {
    expect(campoQueFalta({ ...OK, preco: '' })).toBe('p-preco');
  });

  it('nome vem antes do preço quando faltam os dois', () => {
    /* Focar o segundo campo faria a pessoa preencher o preço e tomar o mesmo
       bloqueio de novo, agora no nome. A ordem é a de leitura da tela. */
    expect(campoQueFalta({ nome: '', preco: '', preco_promocional: '' })).toBe('campo-nome');
  });

  it('promoção maior que o preço bloqueia e aponta a promoção', () => {
    expect(campoQueFalta({ ...OK, preco: '45.00', preco_promocional: '60.00' })).toBe('p-promo');
  });

  it('promoção válida não bloqueia', () => {
    expect(campoQueFalta({ ...OK, preco: '45.00', preco_promocional: '39.90' })).toBeNull();
  });

  it('preço "0" PASSA aqui — quem barra é o CHECK do banco', () => {
    /* Documenta o comportamento real, não o desejado: '0' é string não-vazia,
       então a validação de tela deixa passar e o CHECK (preco_centavos > 0)
       recusa no servidor. O lojista vê o erro, só que vindo do backend em vez
       de do campo.

       Deixado como está de propósito: inventar aqui uma segunda regra de preço
       mínimo criaria duas verdades sobre o mesmo assunto, e a do banco é a que
       vale. Se um dia isso incomodar, o lugar de resolver é alinhar as duas —
       este teste vai falhar e apontar para cá. */
    expect(campoQueFalta({ ...OK, preco: '0' })).toBeNull();
  });
});
