import { describe, it, expect } from 'vitest';
import { cicloIfood, type DepsCiclo, type LojaIfood } from './ifood-ciclo';
import type { EventoIfood } from './ifood-protocolo';

const LOJA: LojaIfood = { tenantDb: 'tenant_a', lojaId: 1, merchantId: 'm-aaa' };

/** Monta as dependências com um banco e uma rede de mentira. */
function montar(over: Partial<DepsCiclo> & { eventos?: EventoIfood[]; lojas?: LojaIfood[] } = {}) {
  const gravados: Array<{ tenantDb: string; ids: string[] }> = [];
  const acks: string[][] = [];
  const processados: Array<{ loja: LojaIfood; id: string }> = [];
  const vistos = new Set<string>();
  const ordem: string[] = [];

  const deps: DepsCiclo = {
    buscarLojas: async () => over.lojas ?? [LOJA],
    polling: over.polling ?? (async () => { ordem.push('polling'); return over.eventos ?? []; }),
    jaVistos: over.jaVistos ?? (async (_t, ids) => new Set(ids.filter(i => vistos.has(i)))),
    marcarVistos: over.marcarVistos ?? (async (t, evs) => {
      ordem.push('gravar');
      const ids = evs.map(e => String(e.id));
      ids.forEach(i => vistos.add(i));
      gravados.push({ tenantDb: t, ids });
    }),
    confirmar: over.confirmar ?? (async ids => { ordem.push('ack'); acks.push([...ids]); }),
    aoProcessar: over.aoProcessar ?? (async (loja, ev) => { processados.push({ loja, id: String(ev.id) }); }),
    registrar: over.registrar,
  };
  return { deps, gravados, acks, processados, vistos, ordem };
}

const ev = (id: string, extra: Partial<EventoIfood> = {}): EventoIfood =>
  ({ id, merchantId: 'm-aaa', code: 'PLC', createdAt: '2026-08-28T10:00:00Z', ...extra });

describe('cicloIfood — a ordem das operações', () => {
  it('GRAVA antes de confirmar', async () => {
    /* O defeito clássico: confirmar antes de gravar. Uma queda entre as duas
       apaga o pedido para sempre — o iFood dá o evento como recebido e a
       retenção dele é de 8 horas. */
    const { deps, ordem } = montar({ eventos: [ev('e1')] });
    await cicloIfood(deps);
    expect(ordem).toEqual(['polling', 'gravar', 'ack']);
  });

  it('não confirma o que não conseguiu gravar', async () => {
    /* Contraria a recomendação do iFood de confirmar tudo, e é deliberado: não
       confirmar custa strike; confirmar sem gravar custa o PEDIDO. */
    const { deps, acks } = montar({
      eventos: [ev('e1'), ev('e2')],
      marcarVistos: async () => { throw new Error('banco fora'); },
    });
    const r = await cicloIfood(deps);
    expect(acks).toEqual([]);
    expect(r.retidos).toBe(2);
    expect(r.confirmados).toBe(0);
    expect(r.falhas.join(' ')).toContain('banco fora');
  });

  it('ordena os eventos antes de processar', async () => {
    /* CANCELLED antes de PLACED faria o pedido nascer cancelado. */
    const { deps, processados } = montar({
      eventos: [
        ev('cancelou', { code: 'CAN', createdAt: '2026-08-28T10:00:05Z' }),
        ev('criou', { code: 'PLC', createdAt: '2026-08-28T10:00:01Z' }),
      ],
    });
    await cicloIfood(deps);
    expect(processados.map(p => p.id)).toEqual(['criou', 'cancelou']);
  });
});

describe('cicloIfood — duplicados', () => {
  it('já visto não é processado, mas É confirmado', async () => {
    /* Sem o ACK do duplicado, cada ciclo acumula strike em silêncio até o
       bloqueio de 5 minutos. */
    const { deps, acks, processados, vistos } = montar({ eventos: [ev('e1'), ev('e2')] });
    vistos.add('e1');
    const r = await cicloIfood(deps);
    expect(processados.map(p => p.id)).toEqual(['e2']);
    expect(acks.flat().sort()).toEqual(['e1', 'e2']);
    expect(r.eventosNovos).toBe(1);
    expect(r.confirmados).toBe(2);
  });

  it('dois ciclos com o mesmo PLACED criam um pedido só', async () => {
    /* Literal da doc: "Se receber PLACED repetido, não crie novo pedido." */
    const ctx = montar({ eventos: [ev('mesmo')] });
    await cicloIfood(ctx.deps);
    await cicloIfood(ctx.deps);
    expect(ctx.processados).toHaveLength(1);
    /* Mas confirmou nas duas vezes. */
    expect(ctx.acks.flat()).toEqual(['mesmo', 'mesmo']);
  });
});

describe('cicloIfood — falhas isoladas', () => {
  it('lote de polling que falha não derruba os outros', async () => {
    /* Cada lote é um conjunto de lojas diferente. Deixar todas offline por
       causa de uma é o oposto do que queremos. */
    const lojas = Array.from({ length: 150 }, (_, i) => ({ ...LOJA, lojaId: i, merchantId: `m${i}` }));
    let n = 0;
    const { deps } = montar({
      lojas,
      polling: async () => { n++; if (n === 1) throw new Error('timeout'); return [ev('ok', { merchantId: 'm100' })]; },
    });
    const r = await cicloIfood(deps);
    expect(r.eventosRecebidos).toBe(1);
    expect(r.falhas.join(' ')).toContain('timeout');
  });

  it('processar que estoura não desfaz o visto nem impede o ACK', async () => {
    /* O evento já está gravado. Reprocessar criaria o pedido duas vezes. */
    const { deps, acks } = montar({
      eventos: [ev('e1')],
      aoProcessar: async () => { throw new Error('produto some'); },
    });
    const r = await cicloIfood(deps);
    expect(acks.flat()).toEqual(['e1']);
    expect(r.eventosNovos).toBe(1);
    expect(r.falhas.join(' ')).toContain('produto some');
  });

  it('ACK que falha não perde nada — volta no próximo ciclo', async () => {
    const ctx = montar({ eventos: [ev('e1')], confirmar: async () => { throw new Error('429'); } });
    const r = await cicloIfood(ctx.deps);
    expect(r.confirmados).toBe(0);
    expect(r.falhas.join(' ')).toContain('429');
    /* E o evento continua marcado como visto: não vira pedido duplicado. */
    expect(ctx.vistos.has('e1')).toBe(true);
  });
});

describe('cicloIfood — multi-tenant', () => {
  it('cada evento vai para o banco do seu tenant', async () => {
    const { deps, gravados } = montar({
      lojas: [
        { tenantDb: 'tenant_a', lojaId: 1, merchantId: 'm-a' },
        { tenantDb: 'tenant_b', lojaId: 7, merchantId: 'm-b' },
      ],
      eventos: [ev('ea', { merchantId: 'm-a' }), ev('eb', { merchantId: 'm-b' })],
    });
    await cicloIfood(deps);
    expect(gravados.find(g => g.tenantDb === 'tenant_a')!.ids).toEqual(['ea']);
    expect(gravados.find(g => g.tenantDb === 'tenant_b')!.ids).toEqual(['eb']);
  });

  it('mesmo merchant em duas lojas: vence a primeira e registra a falha', async () => {
    /* Silenciar seria escolher a loja no sorteio — o pedido cairia numa cozinha
       e a outra nunca saberia. */
    const { deps } = montar({
      lojas: [
        { tenantDb: 'tenant_a', lojaId: 1, merchantId: 'm-x' },
        { tenantDb: 'tenant_b', lojaId: 2, merchantId: 'm-x' },
      ],
      eventos: [],
    });
    const r = await cicloIfood(deps);
    expect(r.falhas.join(' ')).toContain('duas lojas');
  });

  it('um tenant fora do ar não impede o outro', async () => {
    const { deps, acks } = montar({
      lojas: [
        { tenantDb: 'tenant_a', lojaId: 1, merchantId: 'm-a' },
        { tenantDb: 'tenant_b', lojaId: 2, merchantId: 'm-b' },
      ],
      eventos: [ev('ea', { merchantId: 'm-a' }), ev('eb', { merchantId: 'm-b' })],
      marcarVistos: async t => { if (t === 'tenant_a') throw new Error('banco a fora'); },
    });
    const r = await cicloIfood(deps);
    expect(acks.flat()).toEqual(['eb']);
    expect(r.retidos).toBe(1);
  });
});

describe('cicloIfood — casos de borda', () => {
  it('sem loja ligada, não chama a rede', async () => {
    let chamou = false;
    const { deps } = montar({ lojas: [], polling: async () => { chamou = true; return []; } });
    const r = await cicloIfood(deps);
    expect(chamou).toBe(false);
    expect(r).toMatchObject({ lojas: 0, eventosRecebidos: 0 });
  });

  it('204 (nada novo) não gera ACK', async () => {
    /* É a resposta mais comum do dia. Um POST vazio a cada 30s seria puro
       desperdício. */
    const { deps, acks } = montar({ eventos: [] });
    const r = await cicloIfood(deps);
    expect(acks).toEqual([]);
    expect(r.eventosRecebidos).toBe(0);
  });

  it('evento de merchant desconhecido é CONFIRMADO e gritado no log', async () => {
    /* Não confirmar faria ele voltar a cada ciclo para sempre, acumulando
       strike até bloquear o polling de TODAS as lojas. */
    const avisos: string[] = [];
    const { deps, acks, processados } = montar({
      eventos: [ev('intruso', { merchantId: 'm-desconhecido' })],
      registrar: (n, m) => { if (n === 'erro') avisos.push(m); },
    });
    await cicloIfood(deps);
    expect(processados).toHaveLength(0);
    expect(acks.flat()).toEqual(['intruso']);
    expect(avisos.join(' ')).toContain('desconhecido');
  });

  it('quebra o ACK em lotes de 2000', async () => {
    const muitos = Array.from({ length: 4500 }, (_, i) => ev(`e${i}`));
    const { deps, acks } = montar({ eventos: muitos });
    const r = await cicloIfood(deps);
    expect(acks.map(l => l.length)).toEqual([2000, 2000, 500]);
    expect(r.confirmados).toBe(4500);
  });

  it('loja com merchant vazio é ignorada sem quebrar', async () => {
    const { deps } = montar({ lojas: [{ ...LOJA, merchantId: '  ' }], eventos: [] });
    const r = await cicloIfood(deps);
    expect(r.falhas).toEqual([]);
  });
});
