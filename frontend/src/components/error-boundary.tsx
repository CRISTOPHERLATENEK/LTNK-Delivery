/**
 * Rede de segurança pra crash de render: sem isso, um erro em qualquer
 * componente derruba a árvore inteira do React e vira tela branca (o pior
 * cenário possível pra quem está no meio de um pedido/venda). Com o Sentry
 * configurado (VITE_SENTRY_DSN), também reporta o erro automaticamente.
 */
import * as Sentry from '@sentry/react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <Sentry.ErrorBoundary
      fallback={() => (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
          <div className="w-full max-w-sm text-center space-y-4">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertTriangle className="size-7" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold">Ops, algo deu errado</h1>
              <p className="text-sm text-muted-foreground mt-1">
                A tela travou de forma inesperada. Recarregar geralmente resolve.
              </p>
            </div>
            <Button size="lg" className="w-full" onClick={() => window.location.reload()}>
              <RefreshCw className="size-4" /> Recarregar
            </Button>
          </div>
        </div>
      )}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
