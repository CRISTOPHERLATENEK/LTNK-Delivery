import { describe, it, expect } from 'vitest';
import {
  acaoDoEvento, ordenarEventos, separarNovos, emLotes, lotesDeAck, lotesDeMerchants,
  MAX_ACK_POR_REQUISICAO, MAX_MERCHANTS_POR_POLLING,
} from './ifood-protocolo';

describe('acaoDoEvento', () => {
  it('lê a sigla curta e o nome longo', () => {
    expect(acaoDoEvento({ code: 'PLC' })).toBe('novo');
    expect(acaoDoEvento({ fullCode: 'PLACED' })).toBe('novo');
    expect(acaoDoEvento({ code: 'CFM' })).toBe('confirmado');
    expect(acaoDoEvento({ fullCode: 'CONCLUDED' })).toBe('concluido');
  });

  it('CAR (pedido de cancelamento) também para a produção', () => {
    /* Tratar CAR como 'ignorar' faria a cozinha seguir montando um pedido que o
       cliente já desistiu. */
    expect(acaoDoEvento({ code: 'CAR' })).toBe('cancelado');
    expect(acaoDoEvento({ code: 'CAN' })).toBe('cancelado');
  });

  it('código desconhecido é IGNORAR, nunca NOVO', () => {
    /* A regra mais importante daqui: um código que não conhecemos criando
       pedido é pedido fantasma no painel e cozinha produzindo o que ninguém
       pediu. */
    for (const e of [{ code: 'XYZ' }, { fullCode: 'ALGUMA_COISA_NOVA' }, {}, { code: '' }]) {
      expect(acaoDoEvento(e)).toBe('ignorar');
    }
  });

  it('não depende de caixa nem de espaço', () => {
    expect(acaoDoEvento({ code: ' plc ' })).toBe('novo');
  });
});

describe('ordenarEventos', () => {
  it('coloca em ordem cronológica', () => {
    /* A doc avisa que vêm fora de ordem. Sem isto, CANCELLED antes de PLACED
       faz o pedido nascer cancelado. */
    const fora = [
      { id: 'c', createdAt: '2026-08-28T10:00:03Z' },
      { id: 'a', createdAt: '2026-08-28T10:00:01Z' },
      { id: 'b', createdAt: '2026-08-28T10:00:02Z' },
    ];
    expect(ordenarEventos(fora).map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('evento sem data vai para o FIM, não para o começo', () => {
    /* Aplicar por último é o que menos estraga um estado já construído pelos
       eventos datados. */
    const l = [{ id: 'x' }, { id: 'a', createdAt: '2026-08-28T10:00:01Z' }];
    expect(ordenarEventos(l).map(e => e.id)).toEqual(['a', 'x']);
  });

  it('data ilegível também vai para o fim', () => {
    const l = [{ id: 'x', createdAt: 'ontem' }, { id: 'a', createdAt: '2026-08-28T10:00:01Z' }];
    expect(ordenarEventos(l).map(e => e.id)).toEqual(['a', 'x']);
  });

  it('não altera o array recebido', () => {
    const orig = [{ id: 'b', createdAt: '2026-01-02' }, { id: 'a', createdAt: '2026-01-01' }];
    ordenarEventos(orig);
    expect(orig.map(e => e.id)).toEqual(['b', 'a']);
  });
});

describe('separarNovos', () => {
  it('processa só o novo, mas manda ACK de TUDO', () => {
    /* As duas regras da doc puxam para lados opostos: "descarte duplicados" e
       "envie ACK mesmo para os já processados". Confirmar só o que sobrou vira
       strike, e 100 strikes bloqueiam o polling por 5 minutos. */
    const r = separarNovos(
      [{ id: 'velho' }, { id: 'novo' }],
      new Set(['velho']),
    );
    expect(r.novos.map(e => e.id)).toEqual(['novo']);
    expect(r.idsParaAck).toEqual(['velho', 'novo']);
  });

  it('duplicado dentro do MESMO lote conta uma vez só', () => {
    const r = separarNovos([{ id: 'a' }, { id: 'a' }, { id: 'b' }], new Set());
    expect(r.novos.map(e => e.id)).toEqual(['a', 'b']);
    expect(r.idsParaAck).toEqual(['a', 'b']);
  });

  it('PLACED repetido não vira pedido novo', () => {
    /* Literal da doc: "Se receber PLACED repetido, não crie novo pedido." */
    const r = separarNovos([{ id: 'evt1', code: 'PLC' }], new Set(['evt1']));
    expect(r.novos).toHaveLength(0);
    expect(r.idsParaAck).toEqual(['evt1']);
  });

  it('evento sem id sai dos DOIS lados', () => {
    /* Não dá para deduplicar nem confirmar sem identificador, e mandar
       undefined no ACK derrubaria o lote inteiro por payload malformado. */
    const r = separarNovos([{ id: '' }, { id: '  ' }, {}, { id: 'ok' }], new Set());
    expect(r.novos.map(e => e.id)).toEqual(['ok']);
    expect(r.idsParaAck).toEqual(['ok']);
  });

  it('lote vazio não quebra', () => {
    expect(separarNovos([], new Set())).toEqual({ novos: [], idsParaAck: [] });
  });

  it('tudo já visto ainda produz ACK', () => {
    /* O caso que mais dói: sem ACK aqui, cada ciclo acumula strike em silêncio. */
    const r = separarNovos([{ id: 'a' }, { id: 'b' }], new Set(['a', 'b']));
    expect(r.novos).toHaveLength(0);
    expect(r.idsParaAck).toEqual(['a', 'b']);
  });
});

describe('lotes', () => {
  it('ACK respeita o MENOR dos dois limites da doc: 2000', () => {
    /* A doc do iFood se contradiz sobre o mesmo endpoint (2000 vs 10000).
       Indo pelo menor, os dois textos ficam satisfeitos — e descobrir qual é o
       certo custaria um 413 em produção, que é um lote inteiro sem ACK. */
    expect(MAX_ACK_POR_REQUISICAO).toBe(2000);
    const ids = Array.from({ length: 4500 }, (_, i) => `e${i}`);
    const lotes = lotesDeAck(ids);
    expect(lotes.map(l => l.length)).toEqual([2000, 2000, 500]);
    expect(lotes.flat()).toHaveLength(4500);
  });

  it('merchants respeita o máximo de 100', () => {
    expect(MAX_MERCHANTS_POR_POLLING).toBe(100);
    expect(lotesDeMerchants(Array.from({ length: 250 }, (_, i) => `m${i}`)).map(l => l.length))
      .toEqual([100, 100, 50]);
  });

  it('lista vazia não gera lote vazio', () => {
    /* Um lote vazio viraria uma requisição inútil por ciclo, para sempre. */
    expect(lotesDeAck([])).toEqual([]);
    expect(lotesDeMerchants([])).toEqual([]);
  });

  it('lista menor que o lote sai inteira', () => {
    expect(lotesDeAck(['a', 'b'])).toEqual([['a', 'b']]);
  });

  it('não perde nem duplica item', () => {
    const itens = Array.from({ length: 1000 }, (_, i) => i);
    expect(emLotes(itens, 7).flat()).toEqual(itens);
  });

  it('tamanho inválido estoura em vez de fazer laço infinito', () => {
    expect(() => emLotes([1, 2], 0)).toThrow();
    expect(() => emLotes([1, 2], -1)).toThrow();
  });
});
