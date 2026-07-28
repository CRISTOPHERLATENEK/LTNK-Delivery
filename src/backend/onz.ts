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
import forge from 'node-forge';
import QRCode from 'qrcode';
import { lerCertificadoPfx } from './assinatura';

/* ───────────────────────── config ───────────────────────── */

interface ConfigApi {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  certPath: string;
  /**
   * Formato do corpo do /oauth/token — as duas APIs divergem (VALIDADO no sandbox):
   *  - 'camel' (API Contas/Accounts): { clientId, clientSecret, grantType }
   *  - 'snake' (API QRCodes, padrão Bacen): { client_id, client_secret, grant_type }
   * Mandar o formato errado devolve 401 "Credenciais inválidas APC-001".
   */
  estiloAuth: 'camel' | 'snake';
}

/**
 * Credenciais de UMA loja (conta ONZ própria dela). Cada cliente abre a própria
 * conta na Planner (um CNPJ, uma conta, uma chave Pix), então quem recebe o
 * dinheiro é o lojista — a plataforma não intermedeia.
 *
 * O CERTIFICADO é único da integração (confirmado com a Planner), por isso não
 * entra aqui: continua vindo do ambiente e valendo pra todas as contas.
 */
export interface CredenciaisLoja {
  clientId: string;
  clientSecret: string;
  chavePix: string;
}

/**
 * Config de cash-in. Com `cred`, usa a conta DA LOJA; sem, cai na conta da
 * plataforma (`.env`) — que é o que mantém funcionando quem já estava rodando
 * antes das credenciais por loja existirem.
 */
function cfgCashIn(cred?: CredenciaisLoja | null): ConfigApi | null {
  const clientId = cred?.clientId || process.env.ONZ_QRCODES_CLIENT_ID || '';
  const clientSecret = cred?.clientSecret || process.env.ONZ_QRCODES_CLIENT_SECRET || '';
  const baseUrl = process.env.ONZ_QRCODES_URL || '';
  const certPath = process.env.ONZ_QRCODES_CERT || 'dados/certificados/onz/qrcodes.pfx';
  if (!clientId || !clientSecret || !baseUrl) return null;
  return { baseUrl, clientId, clientSecret, certPath, estiloAuth: 'snake' };
}

function cfgCashOut(): ConfigApi | null {
  const clientId = process.env.ONZ_ACCOUNTS_CLIENT_ID || '';
  const clientSecret = process.env.ONZ_ACCOUNTS_CLIENT_SECRET || '';
  const baseUrl = process.env.ONZ_ACCOUNTS_URL || '';
  const certPath = process.env.ONZ_ACCOUNTS_CERT || 'dados/certificados/onz/accounts.pfx';
  if (!clientId || !clientSecret || !baseUrl) return null;
  return { baseUrl, clientId, clientSecret, certPath, estiloAuth: 'camel' };
}

/** Cash-in está configurado? Com `cred`, checa a conta da loja; sem, a da plataforma. */
export function cashInDisponivel(cred?: CredenciaisLoja | null): boolean { return cfgCashIn(cred) !== null; }
/** Cash-out está configurado? */
export function cashOutDisponivel(): boolean { return cfgCashOut() !== null; }

/* ───────────────────────── mTLS + HTTP ───────────────────────── */

interface CertTls { key: string; cert: string; ca: string[] }
const cacheCert = new Map<string, CertTls>();

/**
 * CAs de dentro do .pfx (todos os certificados que NÃO são a folha do titular).
 *
 * Necessário porque os hosts da ONZ são assinados por uma CA PRIVADA deles
 * (`ONZ-SECURE-AREA-PLANNER` no accounts, `onz.software` no qrcodes) e servem
 * a cadeia incompleta — só a folha. Sem passar essa CA em `ca:`, o Node recusa
 * com "unable to verify the first certificate". A CA vem no próprio .pfx que
 * eles entregaram, então usamos ela (NÃO desligamos a verificação TLS).
 */
function extrairCasDoPfx(pfx: Buffer, senha: string, certFolhaPem: string): string[] {
  try {
    const p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary'))), false, senha);
    const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
    const folhaNormalizada = certFolhaPem.replace(/\s+/g, '');
    return bags
      .map(b => b.cert)
      .filter((c): c is forge.pki.Certificate => !!c)
      .map(c => forge.pki.certificateToPem(c))
      .filter(pem => pem.replace(/\s+/g, '') !== folhaNormalizada);
  } catch {
    return [];
  }
}

/** Lê o .pfx (path) em PEM + CAs internas, com cache. Senha vem de ONZ_CERT_SENHA. */
function carregarCert(certPath: string): CertTls {
  const emCache = cacheCert.get(certPath);
  if (emCache) return emCache;
  const abs = path.resolve(certPath);
  if (!fs.existsSync(abs)) throw new Error(`Certificado ONZ não encontrado: ${certPath}`);
  const buf = fs.readFileSync(abs);
  const senha = process.env.ONZ_CERT_SENHA || '';
  const lido = lerCertificadoPfx(buf, senha);
  const tls: CertTls = {
    key: lido.chavePrivadaPem,
    cert: lido.certificadoPem,
    ca: extrairCasDoPfx(buf, senha, lido.certificadoPem),
  };
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
      // CA privada da ONZ (vem no .pfx deles) — a verificação TLS do servidor
      // continua LIGADA; só ensinamos ao Node em quem confiar.
      ...(opcoes.tls.ca.length ? { ca: opcoes.tls.ca } : {}),
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
  // Formato do corpo varia por API (ver ConfigApi.estiloAuth) — confirmado no
  // sandbox: mandar o estilo errado devolve 401 APC-001. O escopo só vai no
  // estilo camel (Accounts); a API QRCodes deriva os escopos da credencial.
  const corpo = cfg.estiloAuth === 'snake'
    ? { client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials' }
    : { clientId: cfg.clientId, clientSecret: cfg.clientSecret, grantType: 'client_credentials', scope: escopo };
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const resp = await requisicao(cfg.baseUrl, 'oauth/token', {
    metodo: 'POST',
    tls,
    headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/json' },
    corpo,
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
  /** Credenciais da conta ONZ da loja. Ausente = conta da plataforma (.env). */
  cred?: CredenciaisLoja | null;
}): Promise<CobrancaGerada> {
  const cfg = cfgCashIn(opcoes.cred);
  if (!cfg) throw new Error('ONZ cash-in não configurada.');
  const chavePix = opcoes.cred?.chavePix || process.env.ONZ_PIX_KEY || '';
  if (!chavePix) throw new Error('Chave Pix recebedora não configurada (nem na loja, nem na plataforma).');

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
export async function consultarCobranca(txid: string, cred?: CredenciaisLoja | null): Promise<{
  status: string; pago: boolean; valorPagoCentavos: number; e2eIds: string[]; bruto: unknown;
}> {
  const cfg = cfgCashIn(cred);
  if (!cfg) throw new Error('ONZ cash-in não configurada.');
  const tls = carregarCert(cfg.certPath);
  const token = await obterToken(cfg, 'cob.read pix.read');
  const resp = await requisicao(cfg.baseUrl, `cob/${encodeURIComponent(txid)}`, {
    metodo: 'GET', tls, headers: { 'Authorization': `Bearer ${token}` },
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`ONZ consulta de cobrança falhou (HTTP ${resp.status}): ${JSON.stringify(resp.body)}`);
  }
  const b = (resp.body ?? {}) as { status?: string; pix?: Array<{ valor?: string; endToEndId?: string }> };
  const recebidos = Array.isArray(b.pix) ? b.pix : [];
  // Fonte da verdade do pagamento é o array `pix` (Pix efetivamente liquidados).
  // O status CONCLUIDA também indica pago, mas o array é o que dá o valor real
  // (importante: pode haver pagamento parcial/múltiplo).
  const valorPagoCentavos = recebidos.reduce((s, p) => s + Math.round(Number(p.valor || 0) * 100), 0);
  return {
    status: b.status || 'DESCONHECIDO',
    pago: b.status === 'CONCLUIDA' || recebidos.length > 0,
    valorPagoCentavos,
    e2eIds: recebidos.map(p => p.endToEndId || '').filter(Boolean),
    bruto: resp.body,
  };
}

/**
 * Devolve (estorna) uma cobrança já paga, a partir do txid.
 *
 * No Pix a devolução é por PIX RECEBIDO, não por cobrança: o endpoint é
 * `PUT /pix/{e2eid}/devolucao/{id}`. Por isso a função primeiro consulta a
 * cobrança pra descobrir os endToEndIds liquidados — e devolve TODOS, porque
 * uma mesma cobrança pode ter sido paga em partes (o `consultarCobranca` já
 * trata isso ao somar `valorPagoCentavos`). Estornar só o primeiro deixaria o
 * cliente sem parte do dinheiro.
 *
 * O `id` da devolução é escolhido por nós e é o que torna a operação
 * IDEMPOTENTE: repetir a chamada com o mesmo id não gera uma segunda
 * devolução. Ele é derivado do e2eid (determinístico), então um clique duplo
 * no botão de estornar não devolve em dobro. Formato exigido pelo Bacen:
 * `[a-zA-Z0-9]{1,35}`.
 */
export async function devolverCobranca(txid: string, cred?: CredenciaisLoja | null): Promise<{
  devolucoes: Array<{ e2eId: string; idDevolucao: string; status: string }>;
  totalCentavos: number;
}> {
  const cfg = cfgCashIn(cred);
  if (!cfg) throw new Error('ONZ cash-in não configurada.');

  // A devolução tem que sair da MESMA conta que recebeu — mesma cred.
  const cobranca = await consultarCobranca(txid, cred);
  if (!cobranca.pago || cobranca.e2eIds.length === 0) {
    throw new Error('Cobrança ONZ sem Pix liquidado — não há o que devolver.');
  }

  const tls = carregarCert(cfg.certPath);
  const token = await obterToken(cfg, 'pix.write pix.read');
  const bruto = (cobranca.bruto ?? {}) as { pix?: Array<{ valor?: string; endToEndId?: string }> };
  const recebidos = Array.isArray(bruto.pix) ? bruto.pix : [];

  const devolucoes: Array<{ e2eId: string; idDevolucao: string; status: string }> = [];
  let totalCentavos = 0;

  for (const p of recebidos) {
    const e2eId = p.endToEndId || '';
    if (!e2eId) continue;
    // Devolve exatamente o valor daquele Pix (a soma das devoluções não pode
    // ultrapassar o valor recebido — regra do Bacen).
    const valor = Number(p.valor || 0);
    if (valor <= 0) continue;

    const idDevolucao = `d${e2eId.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 35);
    const resp = await requisicao(cfg.baseUrl, `pix/${encodeURIComponent(e2eId)}/devolucao/${idDevolucao}`, {
      metodo: 'PUT', tls,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      corpo: { valor: valor.toFixed(2) },
    });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`ONZ devolução falhou para ${e2eId} (HTTP ${resp.status}): ${JSON.stringify(resp.body)}`);
    }
    const b = (resp.body ?? {}) as { status?: string };
    devolucoes.push({ e2eId, idDevolucao, status: b.status || 'EM_PROCESSAMENTO' });
    totalCentavos += Math.round(valor * 100);
  }

  if (devolucoes.length === 0) throw new Error('Nenhum Pix elegível para devolução nesta cobrança.');
  return { devolucoes, totalCentavos };
}

/* ───────────────── Webhooks (registro — roda uma vez por ambiente) ───────────────── */

/**
 * Registra a URL que a ONZ vai chamar quando um Pix com txid for recebido
 * (cash-in). É `PUT /webhook/{chave}`, onde {chave} é a chave Pix recebedora.
 *
 * ⚠️ Só Pix ASSOCIADOS A UM TXID são notificados (regra do Bacen) — Pix soltos
 * na chave, sem cobrança, não geram webhook.
 */
export async function registrarWebhookCashIn(url: string, cred?: CredenciaisLoja | null): Promise<unknown> {
  const cfg = cfgCashIn(cred);
  if (!cfg) throw new Error('ONZ cash-in não configurada.');
  const chave = cred?.chavePix || process.env.ONZ_PIX_KEY || '';
  if (!chave) throw new Error('Chave Pix recebedora não configurada (nem na loja, nem na plataforma).');
  const tls = carregarCert(cfg.certPath);
  const token = await obterToken(cfg, 'webhook.write');
  const resp = await requisicao(cfg.baseUrl, `webhook/${encodeURIComponent(chave)}`, {
    metodo: 'PUT', tls,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    corpo: { webhookUrl: url },
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`ONZ registro de webhook falhou (HTTP ${resp.status}): ${JSON.stringify(resp.body)}`);
  }
  return resp.body;
}

/** Consulta o webhook de cash-in registrado (pra conferir o que está valendo). */
export async function consultarWebhookCashIn(cred?: CredenciaisLoja | null): Promise<{ registrado: boolean; bruto: unknown }> {
  const cfg = cfgCashIn(cred);
  if (!cfg) throw new Error('ONZ cash-in não configurada.');
  const chave = cred?.chavePix || process.env.ONZ_PIX_KEY || '';
  if (!chave) throw new Error('Chave Pix recebedora não configurada (nem na loja, nem na plataforma).');
  const tls = carregarCert(cfg.certPath);
  const token = await obterToken(cfg, 'webhook.read');
  const resp = await requisicao(cfg.baseUrl, `webhook/${encodeURIComponent(chave)}`, {
    metodo: 'GET', tls, headers: { 'Authorization': `Bearer ${token}` },
  });
  // 404 = nenhum webhook registrado ainda (não é erro).
  return { registrado: resp.status >= 200 && resp.status < 300, bruto: resp.body };
}

/**
 * Registra o webhook de cash-out (API Accounts, formato proprietário).
 * Avisa quando um Pix ENVIADO por nós muda de status (liquidado/devolvido).
 */
export async function registrarWebhookCashOut(url: string, email?: string): Promise<unknown> {
  const cfg = cfgCashOut();
  if (!cfg) throw new Error('ONZ cash-out não configurada.');
  const tls = carregarCert(cfg.certPath);
  const token = await obterToken(cfg, 'webhook.write');
  const resp = await requisicao(cfg.baseUrl, 'webhooks/cashout', {
    metodo: 'POST', tls,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    corpo: { uri: url, method: 'POST', enabled: true, pauseOnFail: true, ...(email ? { email } : {}) },
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`ONZ registro de webhook cash-out falhou (HTTP ${resp.status}): ${JSON.stringify(resp.body)}`);
  }
  return resp.body;
}

/* ───────────────────────── Cash-out (enviar Pix) ───────────────────────── */

/** Saldo da conta (read-only) — útil pra checar antes de repassar e pra smoke test. */
export async function consultarSaldo(): Promise<{ disponivel: number; bruto: unknown }> {
  const cfg = cfgCashOut();
  if (!cfg) throw new Error('ONZ cash-out não configurada.');
  const tls = carregarCert(cfg.certPath);
  const token = await obterToken(cfg, 'account.read');
  const resp = await requisicao(cfg.baseUrl, 'accounts/balances/', {
    metodo: 'GET', tls, headers: { 'Authorization': `Bearer ${token}` },
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`ONZ saldo falhou (HTTP ${resp.status}): ${JSON.stringify(resp.body)}`);
  }
  const b = resp.body as { data?: Array<{ balanceAmount?: { available?: number } }> };
  const disponivel = b.data?.[0]?.balanceAmount?.available ?? 0;
  return { disponivel, bruto: resp.body };
}

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

  const resp = await requisicao(cfg.baseUrl, 'pix/payments/dict', {
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
