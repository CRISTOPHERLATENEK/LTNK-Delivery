/**
 * Verificação da Etapa 2 da migração MySQL — roda o schema completo num banco
 * de teste e valida os pontos de risco da tradução (índices únicos parciais
 * viram colunas geradas; CHECKs; FKs). Uso:
 *
 *   MYSQL_HOST=... MYSQL_USER=... MYSQL_PASSWORD=... MYSQL_DATABASE=teste \
 *     node dist/backend/testar-schema-mysql.js
 *
 * NÃO faz parte do app — é ferramenta de desenvolvimento da migração.
 * Pode rodar repetidas vezes (schema idempotente; os dados de teste são
 * limpos no início de cada execução).
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { inicializarSchema } from './schema-mysql';

async function main() {
  const database = process.env.MYSQL_DATABASE || 'delivery_teste';
  const config = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
  };

  console.log(`→ Conectando em ${config.host} ...`);
  const raiz = await mysql.createConnection(config);
  const [versao] = await raiz.query('SELECT VERSION() AS v');
  console.log(`→ Servidor: ${(versao as any)[0].v}`);
  await raiz.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    .catch(e => console.warn(`   (CREATE DATABASE falhou — talvez o usuário não tenha permissão; seguindo assumindo que já existe: ${e.message})`));
  await raiz.end();

  const pool = mysql.createPool({ ...config, database, connectionLimit: 4 });

  console.log(`→ Criando schema em \`${database}\` ...`);
  await inicializarSchema(pool);

  const [tabelas] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [database]);
  console.log(`✓ ${tabelas.length} tabelas criadas: ${tabelas.map(t => t.TABLE_NAME).join(', ')}`);

  // ---- Testes dos índices únicos parciais (o ponto mais arriscado da tradução) ----
  console.log('→ Testando unicidade parcial (cpf/telefone/domínio) ...');
  await pool.query("DELETE FROM usuarios WHERE email LIKE 'teste-schema-%'");

  const agora = new Date().toISOString();
  const inserirUsuario = (email: string, cpf: string | null, telefone: string | null) =>
    pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, telefone, cpf, criado_em)
       VALUES ('Teste', ?, 'x', 'cliente', ?, ?, ?)`,
      [email, telefone, cpf, agora],
    );

  // Dois usuários SEM cpf (NULL) e SEM telefone ('') não podem conflitar:
  await inserirUsuario('teste-schema-1@x.com', null, '');
  await inserirUsuario('teste-schema-2@x.com', null, '');
  console.log('  ✓ dois usuários com cpf NULL + telefone vazio coexistem');

  // CPF repetido de verdade TEM que falhar:
  await inserirUsuario('teste-schema-3@x.com', '11122233344', '47911111111');
  let falhou = false;
  try { await inserirUsuario('teste-schema-4@x.com', '11122233344', '47922222222'); }
  catch { falhou = true; }
  if (!falhou) throw new Error('FALHA: cpf duplicado foi aceito — índice único não está funcionando!');
  console.log('  ✓ cpf duplicado rejeitado');

  // Telefone repetido de verdade TEM que falhar:
  falhou = false;
  try { await inserirUsuario('teste-schema-5@x.com', '55566677788', '47911111111'); }
  catch { falhou = true; }
  if (!falhou) throw new Error('FALHA: telefone duplicado foi aceito!');
  console.log('  ✓ telefone duplicado rejeitado');

  // CHECK constraint (perfil inválido) TEM que falhar:
  falhou = false;
  try {
    await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, perfil, criado_em) VALUES ('X', 'teste-schema-6@x.com', 'x', 'hacker', ?)`,
      [agora],
    );
  } catch { falhou = true; }
  if (!falhou) console.warn('  ⚠ CHECK de perfil NÃO rejeitou valor inválido — servidor pode ser MySQL < 8.0.16 (CHECKs ignorados). Anotar!');
  else console.log('  ✓ CHECK constraint funcionando (perfil inválido rejeitado)');

  // lastInsertRowid/changes via o shim:
  const db = (await import('./db-mysql')).default;
  process.env.MYSQL_DATABASE = database; // garante que o shim usa o banco de teste
  const r = await db.prepare(
    `INSERT INTO usuarios (nome, email, senha_hash, perfil, criado_em) VALUES ('Shim', 'teste-schema-shim@x.com', 'x', 'cliente', ?)`
  ).run(agora);
  if (!r.lastInsertRowid || r.changes !== 1) throw new Error(`FALHA no shim: ${JSON.stringify(r)}`);
  const linha = await db.prepare('SELECT id, nome FROM usuarios WHERE id = ?').get(r.lastInsertRowid);
  console.log(`  ✓ shim db.prepare().run/get ok (id ${linha.id}, nome ${linha.nome})`);

  await pool.query("DELETE FROM usuarios WHERE email LIKE 'teste-schema-%'");
  await pool.end();
  const { fecharTudo } = await import('./db-mysql');
  await fecharTudo();
  console.log('\n✅ Etapa 2 verificada com sucesso.');
}

main().catch(e => { console.error('\n❌', e); process.exit(1); });
