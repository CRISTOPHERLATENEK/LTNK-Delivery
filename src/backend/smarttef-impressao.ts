/**
 * IMPRIMIR NA MAQUININHA — a nota sai no aparelho, mas quem EMITE é o sistema.
 *
 * A distinção não é vocabulário: emitir é assinar com o certificado A1 e
 * transmitir à SEFAZ; imprimir é papel. O `print/create` do Smart TEF recebe um
 * arquivo ou um texto PRONTO (`file.name` + `file.data`) — a maquininha não
 * monta nota, não conhece NCM e não fala com a SEFAZ. Ela imprime o que
 * mandarmos.
 *
 * Isso mantém UM emissor só. Dois emissores no mesmo CNPJ, na mesma série,
 * significa número de nota repetido e rejeição da SEFAZ na hora da venda — o
 * risco que este desenho existe para não correr.
 *
 * O GANHO REAL É NA ENTREGA. Com isto, a maquininha do entregador cobra o cartão
 * e imprime a nota no mesmo aparelho, sem impressora térmica no balcão e sem o
 * cliente esperar duas máquinas.
 *
 * IMPRESSÃO É ASSÍNCRONA, como a cobrança. O `print/create` devolve um
 * identificador e nasce PENDENTE (`PDT`): quem imprime é o aparelho, quando ele
 * busca a fila. "Aceitou o pedido de impressão" não é "imprimiu", e tratar como
 * se fosse é o operador entregando sem cupom achando que saiu.
 */
import { ErroTef } from './smarttef-cliente';
import { tokenTef } from './smarttef-auth';

/** Pendente: criada e ainda não impressa pelo aparelho. */
export const STATUS_PENDENTE = 'PDT';

/** Fila geral da loja, quando não se aponta um aparelho específico. */
export const TIPO_NORMAL = 'NRM';

export interface CredenciaisImpressao {
  baseUrl: string;
  usuario: string;
  senha: string;
  gatewayToken: string;
  cnpj: string;
  /** Vazio = qualquer aparelho da loja pega. Ver `alvoDaImpressao`. */
  serialPos: string;
  storeId?: number;
}

export interface PedidoDeImpressao {
  /**
   * Nossa chave de idempotência. TEM que ser estável por documento: a mesma
   * nota reenviada com o mesmo `printId` não pode virar dois cupons.
   */
  printId: string;
  /** Nome do arquivo que aparece na fila do aparelho. */
  nome: string;
  /** O cupom, em texto — o mesmo que hoje vai para a impressora térmica. */
  texto: string;
}

/**
 * Para onde a impressão vai.
 *
 * Com serial, vai para AQUELE aparelho. Sem serial, entra na fila geral e o
 * primeiro que buscar imprime — que é o certo para uma loja com uma maquininha
 * só, e errado para uma loja com várias: o cupom do cliente sairia no balcão
 * enquanto o entregador espera.
 *
 * Serial de aparelho que não existe é o pior caso: a impressão fica pendente
 * para sempre, sem erro, e ninguém procura o que não sabe que travou.
 */
export function alvoDaImpressao(serialPos: string): { order_type: string; serial_pos?: string } {
  const serial = serialPos.trim();
  return serial ? { order_type: 'CRD_UNICO', serial_pos: serial } : { order_type: TIPO_NORMAL };
}

/**
 * O corpo do `print/create`.
 *
 * `is_from_text: true` porque mandamos TEXTO, não arquivo binário. O cupom que o
 * sistema já gera para a impressora térmica é texto — converter para PDF só
 * para depois a maquininha renderizar seria trabalho a mais e uma chance a mais
 * de o layout quebrar no caminho.
 */
export function corpoDaImpressao(
  cred: CredenciaisImpressao,
  pedido: PedidoDeImpressao,
): Record<string, unknown> {
  return {
    cnpj: cred.cnpj.replace(/\D/g, '').slice(0, 14),
    print_id: pedido.printId,
    file: { name: pedido.nome, data: pedido.texto },
    is_from_text: true,
    print_status: STATUS_PENDENTE,
    has_details: false,
    ...(cred.storeId !== undefined ? { store_id: cred.storeId } : {}),
    ...alvoDaImpressao(cred.serialPos),
  };
}

export interface OpcoesImpressao {
  buscar?: typeof fetch;
  timeoutMs?: number;
  caminhoLogin?: string;
}

async function chamar(
  cred: CredenciaisImpressao,
  caminho: string,
  corpo: Record<string, unknown>,
  opcoes: OpcoesImpressao,
): Promise<unknown> {
  const buscar = opcoes.buscar ?? fetch;
  const token = await tokenTef(
    { baseUrl: cred.baseUrl, usuario: cred.usuario, senha: cred.senha },
    { buscar: opcoes.buscar, timeoutMs: opcoes.timeoutMs, caminho: opcoes.caminhoLogin },
  );

  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), opcoes.timeoutMs ?? 20_000);

  let resp: Response;
  try {
    resp = await buscar(`${cred.baseUrl}${caminho}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'ocp-apim-subscription-key': cred.gatewayToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corpo),
      signal: controlador.signal,
    });
  } catch {
    /*
     * Pode ter chegado. Diferente da cobrança, aqui o pior caso é papel
     * desperdiçado, não dinheiro — mas o `printId` estável evita até isso: a
     * mesma impressão reenviada é a mesma impressão.
     */
    throw new ErroTef('A maquininha não respondeu ao pedido de impressão.', 0, true);
  } finally {
    clearTimeout(timer);
  }

  let corpoResp: unknown = null;
  try { corpoResp = await resp.json(); } catch { corpoResp = null; }

  if (!resp.ok) {
    const d = (corpoResp && typeof corpoResp === 'object' ? corpoResp : {}) as Record<string, unknown>;
    const msg = String(d.message ?? (d.data as Record<string, unknown>)?.message ?? '').trim();
    throw new ErroTef(msg || `A impressão respondeu ${resp.status}.`, resp.status);
  }
  return corpoResp;
}

/**
 * Manda o cupom para a fila de impressão do aparelho.
 *
 * NÃO CHAME ANTES DE A NOTA ESTAR AUTORIZADA. Cupom impresso de nota não
 * autorizada é documento que não existe na mão do cliente — e o cliente guarda,
 * confere, e cobra.
 */
export async function imprimirNaMaquininha(
  cred: CredenciaisImpressao,
  pedido: PedidoDeImpressao,
  opcoes: OpcoesImpressao = {},
): Promise<{ identificador: string }> {
  if (!pedido.printId.trim()) throw new ErroTef('Impressão sem identificador não pode ser rastreada.', 0);
  if (!pedido.texto.trim()) throw new ErroTef('Não há cupom para imprimir.', 0);

  const r = await chamar(cred, '/smarttef/commands/erp/print/create', corpoDaImpressao(cred, pedido), opcoes);
  const d = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  const alvo = (d.data && typeof d.data === 'object' ? d.data : d) as Record<string, unknown>;
  const id = String(alvo.print_identifier ?? alvo.identifier ?? alvo.print_id ?? pedido.printId).trim();

  /*
   * Cai no nosso `printId` quando a resposta não traz identificador — e é
   * seguro porque ele é quem manda: foi ele que criou a impressão, e é por ele
   * que a consulta pergunta.
   */
  return { identificador: id };
}

/** O que a consulta devolve. `impresso` é o que interessa. */
export interface EstadoImpressao {
  status: string;
  impresso: boolean;
  pendente: boolean;
}

/**
 * Se a impressão saiu.
 *
 * A DOCUMENTAÇÃO NÃO LISTA OS STATUS possíveis — só mostra `PDT` no corpo de
 * criação. Então o desenho é conservador: **só é "impresso" o que disser
 * explicitamente que imprimiu**. Qualquer valor desconhecido conta como
 * pendente, e pendente faz o operador conferir o papel.
 *
 * O contrário — presumir impresso no desconhecido — faria o sistema afirmar que
 * o cliente tem cupom quando ninguém sabe.
 */
export function lerEstadoImpressao(corpo: unknown): EstadoImpressao {
  const d = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const alvo = (d.data && typeof d.data === 'object' ? d.data : d) as Record<string, unknown>;
  const status = String(alvo.print_status ?? alvo.status ?? '').trim().toUpperCase();

  const impresso = ['PRT', 'PRINTED', 'CONCLUIDO', 'CONCLUÍDO', 'OK', 'FIN'].includes(status);
  return { status, impresso, pendente: !impresso };
}

export async function consultarImpressao(
  cred: CredenciaisImpressao,
  printIdentifier: string,
  opcoes: OpcoesImpressao = {},
): Promise<EstadoImpressao> {
  const r = await chamar(cred, '/smarttef/pooling/erp/print/get', {
    cnpj: cred.cnpj.replace(/\D/g, '').slice(0, 14),
    print_identifier: printIdentifier,
    ...(cred.storeId !== undefined ? { store_id: cred.storeId } : {}),
  }, opcoes);
  return lerEstadoImpressao(r);
}
