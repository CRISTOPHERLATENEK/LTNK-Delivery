import { describe, it, expect, vi } from 'vitest';

describe('cripto (segredos em repouso — senha do certificado, CSC, token MP)', () => {
  it('roundtrip: criptografar depois descriptografar devolve o texto original', async () => {
    vi.resetModules();
    process.env.APP_SECRET = 'segredo-A-bem-forte-1234567890';
    const { criptografar, descriptografar } = await import('./cripto');
    const cifrado = criptografar('minha senha secreta');
    expect(descriptografar(cifrado)).toBe('minha senha secreta');
  });

  it('duas criptografias do mesmo texto dão resultados diferentes (salt/iv aleatórios)', async () => {
    vi.resetModules();
    process.env.APP_SECRET = 'segredo-B-bem-forte-abcdefghij';
    const { criptografar } = await import('./cripto');
    expect(criptografar('mesmo texto')).not.toBe(criptografar('mesmo texto'));
  });

  it('texto cifrado corrompido falha ao descriptografar (não devolve lixo silenciosamente)', async () => {
    vi.resetModules();
    process.env.APP_SECRET = 'segredo-C-bem-forte-klmnopqrst';
    const { criptografar, descriptografar } = await import('./cripto');
    const cifrado = criptografar('texto original');
    const corrompido = cifrado.slice(0, -4) + 'AAAA';
    expect(() => descriptografar(corrompido)).toThrow();
  });

  it('REGRESSÃO: valor cifrado com o segredo ANTIGO (JWT_SECRET) continua legível depois que o APP_SECRET passa a existir', async () => {
    // Reproduz o bug real de produção: o certificado A1 foi enviado ANTES de
    // existir um APP_SECRET dedicado (nesse caso a senha cai no fallback do
    // JWT_SECRET, com aviso). Depois o APP_SECRET foi configurado — a senha
    // já salva não pode virar ilegível por causa disso.
    vi.resetModules();
    delete process.env.APP_SECRET;
    process.env.JWT_SECRET = 'jwt-secret-antigo-que-ja-existia-123';
    let mod = await import('./cripto');
    const cifradoComSegredoAntigo = mod.criptografar('senha-do-certificado-a1');

    vi.resetModules();
    process.env.APP_SECRET = 'app-secret-novo-dedicado-9876543210';
    // JWT_SECRET continua no ambiente (cenário real: ninguém removeu a variável antiga)
    mod = await import('./cripto');
    expect(mod.descriptografar(cifradoComSegredoAntigo)).toBe('senha-do-certificado-a1');
  });

  it('valor cifrado com um segredo que NÃO existe mais (nem como fallback) falha — não trava o processo', async () => {
    vi.resetModules();
    process.env.APP_SECRET = 'segredo-perdido-que-vai-sumir-000000';
    let mod = await import('./cripto');
    const cifrado = mod.criptografar('vai virar ilegível');

    vi.resetModules();
    process.env.APP_SECRET = 'segredo-completamente-diferente-111';
    delete process.env.JWT_SECRET;
    mod = await import('./cripto');
    expect(() => mod.descriptografar(cifrado)).toThrow();
  });
});
