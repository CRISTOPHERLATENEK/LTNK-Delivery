/**
 * IMPORTAR O CARDÁPIO DO IFOOD PELA LINHA DE COMANDO.
 *
 *     node dist/backend/ifood-importar-cli.js <banco> <lojaId> [categoria]
 *
 * Existe para quando o painel não está à mão. Chama exatamente as mesmas
 * funções que o botão da tela de Integrações — leitura, plano e gravação —
 * porque um segundo caminho de importação seria um segundo caminho para dar
 * errado, e o que passasse aqui não provaria nada sobre o que o lojista clica.
 *
 * `comTenant` é obrigatório e explícito: fora de um request não existe tenant no
 * contexto, e uma importação que caísse no banco errado criaria o cardápio de
 * uma loja dentro de outra.
 */
import { comTenant } from './db-mysql';
import { credenciaisDoAmbiente } from './ifood-cliente';
import { lerCardapioIfood } from './ifood-catalogo';
import { planejarImportacao } from './ifood-importar';
import { importarCardapio } from './ifood-importar-gravar';
import { depsImportacaoIfood } from './ifood-importar-deps';
import db from './db-mysql';

async function principal(): Promise<void> {
  const [banco, lojaTexto, categoria = 'iFood'] = process.argv.slice(2);
  if (!banco || !lojaTexto) {
    console.error('uso: node dist/backend/ifood-importar-cli.js <banco> <lojaId> [categoria]');
    process.exitCode = 1;
    return;
  }
  const lojaId = Number(lojaTexto);

  const cred = credenciaisDoAmbiente();
  if (!cred) { console.error('IFOOD_CLIENT_ID/SECRET não configurados.'); process.exitCode = 1; return; }

  await comTenant(banco, async () => {
    const linha = await db.prepare('SELECT ifood_merchant_id FROM lojas WHERE id = ?')
      .get(lojaId) as { ifood_merchant_id: string } | undefined;
    const merchantId = linha?.ifood_merchant_id || '';
    if (!merchantId) { console.error(`Loja ${lojaId} não tem código do iFood.`); process.exitCode = 1; return; }

    const produtos = await lerCardapioIfood(cred, merchantId);
    const deps = depsImportacaoIfood();
    const plano = planejarImportacao(produtos, await deps.produtosPorCodigo(lojaId));
    console.log(`lidos ${produtos.length} | novos ${plano.novos.length} | já existem ${plano.jaExistem.length} | sem código ${plano.semCodigo.length}`);
    for (const p of plano.novos) console.log(`  novo: ${p.nome} (${p.codigoExterno}) — ${p.grupos.length} grupo(s)`);

    const r = await importarCardapio(lojaId, produtos, categoria, deps);
    console.log(`criados ${r.criados} | pulados ${r.pulados} | falhas ${r.falhas.length}`);
    for (const f of r.falhas) console.error('  falha:', f);
    if (r.semPreco.length) console.log('sem preço (pausados):', r.semPreco.join(', '));
  });
}

void principal().then(() => process.exit(process.exitCode ?? 0));
