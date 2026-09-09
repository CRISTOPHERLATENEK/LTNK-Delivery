/*
 * IPv4 PRIMEIRO na resolução de nomes.
 *
 * O servidor ganhou IPv6 no reboot de 06/08, e o Node passa a preferir IPv6
 * quando a máquina tem. Isso quebrou o WhatsApp em silêncio: `wbapi.deeliv.app`
 * fica atrás do Cloudflare e responde diferente conforme a família de IP —
 *
 *   IPv4 → 200/401, a API de verdade
 *   IPv6 → 403 com `cf-mitigated: challenge`, desafio de navegador
 *
 * O desafio é insolúvel fora de um navegador, então toda chamada morria em 403
 * e parecia bloqueio do fornecedor. Era escolha de rota nossa.
 *
 * Fica no BOOT, antes de qualquer módulo: o `fetch` do Node (undici) não aceita
 * agente customizado por requisição sem a dependência `undici`, que este
 * projeto não tem. Preferir IPv4 é conservador — é o caminho que todos os
 * fornecedores usados aqui atendem (Mercado Pago, ONZ, ViaCEP, geocodificação)
 * — e reversível numa linha se algum dia a rede exigir IPv6.
 */
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

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
  /*
   * ESTE AVISO DIZIA MAIS DO QUE SABE, e foi corrigido depois de aparecer
   * 1.189 vezes no log de erro afirmando algo falso.
   *
   * Ele lia a falta de `MERCADOPAGO_WEBHOOK_SECRET` e concluía "a validação de
   * assinatura está DESLIGADA". Não é verdade: o segredo do `.env` é o da
   * aplicação DA PLATAFORMA, e o Mercado Pago assina por aplicação. Loja com
   * conta própria valida com o segredo DELA — que, em produção, passou a ser
   * obrigatório (`exigeSegredoWebhook`). Para essas lojas, o `.env` é
   * irrelevante.
   *
   * O que a falta do segredo realmente significa: as lojas que usam a conta da
   * PLATAFORMA ficam sem validação. Se não houver nenhuma, não há nada a
   * avisar — e um aviso de segurança falso repetido a cada boot é o melhor jeito
   * de ensinar alguém a ignorar avisos de segurança.
   */
  if (process.env.MERCADOPAGO_ACCESS_TOKEN && !process.env.MERCADOPAGO_WEBHOOK_SECRET) {
    console.warn(
      'ℹ️  [MERCADO PAGO] MERCADOPAGO_WEBHOOK_SECRET não definido. Isso afeta ' +
      'SOMENTE as lojas que usam a conta de Mercado Pago DA PLATAFORMA: para elas, ' +
      'a assinatura do webhook não é conferida (o impacto é limitado — o status é ' +
      'sempre reconsultado na API do MP antes de valer). Loja com conta própria usa ' +
      'o segredo dela, que em produção é obrigatório. Para cobrir também as lojas da ' +
      'conta da plataforma, pegue o segredo em Mercado Pago → Suas integrações → ' +
      'Webhooks e defina no .env.',
    );
  }
}
avisarProtecaoDesligada();
