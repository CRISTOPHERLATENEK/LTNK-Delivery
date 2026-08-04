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

/**
 * Entregador e KDS NÃO podem deslogar. São ferramentas de turno: o entregador
 * está na rua, de moto, muitas vezes sem saber a senha de cor — cair no meio de
 * uma entrega é corrida perdida e cliente sem rastreio. O KDS é tablet preso na
 * parede: relogar toda manhã é atrito, e no pico do almoço é pedido saindo errado.
 *
 * O que substitui a expiração é a revogação: `autenticar` e `autenticarCozinha`
 * recarregam do banco a cada requisição e recusam quem está `bloqueado`.
 */
describe('perfis que não expiram', () => {
  let comTenant: typeof import('./db-mysql').comTenant;
  let auth: typeof import('./auth');

  beforeAll(async () => {
    process.env.JWT_SECRET = 'segredo-de-teste-com-tamanho-suficiente-123456';
    comTenant = (await import('./db-mysql')).comTenant;
    auth = await import('./auth');
  });

  const semExp = (token: string) => {
    const d = jwt.decode(token) as Record<string, unknown>;
    return d.exp === undefined;
  };

  it('entregador: token SEM exp — não desloga', () => {
    const t = comTenant('banco_teste', () => auth.gerarToken({ id: 5, perfil: 'entregador' } as never));
    expect(semExp(t)).toBe(true);
  });

  it('cozinha (KDS): token SEM exp — não desloga', () => {
    const t = comTenant('banco_teste', () => auth.gerarTokenCozinha({ id: 3, loja_id: 1 }));
    expect(semExp(t)).toBe(true);
    expect((jwt.decode(t) as { tipo: string }).tipo).toBe('cozinha');
  });

  it('lojista e cliente CONTINUAM expirando — a exceção é só de quem opera na rua/cozinha', () => {
    for (const perfil of ['lojista', 'cliente', 'admin']) {
      const t = comTenant('banco_teste', () => auth.gerarToken({ id: 1, perfil } as never));
      expect(semExp(t)).toBe(false);
    }
  });

  it('token de cozinha segue verificável (assinatura válida, sem checagem de prazo)', () => {
    const t = comTenant('banco_teste', () => auth.gerarTokenCozinha({ id: 9, loja_id: 2 }));
    const d = jwt.verify(t, process.env.JWT_SECRET as string) as { sub: number; loja_id: number };
    expect(d.sub).toBe(9);
    expect(d.loja_id).toBe(2);
  });
});
