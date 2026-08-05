/**
 * BOTÕES DE LOGIN SOCIAL. O retorno do provedor é tratado em lib/login-social.ts.
 *
 * O botão é um LINK de navegação normal (`<a href>`), não fetch: o fluxo é uma
 * sequência de redirects (nossa API → provedor → nosso callback → de volta), e
 * qualquer tentativa de fazer isso por XHR bateria em CORS e na CSP. Ver
 * src/backend/oauth.ts pra o desenho inteiro e o porquê do salto de domínio.
 *
 * O componente só aparece quando o SERVIDOR diz que há provedor configurado. Botão
 * "Entrar com Google" que leva a um erro do Google é pior que não ter botão.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { lojaAtualId } from '@/lib/loja-atual';

type Provedor = 'google' | 'facebook';

const ROTULO: Record<Provedor, string> = { google: 'Google', facebook: 'Facebook' };

/** Logos em SVG inline: arquivo externo bateria na CSP (`img-src`) e num request extra. */
function LogoGoogle() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.27-4.74 3.27-8.09Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}
function LogoFacebook() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
      <path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.93-1.95 1.88v2.28h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07Z" />
    </svg>
  );
}

export function BotoesLoginSocial() {
  const [provedores, setProvedores] = useState<Provedor[]>([]);

  useEffect(() => {
    api<{ provedores: Provedor[] }>('GET', '/api/auth/oauth/provedores')
      .then(r => setProvedores(r.provedores || []))
      // Falha aqui não é erro pra mostrar: o login por senha continua na tela, e
      // um toast de "não conseguimos listar provedores" só assusta.
      .catch(() => setProvedores([]));
  }, []);

  if (provedores.length === 0) return null;

  return (
    <div className="mt-5">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">ou</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="mt-4 space-y-2">
        {provedores.map(p => {
          const q = new URLSearchParams({ voltar: '/conta' });
          // `loja_id` viaja pra o cadastro nascer amarrado à loja de origem —
          // mesmo isolamento white-label do cadastro por e-mail.
          const loja = lojaAtualId();
          if (loja) q.set('loja_id', String(loja));
          return (
            <a
              key={p}
              href={`/api/auth/oauth/${p}/iniciar?${q}`}
              className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-input bg-background text-sm font-bold transition-colors hover:bg-accent"
            >
              {p === 'google' ? <LogoGoogle /> : <LogoFacebook />}
              Entrar com {ROTULO[p]}
            </a>
          );
        })}
      </div>
    </div>
  );
}
