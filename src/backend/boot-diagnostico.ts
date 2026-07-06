/**
 * Diagnóstico de boot — importado PRIMEIRO pelo server.ts.
 *
 * Objetivo: quando o processo morre logo no início (ex.: falha ao carregar um
 * módulo nativo como better-sqlite3, por incompatibilidade de versão do Node
 * no ambiente de deploy), o crash acontece antes de qualquer log do app e não
 * sobra rastro no "log de execução" da hospedagem. Aqui a gente:
 *   1. imprime uma prova-de-vida com versão do Node/plataforma;
 *   2. registra handlers globais que logam o erro REAL antes de sair.
 */
console.log(
  '🚀 Boot: Node', process.version,
  '|', process.platform, process.arch,
  '| cwd', process.cwd(),
);

process.on('uncaughtException', (e) => {
  console.error('❌ uncaughtException no boot:', e);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error('❌ unhandledRejection no boot:', e);
  process.exit(1);
});
