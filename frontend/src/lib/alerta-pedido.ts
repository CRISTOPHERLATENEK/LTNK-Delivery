/**
 * Alerta de novo pedido para o lojista.
 *
 * - Som chamativo (Web Audio) que não depende de arquivo.
 * - Notificação do navegador (Notification API) que aparece MESMO com a aba
 *   em segundo plano ou minimizada.
 * - Lembrete recorrente enquanto houver pedidos pendentes e a aba não estiver
 *   em foco — para o lojista não perder pedido por estar em outra tela.
 */

let permissaoPedida = false;

/** Pede permissão de notificação uma única vez (idealmente após um clique). */
export async function garantirPermissaoNotificacao(): Promise<void> {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default' && !permissaoPedida) {
    permissaoPedida = true;
    try { await Notification.requestPermission(); } catch { /* ignora */ }
  }
}

/** Toca uma sequência de beeps. `repeticoes` controla a insistência. */
export function tocarAlerta(repeticoes = 3): void {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new Ctx();
    const dur = 0.18;
    const intervalo = 0.26;
    for (let i = 0; i < repeticoes; i++) {
      const t0 = ctx.currentTime + i * intervalo;
      const osc = ctx.createOscillator();
      const ganho = ctx.createGain();
      osc.type = 'sine';
      // alterna duas notas para um som de "campainha"
      osc.frequency.value = i % 2 === 0 ? 988 : 1319;
      ganho.gain.setValueAtTime(0.0001, t0);
      ganho.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
      ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(ganho).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur);
    }
    // libera o contexto após terminar
    setTimeout(() => ctx.close().catch(() => {}), (repeticoes * intervalo + 0.3) * 1000);
  } catch { /* navegador pode bloquear áudio até a 1ª interação */ }
}

/** Dispara som + notificação do navegador para um novo pedido. */
export function notificarNovoPedido(titulo: string, corpo: string): void {
  tocarAlerta(3);
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(titulo, {
        body: corpo,
        tag: 'novo-pedido',
        icon: '/favicon.ico',
        // @ts-expect-error — renotify existe nos navegadores, faltando no lib.dom
        renotify: true,
      });
      n.onclick = () => { window.focus(); n.close(); };
    }
  } catch { /* ignora */ }
}

/* ───────── lembrete recorrente enquanto há pendentes em segundo plano ───────── */

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Mantém um lembrete sonoro a cada `segundos` enquanto `temPendentes()` for
 * verdadeiro E a aba estiver em segundo plano. Chame com a contagem atual.
 */
export function sincronizarLembrete(temPendentes: () => boolean, segundos = 20): void {
  pararLembrete();
  timer = setInterval(() => {
    if (temPendentes() && document.visibilityState === 'hidden') {
      tocarAlerta(2);
    }
  }, segundos * 1000);
}

export function pararLembrete(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
