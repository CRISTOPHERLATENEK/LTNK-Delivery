/**
 * Monitor ao vivo — pedidos em andamento de TODAS as lojas, atualizando sozinho.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Radio, Store, Clock, Bike, Bell, BellOff } from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Falha } from '@/components/ui/estado';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api';
import { brl, tempoRelativo } from '@/lib/format';
import { cn } from '@/lib/utils';

interface PedidoMonitor {
  id: number;
  status: string;
  total_centavos: number;
  criado_em: string;
  loja_nome: string;
  cliente_nome: string;
  entregador_nome: string | null;
  /** Presente só na visão agregada do painel master. */
  tenant_id?: number;
  tenant_nome?: string;
}

const COLUNAS: Array<{ status: string; rotulo: string }> = [
  { status: 'pendente',   rotulo: 'Aguardando loja' },
  { status: 'aceito',     rotulo: 'Aceitos' },
  { status: 'preparando', rotulo: 'Em preparo' },
  { status: 'pronto',     rotulo: 'Prontos' },
  { status: 'em_entrega', rotulo: 'Em entrega' },
];

const CHAVE_SOM = 'admin:monitor:som';

/**
 * Minutos de espera que viram alerta.
 *
 * Só valem pra `pendente`: é o único estado em que ninguém está trabalhando no
 * pedido — ele está parado esperando a loja aceitar. "Em preparo" há 20 minutos
 * é uma pizza no forno, não um problema.
 */
const ALERTA_AMBAR = 10;
const ALERTA_VERMELHO = 20;

function minutosDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

export function TelaMonitor() {
  const monitorQ = useQuery({
    queryKey: ['admin-monitor'],
    queryFn: () => api<{ pedidos: PedidoMonitor[] }>('GET', '/api/admin/monitor').then(r => r.pedidos),
    refetchInterval: 5000,
  });
  const pedidos = monitorQ.data ?? [];

  /*
   * Re-renderiza a cada 30s pra ESPERA envelhecer na tela.
   *
   * Os dados chegam a cada 5s, mas um pedido que ninguém mexe não vem alterado
   * — e sem este tick ele ficaria "há 9 min" pra sempre, nunca virando âmbar.
   */
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const [som, setSom] = useState(() => localStorage.getItem(CHAVE_SOM) === '1');
  function alternarSom() {
    const novo = !som;
    setSom(novo);
    localStorage.setItem(CHAVE_SOM, novo ? '1' : '0');
  }

  /*
   * TOCA quando aparece pedido pendente NOVO — não a cada atualização.
   *
   * Guarda os ids já vistos: sem isso o som dispararia a cada 5 segundos
   * enquanto o pedido continuasse pendente, e alguém desligaria o recurso no
   * primeiro minuto.
   */
  const vistosRef = useRef<Set<number> | null>(null);
  useEffect(() => {
    const pendentes = pedidos.filter(p => p.status === 'pendente').map(p => p.id);
    // Primeira carga só memoriza: senão tocaria pra fila que já existia antes
    // de a tela abrir.
    if (vistosRef.current === null) {
      vistosRef.current = new Set(pendentes);
      return;
    }
    const novos = pendentes.filter(id => !vistosRef.current!.has(id));
    pendentes.forEach(id => vistosRef.current!.add(id));
    if (novos.length === 0 || !som) return;
    try {
      // Bipe gerado na hora: um arquivo de áudio seria mais um recurso pra
      // servir e pra falhar em silêncio se não carregasse.
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.frequency.value = 880;
      vol.gain.value = 0.06;
      osc.connect(vol); vol.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } catch { /* navegador sem permissão de áudio: silêncio é melhor que erro */ }
  }, [pedidos, som]);

  return (
    <AdminLayout titulo="Monitor">
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold">
              Monitor ao vivo
              <span className="ml-1 inline-flex size-2.5 animate-pulse rounded-full bg-emerald-500" title="Atualizando" />
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {pedidos.length} pedido{pedidos.length !== 1 ? 's' : ''} em andamento · atualiza a cada 5s
            </p>
          </div>
          <button
            type="button"
            onClick={alternarSom}
            className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
              som ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent')}
            title="Toca um bipe quando entra pedido novo"
          >
            {som ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}
            {som ? 'Som ligado' : 'Som desligado'}
          </button>
        </div>

        {monitorQ.isLoading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {COLUNAS.map(c => <Skeleton key={c.status} className="h-40 rounded-xl" />)}
          </div>
        )}

        {monitorQ.isError && (
          <Falha compacto erro={monitorQ.error} aoTentar={() => monitorQ.refetch()} />
        )}

        {!monitorQ.isLoading && pedidos.length === 0 && !monitorQ.isError && (
          <Card><CardContent className="space-y-2 p-12 text-center text-muted-foreground">
            <Radio className="mx-auto size-10 opacity-20" />
            <p className="font-medium">Nenhum pedido em andamento</p>
            <p className="text-sm">Os pedidos de todas as lojas aparecem aqui em tempo real.</p>
          </CardContent></Card>
        )}

        {!monitorQ.isLoading && pedidos.length > 0 && (
          <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {COLUNAS.map(col => {
              const doStatus = pedidos.filter(p => p.status === col.status);
              /*
               * COLUNA VAZIA SOME no desktop. Com cinco colunas fixas, duas
               * vazias comiam 40% da largura pra dizer "vazio" — e apertavam
               * justamente a coluna que tem pedido. No celular a grade é de uma
               * ou duas colunas, então some também sem deixar buraco.
               */
              if (doStatus.length === 0) return null;
              return (
                <div key={col.status} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{col.rotulo}</span>
                    <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold">{doStatus.length}</span>
                  </div>
                  {doStatus.map(p => {
                    const min = minutosDesde(p.criado_em);
                    const esperando = p.status === 'pendente';
                    const vermelho = esperando && min >= ALERTA_VERMELHO;
                    const ambar = esperando && !vermelho && min >= ALERTA_AMBAR;
                    return (
                      <Card
                        key={`${p.tenant_id ?? 0}-${p.id}`}
                        className={cn('transition-shadow hover:shadow-sm',
                          vermelho && 'border-destructive/60 bg-destructive/5',
                          ambar && 'border-amber-500/60 bg-amber-500/5')}
                      >
                        <CardContent className="space-y-1.5 p-3">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs text-muted-foreground">#{p.id}</span>
                            <StatusBadge status={p.status as any} />
                          </div>
                          <div className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
                            <Store className="size-3.5 shrink-0 text-primary" />
                            <span className="truncate">{p.loja_nome}</span>
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{p.cliente_nome}</div>
                          {p.entregador_nome && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Bike className="size-3" /> {p.entregador_nome}
                            </div>
                          )}
                          <div className="flex items-center justify-between pt-0.5">
                            {/*
                              A ESPERA É O ALERTA da tela. Em pedido pendente ela
                              ganha peso e cor; nos outros estados continua sendo
                              informação de rodapé.
                            */}
                            <span className={cn('flex items-center gap-1 text-[11px]',
                              vermelho ? 'font-bold text-destructive'
                                : ambar ? 'font-bold text-amber-700 dark:text-amber-400'
                                : 'text-muted-foreground')}>
                              <Clock className="size-3" />
                              {esperando && min >= ALERTA_AMBAR
                                ? `parado há ${min} min`
                                : tempoRelativo(p.criado_em)}
                            </span>
                            <span className="text-xs font-bold tabular-nums">{brl(p.total_centavos)}</span>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
