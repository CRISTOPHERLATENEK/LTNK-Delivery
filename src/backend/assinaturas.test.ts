import { describe, it, expect } from 'vitest';
import {
  proximoVencimento, diasDeAtraso, statusCalculado, deveSuspenderAcesso, processarVencimentos,
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
      const limpo = sql.replace(/\s+/g, ' ').trim();
      escritas.push({ sql: limpo, params });
      /*
       * Simula o WHERE: um UPDATE com `AND suspenso_por = 'x'` só casa linha se
       * a linha tiver aquele carimbo. Sem isso o teste passaria mesmo com a
       * trava errada, porque todo UPDATE diria "mexi numa linha".
       */
      // Só o que vem DEPOIS do WHERE filtra. Antes eu casava o
      // `SET suspenso_por = ''` e o teste dava falso negativo.
      // `indexOf` e nao regex de proposito: a primeira versao usava uma borda
      // de palavra que virou caractere de controle na geracao do arquivo. O regex
      // nunca casava, `onde` vinha vazio e o pool falso liberava TODO UPDATE —
      // o teste passava com o bug presente. Sem escape, sem susto.
      const iw = limpo.toUpperCase().indexOf(' WHERE ');
      const onde = iw === -1 ? '' : limpo.slice(iw + 7);
      const exige = onde.match(/suspenso_por (?:=|IN) \(?\s*'([^']*)'(?:\s*,\s*'([^']*)')?/);
      const aceitos = exige ? [exige[1], exige[2]].filter(v => v !== undefined) : null;
      const casa = !aceitos || linhas.some(l => aceitos.includes(l.suspenso_por as string));
      return [{ affectedRows: casa ? 1 : 0 }, undefined];
    },
  };
  return { pool, escritas };
}

describe('processarVencimentos e quem pode religar o cliente', () => {
  it('suspende quem passou da tolerância, carimbando o motivo', async () => {
    const { pool, escritas } = poolFalso([
      { id: 1, tenant_id: 7, status: 'ativa', vence_em: '2026-03-01', dias_tolerancia: 5, tenant_ativo: 1, suspenso_por: '' },
    ]);
    const r = await processarVencimentos(pool as never);
    expect(r.suspensos).toBe(1);
    expect(escritas.some(e => /ativo = 0, suspenso_por = 'assinatura'/.test(e.sql))).toBe(true);
  });

  /*
   * O BUG QUE ESTE TESTE FECHA.
   *
   * `tenants.ativo` tem quatro donos: este job, o registro de pagamento, o
   * revendedor e a edição do tenant pelo admin. Guardando só "está ligado", quem
   * escrevia por último vencia — o revendedor suspendia um cliente em dia com a
   * plataforma e o job religava na madrugada seguinte, em silêncio.
   *
   * O conserto é o `AND suspenso_por = 'assinatura'`: cada dono só religa o que
   * ele mesmo desligou. Se este teste voltar a falhar, a suspensão do revendedor
   * parou de sobreviver à noite de novo.
   */
  it('NÃO religa cliente que o revendedor suspendeu, mesmo estando em dia', async () => {
    const { pool, escritas } = poolFalso([
      { id: 1, tenant_id: 7, status: 'ativa', vence_em: '2099-01-01', dias_tolerancia: 5, tenant_ativo: 0, suspenso_por: 'revendedor' },
    ]);
    const r = await processarVencimentos(pool as never);
    // O UPDATE até sai, mas com a trava que faz o banco não casar nenhuma linha.
    const religouSemTrava = escritas.some(
      e => /UPDATE tenants SET ativo = 1/.test(e.sql) && !/suspenso_por = 'assinatura'/.test(e.sql));
    expect(religouSemTrava).toBe(false);
    expect(r.reativados).toBe(0);
  });

  it('religa quem ELE mesmo desligou, quando volta a ficar em dia', async () => {
    const { pool, escritas } = poolFalso([
      { id: 1, tenant_id: 7, status: 'suspensa', vence_em: '2099-01-01', dias_tolerancia: 5, tenant_ativo: 0, suspenso_por: 'assinatura' },
    ]);
    const r = await processarVencimentos(pool as never);
    expect(r.reativados).toBe(1);
    expect(escritas.some(e => /ativo = 1, suspenso_por = ''/.test(e.sql))).toBe(true);
  });

  it('não escreve nada quando já está no estado certo', async () => {
    const { pool, escritas } = poolFalso([
      { id: 1, tenant_id: 7, status: 'ativa', vence_em: '2099-01-01', dias_tolerancia: 5, tenant_ativo: 1, suspenso_por: '' },
    ]);
    await processarVencimentos(pool as never);
    expect(escritas.filter(e => /UPDATE tenants/.test(e.sql))).toHaveLength(0);
  });
});
