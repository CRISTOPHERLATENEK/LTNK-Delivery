/**
 * Control plane do multi-tenant (SILO) — versão MySQL de tenants.ts.
 *
 * Antes: um banco central `_central.db` (SQLite) guardava o registro de
 * tenants (nome, slug, domínio, arquivo .db). Agora: uma tabela `tenants`
 * dentro de um banco MySQL "central" dedicado (`MYSQL_DATABASE_CENTRAL`) guarda
 * o mesmo registro, trocando `db_arquivo` (caminho de arquivo) por `db_nome`
 * (nome do banco MySQL do tenant).
 *
 * IMPORTANTE (decisão da Etapa 1): o usuário MySQL da Hostinger NÃO tem
 * privilégio CREATE DATABASE. Isso significa que `criarTenant()` NÃO cria o
 * banco do tenant — ele só registra a linha, e exige que o banco MySQL
 * correspondente já exista (criado manualmente no hPanel antes). Se o banco
 * não existir/não for alcançável, `criarTenant()` falha com erro claro em vez
 * de silenciosamente deixar o tenant quebrado.
 */
import { Pool } from 'mysql2/promise';
import { abrirPool, garantirColuna, criarBancoSeNaoExiste } from './db-mysql';
import { inicializarSchema } from './schema-mysql';
import { agoraUTC } from './util';

/**
 * Prefixo obrigatório do nome do banco de qualquer tenant provisionado
 * automaticamente. Existe porque o usuário MySQL do app só tem privilégio
 * CREATE/DROP escopado a esse padrão (`tenant\_%`, ver GRANT no servidor) —
 * nunca privilégio geral. Provisionamento automático só é tentado quando o
 * nome bate com esse prefixo; fora disso, cai no fluxo manual de sempre.
 */
const PREFIXO_AUTO_CRIACAO = process.env.MYSQL_TENANT_PREFIX || 'tenant_';

const BANCO_CENTRAL = process.env.MYSQL_DATABASE_CENTRAL || process.env.MYSQL_DATABASE || '';
const BANCO_PADRAO = process.env.MYSQL_DATABASE || '';

function poolCentral(): Pool {
  if (!BANCO_CENTRAL) throw new Error('MYSQL_DATABASE_CENTRAL (ou MYSQL_DATABASE) não configurado.');
  return abrirPool(BANCO_CENTRAL);
}

export interface Tenant {
  id: number;
  nome: string;
  slug: string;
  dominio: string | null;
  db_nome: string;
  ativo: 0 | 1;
  criado_em: string;
}

/** Cria a tabela `tenants` no banco central e garante o tenant padrão. Chamar uma vez no boot. */
export async function inicializarCentral(): Promise<void> {
  const pool = poolCentral();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id          INT PRIMARY KEY AUTO_INCREMENT,
      nome        TEXT    NOT NULL,
      slug        VARCHAR(60) NOT NULL UNIQUE,
      dominio     VARCHAR(255) UNIQUE,
      db_nome     VARCHAR(120) NOT NULL,
      ativo       TINYINT NOT NULL DEFAULT 1,
      criado_em   VARCHAR(32) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // coluna dominio pode ter sido criada NOT NULL em versões antigas de teste — no-op se já ok.
  await garantirColuna(pool, BANCO_CENTRAL, 'tenants', 'ativo', 'ativo TINYINT NOT NULL DEFAULT 1');

  const [linhas] = await pool.query('SELECT COUNT(*) AS n FROM tenants');
  const n = (linhas as Array<{ n: number }>)[0].n;
  if (n === 0) {
    if (!BANCO_PADRAO) throw new Error('MYSQL_DATABASE (banco padrão) não configurado.');
    await pool.query(
      `INSERT INTO tenants (nome, slug, dominio, db_nome, ativo, criado_em) VALUES (?, ?, NULL, ?, 1, ?)`,
      ['Padrão', 'padrao', BANCO_PADRAO, agoraUTC()],
    );
  }
}

/** O tenant master é o banco padrão — só ele gerencia os outros tenants. */
export function ehMaster(dbNome: string): boolean {
  return dbNome === BANCO_PADRAO;
}

function normalizarHost(host: string): string {
  return host.split(':')[0].toLowerCase().replace(/^www\./, '');
}

const DOMINIO_BASE = (process.env.DOMINIO_BASE || '').toLowerCase().replace(/^www\./, '');

/**
 * Resolve o tenant pela URL da requisição. Ordem:
 *  1) Domínio próprio do cliente (match exato — CNAME). Tem prioridade.
 *  2) Subdomínio sob o domínio base: `<slug>.seuapp.com` (wildcard).
 */
export async function resolverPorHost(host: string | undefined): Promise<Tenant | null> {
  if (!host) return null;
  const h = normalizarHost(host);
  const pool = poolCentral();

  const [exatoRows] = await pool.query('SELECT * FROM tenants WHERE dominio = ? AND ativo = 1', [h]);
  const exato = (exatoRows as Tenant[])[0];
  if (exato) return exato;

  if (DOMINIO_BASE && h.endsWith('.' + DOMINIO_BASE)) {
    const sub = h.slice(0, -(DOMINIO_BASE.length + 1));
    if (sub && !sub.includes('.')) {
      const [subRows] = await pool.query('SELECT * FROM tenants WHERE slug = ? AND ativo = 1', [sub]);
      const porSlug = (subRows as Tenant[])[0];
      if (porSlug) return porSlug;
    }
  }
  return null;
}

/** Tenant padrão (fallback para localhost / domínios não cadastrados). */
export async function tenantPadrao(): Promise<Tenant> {
  const pool = poolCentral();
  const [porBanco] = await pool.query('SELECT * FROM tenants WHERE db_nome = ? ORDER BY id LIMIT 1', [BANCO_PADRAO]);
  const t = (porBanco as Tenant[])[0];
  if (t) return t;
  const [qualquer] = await pool.query('SELECT * FROM tenants ORDER BY id LIMIT 1');
  return (qualquer as Tenant[])[0];
}

export async function listarTenants(): Promise<Tenant[]> {
  const [rows] = await poolCentral().query('SELECT * FROM tenants ORDER BY id');
  return rows as Tenant[];
}

export async function tenantPorId(id: number | string): Promise<Tenant | undefined> {
  const [rows] = await poolCentral().query('SELECT * FROM tenants WHERE id = ?', [id]);
  return (rows as Tenant[])[0];
}

export async function tenantPorSlug(slug: string): Promise<Tenant | undefined> {
  const [rows] = await poolCentral().query('SELECT * FROM tenants WHERE slug = ? AND ativo = 1', [slug]);
  return (rows as Tenant[])[0];
}

export async function tenantPorDbNome(dbNome: string): Promise<Tenant | undefined> {
  const [rows] = await poolCentral().query('SELECT * FROM tenants WHERE db_nome = ?', [dbNome]);
  return (rows as Tenant[])[0];
}

/** O banco MySQL alvo já existe e está alcançável com as credenciais atuais? */
async function bancoAlcancavel(dbNome: string): Promise<boolean> {
  try {
    const pool = abrirPool(dbNome);
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Registra um tenant novo. Se o banco MySQL de destino já tem o prefixo
 * de auto-criação (`MYSQL_TENANT_PREFIX`, ver acima), tenta criá-lo sozinho
 * (o usuário do app tem privilégio CREATE escopado a esse padrão). Fora
 * desse padrão — ex.: MySQL gerenciado sem privilégio CREATE nenhum, como
 * era na Hostinger — exige que o banco já exista, criado manualmente antes.
 * De qualquer forma, roda o schema completo nele (idempotente) no final.
 */
export async function criarTenant(dados: { nome: string; slug: string; dominio?: string | null; dbNome: string }): Promise<Tenant> {
  const slug = dados.slug.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (slug.length < 2) throw new Error('Slug inválido.');

  let alcancavel = await bancoAlcancavel(dados.dbNome);
  if (!alcancavel && dados.dbNome.startsWith(PREFIXO_AUTO_CRIACAO)) {
    try {
      await criarBancoSeNaoExiste(dados.dbNome);
      alcancavel = await bancoAlcancavel(dados.dbNome);
    } catch { /* segue pro erro claro abaixo se ainda não alcançável */ }
  }
  if (!alcancavel) {
    throw new Error(
      `O banco MySQL "${dados.dbNome}" não existe ou não está alcançável. Crie-o manualmente ` +
      `(hPanel ou terminal do servidor) com este nome exato antes de cadastrar o tenant.`,
    );
  }

  await inicializarSchema(abrirPool(dados.dbNome));

  const pool = poolCentral();
  const [resultado] = await pool.query(
    `INSERT INTO tenants (nome, slug, dominio, db_nome, ativo, criado_em) VALUES (?, ?, ?, ?, 1, ?)`,
    [dados.nome, slug, dados.dominio?.trim().toLowerCase() || null, dados.dbNome, agoraUTC()],
  );
  const id = (resultado as { insertId: number }).insertId;
  return (await tenantPorId(id))!;
}

export async function atualizarTenant(id: number, campos: Partial<Pick<Tenant, 'nome' | 'dominio' | 'ativo'>>): Promise<void> {
  const atual = await tenantPorId(id);
  if (!atual) throw new Error('Tenant não encontrado.');
  await poolCentral().query('UPDATE tenants SET nome = ?, dominio = ?, ativo = ? WHERE id = ?', [
    campos.nome ?? atual.nome,
    campos.dominio !== undefined ? (campos.dominio?.trim().toLowerCase() || null) : atual.dominio,
    campos.ativo !== undefined ? campos.ativo : atual.ativo,
    id,
  ]);
}
