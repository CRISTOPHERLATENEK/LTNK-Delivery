/**
 * Dashboard home do lojista — status da loja, métricas do dia,
 * pedidos pendentes e ações rápidas.
 */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell, TrendingUp, ShoppingBag,
  Clock, ArrowRight, Users, Printer, ChefHat, CheckCircle2,
  XCircle, Package, Bike, Box, UtensilsCrossed, Settings, BarChart3, Ticket, Star, Eye,
  Store, ChevronRight, MessagesSquare,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { useToast } from '@/components/ui/toast';
import { ChatPedido } from '@/components/chat-pedido';
import { api, ApiError } from '@/lib/api';
import { usePedidosLojaAtivos } from '@/lib/pedidos-loja';
import { brl, dataLocal, tempoRelativo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Pedido, ItemPedido } from '@/types';

type PedidoComItens = Pedido & { itens: ItemPedido[] };

interface Resumo {
  pedidos: number;
  faturamento_centavos: number;
  comissao_centavos: number;
  ticket_medio_centavos: number;
}

interface Entregador {
  id: number;
  nome: string;
  telefone?: string | null;
}

const STATUS_ATIVOS = ['pendente', 'aceito', 'preparando', 'pronto', 'em_entrega'];

/* ─── utilitário de impressão ─── */
function imprimirPedido(p: PedidoComItens) {
  const w = window.open('', '_blank', 'width=360,height=620,toolbar=0');
  if (!w) return;
  const fmt = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
  const pagto =
    p.forma_pagamento === 'pix' ? 'Pix'
    : p.forma_pagamento === 'dinheiro' ? `Dinheiro${p.troco_para_centavos ? ` / troco ${fmt(p.troco_para_centavos)}` : ''}`
    : 'Cartão na entrega';
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Pedido #${p.id}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:monospace;font-size:13px;padding:16px;max-width:320px}
  h1{font-size:16px;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:10px}
  .row{display:flex;justify-content:space-between;margin-bottom:4px}
  .sep{border-top:1px dashed #666;margin:8px 0}
  .total{font-size:15px;font-weight:bold}
  .obs{background:#f5f5f5;padding:6px;margin-top:8px;border-radius:4px;font-size:12px}
</style></head><body>
<h1>PEDIDO #${p.id}</h1>
<div class="row"><span>Cliente:</span><span>${p.cliente_nome}</span></div>
<div class="row"><span>Pagamento:</span><span>${pagto}</span></div>
<div class="row"><span>Data:</span><span>${dataLocal(p.criado_em)}</span></div>
<div class="sep"></div>
${(p.itens || []).map(i => `
<div class="row">
  <span>${i.quantidade}× ${i.nome_produto}${i.opcoes_texto ? ` (${i.opcoes_texto})` : ''}</span>
  <span>${fmt(i.preco_unit_centavos * i.quantidade)}</span>
</div>`).join('')}
<div class="sep"></div>
<div class="row total"><span>TOTAL</span><span>${fmt(p.total_centavos)}</span></div>
${p.endereco_entrega ? `<div class="sep"></div><div>📍 ${p.endereco_entrega}</div>` : ''}
${p.observacoes ? `<div class="obs">📝 ${p.observacoes}</div>` : ''}
</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

/* ─── componente principal ─── */
export function DashboardLoja() {
  const { mostrar } = useToast();
  const qc = useQueryClient();

  // Dupla confirmação para fechar loja (evita toque acidental)
  const [confirmandoFechamento, setConfirmandoFechamento] = useState(false);
  const timerFechamento = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lojaQ = useQuery({
    queryKey: ['lojista-loja-dashboard'],
    queryFn: () => api<{ loja: any }>('GET', '/api/lojista/loja').then(r => r.loja),
  });

  const relQ = useQuery({
    queryKey: ['lojista-relatorios', 'dia'],
    queryFn: () =>
      api<{ resumo: Resumo }>('GET', '/api/lojista/relatorios?periodo=dia').then(r => r.resumo),
    refetchInterval: 60_000,
  });

  const pedidosQ = usePedidosLojaAtivos();

  const entregadoresQ = useQuery({
    queryKey: ['lojista-entregadores'],
    queryFn: () =>
      api<{ entregadores: Entregador[] }>('GET', '/api/lojista/entregadores').then(r => r.entregadores),
  });

  const loja = lojaQ.data;
  const resumo = relQ.data;
  const pedidosAtivos = (pedidosQ.data ?? []).filter(p => STATUS_ATIVOS.includes(p.status));
  const pendentes = pedidosAtivos.filter(p => p.status === 'pendente');

  async function toggleAberta() {
    if (!loja) return;

    // Abrir: direto, sem confirmação
    if (!loja.aberta) {
      try {
        const r = await api<{ aberta: boolean }>('POST', '/api/lojista/loja/abrir-fechar');
        qc.setQueryData(['lojista-loja-dashboard'], (old: any) => ({ ...old, aberta: r.aberta ? 1 : 0 }));
        mostrar({ tipo: 'sucesso', titulo: 'Loja aberta!' });
      } catch (e) {
        if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
      }
      return;
    }

    // Fechar: primeiro toque pede confirmação, segundo toque executa
    if (!confirmandoFechamento) {
      setConfirmandoFechamento(true);
      timerFechamento.current = setTimeout(() => setConfirmandoFechamento(false), 4000);
      return;
    }

    if (timerFechamento.current) clearTimeout(timerFechamento.current);
    setConfirmandoFechamento(false);
    try {
      const r = await api<{ aberta: boolean }>('POST', '/api/lojista/loja/abrir-fechar');
      qc.setQueryData(['lojista-loja-dashboard'], (old: any) => ({ ...old, aberta: r.aberta ? 1 : 0 }));
      mostrar({ tipo: 'sucesso', titulo: 'Loja fechada.' });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Status da loja ── */}
      {lojaQ.isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <div className={cn(
          'relative overflow-hidden rounded-2xl border shadow-sm',
          loja?.aberta
            ? 'border-primary/40 bg-gradient-to-br from-primary/10 via-card to-card'
            : 'border-border bg-card',
        )}>
          {/* Barra lateral na cor do tema */}
          <div className={cn('absolute left-0 top-0 h-full w-1.5', loja?.aberta ? 'bg-primary' : 'bg-muted-foreground/30')} />

          <div className="flex items-center gap-3 p-4 pl-5">
            {/* Ícone da loja */}
            <div className={cn(
              'flex size-14 shrink-0 items-center justify-center rounded-2xl',
              loja?.aberta ? 'bg-primary/15' : 'bg-muted',
            )}>
              <Store className={cn('size-7', loja?.aberta ? 'text-primary' : 'text-muted-foreground')} />
            </div>

            {/* Nome + status */}
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-extrabold truncate leading-tight">{loja?.nome}</h2>
              <div className="mt-1 flex items-center gap-1.5">
                <span className={cn('size-2 rounded-full', loja?.aberta ? 'bg-primary' : 'bg-muted-foreground')} />
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-semibold',
                  loja?.aberta ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                )}>
                  {loja?.aberta ? 'Online' : 'Offline'}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground truncate">
                {loja?.aberta ? 'Loja aberta — recebendo pedidos' : 'Loja fechada — não recebendo pedidos'}
              </p>
              {confirmandoFechamento && (
                <p className="text-xs font-semibold text-destructive mt-1 animate-pulse">
                  Toque no botão de novo para confirmar
                </p>
              )}
            </div>

            {/* Mascote (imagem já traz o blob de fundo) */}
            <img
              src="/mascote/mascote.png"
              alt=""
              className="hidden xs:block -my-2 -ml-2 h-24 w-auto max-w-none shrink-0 self-center select-none pointer-events-none"
            />

            {/* Switch Loja / Ativa */}
            <button
              onClick={toggleAberta}
              title={loja?.aberta ? 'Fechar loja' : 'Abrir loja'}
              className="flex shrink-0 flex-col items-center gap-1.5"
            >
              <span className="text-xs font-semibold text-muted-foreground">Loja</span>
              <span className={cn(
                'relative inline-flex h-7 w-[52px] items-center rounded-full transition-colors',
                confirmandoFechamento ? 'bg-destructive' : loja?.aberta ? 'bg-primary' : 'bg-muted-foreground/40',
              )}>
                <span className={cn(
                  'inline-block size-5 transform rounded-full bg-white shadow-md transition-transform',
                  loja?.aberta && !confirmandoFechamento ? 'translate-x-[26px]' : 'translate-x-1',
                )} />
              </span>
              <span className={cn(
                'rounded-lg px-2 py-0.5 text-xs font-bold',
                loja?.aberta ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
              )}>
                {loja?.aberta ? 'Ativa' : 'Inativa'}
              </span>
            </button>
          </div>

          {/* Botão ver loja */}
          {loja?.id && (
            <div className="px-4 pb-4">
              <button
                className="relative flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background text-sm font-semibold shadow-sm transition hover:bg-accent"
                onClick={() => window.open(`/${(loja as any).slug || loja.id}`, '_blank')}
              >
                <Eye className="size-4" /> Ver minha loja
                <ChevronRight className="size-4 absolute right-3 text-muted-foreground" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Alerta de pendentes ── */}
      {pendentes.length > 0 && (
        <div className="rounded-xl border-2 border-amber-500/70 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-400">
            <Bell className="size-5 animate-pulse" />
            {pendentes.length} pedido{pendentes.length > 1 ? 's' : ''} aguardando confirmação
          </div>
          {pendentes.map(p => (
            <CardPedidoDash
              key={p.id}
              pedido={p}
              entregadores={entregadoresQ.data ?? []}
              aoAtualizar={() => pedidosQ.refetch()}
            />
          ))}
        </div>
      )}

      {/* ── Métricas de hoje ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Hoje</h3>
          <Link to="/lojista/relatorios" className="text-xs font-semibold text-primary flex items-center gap-0.5">
            Ver relatórios <ArrowRight className="size-3" />
          </Link>
        </div>
        {relQ.isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <MetricaCard
              icone={<ShoppingBag className="size-4" />}
              valor={String(resumo?.pedidos ?? 0)}
              label="Pedidos entregues"
            />
            <MetricaCard
              icone={<TrendingUp className="size-4" />}
              valor={brl(resumo?.faturamento_centavos ?? 0)}
              label="Faturamento"
              destaque
            />
            <MetricaCard
              icone={<Clock className="size-4" />}
              valor={String(pedidosAtivos.length)}
              label="Em andamento"
            />
            <MetricaCard
              icone={<Users className="size-4" />}
              valor={brl(resumo?.ticket_medio_centavos ?? 0)}
              label="Ticket médio"
            />
          </div>
        )}
      </div>

      {/* ── Pedidos em andamento (não pendentes) ── */}
      {pedidosAtivos.filter(p => p.status !== 'pendente').length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Em andamento
          </h3>
          <div className="space-y-3">
            {pedidosAtivos
              .filter(p => p.status !== 'pendente')
              .map(p => (
                <CardPedidoDash
                  key={p.id}
                  pedido={p}
                  entregadores={entregadoresQ.data ?? []}
                  aoAtualizar={() => pedidosQ.refetch()}
                />
              ))}
          </div>
        </div>
      )}

      {pedidosAtivos.length === 0 && !pedidosQ.isLoading && (
        <Card>
          <CardContent className="p-8 text-center space-y-2 text-muted-foreground">
            <Bell className="size-8 mx-auto opacity-20" />
            <p className="font-medium">Nenhum pedido ativo agora</p>
            <p className="text-sm">Os pedidos aparecem aqui em tempo real.</p>
          </CardContent>
        </Card>
      )}

      {/* ── Atalhos rápidos ── */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Atalhos</h3>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <Atalho to="/lojista/produtos" icone={Box} rotulo="Produtos" />
          <Atalho to="/lojista/cupons" icone={Ticket} rotulo="Cupons" />
          <Atalho to="/lojista/vendas" icone={UtensilsCrossed} rotulo="Vendas" />
          <Atalho to="/lojista/config" icone={Settings} rotulo="Config" />
          <Atalho to="/lojista/relatorios" icone={BarChart3} rotulo="Relatórios" />
          <Atalho to="/lojista/avaliacoes" icone={Star} rotulo="Avaliações" />
        </div>
      </div>
    </div>
  );
}

/* ─── card de pedido no dashboard ─── */
function CardPedidoDash({
  pedido: p, entregadores, aoAtualizar,
}: {
  pedido: PedidoComItens;
  entregadores: Entregador[];
  aoAtualizar: () => void;
}) {
  const { mostrar } = useToast();
  const [atribuindo, setAtribuindo] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const [motivoRecusa, setMotivoRecusa] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [chatAberto, setChatAberto] = useState(false);

  async function acao(tipo: 'aceitar' | 'recusar' | 'preparar' | 'pronto', motivo?: string) {
    setCarregando(true);
    try {
      await api('POST', `/api/lojista/pedidos/${p.id}/acao`, { acao: tipo, motivo });
      setRecusando(false);
      setMotivoRecusa('');
      aoAtualizar();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally {
      setCarregando(false);
    }
  }

  const [estornando, setEstornando] = useState(false);
  async function estornar() {
    if (!confirm('Estornar este pagamento Pix e cancelar o pedido? Essa ação não pode ser desfeita.')) return;
    setEstornando(true);
    try {
      await api('POST', `/api/lojista/pedidos/${p.id}/estornar`);
      mostrar({ tipo: 'sucesso', titulo: 'Pagamento estornado e pedido cancelado.' });
      aoAtualizar();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally {
      setEstornando(false);
    }
  }

  async function atribuirEntregador(entregadorId: number) {
    try {
      await api('POST', `/api/lojista/pedidos/${p.id}/atribuir-entregador`, { entregador_id: entregadorId });
      mostrar({ tipo: 'sucesso', titulo: 'Entregador atribuído!' });
      setAtribuindo(false);
      aoAtualizar();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    }
  }

  const botoes = () => {
    switch (p.status) {
      case 'pendente':
        if (recusando) {
          return (
            <div className="space-y-2 w-full">
              <textarea
                autoFocus
                rows={2}
                placeholder="Motivo da recusa — o cliente vai receber esta mensagem…"
                value={motivoRecusa}
                onChange={e => setMotivoRecusa(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-destructive/40 bg-background focus:outline-none focus:ring-2 focus:ring-destructive/30 resize-none"
              />
              <div className="flex gap-2">
                <Button
                  variant="destructive" size="sm" className="flex-1" disabled={carregando}
                  onClick={() => acao('recusar', motivoRecusa || 'Pedido recusado.')}
                >
                  <XCircle className="size-3.5" /> Confirmar recusa
                </Button>
                <Button variant="outline" size="sm" disabled={carregando}
                  onClick={() => { setRecusando(false); setMotivoRecusa(''); }}>
                  Cancelar
                </Button>
              </div>
            </div>
          );
        }
        return (
          <>
            <Button variant="success" size="sm" disabled={carregando} onClick={() => acao('aceitar')}>
              <CheckCircle2 className="size-3.5" /> Aceitar
            </Button>
            <Button variant="destructive" size="sm" disabled={carregando} onClick={() => setRecusando(true)}>
              <XCircle className="size-3.5" /> Recusar
            </Button>
          </>
        );
      case 'aceito':
        return (
          <Button size="sm" disabled={carregando} onClick={() => acao('preparar')}>
            <ChefHat className="size-3.5" /> Iniciar preparo
          </Button>
        );
      case 'preparando':
        return (
          <Button variant="success" size="sm" disabled={carregando} onClick={() => acao('pronto')}>
            <Package className="size-3.5" /> Marcar como pronto
          </Button>
        );
      case 'pronto':
        return (
          <>
            <Badge variant="info">Aguardando entregador</Badge>
            {entregadores.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setAtribuindo(a => !a)}>
                <Bike className="size-3.5" /> Atribuir entregador
              </Button>
            )}
          </>
        );
      case 'em_entrega':
        return <Badge variant="info">Saiu para entrega 🛵</Badge>;
      default:
        return null;
    }
  };

  return (
    <Card className={cn(p.status === 'pendente' && 'border-amber-500/50 bg-background')}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm">#{p.id} · {p.cliente_nome}</span>
              {p.status === 'pendente' && (
                <span className="animate-pulse rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                  NOVO
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground/70">{tempoRelativo(p.criado_em)}</span>
              {' · '}
              {p.forma_pagamento === 'pix' ? 'Pix'
                : p.forma_pagamento === 'dinheiro' ? 'Dinheiro'
                : 'Cartão na entrega'}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setChatAberto(true)}
              className="relative p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
              title="Chat com o cliente"
            >
              <MessagesSquare className="size-4" />
              {!!p.mensagens_nao_lidas && (
                <span className="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-destructive text-[8px] font-bold text-white">
                  {p.mensagens_nao_lidas > 9 ? '9+' : p.mensagens_nao_lidas}
                </span>
              )}
            </button>
            <button
              onClick={() => imprimirPedido(p)}
              className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
              title="Imprimir pedido"
            >
              <Printer className="size-4" />
            </button>
            <StatusBadge status={p.status} />
          </div>
        </div>

        <div className="text-sm space-y-0.5 mb-3">
          {p.itens.map((i, idx) => (
            <div key={idx} className="flex justify-between gap-2 text-muted-foreground">
              <span>
                <span className="tabular-nums mr-1">{i.quantidade}×</span>
                {i.nome_produto}
                {i.opcoes_texto && (
                  <span className="block text-xs pl-5 text-muted-foreground/70">{i.opcoes_texto}</span>
                )}
              </span>
              <span className="tabular-nums font-medium">{brl(i.preco_unit_centavos * i.quantidade)}</span>
            </div>
          ))}
          <div className="flex justify-between font-bold pt-1.5 border-t border-dashed border-border/60">
            <span>Total</span>
            <span className="tabular-nums">{brl(p.total_centavos)}</span>
          </div>
        </div>

        {p.endereco_entrega && (
          <div className="text-xs text-muted-foreground mb-2">📍 {p.endereco_entrega}</div>
        )}
        {p.observacoes && (
          <div className="rounded-lg bg-blue-500/10 px-3 py-2 text-xs text-blue-700 dark:text-blue-300 mb-2">
            📝 {p.observacoes}
          </div>
        )}

        <div className="flex flex-wrap gap-2">{botoes()}</div>

        {p.forma_pagamento === 'pix' && p.pagamento_status === 'aprovado' && !p.estornado_em
          && !['entregue', 'em_entrega', 'cancelado'].includes(p.status) && (
          <Button variant="ghost" size="sm" disabled={estornando} onClick={estornar} className="mt-2 text-destructive hover:text-destructive">
            {estornando ? 'Estornando…' : 'Estornar pagamento e cancelar'}
          </Button>
        )}

        {/* Seletor de entregador */}
        {atribuindo && entregadores.length > 0 && (
          <div className="mt-3 pt-3 border-t space-y-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
              Escolher entregador
            </p>
            {entregadores.map(e => (
              <button
                key={e.id}
                onClick={() => atribuirEntregador(e.id)}
                className="flex w-full items-center gap-2 rounded-xl border p-2.5 text-left hover:border-primary hover:bg-accent/50 transition-colors"
              >
                <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm shrink-0">
                  {(e.nome || '?').charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-semibold">{e.nome}</div>
                  {e.telefone && <div className="text-xs text-muted-foreground">{e.telefone}</div>}
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>

      <ChatPedido
        basePath={`/api/lojista/pedidos/${p.id}`}
        remetenteProprio="loja"
        nomeContato={p.cliente_nome || 'Cliente'}
        aberto={chatAberto}
        onFechar={() => setChatAberto(false)}
      />
    </Card>
  );
}

/* ─── card de métrica ─── */
function MetricaCard({
  icone, valor, label, destaque = false,
}: {
  icone: React.ReactNode;
  valor: string;
  label: string;
  destaque?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-muted-foreground mb-2">{icone}</div>
        <div className={cn('text-2xl font-extrabold tabular-nums leading-tight', destaque && 'text-success')}>
          {valor}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}

/* ─── atalhos rápidos ─── */
function Atalho({ to, icone: Icone, rotulo }: { to: string; icone: typeof Box; rotulo: string }) {
  return (
    <Link to={to}>
      <Card className="hover:border-primary/50 transition-colors">
        <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
            <Icone className="size-5 text-primary" />
          </div>
          <span className="text-xs font-semibold">{rotulo}</span>
        </CardContent>
      </Card>
    </Link>
  );
}
