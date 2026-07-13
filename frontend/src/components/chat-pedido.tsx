/**
 * Chat de um pedido — usado tanto pelo cliente quanto pelo entregador, só
 * mudando `basePath` (rota da API) e `remetenteProprio` (de qual lado é essa
 * tela). Polling simples (4s), sem WebSocket — mesmo padrão do resto do app.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Send } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

interface Mensagem { id: number; remetente: 'cliente' | 'entregador'; texto: string; criado_em: string }

export function ChatPedido({
  basePath, remetenteProprio, nomeContato, aberto, onFechar,
}: {
  basePath: string;
  remetenteProprio: 'cliente' | 'entregador';
  nomeContato: string;
  aberto: boolean;
  onFechar: () => void;
}) {
  const { mostrar } = useToast();
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fimRef = useRef<HTMLDivElement | null>(null);

  const consulta = useQuery({
    queryKey: ['chat-pedido', basePath],
    queryFn: () => api<{ mensagens: Mensagem[] }>('GET', `${basePath}/mensagens`).then(r => r.mensagens),
    enabled: aberto,
    refetchInterval: aberto ? 4000 : false,
  });

  useEffect(() => {
    if (aberto) fimRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consulta.data, aberto]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const t = texto.trim();
    if (!t) return;
    setEnviando(true);
    try {
      await api('POST', `${basePath}/mensagens`, { texto: t });
      setTexto('');
      qc.invalidateQueries({ queryKey: ['chat-pedido', basePath] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <AnimatePresence>
      {aberto && (
        <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onFechar} className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
            className="relative flex w-full sm:max-w-md flex-col rounded-t-3xl sm:rounded-3xl bg-card shadow-2xl h-[85dvh] sm:h-[560px]"
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-border p-4 shrink-0">
              <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">
                {nomeContato.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate">{nomeContato}</div>
                <div className="text-xs text-muted-foreground">Chat do pedido</div>
              </div>
              <button onClick={onFechar} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
                <X className="size-5" />
              </button>
            </div>

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {consulta.isLoading && (
                <p className="text-center text-xs text-muted-foreground py-6">Carregando…</p>
              )}
              {consulta.data?.length === 0 && (
                <p className="text-center text-xs text-muted-foreground py-6">Nenhuma mensagem ainda — diga oi!</p>
              )}
              {consulta.data?.map(m => {
                const propria = m.remetente === remetenteProprio;
                return (
                  <div key={m.id} className={cn('flex', propria ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm leading-snug',
                      propria ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted text-foreground rounded-bl-sm',
                    )}>
                      {m.texto}
                      <div className={cn('text-[10px] mt-0.5', propria ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                        {new Date(m.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={fimRef} />
            </div>

            {/* Envio */}
            <form onSubmit={enviar} className="flex items-center gap-2 border-t border-border p-3 shrink-0">
              <input
                value={texto}
                onChange={e => setTexto(e.target.value)}
                placeholder="Digite uma mensagem…"
                maxLength={500}
                className="flex-1 h-10 px-3.5 rounded-full border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="submit"
                disabled={enviando || !texto.trim()}
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40 transition-opacity"
              >
                <Send className="size-4" />
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
