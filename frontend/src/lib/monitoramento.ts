/**
 * Monitoramento de erro em produção (Sentry) — best-effort e opcional.
 * Sem VITE_SENTRY_DSN configurado no build, vira no-op silencioso.
 * Mesmo par do backend (ver src/backend/monitoramento.ts).
 */
import * as Sentry from '@sentry/react';

export function iniciarMonitoramento(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return; // sem DSN, sem monitoramento — silencioso, não é erro
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  });
}
