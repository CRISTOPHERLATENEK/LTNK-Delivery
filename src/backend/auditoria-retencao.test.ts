/**
 * RETENÇÃO DO LOG DE AUDITORIA.
 *
 * Testes de comportamento com um `db` falso: o que precisa ser garantido aqui é
 * a FORMA do DELETE — corte por data, em lotes, com teto de laço. Errar isso
 * apaga registro que devia ficar, ou trava a tabela no meio de uma ação
 * administrativa.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

/* O módulo lê `db` no topo, então o mock precisa existir antes do import. */
const chamadas: { sql: string; params: unknown[] }[] = [];
let respostas: number[] = [];

vi.mock('./db-mysql', () => ({
  default: {
    prepare: (sql: string) => ({
      run: async (...params: unknown[]) => {
        chamadas.push({ sql, params });
        return { changes: respostas.shift() ?? 0 };
      },
    }),
  },
}));

const { limparAuditoriaDoTenant } = await import('./auditoria-retencao');

beforeEach(() => { chamadas.length = 0; respostas = []; });
afterEach(() => { delete process.env.AUDITORIA_RETENCAO_MESES; });

describe('o corte é por DATA, nunca por quantidade', () => {
  it('apaga só o que está antes do corte de 6 meses', async () => {
    /*
     * Cortar por quantidade ("deixe os últimos 10 mil") apagaria o registro de
     * ontem numa tabela movimentada e guardaria o de dois anos numa parada — o
     * oposto de uma política de retenção.
     */
    respostas = [0];
    const agora = Date.parse('2026-09-07T12:00:00Z');
    await limparAuditoriaDoTenant(agora);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].sql).toContain('DELETE FROM admin_auditoria');
    expect(chamadas[0].sql).toContain('criado_em < ?');
    expect(chamadas[0].sql).not.toMatch(/ORDER BY|OFFSET/);

    const corte = String(chamadas[0].params[0]);
    /* ~6 meses antes: março de 2026. */
    expect(corte.slice(0, 7)).toBe('2026-03');
    expect(Date.parse(corte)).toBeLessThan(agora);
  });

  it('ignora registro com data VAZIA em vez de apagá-lo', async () => {
    /*
     * `criado_em` vazio comparado com uma data é verdadeiro em string no MySQL
     * ('' < '2026-03-...'), então sem o filtro explícito a limpeza apagaria
     * justamente os registros com data estragada — os que mais precisam ser
     * olhados por gente.
     */
    respostas = [0];
    await limparAuditoriaDoTenant();
    expect(chamadas[0].sql).toContain("criado_em <> ''");
  });
});

describe('em lotes, para não travar a tabela', () => {
  it('apaga em lotes e para quando o lote vem incompleto', async () => {
    /*
     * `DELETE` sem teto numa tabela com anos de histórico segura a transação
     * por segundos e trava quem estiver gravando auditoria naquele instante —
     * ou seja, trava a ação administrativa que gerou o registro.
     */
    respostas = [500, 500, 137];
    const total = await limparAuditoriaDoTenant();
    expect(total).toBe(1137);
    expect(chamadas).toHaveLength(3);
    for (const c of chamadas) expect(c.sql).toContain('LIMIT ?');
    expect(chamadas[0].params[1]).toBe(500);
  });

  it('para na primeira rodada quando não há nada a apagar', async () => {
    respostas = [0];
    expect(await limparAuditoriaDoTenant()).toBe(0);
    expect(chamadas).toHaveLength(1);
  });

  it('o laço tem TETO — não gira para sempre', async () => {
    /*
     * Se o banco devolvesse sempre lote cheio (data corrompida, replicação
     * atrasada), o laço prenderia o processo — e ele roda na instância que
     * também atende HTTP.
     */
    respostas = Array(1000).fill(500);
    const total = await limparAuditoriaDoTenant();
    expect(chamadas.length).toBe(200);
    expect(total).toBe(200 * 500);
  });
});

describe('a política é configurável, com piso', () => {
  it('respeita AUDITORIA_RETENCAO_MESES', async () => {
    /* Mudar a política não deveria exigir deploy. */
    vi.resetModules();
    process.env.AUDITORIA_RETENCAO_MESES = '12';
    const mod = await import('./auditoria-retencao?meses=12');
    respostas = [0];
    await mod.limparAuditoriaDoTenant(Date.parse('2026-09-07T12:00:00Z'));
    expect(String(chamadas[0].params[0]).slice(0, 7)).toBe('2025-09');
  });
});

describe('a limpeza roda sozinha, em cada tenant', () => {
  const servidor = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');

  it('roda no boot e a cada 24h', () => {
    /* No boot porque um servidor que passou dias fora acumulou registros
       vencidos, e esperar o ciclo deixaria dado pessoal além do prazo. */
    expect(servidor).toContain('limparAuditoria().catch');
    expect(servidor).toMatch(/limparAuditoria\(\)[\s\S]{0,120}24 \* 60 \* 60_000/);
  });

  it('percorre TODOS os tenants, e um quebrado não para os outros', () => {
    /* A tabela existe no banco de cada cliente: limpar só o atual deixaria a
       política valendo para um e não para os demais. */
    const i = servidor.indexOf('async function limparAuditoria()');
    const f = servidor.slice(i, i + 900);
    expect(f).toContain('await listarTenants()');
    expect(f).toContain('comTenant(tenant.db_nome, limparAuditoriaDoTenant)');
    expect(f).toMatch(/catch \(e\)/);
  });

  it('roda só na instância líder do PM2', () => {
    /* Três instâncias apagando em paralelo é três vezes o mesmo DELETE
       competindo pela mesma tabela. */
    const guarda = servidor.indexOf('if (rodarTarefas) {');
    expect(guarda).toBeGreaterThan(0);
    expect(servidor.indexOf('limparAuditoria().catch')).toBeGreaterThan(guarda);
  });
});
