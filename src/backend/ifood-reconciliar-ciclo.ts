/**
 * O CICLO DA RECONCILIAÇÃO.
 *
 * Fora do server.ts para poder rodar na hora, por comando, quando não dá para
 * esperar os dez minutos — e pelo MESMO caminho do laço automático. Duas
 * orquestrações fariam o "reconcilia agora" do suporte provar uma coisa e o
 * automático fazer outra.
 */
import db, { comTenant } from './db-mysql';
import { listarTenants } from './tenants-mysql';
import { credenciaisDoAmbiente as credenciaisIfood, motivosDeCancelamento } from './ifood-cliente';
import { transicionarStatus } from './fluxoPedido';
import { ehPedidoCanceladoLa, pedidosParaConferir, type PedidoParaConferir } from './ifood-reconciliar';

/**
 * RECONCILIAÇÃO: pedidos cancelados no iFood que continuaram ativos aqui.
 *
 * Nasceu de um caso real. O pedido #85 estava cancelado no iFood e seguia em
 * "preparando" aqui; dois mil registros de log depois, o evento de cancelamento
 * nunca tinha chegado. A cozinha teria continuado montando.
 *
 * O polling é a via principal e continua sendo. Isto é a rede embaixo — igual
 * ao que o Pix e o cartão já têm, e pelo mesmo motivo: evento perdido não avisa
 * que se perdeu. Cada evento é confirmado uma vez só; sem alguém perguntar de
 * novo, um pedido que perdeu o seu fica preso para sempre.
 *
 * A cada 10 minutos. Não a cada 30 segundos: uma chamada por pedido ativo por
 * ciclo, no ritmo do polling, competiria com o polling — que é o que mantém a
 * loja online no iFood.
 */
export async function reconciliarPedidosIfood(): Promise<void> {
  const cred = credenciaisIfood();
  if (!cred) return;

  for (const tenant of await listarTenants()) {
    if (!tenant.ativo) continue;

    let candidatos: PedidoParaConferir[];
    try {
      const linhas = await comTenant(tenant.db_nome, () => db.prepare(
        `SELECT id, status, pagamento_gateway_id, criado_em
           FROM pedidos
          WHERE origem = 'ifood' AND status IN ('pendente','aceito','preparando','pronto','em_entrega')`
      ).all()) as Array<{ id: number; status: string; pagamento_gateway_id: string | null; criado_em: string }>;
      candidatos = pedidosParaConferir(
        linhas.map(l => ({ id: l.id, status: l.status, orderId: l.pagamento_gateway_id ?? '', criadoEm: l.criado_em })),
        Date.now(),
      );
    } catch (e) {
      console.error(`[ifood-reconcilia] não consegui listar pedidos do tenant ${tenant.slug}:`, e);
      continue;
    }

    for (const p of candidatos) {
      /*
       * A pergunta é o `/cancellationReasons`, e não é escolha: não existe
       * endpoint de status de pedido. `/status`, `/events` e `/tracking` dão
       * 404, e o `GET /orders/{id}` responde 200 sem campo de estado. Num
       * pedido cancelado, este devolve 400 com "already cancelled".
       */
      try {
        await motivosDeCancelamento(cred, p.orderId);
      } catch (e) {
        const erro = e as { httpStatus?: number; message?: string };
        if (!ehPedidoCanceladoLa(erro)) continue;

        await comTenant(tenant.db_nome, async () => {
          try {
            await transicionarStatus(p.id, 'cancelado' as never, { vindoDoIfood: true });
            console.log(
              `[ifood-reconcilia] pedido #${p.id} estava '${p.status}' aqui e CANCELADO no iFood — ` +
              `corrigido. O evento de cancelamento não chegou pelo polling.`,
            );
          } catch (err) {
            console.error(`[ifood-reconcilia] pedido #${p.id}: ${(err as Error).message}`);
          }
        });
      }
    }
  }
}
