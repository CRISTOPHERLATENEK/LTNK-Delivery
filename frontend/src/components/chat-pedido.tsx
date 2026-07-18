/**
 * Chat de um pedido — usado pelo cliente (falando com a loja e depois com o
 * entregador, numa única thread) e pelo entregador/lojista do outro lado, só
 * mudando `basePath` (rota da API) e `remetenteProprio` (de qual lado é essa
 * tela). Polling simples (4s), sem WebSocket — mesmo padrão do resto do app.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Send, Store, Bike, User } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

type Remetente = 'cliente' | 'entregador' | 'loja';
interface Mensagem { id: number; remetente: Remetente; texto: string; criado_em: string }

const ICONE_REMETENTE: Record<Remetente, typeof User> = {
  cliente: User,
  entregador: Bike,
  loja: Store,
};

export function ChatPedido({
  basePath, remetenteProprio, nomeContato, aberto, onFechar,
}: {
  basePath: string;
  remetenteProprio: Remetente;
  nomeContato: string;
  aberto: boolean;
  onFechar: () => void;
}) {
  const { mostrar } = useToast();
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fimRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const consulta = useQuery({
    queryKey: ['chat-pedido', basePath],
    queryFn: () => api<{ mensagens: Mensagem[] }>('GET', `${basePath}/mensagens`).then(r => r.mensagens),
    enabled: aberto,
    refetchInterval: aberto ? 4000 : false,
  });

  useEffect(() => {
    if (aberto) {
      fimRef.current?.scrollIntoView({ behavior: 'smooth' });
      inputRef.current?.focus();
    }
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

  const mensagens = consulta.data ?? [];

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
            className="relative flex w-full sm:max-w-md flex-col rounded-t-3xl sm:rounded-3xl bg-card shadow-2xl h-[85dvh] sm:h-[560px] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-border bg-muted/40 p-4 shrink-0">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0 shadow-sm">
                {(nomeContato || '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate">{nomeContato}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  Chat do pedido
                </div>
              </div>
              <button onClick={onFechar} className="p-2 rounded-full hover:bg-accent text-muted-foreground transition-colors">
                <X className="size-4.5" />
              </button>
            </div>

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1 bg-gradient-to-b from-transparent to-muted/20">
              {consulta.isLoading && (
                <div className="space-y-2 py-2">
                  <div className="h-9 w-2/3 rounded-2xl bg-muted animate-pulse" />
                  <div className="h-9 w-1/2 rounded-2xl bg-muted animate-pulse ml-auto" />
                  <div className="h-9 w-3/5 rounded-2xl bg-muted animate-pulse" />
                </div>
              )}
              {!consulta.isLoading && mensagens.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-10">
                  <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Send className="size-5" />
                  </div>
                  <p className="text-sm font-semibold">Nenhuma mensagem ainda</p>
                  <p className="text-xs text-muted-foreground max-w-[220px]">Mande um oi e comece a conversa por aqui.</p>
                </div>
              )}
              {mensagens.map((m, idx) => {
                const propria = m.remetente === remetenteProprio;
                const anterior = mensagens[idx - 1];
                const mudouRemetente = !anterior || anterior.remetente !== m.remetente;
                const Icone = ICONE_REMETENTE[m.remetente];
                return (
                  <div key={m.id} className={cn('flex items-end gap-1.5', propria ? 'justify-end' : 'justify-start', mudouRemetente ? 'mt-3' : 'mt-0.5')}>
                    {!propria && (
                      <div className={cn('flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground shrink-0', !mudouRemetente && 'opacity-0')}>
                        <Icone className="size-3.5" />
                      </div>
                    )}
                    <div className={cn(
                      'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm leading-snug shadow-sm',
                      propria
                        ? 'bg-primary text-primary-foreground rounded-br-md'
                        : 'bg-muted text-foreground rounded-bl-md',
                    )}>
                      {m.texto}
                      <div className={cn('text-[10px] mt-0.5 text-right', propria ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                        {new Date(m.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={fimRef} />
            </div>

            {/* Envio */}
            <form onSubmit={enviar} className="flex items-center gap-2 border-t border-border bg-card p-3 shrink-0">
              <input
                ref={inputRef}
                value={texto}
                onChange={e => setTexto(e.target.value)}
                placeholder="Digite uma mensagem…"
                maxLength={500}
                className="flex-1 h-11 px-4 rounded-full border border-input bg-muted/40 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background transition-colors"
              />
              <button
                type="submit"
                disabled={enviando || !texto.trim()}
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-105 active:scale-95 transition-all shadow-sm"
              >
                <Send className="size-4.5" />
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
