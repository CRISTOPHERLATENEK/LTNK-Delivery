/**
 * Registra (e confere) as URLs de webhook na ONZ — roda UMA VEZ por ambiente.
 *
 * Sem isso a confirmação de pagamento nunca chega: a cobrança é criada, o
 * cliente paga, e o pedido fica eternamente "aguardando".
 *
 * Uso:
 *   node dist/backend/registrar-webhook-onz.js https://seudominio.com.br
 *   node dist/backend/registrar-webhook-onz.js https://seudominio.com.br --conferir
 *
 * O domínio é o público do app (o que a ONZ vai chamar de fora). O script monta
 * a URL completa com o token secreto (ONZ_WEBHOOK_TOKEN) e o banco do tenant
 * (MYSQL_DATABASE) — porque o webhook precisa saber em qual banco confirmar o
 * pedido no modelo SILO (um banco por tenant).
 *
 * ⚠️ MULTI-TENANT: cada tenant que usar o Pix da ONZ precisa da sua própria
 * URL registrada (o `?t=` muda). Como a credencial da ONZ é UMA por conta, e o
 * `PUT /webhook/{chave}` é por CHAVE PIX, o desenho suportado hoje é: uma conta
 * ONZ (a da plataforma) recebendo por todos os tenants -> registre a URL com o
 * `?t=` do banco MASTER e o webhook resolve o pedido pelo txid. Se um dia cada
 * tenant tiver sua própria conta/chave ONZ, rode este script uma vez por tenant
 * com o MYSQL_DATABASE daquele tenant.
 */
import 'dotenv/config';
import {
  cashInDisponivel, cashOutDisponivel,
  registrarWebhookCashIn, consultarWebhookCashIn, registrarWebhookCashOut,
} from './onz';

function montarUrl(base: string, caminho: string): string {
  const token = process.env.ONZ_WEBHOOK_TOKEN || '';
  const banco = process.env.MYSQL_DATABASE || '';
  if (!token) throw new Error('ONZ_WEBHOOK_TOKEN não definido no .env (invente um segredo longo).');
  if (!banco) throw new Error('MYSQL_DATABASE não definido no .env.');
  const limpo = base.replace(/\/+$/, '');
  return `${limpo}${caminho}?tk=${encodeURIComponent(token)}&t=${encodeURIComponent(banco)}`;
}

/** Esconde o token ao imprimir (o terminal pode ficar em log/histórico). */
function mascarar(url: string): string {
  return url.replace(/tk=[^&]+/, 'tk=***');
}

async function principal(): Promise<void> {
  // Separa flags (--x) de posicionais, pra `--conferir` sozinho não ser lido
  // como se fosse a URL.
  const args = process.argv.slice(2);
  const soConferir = args.includes('--conferir');
  const base = args.find(a => !a.startsWith('--')) || '';

  if (!base && !soConferir) {
    console.error('Uso: node dist/backend/registrar-webhook-onz.js https://seudominio.com.br [--conferir]');
    process.exit(1);
  }
  if (base && !/^https:\/\//i.test(base)) {
    // A ONZ (como qualquer PSP Pix) exige HTTPS público — http:// ou localhost
    // são recusados, e o erro que volta não é óbvio.
    console.error('❌ A URL precisa ser HTTPS pública (a ONZ não aceita http:// nem localhost).');
    process.exit(1);
  }
  if (base) {
    // A ONZ ACEITA registrar um domínio que não existe (não resolve DNS na
    // hora), então um placeholder colado sem querer passa silenciosamente e o
    // pagamento nunca confirma — já aconteceu. Barramos aqui.
    const host = (() => { try { return new URL(base).hostname; } catch { return ''; } })();
    const suspeito = /^$|seu[_-]?dominio|seudominio|dominio|example\.|localhost|^\d+\.\d+\.\d+\.\d+$/i.test(host)
      || !host.includes('.');
    if (suspeito) {
      console.error(`❌ "${host || base}" não parece um domínio real.`);
      console.error('   Troque pelo domínio público de verdade do app, ex.:');
      console.error('   node dist/backend/registrar-webhook-onz.js https://pedidos.suaempresa.com.br');
      process.exit(1);
    }
  }

  console.log(`cash-in configurado: ${cashInDisponivel() ? 'sim' : 'NÃO'} | cash-out: ${cashOutDisponivel() ? 'sim' : 'NÃO'}`);

  // ── Conferência do que já está registrado ──
  if (cashInDisponivel()) {
    try {
      const atual = await consultarWebhookCashIn();
      // mascarar() também aqui: a URL registrada CONTÉM o token (tk=), e este
      // output vai pro terminal/log.
      console.log(atual.registrado
        ? `\n→ Webhook de cash-in JÁ registrado: ${mascarar(JSON.stringify(atual.bruto))}`
        : '\n→ Nenhum webhook de cash-in registrado ainda.');
    } catch (e) {
      console.log(`\n→ Não foi possível consultar o webhook atual: ${(e as Error).message}`);
    }
  }

  if (soConferir) {
    console.log('\n(--conferir: nada foi alterado)');
    return;
  }

  // ── Registro cash-in (Pix recebido → confirma o pedido) ──
  if (cashInDisponivel()) {
    const url = montarUrl(base, '/api/pagamentos/webhook/onz');
    console.log(`\n▶ Registrando cash-in em: ${mascarar(url)}`);
    await registrarWebhookCashIn(url);
    console.log('  ✅ registrado.');
  } else {
    console.log('\n⏭  cash-in sem credenciais — pulado.');
  }

  // ── Registro cash-out (status do Pix que ENVIAMOS) ──
  // A rota que recebe isso ainda não existe no app (o cash-out não está ligado
  // a nenhum fluxo de negócio). Registrar já evita ter que voltar aqui depois.
  if (cashOutDisponivel()) {
    const url = montarUrl(base, '/api/pagamentos/webhook/onz-cashout');
    console.log(`\n▶ Registrando cash-out em: ${mascarar(url)}`);
    try {
      // A API Accounts valida o e-mail estritamente. SMTP_FROM costuma vir como
      // `"Minha Loja" <nao-responda@dominio>` — extraímos só o endereço, e se
      // não houver um válido, omitimos (o campo é opcional).
      const bruto = process.env.SMTP_FROM || process.env.SUPORTE_EMAIL || '';
      const achado = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(bruto)?.[0];
      await registrarWebhookCashOut(url, achado);
      console.log('  ✅ registrado.');
    } catch (e) {
      // Não aborta: o cash-in (que é o que está em uso) já foi registrado.
      console.log(`  ⚠️  falhou: ${(e as Error).message}`);
    }
  }

  console.log('\nPronto. Teste pagando uma cobrança e confira o pedido virando "aprovado".');
}

principal().catch(e => {
  console.error('\n❌ Falhou:', (e as Error).message);
  process.exit(1);
});
