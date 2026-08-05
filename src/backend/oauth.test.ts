import { describe, it, expect } from 'vitest';
import { normalizarPerfil, decidirVinculo, nomeUsavel, type PerfilOauth } from './oauth';

const perfil = (p: Partial<PerfilOauth> = {}): PerfilOauth => ({
  sub: 'sub-123', email: 'cris@exemplo.com', nome: 'Cristopher', emailVerificado: true, ...p,
});

describe('normalizarPerfil', () => {
  it('lê o formato do Google (sub, name, email_verified)', () => {
    expect(normalizarPerfil('google', {
      sub: '10987', name: 'Cris Latenek', email: 'Cris@Exemplo.com ', email_verified: true,
    })).toEqual({ sub: '10987', email: 'cris@exemplo.com', nome: 'Cris Latenek', emailVerificado: true });
  });

  it('aceita email_verified como string (o Google já mandou dos dois jeitos)', () => {
    expect(normalizarPerfil('google', { sub: '1', email_verified: 'true', email: 'a@b.com' }).emailVerificado).toBe(true);
    expect(normalizarPerfil('google', { sub: '1', email_verified: false, email: 'a@b.com' }).emailVerificado).toBe(false);
  });

  it('lê o formato do Facebook (id, name)', () => {
    expect(normalizarPerfil('facebook', { id: '55', name: 'Cris', email: 'cris@exemplo.com' }))
      .toEqual({ sub: '55', email: 'cris@exemplo.com', nome: 'Cris', emailVerificado: true });
  });

  /** Facebook pode simplesmente não mandar e-mail — sem ele, não há o que verificar. */
  it('Facebook sem e-mail não conta como verificado', () => {
    expect(normalizarPerfil('facebook', { id: '55', name: 'Cris' }).emailVerificado).toBe(false);
  });
});

describe('decidirVinculo', () => {
  it('quem já entrou por aqui antes só entra', () => {
    expect(decidirVinculo(perfil(), { porSub: { id: 9 } })).toEqual({ acao: 'entrar', usuarioId: 9 });
  });

  it('e-mail novo e verificado cria a conta', () => {
    expect(decidirVinculo(perfil(), {})).toEqual({ acao: 'criar' });
  });

  it('e-mail verificado que já tem conta de cliente vincula', () => {
    expect(decidirVinculo(perfil(), { porEmail: { id: 4, perfil: 'cliente' } }))
      .toEqual({ acao: 'vincular', usuarioId: 4 });
  });

  /**
   * O caso GRAVE: casar por e-mail não verificado entregaria a conta de quem já
   * tem senha aqui pra quem criar uma conta com o mesmo endereço no provedor.
   */
  it('RECUSA vincular a conta existente quando o e-mail não é verificado', () => {
    const d = decidirVinculo(perfil({ emailVerificado: false }), { porEmail: { id: 4, perfil: 'cliente' } });
    expect(d.acao).toBe('recusar');
    expect(d).toHaveProperty('motivo', expect.stringContaining('não confirmou'));
  });

  it('recusa criar conta com e-mail não verificado', () => {
    expect(decidirVinculo(perfil({ emailVerificado: false }), {}).acao).toBe('recusar');
  });

  /** Lojista/admin têm 2FA; vincular Google puliria o segundo fator. */
  it('recusa vincular a conta que não é de cliente', () => {
    for (const p of ['lojista', 'admin', 'entregador']) {
      const d = decidirVinculo(perfil(), { porEmail: { id: 4, perfil: p } });
      expect(d.acao, p).toBe('recusar');
    }
  });

  it('recusa quando o provedor não mandou e-mail', () => {
    const d = decidirVinculo(perfil({ email: '' }), {});
    expect(d.acao).toBe('recusar');
    expect(d).toHaveProperty('motivo', expect.stringContaining('e-mail'));
  });

  it('recusa sem identificação do provedor', () => {
    expect(decidirVinculo(perfil({ sub: '' }), {}).acao).toBe('recusar');
  });

  /** `porSub` vence: quem já vinculou entra mesmo que o e-mail tenha mudado no provedor. */
  it('porSub tem prioridade sobre porEmail', () => {
    expect(decidirVinculo(perfil({ email: 'novo@exemplo.com' }), {
      porSub: { id: 9 }, porEmail: { id: 4, perfil: 'cliente' },
    })).toEqual({ acao: 'entrar', usuarioId: 9 });
  });
});

describe('nomeUsavel', () => {
  it('usa o nome do provedor quando dá', () => {
    expect(nomeUsavel(perfil({ nome: 'Cris Latenek' }))).toBe('Cris Latenek');
  });

  /** Cliente sem nome quebra cupom, etiqueta de entrega e saudação da tela. */
  it('deriva do e-mail quando o nome vem vazio', () => {
    expect(nomeUsavel(perfil({ nome: '', email: 'cris.latenek@exemplo.com' }))).toBe('cris latenek');
    expect(nomeUsavel(perfil({ nome: ' ', email: 'joao_silva@exemplo.com' }))).toBe('joao silva');
  });

  it('nunca devolve vazio', () => {
    expect(nomeUsavel(perfil({ nome: '', email: '@exemplo.com' }))).toBe('Cliente');
  });

  it('corta nome absurdo em 120', () => {
    expect(nomeUsavel(perfil({ nome: 'a'.repeat(300) })).length).toBe(120);
  });
});
