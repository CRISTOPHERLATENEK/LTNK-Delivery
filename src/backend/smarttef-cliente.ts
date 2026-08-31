/**
 * CLIENTE HTTP DO SMART TEF.
 *
 * Fina de propósito: monta a requisição, aplica timeout, e devolve o corpo já
 * traduzido por `smarttef-protocolo`. Tudo que decide alguma coisa mora lá,
 * onde dá para testar sem rede.
 *
 * O `fetch` é INJETÁVEL (`opcoes.buscar`). Não é preciosismo de teste: é o que
 * permite provar o comportamento em recusa, timeout e resposta malformada sem
 * depender de uma maquininha ligada em algum lugar. Esses três são o caminho
 * comum, não a exceção.
 *
 * NADA AQUI ESCREVE TOKEN EM LOG. As mensagens de erro carregam o caminho e o
 * código HTTP, nunca os headers — log de servidor é lido por muita gente, e
 * quem tem o token cobra na maquininha de alguém.
 */
import { tokenTef } from './smarttef-auth';
import {
  lerTransacao, mensagemDeErro, valorParaApi,
  type DadosTransacao,
} from './smarttef-protocolo';

export interface CredenciaisCliente {
  baseUrl: string;
  /*
   * USUÁRIO E SENHA, NÃO TOKEN PRONTO.
   *
   * O Bearer é um JWT gerado a partir destes dois e tem validade — quem
   * confirmou foi o suporte da POS Controle. Se este tipo aceitasse um token
   * pronto, alguém guardaria um no banco e a venda falharia no dia em que ele
   * vencesse. Aqui o cliente pede o token a `tokenTef`, que cuida do cache e da
   * renovação.
   */
  usuario: string;
  senha: string;
  gatewayToken: string;
}

export interface OpcoesCliente {
  /** Substitui o `fetch` global — usado pelos testes. */
  buscar?: typeof fetch;
  /**
   * Caminho do login, enquanto o real não é conhecido.
   *
   * Ver `smarttef-auth`: `CAMINHO_LOGIN` nasce vazio, e sem ele a chamada é
   * recusada com mensagem clara em vez de tentar um palpite de URL.
   */
  caminhoLogin?: string;
  /**
   * Teto de espera por requisição.
   *
   * 20 segundos é o compromisso: a maquininha demora porque depende de uma
   * pessoa passar o cartão, mas quem espera aqui é uma requisição do PDV com o
   * cliente no balcão. Passar disso não é "ainda vai responder", é travar a
   * tela — e a criação da ordem já retorna antes do pagamento acontecer.
   */
  timeoutMs?: number;
}

/** Erro de comunicação ou de regra da API, já com mensagem para o operador. */
export class ErroTef extends Error {
  constructor(
    mensagem: string,
    readonly httpStatus: number,
    /*
     * `indefinido` marca o caso perigoso: a requisição saiu e não sabemos se
     * chegou (timeout, rede caiu). Quem chama NÃO pode tratar como falha e
     * refazer — a cobrança pode ter sido criada, e uma segunda criaria duas.
     * Tem que consultar antes.
     */
    readonly indefinido = false,
  ) {
    super(mensagem);
    this.name = 'ErroTef';
  }
}

async function chamar(
  cred: CredenciaisCliente,
  caminho: string,
  corpo: Record<string, unknown>,
  opcoes: OpcoesCliente = {},
): Promise<unknown> {
  const buscar = opcoes.buscar ?? fetch;

  /*
   * O TOKEN VEM ANTES DA CHAMADA, e de propósito não é cacheado aqui: quem
   * guarda é `tokenTef`, com o prazo lido do próprio JWT. Duas caches do mesmo
   * token seria a receita para uma delas ficar velha.
   */
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
     * Aqui a requisição pode ter chegado. Abort e falha de rede são
     * indistinguíveis de fora: o servidor pode ter processado e a resposta se
     * perdido no caminho. Por isso `indefinido: true`.
     */
    throw new ErroTef('A maquininha não respondeu a tempo.', 0, true);
  } finally {
    clearTimeout(timer);
  }

  /* Corpo ilegível não invalida o código HTTP: um 401 com HTML de proxy no meio
     continua sendo 401, e a mensagem certa é a do 401. */
  let json: unknown = null;
  try { json = await resp.json(); } catch { json = null; }

  if (!resp.ok) throw new ErroTef(mensagemDeErro(json, resp.status), resp.status);
  return json;
}

export interface OrdemCriada {
  /** Identificador da cobrança na API — vai para `pedidos.pagamento_gateway_id`. */
  identificador: string;
}

/**
 * Cria a cobrança na maquininha.
 *
 * `chargeId` é NOSSO identificador e é o que dá idempotência: a API responde
 * 409 em duplicidade funcional. Mandar o id do pedido significa que uma
 * repetição por rede oscilando esbarra no 409 em vez de criar uma segunda
 * cobrança — o mesmo problema que a idempotência do `POST /balcao` resolve na
 * criação da venda, agora na cobrança.
 *
 * ESTA FUNÇÃO NÃO TEM RETRY, de propósito. Repetir uma criação de cobrança sem
 * saber se a primeira chegou é como o cliente é cobrado duas vezes; quem chama
 * deve consultar por `chargeId` antes de tentar de novo.
 */
export async function criarOrdemPagamento(
  cred: CredenciaisCliente,
  dados: {
    valorCentavos: number;
    /** Vazio deixa o operador escolher a forma no POS (`OTHERS` na API). */
    tipo?: 'CREDIT' | 'DEBIT' | 'PIX' | 'VOUCHER' | '';
    parcelas?: number;
    chargeId: string;
    /** Vazio = cai na lista geral e qualquer POS da loja pega. */
    serialPos?: string;
  },
  opcoes?: OpcoesCliente,
): Promise<OrdemCriada> {
  const corpo: Record<string, unknown> = {
    value: valorParaApi(dados.valorCentavos),
    payment_type: dados.tipo || 'OTHERS',
    charge_id: dados.chargeId,
  };

  /*
   * `installments` é obrigatório em CREDIT e só faz sentido nele. Mandar em
   * débito é campo inválido; omitir em crédito é 400 na frente do cliente.
   */
  if (dados.tipo === 'CREDIT') corpo.installments = Math.max(1, Math.trunc(dados.parcelas || 1));

  /*
   * `order_type` acompanha o serial e não pode divergir dele: CRD_UNICO sem
   * destino não tem para onde ir, e NRM com serial ignora o destino. A doc
   * ainda proíbe mandar `user_id` junto com `serial_pos` — por isso só um dos
   * dois existe aqui.
   */
  const serial = (dados.serialPos || '').trim();
  if (serial) {
    corpo.order_type = 'CRD_UNICO';
    corpo.serial_pos = serial;
  } else {
    corpo.order_type = 'NRM';
  }

  const r = await chamar(cred, '/smarttef/commands/erp/order/create', corpo, opcoes);
  const d = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  const alvo = (d.data && typeof d.data === 'object' ? d.data : d) as Record<string, unknown>;
  const id = String(alvo.payment_identifier ?? alvo.identifier ?? alvo.id ?? '').trim();

  /*
   * SEM IDENTIFICADOR NÃO DÁ PARA CONTINUAR — e o erro precisa ser barulhento.
   *
   * Ele é a única forma de consultar, cancelar ou estornar depois. Uma cobrança
   * criada e sem id é uma cobrança que existe na maquininha e some do nosso
   * lado: ninguém procura o que não sabe que existe. `indefinido` porque é
   * exatamente esse o estado.
   */
  if (!id) throw new ErroTef('A maquininha aceitou a cobrança mas não devolveu o identificador.', 0, true);
  return { identificador: id };
}

/** Consulta o estado atual da cobrança. É a fonte da verdade — inclusive sobre o webhook. */
export async function consultarOrdem(
  cred: CredenciaisCliente,
  identificador: string,
  opcoes?: OpcoesCliente,
): Promise<DadosTransacao> {
  const r = await chamar(cred, '/smarttef/pooling/erp/order/get', { payment_identifier: identificador }, opcoes);
  return lerTransacao(r);
}

/** Cancela uma cobrança que ainda não foi paga (operador desistiu, cliente foi embora). */
export async function cancelarOrdem(
  cred: CredenciaisCliente,
  identificador: string,
  opcoes?: OpcoesCliente,
): Promise<void> {
  await chamar(cred, '/smarttef/commands/erp/order/status/cancelar', { payment_identifier: identificador }, opcoes);
}

/** Solicita estorno de uma cobrança JÁ CONCLUÍDA. Assíncrono: resolve em SOL_EST → PROC_EST → EST. */
export async function estornarOrdem(
  cred: CredenciaisCliente,
  identificador: string,
  opcoes?: OpcoesCliente,
): Promise<void> {
  await chamar(cred, '/smarttef/commands/erp/order/status/estornar', { payment_identifier: identificador }, opcoes);
}

/** Registra a URL que receberá as mudanças de status desta loja. */
export async function configurarWebhook(
  cred: CredenciaisCliente,
  dados: { url: string; tokenAutorizacao: string },
  opcoes?: OpcoesCliente,
): Promise<void> {
  await chamar(cred, '/smarttef/manager/erp/store/update', {
    webhookUrl: {
      url: dados.url,
      /* A API manda este valor de volta no header `Authorization` do callback.
         É o que nos deixa recusar um POST que não veio dela. */
      authorization_token: dados.tokenAutorizacao,
    },
  }, opcoes);
}
