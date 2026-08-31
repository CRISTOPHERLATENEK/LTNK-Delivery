/**
 * O TOKEN DO SMART TEF É UM JWT GERADO POR NÓS, NÃO UM VALOR COLADO À MÃO.
 *
 * A documentação pública deles diz que o Bearer é "recebido na criação da loja",
 * e por causa disso a primeira versão desta integração pedia ao lojista que
 * colasse um token fixo no painel. Está errado, e quem corrigiu foi o suporte da
 * POS Controle, por escrito: *"você vai usar as credenciais api para gerar o
 * token jwt"*.
 *
 * A diferença não é de estilo. Token colado à mão FUNCIONA no dia em que é
 * colado e falha sozinho depois — e falha no pior lugar possível: na hora de
 * passar o cartão, com o cliente esperando no balcão. Ninguém liga o erro à
 * configuração feita semanas antes.
 *
 * O PRAZO SAI DO PRÓPRIO TOKEN, não da resposta do login. JWT carrega `exp`, e
 * ler dali torna a renovação independente do formato da resposta — que eu não
 * conheço ainda. Se um dia eles mudarem o envelope (`token`, `access_token`,
 * `accessToken`…), a renovação continua certa.
 *
 * O QUE AINDA FALTA: o caminho do endpoint de login. Não está na documentação
 * pública e o suporte ainda não respondeu. Enquanto `CAMINHO_LOGIN` estiver
 * vazio, `tokenTef` RECUSA a chamada com mensagem clara em vez de tentar um
 * palpite — endereço errado nesta API não dá erro legível, dá venda falhada.
 */
import { ErroTef } from './smarttef-cliente';

/**
 * Caminho do login, relativo à base URL.
 *
 * Vazio de propósito: preencher com um palpite seria pior que ficar parado.
 * Quando a POS Controle responder, é só pôr aqui — o resto já está pronto e
 * testado.
 */
export const CAMINHO_LOGIN = '';

/** Margem antes do vencimento. Um token que expira no meio da chamada é o
 *  mesmo que token vencido, e a venda já foi. */
export const MARGEM_SEGUNDOS = 60;

export interface CredenciaisLoginTef {
  baseUrl: string;
  usuario: string;
  senha: string;
}

interface Guardado { token: string; expiraEm: number }

/** Cache por usuário — cada loja tem o seu, e são bancos diferentes. */
const tokens = new Map<string, Guardado>();

/** Para os testes: limpa o cache entre casos. */
export function limparTokensTef(): void {
  tokens.clear();
}

/**
 * O `exp` do JWT, em milissegundos, ou `null` se não der para ler.
 *
 * Não valida assinatura, e não é para validar: quem valida é o servidor deles.
 * Aqui só se lê o prazo, e é por isso que um token estranho não pode explodir —
 * devolve `null`, e quem chama decide o padrão.
 */
export function expiraDoJwt(token: string, agoraMs: number): number | null {
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    const corpo = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    const exp = Number(corpo.exp);
    if (!Number.isFinite(exp) || exp <= 0) return null;
    const ms = exp * 1000;
    /* Prazo no passado é token vencido: não serve, e tratar como válido faria a
       primeira venda falhar sem explicação. */
    return ms > agoraMs ? ms : null;
  } catch {
    return null;
  }
}

/**
 * O token da resposta do login, seja qual for o nome do campo.
 *
 * Aceita os quatro nomes que aparecem nas APIs brasileiras deste tipo porque
 * ainda não vi a resposta real. Quando eu vir, isto pode encolher — mas
 * encolher depois é seguro; adivinhar UM nome agora é falhar na primeira
 * chamada sem saber por quê.
 */
export function tokenDaResposta(corpo: unknown): string {
  const d = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  for (const nome of ['token', 'access_token', 'accessToken', 'jwt']) {
    const v = d[nome];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  /* Alguns devolvem dentro de `data`. */
  const data = (d.data && typeof d.data === 'object' ? d.data : {}) as Record<string, unknown>;
  for (const nome of ['token', 'access_token', 'accessToken', 'jwt']) {
    const v = data[nome];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export interface OpcoesLoginTef {
  buscar?: typeof fetch;
  agoraMs?: number;
  timeoutMs?: number;
  /** Só para teste: sobrescreve o caminho enquanto o real não é conhecido. */
  caminho?: string;
}

/**
 * O JWT válido da loja — do cache, ou recém-gerado.
 *
 * `ttlPadraoSegundos` é usado só quando o token não traz `exp` legível. Curto de
 * propósito: renovar antes da hora custa uma chamada, e usar um token vencido
 * custa uma venda.
 */
export async function tokenTef(
  cred: CredenciaisLoginTef,
  opcoes: OpcoesLoginTef = {},
  ttlPadraoSegundos = 300,
): Promise<string> {
  const caminho = opcoes.caminho ?? CAMINHO_LOGIN;
  if (!caminho) {
    throw new ErroTef(
      'A integração com a maquininha ainda não está completa: falta o endereço de autenticação da API.',
      0,
    );
  }
  if (!cred.baseUrl.trim() || !cred.usuario.trim() || !cred.senha.trim()) {
    throw new ErroTef('Faltam o endereço da API, o usuário ou a senha da maquininha.', 0);
  }

  const agora = opcoes.agoraMs ?? Date.now();
  const guardado = tokens.get(cred.usuario);
  if (guardado && guardado.expiraEm - MARGEM_SEGUNDOS * 1000 > agora) return guardado.token;

  const buscar = opcoes.buscar ?? fetch;
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), opcoes.timeoutMs ?? 15_000);

  let resp: Response;
  try {
    resp = await buscar(`${cred.baseUrl}${caminho}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: cred.usuario, senha: cred.senha }),
      signal: controlador.signal,
    });
  } catch {
    throw new ErroTef('A API da maquininha não respondeu à autenticação.', 0);
  } finally {
    clearTimeout(timer);
  }

  const texto = await resp.text().catch(() => '');
  let corpo: unknown = null;
  try { corpo = JSON.parse(texto); } catch { corpo = null; }

  if (!resp.ok) {
    /*
     * 401 tem mensagem PRÓPRIA. "Falhou ao autenticar" faria o lojista procurar
     * rede, endereço, firewall — quando o que aconteceu foi senha errada, que
     * ele resolve sozinho em dez segundos.
     */
    throw new ErroTef(
      resp.status === 401 || resp.status === 403
        ? 'A API da maquininha recusou o usuário e a senha.'
        : `A autenticação da maquininha respondeu ${resp.status}.`,
      resp.status,
    );
  }

  const token = tokenDaResposta(corpo);
  if (!token) throw new ErroTef('A autenticação da maquininha não devolveu token.', 0);

  const expira = expiraDoJwt(token, agora) ?? agora + ttlPadraoSegundos * 1000;
  tokens.set(cred.usuario, { token, expiraEm: expira });
  return token;
}
