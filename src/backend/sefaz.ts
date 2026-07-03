/**
 * Transmissão da NFC-e à SEFAZ — autorização SÍNCRONA (NFeAutorizacao4).
 *
 * Tudo local: monta o envelope SOAP 1.2, abre uma conexão HTTPS com TLS MÚTUO
 * (o certificado A1 vai no socket via `pfx`) e envia o lote com indSinc=1, que
 * já devolve o protocolo (protNFe) na mesma resposta — sem polling.
 *
 * ⚠️ As URLs dos webservices mudam com o tempo e por UF. Confira no portal da
 * SEFAZ do estado. Estados sem endpoint próprio de NFC-e usam a SVRS.
 */
import https from 'https';
import fs from 'fs';
import { CODIGO_UF } from './nfce';

/**
 * Cadeia de CAs da ICP-Brasil (PEM) para validar o certificado do SERVIDOR da
 * SEFAZ. Sem isso o Node pode não confiar no emissor e recusar o handshake
 * ("unable to get local issuer certificate"). Aponte NFE_CA_BUNDLE para o .pem
 * com as ACs. NUNCA desabilitamos a verificação — apenas ensinamos a cadeia.
 */
let caBundle: Buffer | undefined;
function carregarCaBundle(): Buffer | undefined {
  if (caBundle !== undefined) return caBundle || undefined;
  const caminho = process.env.NFE_CA_BUNDLE;
  try {
    caBundle = caminho && fs.existsSync(caminho) ? fs.readFileSync(caminho) : Buffer.alloc(0);
  } catch { caBundle = Buffer.alloc(0); }
  return caBundle.length ? caBundle : undefined;
}

/** Endpoints NFeAutorizacao4 por UF: [homologação, produção]. */
export const URL_AUTORIZACAO: Record<string, [string, string]> = {
  SP: [
    'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx',
    'https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx',
  ],
  MG: [
    'https://hnfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4',
    'https://nfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4',
  ],
  PR: [
    'https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4',
    'https://nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4',
  ],
  BA: [
    'https://hnfce.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx',
    'https://nfce.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx',
  ],
  GO: [
    'https://homolog.sefaz.go.gov.br/nfe/services/NFeAutorizacao4',
    'https://nfe.sefaz.go.gov.br/nfe/services/NFeAutorizacao4',
  ],
  MT: [
    'https://homologacao.sefaz.mt.gov.br/nfce/services/NFeAutorizacao4',
    'https://nfce.sefaz.mt.gov.br/nfce/services/NFeAutorizacao4',
  ],
  MS: [
    'https://hom.nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4',
    'https://nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4',
  ],
  PE: [
    'https://nfcehomolog.sefaz.pe.gov.br/nfce-service/services/NFeAutorizacao4',
    'https://nfce.sefaz.pe.gov.br/nfce-service/services/NFeAutorizacao4',
  ],
  CE: [
    'https://nfceh.sefaz.ce.gov.br/nfce/services/NFeAutorizacao4',
    'https://nfce.sefaz.ce.gov.br/nfce/services/NFeAutorizacao4',
  ],
  AM: [
    'https://homnfce.sefaz.am.gov.br/nfce-services/services/NFeAutorizacao4',
    'https://nfce.sefaz.am.gov.br/nfce-services/services/NFeAutorizacao4',
  ],
};

/**
 * SVRS (Sefaz Virtual do RS) autoriza a NFC-e da maioria dos estados que não
 * têm ambiente próprio: AC, AL, AP, DF, ES, PA, PB, PI, RJ, RN, RO, RR, RS, SC, SE, TO.
 */
const URL_SVRS: [string, string] = [
  'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
];

/** Resolve a URL do webservice de autorização para a UF/ambiente. */
export function urlAutorizacao(uf: string, ambiente: number): string {
  const par = URL_AUTORIZACAO[uf.toUpperCase()] ?? URL_SVRS;
  return par[ambiente === 1 ? 1 : 0];
}

export interface ResultadoTransmissao {
  autorizada: boolean;
  cStat: string;       // 100 = autorizada; 150 = autorizada fora de prazo
  motivo: string;      // xMotivo
  protocolo: string;   // nProt
  xmlProc: string;     // nfeProc (NFe + protNFe) quando autorizada; senão o retorno bruto
  bruto: string;       // resposta completa da SEFAZ (para diagnóstico)
}

/** Extrai o conteúdo da 1ª ocorrência de uma tag (ignora namespace/atributos). */
function extrair(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`));
  return m ? m[1].trim() : '';
}

/** Isola o elemento <NFe> assinado (sem a declaração <?xml?>). */
function soNFe(xmlAssinado: string): string {
  const m = xmlAssinado.match(/<NFe[\s\S]*<\/NFe>/);
  if (!m) throw new Error('XML assinado inválido: elemento <NFe> não encontrado.');
  return m[0];
}

/** Monta o envelope SOAP 1.2 do NFeAutorizacao4 (lote síncrono, indSinc=1). */
function envelopeAutorizacao(nFe: string, idLote: string): string {
  const enviNFe =
    `<enviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
      `<idLote>${idLote}</idLote>` +
      `<indSinc>1</indSinc>` +
      nFe +
    `</enviNFe>`;
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">` +
      `<soap:Body>` +
        `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${enviNFe}</nfeDadosMsg>` +
      `</soap:Body>` +
    `</soap:Envelope>`;
}

/** POST SOAP 1.2 com TLS mútuo (certificado A1 no socket). */
function postSoap(url: string, corpo: string, pfx: Buffer, senha: string): Promise<string> {
  const u = new URL(url);
  const dados = Buffer.from(corpo, 'utf8');
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      pfx,
      passphrase: senha,
      // Cadeia ICP-Brasil para validar o SERVIDOR da SEFAZ (se configurada).
      ca: carregarCaBundle(),
      // A SEFAZ exige TLS 1.2+. minVersion evita handshake em protocolo velho.
      minVersion: 'TLSv1.2',
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'Content-Length': dados.length,
      },
      timeout: 30000,
    }, resp => {
      const partes: Buffer[] = [];
      resp.on('data', d => partes.push(d));
      resp.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado ao falar com a SEFAZ.')));
    req.on('error', reject);
    req.write(dados);
    req.end();
  });
}

/**
 * Transmite a NFC-e assinada e devolve o resultado da autorização.
 * `pfx`/`senha` = certificado A1 (usado no TLS mútuo). Não lança em rejeição
 * fiscal — devolve autorizada=false com cStat/motivo para o chamador tratar.
 */
export async function transmitirNfce(
  xmlAssinado: string,
  opcoes: { uf: string; ambiente: number; pfx: Buffer; senha: string; chave: string },
): Promise<ResultadoTransmissao> {
  const { uf, ambiente, pfx, senha, chave } = opcoes;
  if (!CODIGO_UF[uf.toUpperCase()]) throw new Error(`UF inválida para transmissão: ${uf}`);

  const nFe = soNFe(xmlAssinado);
  const url = urlAutorizacao(uf, ambiente);
  const envelope = envelopeAutorizacao(nFe, Date.now().toString().slice(-15));
  const resposta = await postSoap(url, envelope, pfx, senha);

  // No lote síncrono, o protNFe/infProt traz o status real da nota.
  const protNFe = resposta.match(/<protNFe[\s\S]*?<\/protNFe>/)?.[0] ?? '';
  const infProt = protNFe || resposta;
  const cStat = extrair(infProt, 'cStat');
  const motivo = extrair(infProt, 'xMotivo');
  const protocolo = extrair(infProt, 'nProt');

  // 100 = autorizado o uso; 150 = autorizado fora de prazo (também vale).
  const autorizada = cStat === '100' || cStat === '150';
  const xmlProc = autorizada
    ? `<?xml version="1.0" encoding="UTF-8"?>` +
      `<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${nFe}${protNFe}</nfeProc>`
    : resposta;

  return { autorizada, cStat, motivo, protocolo, xmlProc, bruto: resposta };
}

/* ═══════════════ Eventos: cancelamento e inutilização ═══════════════ */

const pad = (v: string | number, n: number) => String(v).replace(/\D/g, '').padStart(n, '0').slice(-n);

/** Endpoints RecepcaoEvento4 (cancelamento) por UF: [homologação, produção]. */
export const URL_EVENTO: Record<string, [string, string]> = {
  SP: ['https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx',
       'https://nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx'],
  MG: ['https://hnfce.fazenda.mg.gov.br/nfce/services/NFeRecepcaoEvento4',
       'https://nfce.fazenda.mg.gov.br/nfce/services/NFeRecepcaoEvento4'],
  PR: ['https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeRecepcaoEvento4',
       'https://nfce.sefa.pr.gov.br/nfce/NFeRecepcaoEvento4'],
  BA: ['https://hnfce.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
       'https://nfce.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx'],
  GO: ['https://homolog.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4',
       'https://nfe.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4'],
  MT: ['https://homologacao.sefaz.mt.gov.br/nfce/services/NFeRecepcaoEvento4',
       'https://nfce.sefaz.mt.gov.br/nfce/services/NFeRecepcaoEvento4'],
  MS: ['https://hom.nfce.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4',
       'https://nfce.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4'],
  PE: ['https://nfcehomolog.sefaz.pe.gov.br/nfce-service/services/NFeRecepcaoEvento4',
       'https://nfce.sefaz.pe.gov.br/nfce-service/services/NFeRecepcaoEvento4'],
  CE: ['https://nfceh.sefaz.ce.gov.br/nfce/services/NFeRecepcaoEvento4',
       'https://nfce.sefaz.ce.gov.br/nfce/services/NFeRecepcaoEvento4'],
  AM: ['https://homnfce.sefaz.am.gov.br/nfce-services/services/NFeRecepcaoEvento4',
       'https://nfce.sefaz.am.gov.br/nfce-services/services/NFeRecepcaoEvento4'],
};
const URL_EVENTO_SVRS: [string, string] = [
  'https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
  'https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
];

/** Endpoints NFeInutilizacao4 por UF: [homologação, produção]. */
export const URL_INUTILIZACAO: Record<string, [string, string]> = {
  SP: ['https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx',
       'https://nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx'],
  MG: ['https://hnfce.fazenda.mg.gov.br/nfce/services/NFeInutilizacao4',
       'https://nfce.fazenda.mg.gov.br/nfce/services/NFeInutilizacao4'],
  PR: ['https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeInutilizacao4',
       'https://nfce.sefa.pr.gov.br/nfce/NFeInutilizacao4'],
  BA: ['https://hnfce.sefaz.ba.gov.br/webservices/NFeInutilizacao4/NFeInutilizacao4.asmx',
       'https://nfce.sefaz.ba.gov.br/webservices/NFeInutilizacao4/NFeInutilizacao4.asmx'],
  GO: ['https://homolog.sefaz.go.gov.br/nfe/services/NFeInutilizacao4',
       'https://nfe.sefaz.go.gov.br/nfe/services/NFeInutilizacao4'],
  MT: ['https://homologacao.sefaz.mt.gov.br/nfce/services/NFeInutilizacao4',
       'https://nfce.sefaz.mt.gov.br/nfce/services/NFeInutilizacao4'],
  MS: ['https://hom.nfce.sefaz.ms.gov.br/ws/NFeInutilizacao4',
       'https://nfce.sefaz.ms.gov.br/ws/NFeInutilizacao4'],
  PE: ['https://nfcehomolog.sefaz.pe.gov.br/nfce-service/services/NFeInutilizacao4',
       'https://nfce.sefaz.pe.gov.br/nfce-service/services/NFeInutilizacao4'],
  CE: ['https://nfceh.sefaz.ce.gov.br/nfce/services/NFeInutilizacao4',
       'https://nfce.sefaz.ce.gov.br/nfce/services/NFeInutilizacao4'],
  AM: ['https://homnfce.sefaz.am.gov.br/nfce-services/services/NFeInutilizacao4',
       'https://nfce.sefaz.am.gov.br/nfce-services/services/NFeInutilizacao4'],
};
const URL_INUT_SVRS: [string, string] = [
  'https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
  'https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
];

export function urlEvento(uf: string, ambiente: number): string {
  const par = URL_EVENTO[uf.toUpperCase()] ?? URL_EVENTO_SVRS;
  return par[ambiente === 1 ? 1 : 0];
}
export function urlInutilizacao(uf: string, ambiente: number): string {
  const par = URL_INUTILIZACAO[uf.toUpperCase()] ?? URL_INUT_SVRS;
  return par[ambiente === 1 ? 1 : 0];
}

/** dhEvento no formato YYYY-MM-DDThh:mm:ss-03:00. */
function agoraFiscal(): string {
  const d = new Date();
  const z = (n: number) => pad(n, 2);
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}-03:00`;
}

export interface ResultadoEvento {
  ok: boolean;
  cStat: string;       // 135 = registrado; 155 = registrado fora de prazo; 102 = inutilizado
  motivo: string;
  protocolo: string;   // nProt do evento (quando houver)
  xmlProc: string;     // procEventoNFe / retInutNFe
  bruto: string;
}

/**
 * Monta o <evento> de CANCELAMENTO (tpEvento 110111), SEM assinatura.
 * O chamador assina infEvento e passa o resultado a `transmitirCancelamento`.
 */
export function montarEventoCancelamento(opcoes: {
  uf: string; ambiente: number; cnpj: string; chave: string; protocolo: string; justificativa: string; nSeq?: number;
}): string {
  const { uf, ambiente, cnpj, chave, protocolo, justificativa } = opcoes;
  const cUF = CODIGO_UF[uf.toUpperCase()];
  if (!cUF) throw new Error(`UF inválida: ${uf}`);
  if (justificativa.length < 15 || justificativa.length > 255) {
    throw new Error('A justificativa do cancelamento deve ter de 15 a 255 caracteres.');
  }
  const nSeq = opcoes.nSeq || 1;
  const id = `ID110111${chave}${pad(nSeq, 2)}`;
  const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
  return `<evento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<infEvento Id="${id}">` +
      `<cOrgao>${cUF}</cOrgao>` +
      `<tpAmb>${ambiente}</tpAmb>` +
      `<CNPJ>${pad(cnpj, 14)}</CNPJ>` +
      `<chNFe>${chave}</chNFe>` +
      `<dhEvento>${agoraFiscal()}</dhEvento>` +
      `<tpEvento>110111</tpEvento>` +
      `<nSeqEvento>${nSeq}</nSeqEvento>` +
      `<verEvento>1.00</verEvento>` +
      `<detEvento versao="1.00">` +
        `<descEvento>Cancelamento</descEvento>` +
        `<nProt>${esc(protocolo)}</nProt>` +
        `<xJust>${esc(justificativa)}</xJust>` +
      `</detEvento>` +
    `</infEvento>` +
  `</evento>`;
}

/** Extrai o 1º <evento>...</evento> já assinado (sem declaração xml). */
function soEvento(xmlAssinado: string): string {
  const m = xmlAssinado.match(/<evento[\s\S]*<\/evento>/);
  if (!m) throw new Error('XML de evento inválido.');
  return m[0];
}

/** Transmite o cancelamento (evento assinado) ao RecepcaoEvento4. */
export async function transmitirCancelamento(
  eventoAssinado: string,
  opcoes: { uf: string; ambiente: number; pfx: Buffer; senha: string },
): Promise<ResultadoEvento> {
  const { uf, ambiente, pfx, senha } = opcoes;
  const evento = soEvento(eventoAssinado);
  const envEvento =
    `<envEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
      `<idLote>${Date.now().toString().slice(-15)}</idLote>${evento}</envEvento>`;
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${envEvento}</nfeDadosMsg>` +
    `</soap:Body></soap:Envelope>`;
  const resposta = await postSoap(urlEvento(uf, ambiente), envelope, pfx, senha);

  const retEvento = resposta.match(/<retEvento[\s\S]*?<\/retEvento>/)?.[0] ?? resposta;
  const cStat = extrair(retEvento, 'cStat');
  const motivo = extrair(retEvento, 'xMotivo');
  const protocolo = extrair(retEvento, 'nProt');
  // 135 = registrado e vinculado; 136 = registrado sem vínculo; 155 = fora de prazo.
  const ok = cStat === '135' || cStat === '155';
  const procEvento = ok
    ? `<?xml version="1.0" encoding="UTF-8"?>` +
      `<procEventoNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">${evento}${retEvento}</procEventoNFe>`
    : resposta;
  return { ok, cStat, motivo, protocolo, xmlProc: procEvento, bruto: resposta };
}

/** Monta o <inutNFe> (faixa de numeração), SEM assinatura. */
export function montarInutilizacao(opcoes: {
  uf: string; ambiente: number; cnpj: string; ano: number; serie: number;
  numeroInicial: number; numeroFinal: number; justificativa: string;
}): string {
  const { uf, ambiente, cnpj, ano, serie, numeroInicial, numeroFinal, justificativa } = opcoes;
  const cUF = CODIGO_UF[uf.toUpperCase()];
  if (!cUF) throw new Error(`UF inválida: ${uf}`);
  if (justificativa.length < 15 || justificativa.length > 255) {
    throw new Error('A justificativa da inutilização deve ter de 15 a 255 caracteres.');
  }
  if (numeroFinal < numeroInicial) throw new Error('Número final menor que o inicial.');
  const aa = pad(ano, 2);
  const id = `ID${cUF}${aa}${pad(cnpj, 14)}65${pad(serie, 3)}${pad(numeroInicial, 9)}${pad(numeroFinal, 9)}`;
  const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
  return `<inutNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<infInut Id="${id}">` +
      `<tpAmb>${ambiente}</tpAmb>` +
      `<xServ>INUTILIZAR</xServ>` +
      `<cUF>${cUF}</cUF>` +
      `<ano>${aa}</ano>` +
      `<CNPJ>${pad(cnpj, 14)}</CNPJ>` +
      `<mod>65</mod>` +
      `<serie>${serie}</serie>` +
      `<nNFIni>${numeroInicial}</nNFIni>` +
      `<nNFFin>${numeroFinal}</nNFFin>` +
      `<xJust>${esc(justificativa)}</xJust>` +
    `</infInut>` +
  `</inutNFe>`;
}

function soInut(xmlAssinado: string): string {
  const m = xmlAssinado.match(/<inutNFe[\s\S]*<\/inutNFe>/);
  if (!m) throw new Error('XML de inutilização inválido.');
  return m[0];
}

/** Transmite a inutilização (assinada) ao NFeInutilizacao4. */
export async function transmitirInutilizacao(
  inutAssinado: string,
  opcoes: { uf: string; ambiente: number; pfx: Buffer; senha: string },
): Promise<ResultadoEvento> {
  const { uf, ambiente, pfx, senha } = opcoes;
  const inut = soInut(inutAssinado);
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4">${inut}</nfeDadosMsg>` +
    `</soap:Body></soap:Envelope>`;
  const resposta = await postSoap(urlInutilizacao(uf, ambiente), envelope, pfx, senha);

  const retInut = resposta.match(/<retInutNFe[\s\S]*?<\/retInutNFe>/)?.[0] ?? resposta;
  const cStat = extrair(retInut, 'cStat');
  const motivo = extrair(retInut, 'xMotivo');
  const protocolo = extrair(retInut, 'nProt');
  const ok = cStat === '102'; // inutilização homologada
  const xmlProc = ok
    ? `<?xml version="1.0" encoding="UTF-8"?>` +
      `<ProcInutNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${inut}${retInut}</ProcInutNFe>`
    : resposta;
  return { ok, cStat, motivo, protocolo, xmlProc, bruto: resposta };
}
