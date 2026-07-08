/**
 * Diálogo de confirmação temático (substitui o window.confirm nativo, feio).
 * Uso: `const confirmar = useConfirm();` e `if (await confirmar({...})) { ... }`.
 * Promessa que resolve true (confirmou) ou false (cancelou/fechou/ESC).
 */
import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface OpcoesConfirm {
  titulo: string;
  descricao?: string;
  /** Texto do botão de confirmar (padrão: "Confirmar"). */
  confirmar?: string;
  /** Texto do botão de cancelar (padrão: "Cancelar"). */
  cancelar?: string;
  /** Ação perigosa (excluir/cancelar) — botão vermelho e ícone de alerta. */
  destrutivo?: boolean;
}

type Fn = (opts: OpcoesConfirm) => Promise<boolean>;
const ConfirmContext = React.createContext<Fn | null>(null);

export function useConfirm(): Fn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm precisa estar dentro de <ConfirmProvider>');
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = React.useState<OpcoesConfirm | null>(null);
  const resolverRef = React.useRef<((v: boolean) => void) | undefined>(undefined);

  const confirmar = React.useCallback<Fn>((o) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOpts(o);
    });
  }, []);

  const fechar = React.useCallback((valor: boolean) => {
    resolverRef.current?.(valor);
    resolverRef.current = undefined;
    setOpts(null);
  }, []);

  // ESC cancela, Enter confirma.
  React.useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); fechar(false); }
      else if (e.key === 'Enter') { e.preventDefault(); fechar(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opts, fechar]);

  const destrutivo = !!opts?.destrutivo;
  const Icone = destrutivo ? AlertTriangle : HelpCircle;

  return (
    <ConfirmContext.Provider value={confirmar}>
      {children}
      <AnimatePresence>
        {opts && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => fechar(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <motion.div
              role="alertdialog" aria-modal="true"
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: 'spring', stiffness: 340, damping: 26 }}
              className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-card shadow-2xl"
            >
              <div className="p-6 pb-5">
                <div className={cn(
                  'mb-4 flex size-12 items-center justify-center rounded-2xl',
                  destrutivo ? 'bg-destructive/12 text-destructive' : 'bg-primary/12 text-primary',
                )}>
                  <Icone className="size-6" />
                </div>
                <h2 className="text-lg font-extrabold leading-tight">{opts.titulo}</h2>
                {opts.descricao && (
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{opts.descricao}</p>
                )}
              </div>
              <div className="flex gap-2 border-t border-border/60 p-3">
                <button
                  onClick={() => fechar(false)}
                  className="flex-1 rounded-2xl py-3 text-sm font-bold text-muted-foreground transition-colors hover:bg-muted"
                >
                  {opts.cancelar || 'Cancelar'}
                </button>
                <button
                  autoFocus
                  onClick={() => fechar(true)}
                  className={cn(
                    'flex-1 rounded-2xl py-3 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90',
                    destrutivo ? 'bg-destructive shadow-destructive/30' : 'bg-primary text-primary-foreground shadow-primary/30',
                  )}
                >
                  {opts.confirmar || 'Confirmar'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}
