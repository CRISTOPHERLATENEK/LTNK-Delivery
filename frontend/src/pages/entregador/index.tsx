/**
 * Painel do entregador — corridas disponíveis, entrega ativa e ganhos.
 * Gerencia seu próprio login (sem Guard externo), padrão igual ao lojista.
 */
import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bike, MapPin, Phone, Store, CheckCircle2, ExternalLink,
  Activity, DollarSign, Home, TrendingUp, Clock, ArrowRight, Navigation, Bell, MessagesSquare,
  Check, AlertTriangle, Wallet, Route as RouteIcon, ChevronDown, ChevronUp,
} from 'lucide-react';
import { AppLayout } from '@/components/app-layout';
import { ChatPedido } from '@/components/chat-pedido';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError, sessaoUsuario, salvarSessao } from '@/lib/api';
import { brl, dataLocal } from '@/lib/format';
import { cn } from '@/lib/utils';

const MapaRota = lazy(() => import('@/components/mapa-rota').then(m => ({ default: m.MapaRota })));

const ITENS_NAV = [
  { rota: '/entregador', icone: Home, rotulo: 'Corridas' },
  { rota: '/entregador/ativa', icone: Activity, rotulo: 'Ativa' },
  { rota: '/entregador/ganhos', icone: DollarSign, rotulo: 'Ganhos' },
];

interface Corrida {
  id: number;
  endereco_entrega: string;
  entrega_lat?: number | null;
  entrega_lon?: number | null;
  taxa_entrega_centavos: number;
  total_centavos: number;
  forma_pagamento: 'pix' | 'dinheiro' | 'cartao_entrega';
  troco_para_centavos?: number | null;
  loja_nome: string;
  loja_endereco: string;
}

type EtapaEntrega = 'aceita' | 'a_caminho_loja' | 'chegou_loja' | 'saiu_loja';

interface PedidoAtivo extends Corrida {
  cliente_nome: string;
  cliente_telefone?: string | null;
  observacoes?: string;
  loja_lat?: number | null;
  loja_lon?: number | null;
  entregador_etapa: EtapaEntrega;
  etapas: { etapa: EtapaEntrega; criado_em: string }[];
}

/** As 6 etapas exibidas no rastreador — as 2 últimas são derivadas (sem toque manual). */
const ETAPAS_STEPPER: { chave: EtapaEntrega | 'a_caminho_cliente' | 'entregue'; rotulo: string }[] = [
  { chave: 'aceita', rotulo: 'Aceita' },
  { chave: 'a_caminho_loja', rotulo: 'A caminho da loja' },
  { chave: 'chegou_loja', rotulo: 'Cheguei na loja' },
  { chave: 'saiu_loja', rotulo: 'Sai da loja' },
  { chave: 'a_caminho_cliente', rotulo: 'A caminho do cliente' },
  { chave: 'entregue', rotulo: 'Entregue' },
];
const SEQUENCIA_ETAPAS: EtapaEntrega[] = ['aceita', 'a_caminho_loja', 'chegou_loja', 'saiu_loja'];
const PROXIMA_ACAO: Record<EtapaEntrega, { proxima: EtapaEntrega; rotulo: string }> = {
  aceita: { proxima: 'a_caminho_loja', rotulo: 'Estou indo até a loja' },
  a_caminho_loja: { proxima: 'chegou_loja', rotulo: 'Cheguei na loja' },
  chegou_loja: { proxima: 'saiu_loja', rotulo: 'Saí da loja, indo entregar' },
  saiu_loja: { proxima: 'saiu_loja', rotulo: '' }, // última etapa manual — a partir daqui usa os botões de chegada/entrega
};

interface Entrega {
  id: number;
  endereco_entrega: string;
  taxa_entrega_centavos: number;
  atualizado_em: string;
  loja_nome: string;
}

export function TelaEntregador() {
  const u = sessaoUsuario();
  if (!u || u.perfil !== 'entregador') return <LoginEntregador />;

  return (
    <AppLayout itens={ITENS_NAV} titulo="Entregador" subtitulo={u.nome}>
      <Routes>
        <Route index element={<CorridasDisponiveis />} />
        <Route path="ativa" element={<EntregaAtiva />} />
        <Route path="ganhos" element={<Ganhos />} />
        <Route path="*" element={<CorridasDisponiveis />} />
      </Routes>
    </AppLayout>
  );
}

function CorridasDisponiveis() {
  const { mostrar } = useToast();

  const consulta = useQuery({
    queryKey: ['corridas'],
    queryFn: () =>
      api<{ corridas: Corrida[] }>('GET', '/api/entregador/corridas').then(r => r.corridas),
    refetchInterval: 5000,
  });

  const ativaQ = useQuery({
    queryKey: ['entrega-ativa'],
    queryFn: () =>
      api<{ pedido: PedidoAtivo | null }>('GET', '/api/entregador/atual').then(r => r.pedido),
    refetchInterval: 5000,
  });

  async function aceitar(id: number) {
    try {
      await api('POST', `/api/entregador/corridas/${id}/aceitar`);
      mostrar({ tipo: 'sucesso', titulo: 'Corrida aceita! Boa entrega.' });
      consulta.refetch();
      ativaQ.refetch();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    }
  }

  const temAtiva = !!ativaQ.data;

  return (
    <div className="space-y-4">
      {temAtiva && (
        <a href="/entregador/ativa" className="block">
          <div className="rounded-2xl border-2 border-primary bg-primary/5 p-4 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0">
              <Activity className="size-5 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-primary">Entrega em andamento</div>
              <p className="text-sm text-muted-foreground">Conclua antes de aceitar outra.</p>
            </div>
            <ArrowRight className="size-5 text-primary shrink-0" />
          </div>
        </a>
      )}

      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-bold text-base">
          <Bike className="size-5 text-primary" />
          Corridas disponíveis
        </h2>
        {consulta.data && (
          <Badge variant={consulta.data.length > 0 ? 'success' : 'secondary'}>
            {consulta.data.length} disponível{consulta.data.length !== 1 ? 'is' : ''}
          </Badge>
        )}
      </div>

      {consulta.isLoading && (
        <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>
      )}

      {consulta.data?.length === 0 && !consulta.isLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
          <div className="text-5xl">🛵</div>
          <p className="font-semibold">Nenhuma corrida no momento</p>
          <p className="text-sm text-muted-foreground">Atualiza automaticamente a cada 5 s.</p>
        </div>
      )}

      <div className="space-y-3">
        {consulta.data?.map(c => (
          <Card key={c.id} className="overflow-hidden">
            <div className="px-5 py-3 bg-success/10 border-b border-success/20 flex items-center justify-between">
              <div>
                <div className="font-bold">#{String(c.id).padStart(4, '0')} · {c.loja_nome}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {c.forma_pagamento === 'pix' && '🔑 Pix'}
                  {c.forma_pagamento === 'dinheiro' && `💵 Dinheiro${c.troco_para_centavos ? ` · troco para ${brl(c.troco_para_centavos)}` : ''}`}
                  {c.forma_pagamento === 'cartao_entrega' && '💳 Cartão na entrega'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-extrabold tabular-nums text-success">
                  {brl(c.taxa_entrega_centavos)}
                </div>
                <div className="text-xs text-muted-foreground">seu frete</div>
              </div>
            </div>

            <CardContent className="p-4 space-y-3">
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2.5 text-muted-foreground">
                  <Store className="size-4 mt-0.5 shrink-0 text-amber-500" />
                  <span><span className="font-semibold text-foreground">Retirada:</span> {c.loja_endereco || 'Confirmar com a loja'}</span>
                </div>
                <div className="flex items-start gap-2.5 text-muted-foreground">
                  <MapPin className="size-4 mt-0.5 shrink-0 text-primary" />
                  <span><span className="font-semibold text-foreground">Entrega:</span> {c.endereco_entrega}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  size="lg"
                  variant="success"
                  className="flex-1 rounded-xl"
                  onClick={() => aceitar(c.id)}
                  disabled={temAtiva}
                >
                  Aceitar corrida
                </Button>
                <Button size="lg" variant="outline" className="rounded-xl px-3" asChild>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.loja_endereco || c.loja_nome)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Ver no mapa"
                  >
                    <MapPin className="size-4" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * Compartilha a posição GPS do entregador com o servidor enquanto há entrega
 * ativa. Usa watchPosition (atualiza ao mover) com throttle de ~8s para não
 * sobrecarregar a API. Retorna o estado do rastreamento para feedback na UI.
 */
type EstadoGPS = 'inativo' | 'aguardando' | 'ativo' | 'negado' | 'indisponivel';

function useCompartilharLocalizacao(pedidoId: number | undefined): { estado: EstadoGPS; posicao: { lat: number; lng: number } | null } {
  const [estado, setEstado] = useState<EstadoGPS>('inativo');
  const [posicao, setPosicao] = useState<{ lat: number; lng: number } | null>(null);
  const ultimoEnvio = useRef(0);

  useEffect(() => {
    if (!pedidoId) { setEstado('inativo'); return; }
    if (!('geolocation' in navigator)) { setEstado('indisponivel'); return; }

    setEstado('aguardando');
    const watchId = navigator.geolocation.watchPosition(
      pos => {
        setEstado('ativo');
        setPosicao({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        const agora = Date.now();
        // Throttle: no máximo 1 envio a cada 8 segundos.
        if (agora - ultimoEnvio.current < 8000) return;
        ultimoEnvio.current = agora;
        api('POST', `/api/entregador/corridas/${pedidoId}/localizacao`, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }).catch(() => { /* silencioso: tenta de novo no próximo tick */ });
      },
      err => {
        setEstado(err.code === err.PERMISSION_DENIED ? 'negado' : 'indisponivel');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [pedidoId]);

  return { estado, posicao };
}

function EntregaAtiva() {
  const { mostrar } = useToast();
  const pedirConfirmacao = useConfirm();

  const consulta = useQuery({
    queryKey: ['entrega-ativa'],
    queryFn: () =>
      api<{ pedido: PedidoAtivo | null }>('GET', '/api/entregador/atual').then(r => r.pedido),
    refetchInterval: 5000,
  });

  const { estado: estadoGPS, posicao } = useCompartilharLocalizacao(consulta.data?.id);
  const [avisando, setAvisando] = useState(false);
  const [avisou, setAvisou] = useState(false);
  const [chatAberto, setChatAberto] = useState(false);
  const [avancando, setAvancando] = useState(false);
  const [detalhesAbertos, setDetalhesAbertos] = useState(false);
  const [rota, setRota] = useState<{ distanciaKm: number; duracaoMin: number } | null>(null);
  const [problemaAberto, setProblemaAberto] = useState(false);

  async function avancarEtapa(id: number, proxima: EtapaEntrega) {
    setAvancando(true);
    try {
      await api('POST', `/api/entregador/corridas/${id}/etapa`, { etapa: proxima });
      // Espera o refetch trazer a etapa nova antes de reabilitar o botão —
      // senão um clique duplo rápido reenvia a MESMA etapa (já superada) e
      // o backend recusa como "fora de ordem".
      await consulta.refetch();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
      // Se deu "fora de ordem" é porque o servidor já está numa etapa
      // diferente da que a tela mostrava — busca o estado real de novo em
      // vez de deixar o botão errado na tela até um reload manual.
      await consulta.refetch();
    } finally {
      setAvancando(false);
    }
  }

  async function confirmar(id: number) {
    if (!(await pedirConfirmacao({ titulo: 'Confirmar entrega?', descricao: 'Confirme que o pedido foi entregue ao cliente.', confirmar: 'Confirmar entrega' }))) return;
    try {
      await api('POST', `/api/entregador/corridas/${id}/entregar`);
      mostrar({ tipo: 'sucesso', titulo: 'Entrega confirmada! Bom trabalho.' });
      consulta.refetch();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    }
  }

  async function avisarChegada(id: number) {
    setAvisando(true);
    try {
      await api('POST', `/api/entregador/corridas/${id}/chegando`);
      setAvisou(true);
      mostrar({ tipo: 'sucesso', titulo: 'Cliente avisado!', descricao: 'Ele recebeu a notificação que você está chegando.' });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally {
      setAvisando(false);
    }
  }

  if (consulta.isLoading) return <Skeleton className="h-96 rounded-2xl" />;

  if (!consulta.data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
        <div className="text-5xl">✅</div>
        <p className="font-semibold">Nenhuma entrega ativa</p>
        <p className="text-sm text-muted-foreground">Aceite uma corrida para começar.</p>
      </div>
    );
  }

  const p = consulta.data;
  // Com coordenadas (geocodificadas via OpenStreetMap), o mapa abre no ponto
  // EXATO. Sem elas, cai na busca por texto do endereço.
  const mapa = (end: string, lat?: number | null, lon?: number | null) =>
    lat != null && lon != null
      ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(end)}`;

  const temMapa = p.loja_lat != null && p.loja_lon != null && p.entrega_lat != null && p.entrega_lon != null;
  // Entregas aceitas antes desta versão não têm entregador_etapa salva — trata como 'aceita'.
  const etapaAtual: EtapaEntrega = SEQUENCIA_ETAPAS.includes(p.entregador_etapa) ? p.entregador_etapa : 'aceita';
  const indiceEtapa = SEQUENCIA_ETAPAS.indexOf(etapaAtual); // 0..3
  const indiceAtualStepper = indiceEtapa + 1; // próximo item do ETAPAS_STEPPER ainda "em andamento"
  const tempoEtapa = (chave: EtapaEntrega) => p.etapas.find(e => e.etapa === chave)?.criado_em;
  const proximaAcao = PROXIMA_ACAO[etapaAtual];
  const chegouAoCliente = etapaAtual === 'saiu_loja';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-bold text-base">
          <Activity className="size-5 text-primary animate-pulse" />
          Entrega ativa
        </h2>
        <Badge variant="info">#{String(p.id).padStart(4, '0')}</Badge>
      </div>

      {/* Frete + estatísticas da corrida */}
      <Card className="border-success/30 bg-success/5 overflow-hidden">
        <CardContent className="p-4 flex flex-wrap items-center gap-4">
          <div>
            <div className="text-xs text-muted-foreground font-medium">Seu frete</div>
            <div className="text-2xl font-extrabold text-success tabular-nums mt-0.5">
              {brl(p.taxa_entrega_centavos)}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {p.forma_pagamento === 'pix' && 'Pagamento via Pix'}
              {p.forma_pagamento === 'dinheiro' && 'Pagamento em dinheiro'}
              {p.forma_pagamento === 'cartao_entrega' && 'Pagamento na entrega'}
            </div>
          </div>
          <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-2 justify-end">
            <div className="flex items-center gap-2">
              <RouteIcon className="size-4 text-muted-foreground" />
              <div>
                <div className="text-[11px] text-muted-foreground leading-none">Distância total</div>
                <div className="text-sm font-bold tabular-nums mt-0.5">{rota ? `${rota.distanciaKm.toFixed(1)} km` : '—'}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" />
              <div>
                <div className="text-[11px] text-muted-foreground leading-none">Tempo estimado</div>
                <div className="text-sm font-bold tabular-nums mt-0.5">{rota ? `${Math.round(rota.duracaoMin)} min` : '—'}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Wallet className="size-4 text-muted-foreground" />
              <div>
                <div className="text-[11px] text-muted-foreground leading-none">Ganhos da corrida</div>
                <div className="text-sm font-bold tabular-nums mt-0.5 text-success">{brl(p.taxa_entrega_centavos)}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDetalhesAbertos(v => !v)}
              className="inline-flex items-center gap-1 text-xs font-bold text-primary shrink-0"
            >
              Mais detalhes {detalhesAbertos ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Status do rastreamento GPS */}
      <div className={cn(
        'flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm border',
        estadoGPS === 'ativo' && 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300',
        estadoGPS === 'aguardando' && 'bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-300',
        (estadoGPS === 'negado' || estadoGPS === 'indisponivel') && 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300',
      )}>
        <Navigation className={cn('size-4 shrink-0', estadoGPS === 'ativo' && 'animate-pulse')} />
        <span className="flex-1">
          <span className="font-bold">{estadoGPS === 'ativo' ? 'Localização ao vivo' : 'Localização'}</span>
          <span className="text-muted-foreground"> · {estadoGPS === 'ativo' && 'Compartilhada com o cliente em tempo real'}
          {estadoGPS === 'aguardando' && 'Obtendo sua localização…'}
          {estadoGPS === 'negado' && 'Permissão negada — o cliente não verá você no mapa'}
          {estadoGPS === 'indisponivel' && 'GPS indisponível neste dispositivo'}
          {estadoGPS === 'inativo' && 'Rastreamento inativo'}</span>
        </span>
        {estadoGPS === 'ativo' && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold shrink-0">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" /> GPS ativo
          </span>
        )}
      </div>

      {/* Pontos + mapa lado a lado */}
      <div className="lg:grid lg:grid-cols-[320px_1fr] lg:gap-4 lg:items-start space-y-4 lg:space-y-0">
        <div className="space-y-4">
          <div className="rounded-xl bg-amber-500/10 p-4 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              <Store className="size-3.5" /> Ponto 1 — Retirada
            </div>
            <div className="font-bold">{p.loja_nome}</div>
            {p.loja_endereco && (
              <>
                <div className="text-sm text-muted-foreground">{p.loja_endereco}</div>
                <a href={mapa(p.loja_endereco, p.loja_lat, p.loja_lon)} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-600 dark:text-amber-400">
                  <ExternalLink className="size-3" /> Ver no mapa
                </a>
              </>
            )}
          </div>

          <div className="rounded-xl bg-primary/5 p-4 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
              <MapPin className="size-3.5" /> Ponto 2 — Entrega
            </div>
            <div className="font-bold">{p.cliente_nome}</div>
            <div className="flex items-center gap-2 flex-wrap">
              {p.cliente_telefone && (
                <a href={`tel:${p.cliente_telefone}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                  <Phone className="size-3.5" /> {p.cliente_telefone}
                </a>
              )}
              <button
                type="button"
                onClick={() => setChatAberto(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-sm font-bold shadow-sm hover:brightness-105 active:scale-95 transition-all"
              >
                <MessagesSquare className="size-4" /> Chat
              </button>
            </div>
            <div className="text-sm text-muted-foreground">{p.endereco_entrega}</div>
            <a href={mapa(p.endereco_entrega, p.entrega_lat, p.entrega_lon)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-primary">
              <Navigation className="size-3" /> {p.entrega_lat != null ? 'Navegar até o local' : 'Ver no mapa'}
            </a>
          </div>

          {p.observacoes && (
            <div className="rounded-xl bg-blue-500/10 px-3 py-2.5 text-sm text-blue-700 dark:text-blue-300">
              📝 {p.observacoes}
            </div>
          )}

          {detalhesAbertos && (
            <div className="rounded-xl border border-border p-4 space-y-2 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Total do pedido</span>
                <span className="tabular-nums font-semibold text-foreground">{brl(p.total_centavos)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Pagamento</span>
                <span className="font-semibold text-foreground">
                  {p.forma_pagamento === 'pix' && 'Pix'}
                  {p.forma_pagamento === 'dinheiro' && 'Dinheiro'}
                  {p.forma_pagamento === 'cartao_entrega' && 'Cartão'}
                </span>
              </div>
              {p.troco_para_centavos && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Troco para</span>
                  <span className="tabular-nums font-semibold text-foreground">{brl(p.troco_para_centavos)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mapa com a rota real */}
        <Card className="overflow-hidden">
          <div className="h-72 lg:h-full lg:min-h-[380px] w-full bg-muted">
            {temMapa ? (
              <Suspense fallback={<div className="h-full w-full animate-pulse bg-muted" />}>
                <MapaRota
                  origem={{ lat: p.loja_lat!, lng: p.loja_lon!, rotulo: p.loja_nome }}
                  destino={{ lat: p.entrega_lat!, lng: p.entrega_lon!, rotulo: p.cliente_nome }}
                  entregador={posicao}
                  onRota={setRota}
                />
              </Suspense>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center gap-2 p-6">
                <MapPin className="size-8 text-muted-foreground" />
                <p className="text-sm font-semibold">Mapa indisponível</p>
                <p className="text-xs text-muted-foreground max-w-[240px]">
                  Faltam coordenadas da loja ou do endereço de entrega pra desenhar a rota.
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Rastreador de etapas da entrega */}
      <Card>
        <CardContent className="p-5 overflow-x-auto">
          <div className="flex items-center min-w-[560px]">
            {ETAPAS_STEPPER.map((etapa, i) => {
              const estado = i < indiceAtualStepper ? 'feito' : i === indiceAtualStepper ? 'atual' : 'futuro';
              const isLast = i === ETAPAS_STEPPER.length - 1;
              const horario = i < 4 ? tempoEtapa(ETAPAS_STEPPER[i].chave as EtapaEntrega) : undefined;
              return (
                <div key={etapa.chave} className="flex items-center" style={{ flex: isLast ? '0 0 auto' : '1 1 0%' }}>
                  <div className="flex flex-col items-center gap-1.5 shrink-0">
                    <div className={cn(
                      'flex size-8 items-center justify-center rounded-full border-2 shrink-0 transition-all',
                      estado === 'feito' && 'border-emerald-500 bg-emerald-500 text-white',
                      estado === 'atual' && 'border-primary bg-primary text-primary-foreground',
                      estado === 'futuro' && 'border-border bg-muted text-muted-foreground/50',
                    )}>
                      {estado === 'feito' && <Check className="size-4" strokeWidth={3} />}
                      {estado === 'atual' && <Bike className="size-4" />}
                      {estado === 'futuro' && <div className="size-2 rounded-full bg-current" />}
                    </div>
                    <div className="text-center">
                      <div className={cn(
                        'text-[11px] font-bold whitespace-nowrap',
                        estado === 'futuro' ? 'text-muted-foreground' : estado === 'atual' ? 'text-primary' : 'text-emerald-600 dark:text-emerald-400',
                      )}>
                        {etapa.rotulo}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {horario ? new Date(horario).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </div>
                    </div>
                  </div>
                  {!isLast && (
                    <div className={cn('h-0.5 flex-1 mx-1 rounded-full mb-5', i < indiceAtualStepper ? 'bg-emerald-500' : 'bg-border')} />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Ações */}
      <div className="space-y-2">
        {!chegouAoCliente ? (
          <Button
            size="xl" className="w-full rounded-2xl h-14 text-base font-bold"
            onClick={() => avancarEtapa(p.id, proximaAcao.proxima)}
            disabled={avancando}
          >
            <ArrowRight className="size-5" /> {avancando ? 'Atualizando…' : proximaAcao.rotulo}
          </Button>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant={avisou ? 'outline' : 'default'}
              size="xl"
              className="flex-1 rounded-2xl h-14 text-base font-bold"
              onClick={() => avisarChegada(p.id)}
              disabled={avisando || avisou}
            >
              <Bell className="size-4" />
              {avisou ? 'Cliente já avisado ✓' : avisando ? 'Avisando…' : 'Avisar que estou chegando'}
            </Button>
            <Button variant="success" size="xl" className="flex-1 rounded-2xl h-14 text-base font-bold" onClick={() => confirmar(p.id)}>
              <CheckCircle2 className="size-5" /> Confirmar entrega realizada
            </Button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setProblemaAberto(v => !v)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
        >
          <AlertTriangle className="size-4" /> Problemas na entrega
        </button>
        {problemaAberto && (
          <div className="rounded-2xl border border-border bg-card p-4 text-sm space-y-2">
            <p className="text-muted-foreground">
              Endereço errado, cliente não atende, item faltando? Fale direto com o cliente pelo chat,
              ou entre em contato com a loja pelo telefone dela.
            </p>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setChatAberto(true)}>
              <MessagesSquare className="size-3.5" /> Abrir chat com o cliente
            </Button>
          </div>
        )}
      </div>

      <ChatPedido
        basePath={`/api/entregador/corridas/${p.id}`}
        remetenteProprio="entregador"
        nomeContato={p.cliente_nome}
        aberto={chatAberto}
        onFechar={() => setChatAberto(false)}
      />
    </div>
  );
}

type Periodo = 'dia' | 'semana' | 'mes';
const LABEL_PERIODO: Record<Periodo, string> = { dia: 'Hoje', semana: '7 dias', mes: '30 dias' };

function Ganhos() {
  const [periodo, setPeriodo] = useState<Periodo>('semana');

  const consulta = useQuery({
    queryKey: ['entregador-historico', periodo],
    queryFn: () =>
      api<{ periodo: string; entregas: Entrega[]; total_fretes_centavos: number }>(
        'GET',
        `/api/entregador/historico?periodo=${periodo}`,
      ),
  });

  const d = consulta.data;

  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 font-bold text-base">
        <DollarSign className="size-5 text-primary" />
        Meus ganhos
      </h2>

      <PreferenciaChat />

      <div className="flex gap-2 p-1 rounded-2xl bg-accent">
        {(['dia', 'semana', 'mes'] as Periodo[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriodo(p)}
            className={cn(
              'flex-1 py-2 rounded-xl text-sm font-bold transition-all',
              periodo === p
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {LABEL_PERIODO[p]}
          </button>
        ))}
      </div>

      {consulta.isLoading && <Skeleton className="h-28 rounded-2xl" />}

      {d && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card className="border-success/30 bg-success/5">
              <CardContent className="p-4">
                <TrendingUp className="size-4 text-success mb-2" />
                <div className="text-2xl font-extrabold tabular-nums text-success">
                  {brl(d.total_fretes_centavos)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Total em fretes</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <Clock className="size-4 text-muted-foreground mb-2" />
                <div className="text-2xl font-extrabold tabular-nums">{d.entregas.length}</div>
                <div className="text-xs text-muted-foreground mt-1">Entregas realizadas</div>
              </CardContent>
            </Card>
          </div>

          {d.entregas.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nenhuma entrega {periodo === 'dia' ? 'hoje' : `nos últimos ${periodo === 'semana' ? '7' : '30'} dias`}.
            </div>
          ) : (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-1">Histórico</h3>
              {d.entregas.map(e => (
                <Card key={e.id}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-full bg-success/10 text-success shrink-0">
                      <CheckCircle2 className="size-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">#{String(e.id).padStart(4, '0')} · {e.loja_nome}</div>
                      <div className="text-xs text-muted-foreground truncate">{e.endereco_entrega}</div>
                      <div className="text-xs text-muted-foreground">{dataLocal(e.atualizado_em)}</div>
                    </div>
                    <div className="tabular-nums font-bold text-success shrink-0">
                      + {brl(e.taxa_entrega_centavos)}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Como o entregador prefere conversar com o cliente: chat do app ou WhatsApp próprio. */
function PreferenciaChat() {
  const { mostrar } = useToast();
  const [metodo, setMetodo] = useState<'app' | 'whatsapp' | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api<{ metodo: 'app' | 'whatsapp' }>('GET', '/api/entregador/config/chat')
      .then(r => setMetodo(r.metodo))
      .catch(() => {});
  }, []);

  async function escolher(novo: 'app' | 'whatsapp') {
    setSalvando(true);
    try {
      await api('PUT', '/api/entregador/config/chat', { metodo: novo });
      setMetodo(novo);
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally {
      setSalvando(false);
    }
  }

  if (metodo === null) return null;

  return (
    <Card>
      <CardContent className="p-4 space-y-2.5">
        <div className="flex items-center gap-2 text-sm font-bold">
          <MessagesSquare className="size-4 text-primary" /> Como falar com o cliente
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={salvando} onClick={() => escolher('app')}
            className={cn('flex-1 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-colors',
              metodo === 'app' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
            Chat do app
          </button>
          <button type="button" disabled={salvando} onClick={() => escolher('whatsapp')}
            className={cn('flex-1 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-colors',
              metodo === 'whatsapp' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
            Meu WhatsApp
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          "Meu WhatsApp" abre uma conversa direto no seu número quando o cliente tocar em "Chat" — a plataforma não guarda essa conversa.
        </p>
      </CardContent>
    </Card>
  );
}

function LoginEntregador() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const { mostrar } = useToast();

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<{ token: string; usuario: any }>('POST', '/api/auth/login', { email, senha });
      if (r.usuario.perfil !== 'entregador') {
        mostrar({ tipo: 'erro', titulo: 'Esta conta não é de entregador.' });
        return;
      }
      salvarSessao(r.token, r.usuario);
      window.location.reload();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-dvh bg-gradient-to-br from-primary/5 via-background to-background flex flex-col items-center justify-center p-5">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex size-20 items-center justify-center rounded-3xl bg-primary text-primary-foreground shadow-xl shadow-primary/30 mx-auto">
            <Bike className="size-10" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Área do entregador</h1>
          <p className="text-sm text-muted-foreground">Entre para ver as corridas disponíveis.</p>
        </div>

        <Card>
          <CardContent className="p-6">
            <form onSubmit={entrar} className="space-y-3">
              <div>
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" required autoComplete="email"
                  value={email} onChange={e => setEmail(e.target.value)} className="h-12" />
              </div>
              <div>
                <Label htmlFor="senha">Senha</Label>
                <Input id="senha" type="password" required autoComplete="current-password"
                  value={senha} onChange={e => setSenha(e.target.value)} className="h-12" />
              </div>
              <Button type="submit" size="lg" className="w-full rounded-2xl mt-2" disabled={enviando}>
                {enviando ? 'Entrando…' : 'Entrar'}
              </Button>
              <Link to="/esqueci-senha" className="block text-center text-sm text-muted-foreground hover:text-primary">
                Esqueci minha senha
              </Link>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
