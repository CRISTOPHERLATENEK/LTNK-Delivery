import { describe, it, expect } from 'vitest';
import { deveEnviar, destinatariosDe, competenciaAEnviar, ultimoDiaDoMes } from './envio-contador';

const base = {
  hojeIso: '2026-08-05T09:00:00.000Z',
  auto: true,
  temDestinatario: true,
  diaEnvio: 5,
  ultimaCompetencia: '',
};

describe('competência a enviar', () => {
  it('é sempre o mês FECHADO, não o corrente', () => {
    // O mês corrente ainda vai receber nota; mandar isso pro contador
    // entregaria uma escrituração pela metade.
    expect(competenciaAEnviar('2026-08-05T00:00:00.000Z')).toBe('2026-07');
  });

  it('vira o ano em janeiro', () => {
    expect(competenciaAEnviar('2026-01-05T00:00:00.000Z')).toBe('2025-12');
  });
});

describe('ultimoDiaDoMes', () => {
  it('conhece fevereiro bissexto', () => {
    expect(ultimoDiaDoMes('2024-02')).toBe(29);
    expect(ultimoDiaDoMes('2026-02')).toBe(28);
  });
  it('conhece mês de 30 e de 31', () => {
    expect(ultimoDiaDoMes('2026-04')).toBe(30);
    expect(ultimoDiaDoMes('2026-07')).toBe(31);
  });
});

describe('deveEnviar', () => {
  it('manda no dia escolhido', () => {
    expect(deveEnviar(base)).toEqual({ enviar: true, competencia: '2026-07' });
  });

  it('não manda antes do dia', () => {
    expect(deveEnviar({ ...base, hojeIso: '2026-08-04T23:59:00.000Z' }).enviar).toBe(false);
  });

  it('MANDA depois do dia, não só no dia exato', () => {
    // O servidor pode ter passado o dia 5 fora do ar (deploy, reboot). Exigir o
    // dia exato faria o mês inteiro passar sem envio, e ninguém perceberia.
    expect(deveEnviar({ ...base, hojeIso: '2026-08-20T10:00:00.000Z' }).enviar).toBe(true);
  });

  it('NÃO MANDA DUAS VEZES a mesma competência', () => {
    // O job roda várias vezes por dia. Sem isto, o contador escritura em dobro.
    expect(deveEnviar({ ...base, ultimaCompetencia: '2026-07' }).enviar).toBe(false);
  });

  it('dia 31 num mês de 30 dias ainda dispara', () => {
    // Clampado ao último dia: sem isso, quem escolhesse 31 receberia em janeiro
    // e nunca mais em abril, junho, setembro ou novembro.
    expect(deveEnviar({ ...base, diaEnvio: 31, hojeIso: '2026-04-30T12:00:00.000Z' }).enviar).toBe(true);
    expect(deveEnviar({ ...base, diaEnvio: 31, hojeIso: '2026-04-29T12:00:00.000Z' }).enviar).toBe(false);
  });

  it('automático desligado ou sem destinatário não manda nada', () => {
    expect(deveEnviar({ ...base, auto: false }).enviar).toBe(false);
    expect(deveEnviar({ ...base, temDestinatario: false }).enviar).toBe(false);
  });

  it('última competência mais nova que a alvo não reenvia', () => {
    // Relógio pra trás ou dado estranho: o contador já tem algo mais recente,
    // reenviar o antigo só confunde.
    expect(deveEnviar({ ...base, ultimaCompetencia: '2026-09' }).enviar).toBe(false);
  });

  it('mês pulado é recuperado — manda o fechado mais recente', () => {
    // Ficou fora do ar em agosto inteiro: em setembro manda agosto (o mês
    // fechado), não fica travado tentando julho.
    expect(deveEnviar({ ...base, hojeIso: '2026-09-06T00:00:00.000Z', ultimaCompetencia: '2026-06' }))
      .toEqual({ enviar: true, competencia: '2026-08' });
  });

  it('dia zero ou inválido vira dia 1', () => {
    expect(deveEnviar({ ...base, diaEnvio: 0, hojeIso: '2026-08-01T00:00:00.000Z' }).enviar).toBe(true);
  });
});

describe('destinatariosDe', () => {
  it('aceita vírgula, ponto e vírgula e espaço', () => {
    expect(destinatariosDe('a@x.com, b@y.com; c@z.com'))
      .toEqual(['a@x.com', 'b@y.com', 'c@z.com']);
  });

  it('descarta o que não é e-mail em vez de derrubar a remessa', () => {
    // Um endereço torto no meio não pode impedir os certos de receberem.
    expect(destinatariosDe('contador@x.com, contador arroba y')).toEqual(['contador@x.com']);
  });

  it('não repete o mesmo endereço', () => {
    expect(destinatariosDe('a@x.com; A@X.COM')).toEqual(['a@x.com']);
  });

  it('vazio ou nulo não vira destinatário nenhum', () => {
    expect(destinatariosDe('')).toEqual([]);
    expect(destinatariosDe(null)).toEqual([]);
    expect(destinatariosDe('   ')).toEqual([]);
  });

  it('limita a 5 — o campo não é lista de transmissão', () => {
    const muitos = Array.from({ length: 9 }, (_, i) => `c${i}@x.com`).join(',');
    expect(destinatariosDe(muitos)).toHaveLength(5);
  });
});
