/**
 * Sistema simples de notificações (toasts) com Framer Motion.
 * Disparado via `useToast()` em qualquer componente filho de <ToastProvider>.
 */
import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tipo = 'sucesso' | 'erro' | 'info';
interface ToastItem { id: number; titulo: string; descricao?: string; tipo: Tipo }
interface Ctx { mostrar: (t: Omit<ToastItem, 'id'>) => void }

const ToastContext = React.createContext<Ctx | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast precisa ser usado dentro de <ToastProvider>');
  return ctx;
}

const ICONES: Record<Tipo, React.ElementType> = {
  sucesso: CheckCircle2, erro: AlertCircle, info: Info,
};
const CORES: Record<Tipo, string> = {
  sucesso: 'border-success/30 bg-success/10 text-success',
  erro: 'border-destructive/30 bg-destructive/10 text-destructive',
  info: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const mostrar = React.useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts(antigos => [...antigos, { ...t, id }]);
    setTimeout(() => {
      setToasts(antigos => antigos.filter(x => x.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ mostrar }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {toasts.map(t => {
            const Icone = ICONES[t.tipo];
            return (
              <motion.div
                key={t.id}
                initial={{ y: -40, opacity: 0, scale: 0.95 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: -20, opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className={cn(
                  'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border p-4 shadow-lg backdrop-blur',
                  CORES[t.tipo],
                )}
              >
                <Icone className="mt-0.5 size-5 shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold leading-tight">{t.titulo}</div>
                  {t.descricao && <div className="mt-0.5 text-sm opacity-90">{t.descricao}</div>}
                </div>
                <button
                  onClick={() => setToasts(a => a.filter(x => x.id !== t.id))}
                  className="rounded-full p-0.5 transition-opacity hover:opacity-100 opacity-60"
                  aria-label="Fechar notificação"
                >
                  <X className="size-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
