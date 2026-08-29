/**
 * SINCRONIZAR O CARDÁPIO DE UMA LOJA, AGORA.
 *
 *     node dist/backend/ifood-sincronizar-cli.js <banco> <lojaId>
 *
 * O laço do servidor roda de hora em hora; isto é para quando não dá para
 * esperar — conferir se a sincronização faz o que promete, ou desempatar uma
 * dúvida do lojista no telefone. Chama `sincronizarLojaIfood`, o MESMO ciclo do
 * laço automático: com duas orquestrações, o "sincronizar agora" provaria uma
 * coisa e o automático faria outra.
 *
 * Roda mesmo com a sincronização desligada na loja, e é de propósito: serve
 * para ver o que ACONTECERIA antes de o lojista ligar. Por isso avisa quando a
 * direção está desligada — senão alguém rodaria isto, veria o cardápio mudar e
 * concluiria que a sincronização automática está ativa.
 */
import db, { comTenant } from './db-mysql';
import { credenciaisDoAmbiente } from './ifood-cliente';
import { sincronizarLojaIfood, resumoDoCiclo, NADA_A_FAZER } from './ifood-sincronizar-ciclo';

async function principal(): Promise<void> {
  const [banco, lojaTexto] = process.argv.slice(2);
  if (!banco || !lojaTexto) {
    console.error('uso: node dist/backend/ifood-sincronizar-cli.js <banco> <lojaId>');
    process.exitCode = 1;
    return;
  }
  const lojaId = Number(lojaTexto);

  const cred = credenciaisDoAmbiente();
  if (!cred) { console.error('IFOOD_CLIENT_ID/SECRET não configurados.'); process.exitCode = 1; return; }

  await comTenant(banco, async () => {
    const linha = await db.prepare(
      'SELECT ifood_merchant_id, ifood_sincronizacao FROM lojas WHERE id = ?'
    ).get(lojaId) as { ifood_merchant_id: string; ifood_sincronizacao: string } | undefined;

    const merchantId = linha?.ifood_merchant_id || '';
    if (!merchantId) { console.error(`Loja ${lojaId} não tem código do iFood.`); process.exitCode = 1; return; }
    if (linha?.ifood_sincronizacao !== 'do_ifood') {
      console.log(`AVISO: a loja ${lojaId} está com a sincronização DESLIGADA (${linha?.ifood_sincronizacao}).`);
      console.log('Este ciclo roda mesmo assim; o automático não vai rodar.');
    }

    const r = await sincronizarLojaIfood(cred, merchantId, lojaId);
    if (r === NADA_A_FAZER) { console.log('nada mudou.'); return; }

    if (r.criados || r.atualizados || r.gruposNovos || r.opcoesNovas) console.log(resumoDoCiclo(r));
    if (r.travadosSemPreco.length) console.log('à venda lá, pausados aqui por falta de preço:', r.travadosSemPreco.join(', '));
    if (r.sumiramDoIfood.length) console.log('sumiram de lá e foram MANTIDOS aqui:', r.sumiramDoIfood.join(', '));
    for (const f of r.falhas) console.error('falha:', f);
  });
}

void principal().then(() => process.exit(process.exitCode ?? 0));
