/**
 * Assinatura digital da NFC-e (XML-DSig) com certificado A1 (.pfx/.p12).
 * Tudo local — node-forge lê o certificado, xml-crypto assina. Sem terceiros.
 *
 * O padrão NFe exige: Reference URI="#NFe<chave>" (Id de infNFe),
 * Transforms enveloped + C14N, DigestMethod SHA1, SignatureMethod RSA-SHA1,
 * Canonicalization C14N (não exclusiva), e a <Signature> logo após infNFe.
 */
import crypto from 'crypto';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

/**
 * Converte a chave privada RSA de PKCS#1 (o que o node-forge gera, "BEGIN RSA
 * PRIVATE KEY") para PKCS#8 ("BEGIN PRIVATE KEY"). O OpenSSL 3 do Node 18
 * (Linux/Hostinger) recusa assinar SHA-1 com chave PKCS#1 — erro
 * "digital envelope routines::invalid digest". Reencodar em PKCS#8 resolve.
 */
function paraPkcs8(pemPkcs1: string): string {
  return crypto.createPrivateKey(pemPkcs1).export({ type: 'pkcs8', format: 'pem' }).toString();
}

export interface CertificadoLido {
  chavePrivadaPem: string;
  certificadoPem: string;
  titular: string;       // CN do certificado (razão social + CNPJ)
  validade: string;      // ISO da data de expiração
}

/** Extrai chave privada + certificado de um .pfx protegido por senha. */
export function lerCertificadoPfx(pfx: Buffer, senha: string): CertificadoLido {
  const p12Der = forge.util.createBuffer(pfx.toString('binary'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, senha);

  // Chave privada
  let chavePrivada: forge.pki.rsa.PrivateKey | null = null;
  for (const tipo of [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]) {
    const bags = p12.getBags({ bagType: tipo })[tipo] || [];
    if (bags.length && bags[0].key) { chavePrivada = bags[0].key as forge.pki.rsa.PrivateKey; break; }
  }
  if (!chavePrivada) throw new Error('Chave privada não encontrada no certificado.');
  // PKCS#8 (não PKCS#1): compatível com o OpenSSL 3 do Node 18 na assinatura SHA-1.
  const chavePrivadaPem = paraPkcs8(forge.pki.privateKeyToPem(chavePrivada));

  // Certificado do TITULAR = a folha, cuja chave pública casa com a chave privada.
  // (O .pfx traz a cadeia inteira; a raiz da ICP-Brasil tem validade mais longa,
  // então "pegar o de maior validade" pegava a RAIZ por engano.)
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const certs = certBags.map(b => b.cert).filter((c): c is forge.pki.Certificate => !!c);
  if (!certs.length) throw new Error('Certificado não encontrado no arquivo.');
  const modPriv = chavePrivada.n.toString(16);
  let cert = certs.find(c => (c.publicKey as forge.pki.rsa.PublicKey).n?.toString(16) === modPriv);
  if (!cert) {
    // Fallback: o certificado folha não é CA (basicConstraints cA=false ou ausente).
    cert = certs.find(c => {
      const bc = c.getExtension('basicConstraints') as { cA?: boolean } | undefined;
      return !bc || !bc.cA;
    }) || certs[0];
  }
  const certificadoPem = forge.pki.certificateToPem(cert);
  const cn = cert.subject.getField('CN');

  return {
    chavePrivadaPem,
    certificadoPem,
    titular: cn ? cn.value : 'Certificado',
    validade: cert.validity.notAfter.toISOString(),
  };
}

/** Valida a senha do .pfx (lança se inválida) e devolve os dados do titular. */
export function validarCertificado(pfx: Buffer, senha: string): CertificadoLido {
  try {
    return lerCertificadoPfx(pfx, senha);
  } catch (e) {
    throw new Error('Não foi possível abrir o certificado: senha incorreta ou arquivo inválido.');
  }
}

/** PEM → conteúdo base64 puro (sem cabeçalhos), p/ a tag <X509Certificate>. */
function pemCorpo(pem: string): string {
  return pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
}

/**
 * Assina um elemento do XML pelo seu local-name (que deve ter atributo Id).
 * A <Signature> é inserida após o elemento indicado em `apos` (padrão: o próprio
 * referenciado). Serve para infNFe (nota), infEvento (cancelamento) e infInut.
 */
export function assinarPorTag(xml: string, cert: CertificadoLido, localName: string, apos?: string): string {
  const alvo = `//*[local-name(.)='${localName}']`;
  const localInsercao = `//*[local-name(.)='${apos || localName}']`;
  const sig = new SignedXml({
    privateKey: cert.chavePrivadaPem,
    publicCert: cert.certificadoPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });

  sig.addReference({
    xpath: alvo,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });

  // Inclui o X509Certificate no KeyInfo (exigido pela SEFAZ).
  sig.getKeyInfoContent = () => `<X509Data><X509Certificate>${pemCorpo(cert.certificadoPem)}</X509Certificate></X509Data>`;

  sig.computeSignature(xml, { location: { reference: localInsercao, action: 'after' } });
  return sig.getSignedXml();
}

/**
 * Assina o XML da NFC-e. `xml` deve conter <infNFe Id="NFe<chave>">.
 * Schema 4.00 exige a ordem infNFe → infNFeSupl → Signature, então a assinatura
 * vai DEPOIS do infNFeSupl (quando presente) — senão a SEFAZ rejeita (cStat 225).
 */
export function assinarXmlNfce(xml: string, cert: CertificadoLido): string {
  const apos = xml.includes('infNFeSupl') ? 'infNFeSupl' : 'infNFe';
  return assinarPorTag(xml, cert, 'infNFe', apos);
}
