/**
 * Envio de WhatsApp via WBAPI (sessão por QR code / pareamento por número —
 * "WhatsApp não-oficial"), estilo WAHA/Baileys, hospedado por FORA (Deeliv).
 *
 * A conta contratada no Deeliv dá UMA sessão pré-provisionada por eles (o
 * session_id é fixo, não pode ser escolhido livremente — testamos e criar/
 * usar um session_id arbitrário dá 401). Por isso o desenho é: UM WhatsApp
 * conectado pra toda a plataforma (server + api key + session_id, tudo
 * configurado pelo super admin), que qualquer loja com o método liberado
 * pode usar pra mandar a confirmação de pedido. Não é mais "cada loja com
 * seu próprio número" — isso ficaria pra quando/se o plano do Deeliv passar
 * a permitir múltiplas sessões.
 *
 * A documentação pública não traz exemplos de resposta reais — os parsers
 * abaixo são best-effort (tentam os formatos de campo mais comuns do
 * WAHA/Baileys) e podem precisar de ajuste fino.
 */
import crypto from 'crypto';
import { descriptografar } from './cripto';
import db from './db';

interface Credenciais { server: string; apiKey: string; sessionId: string }

function lerConfig(chave: string): string {
  const r = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave) as { valor: string } | undefined;
  return r?.valor ?? '';
}

function credenciaisPlataforma(): Credenciais | null {
  const server = lerConfig('wbapi_server').replace(/\/+$/, '');
  const chaveCripto = lerConfig('wbapi_api_key');
  const sessionId = lerConfig('wbapi_session_id');
  if (!server || !chaveCripto || !sessionId) return null;
  try {
    return { server, apiKey: descriptografar(chaveCripto), sessionId };
  } catch {
    return null;
  }
}

export function wbapiConfigurado(): boolean {
  return credenciaisPlataforma() !== null;
}

/** Token fixo (gerado uma vez) que valida as chamadas do webhook — evita que qualquer um poste no endpoint. */
export function segredoWebhook(): string {
  let s = lerConfig('wbapi_webhook_secret');
  if (!s) {
    s = crypto.randomBytes(24).toString('hex');
    db.prepare("INSERT INTO configuracoes (chave, valor) VALUES ('wbapi_webhook_secret', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor")
      .run(s);
  }
  return s;
}

/**
 * Registra nosso endpoint como webhook da sessão, pra receber as respostas
 * dos clientes (evento 'message'). Chamado a cada "Conectar" — é idempotente,
 * só atualiza a config da sessão, não afeta a conexão em si.
 */
async function registrarWebhook(baseUrl: string): Promise<void> {
  const cred = credenciaisPlataforma();
  if (!cred) return;
  const url = `${baseUrl.replace(/\/+$/, '')}/api/webhooks/whatsapp?token=${segredoWebhook()}`;
  await chamar(`/api/sessions/${cred.sessionId}`, 'PUT', {
    config: { webhooks: [{ url, events: ['message'] }] },
  });
}

interface ResultadoChamada { ok: boolean; status: number; dados: any; erro?: string }

async function chamar(path: string, metodo: string, corpo?: unknown): Promise<ResultadoChamada> {
  const cred = credenciaisPlataforma();
  if (!cred) return { ok: false, status: 0, dados: null, erro: 'WhatsApp não-oficial não configurado pela plataforma (peça ao admin).' };
  try {
    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort(), 15000);
    const resp = await fetch(`${cred.server}${path}`, {
      method: metodo,
      signal: controlador.signal,
      headers: { 'X-Api-Key': cred.apiKey, 'Content-Type': 'application/json' },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
    clearTimeout(timer);
    const texto = await resp.text();
    let dados: any = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
    if (!resp.ok) {
      const msg = (dados && typeof dados === 'object' && (dados.message || dados.error)) || `Falha na API do WhatsApp (HTTP ${resp.status}).`;
      return { ok: false, status: resp.status, dados, erro: msg };
    }
    return { ok: true, status: resp.status, dados };
  } catch (e) {
    return { ok: false, status: 0, dados: null, erro: e instanceof Error ? e.message : 'Falha de rede ao falar com o WhatsApp.' };
  }
}

/**
 * Garante que a sessão (já provisionada pelo Deeliv) está pronta pra parear —
 * chamado ao clicar "Conectar". A sessão pode estar em vários estados (WAHA):
 * se estiver 'FAILED' ou parada, `/start` sozinho é recusado (HTTP 400 "Session
 * status is not as expected") — nesse caso precisa de `/restart`.
 */
export async function garantirSessaoPlataforma(baseUrl?: string): Promise<ResultadoChamada> {
  const cred = credenciaisPlataforma();
  if (!cred) return { ok: false, status: 0, dados: null, erro: 'WhatsApp não-oficial não configurado pela plataforma.' };

  if (baseUrl) await registrarWebhook(baseUrl);

  const atual = await chamar(`/api/sessions/${cred.sessionId}`, 'GET');
  const status = atual.ok ? atual.dados?.status : null;
  if (status === 'WORKING' || status === 'SCAN_QR_CODE' || status === 'STARTING') {
    return { ok: true, status: 200, dados: atual.dados };
  }
  return chamar(`/api/sessions/${cred.sessionId}/restart`, 'POST');
}

/**
 * QR code pra escanear — devolve uma data URI de imagem já pronta pro <img src>.
 * A API devolve o PNG cru no corpo (não JSON/base64), então busca os bytes
 * diretamente em vez de reusar o helper `chamar()` (que assume JSON/texto).
 */
export async function obterQrPlataforma(): Promise<{ ok: boolean; qr?: string; erro?: string }> {
  const cred = credenciaisPlataforma();
  if (!cred) return { ok: false, erro: 'WhatsApp não-oficial não configurado pela plataforma.' };
  try {
    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort(), 15000);
    const resp = await fetch(`${cred.server}/api/${cred.sessionId}/auth/qr`, {
      headers: { 'X-Api-Key': cred.apiKey },
      signal: controlador.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const texto = await resp.text().catch(() => '');
      return { ok: false, erro: texto || `Falha ao obter o QR code (HTTP ${resp.status}).` };
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    if (!buffer.length) return { ok: false, erro: 'A API não retornou o QR code — tente de novo em alguns segundos.' };
    return { ok: true, qr: `data:image/png;base64,${buffer.toString('base64')}` };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Falha de rede ao buscar o QR code.' };
  }
}

/** Alternativa ao QR: pareamento digitando um código no próprio WhatsApp. */
export async function solicitarCodigoPlataforma(telefoneDigitos: string): Promise<{ ok: boolean; codigo?: string; erro?: string }> {
  const cred = credenciaisPlataforma();
  if (!cred) return { ok: false, erro: 'WhatsApp não-oficial não configurado pela plataforma.' };
  const digitos = telefoneDigitos.replace(/\D/g, '');
  const numero = digitos.startsWith('55') ? digitos : `55${digitos}`;
  const r = await chamar(`/api/${cred.sessionId}/auth/request-code`, 'POST', { phoneNumber: numero });
  if (!r.ok) return { ok: false, erro: r.erro };
  const codigo = r.dados?.code ?? r.dados?.pairingCode ?? r.dados?.codigo;
  return { ok: true, codigo: codigo ? String(codigo) : undefined };
}

/** Estado da sessão — usado tanto pra polling durante o pareamento quanto pra exibir "conectado". */
export async function statusSessaoPlataforma(): Promise<{ conectado: boolean; numero?: string }> {
  const cred = credenciaisPlataforma();
  if (!cred) return { conectado: false };
  const r = await chamar(`/api/sessions/${cred.sessionId}/me`, 'GET');
  if (!r.ok || !r.dados) return { conectado: false };
  const numero = r.dados?.id?.user ?? r.dados?.me?.id ?? r.dados?.pushname ?? r.dados?.number;
  return { conectado: !!(r.dados?.id || r.dados?.me || numero), numero: numero ? String(numero) : undefined };
}

export async function desconectarPlataforma(): Promise<ResultadoChamada> {
  const cred = credenciaisPlataforma();
  if (!cred) return { ok: false, status: 0, dados: null, erro: 'WhatsApp não-oficial não configurado pela plataforma.' };
  return chamar(`/api/sessions/${cred.sessionId}/logout`, 'POST');
}

/** Normaliza telefone BR pro formato que o WBAPI espera no chatId (E.164 + "@c.us"). */
function chatId(telefoneDigitos: string): string | null {
  const d = telefoneDigitos.replace(/\D/g, '');
  if (!d) return null;
  const e164 = d.startsWith('55') && (d.length === 12 || d.length === 13) ? d
    : (d.length === 10 || d.length === 11) ? `55${d}` : null;
  return e164 ? `${e164}@c.us` : null;
}

export async function enviarTextoNaoOficial(telefoneDestino: string, texto: string): Promise<ResultadoChamada> {
  const cred = credenciaisPlataforma();
  if (!cred) return { ok: false, status: 0, dados: null, erro: 'WhatsApp não-oficial não configurado pela plataforma.' };
  const id = chatId(telefoneDestino);
  if (!id) return { ok: false, status: 0, dados: null, erro: 'Telefone do cliente inválido.' };
  return chamar('/api/sendText', 'POST', { session: cred.sessionId, chatId: id, reply_to: null, text: texto });
}
