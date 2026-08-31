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
