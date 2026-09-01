/**
 * CLIENTE DA API DO PDV MOBI (POS Controle) — `https://api.poscontrole.com.br`.
 *
 * OUTRA API, NÃO O SMART TEF. O suporte foi explícito: *"são diferentes sim"*.
 * O Smart TEF cobra no cartão e imprime arquivo; este aqui cadastra catálogo e
 * consulta vendas, e é ele que tem os campos fiscais — `NFCeNCM`, `NFCeCFOP`,
 * `NFCeCST`, e até os novos `NFCeIBS_*` da reforma. Confundir os dois foi o que
 * me fez integrar o Smart TEF acreditando que ele emitiria nota; não emite.
 *
 * O QUE ESTA API FAZ, pela coleção Postman oficial:
 *
 *     POST /v2/auth/token       usuário e senha → JWT de 1 hora
 *     POST /v2/products         cadastra produto COM tributação
 *     GET  /v2/products         lista
 *     POST /v2/productgroups    cadastra grupo
 *     GET  /v2/sales            consulta vendas por intervalo
 *
 * O QUE ELA NÃO FAZ: não existe `POST /v2/sales`. Não há como MANDAR uma venda
 * para o aparelho, e não há endpoint de emissão de NFC-e. Quem emite é o PDV
 * dele, a partir do produto cadastrado — ou o nosso sistema, para as vendas que
 * acontecem aqui.
 *
 * SÓ LEITURA NESTE PRIMEIRO CORTE. `POST /v2/products` escreve no cadastro de
 * um sistema em produção; ler venda não estraga nada. Mesma ordem que funcionou
 * no iFood, e pelo mesmo motivo: quando a escrita chegar, ela vai encontrar o
 * caminho de leitura já provado.
 */
import { expiraDoJwt } from './jwt-prazo';

export const BASE_PDVMOBI = 'https://api.poscontrole.com.br';

/** Margem antes do vencimento: token que expira no meio da chamada é token vencido. */
export const MARGEM_SEGUNDOS = 60;

export class ErroPdvMobi extends Error {
  constructor(mensagem: string, readonly httpStatus: number) {
    super(mensagem);
    this.name = 'ErroPdvMobi';
  }
}

export interface CredenciaisPdvMobi {
  /** Usuário das Credenciais API, do portal (`cnpj.loja.pdv.mobi`). */
  usuario: string;
  senha: string;
  /** Chave Primária OCP — vai no header `Ocp-Apim-Subscription-Key`. */
  chaveOcp: string;
}

export interface OpcoesPdvMobi {
  buscar?: typeof fetch;
  baseUrl?: string;
  agoraMs?: number;
  timeoutMs?: number;
}

interface Guardado { token: string; expiraEm: number }
const tokens = new Map<string, Guardado>();

export function limparTokensPdvMobi(): void {
  tokens.clear();
}

/**
 * O JWT da loja — do cache, ou recém-gerado.
 *
 * O CORPO É `x-www-form-urlencoded` COM `username`/`password`, não JSON. Está na
 * coleção oficial, e eu havia escrito JSON com `usuario`/`senha` por suposição
 * antes de ler — exatamente o tipo de erro que a coleção existe para evitar.
 *
 * A resposta é `{ "jwt": "..." }`. A documentação diz "válido por 1 hora"; o
 * prazo é lido do próprio token de qualquer forma, porque uma frase de
 * documentação não avisa quando muda.
 */
export async function tokenPdvMobi(
  cred: CredenciaisPdvMobi,
  opcoes: OpcoesPdvMobi = {},
): Promise<string> {
  if (!cred.usuario.trim() || !cred.senha.trim() || !cred.chaveOcp.trim()) {
    throw new ErroPdvMobi('Faltam o usuário, a senha ou a chave OCP do PDV MOBI.', 0);
  }

  const agora = opcoes.agoraMs ?? Date.now();
  /* Cache por usuário: cada loja tem o seu. Chave única faria a loja B usar o
     token da loja A e ler as vendas de outra pessoa. */
  const guardado = tokens.get(cred.usuario);
  if (guardado && guardado.expiraEm - MARGEM_SEGUNDOS * 1000 > agora) return guardado.token;

  const buscar = opcoes.buscar ?? fetch;
  const base = opcoes.baseUrl ?? BASE_PDVMOBI;
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), opcoes.timeoutMs ?? 15_000);

  let resp: Response;
  try {
    resp = await buscar(`${base}/v2/auth/token`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': cred.chaveOcp,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ username: cred.usuario, password: cred.senha }).toString(),
      signal: controlador.signal,
    });
  } catch {
    throw new ErroPdvMobi('O PDV MOBI não respondeu à autenticação.', 0);
  } finally {
    clearTimeout(timer);
  }

  const texto = await resp.text().catch(() => '');
  let corpo: Record<string, unknown> = {};
  try { corpo = JSON.parse(texto) as Record<string, unknown>; } catch { /* segue com o status */ }

  if (!resp.ok) {
    /* 401/403 tem mensagem própria: senha errada se resolve em dez segundos, e
       "falhou ao autenticar" manda procurar rede e firewall. */
    throw new ErroPdvMobi(
      resp.status === 401 || resp.status === 403
        ? 'O PDV MOBI recusou o usuário, a senha ou a chave OCP.'
        : `A autenticação do PDV MOBI respondeu ${resp.status}.`,
      resp.status,
    );
  }

  const token = String(corpo.jwt ?? '').trim();
  if (!token) throw new ErroPdvMobi('O PDV MOBI autenticou mas não devolveu o jwt.', 0);

  /* Sem `exp` legível, 50 minutos — abaixo da hora que a documentação promete,
     para renovar antes e não depois. */
  const expira = expiraDoJwt(token, agora) ?? agora + 50 * 60_000;
  tokens.set(cred.usuario, { token, expiraEm: expira });
  return token;
}

async function chamar(
  cred: CredenciaisPdvMobi,
  caminho: string,
  opcoes: OpcoesPdvMobi,
): Promise<unknown> {
  const buscar = opcoes.buscar ?? fetch;
  const base = opcoes.baseUrl ?? BASE_PDVMOBI;
  const token = await tokenPdvMobi(cred, opcoes);

  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), opcoes.timeoutMs ?? 20_000);

  let resp: Response;
  try {
    resp = await buscar(`${base}${caminho}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Ocp-Apim-Subscription-Key': cred.chaveOcp,
      },
      signal: controlador.signal,
    });
  } catch {
    throw new ErroPdvMobi('O PDV MOBI não respondeu.', 0);
  } finally {
    clearTimeout(timer);
  }

  const texto = await resp.text().catch(() => '');
  let corpo: unknown = null;
  try { corpo = JSON.parse(texto); } catch { corpo = null; }

  if (!resp.ok) {
    const d = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
    const msg = String(d.message ?? d.error ?? '').trim();
    throw new ErroPdvMobi(msg || `O PDV MOBI respondeu ${resp.status}.`, resp.status);
  }
  return corpo;
}

/**
 * O formato de data que esta API exige: `YYYY-MM-DD HH:MM:SS`, com ESPAÇO.
 *
 * Não é ISO — não tem `T` e não tem fuso. E é aí que mora a armadilha: sem fuso
 * declarado, o servidor entende no fuso DELE. Formatar em UTC deslocaria o dia
 * em três horas e faria a consulta de "hoje" perder as vendas da noite e repetir
 * as da madrugada seguinte.
 *
 * Por isso recebe os componentes já no fuso certo, em vez de um `Date` — quem
 * chama resolve o fuso, e a função não finge saber qual é.
 */
export function momentoParaConsulta(
  ano: number, mes: number, dia: number,
  hora = 0, minuto = 0, segundo = 0,
): string {
  const p = (n: number, casas = 2) => String(n).padStart(casas, '0');
  return `${p(ano, 4)}-${p(mes)}-${p(dia)} ${p(hora)}:${p(minuto)}:${p(segundo)}`;
}

/**
 * As vendas de um intervalo, CRUAS.
 *
 * Devolve o corpo como veio, de propósito. A documentação descreve a resposta
 * com "typically include" e campos genéricos (`id`, `amount`, `timestamp`,
 * `customer`) — isso é a documentação SUPONDO, não um payload real. Traduzir a
 * partir dessa descrição repetiria o erro que a integração do iFood pagou nove
 * vezes. A tradução vem depois de ver uma resposta de verdade.
 */
export async function listarVendas(
  cred: CredenciaisPdvMobi,
  inicio: string,
  fim: string,
  opcoes: OpcoesPdvMobi = {},
): Promise<unknown> {
  const q = new URLSearchParams({ datetimeini: inicio, datetimeend: fim });
  return chamar(cred, `/v2/sales?${q.toString()}`, opcoes);
}

/** Os produtos cadastrados lá, crus — mesmo motivo. */
export async function listarProdutos(
  cred: CredenciaisPdvMobi,
  opcoes: OpcoesPdvMobi = {},
): Promise<unknown> {
  return chamar(cred, '/v2/products', opcoes);
}

/**
 * AS FORMAS DE PAGAMENTO DA LOJA — `GET /v2/paymenttypes`.
 *
 * NÃO ESTÁ NA COLEÇÃO POSTMAN. Achei por analogia com `/v2/statustypes`,
 * `/v2/producttypes` e `/v2/unittypes`, e confirmei com 200 e corpo real; os
 * caminhos vizinhos que inventei (`/v2/paymenttype`, `/v2/payments`,
 * `/v2/saletypes`) deram 404, então o 200 aqui não é acidente de rota curinga.
 *
 * O QUE ELA RESOLVE: `IDPagamento` do `newItem` é um **GUID**, não um número
 * pequeno. Mandar `'99'` (o `tPag` da nota, que é outra coisa) fez a preconta
 * sair daqui com 200 e nunca aparecer no aparelho — pedido 97.
 */
export interface FormaPagamentoPos { id: string; nome: string }

export async function listarFormasDePagamento(
  cred: CredenciaisPdvMobi,
  opcoes: OpcoesPdvMobi = {},
): Promise<FormaPagamentoPos[]> {
  const bruto = await chamar(cred, '/v2/paymenttypes', opcoes) as
    { PaymentTypes?: { PaymentTypeID?: string; Name?: string }[] } | null;
  return (bruto?.PaymentTypes ?? [])
    .map(f => ({ id: String(f.PaymentTypeID ?? ''), nome: String(f.Name ?? '') }))
    .filter(f => f.id && f.nome);
}

/**
 * Acha a forma pelo NOME, sem diferenciar maiúscula nem acento.
 *
 * Pelo nome e não pelo GUID fixo porque a lista veio das credenciais de UMA
 * loja: não tenho como afirmar que o mesmo GUID vale para outro cliente da POS
 * Controle, e um GUID errado não dá erro — dá preconta que não chega, ou seja,
 * venda sem nota.
 */
export function acharForma(formas: FormaPagamentoPos[], nome: string): string {
  const limpo = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  return formas.find(f => limpo(f.nome) === limpo(nome))?.id ?? '';
}

/**
 * As tabelas de domínio: tipos de produto, unidades e status.
 *
 * Existem porque `POST /v2/products` exige `ProductTypeID`, `UnitTypeID` e
 * `StatusID` — GUIDs, não texto. Sem ler estas listas, cadastrar produto é
 * chutar UUID, e a coleção Postman traz valores de exemplo que valem para a
 * conta de quem a escreveu, não para a sua.
 */
export async function listarTiposDeProduto(cred: CredenciaisPdvMobi, opcoes: OpcoesPdvMobi = {}): Promise<unknown> {
  return chamar(cred, '/v2/producttypes', opcoes);
}
export async function listarUnidades(cred: CredenciaisPdvMobi, opcoes: OpcoesPdvMobi = {}): Promise<unknown> {
  return chamar(cred, '/v2/unittypes', opcoes);
}
export async function listarStatus(cred: CredenciaisPdvMobi, opcoes: OpcoesPdvMobi = {}): Promise<unknown> {
  return chamar(cred, '/v2/statustypes', opcoes);
}

/**
 * MANDAR A COBRANÇA PARA A MAQUININHA — `POST /v3/smart-tef/newItem`.
 *
 * Este é o endpoint que estava faltando, e ele desmente uma conclusão minha:
 * eu havia sondado `POST /v2/sales`, `/v2/sale` e `/v2/orders`, recebido 404 nos
 * três, e concluído que a API não recebia venda. A conclusão valia para o `/v2`;
 * generalizar para a API inteira foi apressado — o caminho real é `/v3`, num
 * grupo (`smart-tef`) que não aparece na coleção Postman.
 *
 * O ACHADO BOM É O HOST. É `api.poscontrole.com.br`, o mesmo do PDV MOBI, com a
 * MESMA autenticação (JWT + chave OCP) que já funciona. Ou seja: não depende do
 * portal Smart TEF, nem de Bearer emitido por integrador, nem de host de
 * produção separado. As duas coisas que travaram o dia inteiro deixaram de
 * travar.
 *
 * O QUE ELE MANDA É COBRANÇA, NÃO VENDA ITEMIZADA: `Amount`, `IDPagamento`,
 * `QTParcelas`. Continua não existindo campo de item nem de NFC-e — quem emite
 * a nota segue sendo o nosso sistema.
 *
 * `Amount` VAI COMO STRING, com ponto decimal, e é assim no exemplo oficial
 * ("0.10"). Mandar número arriscaria o serializador imprimir `0.1` — e valor com
 * uma casa decimal num campo de dinheiro é o tipo de coisa que a maquininha
 * aceita e o conferente descobre no fim do mês.
 */
export interface CobrancaPos {
  /** Nosso identificador da cobrança — numérico neste endpoint. */
  idCobranca: number;
  valorCentavos: number;
  /** Forma de pagamento no PDV MOBI. `'1'` no exemplo oficial. */
  idPagamento?: string;
  parcelas?: number;
  /** Vazio = qualquer aparelho da loja pega. */
  serialPos?: string;
  cpf?: string;
  nome?: string;
}

/**
 * Centavos → o texto que o campo `Amount` espera.
 *
 * Duas casas SEMPRE. `(10/100).toFixed(2)` dá "0.10"; `String(10/100)` daria
 * "0.1". O primeiro é o do exemplo oficial.
 */
export function valorParaAmount(centavos: number): string {
  if (!Number.isFinite(centavos) || centavos <= 0) {
    throw new ErroPdvMobi('Valor inválido para cobrança na maquininha.', 0);
  }
  return (Math.round(centavos) / 100).toFixed(2);
}

/** O corpo do `newItem`, no formato exato do exemplo oficial. */
export function corpoDaCobranca(c: CobrancaPos): Record<string, unknown> {
  const extras: Record<string, string> = {};
  /* `Extras` só leva o que existe: mandar CPF vazio é declarar consumidor
     identificado sem identificar ninguém. */
  if (c.cpf?.trim()) extras.CPF = c.cpf.replace(/\D/g, '');
  if (c.nome?.trim()) extras.Nome = c.nome.trim();

  return {
    NumSerialPOS: c.serialPos?.trim() ?? '',
    IDCobranca: c.idCobranca,
    IDPagamento: c.idPagamento ?? '1',
    /* Parcelas como texto, e nunca zero: "0 vezes" não existe em cartão. */
    QTParcelas: String(Math.max(1, c.parcelas ?? 1)),
    Extras: extras,
    Amount: valorParaAmount(c.valorCentavos),
  };
}

/**
 * Cria a cobrança na fila do aparelho.
 *
 * NÃO COBRA NINGUÉM SOZINHO: o que isto faz é a maquininha mostrar um card com
 * o valor. Sem alguém passar o cartão, nada acontece. Ainda assim é escrita em
 * sistema de produção — e como o Smart TEF não tem homologação, todo teste é
 * real. Valor mínimo e cancelamento em seguida.
 *
 * A resposta ainda não foi vista. Devolve o corpo cru, como as consultas: o
 * exemplo oficial mostra só a REQUISIÇÃO, e inventar o formato da resposta é o
 * erro que este arquivo já registrou uma vez.
 */
export async function enviarCobrancaPos(
  cred: CredenciaisPdvMobi,
  cobranca: CobrancaPos,
  opcoes: OpcoesPdvMobi = {},
): Promise<unknown> {
  const buscar = opcoes.buscar ?? fetch;
  const base = opcoes.baseUrl ?? BASE_PDVMOBI;
  const token = await tokenPdvMobi(cred, opcoes);

  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), opcoes.timeoutMs ?? 20_000);

  let resp: Response;
  try {
    resp = await buscar(`${base}/v3/smart-tef/newItem`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Ocp-Apim-Subscription-Key': cred.chaveOcp,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corpoDaCobranca(cobranca)),
      signal: controlador.signal,
    });
  } catch {
    /*
     * INDEFINIDO, e aqui o cuidado é maior que nas leituras: a requisição pode
     * ter chegado e a cobrança existir no aparelho. Mandar de novo criaria duas
     * cobranças para a mesma venda — por isso o `IDCobranca` tem que ser o do
     * pedido, estável, e não um contador novo a cada tentativa.
     */
    throw new ErroPdvMobi('A maquininha não respondeu. A cobrança pode ter sido criada — consulte antes de repetir.', 0);
  } finally {
    clearTimeout(timer);
  }

  const texto = await resp.text().catch(() => '');
  let corpo: unknown = null;
  try { corpo = JSON.parse(texto); } catch { corpo = null; }

  if (!resp.ok) {
    const d = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
    const msg = String(d.message ?? d.Message ?? d.error ?? '').trim();
    throw new ErroPdvMobi(msg || `A cobrança na maquininha respondeu ${resp.status}.`, resp.status);
  }
  return corpo;
}
