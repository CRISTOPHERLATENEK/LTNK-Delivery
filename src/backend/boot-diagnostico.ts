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

process.on('uncaughtException', (e) => {
  console.error('❌ uncaughtException no boot:', e);
  capturarErro(e, { fase: 'uncaughtException' });
  drenarMonitoramento().finally(() => process.exit(1));
});
process.on('unhandledRejection', (e) => {
  console.error('❌ unhandledRejection no boot:', e);
  capturarErro(e, { fase: 'unhandledRejection' });
  drenarMonitoramento().finally(() => process.exit(1));
});
