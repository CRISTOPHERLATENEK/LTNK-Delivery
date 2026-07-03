/**
 * Painel de COZINHA (KDS — Kitchen Display System).
 *
 * App isolado com login próprio (perfil 'cozinha', vinculado a uma loja).
 * Tela cheia pensada pra um tablet na cozinha: só os pedidos em preparo,
 * cards grandes, cor por tempo de espera e alerta sonoro em pedido novo.
 */
import { useEffect, useRef, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChefHat, Clock, AlarmClock, Check, Play, Volume2, VolumeX, LogOut, Soup,
  Bike, UtensilsCrossed, ShoppingBag,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, sessaoUsuario, salvarSessao, encerrarSessao } from '@/lib/api';
import { cn } from '@/lib/utils';

type FonteCozinha = 'delivery' | 'mesa' | 'balcao';

interface ItemCozinha {
  nome_produto: string;
  quantidade: number;
  detalhe: string;
}
interface PedidoCozinha {
  fonte: FonteCozinha;
  id: number;
  referencia: string;
  etapa: 'novo' | 'preparando';
  observacao: string;
  criado_em: string;
  itens: ItemCozinha[];
}

export function PainelCozinha() {
  const sessao = sessaoUsuario('cozinha');
  const ehCozinha = !!sessao && sessao.perfil === 'cozinha';

  if (!ehCozinha) return <LoginCozinha />;

  return (
    <Routes>
      <Route path="*" element={<TelaKDS />} />
    </Routes>
  );
}

/* ─────────────────────────── Login ─────────────────────────── */
function LoginCozinha() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const { mostrar } = useToast();

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<{ token: string; conta: any }>('POST', '/api/cozinha/login', { email, senha });
      salvarSessao(r.token, {
        id: r.conta.id, nome: r.conta.nome, email: r.conta.email,
        perfil: 'cozinha', loja_id: r.conta.loja_id, loja_nome: r.conta.loja_nome,
      }, 'cozinha');
      window.location.reload();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background text-foreground flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-primary text-primary-foreground">
            <ChefHat className="size-8" />
          </div>
          <h2 className="text-2xl font-extrabold">Cozinha</h2>
          <p className="text-sm text-muted-foreground">Entre com a conta da cozinha da sua loja.</p>
        </div>
        <Card>
          <CardContent className="p-6">
            <form onSubmit={enviar} className="space-y-4">
              <div>
                <Label htmlFor="email-cozinha">E-mail</Label>
                <Input id="email-cozinha" type="email" required placeholder="cozinha@sualoja.com"
                  value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="senha-cozinha">Senha</Label>
                <Input id="senha-cozinha" type="password" required placeholder="••••••••"
                  value={senha} onChange={e => setSenha(e.target.value)} />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={enviando}>
                {enviando ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          A conta da cozinha é criada pelo lojista no painel da loja.
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────── KDS ─────────────────────────── */

const CHAVE_SOM = 'cozinha:som';

function TelaKDS() {
  const sessao = sessaoUsuario('cozinha');
  const qc = useQueryClient();
  const { mostrar } = useToast();
  const [som, setSom] = useState(() => localStorage.getItem(CHAVE_SOM) !== '0');
  const [agora, setAgora] = useState(() => Date.now());
  const ultimaQtd = useRef<number | null>(null);

  const pedidosQ = useQuery({
    queryKey: ['cozinha-pedidos'],
    queryFn: () => api<{ pedidos: PedidoCozinha[] }>('GET', '/api/cozinha/pedidos').then(r => r.pedidos),
    refetchInterval: 4000,
  });
  const pedidos = pedidosQ.data ?? [];

  // Relógio: mantém os tempos de espera frescos mesmo entre as atualizações.
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  // Alerta sonoro quando entra pedido novo (a fila cresceu).
  useEffect(() => {
    const qtd = pedidos.length;
    if (ultimaQtd.current !== null && qtd > ultimaQtd.current && som) tocarBip();
    ultimaQtd.current = qtd;
  }, [pedidos.length, som]);

  function alternarSom() {
    setSom(s => {
      const novo = !s;
      localStorage.setItem(CHAVE_SOM, novo ? '1' : '0');
      if (novo) tocarBip();
      return novo;
    });
  }

  async function acao(p: PedidoCozinha, tipo: 'preparar' | 'pronto') {
    // Atualização otimista: tira/avança o card na hora.
    qc.setQueryData<PedidoCozinha[]>(['cozinha-pedidos'], old =>
      (old ?? []).flatMap(x => {
        if (!(x.fonte === p.fonte && x.id === p.id)) return [x];
        return tipo === 'pronto' ? [] : [{ ...x, etapa: 'preparando' as const }];
      }),
    );
    const url = p.fonte === 'delivery'
      ? `/api/cozinha/pedidos/${p.id}/acao`
      : `/api/cozinha/tickets/${p.id}/acao`;
    try {
      await api('POST', url, { acao: tipo });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
      pedidosQ.refetch();
    }
  }

  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <ChefHat className="size-5" />
            </div>
            <div className="leading-tight">
              <div className="font-extrabold">Cozinha</div>
              <div className="text-xs text-muted-foreground">{sessao?.loja_nome}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <Soup className="size-4" /> {pedidos.length} na fila
            </span>
            <button onClick={alternarSom} title={som ? 'Som ligado' : 'Som desligado'}
              className="flex size-9 items-center justify-center rounded-xl hover:bg-accent text-muted-foreground">
              {som ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
            </button>
            <button
              onClick={() => { encerrarSessao('cozinha'); window.location.href = '/cozinha'; }}
              title="Sair" className="flex size-9 items-center justify-center rounded-xl hover:bg-accent text-muted-foreground">
              <LogOut className="size-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Fila */}
      <main className="flex-1 p-4">
        {pedidosQ.isLoading && (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-48" />)}
          </div>
        )}

        {!pedidosQ.isLoading && pedidos.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-24 text-muted-foreground">
            <ChefHat className="size-16 opacity-20 mb-4" />
            <p className="text-lg font-semibold">Nenhum pedido na cozinha agora</p>
            <p className="text-sm">Os pedidos aceitos aparecem aqui automaticamente.</p>
          </div>
        )}

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {pedidos.map(p => (
            <TicketCozinha key={`${p.fonte}-${p.id}`} pedido={p} agora={agora} onAcao={acao} />
          ))}
        </div>
      </main>

      {/* Legenda */}
      {pedidos.length > 0 && (
        <footer className="border-t border-border/60 px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-green-500" /> Novo</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-amber-500" /> +5 min</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-red-500" /> +10 min atrasado</span>
        </footer>
      )}
    </div>
  );
}

/* Classes de cor por tempo de espera. */
function urgencia(criadoEm: string, agora: number) {
  const min = Math.max(0, Math.floor((agora - new Date(criadoEm).getTime()) / 60000));
  if (min >= 10) return {
    min, rotulo: min + ' min', atrasado: true,
    faixa: 'bg-red-500/15 text-red-700 dark:text-red-300',
    borda: 'border-red-500/50',
  };
  if (min >= 5) return {
    min, rotulo: min + ' min', atrasado: false,
    faixa: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    borda: 'border-amber-500/40',
  };
  return {
    min, rotulo: min < 1 ? 'agora' : min + ' min', atrasado: false,
    faixa: 'bg-green-500/15 text-green-700 dark:text-green-300',
    borda: 'border-green-500/40',
  };
}

const FONTE_INFO: Record<FonteCozinha, { icone: typeof Bike; rotulo: string }> = {
  delivery: { icone: Bike, rotulo: 'Delivery' },
  mesa:     { icone: UtensilsCrossed, rotulo: 'Salão' },
  balcao:   { icone: ShoppingBag, rotulo: 'Balcão' },
};

function TicketCozinha({
  pedido, agora, onAcao,
}: {
  pedido: PedidoCozinha;
  agora: number;
  onAcao: (p: PedidoCozinha, tipo: 'preparar' | 'pronto') => void;
}) {
  const u = urgencia(pedido.criado_em, agora);
  const emPreparo = pedido.etapa === 'preparando';
  const Fonte = FONTE_INFO[pedido.fonte] ?? FONTE_INFO.delivery;
  const IconeFonte = Fonte.icone;

  return (
    <Card className={cn('overflow-hidden border-2', u.borda, u.atrasado && 'animate-pulse')}>
      <div className={cn('flex items-center justify-between px-3 py-2 font-bold', u.faixa)}>
        <span className="flex items-center gap-1.5 text-sm">
          <IconeFonte className="size-4" /> {pedido.referencia}
        </span>
        <span className="flex items-center gap-1.5 text-sm">
          {u.atrasado ? <AlarmClock className="size-4" /> : <Clock className="size-4" />} {u.rotulo}
        </span>
      </div>
      <CardContent className="p-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
          {Fonte.rotulo} · {emPreparo ? 'em preparo' : 'novo'}
        </div>
        <div className="space-y-1.5">
          {pedido.itens.map((it, idx) => (
            <div key={idx} className="leading-tight">
              <div className="font-semibold">
                <span className="tabular-nums text-muted-foreground mr-1">{it.quantidade}×</span>
                {it.nome_produto}
              </div>
              {it.detalhe && (
                <div className="text-xs text-muted-foreground pl-5">{it.detalhe}</div>
              )}
            </div>
          ))}
        </div>
        {pedido.observacao && (
          <div className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">
            📝 {pedido.observacao}
          </div>
        )}
        <Button
          size="lg"
          variant={emPreparo ? 'success' : 'default'}
          className="w-full mt-3"
          onClick={() => onAcao(pedido, emPreparo ? 'pronto' : 'preparar')}
        >
          {emPreparo
            ? (<><Check className="size-4" /> Marcar pronto</>)
            : (<><Play className="size-4" /> Iniciar preparo</>)}
        </Button>
      </CardContent>
    </Card>
  );
}

/* Bip curto via Web Audio (sem arquivo de áudio). */
function tocarBip() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.42);
    osc.onended = () => ctx.close();
  } catch { /* navegador sem Web Audio — ignora */ }
}
