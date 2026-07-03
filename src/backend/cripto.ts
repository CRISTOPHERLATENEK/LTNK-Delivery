/**
 * Criptografia simétrica para segredos em repouso (ex.: senha do certificado A1).
 * AES-256-GCM com chave derivada de APP_SECRET (ou JWT_SECRET) do ambiente.
 *
 * Formato guardado: base64( salt(16) | iv(12) | tag(16) | ciphertext ).
 */
import crypto from 'crypto';

/**
 * Chave-mestra dos segredos em repouso. PREFERE um APP_SECRET dedicado
 * (separado do JWT_SECRET, pra rotacionar um sem quebrar o outro).
 *  - Produção (NODE_ENV=production): APP_SECRET é OBRIGATÓRIO.
 *  - Dev: se faltar, cai no JWT_SECRET com aviso. Sem fallback fixo/fraco.
 *
 * ⚠️ Trocar a chave torna ilegíveis os segredos já criptografados (certificado,
 * CSC, token MP) — re-cadastre-os após mudar a chave.
 */
function obterSegredo(): string {
  const app = process.env.APP_SECRET;
  if (app && app.length >= 16) return app;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('ERRO FATAL: defina APP_SECRET (≥32 caracteres) no .env para criptografar segredos em produção.');
  }
  const jwt = process.env.JWT_SECRET;
  if (jwt) {
    console.warn('[SEGURANÇA] APP_SECRET não definido — usando JWT_SECRET como fallback (apenas dev). Defina um APP_SECRET dedicado.');
    return jwt;
  }
  throw new Error('Defina APP_SECRET (ou ao menos JWT_SECRET) no .env.');
}

const SEGREDO = obterSegredo();

function derivar(salt: Buffer): Buffer {
  return crypto.scryptSync(SEGREDO, salt, 32);
}

export function criptografar(texto: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const chave = derivar(salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave, iv);
  const enc = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, enc]).toString('base64');
}

export function descriptografar(guardado: string): string {
  const buf = Buffer.from(guardado, 'base64');
  const salt = buf.subarray(0, 16);
  const iv = buf.subarray(16, 28);
  const tag = buf.subarray(28, 44);
  const enc = buf.subarray(44);
  const chave = derivar(salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', chave, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
