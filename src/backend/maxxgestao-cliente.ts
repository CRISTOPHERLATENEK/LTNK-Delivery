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
import { createHash } from 'crypto';

/** Único servidor da API. Homologação/produção é escolha do ERP, não do host. */
export const BASE_MAXXGESTAO = 'https://api.meuerponline.com.br/publica';

/**
 * O limite é do TOKEN, não do IP: 20 requisições por minuto, fila de 10, e
 * HTTP 429 ao estourar. Dá folga para uma nota por pedido; não dá para
 * sincronizar catálogo em rajada — quem for espelhar produto precisa serializar.
 */
export const LIMITE_POR_MINUTO = 20;

/**
 * ─────────────────── O LIMITE DE REQUISIÇÕES, DE VERDADE ───────────────────
 *
 * A doc deles: 20 requisições por token, reposição de 20 a cada minuto, fila de
 * 10, e HTTP 429 ao estourar. O limite é POR TOKEN — não por IP, não por rota.
 *
 * ISTO NÃO É ZELO EXCESSIVO. Emitir uma nota por pedido cabe folgado nos 20;
 * espelhar catálogo, não. Sem limitador, a primeira sincronização de mercadoria
 * manda tudo de uma vez, toma 429 no meio, e o resultado é catálogo pela metade
 * — metade dos produtos existindo no ERP e metade não, que é pior que nenhum,
 * porque ninguém sabe qual metade.
 *
 * Balde de fichas, e não "uma chamada a cada 3 segundos": o balde deixa as
 * primeiras 20 saírem na hora — o teste de conexão do lojista não pode esperar
 * 3 segundos para dizer "conectado" — e só freia quando a rajada acaba.
 */

/**
 * JANELA DESLIZANTE, não balde de fichas.
 *
 * A primeira versão era um balde que repunha uma ficha a cada 3 segundos, e
 * MEDIDO EM PRODUÇÃO ela estava errada: 20 chamadas saíram em 2 segundos e a
 * 21ª levou 58 segundos. O gateway deles não recusa o excesso — a "fila de 10"
 * da documentação ENFILEIRA a chamada até a janela do minuto virar.
 *
 * Então o modelo real é: no máximo 20 chamadas em qualquer minuto corrido. A
 * 21ª espera a mais antiga das 20 completar um minuto. Respeitar isso mantém as
 * respostas em 60-100ms; desrespeitar joga a chamada na fila deles e ela volta
 * em quase um minuto — e aí qualquer timeout nosso razoável aborta.
 */

/** Os instantes das últimas chamadas de um token, em ms. */
export type JanelaChamadas = number[];

export const JANELA_MS = 60_000;

/** Quanto esperar para a próxima chamada caber na janela. Zero quando cabe. */
export function esperaEmMs(janela: JanelaChamadas, agoraMs: number): number {
  const dentro = janela.filter(t => agoraMs - t < JANELA_MS);
  if (dentro.length < LIMITE_POR_MINUTO) return 0;
  /* A mais antiga define a vez: quando ela sair da janela, abre uma vaga. */
  return Math.max(1, dentro[0] + JANELA_MS - agoraMs);
}

/** A janela com as chamadas velhas descartadas. */
export function limparJanela(janela: JanelaChamadas, agoraMs: number): JanelaChamadas {
  return janela.filter(t => agoraMs - t < JANELA_MS);
}

/*
 * A CHAVE É O HASH DO TOKEN, não o token.
 *
 * O limite é por token, então a conta precisa ser por token — mas guardar o
 * segredo como chave de um Map deixa ele legível em heap dump e em qualquer log
 * que despeje a estrutura. O hash identifica igual e não revela nada.
 */
function chaveDoToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex').slice(0, 16);
}

const janelas = new Map<string, JanelaChamadas>();
/** A fila de cada token: promessas encadeadas, uma chamada por vez. */
const filas = new Map<string, Promise<unknown>>();

/** Só para teste: esquece o que foi contado. */
export function limparLimitesMaxxGestao(): void {
  janelas.clear();
  filas.clear();
}

export interface DepsLimite {
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  /**
   * Teto de espera. Acima dele, `LimiteMaxxGestao` em vez de dormir.
   *
   * Sem teto (o padrão) a espera acontece e a chamada sai — serve para script e
   * job, que podem levar minutos. Dentro de uma rota HTTP tem que haver teto,
   * senão o proxy corta em 60s e ninguém recebe nada.
   */
  esperaMaximaMs?: number;
}

/**
 * Roda `fn` respeitando o limite do token.
 *
 * SERIALIZA POR TOKEN. O que a fila garante é a integridade da conta ATRAVÉS
 * DA ESPERA: quando duas chamadas precisam aguardar a janela virar, sem a fila
 * as duas acordariam juntas e as duas se marcariam na mesma janela, passando de
 * 20. No caminho sem espera a conta já se protege sozinha, porque ler a janela
 * e se marcar nela acontece sem `await` no meio.
 *
 * (Vale registrar: eu havia escrito aqui que sem a fila "todas passam". Sabotei
 * o código removendo a fila e o teste continuou passando — a afirmação era
 * falsa, e o comentário estava vendendo uma proteção que o código não dava
 * naquele caminho.)
 *
 * A fila é por token e não global: uma loja varrendo catálogo não pode atrasar
 * a nota de outra.
 */
export async function comLimiteMaxxGestao<T>(
  token: string,
  fn: () => Promise<T>,
  deps: DepsLimite = {},
): Promise<T> {
  const agora = deps.agora ?? Date.now;
  const dormir = deps.dormir ?? ((ms: number) => new Promise<void>(r => { setTimeout(r, ms); }));
  const chave = chaveDoToken(token);

  const anterior = filas.get(chave) ?? Promise.resolve();
  const minha = anterior.then(async () => {
    let janela = limparJanela(janelas.get(chave) ?? [], agora());
    const espera = esperaEmMs(janela, agora());
    if (espera > 0) {
      const teto = deps.esperaMaximaMs;
      /* Espera maior que o teto não é dormida, é recado: quem chama devolve o
         que fez e volta depois. */
      if (typeof teto === 'number' && espera > teto) throw new LimiteMaxxGestao(espera);
      await dormir(espera);
      janela = limparJanela(janela, agora());
    }
    janela.push(agora());
    janelas.set(chave, janela);
    return fn();
  });

  /*
   * NA FILA VAI A VERSÃO JÁ TRATADA. A falha de uma chamada não pode derrubar
   * as seguintes — cada uma reporta o próprio erro a quem a chamou — e uma
   * promessa rejeitada guardada aqui viraria "unhandled rejection" quando
   * ninguém mais a observasse.
   */
  filas.set(chave, minha.catch(() => {}));
  return minha;
}

export interface OpcoesMaxxGestao {
  /** Injetável para teste. */
  buscar?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  /** Relógio e espera injetáveis — o limitador é testado sem esperar de verdade. */
  limite?: DepsLimite;
  /** Atalho para `limite.esperaMaximaMs`, que é o que uma rota precisa. */
  esperaMaximaMs?: number;
}

export class ErroMaxxGestao extends Error {
  constructor(mensagem: string, readonly httpStatus: number) {
    super(mensagem);
    this.name = 'ErroMaxxGestao';
  }
}

/**
 * "A VEZ SÓ CHEGA DAQUI A UM MINUTO" — e isso não é erro, é agenda.
 *
 * Existe porque ESPERAR DENTRO DE UMA REQUISIÇÃO HTTP NOSSA NÃO FUNCIONA: o
 * proxy corta em 60 segundos e o navegador recebe 504. Aconteceu na importação
 * de catálogo, cujo preâmbulo custa 27 chamadas — as 20 primeiras voam e a 21ª
 * esperaria a janela virar.
 *
 * Então quem chama de dentro de uma rota passa `esperaMaximaMs` e trata isto:
 * devolve o que já fez e diz ao navegador quanto esperar antes de pedir o resto.
 */
export class LimiteMaxxGestao extends Error {
  constructor(readonly esperaMs: number) {
    super(`O Maxx Gestão só aceita a próxima chamada em ${Math.ceil(esperaMs / 1000)}s.`);
    this.name = 'LimiteMaxxGestao';
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

  let resp: Response;
  try {
    /*
     * Toda chamada passa pelo balde, inclusive a leitura do teste de conexão:
     * limite que vale só para algumas rotas não é limite, é sorte.
     *
     * O CRONÔMETRO COMEÇA DENTRO, depois da vez na fila — e isso não é detalhe.
     * Na primeira versão ele começava antes, então a espera do NOSSO limitador
     * contava como demora do servidor deles: a segunda letra de uma varredura
     * morria com "não respondeu" enquanto o ERP estava perfeito. Timeout tem
     * que medir a chamada, nunca a fila.
     */
    resp = await comLimiteMaxxGestao(token, async () => {
      const controlador = new AbortController();
      const timer = setTimeout(() => controlador.abort(), opcoes.timeoutMs ?? 20_000);
      try {
        return await buscar(`${base}${caminho}`, {
          ...init,
          headers: {
            /* NÃO É `Bearer`. O prefixo é `Authentication`, como manda a doc
               deles — com Bearer a resposta é 401 e a mensagem não explica. */
            'Authorization': `Authentication ${token.trim()}`,
            'Content-Type': 'application/json',
            ...(init.headers as Record<string, string> | undefined),
          },
          signal: controlador.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    }, { ...opcoes.limite, esperaMaximaMs: opcoes.esperaMaximaMs ?? opcoes.limite?.esperaMaximaMs });
  } catch (e) {
    /* O recado do limitador passa INTEIRO: virar "não respondeu" faria a rota
       tratar agenda como falha de rede e desistir da importação. */
    if (e instanceof LimiteMaxxGestao) throw e;
    /* Zero em `httpStatus` = INDEFINIDO. Para leitura dá para repetir à
       vontade; para escrita (criar documento) quem chama tem que consultar
       antes de repetir, senão cria dois documentos para o mesmo pedido. */
    throw new ErroMaxxGestao('O Maxx Gestão não respondeu.', 0);
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
