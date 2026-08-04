import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';

/**
 * "Manter conectado neste dispositivo" era uma caixa que não fazia nada útil: ela
 * só mudava ONDE o token era guardado (localStorage vs sessionStorage), então ele
 * sobrevivia a fechar a aba — mas o JWT expirava em 12h de qualquer forma e o
 * lojista era deslogado no dia seguinte.
 *
 * Este teste existe porque o sintoma é lento: só aparece 12 horas depois, quando
 * ninguém está mais olhando. Aqui a diferença é medida na hora.
 */
describe('gerarToken — validade conforme "manter conectado"', () => {
  let gerarToken: typeof import('./auth').gerarToken;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'segredo-de-teste-com-tamanho-suficiente-123456';
    const mod = await import('./db-mysql');
    // gerarToken lê o banco do contexto (claim `tenant`); sem contexto, lança.
    const auth = await import('./auth');
    gerarToken = (u, o) => mod.comTenant('banco_teste', () => auth.gerarToken(u, o));
  });

  const validadeSegundos = (token: string) => {
    const d = jwt.decode(token) as { exp: number; iat: number };
    return d.exp - d.iat;
  };

  it('sem a opção: validade curta (12h por padrão)', () => {
    const t = gerarToken({ id: 1, perfil: 'lojista' } as never);
    expect(validadeSegundos(t)).toBe(12 * 3600);
  });

  it('COM a opção: validade longa (30d por padrão) — era o que não acontecia', () => {
    const t = gerarToken({ id: 1, perfil: 'lojista' } as never, { manterConectado: true });
    expect(validadeSegundos(t)).toBe(30 * 24 * 3600);
  });

  it('a opção muda a validade de verdade, não só o lugar de guardar', () => {
    const curto = validadeSegundos(gerarToken({ id: 1, perfil: 'lojista' } as never));
    const longo = validadeSegundos(gerarToken({ id: 1, perfil: 'lojista' } as never, { manterConectado: true }));
    expect(longo).toBeGreaterThan(curto * 10);
  });

  it('o tenant vai no token nos dois casos (senão a sessão quebra em multi-tenant)', () => {
    for (const o of [{}, { manterConectado: true }]) {
      const d = jwt.decode(gerarToken({ id: 7, perfil: 'cliente' } as never, o)) as { tenant: string; sub: number };
      expect(d.tenant).toBe('banco_teste');
      expect(d.sub).toBe(7);
    }
  });
});
