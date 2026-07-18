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
  const ehProducao = process.env.NODE_ENV === 'production';
  // Produção exige ≥32 (a doc/.env.example prometem isso); dev aceita ≥16 com aviso.
  if (app) {
    const minimo = ehProducao ? 32 : 16;
    if (app.length >= minimo) return app;
    if (ehProducao) {
      throw new Error(`ERRO FATAL: APP_SECRET tem ${app.length} caracteres — defina ≥32 no .env para criptografar segredos em produção.`);
    }
    console.warn(`[SEGURANÇA] APP_SECRET curto (${app.length} caracteres) — use ≥32. Aceito apenas em desenvolvimento.`);
    return app;
  }

  if (ehProducao) {
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

/**
 * Segredos candidatos para DESCRIPTOGRAFAR (na ordem de preferência). Além do
 * segredo atual, tenta o JWT_SECRET — assim um segredo cifrado ANTES de o
 * APP_SECRET existir (quando caía no JWT_SECRET) continua legível depois que o
 * APP_SECRET foi adicionado. Evita "certificado instalado mas não assina".
 */
function segredosCandidatos(): string[] {
  const lista = [SEGREDO];
  const jwt = process.env.JWT_SECRET;
  if (jwt && !lista.includes(jwt)) lista.push(jwt);
  return lista;
}

function derivar(salt: Buffer, segredo: string): Buffer {
  return crypto.scryptSync(segredo, salt, 32);
}

export function criptografar(texto: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const chave = derivar(salt, SEGREDO);
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
  let ultimoErro: unknown;
  for (const segredo of segredosCandidatos()) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', derivar(salt, segredo), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    } catch (e) { ultimoErro = e; /* tenta o próximo segredo */ }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error('Falha ao descriptografar o segredo.');
}
