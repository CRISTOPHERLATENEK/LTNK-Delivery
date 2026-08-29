/**
 * AS CHAMADAS QUE ESCREVEM NO CARDÁPIO DO IFOOD.
 *
 * Separado de `ifood-catalogo`, que é só leitura, e a separação é o ponto: ler
 * errado mostra uma tela errada; escrever errado apaga o cardápio de uma loja
 * enquanto o cliente compra. Quem for mexer aqui precisa ver isto primeiro.
 */
import { chamarIfood, type CredenciaisIfood, type OpcoesIfood } from './ifood-cliente';

const base = (merchantId: string) =>
  `/catalog/v2.0/merchants/${encodeURIComponent(merchantId)}`;

/**
 * Grava o item — criando ou substituindo.
 *
 * O payload TEM que vir de `montarPayloadItem`, que o monta sobre o estado
 * atual do item. Passar um objeto montado à mão aqui é o caminho direto para
 * apagar `contextModifiers` e complementos.
 */
export async function publicarItem(
  cred: CredenciaisIfood,
  merchantId: string,
  payload: Record<string, unknown>,
  opcoes?: OpcoesIfood,
): Promise<{ status: number; corpo: unknown }> {
  return chamarIfood(
    cred,
    `${base(merchantId)}/items`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    opcoes,
  );
}

/** Pausar ou reativar sem tocar em mais nada. */
export async function mudarStatusItem(
  cred: CredenciaisIfood,
  merchantId: string,
  itemId: string,
  disponivel: boolean,
  opcoes?: OpcoesIfood,
): Promise<{ status: number; corpo: unknown }> {
  return chamarIfood(
    cred,
    `${base(merchantId)}/items/status`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ id: itemId, status: disponivel ? 'AVAILABLE' : 'UNAVAILABLE' }]),
    },
    opcoes,
  );
}

export interface EstadoLote {
  status: string;
  sucessos: number;
  falhas: number;
  /** Terminou de processar? `COMPLETED` ou `ERROR`. */
  terminou: boolean;
}

/**
 * O estado de um lote assíncrono.
 *
 * Existe porque a resposta 200 do lote NÃO significa que aplicou: a API devolve
 * um `batchId` e manda consultar até `COMPLETED`. Uma resposta com
 * `failureCount: 5` é sucesso PARCIAL — e sucesso parcial em preço é item
 * vendendo pelo valor errado, com 200 no log dizendo que deu certo.
 */
export async function conferirLote(
  cred: CredenciaisIfood,
  merchantId: string,
  batchId: string,
  opcoes?: OpcoesIfood,
): Promise<EstadoLote> {
  const { corpo } = await chamarIfood(
    cred,
    `${base(merchantId)}/batch/${encodeURIComponent(batchId)}`,
    { method: 'GET' },
    opcoes,
  );
  const d = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const status = String(d.status ?? '').toUpperCase();
  return {
    status,
    sucessos: Number(d.successCount ?? 0) || 0,
    falhas: Number(d.failureCount ?? 0) || 0,
    terminou: status === 'COMPLETED' || status === 'ERROR',
  };
}

/** O lote aplicou TUDO? Parcial não conta como sucesso. */
export function loteDeuCerto(e: EstadoLote): boolean {
  return e.terminou && e.status === 'COMPLETED' && e.falhas === 0;
}
