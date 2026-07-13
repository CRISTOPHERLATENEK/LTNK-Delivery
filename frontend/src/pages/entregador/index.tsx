/**
 * Painel do entregador — corridas disponíveis, entrega ativa e ganhos.
 * Gerencia seu próprio login (sem Guard externo), padrão igual ao lojista.
 */
import { useState, useEffect, useRef } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bike, MapPin, Phone, Store, CheckCircle2, ExternalLink,
  Activity, DollarSign, Home, TrendingUp, Clock, ArrowRight, Navigation, Bell, MessagesSquare,
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

interface PedidoAtivo extends Corrida {
  cliente_nome: string;
  cliente_telefone?: string | null;
  observacoes?: string;
}

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

function useCompartilharLocalizacao(pedidoId: number | undefined): EstadoGPS {
  const [estado, setEstado] = useState<EstadoGPS>('inativo');
  const ultimoEnvio = useRef(0);

  useEffect(() => {
    if (!pedidoId) { setEstado('inativo'); return; }
    if (!('geolocation' in navigator)) { setEstado('indisponivel'); return; }

    setEstado('aguardando');
    const watchId = navigator.geolocation.watchPosition(
      pos => {
        const agora = Date.now();
        // Throttle: no máximo 1 envio a cada 8 segundos.
        if (agora - ultimoEnvio.current < 8000) return;
        ultimoEnvio.current = agora;
        setEstado('ativo');
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

  return estado;
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

  const estadoGPS = useCompartilharLocalizacao(consulta.data?.id);
  const [avisando, setAvisando] = useState(false);
  const [avisou, setAvisou] = useState(false);
  const [chatAberto, setChatAberto] = useState(false);

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

  if (consulta.isLoading) return <Skeleton className="h-64 rounded-2xl" />;

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-bold text-base">
          <Activity className="size-5 text-primary animate-pulse" />
          Entrega ativa
        </h2>
        <Badge variant="info">#{String(p.id).padStart(4, '0')}</Badge>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="text-center py-3 rounded-2xl bg-success/10 border border-success/20">
            <div className="text-xs text-muted-foreground font-medium">Seu frete</div>
            <div className="text-3xl font-extrabold text-success tabular-nums mt-0.5">
              {brl(p.taxa_entrega_centavos)}
            </div>
          </div>

          {/* Status do rastreamento GPS */}
          <div className={cn(
            'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm',
            estadoGPS === 'ativo' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
            estadoGPS === 'aguardando' && 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
            (estadoGPS === 'negado' || estadoGPS === 'indisponivel') && 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
          )}>
            <Navigation className={cn('size-4 shrink-0', estadoGPS === 'ativo' && 'animate-pulse')} />
            <span className="flex-1">
              {estadoGPS === 'ativo' && 'Localização sendo compartilhada com o cliente em tempo real.'}
              {estadoGPS === 'aguardando' && 'Obtendo sua localização…'}
              {estadoGPS === 'negado' && 'Permissão de localização negada. O cliente não verá você no mapa.'}
              {estadoGPS === 'indisponivel' && 'GPS indisponível neste dispositivo.'}
              {estadoGPS === 'inativo' && 'Rastreamento inativo.'}
            </span>
          </div>

          <div className="rounded-xl bg-amber-500/10 p-4 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              <Store className="size-3.5" /> Ponto 1 — Retirada
            </div>
            <div className="font-bold">{p.loja_nome}</div>
            {p.loja_endereco && (
              <>
                <div className="text-sm text-muted-foreground">{p.loja_endereco}</div>
                <a href={mapa(p.loja_endereco)} target="_blank" rel="noopener noreferrer"
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
            <div className="flex items-center gap-3">
              {p.cliente_telefone && (
                <a href={`tel:${p.cliente_telefone}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                  <Phone className="size-3.5" /> {p.cliente_telefone}
                </a>
              )}
              <button
                type="button"
                onClick={() => setChatAberto(true)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
              >
                <MessagesSquare className="size-3.5" /> Chat
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

          <div className="border-t pt-3 space-y-2 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Total do pedido</span>
              <span className="tabular-nums font-semibold text-foreground">{brl(p.total_centavos)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Pagamento</span>
              <span className="font-semibold text-foreground">
                {p.forma_pagamento === 'pix' && '🔑 Pix'}
                {p.forma_pagamento === 'dinheiro' && '💵 Dinheiro'}
                {p.forma_pagamento === 'cartao_entrega' && '💳 Cartão'}
              </span>
            </div>
            {p.troco_para_centavos && (
              <div className="flex justify-between text-muted-foreground">
                <span>Troco para</span>
                <span className="tabular-nums font-semibold text-foreground">{brl(p.troco_para_centavos)}</span>
              </div>
            )}
          </div>

          <Button
            variant={avisou ? 'outline' : 'default'}
            size="lg"
            className="w-full rounded-2xl"
            onClick={() => avisarChegada(p.id)}
            disabled={avisando || avisou}
          >
            <Bell className="size-4" />
            {avisou ? 'Cliente já avisado ✓' : avisando ? 'Avisando…' : 'Avisar que estou chegando'}
          </Button>

          <Button variant="success" size="xl" className="w-full rounded-2xl h-14 text-base font-bold" onClick={() => confirmar(p.id)}>
            <CheckCircle2 className="size-5" /> Confirmar entrega realizada
          </Button>
        </CardContent>
      </Card>

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
