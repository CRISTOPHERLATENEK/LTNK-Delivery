import { describe, it, expect } from 'vitest';
import { TRANSICOES, ROTULOS } from './fluxoPedido';
import type { StatusPedido } from '../tipos/modelos';

/**
 * Testa a TABELA de transições, não a função — `transicionarStatus` fala com o
 * banco, e o que interessa aqui é a regra: quais caminhos existem.
 */
describe('TRANSICOES', () => {
  const todos = Object.keys(TRANSICOES) as StatusPedido[];

  it('todo status tem rótulo pro cliente ler', () => {
    for (const s of todos) expect(ROTULOS[s], `sem rótulo: ${s}`).toBeTruthy();
  });

  it('nenhum status aponta pra si mesmo', () => {
    /*
     * Ir de "pronto" para "pronto" NÃO é transição — é já estar lá.
     * `transicionarStatus` trata esse caso antes da tabela, devolvendo o pedido
     * como sucesso (duplo clique, painel em duas abas). Se alguém declarasse o
     * laço aqui, o pedido ganharia uma linha falsa no histórico a cada clique.
     */
    for (const s of todos) {
      expect(TRANSICOES[s], `${s} aponta pra si mesmo`).not.toContain(s);
    }
  });

  it('todo destino é um status conhecido', () => {
    for (const s of todos) {
      for (const destino of TRANSICOES[s]) {
        expect(todos, `${s} → ${destino} não existe`).toContain(destino);
      }
    }
  });

  it('os estados finais não têm saída', () => {
    // Dinheiro e estoque já foram resolvidos nesses três; reabrir criaria
    // pedido pago sem nota, ou estoque devolvido duas vezes.
    for (const s of ['entregue', 'cancelado', 'recusado'] as StatusPedido[]) {
      expect(TRANSICOES[s], `${s} deveria ser final`).toEqual([]);
    }
  });

  it('existe um caminho completo de pendente até entregue', () => {
    let atual: StatusPedido = 'pendente';
    const caminho: StatusPedido[] = [atual];
    const ordem: StatusPedido[] = ['aceito', 'preparando', 'pronto', 'em_entrega', 'entregue'];
    for (const proximo of ordem) {
      expect(TRANSICOES[atual], `${atual} não chega em ${proximo}`).toContain(proximo);
      atual = proximo;
      caminho.push(atual);
    }
    expect(caminho).toHaveLength(6);
  });

  it('pedido só pode ser recusado enquanto está pendente', () => {
    // Recusar depois de aceito confundiria o cliente, que já foi avisado de que
    // a loja aceitou — nesse ponto o caminho é cancelar, não recusar.
    for (const s of todos) {
      if (s === 'pendente') continue;
      expect(TRANSICOES[s], `${s} não deveria permitir recusa`).not.toContain('recusado');
    }
  });
});
