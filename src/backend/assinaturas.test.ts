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
