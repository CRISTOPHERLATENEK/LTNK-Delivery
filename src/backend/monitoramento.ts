/**
 * Monitoramento de erro em produção (Sentry) — best-effort e opcional.
 *
 * Sem SENTRY_DSN configurado, tudo aqui vira no-op silencioso: nenhuma
 * chamada de captura lança nem trava o servidor. O objetivo é ter rastro
 * automático (stack trace, contexto) de erros em produção sem precisar
 * reproduzir localmente — como tivemos que fazer manualmente pra achar o
 * bug de assinatura do certificado A1.
 *
 * Cadastre-se em https://sentry.io (plano grátis cobre um projeto pequeno),
 * crie um projeto Node, copie o DSN e cole na variável SENTRY_DSN.
 */
import * as Sentry from '@sentry/node';

let ativo = false;

export function iniciarMonitoramento(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.warn('[SENTRY] SENTRY_DSN não definido — monitoramento de erros desativado.');
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1, // amostra 10% das transações (custo x visibilidade)
  });
  ativo = true;
  console.log('[SENTRY] Monitoramento de erros ativado.');
}

/** Reporta um erro ao Sentry (se configurado) — nunca lança. */
export function capturarErro(erro: unknown, contexto?: Record<string, unknown>): void {
  if (!ativo) return;
  try {
    Sentry.captureException(erro, contexto ? { extra: contexto } : undefined);
  } catch { /* monitoramento não pode derrubar o app */ }
}

/** Dá tempo do Sentry mandar o erro antes do processo morrer (uncaughtException etc.). */
export async function drenarMonitoramento(timeoutMs = 2000): Promise<void> {
  if (!ativo) return;
  try { await Sentry.close(timeoutMs); } catch { /* ignore */ }
}
