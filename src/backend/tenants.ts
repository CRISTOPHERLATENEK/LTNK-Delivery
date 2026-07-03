/**
 * Control plane do multi-tenant (SILO).
 *
 * Um banco central (`_central.db`) guarda o registro de tenants: nome, slug,
 * domínio e qual arquivo .db pertence a cada um. A resolução por domínio na
 * entrada do request decide qual banco o `db` vai usar.
 *
 * Este módulo usa sua PRÓPRIA conexão (não o proxy do db.ts) para evitar
 * recursão — ele é a fonte da verdade de "qual .db abrir".
 */
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { agoraUTC } from './util';

const arquivoCentral = process.env.TENANTS_DB || './dados/_central.db';
const ARQUIVO_PADRAO = process.env.DB_ARQUIVO || './dados/delivery.db';

const dir = path.dirname(path.resolve(arquivoCentral));
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const central = new Database(path.resolve(arquivoCentral));
central.pragma('journal_mode = WAL');
central.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id          INTEGER PRIMARY KEY,
    nome        TEXT    NOT NULL,
    slug        TEXT    NOT NULL UNIQUE,
    dominio     TEXT    UNIQUE,
    db_arquivo  TEXT    NOT NULL,
    ativo       INTEGER NOT NULL DEFAULT 1,
    criado_em   TEXT    NOT NULL
  );
`);

export interface Tenant {
  id: number;
  nome: string;
  slug: string;
  dominio: string | null;
  db_arquivo: string;
  ativo: 0 | 1;
  criado_em: string;
}

// Garante o tenant PADRÃO (o banco que já existe) — tudo segue funcionando.
{
  const n = (central.prepare('SELECT COUNT(*) AS n FROM tenants').get() as { n: number }).n;
  if (n === 0) {
    central.prepare(
      `INSERT INTO tenants (nome, slug, dominio, db_arquivo, ativo, criado_em)
       VALUES (?, ?, NULL, ?, 1, ?)`
    ).run('Padrão', 'padrao', ARQUIVO_PADRAO, agoraUTC());
  }
}

/** O tenant master é o banco padrão — só ele gerencia os outros tenants. */
export function ehMaster(arquivo: string): boolean {
  return path.resolve(arquivo) === path.resolve(ARQUIVO_PADRAO);
}

/** Normaliza o Host (remove porta e www., minúsculas). */
function normalizarHost(host: string): string {
  return host.split(':')[0].toLowerCase().replace(/^www\./, '');
}

/**
 * Domínio base do SaaS (ex.: "seuapp.com"). Com um DNS coringa `*.seuapp.com`
 * apontando pro servidor, cada cliente vira `slug.seuapp.com` automaticamente —
 * sem configurar DNS por cliente.
 */
const DOMINIO_BASE = (process.env.DOMINIO_BASE || '').toLowerCase().replace(/^www\./, '');

/**
 * Resolve o tenant pela URL da requisição. Ordem:
 *  1) Domínio próprio do cliente (match exato — CNAME). Tem prioridade.
 *  2) Subdomínio sob o domínio base: `<slug>.seuapp.com` (wildcard).
 */
export function resolverPorHost(host: string | undefined): Tenant | null {
  if (!host) return null;
  const h = normalizarHost(host);

  // 1) domínio customizado
  const exato = central.prepare('SELECT * FROM tenants WHERE dominio = ? AND ativo = 1').get(h) as Tenant | undefined;
  if (exato) return exato;

  // 2) subdomínio coringa: <slug>.DOMINIO_BASE
  if (DOMINIO_BASE && h.endsWith('.' + DOMINIO_BASE)) {
    const sub = h.slice(0, -(DOMINIO_BASE.length + 1));
    if (sub && !sub.includes('.')) {
      const porSlug = central.prepare('SELECT * FROM tenants WHERE slug = ? AND ativo = 1').get(sub) as Tenant | undefined;
      if (porSlug) return porSlug;
    }
  }
  return null;
}

/** Tenant padrão (fallback para localhost / domínios não cadastrados). */
export function tenantPadrao(): Tenant {
  return (central.prepare('SELECT * FROM tenants WHERE db_arquivo = ? ORDER BY id LIMIT 1').get(ARQUIVO_PADRAO) as Tenant)
    ?? (central.prepare('SELECT * FROM tenants ORDER BY id LIMIT 1').get() as Tenant);
}

export function listarTenants(): Tenant[] {
  return central.prepare('SELECT * FROM tenants ORDER BY id').all() as Tenant[];
}

export function tenantPorId(id: number | string): Tenant | undefined {
  return central.prepare('SELECT * FROM tenants WHERE id = ?').get(id) as Tenant | undefined;
}

/** Cria um tenant novo com seu próprio arquivo .db (provisionamento). */
export function criarTenant(dados: { nome: string; slug: string; dominio?: string | null }): Tenant {
  const slug = dados.slug.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (slug.length < 2) throw new Error('Slug inválido.');
  const dbArquivo = `./dados/tenants/${slug}.db`;
  const info = central.prepare(
    `INSERT INTO tenants (nome, slug, dominio, db_arquivo, ativo, criado_em)
     VALUES (?, ?, ?, ?, 1, ?)`
  ).run(dados.nome, slug, dados.dominio?.trim().toLowerCase() || null, dbArquivo, agoraUTC());
  return tenantPorId(Number(info.lastInsertRowid))!;
}

export function atualizarTenant(id: number, campos: Partial<Pick<Tenant, 'nome' | 'dominio' | 'ativo'>>): void {
  const atual = tenantPorId(id);
  if (!atual) throw new Error('Tenant não encontrado.');
  central.prepare('UPDATE tenants SET nome = ?, dominio = ?, ativo = ? WHERE id = ?').run(
    campos.nome ?? atual.nome,
    campos.dominio !== undefined ? (campos.dominio?.trim().toLowerCase() || null) : atual.dominio,
    campos.ativo !== undefined ? campos.ativo : atual.ativo,
    id,
  );
}
