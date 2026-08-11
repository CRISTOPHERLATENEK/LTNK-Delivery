import { describe, it, expect } from 'vitest';
import { detalheItem } from './detalhe-item';

describe('detalheItem', () => {
  it('põe a observação ANTES dos complementos', () => {
    // A ordem é a regra: numa comanda lida de relance, "sem cebola" depois de
    // quatro adicionais passa batido.
    expect(detalheItem({ opcoes_texto: 'Ponto: mal passado', observacao: 'sem cebola' }))
      .toBe('Obs.: sem cebola · Ponto: mal passado');
  });

  it('sozinhos, cada um aparece sem separador solto', () => {
    expect(detalheItem({ observacao: 'sem cebola' })).toBe('Obs.: sem cebola');
    expect(detalheItem({ opcoes_texto: 'Ponto: ao ponto' })).toBe('Ponto: ao ponto');
  });

  it('sem nada, devolve vazio — e não " · "', () => {
    // O chamador testa `if (detalhe)` pra decidir se mostra a linha; uma string
    // com só o separador ligaria o `if` e imprimiria um ponto solto no cupom.
    expect(detalheItem({})).toBe('');
    expect(detalheItem({ opcoes_texto: '', observacao: '' })).toBe('');
    expect(detalheItem({ opcoes_texto: null, observacao: null })).toBe('');
  });

  it('ignora campo que só tem espaço', () => {
    expect(detalheItem({ observacao: '   ', opcoes_texto: '  ' })).toBe('');
    expect(detalheItem({ observacao: '  sem sal  ' })).toBe('Obs.: sem sal');
  });
});
