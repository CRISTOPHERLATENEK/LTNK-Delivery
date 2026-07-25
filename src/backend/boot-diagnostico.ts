/**
 * Diagnóstico de boot — importado PRIMEIRO pelo server.ts.
 *
 * Objetivo: quando o processo morre logo no início (ex.: falha ao carregar um
 * módulo nativo, ou ao conectar no MySQL, por incompatibilidade de versão do
 * Node no ambiente de deploy), o crash acontece antes de qualquer log do app e
 * não sobra rastro no "log de execução" da hospedagem. Aqui a gente:
 *   1. imprime uma prova-de-vida com versão do Node/plataforma;
 *   2. registra handlers globais que logam o erro REAL antes de sair.
 */
// dotenv ainda não rodou (o server.ts só importa 'dotenv/config' depois deste
// arquivo, de propósito) — carrega aqui também, defensivamente, só pra ler o
// SENTRY_DSN a tempo de capturar um crash bem no início do boot.
import 'dotenv/config';
import { iniciarMonitoramento, capturarErro, drenarMonitoramento } from './monitoramento';

console.log(
  '🚀 Boot: Node', process.version,
  '|', process.platform, process.arch,
  '| cwd', process.cwd(),
);

iniciarMonitoramento();

// Só é fatal DURANTE o boot (primeiros 30s) — é aí que um crash não deixaria
// rastro nenhum sem isso (módulo nativo incompatível, MySQL inalcançável,
// etc.). Depois que o processo está de pé, um erro sem catch em qualquer
// lugar do código (ex.: uma promise solta em algum request de UM tenant)
// NÃO deve derrubar o servidor inteiro pra TODOS os tenants — só loga e
// segue. `unref()` pra esse timer não segurar o processo vivo sozinho.
let dentroDaJanelaDeBoot = true;
setTimeout(() => { dentroDaJanelaDeBoot = false; }, 30_000).unref();

process.on('uncaughtException', (e) => {
  console.error(dentroDaJanelaDeBoot ? '❌ uncaughtException no boot:' : '❌ uncaughtException (processo continua no ar):', e);
  capturarErro(e, { fase: 'uncaughtException' });
  if (dentroDaJanelaDeBoot) drenarMonitoramento().finally(() => process.exit(1));
});
process.on('unhandledRejection', (e) => {
  console.error(dentroDaJanelaDeBoot ? '❌ unhandledRejection no boot:' : '❌ unhandledRejection (processo continua no ar):', e);
  capturarErro(e, { fase: 'unhandledRejection' });
  if (dentroDaJanelaDeBoot) drenarMonitoramento().finally(() => process.exit(1));
});

/**
 * Grita sobre proteções que estão silenciosamente DESLIGADAS por falta de
 * config. Várias verificações do projeto são opt-in de propósito (sem o
 * segredo, a proteção não roda, e quem ainda não configurou não fica
 * travado) — o efeito colateral é que elas podem ficar desligadas pra sempre
 * sem ninguém perceber. Um aviso no boot é barato e resolve isso.
 */
function avisarProtecaoDesligada(): void {
  // Só avisa se o Mercado Pago está de fato em uso — senão vira ruído.
  if (process.env.MERCADOPAGO_ACCESS_TOKEN && !process.env.MERCADOPAGO_WEBHOOK_SECRET) {
    console.warn(
      '⚠️  [SEGURANCA] MERCADOPAGO_WEBHOOK_SECRET ausente — a validação de assinatura ' +
      '(x-signature) do webhook está DESLIGADA: quem descobrir a URL consegue POSTar ' +
      'uma notificação forjada. O impacto é limitado (o status é sempre reconsultado ' +
      'na API do MP antes de valer), mas o certo é pegar o segredo em Mercado Pago → ' +
      'Suas integrações → Webhooks e definir no .env.',
    );
  }
}
avisarProtecaoDesligada();
