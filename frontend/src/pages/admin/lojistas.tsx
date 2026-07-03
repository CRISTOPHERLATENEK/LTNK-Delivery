import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Store, Users, ShoppingBag, TrendingUp,
  ChevronDown, ChevronUp, Plus, Mail, Phone, Search,
} from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { brl, dataLocal } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Lojista {
  id: number;
  loja_nome: string;
  status_aprovacao: string;
  aberta: 0 | 1;
  logo_url: string;
  categoria: string;
  loja_criada_em: string;
  usuario_id: number;
  dono_nome: string;
  dono_email: string;
  dono_telefone: string;
  total_pedidos: number;
  faturamento_centavos: number;
  total_clientes: number;
}

export function TelaLojistas() {
  const [expandido, setExpandido] = useState<number | null>(null);
  const [busca, setBusca] = useState('');

  const consulta = useQuery({
    queryKey: ['admin-lojistas'],
    queryFn: () => api<{ lojistas: Lojista[] }>('GET', '/api/admin/lojistas').then(r => r.lojistas),
  });

  const lista = (consulta.data ?? []).filter(l =>
    !busca ||
    l.loja_nome.toLowerCase().includes(busca.toLowerCase()) ||
    l.dono_nome.toLowerCase().includes(busca.toLowerCase()) ||
    l.dono_email.toLowerCase().includes(busca.toLowerCase())
  );

  return (
    <AdminLayout titulo="Lojistas">
      <div className="space-y-5 max-w-4xl">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-extrabold flex items-center gap-2">
              <Store className="size-6 text-primary" /> Lojistas
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {consulta.data?.length ?? 0} lojistas · clientes e pedidos de cada loja
            </p>
          </div>
          <Button asChild>
            <Link to="/painel-admin/lojas"><Plus className="size-4" /> Nova loja</Link>
          </Button>
        </div>

        {/* O cadastro do lojista é feito junto com a loja (sempre vinculado). */}
        <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          <Store className="size-4 text-primary shrink-0 mt-0.5" />
          <span className="text-muted-foreground">
            O acesso do lojista é criado <b className="text-foreground">dentro do cadastro da loja</b>, em{' '}
            <Link to="/painel-admin/lojas" className="text-primary font-semibold hover:underline">Lojas → Nova loja</Link>.
            Assim a conta fica sempre vinculada à loja certa.
          </span>
        </div>

        {/* Busca */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, dono ou e-mail…"
            className="w-full h-10 pl-10 pr-4 rounded-xl border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>

        {consulta.isLoading && (
          <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
        )}

        <div className="space-y-3">
          {lista.map(l => (
            <CardLojista
              key={l.id}
              lojista={l}
              expandido={expandido === l.id}
              onToggle={() => setExpandido(expandido === l.id ? null : l.id)}
            />
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}

function CardLojista({ lojista: l, expandido, onToggle }: {
  lojista: Lojista;
  expandido: boolean;
  onToggle: () => void;
}) {
  const clientesQ = useQuery({
    queryKey: ['admin-clientes', l.id],
    queryFn: () => api<{ clientes: any[] }>('GET', `/api/admin/lojistas/${l.id}/clientes`).then(r => r.clientes),
    enabled: expandido,
  });
  const pedidosQ = useQuery({
    queryKey: ['admin-pedidos-lojista', l.id],
    queryFn: () => api<{ pedidos: any[] }>('GET', `/api/admin/lojistas/${l.id}/pedidos`).then(r => r.pedidos),
    enabled: expandido,
  });

  return (
    <Card className={cn('transition-shadow', expandido && 'shadow-md ring-1 ring-primary/10')}>
      <CardContent className="p-5">
        {/* Cabeçalho */}
        <div className="flex items-center gap-4">
          <div className="shrink-0">
            {l.logo_url
              ? <img src={l.logo_url} alt="" className="size-14 rounded-2xl object-cover border border-border" />
              : <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-2xl">🏪</div>
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-[15px]">{l.loja_nome}</span>
              <Badge variant={l.status_aprovacao === 'aprovada' ? 'success' : l.status_aprovacao === 'suspensa' ? 'danger' : 'warning'} className="text-[10px]">
                {l.status_aprovacao}
              </Badge>
              {l.aberta ? <Badge variant="success" className="text-[10px]">Aberta</Badge> : <Badge variant="secondary" className="text-[10px]">Fechada</Badge>}
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {l.dono_nome} · {l.dono_email}
            </div>
            <div className="flex gap-4 mt-2 text-xs font-semibold text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1.5"><Users className="size-3.5 text-primary" />{l.total_clientes} clientes</span>
              <span className="flex items-center gap-1.5"><ShoppingBag className="size-3.5 text-primary" />{l.total_pedidos} pedidos</span>
              <span className="flex items-center gap-1.5"><TrendingUp className="size-3.5 text-emerald-500" />{brl(l.faturamento_centavos)}</span>
            </div>
          </div>
          <button
            onClick={onToggle}
            className="shrink-0 flex size-9 items-center justify-center rounded-xl hover:bg-accent text-muted-foreground transition-colors"
          >
            {expandido ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        </div>

        {/* Drill-down */}
        {expandido && (
          <div className="mt-5 space-y-5 border-t pt-5">
            {/* Clientes */}
            <div>
              <h3 className="font-bold mb-3 flex items-center gap-2 text-sm uppercase tracking-wide text-muted-foreground">
                <Users className="size-4" /> Clientes ({clientesQ.data?.length ?? 0})
              </h3>
              {clientesQ.isLoading && <Skeleton className="h-16 rounded-xl" />}
              {clientesQ.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum cliente cadastrado.</p>}
              <div className="space-y-2">
                {clientesQ.data?.map((c: any) => (
                  <div key={c.id} className="flex items-center gap-3 rounded-xl bg-muted/50 px-4 py-2.5">
                    <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">
                      {c.nome.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">{c.nome}</div>
                      <div className="flex gap-3 flex-wrap">
                        {c.email && <span className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="size-3"/>{c.email}</span>}
                        {c.telefone && <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="size-3"/>{c.telefone}</span>}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">{new Date(c.criado_em).toLocaleDateString('pt-BR')}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Pedidos */}
            <div>
              <h3 className="font-bold mb-3 flex items-center gap-2 text-sm uppercase tracking-wide text-muted-foreground">
                <ShoppingBag className="size-4" /> Últimos pedidos
              </h3>
              {pedidosQ.isLoading && <Skeleton className="h-16 rounded-xl" />}
              {pedidosQ.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum pedido ainda.</p>}
              <div className="space-y-2">
                {pedidosQ.data?.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-4 py-2.5 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">#{p.id}</span>
                    <span className="flex-1 truncate">{p.cliente_nome}</span>
                    <Badge variant={p.status === 'entregue' ? 'success' : p.status === 'cancelado' ? 'danger' : 'info'} className="text-[10px]">
                      {p.status}
                    </Badge>
                    <span className="font-bold tabular-nums">{brl(p.total_centavos)}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{dataLocal(p.criado_em)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

