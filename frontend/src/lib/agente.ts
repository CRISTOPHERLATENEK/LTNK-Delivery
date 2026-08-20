/**
 * Cliente do NOSSO Agente de Impressão (substitui o QZ Tray).
 *
 * O agente roda no PC do caixa em http://localhost:9110 e imprime direto na
 * térmica (ESC/POS). Aqui só falamos HTTP com ele. A impressora escolhida fica
 * no localStorage (é específica de cada PC). Se o agente não estiver rodando,
 * o chamador cai no QZ Tray ou no diálogo do navegador.
 */

export type BlocoImpressao =
  | { t: 'titulo'; txt: string }
  | { t: 'center'; txt: string; b?: boolean }
  | { t: 'endereco'; txt: string } // linha do endereço do emitente (DANFE) — pode ser ocultada no editor do cupom fiscal
  | { t: 'texto'; txt: string }
  | { t: 'lr'; l: string; r: string; b?: boolean }
  | { t: 'linha' }
  | { t: 'qr'; data: string }
  | { t: 'pular'; n?: number }
  | { t: 'corte' };

const BASE = 'http://localhost:9110';
const CHAVE = 'agente_impressora';

/**
 * Tela do cupom fiscal (rodapé, QR, fonte) — abre no navegador padrão.
 *
 * Aponta pro `#cupom` da tela única do agente. Antes existia uma página
 * separada em /editor, que editava o MESMO arquivo com uma prévia diferente —
 * o lojista via uma forma ali, outra na janela e uma terceira no papel. A
 * página saiu e /editor virou redirecionamento, então agente antigo já
 * instalado continua atendendo este link.
 */
export const URL_EDITOR_FISCAL = `${BASE}/#cupom`;

/**
 * Versão mais recente do Software de Impressão e onde baixar o instalador.
 * Atualize os dois juntos a cada `npm run dist` no agente-impressao — o
 * instalador é publicado como asset de uma GitHub Release (não fica
 * versionado no repo, o .exe passa de 90MB).
 */
export const VERSAO_INSTALADOR = '1.2.0';
export const URL_INSTALADOR =
  'https://github.com/CRISTOPHERLATENEK/LTNK-Delivery/releases/download/agente-impressao-v1.2.0/AgenteImpressao-Instalador.exe';

/** Heurística p/ reconhecer impressora térmica pelo nome. */
const RE_TERMICA = /elgin|bematech|epson|daruma|sweda|tanca|pos\b|term|58mm|80mm|i[789]\b/i;

export function impressoraAgente(): string {
  try { return localStorage.getItem(CHAVE) || ''; } catch { return ''; }
}
export function definirImpressoraAgente(nome: string): void {
  try { localStorage.setItem(CHAVE, nome); } catch { /* ignore */ }
}

const PREFIXO_SETOR = 'agente_impressora_setor_';

/** Impressora vinculada a um setor (Cozinha, Bar...) NESTE PC. Vazio = usa a padrão. */
export function impressoraSetor(setorId: number): string {
  try { return localStorage.getItem(PREFIXO_SETOR + setorId) || ''; } catch { return ''; }
}
export function definirImpressoraSetor(setorId: number, nome: string): void {
  try {
    if (nome) localStorage.setItem(PREFIXO_SETOR + setorId, nome);
    else localStorage.removeItem(PREFIXO_SETOR + setorId);
  } catch { /* ignore */ }
}

/**
 * Impressora a usar pelo agente: a salva no localStorage, OU — se nenhuma foi
 * escolhida ainda mas o agente está rodando — auto-seleciona a térmica (e salva).
 * Retorna null se o agente não estiver ativo. Assim a impressão pelo agente
 * funciona mesmo que o lojista nunca tenha entrado na tela de configuração.
 *
 * A CHECAGEM DE STATUS VEM PRIMEIRO, INCLUSIVE COM IMPRESSORA SALVA. Antes a
 * impressora salva era devolvida sem checar nada, então com o agente fechado cada
 * documento fazia um POST /imprimir condenado, esperava a conexão ser recusada, e
 * só então caía no diálogo do navegador. Numa venda que imprime cupom + comanda
 * por setor isso eram várias tentativas mortas em fila, uma atrasando a próxima —
 * e o operador esperando por elas.
 */
export async function impressoraAgentePreferida(): Promise<string | null> {
  if (!(await agenteAtivo())) return null;
  const salva = impressoraAgente();
  if (salva) return salva;
  try {
    const lista = await listarImpressorasAgente();
    const escolha = lista.find(n => RE_TERMICA.test(n)) || lista[0];
    if (escolha) { definirImpressoraAgente(escolha); return escolha; }
  } catch { /* ignore */ }
  return null;
}

/**
 * Último resultado de `/status`, válido por alguns segundos.
 *
 * POR QUE CACHEAR: uma venda dispara vários documentos quase juntos (cupom da
 * venda + uma comanda por setor de produção). Sem cache, cada um repete o
 * `/status` — e com o agente fechado são N falhas de conexão em vez de uma, cada
 * uma custando o tempo do timeout. O TTL é curto de propósito: o lojista abre o
 * agente e imprime de novo em segundos, e uma janela grande faria o sistema
 * insistir que ele continua fechado.
 */
let statusMemo: { quando: number; ativo: boolean } | null = null;
const TTL_STATUS_MS = 5_000;

/** true se o agente está rodando (responde ao /status rápido). */
export async function agenteAtivo(): Promise<boolean> {
  const agora = Date.now();
  if (statusMemo && agora - statusMemo.quando < TTL_STATUS_MS) return statusMemo.ativo;
  const ativo = (await statusAgente()) !== null;
  statusMemo = { quando: Date.now(), ativo };
  return ativo;
}

/**
 * Esquece o status cacheado. A tela de configuração da impressora chama isto
 * antes de testar, senão o botão "Testar" responderia com um resultado de até 5s
 * atrás — justamente quando o lojista acabou de abrir o agente pra conferir.
 */
export function esquecerStatusAgente(): void {
  statusMemo = null;
}

/** Versão do Software de Impressão rodando neste PC, ou null se não estiver ativo. */
export async function statusAgente(): Promise<{ versao: string } | null> {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 1200);
    const r = await fetch(`${BASE}/status`, { signal: c.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return { versao: String(j.versao || '') };
  } catch { return null; }
}

/** Lista as impressoras que o agente enxerga no PC. */
export async function listarImpressorasAgente(): Promise<string[]> {
  const r = await fetch(`${BASE}/impressoras`);
  if (!r.ok) throw new Error('Agente não respondeu.');
  const j = await r.json();
  return Array.isArray(j.impressoras) ? j.impressoras : [];
}

export interface ConfigFiscal {
  cabecalho: string;
  rodape: string;
  mostrarQr: boolean;
  mostrarEndereco: boolean;
  fonteGrande: boolean;
}

/**
 * Config do cupom fiscal salva no /editor deste agente (cabeçalho, rodapé,
 * mostrar QR/endereço, fonte). Usada tanto pra impressão ESC/POS quanto pro
 * PDF/preview em HTML, pra não divergirem. Retorna null se o agente não
 * estiver rodando (nesse caso o HTML sai no layout padrão, sem personalização).
 */
export async function buscarConfigFiscal(): Promise<ConfigFiscal | null> {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 1200);
    const r = await fetch(`${BASE}/config`, { signal: c.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * Imprime os blocos direto na térmica pelo agente. Lança se falhar.
 * `ehFiscal=true` (DANFE/NFC-e) faz o agente aplicar a personalização salva
 * no editor (rodapé extra, mostrar/ocultar QR, fonte maior) — ver /editor.
 */
export async function imprimirViaAgente(
  blocos: BlocoImpressao[], larguraMm: number, impressora?: string, ehFiscal?: boolean,
): Promise<void> {
  const nome = impressora || impressoraAgente();
  if (!nome) throw new Error('Nenhuma impressora do agente configurada.');
  const r = await fetch(`${BASE}/imprimir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ impressora: nome, largura: larguraMm, blocos, ehFiscal: !!ehFiscal }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.erro || 'Falha ao imprimir no agente.');
  }
}
