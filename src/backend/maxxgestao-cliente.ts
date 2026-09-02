/**
 * CLIENTE DA API DO MAXX GESTÃO (Meu ERP Online).
 *
 * Terceiro emissor possível da NFC-e, junto do nosso servidor e da maquininha.
 * Aqui o ERP é quem tem o certificado e a numeração: o pedido do delivery vira
 * documento lá, e a nota sai de lá.
 *
 * O QUE TORNA ESTE CAMINHO DIFERENTE dos outros dois: o documento aceita
 * `tefLista` (NSU, bandeira, tipo de cartão) e `pagamentoLista`. É o único dos
 * três em que a nota pode sair com a forma de pagamento REAL, em vez do "todo
 * cartão é crédito" que `tipo-pagamento-nfce.ts` declara por palpite.
 *
 * AUTENTICAÇÃO É TOKEN FIXO, e o prefixo do header não é `Bearer`:
 *
 *     Authorization: Authentication {token}
 *
 * Não existe endpoint que emita o token — ele nasce no painel do ERP. Isso
 * simplifica (nada expira, nada de refresh) e obriga a tratá-lo como senha: é
 * gravado cifrado na linha da loja, igual ao do Mercado Pago.
 */

/** Único servidor da API. Homologação/produção é escolha do ERP, não do host. */
export const BASE_MAXXGESTAO = 'https://api.meuerponline.com.br/publica';

/**
 * O limite é do TOKEN, não do IP: 20 requisições por minuto, fila de 10, e
 * HTTP 429 ao estourar. Dá folga para uma nota por pedido; não dá para
 * sincronizar catálogo em rajada — quem for espelhar produto precisa serializar.
 */
export const LIMITE_POR_MINUTO = 20;

export interface OpcoesMaxxGestao {
  /** Injetável para teste. */
  buscar?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

export class ErroMaxxGestao extends Error {
  constructor(mensagem: string, readonly httpStatus: number) {
    super(mensagem);
    this.name = 'ErroMaxxGestao';
  }
}

/**
 * Uma chamada à API, com o erro já traduzido.
 *
 * `httpStatus` sai no erro porque quem chama decide diferente para cada faixa:
 * 401 é token errado (pergunta para o lojista), 429 é excesso (espera e
 * repete), 5xx é problema deles (repete depois).
 */
export async function chamarMaxxGestao(
  token: string,
  caminho: string,
  opcoes: OpcoesMaxxGestao = {},
  init: RequestInit = {},
): Promise<unknown> {
  const buscar = opcoes.buscar ?? fetch;
  const base = opcoes.baseUrl ?? BASE_MAXXGESTAO;

  if (!token.trim()) throw new ErroMaxxGestao('Token do Maxx Gestão não configurado.', 0);

  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), opcoes.timeoutMs ?? 20_000);

  let resp: Response;
  try {
    resp = await buscar(`${base}${caminho}`, {
      ...init,
      headers: {
        /* NÃO É `Bearer`. O prefixo é `Authentication`, como manda a doc deles —
           com Bearer a resposta é 401 e a mensagem não explica o motivo. */
        'Authorization': `Authentication ${token.trim()}`,
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: controlador.signal,
    });
  } catch {
    /* Zero em `httpStatus` = INDEFINIDO. Para leitura dá para repetir à
       vontade; para escrita (criar documento) quem chama tem que consultar
       antes de repetir, senão cria dois documentos para o mesmo pedido. */
    throw new ErroMaxxGestao('O Maxx Gestão não respondeu.', 0);
  } finally {
    clearTimeout(timer);
  }

  const texto = await resp.text().catch(() => '');
  let corpo: unknown = null;
  try { corpo = texto ? JSON.parse(texto) : null; } catch { corpo = null; }

  if (!resp.ok) {
    const d = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
    const msg = String(d.mensagem ?? d.message ?? d.erro ?? d.title ?? '').trim();
    throw new ErroMaxxGestao(msg || mensagemPorStatus(resp.status), resp.status);
  }
  return corpo;
}

/**
 * Mensagem por status, para a tela não mostrar número cru.
 *
 * O 429 ganha texto próprio porque é o único que passa sozinho: dizer "erro no
 * ERP" faria alguém sair conferindo token quando bastava esperar um minuto.
 */
export function mensagemPorStatus(status: number): string {
  if (status === 401 || status === 403) return 'O Maxx Gestão recusou o token. Confira se ele foi copiado inteiro.';
  if (status === 429) return `Passou do limite de ${LIMITE_POR_MINUTO} requisições por minuto do Maxx Gestão. Tente em um minuto.`;
  if (status >= 500) return 'O Maxx Gestão está com problema no servidor.';
  return `O Maxx Gestão respondeu ${status}.`;
}

/** O que a empresa do token diz sobre si. É a nossa prova de conexão. */
export interface EmpresaMaxxGestao {
  razaoSocial: string;
  fantasia: string;
  cnpjCpf: string;
  uf: string;
  municipio: string;
  /** 1 = Simples Nacional. Decide CSOSN x CST no cadastro de mercadoria. */
  crt: number;
  crtDescricao: string;
}

/**
 * TESTE DE CONEXÃO — `GET /api/empresa/v1`.
 *
 * Escolhido para isso porque é leitura, é barato, e devolve algo que a pessoa
 * RECONHECE: a razão social. Um "ok" verde não prova nada; ver o CNPJ da
 * própria empresa prova que o token é da conta certa — e token da conta errada
 * é o erro que só apareceria na primeira nota emitida no lugar errado.
 */
export async function consultarEmpresa(
  token: string,
  opcoes: OpcoesMaxxGestao = {},
): Promise<EmpresaMaxxGestao> {
  const d = await chamarMaxxGestao(token, '/api/empresa/v1', opcoes) as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') {
    throw new ErroMaxxGestao('O Maxx Gestão respondeu sem os dados da empresa.', 0);
  }
  return {
    razaoSocial: String(d.razaoSocial ?? ''),
    fantasia: String(d.fantasia ?? ''),
    cnpjCpf: String(d.cnpjCpf ?? ''),
    uf: String(d.uf ?? ''),
    municipio: String(d.municipio ?? ''),
    crt: Number(d.crt ?? 0),
    crtDescricao: String(d.crtDescricao ?? ''),
  };
}

/** CNPJ formatado para a tela. Sem isso a pessoa confere 14 dígitos na mão. */
export function formatarCnpj(cru: string): string {
  const d = cru.replace(/\D/g, '');
  if (d.length !== 14) return cru;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
