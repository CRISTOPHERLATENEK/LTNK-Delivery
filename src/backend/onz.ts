/**
 * Integração ONZ / Planner (Pix) — gateway ALTERNATIVO ao Mercado Pago.
 *
 * Duas APIs distintas, cada uma com seu certificado mTLS e suas credenciais
 * OAuth2 (client_credentials), geradas no portal Finance:
 *   - Cash-in  (QR Codes / API Pix padrão Bacen): criar cobrança + consultar.
 *   - Cash-out (Accounts): enviar Pix (repasses/reembolsos).
 *
 * mTLS: seguimos o MESMO padrão da sefaz.ts — o .pfx é aberto por node-forge
 * (assinatura.ts) e a chave/cert em PEM vão pro socket TLS, evitando o
 * ERR_OSSL_UNSUPPORTED do OpenSSL 3 com .pfx legado.
 *
 * ⚠️ ETAPA 1 (fundação): este módulo é a camada de cliente. Ainda NÃO está
 * ligado ao checkout — o Mercado Pago continua sendo o padrão. A seleção de
 * gateway por loja e o webhook entram na etapa 2, quando as credenciais de API
 * estiverem no .env (sem elas nada autentica).
 *
 * ⚠️ Os detalhes exatos do /oauth/token e do corpo da cobrança podem precisar
 * de ajuste fino contra o sandbox real (marcados com TODO). Nada aqui roda até
 * ONZ_*_CLIENT_ID / SECRET estarem configurados.
 */
import https from 'https';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { lerCertificadoPfx } from './assinatura';

/* ───────────────────────── config ───────────────────────── */

interface ConfigApi {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  certPath: string;
}

function cfgCashIn(): ConfigApi | null {
  const clientId = process.env.ONZ_QRCODES_CLIENT_ID || '';
  const clientSecret = process.env.ONZ_QRCODES_CLIENT_SECRET || '';
  const baseUrl = process.env.ONZ_QRCODES_URL || '';
  const certPath = process.env.ONZ_QRCODES_CERT || 'dados/certificados/onz/qrcodes.pfx';
  if (!clientId || !clientSecret || !baseUrl) return null;
  return { baseUrl, clientId, clientSecret, certPath };
}

function cfgCashOut(): ConfigApi | null {
  const clientId = process.env.ONZ_ACCOUNTS_CLIENT_ID || '';
  const clientSecret = process.env.ONZ_ACCOUNTS_CLIENT_SECRET || '';
  const baseUrl = process.env.ONZ_ACCOUNTS_URL || '';
  const certPath = process.env.ONZ_ACCOUNTS_CERT || 'dados/certificados/onz/accounts.pfx';
  if (!clientId || !clientSecret || !baseUrl) return null;
  return { baseUrl, clientId, clientSecret, certPath };
}

/** Cash-in está configurado (credenciais presentes)? */
export function cashInDisponivel(): boolean { return cfgCashIn() !== null; }
/** Cash-out está configurado? */
export function cashOutDisponivel(): boolean { return cfgCashOut() !== null; }

/* ───────────────────────── mTLS + HTTP ───────────────────────── */

interface CertTls { key: string; cert: string }
const cacheCert = new Map<string, CertTls>();

/** Lê o .pfx (path) em PEM, com cache. Senha vem de ONZ_CERT_SENHA. */
function carregarCert(certPath: string): CertTls {
  const emCache = cacheCert.get(certPath);
  if (emCache) return emCache;
  const abs = path.resolve(certPath);
  if (!fs.existsSync(abs)) throw new Error(`Certificado ONZ não encontrado: ${certPath}`);
  const lido = lerCertificadoPfx(fs.readFileSync(abs), process.env.ONZ_CERT_SENHA || '');
  const tls: CertTls = { key: lido.chavePrivadaPem, cert: lido.certificadoPem };
  cacheCert.set(certPath, tls);
  return tls;
}

interface RespHttp { status: number; body: unknown }

/** POST/GET/PUT JSON com TLS mútuo. Não lança em status !=2xx — devolve o corpo. */
function requisicao(
  baseUrl: string,
  rota: string,
  opcoes: { metodo: string; tls: CertTls; corpo?: unknown; headers?: Record<string, string> },
): Promise<RespHttp> {
  const u = new URL(rota, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  const dados = opcoes.corpo === undefined ? null
    : Buffer.from(typeof opcoes.corpo === 'string' ? opcoes.corpo : JSON.stringify(opcoes.corpo), 'utf8');
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: opcoes.metodo,
      key: opcoes.tls.key,
      cert: opcoes.tls.cert,
      minVersion: 'TLSv1.2',
      headers: {
        'Accept': 'application/json',
        ...(dados ? { 'Content-Length': dados.length } : {}),
        ...opcoes.headers,
      },
      timeout: 30000,
    }, resp => {
      const partes: Buffer[] = [];
      resp.on('data', d => partes.push(d));
      resp.on('end', () => {
        const txt = Buffer.concat(partes).toString('utf8');
        let body: unknown = txt;
        try { body = txt ? JSON.parse(txt) : null; } catch { /* deixa texto cru */ }
        resolve({ status: resp.statusCode || 0, body });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado ao falar com a ONZ.')));
    req.on('error', reject);
    if (dados) req.write(dados);
    req.end();
  });
}

/* ───────────────────────── OAuth2 (token com cache) ───────────────────────── */

interface TokenCache { token: string; expiraEm: number }
const tokens = new Map<string, TokenCache>();

async function obterToken(cfg: ConfigApi, escopo: string): Promise<string> {
  const chave = cfg.clientId + '|' + escopo;
  const agora = Date.now();
  const cache = tokens.get(chave);
  if (cache && cache.expiraEm > agora + 30_000) return cache.token;

  const tls = carregarCert(cfg.certPath);
  // TODO(sandbox): confirmar formato exato do /oauth/token de cada API. A API
  // Accounts documenta JSON {clientId, clientSecret, grantType}; a de QR Codes
  // (Bacen) costuma usar Basic auth + x-www-form-urlencoded. Enviamos JSON com
  // Basic auth junto, que a maioria dos PSPs aceita; ajustar se o sandbox exigir.
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const resp = await requisicao(cfg.baseUrl, 'oauth/token', {
    metodo: 'POST',
    tls,
    headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/json' },
    corpo: { clientId: cfg.clientId, clientSecret: cfg.clientSecret, grantType: 'client_credentials', scope: escopo },
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`ONZ auth falhou (HTTP ${resp.status}): ${JSON.stringify(resp.body)}`);
  }
  const b = resp.body as { accessToken?: string; access_token?: string; expiresAt?: number; expires_in?: number };
  const token = b.accessToken || b.access_token || '';
  if (!token) throw new Error('ONZ auth: token ausente na resposta.');
  const ttlSeg = b.expiresAt || b.expires_in || 300;
  tokens.set(chave, { token, expiraEm: agora + ttlSeg * 1000 });
  return token;
}

/* ───────────────────────── Cash-in (cobrança Pix) ───────────────────────── */

export interface CobrancaGerada {
  txid: string;
  status: string;
  copiaECola: string;   // BR Code "copia e cola"
  qrPngDataUrl: string; // imagem do QR pronta pra exibir
  bruto: unknown;
}

/** txid Pix válido: 26–35 caracteres [A-Za-z0-9]. */
function gerarTxid(pedidoId: number): string {
  const base = `PED${pedidoId}`.replace(/[^A-Za-z0-9]/g, '');
  const rand = Array.from({ length: 32 - base.length }, () =>
    'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  return (base + rand).slice(0, 32);
}

/**
 * Cria uma cobrança Pix imediata (cash-in). `valorCentavos` em centavos.
 * Retorna copia-e-cola + QR pronto. Lança se a ONZ não estiver configurada.
 */
export async function criarCobranca(opcoes: {
  pedidoId: number;
  valorCentavos: number;
  expiracaoSeg?: number;
  devedor?: { nome?: string; cpf?: string; cnpj?: string };
  descricao?: string;
}): Promise<CobrancaGerada> {
  const cfg = cfgCashIn();
  if (!cfg) throw new Error('ONZ cash-in não configurada.');
  const chavePix = process.env.ONZ_PIX_KEY || '';
  if (!chavePix) throw new Error('ONZ_PIX_KEY (chave recebedora) não configurada.');

  const tls = carregarCert(cfg.certPath);
  const token = await obterToken(cfg, 'cob.write cob.read pix.read');
  const txid = gerarTxid(opcoes.pedidoId);

  const corpo: Record<string, unknown> = {
    calendario: { expiracao: opcoes.expiracaoSeg ?? 3600 },
    valor: { original: (opcoes.valorCentavos / 100).toFixed(2) },
    chave: chavePix,
    solicitacaoPagador: opcoes.descricao ?? `Pedido #${opcoes.pedidoId}`,
  };
  if (opcoes.devedor?.nome && (opcoes.devedor.cpf || opcoes.devedor.cnpj)) {
    corpo.devedor = opcoes.devedor.cpf
      ? { cpf: opcoes.devedor.cpf, nome: opcoes.devedor.nome }
      : { cnpj: opcoes.devedor.cnpj, nome: opcoes.devedor.nome };
  }

  // PUT /cob/{txid}: cria a cobrança com um txid definido por nós (idempotente).
  const resp = await requisicao(cfg.baseUrl, `cob/${txid}`, {
    metodo: 'PUT', tls,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    corpo,
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`ONZ criar cobrança falhou (HTTP ${resp.status}): ${JSON.stringify(resp.body)}`);
  }
  const b = resp.body as { txid?: string; status?: string; pixCopiaECola?: string; location?: string };
  const copiaECola = b.pixCopiaECola || '';
  let qrPng = '';
  if (copiaECola) { try { qrPng = await QRCode.toDataURL(copiaECola, { margin: 1, width: 240 }); } catch { /* sem QR */ } }
  return { txid: b.txid || txid, status: b.status || 'ATIVA', copiaECola, qrPngDataUrl: qrPng, bruto: resp.body };
}

/** Consulta uma cobrança pelo txid (para conferir se foi paga). */
export async function consultarCobranca(txid: string): Promise<{ status: string; bruto: unknown }> {
  const cfg = cfgCashIn();
  if (!cfg) throw new Error('ONZ cash-in não configurada.');
  const tls = carregarCert(cfg.certPath);
  const token = await obterToken(cfg, 'cob.read pix.read');
  const resp = await requisicao(cfg.baseUrl, `cob/${txid}`, {
    metodo: 'GET', tls, headers: { 'Authorization': `Bearer ${token}` },
  });
  const b = resp.body as { status?: string };
  return { status: b?.status || 'DESCONHECIDO', bruto: resp.body };
}

/* ───────────────────────── Cash-out (enviar Pix) ───────────────────────── */

export interface ResultadoCashOut {
  id: string;
  endToEndId: string;
  status: string;
  bruto: unknown;
}

/**
 * Envia um Pix via chave (cash-out) — ex.: repasse a um lojista. `valorCentavos`
 * em centavos. ⚠️ Move dinheiro de verdade: só chamar em fluxo autorizado.
 */
export async function pixCashoutViaChave(opcoes: {
  pixKey: string;
  valorCentavos: number;
  descricao?: string;
  idempotencyKey: string;
}): Promise<ResultadoCashOut> {
  const cfg = cfgCashOut();
  if (!cfg) throw new Error('ONZ cash-out não configurada.');
  const tls = carregarCert(cfg.certPath);
  const token = await obterToken(cfg, 'pix.write pix.read');

  const resp = await requisicao(cfg.baseUrl, 'pix/dict', {
    metodo: 'POST', tls,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': opcoes.idempotencyKey,
    },
    corpo: {
      pixKey: opcoes.pixKey,
      description: opcoes.descricao,
      payment: { currency: 'BRL', amount: opcoes.valorCentavos / 100 },
    },
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`ONZ cash-out falhou (HTTP ${resp.status}): ${JSON.stringify(resp.body)}`);
  }
  const b = resp.body as { data?: { id?: number; endToEndId?: string; status?: string } };
  const d = b.data || {};
  return { id: String(d.id ?? ''), endToEndId: d.endToEndId || '', status: d.status || 'PROCESSING', bruto: resp.body };
}
