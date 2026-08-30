/**
 * RECONCILIAR OS PEDIDOS DO IFOOD, AGORA.
 *
 *     node dist/backend/ifood-reconciliar-cli.js
 *
 * O laço roda de dez em dez minutos; isto é para quando não dá para esperar —
 * um lojista no telefone dizendo que o pedido sumiu do iFood e continua na tela
 * dele. Chama `reconciliarPedidosIfood`, o mesmo ciclo do automático.
 *
 * Varre TODOS os tenants, como o laço: um pedido preso não escolhe cliente.
 */
import { reconciliarPedidosIfood } from './ifood-reconciliar-ciclo';

void reconciliarPedidosIfood()
  .then(r => {
    /*
     * O resumo é o ponto, não o "concluída". A primeira versão dizia
     * "reconciliação concluída" mesmo sem ter conseguido conferir um único
     * pedido — e disse isso justamente durante um bloqueio de rede, com um
     * pedido preso do outro lado.
     */
    console.log(`conferidos ${r.conferidos} | corrigidos ${r.corrigidos} | não consegui conferir ${r.naoConsegui}`);
    process.exit(r.naoConsegui > 0 ? 1 : 0);
  })
  .catch(e => { console.error('falhou:', e.message); process.exit(1); });
