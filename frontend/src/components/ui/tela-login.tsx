/**
 * Moldura das telas de login — lojista, entregador, cozinha e admin.
 *
 * NÃO NASCEU DE "código repetido", e sim de código que DIVERGIU. As quatro telas
 * eram variações da mesma ideia, e cada uma foi evoluindo sozinha: a do lojista
 * ganhou mostrar/ocultar senha e `autoComplete`, a da cozinha ficou sem os dois e
 * ainda sem link de recuperação de senha — quem esquecia a senha do tablet
 * dependia do lojista. Com a moldura única, melhorar uma melhora as quatro.
 *
 * O que NÃO vem pra cá: o `POST`, a chave de sessão e o que cada área faz depois
 * de entrar. Isso é fluxo, é diferente em cada uma, e centralizar viraria um
 * componente com quatro caminhos por dentro.
 */
import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';

interface TelaLoginProps {
  /** Ícone da área (ChefHat na cozinha, Bike no entregador…). */
  icone: React.ReactNode;
  titulo: string;
  subtitulo?: string;
  /** O formulário em si — cada tela monta o seu. */
  children: React.ReactNode;
  /** Linha de apoio no fim (ex.: "a conta é criada pelo lojista"). */
  rodape?: React.ReactNode;
}

export function TelaLogin({ icone, titulo, subtitulo, children, rodape }: TelaLoginProps) {
  return (
    /*
     * `min-h-dvh` e não `min-h-screen`: no celular, `vh` inclui a barra do
     * navegador que some ao rolar, e o formulário ficava cortado embaixo.
     * O padding vertical generoso é o que salva quando o teclado sobe.
     */
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-br from-primary/5 via-background to-background p-5 py-10 text-foreground">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-primary text-primary-foreground">
            {icone}
          </div>
          <h1 className="text-2xl font-extrabold">{titulo}</h1>
          {subtitulo && <p className="text-sm text-muted-foreground">{subtitulo}</p>}
        </div>

        <Card>
          <CardContent className="p-6">{children}</CardContent>
        </Card>

        {rodape && <div className="text-center text-sm text-muted-foreground">{rodape}</div>}
      </div>
    </div>
  );
}

/**
 * Campo de senha com botão de mostrar/ocultar.
 *
 * Existe porque o alvo do olho precisa ter 44px e ficar DENTRO do campo sem
 * cobrir o texto — três telas resolviam isso de três jeitos, e uma nem tinha.
 */
export function CampoSenha({
  id, valor, aoMudar, rotulo = 'Senha', autoComplete = 'current-password', ...resto
}: {
  id: string;
  valor: string;
  aoMudar: (v: string) => void;
  rotulo?: string;
  autoComplete?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'onChange' | 'type'>) {
  const [visivel, setVisivel] = React.useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">{rotulo}</label>
      <div className="relative">
        <input
          id={id}
          type={visivel ? 'text' : 'password'}
          value={valor}
          onChange={e => aoMudar(e.target.value)}
          autoComplete={autoComplete}
          enterKeyHint="go"
          className="flex h-12 w-full rounded-xl border border-input bg-background pl-4 pr-12 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          {...resto}
        />
        <button
          type="button"
          onClick={() => setVisivel(v => !v)}
          aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {/* Olho desenhado inline pra não obrigar cada tela a importar o ícone. */}
          {visivel ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5" aria-hidden="true">
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.15 18.15 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61" />
              <line x1="2" y1="2" x2="22" y2="22" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5" aria-hidden="true">
              <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Erro do formulário, junto do formulário.
 *
 * O toast some sozinho e fica no canto: quem digitou a senha errada olhava pro
 * campo, não pro canto da tela, e não entendia por que nada acontecia.
 */
export function ErroLogin({ mensagem }: { mensagem: string | null }) {
  if (!mensagem) return null;
  return (
    <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {mensagem}
    </p>
  );
}
