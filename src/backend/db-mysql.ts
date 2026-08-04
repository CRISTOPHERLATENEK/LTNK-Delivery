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
  // As tabelas são utf8mb4, mas o DEFAULT da CONEXÃO no mysql2 é utf8mb3 — sem
  // isso, um caractere de 4 bytes (emoji) numa mensagem/notificação/produto dá
  // erro 1366 "Incorrect string value" (modo estrito) ou é truncado.
  charset: 'utf8mb4',
};

/**
 * Banco do tenant padrão/master. Use SEMPRE de forma explícita, via
 * `comTenant(BANCO_PADRAO, fn)` — nunca como fallback implícito (ver
 * bancoTenantAtual abaixo).
 */
export const BANCO_PADRAO = process.env.MYSQL_DATABASE || 'delivery';

// ── Multi-tenant: um pool por banco, resolvido via AsyncLocalStorage ──

const pools = new Map<string, Pool>();
const contexto = new AsyncLocalStorage<{ database: string }>();

/** Abre (ou reusa do cache) o pool de um banco. NÃO roda schema — o
 *  provisionamento de tenant é explícito (ver tenants.ts), não preguiçoso. */
/**
 * Conexões por tenant. UM POOL POR BANCO, e o cache nunca libera — então o
 * consumo total é `connectionLimit × tenants alcançados desde o boot`.
 *
 * O TETO QUE ISSO EVITA: com os 10 originais e o `max_connections=151` padrão do
 * MySQL, o 16º tenant esgotava as conexões e a plataforma INTEIRA passava a dar
 * "Too many connections" — não o tenant novo, todos. Some como queda total, não
 * como lentidão, e sem nada no log explicando.
 *
 * 4 é suficiente: cada requisição usa uma conexão por vez e o app é I/O-bound;
 * o que precisa de folga é pico simultâneo na MESMA loja, não o número de lojas.
 * Ajustável por env pra quem tiver `max_connections` maior.
 */
const CONEXOES_POR_TENANT = Math.max(1, Number(process.env.MYSQL_CONEXOES_POR_TENANT) || 4);

/** Lido uma vez do servidor (não do env) pra o aviso abaixo não mentir. */
let maxConexoesServidor: number | null = null;
let avisouTeto = false;

/**
 * Avisa ANTES de esgotar. Sem isto, o sintoma do teto é a plataforma toda caindo
 * sem pista da causa — com isto, existe uma linha de log nomeando o problema e
 * dizendo o que ajustar. Best-effort: falhar aqui não pode atrapalhar o request.
 */
async function conferirTetoDeConexoes(pool: Pool): Promise<void> {
  if (avisouTeto) return;
  try {
    if (maxConexoesServidor === null) {
      const [linhas] = await pool.query("SHOW VARIABLES LIKE 'max_connections'") as any;
      maxConexoesServidor = Number(linhas?.[0]?.Value) || 151;
    }
    const projetado = pools.size * CONEXOES_POR_TENANT;
    if (projetado > maxConexoesServidor * 0.8) {
      avisouTeto = true;
      console.warn(
        `⚠️  [BANCO] ${pools.size} tenant(s) × ${CONEXOES_POR_TENANT} conexões = ${projetado}, ` +
        `perto do limite do MySQL (max_connections=${maxConexoesServidor}). ` +
        `Ao estourar, TODOS os tenants passam a falhar com "Too many connections". ` +
        `Aumente max_connections no servidor ou reduza MYSQL_CONEXOES_POR_TENANT no .env.`,
      );
    }
  } catch { /* diagnóstico é best-effort */ }
}

export function abrirPool(database: string): Pool {
  const existente = pools.get(database);
  if (existente) return existente;
  const pool = mysql.createPool({
    ...CONFIG_BASE,
    database,
    waitForConnections: true,
    connectionLimit: CONEXOES_POR_TENANT,
    // Datas viajam como string (nosso schema guarda ISO-8601 em VARCHAR de
    // qualquer forma, mas isso protege caso alguma coluna vire DATETIME).
    dateStrings: true,
  });
  pools.set(database, pool);
  conferirTetoDeConexoes(pool).catch(() => { /* nunca atrapalha o request */ });
  return pool;
}

/** Roda `fn` no contexto de um tenant (define qual banco o `db` vai usar). */
export function comTenant<T>(database: string, fn: () => T): T {
  return contexto.run({ database }, fn);
}

/**
 * Banco do tenant atual. FAIL-CLOSED de propósito: sem contexto, LANÇA.
 *
 * Antes isso caía silenciosamente no BANCO_PADRAO. Num SaaS multi-tenant esse
 * fallback é perigoso: se o contexto se perde em algum caminho (um job novo,
 * um callback que escapa do request, um webhook sem `comTenant`), a query não
 * falha — ela lê/grava no banco MASTER, que aqui é um tenant real com dados
 * reais. O erro vira vazamento silencioso entre tenants em vez de exceção.
 *
 * Fora de request (boot, jobs, scripts) o banco tem que ser DECLARADO:
 *   comTenant(BANCO_PADRAO, fn)   // master, explicitamente
 *   comTenant(tenant.db_nome, fn) // um tenant específico
 */
export function bancoTenantAtual(): string {
  const store = contexto.getStore();
  if (!store) {
    throw new Error(
      'Nenhum tenant no contexto: toda query precisa rodar dentro de comTenant(). ' +
      'Fora de request (boot, jobs, scripts), declare o banco: comTenant(BANCO_PADRAO, fn).',
    );
  }
  return store.database;
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
