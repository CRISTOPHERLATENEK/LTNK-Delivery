/**
 * Verificação da Etapa 3 da migração MySQL — registro central de tenants.
 * Usa o MESMO banco de teste como central E como tenant padrão (não temos um
 * segundo banco MySQL provisionado manualmente pra testar `criarTenant` com
 * um banco separado — isso é verificado manualmente na Etapa 4/6 quando
 * houver um segundo banco real no hPanel).
 *
 *   MYSQL_HOST=... MYSQL_USER=... MYSQL_PASSWORD=... MYSQL_DATABASE=teste \
 *     node dist/backend/testar-tenants-mysql.js
 */
import 'dotenv/config';

async function main() {
  process.env.MYSQL_DATABASE_CENTRAL = process.env.MYSQL_DATABASE;

  const { inicializarCentral, tenantPadrao, listarTenants, resolverPorHost, atualizarTenant, tenantPorId } =
    await import('./tenants-mysql');

  console.log('→ Inicializando registro central...');
  await inicializarCentral();

  const padrao = await tenantPadrao();
  if (!padrao || padrao.slug !== 'padrao') throw new Error(`FALHA: tenant padrão não veio certo: ${JSON.stringify(padrao)}`);
  console.log(`  ✓ tenant padrão: id=${padrao.id} db_nome=${padrao.db_nome}`);

  // idempotência: rodar de novo não duplica o tenant padrão
  await inicializarCentral();
  const todos1 = await listarTenants();
  const qtdPadrao = todos1.filter(t => t.slug === 'padrao').length;
  if (qtdPadrao !== 1) throw new Error(`FALHA: inicializarCentral duplicou o tenant padrão (${qtdPadrao}x)`);
  console.log('  ✓ inicializarCentral é idempotente');

  // atualizarTenant + resolverPorHost por domínio customizado
  await atualizarTenant(padrao.id, { dominio: 'teste-tenant.example.com' });
  const viaHost = await resolverPorHost('teste-tenant.example.com');
  if (!viaHost || viaHost.id !== padrao.id) throw new Error(`FALHA: resolverPorHost não encontrou pelo domínio: ${JSON.stringify(viaHost)}`);
  console.log('  ✓ resolverPorHost resolve por domínio customizado');

  // limpa o domínio de teste pra não afetar o banco
  await atualizarTenant(padrao.id, { dominio: null });
  const semHost = await resolverPorHost('teste-tenant.example.com');
  if (semHost) throw new Error('FALHA: domínio removido ainda resolve');
  console.log('  ✓ resolverPorHost não resolve após remover domínio');

  const porId = await tenantPorId(padrao.id);
  if (!porId || porId.id !== padrao.id) throw new Error('FALHA: tenantPorId');
  console.log('  ✓ tenantPorId ok');

  const { fecharTudo } = await import('./db-mysql');
  await fecharTudo();
  console.log('\n✅ Etapa 3 (registro central) verificada com sucesso.');
  console.log('   NOTA: criarTenant() com um banco MySQL SEPARADO ainda não foi testado');
  console.log('   de ponta a ponta (precisa de um segundo banco criado manualmente no hPanel).');
}

main().catch(e => { console.error('\n❌', e); process.exit(1); });
