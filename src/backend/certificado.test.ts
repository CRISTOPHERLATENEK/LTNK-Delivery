import { describe, it, expect } from 'vitest';
import { avisoCertificado, textoAvisoCertificado } from '../../frontend/src/lib/certificado';

const hoje = new Date('2026-08-28T14:00:00Z');
const emDias = (n: number) => {
  const d = new Date(hoje);
  d.setDate(d.getDate() + n);
  return d.toISOString();
};

describe('avisoCertificado', () => {
  it('não avisa quando falta muito', () => {
    expect(avisoCertificado(emDias(90), true, hoje)).toBe(null);
    expect(avisoCertificado(emDias(31), true, hoje)).toBe(null);
  });

  it('atenção a partir de 30 dias', () => {
    expect(avisoCertificado(emDias(30), true, hoje)?.nivel).toBe('atencao');
    expect(avisoCertificado(emDias(8), true, hoje)?.nivel).toBe('atencao');
  });

  it('urgente na última semana', () => {
    expect(avisoCertificado(emDias(7), true, hoje)?.nivel).toBe('urgente');
    expect(avisoCertificado(emDias(1), true, hoje)?.nivel).toBe('urgente');
  });

  /*
   * O DIA DO VENCIMENTO AINDA VALE. Tratá-lo como vencido faria a loja parar de
   * emitir um dia antes por conta do aviso — e o certificado assina até o fim
   * do dia.
   */
  it('no dia do vencimento é urgente, não vencido', () => {
    const a = avisoCertificado(emDias(0), true, hoje);
    expect(a?.nivel).toBe('urgente');
    expect(a?.dias).toBe(0);
    expect(textoAvisoCertificado(a!)).toContain('vence HOJE');
  });

  it('vencido a partir do dia seguinte', () => {
    expect(avisoCertificado(emDias(-1), true, hoje)?.nivel).toBe('vencido');
    expect(avisoCertificado(emDias(-10), true, hoje)?.dias).toBe(-10);
  });

  /*
   * A conta é por DIA DE CALENDÁRIO. Com diferença bruta em horas, um
   * certificado que vence hoje às 23h daria "0 dias" de manhã e "-1" à tarde —
   * o aviso mudaria de tom no meio do expediente sem nada ter mudado.
   */
  it('a hora do dia não muda o resultado', () => {
    const validade = '2026-09-05T23:59:00Z';
    const manha = avisoCertificado(validade, true, new Date('2026-08-28T09:00:00Z'));
    const noite = avisoCertificado(validade, true, new Date('2026-08-28T22:00:00Z'));
    expect(manha?.dias).toBe(noite?.dias);
  });

  /* Loja que não emite nota não tem nada a resolver, e alarme sem ação possível
     ensina a ignorar todos os outros. */
  it('silencioso com NFC-e desligada ou sem certificado', () => {
    expect(avisoCertificado(emDias(1), false, hoje)).toBe(null);
    expect(avisoCertificado(null, true, hoje)).toBe(null);
    expect(avisoCertificado('', true, hoje)).toBe(null);
    expect(avisoCertificado('data inválida', true, hoje)).toBe(null);
  });

  it('o texto diz o que acontece, não só que vence', () => {
    expect(textoAvisoCertificado({ nivel: 'atencao', dias: 20 })).toContain('a emissão de NFC-e para');
    expect(textoAvisoCertificado({ nivel: 'vencido', dias: -3 })).toContain('está parada');
  });
});
