/**
 * Camada de banco MySQL (substituta do db.ts/better-sqlite3).
 *
 * POR QUE EXISTE: o plano "Web App Node.js" da Hostinger recria o disco do
 * app a cada deploy — qualquer arquivo SQLite em `dados/` é apagado. O único
 * armazenamento persistente é o MySQL gerenciado do hPanel. Este módulo
 * replica o contrato do db.ts antigo em cima do `mysql2/promise`:
 *
 *   await db.prepare(sql).get(...params)   → uma linha ou undefined
 *   await db.prepare(sql).all(...params)   → array de linhas
 *   await db.prepare(sql).run(...params)   → { lastInsertRowid, changes }
 *   await db.exec(bloco)                   → DDL multi-statement
 *   await comTransacao(async tx => {...})  → substitui db.transaction(fn)()
 *
 * A "forma" das chamadas é idêntica à antiga de propósito: a conversão das
 * 464 chamadas existentes vira, na maioria, só adicionar `await` na frente
 * (o TypeScript aponta os esquecidos, já que os métodos retornam Promise).
 *
 * Multi-tenant SILO preservado: um BANCO MySQL por tenant (era um arquivo
 * .db por tenant), resolvido por request via AsyncLocalStorage — mesmo
 * padrão do db.ts antigo, mas sem o Proxy (desnecessário agora que os
 * métodos são async de verdade e o pool é resolvido dentro de cada um).
 *
 * Convenções mantidas do schema antigo (decisão de design, não acidente):
 *  - Valores monetários em CENTAVOS (INT)
 *  - Datas em UTC ISO-8601 como VARCHAR — `agoraUTC()` continua a fonte da
 *    verdade; strings ISO ordenam lexicográfica = cronologicamente, então
 *    todas as comparações `>= ?` existentes continuam corretas sem mexer
 *  - Booleans como TINYINT 0/1
 */
import mysql, { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { AsyncLocalStorage } from 'async_hooks';

// ── Config de conexão (mesmo servidor pra todos os tenants; muda só o database) ──

const CONFIG_BASE = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
};

/** Banco do tenant padrão (fora de request: boot, jobs). Ex.: u438637664_delivery. */
const BANCO_PADRAO = process.env.MYSQL_DATABASE || 'delivery';

// ── Multi-tenant: um pool por banco, resolvido via AsyncLocalStorage ──

const pools = new Map<string, Pool>();
const contexto = new AsyncLocalStorage<{ database: string }>();

/** Abre (ou reusa do cache) o pool de um banco. NÃO roda schema — o
 *  provisionamento de tenant é explícito (ver tenants.ts), não preguiçoso. */
export function abrirPool(database: string): Pool {
  const existente = pools.get(database);
  if (existente) return existente;
  const pool = mysql.createPool({
    ...CONFIG_BASE,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    // Datas viajam como string (nosso schema guarda ISO-8601 em VARCHAR de
    // qualquer forma, mas isso protege caso alguma coluna vire DATETIME).
    dateStrings: true,
  });
  pools.set(database, pool);
  return pool;
}

/** Roda `fn` no contexto de um tenant (define qual banco o `db` vai usar). */
export function comTenant<T>(database: string, fn: () => T): T {
  return contexto.run({ database }, fn);
}

/** Banco do tenant atual (ou o padrão, fora de request). */
export function bancoTenantAtual(): string {
  return contexto.getStore()?.database ?? BANCO_PADRAO;
}

function poolAtual(): Pool {
  return abrirPool(bancoTenantAtual());
}

// ── Shim com o mesmo contrato do better-sqlite3 (só que async) ──

export interface ResultadoRun { lastInsertRowid: number; changes: number }

export interface StatementAsync {
  get<T = any>(...params: unknown[]): Promise<T | undefined>;
  all<T = any>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<ResultadoRun>;
}

/** Executa contra um pool OU uma conexão dedicada (transação) — mesma cara. */
function prepararEm(executor: Pool | PoolConnection, sql: string): StatementAsync {
  return {
    async get(...params) {
      const [linhas] = await executor.execute<RowDataPacket[]>(sql, params as any[]);
      return (linhas[0] as any) ?? undefined;
    },
    async all(...params) {
      const [linhas] = await executor.execute<RowDataPacket[]>(sql, params as any[]);
      return linhas as any[];
    },
    async run(...params) {
      const [r] = await executor.execute<ResultSetHeader>(sql, params as any[]);
      return { lastInsertRowid: r.insertId, changes: r.affectedRows };
    },
  };
}

const db = {
  prepare(sql: string): StatementAsync {
    return prepararEm(poolAtual(), sql);
  },

  /**
   * DDL multi-statement (schema/migrações). Usa uma conexão dedicada com
   * multipleStatements ligado — NUNCA habilitar isso no pool de queries
   * normais (aumenta a superfície de SQL injection à toa).
   */
  async exec(sql: string): Promise<void> {
    const conn = await mysql.createConnection({
      ...CONFIG_BASE,
      database: bancoTenantAtual(),
      multipleStatements: true,
    });
    try {
      await conn.query(sql);
    } finally {
      await conn.end();
    }
  },
};

export default db;

// ── Transações (substitui db.transaction(fn)() do better-sqlite3) ──

/**
 * Roda `fn` dentro de uma transação real (BEGIN/COMMIT/ROLLBACK) numa única
 * conexão do pool do tenant atual. Dentro de `fn`, use `tx.prepare(...)` em
 * vez de `db.prepare(...)` — queries via `db.` iriam pro pool (fora da
 * transação!) e não seriam desfeitas num rollback.
 */
export async function comTransacao<T>(fn: (tx: { prepare(sql: string): StatementAsync }) => Promise<T>): Promise<T> {
  const conn = await poolAtual().getConnection();
  try {
    await conn.beginTransaction();
    const tx = { prepare: (sql: string) => prepararEm(conn, sql) };
    const resultado = await fn(tx);
    await conn.commit();
    return resultado;
  } catch (e) {
    await conn.rollback().catch(() => { /* rollback falhou: conexão já caiu */ });
    throw e;
  } finally {
    conn.release();
  }
}

// ── Migração idempotente (substitui o garantirColuna/PRAGMA do SQLite) ──

/**
 * Adiciona a coluna se ainda não existir — mesmo contrato do garantirColuna
 * antigo, mas consultando INFORMATION_SCHEMA (MySQL não tem PRAGMA table_info).
 */
export async function garantirColuna(pool: Pool, database: string, tabela: string, coluna: string, ddl: string): Promise<void> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [database, tabela, coluna],
  );
  if (linhas.length === 0) {
    await pool.query(`ALTER TABLE \`${tabela}\` ADD COLUMN ${ddl}`);
  }
}

/**
 * Cria o índice se ainda não existir (MySQL não tem CREATE INDEX IF NOT
 * EXISTS em todas as versões — checa INFORMATION_SCHEMA.STATISTICS antes).
 */
export async function garantirIndice(pool: Pool, database: string, tabela: string, nomeIndice: string, ddl: string): Promise<void> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
      LIMIT 1`,
    [database, tabela, nomeIndice],
  );
  if (linhas.length === 0) {
    await pool.query(ddl);
  }
}

/**
 * Cria um banco novo se ele ainda não existir. Só funciona se o usuário do
 * MySQL tiver privilégio CREATE pro nome em questão — no VPS, o usuário do
 * app só tem esse privilégio pra bancos com o prefixo de tenant (ver
 * MYSQL_TENANT_PREFIX e o GRANT feito em `tenant\_%`), então isto SEMPRE
 * deve ser chamado só com nomes já validados/prefixados (ver
 * dbNomeDoTenant em rotas/admin.ts) — nunca com entrada solta do usuário.
 */
export async function criarBancoSeNaoExiste(nomeBanco: string): Promise<void> {
  const conn = await mysql.createConnection(CONFIG_BASE);
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${nomeBanco}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await conn.end();
  }
}

/** Fecha todos os pools (testes/shutdown gracioso). */
export async function fecharTudo(): Promise<void> {
  await Promise.all([...pools.values()].map(p => p.end().catch(() => {})));
  pools.clear();
}
