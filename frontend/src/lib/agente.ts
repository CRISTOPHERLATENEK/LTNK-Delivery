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

/** URL do editor do cupom fiscal (rodapé, QR, fonte) — aberto no navegador padrão. */
export const URL_EDITOR_FISCAL = `${BASE}/editor`;

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
 */
export async function impressoraAgentePreferida(): Promise<string | null> {
  const salva = impressoraAgente();
  if (salva) return salva;
  if (!(await agenteAtivo())) return null;
  try {
    const lista = await listarImpressorasAgente();
    const escolha = lista.find(n => RE_TERMICA.test(n)) || lista[0];
    if (escolha) { definirImpressoraAgente(escolha); return escolha; }
  } catch { /* ignore */ }
  return null;
}

/** true se o agente está rodando (responde ao /status rápido). */
export async function agenteAtivo(): Promise<boolean> {
  return (await statusAgente()) !== null;
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
