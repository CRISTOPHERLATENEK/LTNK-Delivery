/**
 * PUBLICAR O CARDÁPIO DAQUI NO IFOOD.
 *
 *     node dist/backend/ifood-publicar-cli.js <banco> <lojaId>            → ENSAIO
 *     node dist/backend/ifood-publicar-cli.js <banco> <lojaId> --publicar → envia
 *
 * Sem `--publicar` nada é enviado: mostra o que faria e para. É o padrão porque
 * o `PUT /items` substitui o item completo no cardápio de verdade da loja, com
 * o cliente comprando do outro lado, e não existe desfazer.
 */
import db, { comTenant } from './db-mysql';
import { credenciaisDoAmbiente } from './ifood-cliente';
import { publicarCardapioIfood, resumoDaPublicacao } from './ifood-publicar-ciclo';

async function principal(): Promise<void> {
  const args = process.argv.slice(2);
  const publicar = args.includes('--publicar');
  const [banco, lojaTexto] = args.filter(a => !a.startsWith('--'));

  if (!banco || !lojaTexto) {
    console.error('uso: node dist/backend/ifood-publicar-cli.js <banco> <lojaId> [--publicar]');
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

    if (!publicar) console.log('ENSAIO — nada será enviado ao iFood. Use --publicar para valer.');

    const r = await publicarCardapioIfood(cred, merchantId, lojaId, { publicar });
    console.log(resumoDaPublicacao(r));
    for (const p of r.previa) {
      console.log(`  ${p.acao}: ${p.nome} (${p.codigo}) — ${p.complementos} grupo(s)`);
    }
    if (r.semCodigo.length) console.log('sem código de barras, ficaram de fora:', r.semCodigo.join(', '));
    if (r.semPreco.length) console.log('SEM PREÇO aqui, ficaram de fora (publicar seria vender a R$ 0,01 lá):', r.semPreco.join(', '));
    if (r.soExistemNoIfood.length) console.log('existem só no iFood e NÃO foram tocados:', r.soExistemNoIfood.join(', '));
    for (const f of r.falhas) console.error('falha:', f);
  });
}

void principal().then(() => process.exit(process.exitCode ?? 0));
