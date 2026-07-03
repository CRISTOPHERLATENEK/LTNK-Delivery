/**
 * Web Push (notificações no celular mesmo com o app fechado).
 *
 * Usa VAPID (chaves em .env). Cada usuário pode ter várias inscrições
 * (um por navegador/dispositivo). Inscrições mortas (410/404) são removidas
 * automaticamente ao falhar o envio.
 */
import webpush from 'web-push';
import db from './db';
import { agoraUTC } from './util';

const PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contato@exemplo.com';

export const pushHabilitado = !!(PUBLIC && PRIVATE);

if (pushHabilitado) {
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
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
export function salvarInscricao(usuarioId: number, sub: InscricaoBruta): void {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    throw Object.assign(new Error('Inscrição de push inválida.'), { statusHttp: 400 });
  }
  db.prepare(
    `INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth, criado_em)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       usuario_id = excluded.usuario_id,
       p256dh     = excluded.p256dh,
       auth       = excluded.auth`
  ).run(usuarioId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, agoraUTC());
}

/** Remove uma inscrição (ex.: usuário desativou notificações). */
export function removerInscricao(endpoint: string): void {
  db.prepare('DELETE FROM push_inscricoes WHERE endpoint = ?').run(endpoint);
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

  const inscricoes = db.prepare(
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
        removerInscricao(i.endpoint);
      } else {
        console.error('[PUSH] falha ao enviar:', e?.statusCode || e?.message);
      }
    }
  }));

  return sucessos;
}
