/**
 * Configuração do PM2 — versionada de propósito.
 *
 * O modo cluster foi ligado na mão uma vez, e config que só existe na máquina
 * volta ao padrão no primeiro `pm2 delete` ou numa máquina nova. Aqui ela
 * viaja com o código.
 */
module.exports = {
  apps: [{
    name: 'delivery',
    script: 'dist/backend/server.js',
    cwd: '/opt/delivery',

    /*
     * TRÊS INSTÂNCIAS numa máquina de 4 núcleos, não `max`.
     *
     * Medido: com um processo só, a vazão travava em ~200 req/s com o Node em
     * 106% de CPU (um núcleo saturado) e a máquina com três ociosos. Com três,
     * passou de 440 req/s. O quarto núcleo fica pro MariaDB, que sob carga
     * sobe a 131% — tomá-lo do banco tiraria de um lado pra dar ao outro.
     */
    instances: 3,
    exec_mode: 'cluster',

    /*
     * ESPERA O SINAL 'ready' do processo antes de derrubar o antigo.
     *
     * O app só manda esse sinal depois de aplicar o schema de TODOS os tenants
     * (ver process.send('ready') em server.ts). Sem isto, o PM2 considera
     * pronta a instância recém-nascida e mata a antiga no meio das migrações —
     * que com 100 clientes é uma janela medida de 8 segundos derrubando tudo.
     */
    wait_ready: true,
    listen_timeout: 120_000,

    /*
     * Prazo entre o SIGINT e o SIGKILL. O app fecha o servidor e espera as
     * requisições em andamento (encerrar() no server.ts); 15s dá folga sobre os
     * 10s de prazo interno.
     */
    kill_timeout: 15_000,

    max_memory_restart: '1G',
    time: true,
  }],
};
