/**
 * Monitor ao vivo — pedidos em andamento de TODAS as lojas, atualizando sozinho.
 */
import { useQuery } from '@tanstack/react-query';
import { Radio, Store, Clock, Bike } from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api';
import { brl, tempoRelativo } from '@/lib/format';

interface PedidoMonitor {
  id: number;
  status: string;
  total_centavos: number;
  criado_em: string;
  loja_nome: string;
  cliente_nome: string;
  entregador_nome: string | null;
}

const COLUNAS: Array<{ status: string; rotulo: string }> = [
  { status: 'pendente',   rotulo: 'Aguardando loja' },
  { status: 'aceito',     rotulo: 'Aceitos' },
  { status: 'preparando', rotulo: 'Em preparo' },
  { status: 'pronto',     rotulo: 'Prontos' },
  { status: 'em_entrega', rotulo: 'Em entrega' },
];

export function TelaMonitor() {
  const monitorQ = useQuery({
    queryKey: ['admin-monitor'],
    queryFn: () => api<{ pedidos: PedidoMonitor[] }>('GET', '/api/admin/monitor').then(r => r.pedidos),
    refetchInterval: 5000,
  });
  const pedidos = monitorQ.data ?? [];

  return (
    <AdminLayout titulo="Monitor">
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2">
            <Radio className="size-6 text-primary" /> Monitor ao vivo
            <span className="ml-1 inline-flex size-2.5 rounded-full bg-green-500 animate-pulse" title="Atualizando" />
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {pedidos.length} pedido{pedidos.length !== 1 ? 's' : ''} em andamento · atualiza a cada 5s
          </p>
        </div>

        {monitorQ.isLoading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {COLUNAS.map(c => <Skeleton key={c.status} className="h-40 rounded-xl" />)}
          </div>
        )}

        {!monitorQ.isLoading && pedidos.length === 0 && (
          <Card><CardContent className="p-12 text-center text-muted-foreground space-y-2">
            <Radio className="size-10 mx-auto opacity-20" />
            <p className="font-medium">Nenhum pedido em andamento</p>
            <p className="text-sm">Os pedidos de todas as lojas aparecem aqui em tempo real.</p>
          </CardContent></Card>
        )}

        {!monitorQ.isLoading && pedidos.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-start">
            {COLUNAS.map(col => {
              const doStatus = pedidos.filter(p => p.status === col.status);
              return (
                <div key={col.status} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{col.rotulo}</span>
                    <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold">{doStatus.length}</span>
                  </div>
                  {doStatus.map(p => (
                    <Card key={p.id} className="hover:shadow-sm transition-shadow">
                      <CardContent className="p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs text-muted-foreground">#{p.id}</span>
                          <StatusBadge status={p.status as any} />
                        </div>
                        <div className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
                          <Store className="size-3.5 text-primary shrink-0" /> {p.loja_nome}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{p.cliente_nome}</div>
                        {p.entregador_nome && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Bike className="size-3" /> {p.entregador_nome}
                          </div>
                        )}
                        <div className="flex items-center justify-between pt-0.5">
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Clock className="size-3" /> {tempoRelativo(p.criado_em)}
                          </span>
                          <span className="text-xs font-bold tabular-nums">{brl(p.total_centavos)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {doStatus.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
                      vazio
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
