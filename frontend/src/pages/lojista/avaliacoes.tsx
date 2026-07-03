/**
 * Avaliações da loja — média, lista de notas e resposta do lojista.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Star, MessageSquare, Send } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { dataLocal } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Avaliacao {
  id: number;
  pedido_id: number;
  nota: number;
  comentario: string;
  resposta: string;
  criado_em: string;
  cliente_nome: string;
}

export function AvaliacoesLoja() {
  const consulta = useQuery({
    queryKey: ['lojista-avaliacoes'],
    queryFn: () => api<{ avaliacoes: Avaliacao[]; media: number; qtd: number }>('GET', '/api/lojista/avaliacoes'),
  });

  if (consulta.isLoading) return <Skeleton className="h-96" />;
  const { avaliacoes = [], media = 0, qtd = 0 } = consulta.data || {};

  // Distribuição por nota (5→1) para a barra.
  const dist = [5, 4, 3, 2, 1].map(n => ({
    n, qtd: avaliacoes.filter(a => a.nota === n).length,
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-400/15">
          <Star className="size-6 text-amber-500 fill-amber-500" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold">Avaliações</h1>
          <p className="text-sm text-muted-foreground">O que seus clientes acharam.</p>
        </div>
      </div>

      {/* Resumo */}
      <Card>
        <CardContent className="p-5 flex items-center gap-6">
          <div className="text-center shrink-0">
            <div className="text-4xl font-extrabold tabular-nums">{media ? media.toFixed(1) : '—'}</div>
            <div className="flex justify-center gap-0.5 my-1">
              {[1, 2, 3, 4, 5].map(n => (
                <Star key={n} className={cn('size-3.5', n <= Math.round(media) ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30')} />
              ))}
            </div>
            <div className="text-xs text-muted-foreground">{qtd} avaliaç{qtd !== 1 ? 'ões' : 'ão'}</div>
          </div>
          <div className="flex-1 space-y-1">
            {dist.map(d => (
              <div key={d.n} className="flex items-center gap-2">
                <span className="text-xs font-semibold w-3 text-muted-foreground">{d.n}</span>
                <Star className="size-3 text-amber-400 fill-amber-400 shrink-0" />
                <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-amber-400 rounded-full"
                    style={{ width: qtd ? `${(d.qtd / qtd) * 100}%` : '0%' }}
                  />
                </div>
                <span className="text-xs text-muted-foreground tabular-nums w-5 text-right">{d.qtd}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      {avaliacoes.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Star className="size-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Ainda sem avaliações.</p>
            <p className="text-sm">Elas aparecem aqui quando os clientes avaliam pedidos entregues.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {avaliacoes.map(a => <ItemAvaliacao key={a.id} avaliacao={a} />)}
        </div>
      )}
    </div>
  );
}

function ItemAvaliacao({ avaliacao: a }: { avaliacao: Avaliacao }) {
  const { mostrar } = useToast();
  const qc = useQueryClient();
  const [respondendo, setRespondendo] = useState(false);
  const [texto, setTexto] = useState(a.resposta || '');
  const [enviando, setEnviando] = useState(false);

  async function responder() {
    setEnviando(true);
    try {
      await api('POST', `/api/lojista/avaliacoes/${a.id}/responder`, { resposta: texto.trim() });
      mostrar({ tipo: 'sucesso', titulo: 'Resposta enviada!' });
      setRespondendo(false);
      qc.invalidateQueries({ queryKey: ['lojista-avaliacoes'] });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-sm truncate">{a.cliente_nome}</span>
            <span className="text-xs text-muted-foreground shrink-0">#{a.pedido_id}</span>
          </div>
          <div className="flex gap-0.5 shrink-0">
            {[1, 2, 3, 4, 5].map(n => (
              <Star key={n} className={cn('size-4', n <= a.nota ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30')} />
            ))}
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground">{dataLocal(a.criado_em)}</div>
        {a.comentario && <p className="text-sm">{a.comentario}</p>}

        {a.resposta && !respondendo && (
          <div className="rounded-xl bg-accent/50 px-3 py-2 text-sm">
            <span className="font-semibold">Você respondeu: </span>{a.resposta}
            <button onClick={() => setRespondendo(true)} className="ml-2 text-xs text-primary hover:underline">editar</button>
          </div>
        )}

        {!a.resposta && !respondendo && (
          <button
            onClick={() => setRespondendo(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            <MessageSquare className="size-3.5" /> Responder
          </button>
        )}

        {respondendo && (
          <div className="flex items-center gap-2 pt-1">
            <input
              autoFocus
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') responder(); if (e.key === 'Escape') setRespondendo(false); }}
              maxLength={500}
              placeholder="Escreva uma resposta educada…"
              className="flex-1 h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button size="sm" className="h-9 shrink-0" onClick={responder} disabled={enviando}>
              <Send className="size-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
