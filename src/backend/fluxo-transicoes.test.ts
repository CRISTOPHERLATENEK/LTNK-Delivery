import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { TRANSICOES, ROTULOS, ehCancelamentoVindoDeFora } from './fluxoPedido';
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

describe('cancelamento vindo do iFood', () => {
  it('a tabela sozinha NÃO deixa cancelar depois de aceito', () => {
    /* Regra do nosso fluxo, e continua valendo para o lojista: depois de
       aceito, quem desiste desiste pela recusa. */
    for (const s of ['aceito', 'preparando', 'pronto', 'em_entrega'] as StatusPedido[]) {
      expect(TRANSICOES[s]).not.toContain('cancelado');
    }
  });

  it('mas o iFood cancelando é FATO, não pedido de permissão', () => {
    /*
     * O pedido do iFood tem outro dono: o cliente cancela no app dele a
     * qualquer momento. Sem esta exceção o evento chegava, a transição era
     * recusada com 409, virava linha de log, e o pedido ficava em 'preparando'
     * PARA SEMPRE — a cozinha seguia montando, o entregador saía com um pedido
     * que não existe mais, e a comida ia para o lixo com a loja pagando.
     */
    expect(ehCancelamentoVindoDeFora('cancelado', { vindoDoIfood: true })).toBe(true);
  });

  it('a exceção vale SÓ para cancelado', () => {
    /* Um evento do iFood não pode pular o pedido direto para 'entregue'
       passando por cima da máquina de estados. */
    for (const s of ['entregue', 'pronto', 'aceito', 'recusado'] as StatusPedido[]) {
      expect(ehCancelamentoVindoDeFora(s, { vindoDoIfood: true })).toBe(false);
    }
  });

  it('e SÓ vindo de fora', () => {
    /* Pelo painel, cancelar um pedido já aceito continua recusado — é decisão
       de produto, não um efeito colateral desta correção. */
    expect(ehCancelamentoVindoDeFora('cancelado', {})).toBe(false);
    expect(ehCancelamentoVindoDeFora('cancelado', { vindoDoIfood: false })).toBe(false);
  });
});

describe('sem eco de volta para o iFood', () => {
  it('a mudança vinda de lá não é avisada para lá', () => {
    /*
     * Avisar de volta é contar a eles o que eles acabaram de contar. No
     * cancelamento seria pedir o cancelamento de um pedido que o próprio iFood
     * já cancelou — e a resposta disso enche o log de falha para algo que deu
     * certo.
     */
    const fonte = fs.readFileSync(path.join(__dirname, 'fluxoPedido.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const i = fonte.indexOf('async function avisarIfoodDoStatus');
    expect(fonte.slice(i, i + 400)).toContain('if (vindoDoIfood) return;');
  });

  it('o servidor marca os eventos do iFood como vindos de lá', () => {
    const fonte = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(fonte).toContain('{ vindoDoIfood: true }');
  });
});
