/**
 * Migração de dados: um arquivo SQLite (tenant antigo) → um banco MySQL
 * (tenant novo), preservando IDs. One-off — não faz parte do app em produção.
 *
 * Uso:
 *   MYSQL_HOST=... MYSQL_USER=... MYSQL_PASSWORD=... \
 *     node dist/backend/migrar-para-mysql.js <arquivo.db> <banco_mysql_destino>
 *
 * Ensaie SEMPRE contra uma CÓPIA do .db de produção (baixada via
 * GET /api/admin/backup) e um banco MySQL de TESTE antes de rodar contra o
 * banco real — este script não é idempotente por padrão (roda com
 * `--limpar` pra apagar as tabelas do destino antes, se quiser repetir).
 *
 * Ordem das tabelas: mesma ordem de dependência de FK do schema-mysql.ts
 * (pais antes de filhos) — necessária pra respeitar as foreign keys durante
 * o INSERT, já que o script não desliga a checagem de FK do MySQL.
 */
import 'dotenv/config';
import path from 'path';
import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';

const ORDEM_TABELAS = [
  'usuarios', 'lojas', 'produtos', 'grupos_opcoes', 'opcoes_itens', 'enderecos',
  'pedidos', 'historico_status', 'itens_pedido', 'banners', 'configuracoes',
  'eventos_notificacao', 'notas_fiscais', 'zonas_entrega', 'avaliacoes',
  'push_inscricoes', 'favoritos', 'mesas', 'comandas', 'comanda_itens',
  'cozinha_contas', 'cozinha_tickets', 'cozinha_ticket_itens', 'cupons',
  'setores', 'categorias', 'admin_auditoria', 'avaliacoes_entregador',
  'mensagens_pedido', 'etapas_entrega',
];

/** Colunas booleanas do schema SQLite antigo que precisam virar 0/1 explícito (já são INTEGER, então normalmente ok). */
function normalizarValor(v: unknown): unknown {
  if (v === undefined) return null;
  return v;
}

async function main() {
  const [, , arquivoSqlite, bancoDestino, ...flags] = process.argv;
  if (!arquivoSqlite || !bancoDestino) {
    console.error('Uso: node migrar-para-mysql.js <arquivo.db> <banco_mysql_destino> [--limpar]');
    process.exit(1);
  }
  const limpar = flags.includes('--limpar');

  const sqlite = new Database(path.resolve(arquivoSqlite), { readonly: true });
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: bancoDestino,
    connectionLimit: 4,
    // Conexão em utf8mb4 (as tabelas são utf8mb4) — senão emojis nos dados
    // legados dariam erro/truncagem e a linha cairia em "conflito" sem migrar.
    charset: 'utf8mb4',
  });

  // STRICT_ALL_TABLES em toda conexão do pool (evento 'connection': roda uma
  // vez por conexão FÍSICA nova, não por query — `pool.query()` sozinho só
  // afetaria a conexão emprestada naquela hora). Sem modo estrito, um valor
  // fora do range (string grande demais pra VARCHAR, número fora do domínio)
  // seria truncado/zerado EM SILÊNCIO em vez de virar erro — a linha entraria
  // como "migrada com sucesso" no relatório com dado corrompido, sem cair na
  // lista de conflitos que este script existe pra reportar.
  pool.on('connection', (conn) => { conn.query("SET SESSION sql_mode = 'STRICT_ALL_TABLES'"); });

  console.log(`→ Origem: ${arquivoSqlite}`);
  console.log(`→ Destino: banco MySQL "${bancoDestino}"`);
  if (limpar) console.log('⚠ --limpar: as tabelas do destino serão esvaziadas antes de migrar.');

  if (limpar) {
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const tabela of [...ORDEM_TABELAS].reverse()) {
      await pool.query(`DELETE FROM \`${tabela}\``).catch(() => { /* tabela pode não existir */ });
    }
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');
  }

  const relatorio: Array<{ tabela: string; origem: number; inseridas: number }> = [];
  const conflitos: Array<{ tabela: string; id: unknown; erro: string }> = [];

  for (const tabela of ORDEM_TABELAS) {
    const existeSqlite = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(tabela);
    if (!existeSqlite) { relatorio.push({ tabela, origem: 0, inseridas: 0 }); continue; }

    const linhas = sqlite.prepare(`SELECT * FROM ${tabela}`).all() as Record<string, unknown>[];
    if (linhas.length === 0) { relatorio.push({ tabela, origem: 0, inseridas: 0 }); continue; }

    // Só migra colunas que existem no schema MySQL de destino (INFORMATION_SCHEMA).
    const [colunasDestinoRows] = await pool.query(
      'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [bancoDestino, tabela],
    ) as any;
    const colunasDestino = new Set((colunasDestinoRows as Array<{ COLUMN_NAME: string }>).map(r => r.COLUMN_NAME));
    const colunasOrigem = Object.keys(linhas[0]).filter(c => colunasDestino.has(c));
    if (colunasOrigem.length === 0) { relatorio.push({ tabela, origem: linhas.length, inseridas: 0 }); continue; }

    const placeholders = `(${colunasOrigem.map(() => '?').join(',')})`;
    // INSERT simples (sem ON DUPLICATE KEY UPDATE) DE PROPÓSITO: um upsert
    // esconderia conflito de chave única (telefone/cpf/email duplicados —
    // dados legados sujos do SQLite, que nunca teve a constraint aplicada de
    // verdade) descartando a linha perdedora em silêncio. Aqui cada conflito
    // vira um erro por linha, coletado no relatório final. Reexecução exige
    // `--limpar` (não é idempotente por PK de propósito).
    let sql = `INSERT INTO \`${tabela}\` (${colunasOrigem.map(c => `\`${c}\``).join(',')}) VALUES ${placeholders}`;
    // EXCEÇÃO: `configuracoes` é chave-valor e o schema JÁ SEMEIA 11 chaves
    // (INSERT IGNORE em inicializarSchema) antes da migração. Com INSERT puro,
    // essas chaves colidiriam na PK `chave` e o VALOR REAL de produção
    // (comissao_percentual, suporte_*, wbapi_*, ...) cairia em "conflito" e
    // ficaria o default. Aqui o valor de produção deve VENCER → upsert.
    if (tabela === 'configuracoes') {
      const cols = colunasOrigem.filter(c => c !== 'chave');
      if (cols.length) sql += ` ON DUPLICATE KEY UPDATE ${cols.map(c => `\`${c}\`=VALUES(\`${c}\`)`).join(',')}`;
    }

    let inseridas = 0;
    const idxId = colunasOrigem.indexOf('id');
    for (const linha of linhas) {
      const valores = colunasOrigem.map(c => normalizarValor(linha[c]));
      try {
        await pool.query(sql, valores);
        inseridas++;
      } catch (e: any) {
        conflitos.push({ tabela, id: idxId >= 0 ? valores[idxId] : '?', erro: e.sqlMessage || e.message });
      }
    }
    relatorio.push({ tabela, origem: linhas.length, inseridas });
    console.log(`  ${inseridas === linhas.length ? '✓' : '⚠'} ${tabela}: ${inseridas}/${linhas.length} linhas`);
  }

  // Ajusta AUTO_INCREMENT de cada tabela pro próximo id livre (senão o MySQL
  // tentaria reusar IDs baixos já ocupados pelos registros migrados).
  for (const tabela of ORDEM_TABELAS) {
    try {
      const [rows] = await pool.query(`SELECT MAX(id) AS maxId FROM \`${tabela}\``) as any;
      const maxId = rows[0]?.maxId;
      if (maxId) await pool.query(`ALTER TABLE \`${tabela}\` AUTO_INCREMENT = ?`, [Number(maxId) + 1]);
    } catch { /* tabela sem coluna id (não existe no schema) — ignora */ }
  }

  sqlite.close();
  await pool.end();

  console.log('\n=== Relatório de migração ===');
  let algumaDivergencia = false;
  for (const r of relatorio) {
    const ok = r.origem === r.inseridas;
    if (!ok) algumaDivergencia = true;
    console.log(`${ok ? '✓' : '✗'} ${r.tabela.padEnd(24)} origem=${r.origem} migradas=${r.inseridas}`);
  }
  if (conflitos.length > 0) {
    console.warn(`\n⚠ ${conflitos.length} linha(s) NÃO migradas por conflito de chave única (dado legado sujo do SQLite):`);
    for (const c of conflitos) console.warn(`  - ${c.tabela} id=${c.id}: ${c.erro}`);
    console.warn('\n  Resolva manualmente antes do corte em produção (Etapa 6): geralmente é telefone/cpf/e-mail');
    console.warn('  duplicado entre contas — o SQLite antigo não aplicava essa constraint de verdade em dados legados.');
  }
  if (algumaDivergencia) {
    console.warn('\n⚠ Há divergência de contagem em pelo menos uma tabela — confira o relatório de conflitos acima.');
    process.exit(1);
  }
  console.log('\n✅ Migração concluída sem divergências de contagem.');
}

main().catch(e => { console.error('\n❌', e); process.exit(1); });
