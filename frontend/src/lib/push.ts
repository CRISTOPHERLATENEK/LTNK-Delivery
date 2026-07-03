/**
 * Inscrição em Web Push no lado do cliente.
 *
 * Fluxo: pede permissão → pega a chave pública VAPID do servidor → inscreve no
 * PushManager via service worker → envia a inscrição para o backend salvar.
 * Funciona tanto no PWA instalado quanto no navegador comum.
 */
import { api } from './api';

export type EstadoPush = 'sem-suporte' | 'negado' | 'inativo' | 'ativo';

/** Converte a chave VAPID base64-url para o Uint8Array que o PushManager exige. */
function base64ParaUint8(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base);
  const buffer = new ArrayBuffer(raw.length);
  const saida = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) saida[i] = raw.charCodeAt(i);
  return saida;
}

export function suportaPush(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Estado atual sem disparar pedido de permissão. */
export async function estadoPush(): Promise<EstadoPush> {
  if (!suportaPush()) return 'sem-suporte';
  if (Notification.permission === 'denied') return 'negado';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'ativo' : 'inativo';
  } catch {
    return 'inativo';
  }
}

/**
 * Ativa as notificações: pede permissão, inscreve e registra no backend.
 * Retorna o novo estado. Deve ser chamado a partir de um clique do usuário.
 */
export async function ativarPush(): Promise<EstadoPush> {
  if (!suportaPush()) return 'sem-suporte';

  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') return permissao === 'denied' ? 'negado' : 'inativo';

  const { chave } = await api<{ chave: string }>('GET', '/api/push/chave-publica');
  if (!chave) return 'inativo';

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ParaUint8(chave),
    });
  }

  await api('POST', '/api/push/inscrever', { inscricao: sub.toJSON() });
  return 'ativo';
}

/** Desativa as notificações neste dispositivo. */
export async function desativarPush(): Promise<EstadoPush> {
  if (!suportaPush()) return 'sem-suporte';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('POST', '/api/push/cancelar', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* ignora */ }
  return 'inativo';
}
