import { describe, it, expect } from 'vitest';
import {
  proximoVencimento, diasDeAtraso, statusCalculado, deveSuspenderAcesso,
  type Assinatura,
} from './assinaturas';

/**
 * Esta regra decide DERRUBAR A LOJA de um cliente. Errar pra um lado deixa
 * inadimplente usando de graça; errar pro outro tira do ar quem pagou — e o
 * segundo é muito pior, porque o lojista perde venda por culpa nossa.
 * Por isso a regra é função pura e está travada por teste.
 */
const base = (over: Partial<Assinatura> = {}): Pick<Assinatura, 'status' | 'vence_em' | 'dias_tolerancia'> => ({
  status: 'ativa', vence_em: '2026-03-05', dias_tolerancia: 5, ...over,
});

describe('proximoVencimento', () => {
  it('mesmo mês quando o dia ainda não chegou', () => {
    expect(proximoVencimento('2026-03-01', 5)).toBe('2026-03-05');
  });

  it('mês seguinte quando o dia já passou (ou é hoje)', () => {
    expect(proximoVencimento('2026-03-05', 5)).toBe('2026-04-05');
    expect(proximoVencimento('2026-03-20', 5)).toBe('2026-04-05');
  });

  it('vira o ano corretamente', () => {
    expect(proximoVencimento('2026-12-20', 10)).toBe('2027-01-10');
  });

  it('LIMITA EM 28: dia 31 em fevereiro escorregaria pra março e atrasaria a cobrança um mês', () => {
    expect(proximoVencimento('2026-01-31', 31)).toBe('2026-02-28');
    expect(proximoVencimento('2026-02-01', 30)).toBe('2026-02-28');
  });

  it('dia inválido não quebra', () => {
    expect(proximoVencimento('2026-03-10', 0)).toBe('2026-04-01');
    expect(proximoVencimento('2026-03-10', -5)).toBe('2026-04-01');
  });
});

describe('diasDeAtraso', () => {
  it('em dia ou adiantado é 0', () => {
    expect(diasDeAtraso('2026-03-05', '2026-03-01')).toBe(0);
    expect(diasDeAtraso('2026-03-05', '2026-03-05')).toBe(0);
  });
  it('conta os dias corridos depois do vencimento', () => {
    expect(diasDeAtraso('2026-03-05', '2026-03-06')).toBe(1);
    expect(diasDeAtraso('2026-03-05', '2026-03-15')).toBe(10);
  });
  it('sem vencimento definido não há atraso', () => {
    expect(diasDeAtraso('', '2026-03-15')).toBe(0);
  });
});

describe('statusCalculado', () => {
  it('em dia = ativa', () => {
    expect(statusCalculado(base(), '2026-03-05')).toBe('ativa');
  });

  it('dentro da tolerância = inadimplente, e NÃO suspende', () => {
    const s = statusCalculado(base(), '2026-03-09'); // 4 dias de atraso, tolera 5
    expect(s).toBe('inadimplente');
    expect(deveSuspenderAcesso(s)).toBe(false);
  });

  it('no ÚLTIMO dia da tolerância ainda não suspende (limite inclusivo)', () => {
    const s = statusCalculado(base(), '2026-03-10'); // exatamente 5 dias
    expect(s).toBe('inadimplente');
    expect(deveSuspenderAcesso(s)).toBe(false);
  });

  it('passando a tolerância = suspensa', () => {
    const s = statusCalculado(base(), '2026-03-11'); // 6 dias
    expect(s).toBe('suspensa');
    expect(deveSuspenderAcesso(s)).toBe(true);
  });

  it('tolerância 0 suspende no dia seguinte ao vencimento', () => {
    expect(statusCalculado(base({ dias_tolerancia: 0 }), '2026-03-06')).toBe('suspensa');
    expect(statusCalculado(base({ dias_tolerancia: 0 }), '2026-03-05')).toBe('ativa');
  });

  it('teste e cancelada NÃO são recalculados — são decisão humana, não data', () => {
    expect(statusCalculado(base({ status: 'teste' }), '2026-12-31')).toBe('teste');
    expect(statusCalculado(base({ status: 'cancelada' }), '2026-12-31')).toBe('cancelada');
  });

  it('sem vencimento definido não suspende ninguém', () => {
    const s = statusCalculado(base({ vence_em: '' }), '2026-12-31');
    expect(s).toBe('ativa');
    expect(deveSuspenderAcesso(s)).toBe(false);
  });
});

/**
 * `processarVencimentos` é quem de fato liga e desliga o cliente, e era a única
 * parte deste arquivo sem teste — as 15 provas acima cobrem só as funções puras.
 *
 * Pool falso em vez de banco: o que se quer travar aqui é QUAIS comandos saem,
 * e um banco de verdade tornaria o teste lento e dependente de estado.
 */
function poolFalso(linhas: Array<Record<string, unknown>>) {
  const escritas: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/^\s*SELECT/i.test(sql)) return [linhas, undefined];
      escritas.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return [{ affectedRows: 1 }, undefined];
    },
  };
  return { pool, escritas };
}

describe('processarVencimentos e a coluna tenants.ativo', () => {
  it('suspende quem passou da tolerância', async () => {
    const { pool, escritas } = poolFalso([
      { id: 1, tenant_id: 7, status: 'ativa', vence_em: '2026-03-01', dias_tolerancia: 5, tenant_ativo: 1 },
    ]);
    const { processarVencimentos } = await import('./assinaturas');
    const r = await processarVencimentos(pool as never);
    expect(r.suspensos).toBe(1);
    expect(escritas.some(e => /UPDATE tenants SET ativo = \?/.test(e.sql) && e.params[0] === 0)).toBe(true);
  });

  /*
   * O QUE ESTE TESTE DENUNCIA.
   *
   * `tenants.ativo` tem quatro donos: este job, o registro de pagamento, o
   * revendedor suspendendo um cliente dele (rotas/revendedor.ts:154) e a edição
   * do tenant pelo admin (tenants-mysql.ts:525). A coluna guarda "está ligado",
   * mas não guarda POR QUE — então quem escreve por último vence.
   *
   * Resultado: revendedor suspende um cliente que está em dia com a plataforma,
   * e na madrugada seguinte este job vê assinatura 'ativa', conclui que o alvo é
   * ligado, e reativa. A suspensão do revendedor dura até o job rodar.
   *
   * A documentação da função afirma o contrário — "NUNCA reativa tenant que está
   * suspenso por outro motivo". Este teste mostra que reativa.
   */
  it('REATIVA cliente que o revendedor suspendeu — a suspensão do revendedor não sobrevive à madrugada', async () => {
    const { pool, escritas } = poolFalso([
      // Em dia com a plataforma, mas desligado pelo revendedor (tenant_ativo: 0).
      { id: 1, tenant_id: 7, status: 'ativa', vence_em: '2099-01-01', dias_tolerancia: 5, tenant_ativo: 0 },
    ]);
    const { processarVencimentos } = await import('./assinaturas');
    const r = await processarVencimentos(pool as never);
    const religou = escritas.some(e => /UPDATE tenants SET ativo = \?/.test(e.sql) && e.params[0] === 1);
    expect(religou).toBe(true);
    expect(r.reativados).toBe(1);
  });
});
