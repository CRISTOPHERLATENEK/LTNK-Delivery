/**
 * Web Push (notificações no celular mesmo com o app fechado).
 *
 * Usa VAPID (chaves em .env). Cada usuário pode ter várias inscrições
 * (um por navegador/dispositivo). Inscrições mortas (410/404) são removidas
 * automaticamente ao falhar o envio.
 */
import webpush from 'web-push';
import db from './db-mysql';
import { agoraUTC } from './util';

const PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE = process.env.VAPID_PRIVATE_KEY || '';

/**
 * O `web-push` exige que o subject seja uma URL válida (http/https) OU um
 * `mailto:`. Um valor mal formatado (ex.: e-mail cru sem "mailto:") faz o
 * setVapidDetails LANÇAR — e como isso roda na carga do módulo, derrubava o
 * servidor INTEIRO no boot. Aqui a gente normaliza (adiciona "mailto:" se
 * vier só um e-mail) e, no pior caso, o push é desativado — NUNCA derruba o app.
 */
function normalizarSubject(bruto: string | undefined): string {
  const s = (bruto || '').trim();
  if (!s) return 'mailto:contato@exemplo.com';
  if (/^(https?:|mailto:)/i.test(s)) return s;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return `mailto:${s}`; // e-mail cru → mailto:
  return 'mailto:contato@exemplo.com'; // formato desconhecido → fallback seguro
}

const SUBJECT = normalizarSubject(process.env.VAPID_SUBJECT);

export let pushHabilitado = !!(PUBLIC && PRIVATE);

if (pushHabilitado) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
  } catch (e) {
    pushHabilitado = false;
    console.warn('[PUSH] VAPID inválido — push desativado (não derruba o servidor):', (e as Error).message);
  }
} else {
  console.warn('[PUSH] VAPID não configurado — notificações push desativadas.');
}

export function chavePublicaVapid(): string {
  return PUBLIC;
}

interface InscricaoBruta {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Salva (ou atualiza) uma inscrição de push para o usuário. */
export async function salvarInscricao(usuarioId: number, sub: InscricaoBruta): Promise<void> {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    throw Object.assign(new Error('Inscrição de push inválida.'), { statusHttp: 400 });
  }
  await db.prepare(
    `INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth, criado_em)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       usuario_id = VALUES(usuario_id),
       p256dh     = VALUES(p256dh),
       auth       = VALUES(auth)`
  ).run(usuarioId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, agoraUTC());
}

/** Remove uma inscrição (ex.: usuário desativou notificações). */
export async function removerInscricao(endpoint: string): Promise<void> {
  await db.prepare('DELETE FROM push_inscricoes WHERE endpoint = ?').run(endpoint);
}

interface PayloadPush {
  titulo: string;
  corpo: string;
  url?: string;
  tag?: string;
}

/**
 * Envia uma notificação push para TODOS os dispositivos de um usuário.
 * Retorna quantos envios tiveram sucesso. Não lança — apenas registra falhas.
 */
export async function enviarPush(usuarioId: number, payload: PayloadPush): Promise<number> {
  if (!pushHabilitado) return 0;

  const inscricoes = await db.prepare(
    'SELECT endpoint, p256dh, auth FROM push_inscricoes WHERE usuario_id = ?'
  ).all(usuarioId) as Array<{ endpoint: string; p256dh: string; auth: string }>;

  const corpo = JSON.stringify(payload);
  let sucessos = 0;

  await Promise.all(inscricoes.map(async (i) => {
    try {
      await webpush.sendNotification(
        { endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } },
        corpo,
      );
      sucessos++;
    } catch (e: any) {
      // 404/410 = inscrição expirada/cancelada: limpa do banco.
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await removerInscricao(i.endpoint);
      } else {
        console.error('[PUSH] falha ao enviar:', e?.statusCode || e?.message);
      }
    }
  }));

  return sucessos;
}
