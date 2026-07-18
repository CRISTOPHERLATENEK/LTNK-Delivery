/**
 * NFC-e (modelo 65, leiaute 4.00) — geração PRÓPRIA do XML, sem API de terceiros.
 *
 * ⚠️ FUNDAÇÃO determinística: chave de acesso, XML e hash do QR Code.
 * Ainda FALTAM (fases seguintes, dependem do seu certificado/SEFAZ):
 *   - Assinatura digital XML-DSig com certificado A1 (.pfx)
 *   - Transmissão SOAP + TLS mútuo nos web services da SEFAZ (por UF)
 *   - Validação contra o XSD oficial e homologação no estado
 *   - Cancelamento, inutilização, contingência
 * Os valores fiscais (NCM/CSOSN/CFOP) devem ser conferidos pelo contador.
 */
import crypto from 'crypto';

/** Código IBGE da UF (cUF) — primeiros 2 dígitos da chave de acesso. */
export const CODIGO_UF: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
  MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29',
  MG: '31', ES: '32', RJ: '33', SP: '35',
  PR: '41', SC: '42', RS: '43',
  MS: '50', MT: '51', GO: '52', DF: '53',
};

export interface EmitenteNfce {
  cnpj: string; ie: string; razaoSocial: string; nomeFantasia: string;
  crt: number;            // 1 = Simples Nacional
  uf: string;             // sigla (SP, MG…)
  cMun: string;           // código IBGE do município (7 dígitos)
  municipio: string;
  logradouro: string; numero: string; bairro: string; cep: string;
  csc: string; cscId: string;
  ambiente: number;       // 1 = produção, 2 = homologação
  serie: number;
  // Responsável técnico (obrigatório na v4.00) — a software house.
  respTecCnpj?: string; respTecContato?: string; respTecEmail?: string; respTecFone?: string;
}

export interface ItemNfce {
  codigo: string; descricao: string;
  ncm: string; cfop: string; csosn: string; origem: string; cest?: string;
  unidade: string; quantidade: number; valorUnitCentavos: number; valorTotalCentavos: number;
}

export interface VendaNfce {
  numero: number;
  dataEmissao: Date;
  itens: ItemNfce[];
  pagamentos: Array<{ tipo: 'dinheiro' | 'pix' | 'cartao'; valorCentavos: number }>;
  totalCentavos: number;        // BRUTO — soma dos produtos (vira <vProd>)
  descontoCentavos?: number;    // desconto/cupom do pedido (vira <vDesc>); vNF = total - desconto
}

/* ───────────────────────── chave de acesso ───────────────────────── */

/** Dígito verificador da chave (módulo 11, pesos 2..9 da direita). */
export function digitoVerificador(chave43: string): string {
  let soma = 0, peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = 11 - resto;
  return String(dv >= 10 ? 0 : dv);
}

const pad = (v: string | number, n: number) => String(v).replace(/\D/g, '').padStart(n, '0').slice(-n);

/** Monta a chave de 44 dígitos. cNF aleatório (8) é retornado junto. */
export function gerarChaveAcesso(emit: EmitenteNfce, venda: VendaNfce, tpEmis = 1): { chave: string; cNF: string } {
  const cUF = CODIGO_UF[emit.uf.toUpperCase()];
  if (!cUF) throw new Error(`UF inválida para NFC-e: ${emit.uf}`);
  const d = venda.dataEmissao;
  const aamm = String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1, 2);
  const cNF = pad(Math.floor(Math.random() * 1e8), 8);
  const base =
    cUF +
    aamm +
    pad(emit.cnpj, 14) +
    '65' +                       // modelo NFC-e
    pad(emit.serie, 3) +
    pad(venda.numero, 9) +
    String(tpEmis) +
    cNF;
  return { chave: base + digitoVerificador(base), cNF };
}

/* ───────────────────────── QR Code (NFC-e online) ───────────────────────── */

/**
 * Hash SHA-1 do QR Code (versão 2, online): inclui o CSC no final.
 * O cIdToken vai SEM zeros à esquerda (ex.: "2", não "000002") — o MESMO valor
 * que aparece na URL, senão o hash não confere e a SEFAZ rejeita o QR.
 */
export function hashQrCode(chave: string, tpAmb: number, cscId: string, csc: string): string {
  const idToken = String(Number(cscId));
  // Hash = SHA1( chave|versao|tpAmb|idToken + CSC ) — SEM pipe entre idToken e CSC
  // (confirmado autorizando na SEFAZ-SC; o pipe a mais dava cStat 464).
  const semHash = `${chave}|2|${tpAmb}|${idToken}`;
  return crypto.createHash('sha1').update(semHash + csc).digest('hex');
}

/** Parâmetro `p` do QR Code (sem a URL base, que é por UF). */
export function paramQrCode(chave: string, tpAmb: number, cscId: string, csc: string): string {
  const idToken = String(Number(cscId));
  return `${chave}|2|${tpAmb}|${idToken}|${hashQrCode(chave, tpAmb, cscId, csc)}`;
}

/**
 * URL de consulta do QR Code da NFC-e por UF [homologação, produção].
 * ⚠️ Confirme no portal da SEFAZ do seu estado — podem mudar.
 */
export const URL_QRCODE: Record<string, [string, string]> = {
  SC: ['https://hom.sat.sef.sc.gov.br/nfce/consulta', 'https://sat.sef.sc.gov.br/nfce/consulta'],
  SP: ['https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode', 'https://www.nfce.fazenda.sp.gov.br/qrcode'],
  MG: ['https://hnfce.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml', 'https://nfce.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml'],
  PR: ['http://www.fazenda.pr.gov.br/nfce/qrcode', 'http://www.fazenda.pr.gov.br/nfce/qrcode'],
  RS: ['https://www.sefazrs.rs.gov.br/NFCE/NFCE-COM.aspx', 'https://www.sefazrs.rs.gov.br/NFCE/NFCE-COM.aspx'],
  RJ: ['http://www4.fazenda.rj.gov.br/consultaNFCe/QRCode', 'http://www4.fazenda.rj.gov.br/consultaNFCe/QRCode'],
  BA: ['http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx', 'http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx'],
  GO: ['http://www.homolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe', 'http://www.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe'],
  DF: ['http://www.fazenda.df.gov.br/nfce/qrcode', 'http://www.fazenda.df.gov.br/nfce/qrcode'],
};

/** URL completa do QR Code (base da UF + parâmetro). */
export function urlQrCode(uf: string, chave: string, tpAmb: number, cscId: string, csc: string): string {
  const par = URL_QRCODE[uf.toUpperCase()];
  const base = par ? par[tpAmb === 1 ? 1 : 0] : `https://www.fazenda.${uf.toLowerCase()}.gov.br/nfce/qrcode`;
  return `${base}?p=${paramQrCode(chave, tpAmb, cscId, csc)}`;
}

/* ───────────────────────── XML ───────────────────────── */

const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
const reais = (centavos: number) => (centavos / 100).toFixed(2);
const TPAG: Record<string, string> = { dinheiro: '01', cartao: '03', pix: '17' };

/** Grupo de ICMS do Simples Nacional conforme o CSOSN (leiaute 4.00). */
function grupoIcmsSN(item: ItemNfce): string {
  const orig = item.origem || '0';
  const csosn = item.csosn || '102';
  switch (csosn) {
    case '500':
      return `<ICMSSN500><orig>${orig}</orig><CSOSN>500</CSOSN></ICMSSN500>`;
    case '900':
      // Tributada pelo SN com permissão de crédito — valores zerados (sem cálculo do ICMS próprio).
      return `<ICMSSN900><orig>${orig}</orig><CSOSN>900</CSOSN>` +
        `<modBC>3</modBC><vBC>0.00</vBC><pRedBC>0.00</pRedBC><pICMS>0.00</pICMS><vICMS>0.00</vICMS>` +
        `</ICMSSN900>`;
    default:
      // 102, 103, 300, 400 — sem permissão de crédito / isenção.
      return `<ICMSSN102><orig>${orig}</orig><CSOSN>${esc(csosn)}</CSOSN></ICMSSN102>`;
  }
}

function detItem(item: ItemNfce, i: number): string {
  const q = item.quantidade.toFixed(4);
  const vUn = (item.valorUnitCentavos / 100).toFixed(2);
  const vProd = reais(item.valorTotalCentavos);
  return `<det nItem="${i}">` +
    `<prod>` +
      `<cProd>${esc(item.codigo)}</cProd>` +
      `<cEAN>SEM GTIN</cEAN>` +
      `<xProd>${esc(item.descricao)}</xProd>` +
      `<NCM>${esc(item.ncm || '00000000')}</NCM>` +
      (item.cest ? `<CEST>${esc(item.cest)}</CEST>` : '') +
      `<CFOP>${esc(item.cfop || '5102')}</CFOP>` +
      `<uCom>${esc(item.unidade || 'UN')}</uCom>` +
      `<qCom>${q}</qCom>` +
      `<vUnCom>${vUn}</vUnCom>` +
      `<vProd>${vProd}</vProd>` +
      `<cEANTrib>SEM GTIN</cEANTrib>` +
      `<uTrib>${esc(item.unidade || 'UN')}</uTrib>` +
      `<qTrib>${q}</qTrib>` +
      `<vUnTrib>${vUn}</vUnTrib>` +
      `<indTot>1</indTot>` +
    `</prod>` +
    `<imposto>` +
      `<ICMS>${grupoIcmsSN(item)}</ICMS>` +
      // Simples Nacional: PIS/COFINS "outras operações" (CST 49) com valores zerados.
      `<PIS><PISOutr><CST>49</CST><vBC>0.00</vBC><pPIS>0.0000</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>` +
      `<COFINS><COFINSOutr><CST>49</CST><vBC>0.00</vBC><pCOFINS>0.0000</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>` +
    `</imposto>` +
  `</det>`;
}

/**
 * Monta o XML <NFe> SEM assinatura (a assinatura é uma fase seguinte).
 * Retorna { xml, chave } — a chave também vai no Id de infNFe ("NFe"+chave).
 */
export function montarXmlNfce(emit: EmitenteNfce, venda: VendaNfce): { xml: string; chave: string } {
  if (!CODIGO_UF[emit.uf.toUpperCase()]) throw new Error(`UF inválida: ${emit.uf}`);
  const tpEmis = 1;
  const { chave, cNF } = gerarChaveAcesso(emit, venda, tpEmis);
  const cUF = CODIGO_UF[emit.uf.toUpperCase()];

  // dhEmi no formato YYYY-MM-DDThh:mm:ss-03:00
  const d = venda.dataEmissao;
  const z = (n: number) => pad(n, 2);
  const dhEmi = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}-03:00`;

  const vProd = reais(venda.totalCentavos);
  // Desconto (cupom/manual): entra como <vDesc> no total e reduz <vNF>, mantendo
  // vNF = vProd - vDesc e detPag = vNF (senão a SEFAZ rejeita por divergência).
  const descontoCentavos = Math.min(Math.max(venda.descontoCentavos || 0, 0), venda.totalCentavos);
  const vDesc = reais(descontoCentavos);
  const vNF = reais(venda.totalCentavos - descontoCentavos);
  // Homologação: a SEFAZ exige que o 1º item tenha ESTA descrição exata (cStat 373).
  const HOMOLOG_XPROD = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
  const dets = venda.itens.map((it, idx) => {
    const item = (emit.ambiente === 2 && idx === 0) ? { ...it, descricao: HOMOLOG_XPROD } : it;
    return detItem(item, idx + 1);
  }).join('');
  const pags = venda.pagamentos.map(p =>
    `<detPag><tPag>${TPAG[p.tipo] || '99'}</tPag><vPag>${reais(p.valorCentavos)}</vPag></detPag>`
  ).join('');

  const infNFe =
    `<infNFe Id="NFe${chave}" versao="4.00">` +
      `<ide>` +
        `<cUF>${cUF}</cUF>` +
        `<cNF>${cNF}</cNF>` +
        `<natOp>VENDA DE MERCADORIA AO CONSUMIDOR</natOp>` +
        `<mod>65</mod>` +
        `<serie>${emit.serie}</serie>` +
        `<nNF>${venda.numero}</nNF>` +
        `<dhEmi>${dhEmi}</dhEmi>` +
        `<tpNF>1</tpNF>` +
        `<idDest>1</idDest>` +
        `<cMunFG>${esc(emit.cMun)}</cMunFG>` +
        `<tpImp>4</tpImp>` +            // 4 = NFC-e (DANFE em formato bobina)
        `<tpEmis>${tpEmis}</tpEmis>` +
        `<cDV>${chave.slice(-1)}</cDV>` +
        `<tpAmb>${emit.ambiente}</tpAmb>` +
        `<finNFe>1</finNFe>` +
        `<indFinal>1</indFinal>` +      // consumidor final
        `<indPres>1</indPres>` +        // presencial
        `<indIntermed>0</indIntermed>` +// 0 = operação sem intermediador
        `<procEmi>0</procEmi>` +
        `<verProc>delivery-1.0</verProc>` +
      `</ide>` +
      `<emit>` +
        `<CNPJ>${pad(emit.cnpj, 14)}</CNPJ>` +
        `<xNome>${esc(emit.razaoSocial)}</xNome>` +
        (emit.nomeFantasia ? `<xFant>${esc(emit.nomeFantasia)}</xFant>` : '') +
        `<enderEmit>` +
          `<xLgr>${esc(emit.logradouro)}</xLgr>` +
          `<nro>${esc(emit.numero || 'S/N')}</nro>` +
          `<xBairro>${esc(emit.bairro)}</xBairro>` +
          `<cMun>${esc(emit.cMun)}</cMun>` +
          `<xMun>${esc(emit.municipio)}</xMun>` +
          `<UF>${esc(emit.uf.toUpperCase())}</UF>` +
          `<CEP>${pad(emit.cep, 8)}</CEP>` +
          `<cPais>1058</cPais><xPais>BRASIL</xPais>` +
        `</enderEmit>` +
        `<IE>${esc(emit.ie)}</IE>` +
        `<CRT>${emit.crt}</CRT>` +
      `</emit>` +
      dets +
      `<total><ICMSTot>` +
        `<vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson>` +
        `<vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>` +
        `<vProd>${vProd}</vProd>` +
        `<vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>${vDesc}</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol>` +
        `<vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro>` +
        `<vNF>${vNF}</vNF>` +
      `</ICMSTot></total>` +
      `<transp><modFrete>9</modFrete></transp>` +
      `<pag>${pags}</pag>` +
      // Responsável técnico (obrigatório v4.00). Padrão: o próprio emitente.
      `<infRespTec>` +
        `<CNPJ>${pad(emit.respTecCnpj || emit.cnpj, 14)}</CNPJ>` +
        `<xContato>${esc(emit.respTecContato || emit.razaoSocial)}</xContato>` +
        `<email>${esc(emit.respTecEmail || 'suporte@maxxtalk.com.br')}</email>` +
        `<fone>${pad(emit.respTecFone || '4830000000', 10)}</fone>` +
      `</infRespTec>` +
    `</infNFe>`;

  // infNFeSupl: obrigatório na NFC-e — QR Code e URL de consulta da chave.
  const qrUrl = emit.csc
    ? urlQrCode(emit.uf, chave, emit.ambiente, emit.cscId, emit.csc)
    : '';
  const urlChaveConsulta = URL_QRCODE[emit.uf.toUpperCase()]?.[emit.ambiente === 1 ? 1 : 0] ?? '';
  // qrCode e urlChave vão em CDATA (padrão da NFC-e) — a SEFAZ rejeita a URL crua.
  const supl = qrUrl
    ? `<infNFeSupl><qrCode><![CDATA[${qrUrl}]]></qrCode><urlChave><![CDATA[${urlChaveConsulta}]]></urlChave></infNFeSupl>`
    : '';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>` +
    `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}${supl}</NFe>`;
  return { xml, chave };
}
