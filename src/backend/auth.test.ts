/**
 * Autenticação e isolamento entre tenants.
 *
 * POR QUE ESTES TESTES EXISTEM: numa plataforma SILO (um banco por tenant) o
 * `sub` de um token é só um id numérico, e ids colidem entre bancos — id=1 e
 * id=2 existem em quase todo tenant. Se um token emitido no tenant A for
 * aceito no domínio do tenant B, o backend carrega o usuário de MESMO ID do
 * tenant B e emite sessão pra ele, sem senha. Já aconteceu de verdade neste
 * projeto: o token de pré-autenticação do 2FA foi criado sem o claim `tenant`
 * e reabriu exatamente esse buraco, que a proteção do token de sessão já
 * havia fechado. Estes testes existem pra que a próxima variante de token
 * nasça coberta em vez de reabrir o mesmo furo.
 *
 * Nenhum deles toca no banco: as rejeições que interessam acontecem ANTES de
 * qualquer query, então dão pra testar sem infraestrutura.
 */
import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import {
  gerarTokenPreAuth, autenticarPreAuth, autenticar,
  gerarTokenCozinha, tenantDoToken,
} from './auth';
import { comTenant, bancoTenantAtual } from './db-mysql';

const TENANT_A = 'tenant_teste_a';
const TENANT_B = 'tenant_teste_b';
const SEGREDO = process.env.JWT_SECRET as string;

/** Roda uma middleware e devolve o erro passado pro next() (ou null se passou). */
function rodarMiddleware(
  mw: (req: Request, res: Response, next: NextFunction) => unknown,
  token: string | null,
): { erro: any | null; req: any } {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} } as any;
  let capturado: any = null;
  const next = ((e?: any) => { capturado = e ?? null; }) as NextFunction;
  mw(req, {} as Response, next);
  return { erro: capturado, req };
}

describe('gerarTokenPreAuth', () => {
  it('embute o tenant atual no token', () => {
    const token = comTenant(TENANT_A, () => gerarTokenPreAuth({ id: 7, perfil: 'lojista' }));
    const dados = jwt.verify(token, SEGREDO) as jwt.JwtPayload;
    expect(dados.tenant).toBe(TENANT_A);
    expect(dados.tipo).toBe('pre2fa');
    expect(dados.sub).toBe(7);
  });

  it('expira em 10 minutos (janela curta: só pra completar o 2FA)', () => {
    const token = comTenant(TENANT_A, () => gerarTokenPreAuth({ id: 1, perfil: 'admin' }));
    const { iat, exp } = jwt.verify(token, SEGREDO) as jwt.JwtPayload;
    expect((exp as number) - (iat as number)).toBe(600);
  });
});

describe('autenticarPreAuth — isolamento entre tenants', () => {
  it('aceita o token no MESMO tenant em que foi emitido', () => {
    const token = comTenant(TENANT_A, () => gerarTokenPreAuth({ id: 2, perfil: 'lojista' }));
    const { erro, req } = comTenant(TENANT_A, () => rodarMiddleware(autenticarPreAuth, token));
    expect(erro).toBeNull();
    expect(req.usuarioPreAuth).toEqual({ id: 2, perfil: 'lojista' });
  });

  it('REJEITA o token do tenant A apresentado no tenant B', () => {
    // O ataque real: atacante loga com credenciais próprias e legítimas no
    // tenant A e manda o token pro domínio do tenant B, onde o mesmo id
    // pertence a outra pessoa.
    const token = comTenant(TENANT_A, () => gerarTokenPreAuth({ id: 2, perfil: 'lojista' }));
    const { erro, req } = comTenant(TENANT_B, () => rodarMiddleware(autenticarPreAuth, token));
    expect(erro).toBeTruthy();
    expect(erro.statusHttp).toBe(401);
    expect(req.usuarioPreAuth).toBeUndefined();
  });

  it('rejeita token sem o claim tenant (formato antigo, vulnerável)', () => {
    const antigo = jwt.sign({ sub: 2, perfil: 'lojista', tipo: 'pre2fa' }, SEGREDO, { expiresIn: '10m' });
    const { erro } = comTenant(TENANT_A, () => rodarMiddleware(autenticarPreAuth, antigo));
    expect(erro?.statusHttp).toBe(401);
  });

  it('rejeita token assinado com outro segredo', () => {
    const forjado = jwt.sign({ sub: 1, perfil: 'admin', tipo: 'pre2fa', tenant: TENANT_A }, 'outro-segredo');
    const { erro } = comTenant(TENANT_A, () => rodarMiddleware(autenticarPreAuth, forjado));
    expect(erro?.statusHttp).toBe(401);
  });

  it('rejeita quando não há token', () => {
    const { erro } = comTenant(TENANT_A, () => rodarMiddleware(autenticarPreAuth, null));
    expect(erro?.statusHttp).toBe(401);
  });
});

describe('autenticar — tokens que NÃO podem virar sessão', () => {
  // Todos são recusados antes de qualquer query, então não precisam de banco.
  it('recusa token de pré-autenticação (2FA ainda não verificado)', async () => {
    const preAuth = comTenant(TENANT_A, () => gerarTokenPreAuth({ id: 1, perfil: 'admin' }));
    const { erro } = await comTenant(TENANT_A, async () => rodarMiddleware(autenticar as any, preAuth));
    expect(erro?.statusHttp).toBe(401);
  });

  it('recusa token de cozinha (sub é id de cozinha_contas, não de usuarios)', async () => {
    // Sem esta guarda, um token de cozinha viraria o usuário de mesmo id —
    // escalonamento de privilégio dentro do próprio tenant.
    const cozinha = gerarTokenCozinha({ id: 1, loja_id: 1 });
    const { erro } = await comTenant(TENANT_A, async () => rodarMiddleware(autenticar as any, cozinha));
    expect(erro?.statusHttp).toBe(401);
  });

  it('recusa token sem claim de perfil', async () => {
    const semPerfil = jwt.sign({ sub: 1, tenant: TENANT_A }, SEGREDO, { expiresIn: '1h' });
    const { erro } = await comTenant(TENANT_A, async () => rodarMiddleware(autenticar as any, semPerfil));
    expect(erro?.statusHttp).toBe(401);
  });
});

describe('tenantDoToken', () => {
  it('extrai o tenant de um token válido', () => {
    const token = comTenant(TENANT_B, () => gerarTokenPreAuth({ id: 3, perfil: 'lojista' }));
    expect(tenantDoToken(`Bearer ${token}`)).toBe(TENANT_B);
  });

  it('devolve null pra header ausente, malformado ou token inválido', () => {
    expect(tenantDoToken(undefined)).toBeNull();
    expect(tenantDoToken('sem-bearer')).toBeNull();
    expect(tenantDoToken('Bearer lixo')).toBeNull();
  });
});

describe('bancoTenantAtual — fail-closed', () => {
  it('devolve o banco quando há contexto', () => {
    expect(comTenant(TENANT_B, () => bancoTenantAtual())).toBe(TENANT_B);
  });

  it('LANÇA sem contexto, em vez de cair no banco master calado', () => {
    // O fallback silencioso pro master é como um bug de contexto vira
    // vazamento entre tenants em vez de exceção: a query "funciona", só que
    // no banco errado.
    expect(() => bancoTenantAtual()).toThrow(/comTenant/);
  });
});
