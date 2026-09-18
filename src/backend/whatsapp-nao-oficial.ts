/**
 * Envio de WhatsApp via WBAPI (sessão por QR code / pareamento por número —
 * "WhatsApp não-oficial"), estilo WAHA/Baileys, hospedado por FORA (Deeliv).
 *
 * ───────────────────────── DUAS CAMADAS DE CONEXÃO ─────────────────────────
 *
 * ERA UMA SÓ, e por um motivo externo: a conta contratada no Deeliv dava UMA
 * sessão pré-provisionada (o session_id é fixo — testamos e criar/usar um
 * arbitrário dá 401), então o desenho foi um WhatsApp pra plataforma inteira,
 * e "cada loja com seu número" ficou pra quando o plano permitisse.
 *
 * AGORA CADA CLIENTE PODE TER O PRÓPRIO TOKEN, cadastrado pelo super admin no
 * painel, e a plataforma continua valendo de reserva:
 *
 *   conexão do CLIENTE ....... credenciais no `configuracoes` do banco dele
 *   conexão da PLATAFORMA .... credenciais no banco central, como sempre
 *
 * QUEM USA O QUÊ, e a diferença não é detalhe:
 *
 *   enviar mensagem .......... cliente, e cai na plataforma se ele não tiver
 *   parear / QR / desconectar  SÓ do cliente, sem reserva nenhuma
 *
 * O segundo caso é regra de segurança: se o pareamento caísse na reserva, um
 * lojista clicando "conectar" parearia o número COMPARTILHADO no celular dele e
 * desconectaria o de todos os outros clientes junto.
 *
 * A documentação pública não traz exemplos de resposta reais — os parsers
 * abaixo são best-effort (tentam os formatos de campo mais comuns do
 * WAHA/Baileys) e podem precisar de ajuste fino.
 */
import crypto from 'crypto';
import { descriptografar } from './cripto';
import { abrirPool, bancoTenantAtual } from './db-mysql';

interface Credenciais { server: string; apiKey: string; sessionId: string }

// A conexão da plataforma mora no banco CENTRAL, e é lida por `abrirPool`
// explícito — nunca pelo `db` proxy, que resolve pro tenant da requisição.
// Usar o proxy aqui era o bug: a config só existia no tenant master, e pedidos
// de qualquer outro tenant liam um `configuracoes` vazio e achavam que o
// WhatsApp não estava configurado. A do cliente, hoje, é o mesmo mecanismo
// apontado para o banco DELE — também explícito, pelo mesmo motivo.
const BANCO_CENTRAL = process.env.MYSQL_DATABASE_CENTRAL || process.env.MYSQL_DATABASE || '';

async function lerDe(banco: string, chave: string): Promise<string> {
  if (!banco) return '';
  const pool = abrirPool(banco);
  const [rows] = await pool.query('SELECT valor FROM configuracoes WHERE chave = ?', [chave]);
  const r = (rows as { valor: string }[])[0];
  return r?.valor ?? '';
}

async function lerConfig(chave: string): Promise<string> {
  return lerDe(BANCO_CENTRAL, chave);
}

/** Monta as credenciais a partir de um banco qualquer — central ou de um cliente. */
async function credenciaisEm(banco: string): Promise<Credenciais | null> {
  const server = (await lerDe(banco, 'wbapi_server')).replace(/\/+$/, '');
  const chaveCripto = await lerDe(banco, 'wbapi_api_key');
  const sessionId = await lerDe(banco, 'wbapi_session_id');
  if (!server || !chaveCripto || !sessionId) return null;
  try {
    return { server, apiKey: descriptografar(chaveCripto), sessionId };
  } catch {
    return null;
  }
}

/** A conexão da PLATAFORMA — a que o super admin configura e todos herdam. */
async function credenciaisPlataforma(): Promise<Credenciais | null> {
  return credenciaisEm(BANCO_CENTRAL);
}

/**
 * A conexão PRÓPRIA do cliente da requisição atual, ou null se ele não tem uma.
 *
 * NUNCA CAI NA CENTRAL, e isto é a regra de segurança do desenho: as funções de
 * SESSÃO (parear, ler QR, desconectar) usam só isto. Se caíssem na central, um
 * lojista clicando "conectar" estaria parqueando o WhatsApp COMPARTILHADO da
 * plataforma no celular dele — e desconectando o de todos os outros clientes
 * junto. Envio é outra história: ali a central é reserva legítima, porque
 * mandar mensagem por ela é o que já acontece hoje.
 */
async function credenciaisDoCliente(): Promise<Credenciais | null> {
  const banco = bancoDoContexto();
  if (!banco || banco === BANCO_CENTRAL) return null;
  return credenciaisEm(banco);
}

/**
 * O banco do contexto, ou vazio quando não há contexto nenhum.
 *
 * `bancoTenantAtual` é FAIL-CLOSED e LANÇA fora de request — é de propósito, pra
 * consulta sem tenant não cair calada no banco padrão. Mas aqui a pergunta é
 * "existe cliente no contexto?", e a resposta legítima fora de um request é
 * "não": worker de fila e chamada de boot passam por aqui, e uma exceção nesse
 * caminho derrubaria o envio em vez de usar a reserva da plataforma.
 */
function bancoDoContexto(): string {
  try {
    return bancoTenantAtual();
  } catch {
    return '';
  }
}

/** Pra ENVIAR: a do cliente quando existe, a da plataforma como reserva. */
async function credenciaisParaEnvio(): Promise<Credenciais | null> {
  return (await credenciaisDoCliente()) ?? (await credenciaisPlataforma());
}

/** Este cliente consegue enviar? (com a própria conexão ou com a da plataforma) */
export async function wbapiConfigurado(): Promise<boolean> {
  return (await credenciaisParaEnvio()) !== null;
}

/** Este cliente tem conexão PRÓPRIA — é o que libera o QR no painel do lojista. */
export async function clienteTemConexaoPropria(): Promise<boolean> {
  return (await credenciaisDoCliente()) !== null;
}

/** Token fixo (gerado uma vez) que valida as chamadas do webhook — evita que qualquer um poste no endpoint. */
export async function segredoWebhook(): Promise<string> {
  let s = await lerConfig('wbapi_webhook_secret');
  if (!s) {
    s = crypto.randomBytes(24).toString('hex');
    await abrirPool(BANCO_CENTRAL).query(
      "INSERT INTO configuracoes (chave, valor) VALUES ('wbapi_webhook_secret', ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
      [s],
    );
  }
  return s;
}

/**
 * Registra nosso endpoint como webhook da sessão, pra receber as respostas
 * dos clientes (evento 'message'). Chamado a cada "Conectar" — é idempotente,
 * só atualiza a config da sessão, não afeta a conexão em si.
 */
async function registrarWebhook(cred: Credenciais, baseUrl: string, banco: string): Promise<void> {
  /*
   * O CLIENTE VAI NA URL DO WEBHOOK, e sem isso a resposta do consumidor se
   * perde. Antes existia UMA sessão pra plataforma inteira, então o endereço
   * podia ser fixo — o comentário de `rotas/webhooks.ts` dizia isso com todas
   * as letras. Com uma sessão POR CLIENTE, quem chega no endpoint precisa dizer
   * de quem é: o provedor faz a chamada de fora, sem Host nosso, e o handler
   * cairia no banco que o Host resolvesse — o cliente errado.
   */
  const alvo = banco && banco !== BANCO_CENTRAL ? `&cliente=${encodeURIComponent(banco)}` : '';
  const url = `${baseUrl.replace(/\/+$/, '')}/api/webhooks/whatsapp?token=${await segredoWebhook()}${alvo}`;
  await chamar(cred, `/api/sessions/${cred.sessionId}`, 'PUT', {
    config: { webhooks: [{ url, events: ['message'] }] },
  });
}

interface ResultadoChamada { ok: boolean; status: number; dados: any; erro?: string }

const SEM_CONEXAO = 'WhatsApp não-oficial não configurado (peça ao admin).';

async function chamar(cred: Credenciais | null, path: string, metodo: string, corpo?: unknown): Promise<ResultadoChamada> {
  if (!cred) return { ok: false, status: 0, dados: null, erro: SEM_CONEXAO };
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
async function garantirSessao(cred: Credenciais | null, baseUrl: string | undefined, banco: string): Promise<ResultadoChamada> {
  if (!cred) return { ok: false, status: 0, dados: null, erro: SEM_CONEXAO };

  if (baseUrl) await registrarWebhook(cred, baseUrl, banco);

  const atual = await chamar(cred, `/api/sessions/${cred.sessionId}`, 'GET');
  const status = atual.ok ? atual.dados?.status : null;
  if (status === 'WORKING' || status === 'SCAN_QR_CODE' || status === 'STARTING') {
    return { ok: true, status: 200, dados: atual.dados };
  }
  return chamar(cred, `/api/sessions/${cred.sessionId}/restart`, 'POST');
}

export async function garantirSessaoPlataforma(baseUrl?: string): Promise<ResultadoChamada> {
  return garantirSessao(await credenciaisPlataforma(), baseUrl, BANCO_CENTRAL);
}

/** A mesma coisa, na conexão PRÓPRIA do cliente da requisição. */
export async function garantirSessaoDoCliente(baseUrl?: string): Promise<ResultadoChamada> {
  return garantirSessao(await credenciaisDoCliente(), baseUrl, bancoDoContexto());
}

/**
 * QR code pra escanear — devolve uma data URI de imagem já pronta pro <img src>.
 * A API devolve o PNG cru no corpo (não JSON/base64), então busca os bytes
 * diretamente em vez de reusar o helper `chamar()` (que assume JSON/texto).
 */
async function obterQr(cred: Credenciais | null): Promise<{ ok: boolean; qr?: string; erro?: string }> {
  if (!cred) return { ok: false, erro: SEM_CONEXAO };
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

export async function obterQrPlataforma() { return obterQr(await credenciaisPlataforma()); }
export async function obterQrDoCliente() { return obterQr(await credenciaisDoCliente()); }

/** Alternativa ao QR: pareamento digitando um código no próprio WhatsApp. */
async function solicitarCodigo(cred: Credenciais | null, telefoneDigitos: string): Promise<{ ok: boolean; codigo?: string; erro?: string }> {
  if (!cred) return { ok: false, erro: SEM_CONEXAO };
  const digitos = telefoneDigitos.replace(/\D/g, '');
  const numero = digitos.startsWith('55') ? digitos : `55${digitos}`;
  const r = await chamar(cred, `/api/${cred.sessionId}/auth/request-code`, 'POST', { phoneNumber: numero });
  if (!r.ok) return { ok: false, erro: r.erro };
  const codigo = r.dados?.code ?? r.dados?.pairingCode ?? r.dados?.codigo;
  return { ok: true, codigo: codigo ? String(codigo) : undefined };
}

export async function solicitarCodigoPlataforma(tel: string) { return solicitarCodigo(await credenciaisPlataforma(), tel); }
export async function solicitarCodigoDoCliente(tel: string) { return solicitarCodigo(await credenciaisDoCliente(), tel); }

/** Estado da sessão — usado tanto pra polling durante o pareamento quanto pra exibir "conectado". */
async function statusSessao(cred: Credenciais | null): Promise<{ conectado: boolean; numero?: string }> {
  if (!cred) return { conectado: false };
  const r = await chamar(cred, `/api/sessions/${cred.sessionId}/me`, 'GET');
  if (!r.ok || !r.dados) return { conectado: false };
  const numero = r.dados?.id?.user ?? r.dados?.me?.id ?? r.dados?.pushname ?? r.dados?.number;
  return { conectado: !!(r.dados?.id || r.dados?.me || numero), numero: numero ? String(numero) : undefined };
}

export async function statusSessaoPlataforma() { return statusSessao(await credenciaisPlataforma()); }
export async function statusSessaoDoCliente() { return statusSessao(await credenciaisDoCliente()); }

async function desconectar(cred: Credenciais | null): Promise<ResultadoChamada> {
  if (!cred) return { ok: false, status: 0, dados: null, erro: SEM_CONEXAO };
  return chamar(cred, `/api/sessions/${cred.sessionId}/logout`, 'POST');
}

export async function desconectarPlataforma() { return desconectar(await credenciaisPlataforma()); }
export async function desconectarDoCliente() { return desconectar(await credenciaisDoCliente()); }

/** Normaliza um telefone BR pra E.164 sem "+" (ex.: 5547999998888). */
function paraE164(telefoneDigitos: string): string | null {
  const d = telefoneDigitos.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return null;
}

/**
 * Resolve o chatId REAL de um número via a própria API do WhatsApp — crucial
 * pro Brasil por causa do "nono dígito": números de celular têm o 9 na frente
 * (ex.: 47 99784-3478), mas internamente o WhatsApp registra muitos SEM esse 9
 * (554784173970). Se a gente adivinhar o formato errado, a API aceita o envio
 * mas a mensagem nunca chega. check-exists devolve o chatId certo pra usar.
 * Se o número não existir no WhatsApp, devolve null (não adianta tentar enviar).
 */
async function resolverChatId(cred: Credenciais, telefoneDestino: string): Promise<{ chatId: string | null; existe: boolean }> {
  const e164 = paraE164(telefoneDestino);
  if (!e164) return { chatId: null, existe: false };

  const r = await chamar(cred, `/api/contacts/check-exists?phone=${e164}&session=${cred.sessionId}`, 'GET');
  if (r.ok && r.dados && typeof r.dados === 'object') {
    if (r.dados.numberExists === false) return { chatId: null, existe: false };
    if (typeof r.dados.chatId === 'string' && r.dados.chatId.includes('@')) {
      return { chatId: r.dados.chatId, existe: true };
    }
  }
  // Fallback: se check-exists falhar (rede/formato inesperado), usa o E.164 direto —
  // pode não entregar pra números que dependem do desdobramento do 9, mas é melhor que abortar.
  return { chatId: `${e164}@c.us`, existe: true };
}

/**
 * ENVIA PELA CONEXÃO DO CLIENTE, e cai na da plataforma quando ele não tem uma.
 *
 * É a única função que usa a reserva: mandar a confirmação de pedido pelo número
 * compartilhado é exatamente o que já acontecia antes desta separação existir, e
 * tirar isso deixaria sem WhatsApp todo cliente que ainda não foi provisionado.
 * As funções de SESSÃO não têm reserva — ver `credenciaisDoCliente`.
 */
export async function enviarTextoNaoOficial(telefoneDestino: string, texto: string): Promise<ResultadoChamada> {
  const cred = await credenciaisParaEnvio();
  if (!cred) return { ok: false, status: 0, dados: null, erro: SEM_CONEXAO };
  const { chatId: id, existe } = await resolverChatId(cred, telefoneDestino);
  if (!id) {
    return { ok: false, status: 0, dados: null, erro: existe ? 'Telefone do cliente inválido.' : 'Este número não tem WhatsApp.' };
  }
  return chamar(cred, '/api/sendText', 'POST', { session: cred.sessionId, chatId: id, reply_to: null, text: texto });
}
