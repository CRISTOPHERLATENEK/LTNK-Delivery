import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShoppingBag, Filter, X, ChevronDown, MapPin, Bike, CreditCard, Phone, Check } from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { brl, dataLocal } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_CORES: Record<string, 'success' | 'danger' | 'info' | 'warning' | 'secondary'> = {
  entregue: 'success', cancelado: 'danger', recusado: 'danger',
  pendente: 'warning', aceito: 'info', preparando: 'info', pronto: 'info', em_entrega: 'info',
};
const ROTULO: Record<string, string> = {
  pendente: 'Pendente', aceito: 'Aceito', preparando: 'Preparando', pronto: 'Pronto',
  em_entrega: 'Em entrega', entregue: 'Entregue', cancelado: 'Cancelado', recusado: 'Recusado',
};

interface PedidoAdmin {
  id: number;
  status: string;
  total_centavos: number;
  forma_pagamento: string;
  criado_em: string;
  loja_nome: string;
  cliente_nome: string;
  entregador_nome?: string;
  endereco_entrega: string;
}

interface LojaSimples { id: number; nome: string; }

const STATUS_LISTA = ['pendente', 'aceito', 'preparando', 'pronto', 'em_entrega', 'entregue', 'cancelado', 'recusado'];
const ATIVOS = ['pendente', 'aceito', 'preparando', 'pronto', 'em_entrega'];

export function TelaPedidosAdmin() {
  const [filtros, setFiltros] = useState({ status: '', loja_id: '', de: '', ate: '' });
  const [aplicados, setAplicados] = useState(filtros);
  const [aoVivo, setAoVivo] = useState(true);
  const [aberto, setAberto] = useState<number | null>(null);

  const lojas = useQuery({
    queryKey: ['admin-lojas-simples'],
    queryFn: () => api<{ lojas: LojaSimples[] }>('GET', '/api/admin/lojas').then(r => r.lojas),
  });

  const consulta = useQuery({
    queryKey: ['admin-pedidos', aplicados],
    queryFn: () => {
      const params = new URLSearchParams();
      if (aplicados.status) params.set('status', aplicados.status);
      if (aplicados.loja_id) params.set('loja_id', aplicados.loja_id);
      if (aplicados.de) params.set('de', aplicados.de);
      if (aplicados.ate) params.set('ate', aplicados.ate);
      const qs = params.toString();
      return api<{ pedidos: PedidoAdmin[] }>('GET', `/api/admin/pedidos${qs ? '?' + qs : ''}`).then(r => r.pedidos);
    },
    refetchInterval: aoVivo ? 10_000 : false,
  });

  function aplicar(e: React.FormEvent) {
    e.preventDefault();
    setAplicados({ ...filtros });
  }
  function limpar() {
    const vazio = { status: '', loja_id: '', de: '', ate: '' };
    setFiltros(vazio);
    setAplicados(vazio);
  }

  const pedidos = consulta.data ?? [];
  const faturamento = pedidos.filter(p => p.status === 'entregue').reduce((s, p) => s + p.total_centavos, 0);
  const emAndamento = pedidos.filter(p => ATIVOS.includes(p.status)).length;
  const temFiltros = aplicados.status || aplicados.loja_id || aplicados.de || aplicados.ate;

  return (
    <AdminLayout titulo="Pedidos">
      <div className="space-y-5 max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-extrabold flex items-center gap-2">
              <ShoppingBag className="size-6 text-primary" /> Todos os pedidos
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {pedidos.length} pedido{pedidos.length !== 1 ? 's' : ''} na visão atual
            </p>
          </div>
          <button
            onClick={() => setAoVivo(v => !v)}
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
              aoVivo ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground',
            )}
          >
            <span className={cn('size-2 rounded-full', aoVivo ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground')} />
            {aoVivo ? 'Ao vivo' : 'Pausado'}
          </button>
        </div>

        {/* KPIs rápidos */}
        <div className="grid grid-cols-3 gap-3">
          <MiniKpi valor={String(pedidos.length)} rotulo="Total" />
          <MiniKpi valor={String(emAndamento)} rotulo="Em andamento" cor="text-blue-600" />
          <MiniKpi valor={brl(faturamento)} rotulo="Entregue (R$)" cor="text-emerald-600" />
        </div>

        {/* Filtros */}
        <Card>
          <CardContent className="p-4">
            <form onSubmit={aplicar} className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
              <div className="col-span-2 sm:col-span-1">
                <Label>Loja</Label>
                <select
                  value={filtros.loja_id}
                  onChange={e => setFiltros(f => ({ ...f, loja_id: e.target.value }))}
                  className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                >
                  <option value="">Todas</option>
                  {lojas.data?.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
                </select>
              </div>
              <div>
                <Label>Status</Label>
                <select
                  value={filtros.status}
                  onChange={e => setFiltros(f => ({ ...f, status: e.target.value }))}
                  className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                >
                  <option value="">Todos</option>
                  {STATUS_LISTA.map(s => <option key={s} value={s}>{ROTULO[s]}</option>)}
                </select>
              </div>
              <div>
                <Label>De</Label>
                <Input type="date" value={filtros.de} onChange={e => setFiltros(f => ({ ...f, de: e.target.value }))} />
              </div>
              <div>
                <Label>Até</Label>
                <Input type="date" value={filtros.ate} onChange={e => setFiltros(f => ({ ...f, ate: e.target.value }))} />
              </div>
              <div className="flex gap-2 col-span-2 sm:col-span-1">
                <Button type="submit" className="flex-1"><Filter className="size-3.5" /> Filtrar</Button>
                {temFiltros && (
                  <Button type="button" variant="ghost" size="icon" onClick={limpar}><X className="size-4" /></Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {consulta.isLoading && (
          <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        )}

        {!consulta.isLoading && pedidos.length === 0 && (
          <Card><CardContent className="p-10 text-center text-muted-foreground">
            Nenhum pedido encontrado com esses filtros.
          </CardContent></Card>
        )}

        {/* Lista */}
        <div className="space-y-2">
          {pedidos.map(p => (
            <Card key={p.id} className={cn('transition-shadow', aberto === p.id && 'ring-2 ring-primary/40')}>
              <CardContent className="p-0">
                <button
                  onClick={() => setAberto(aberto === p.id ? null : p.id)}
                  className="w-full p-4 text-left"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                      #{String(p.id).padStart(4, '0')}
                    </span>
                    <Badge variant={STATUS_CORES[p.status] ?? 'secondary'} className="text-[10px]">
                      {ROTULO[p.status] ?? p.status}
                    </Badge>
                    <span className="text-sm font-semibold flex-1 min-w-[120px] truncate">{p.loja_nome}</span>
                    <span className="text-sm text-muted-foreground truncate hidden sm:block">{p.cliente_nome}</span>
                    <span className="font-bold tabular-nums text-sm">{brl(p.total_centavos)}</span>
                    <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">{dataLocal(p.criado_em)}</span>
                    <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', aberto === p.id && 'rotate-180')} />
                  </div>
                </button>
                {aberto === p.id && <DetalhePedido id={p.id} />}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}

function MiniKpi({ valor, rotulo, cor }: { valor: string; rotulo: string; cor?: string }) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <div className={cn('text-xl font-extrabold tabular-nums', cor)}>{valor}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{rotulo}</div>
      </CardContent>
    </Card>
  );
}

interface DetalheResp {
  pedido: {
    id: number; status: string; subtotal_centavos: number; taxa_entrega_centavos: number;
    total_centavos: number; forma_pagamento: string; troco_para_centavos?: number | null;
    observacoes?: string; endereco_entrega: string; cliente_nome: string;
    cliente_telefone?: string | null; entregador_nome?: string | null;
  };
  itens: { nome_produto: string; preco_unit_centavos: number; quantidade: number; opcoes_texto?: string }[];
  historico: { status: string; criado_em: string }[];
}

function DetalhePedido({ id }: { id: number }) {
  const consulta = useQuery({
    queryKey: ['admin-pedido-detalhe', id],
    queryFn: () => api<DetalheResp>('GET', `/api/admin/pedidos/${id}`),
  });

  if (consulta.isLoading) return <div className="px-4 pb-4"><Skeleton className="h-32 rounded-xl" /></div>;
  if (!consulta.data) return null;
  const { pedido, itens, historico } = consulta.data;
  const pagamento = pedido.forma_pagamento === 'pix' ? 'Pix'
    : pedido.forma_pagamento === 'dinheiro' ? 'Dinheiro' : 'Cartão na entrega';

  return (
    <div className="px-4 pb-4 border-t border-border pt-4 grid gap-4 sm:grid-cols-2">
      {/* Itens */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Itens</h4>
        <div className="space-y-1.5">
          {itens.map((it, i) => (
            <div key={i} className="flex justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="text-muted-foreground tabular-nums mr-1">{it.quantidade}×</span>
                {it.nome_produto}
                {it.opcoes_texto && <span className="block text-xs text-muted-foreground truncate">{it.opcoes_texto}</span>}
              </span>
              <span className="tabular-nums font-semibold shrink-0">{brl(it.preco_unit_centavos * it.quantidade)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-2 border-t border-border/60 space-y-1 text-sm">
          <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span className="tabular-nums">{brl(pedido.subtotal_centavos)}</span></div>
          <div className="flex justify-between text-muted-foreground"><span>Entrega</span><span className="tabular-nums">{pedido.taxa_entrega_centavos === 0 ? 'Grátis' : brl(pedido.taxa_entrega_centavos)}</span></div>
          <div className="flex justify-between font-bold"><span>Total</span><span className="tabular-nums">{brl(pedido.total_centavos)}</span></div>
        </div>
      </div>

      {/* Infos + timeline */}
      <div className="space-y-3 text-sm">
        <div className="space-y-1.5 text-muted-foreground">
          <div className="flex items-start gap-2"><CreditCard className="size-4 mt-0.5 shrink-0 text-primary" /><span>{pagamento}{pedido.troco_para_centavos ? ` · troco p/ ${brl(pedido.troco_para_centavos)}` : ''}</span></div>
          <div className="flex items-start gap-2"><MapPin className="size-4 mt-0.5 shrink-0 text-primary" /><span>{pedido.endereco_entrega}</span></div>
          {pedido.cliente_telefone && <div className="flex items-start gap-2"><Phone className="size-4 mt-0.5 shrink-0 text-primary" /><span>{pedido.cliente_nome} · {pedido.cliente_telefone}</span></div>}
          {pedido.entregador_nome && <div className="flex items-start gap-2"><Bike className="size-4 mt-0.5 shrink-0 text-primary" /><span>{pedido.entregador_nome}</span></div>}
          {pedido.observacoes && <div className="rounded-lg bg-blue-500/10 px-2.5 py-1.5 text-blue-700 dark:text-blue-300 text-xs">📝 {pedido.observacoes}</div>}
        </div>
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Linha do tempo</h4>
          <div className="space-y-1">
            {historico.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <Check className="size-3 text-success shrink-0" />
                <span className="font-medium">{ROTULO[h.status] ?? h.status}</span>
                <span className="text-muted-foreground">· {dataLocal(h.criado_em)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
