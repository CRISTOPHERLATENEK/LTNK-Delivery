import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Routes, Route, Link } from 'react-router-dom';
import { CheckCircle2, ChefHat, XCircle, Package, Bell, Save, Eye, History, Printer, Store, Lock } from 'lucide-react';
import { AppLayout, NavBadge } from '@/components/app-layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError, sessaoUsuario, salvarSessao } from '@/lib/api';
import { Portal2FA } from '@/components/duplo-fator';
import { usePedidosLojaAtivos } from '@/lib/pedidos-loja';
import { brl, dataLocal, tempoRelativo } from '@/lib/format';
import { useTema, foregroundContraste } from '@/lib/tema';
import { cn } from '@/lib/utils';
import { Home, Box, Settings, BarChart3, Users, Phone, Mail, Palette, Ticket, Clock, Bike, Image, ShoppingCart, UtensilsCrossed, LayoutGrid, Star, ChevronRight, Plus, Trash2, ExternalLink, CreditCard, FileText, Tag, MessageCircle, ShieldCheck } from 'lucide-react';
import { ImageUpload } from '@/components/ui/image-upload';
import {
  garantirPermissaoNotificacao, notificarNovoPedido,
  sincronizarLembrete, pararLembrete,
} from '@/lib/alerta-pedido';
import { suportaPush, ativarPush } from '@/lib/push';
import { despacharImpressao, imprimirComandasProducao } from '@/lib/impressao';
import type { BlocoImpressao } from '@/lib/agente';
import { ProdutosLoja } from './produtos';
import { LojaConfiguracao, HorarioLoja, ZonasEntrega, PagamentosLoja, ImpressaoLoja, EntregadoresLoja, SegurancaLoja } from './loja-config';
import { VisualLoja } from './visual';
import { FiscalLoja } from './fiscal';
import { CategoriasLoja } from './categorias';
import { RelatoriosLoja } from './relatorios';
import { WhatsAppLoja } from './whatsapp';
import { AvaliacoesLoja } from './avaliacoes';
import { MesasLoja } from './mesas';
import { BalcaoLoja } from './balcao';
import { DashboardLoja } from './dashboard';
import { CuponsLoja } from './cupons';
import { BannersLoja } from './banners';
import type { Pedido, ItemPedido } from '@/types';

type PedidoComItens = Pedido & { itens: ItemPedido[] };

export function PainelLojista() {
  // A sessão de "Entrar como lojista" (Admin) chega pronta no storage (ver
  // abrirSessaoLojistaImpersonada em lib/api.ts) — não há mais token na URL.
  const u = sessaoUsuario();
  const ehLojista = !!u && u.perfil === 'lojista';

  const pedidosQ = usePedidosLojaAtivos({ enabled: ehLojista });
  const pedidos = pedidosQ.data ?? [];
  const pendentes = pedidos.filter((p: PedidoComItens) => p.status === 'pendente').length;

  // Config da loja (largura da bobina, auto-impressão) para o auto-print.
  const lojaQ = useQuery({
    queryKey: ['minha-loja-cfg'],
    queryFn: () => api<{ loja: Record<string, unknown> }>('GET', '/api/lojista/loja').then(r => r.loja),
    enabled: ehLojista,
    staleTime: 60000,
  });
  const lojaRef = useRef<Record<string, unknown> | null>(null);
  lojaRef.current = lojaQ.data ?? null;

  // Aplica a cor da marca da loja em TODO o painel do lojista (não só na aba de
  // aparência) — senão, ao dar F5, o painel voltava pro vermelho padrão.
  // Depende também de `marca`: o tema da PLATAFORMA (/api/tema, root do app)
  // carrega em paralelo com esta config da loja — se resolver depois, ele
  // sobrescreve --primary pro padrão. Incluir `marca` reaplica a cor da loja
  // assim que isso acontece (mesma corrida existe na página pública da loja).
  const { aplicarCorPrimaria, marca } = useTema();
  useEffect(() => {
    const cor = lojaQ.data?.cor_marca as string | undefined;
    const corSecundaria = lojaQ.data?.cor_secundaria as string | undefined;
    if (cor) aplicarCorPrimaria(cor, corSecundaria);
  }, [lojaQ.data, aplicarCorPrimaria, marca]);

  const ultimoMaiorId = useRef(0);
  const primeiraCarga = useRef(true);
  const pendentesRef = useRef(0);
  pendentesRef.current = pendentes;

  useEffect(() => {
    if (!ehLojista) return;
    garantirPermissaoNotificacao();
    // Web Push: novos pedidos chegam mesmo com o painel fechado/celular no bolso.
    if (suportaPush()) ativarPush().catch(() => { /* best-effort */ });
    sincronizarLembrete(() => pendentesRef.current > 0);
    return () => pararLembrete();
  }, [ehLojista]);

  useEffect(() => {
    if (!pedidosQ.data) return;
    const maior = pedidosQ.data.reduce((m: number, p: PedidoComItens) => Math.max(m, p.id), 0);
    if (!primeiraCarga.current && maior > ultimoMaiorId.current) {
      const novo = pedidosQ.data.find((p: PedidoComItens) => p.id === maior);
      notificarNovoPedido(
        '🔔 Novo pedido recebido!',
        novo ? `#${novo.id} · ${novo.cliente_nome} · ${brl(novo.total_centavos)}` : 'Você tem um novo pedido.',
      );
      // Auto-impressão do pedido novo (se ligada na config de Impressão).
      const loja = lojaRef.current;
      const autoOn = loja ? (loja.impressora_auto === undefined ? true : !!loja.impressora_auto) : false;
      if (novo && autoOn) {
        imprimirPedidoPainel(novo, {
          largura: loja!.impressora_largura === '58' ? '58' : '80',
          loja_nome: String(loja!.nome || ''),
        });
      }
    }
    ultimoMaiorId.current = Math.max(ultimoMaiorId.current, maior);
    primeiraCarga.current = false;
  }, [pedidosQ.data]);

  const itensNav = [
    { rota: '/lojista', icone: Home, rotulo: 'Início', fim: true },
    {
      rota: '/lojista/pedidos', icone: Bell, rotulo: 'Pedidos',
      badge: pendentes > 0 ? <NavBadge valor={pendentes} /> : undefined,
    },
    { rota: '/lojista/vendas', icone: ShoppingCart, rotulo: 'Vendas' },
    { rota: '/lojista/produtos', icone: Box, rotulo: 'Produtos' },
    { rota: '/lojista/mais', icone: LayoutGrid, rotulo: 'Mais' },
  ];

  if (!ehLojista) {
    return <LoginLojista />;
  }

  return (
    <AppLayout itens={itensNav} titulo="Painel do lojista">
      <Routes>
        <Route index element={<DashboardLoja />} />
        <Route path="pedidos" element={<PedidosLoja />} />
        <Route path="vendas" element={<VendasLoja />} />
        <Route path="balcao" element={<BalcaoLoja />} />
        <Route path="mesas" element={<MesasLoja />} />
        <Route path="produtos" element={<ProdutosLoja />} />
        <Route path="mais" element={<MenuMais />} />
        <Route path="cupons" element={<CuponsLoja />} />
        <Route path="personalizacao" element={<VisualLoja />} />
        <Route path="loja" element={<LojaConfiguracao />} />
        <Route path="config" element={<ConfiguracoesLoja />} />
        <Route path="relatorios" element={<RelatoriosLoja />} />
        <Route path="avaliacoes" element={<AvaliacoesLoja />} />
        <Route path="clientes" element={<ClientesLoja />} />
        <Route path="cozinha-equipe" element={<GerenciarCozinha />} />
        <Route path="categorias" element={<CategoriasLoja />} />
        <Route path="*" element={<DashboardLoja />} />
      </Routes>
    </AppLayout>
  );
}

/* ── Config da loja: só configuração de verdade.
   Cupons, Clientes e Avaliações agora vivem na aba "Mais" (operação). ── */
function ConfiguracoesLoja() {
  const [aba, setAba] = useState<'loja' | 'horario' | 'entrega' | 'entregadores' | 'visual' | 'banners' | 'pagamentos' | 'impressao' | 'fiscal' | 'whatsapp' | 'seguranca'>('loja');

  const ABAS = [
    { id: 'loja' as const, label: 'Dados', icone: Settings },
    { id: 'horario' as const, label: 'Horário', icone: Clock },
    { id: 'entrega' as const, label: 'Entrega', icone: Bike },
    { id: 'entregadores' as const, label: 'Entregadores', icone: Users },
    { id: 'pagamentos' as const, label: 'Pix', icone: CreditCard },
    { id: 'whatsapp' as const, label: 'WhatsApp', icone: MessageCircle },
    { id: 'fiscal' as const, label: 'Fiscal', icone: FileText },
    { id: 'impressao' as const, label: 'Impressão', icone: Printer },
    { id: 'visual' as const, label: 'Visual', icone: Palette },
    { id: 'banners' as const, label: 'Banners', icone: Image },
    { id: 'seguranca' as const, label: 'Segurança', icone: ShieldCheck },
  ];

  return (
    <div className="space-y-4">
      {/* Seletor de aba estilo pill — rola na horizontal no mobile */}
      <div className="flex gap-1 rounded-xl bg-muted p-1 overflow-x-auto scrollbar-hide">
        {ABAS.map(a => {
          const Icone = a.icone;
          return (
            <button
              key={a.id}
              onClick={() => setAba(a.id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all whitespace-nowrap',
                aba === a.id
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icone className="size-3.5 shrink-0" />
              {a.label}
            </button>
          );
        })}
      </div>

      {aba === 'loja' && <LojaConfiguracao />}
      {aba === 'horario' && <HorarioLoja />}
      {aba === 'entrega' && <ZonasEntrega />}
      {aba === 'entregadores' && <EntregadoresLoja />}
      {aba === 'pagamentos' && <PagamentosLoja />}
      {aba === 'whatsapp' && <WhatsAppLoja />}
      {aba === 'fiscal' && <FiscalLoja />}
      {aba === 'impressao' && <ImpressaoLoja />}
      {aba === 'visual' && <VisualLoja />}
      {aba === 'banners' && <BannersLoja />}
      {aba === 'seguranca' && <SegurancaLoja />}
    </div>
  );
}

/* ── Vendas: hub que junta PDV (balcão) e Mesas (salão) numa aba só ── */
function VendasLoja() {
  const [aba, setAba] = useState<'pdv' | 'mesas' | 'delivery'>('pdv');
  const ABAS = [
    { id: 'pdv' as const, label: 'PDV Balcão', icone: ShoppingCart },
    { id: 'mesas' as const, label: 'Mesas', icone: UtensilsCrossed },
    { id: 'delivery' as const, label: 'Delivery', icone: FileText },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        {ABAS.map(a => {
          const Icone = a.icone;
          return (
            <button
              key={a.id}
              onClick={() => setAba(a.id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-all',
                aba === a.id ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icone className="size-4 shrink-0" />
              {a.label}
            </button>
          );
        })}
      </div>

      {aba === 'pdv' ? <BalcaoLoja /> : aba === 'mesas' ? <MesasLoja /> : <NfceDeliveryLoja />}
    </div>
  );
}

/** Janela das vendas de DELIVERY (entregues) para emitir/reemitir a NFC-e de cada uma. */
type PedidoDeliveryNfce = {
  id: number; cliente_nome: string; total_centavos: number; forma_pagamento: string; criado_em: string;
  nota_id: number | null; nota_status: string | null; nota_numero: number | null;
  nota_cstat: string | null; nota_motivo: string | null;
};

function NfceDeliveryLoja() {
  const { mostrar } = useToast();
  const consulta = useQuery({
    queryKey: ['nfce-pedidos-delivery'],
    queryFn: () => api<{ pedidos: PedidoDeliveryNfce[] }>('GET', '/api/lojista/nfce/pedidos-delivery').then(r => r.pedidos),
    refetchInterval: 20000,
  });
  const [emitindo, setEmitindo] = useState<number | null>(null);
  const pedidos = consulta.data ?? [];

  async function emitir(id: number) {
    setEmitindo(id);
    try {
      const r = await api<{ autorizada: boolean; numero: number; protocolo: string }>('POST', `/api/lojista/nfce/emitir/${id}`);
      mostrar({ tipo: 'sucesso', titulo: `NFC-e nº ${r.numero} autorizada`, descricao: `Protocolo ${r.protocolo}` });
      consulta.refetch();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: 'NFC-e: ' + e.message });
      consulta.refetch(); // atualiza status (pode ter ficado rejeitada)
    } finally { setEmitindo(null); }
  }

  const BADGE: Record<string, string> = {
    autorizada: 'bg-green-500/15 text-green-600',
    rejeitada: 'bg-red-500/15 text-red-600',
    erro: 'bg-amber-500/15 text-amber-600',
    cancelada: 'bg-muted text-muted-foreground line-through',
  };

  if (consulta.isLoading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Vendas de delivery entregues. Emita a NFC-e de cada uma (a entrega já emite automático; aqui você reemite se precisar).
      </p>
      {pedidos.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Nenhuma venda de delivery entregue ainda.</CardContent></Card>
      ) : pedidos.map(p => {
        const autorizada = p.nota_status === 'autorizada';
        return (
          <Card key={p.id}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">#{p.id}</span>
                  <span className="text-sm truncate">{p.cliente_nome}</span>
                  {p.nota_status && (
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', BADGE[p.nota_status] ?? 'bg-muted text-muted-foreground')}>
                      {p.nota_status === 'autorizada' ? `NF nº${p.nota_numero}` : p.nota_status}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{dataLocal(p.criado_em)}</div>
                {(p.nota_status === 'rejeitada' || p.nota_status === 'erro') && p.nota_motivo && (
                  <div className="text-[11px] text-red-600 line-clamp-1 mt-0.5">{p.nota_cstat} — {p.nota_motivo}</div>
                )}
              </div>
              <span className="text-sm font-bold tabular-nums shrink-0">{brl(p.total_centavos)}</span>
              <Button
                size="sm"
                variant={autorizada ? 'outline' : 'default'}
                onClick={() => emitir(p.id)}
                disabled={emitindo === p.id || autorizada}
                className="shrink-0"
              >
                <FileText className="size-3.5" />
                {autorizada ? 'Emitida' : emitindo === p.id ? 'Emitindo…' : 'Emitir NFC-e'}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ── "Mais": tudo que não cabe na nav principal, agrupado por intenção ── */
function MenuMais() {
  const grupos = [
    {
      titulo: 'Operação',
      itens: [
        { rota: '/lojista/cupons', icone: Ticket, rotulo: 'Cupons', desc: 'Descontos e promoções' },
        { rota: '/lojista/categorias', icone: Tag, rotulo: 'Categorias', desc: 'Ícone, ordem e estilo na vitrine' },
        { rota: '/lojista/clientes', icone: Users, rotulo: 'Clientes', desc: 'Quem já comprou de você' },
        { rota: '/lojista/avaliacoes', icone: Star, rotulo: 'Avaliações', desc: 'Notas e respostas dos clientes' },
        { rota: '/lojista/cozinha-equipe', icone: ChefHat, rotulo: 'Cozinha (KDS)', desc: 'Logins do painel de cozinha' },
      ],
    },
    {
      titulo: 'Análise',
      itens: [
        { rota: '/lojista/relatorios', icone: BarChart3, rotulo: 'Relatórios', desc: 'Faturamento e desempenho' },
      ],
    },
    {
      titulo: 'Configuração',
      itens: [
        { rota: '/lojista/config', icone: Settings, rotulo: 'Configurações da loja', desc: 'Dados, horário, entrega, visual e banners' },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      {grupos.map(g => (
        <div key={g.titulo}>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 px-1">{g.titulo}</h3>
          <Card>
            <CardContent className="p-0 divide-y divide-border">
              {g.itens.map(it => {
                const Icone = it.icone;
                return (
                  <Link
                    key={it.rota}
                    to={it.rota}
                    className="flex items-center gap-3 p-4 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                      <Icone className="size-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold leading-tight">{it.rotulo}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{it.desc}</div>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}

/* ── Gestão das contas de cozinha (logins do KDS) ── */
interface ContaCozinha {
  id: number;
  nome: string;
  email: string;
  bloqueado: 0 | 1;
  criado_em: string;
}

function GerenciarCozinha() {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState({ nome: '', email: '', senha: '' });
  const [enviando, setEnviando] = useState(false);

  const contasQ = useQuery({
    queryKey: ['lojista-cozinha-contas'],
    queryFn: () => api<{ contas: ContaCozinha[] }>('GET', '/api/lojista/cozinha-contas').then(r => r.contas),
  });
  const contas = contasQ.data ?? [];
  const urlCozinha = `${window.location.origin}/cozinha`;

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('POST', '/api/lojista/cozinha-contas', form);
      mostrar({ tipo: 'sucesso', titulo: `Conta "${form.nome}" criada!` });
      setForm({ nome: '', email: '', senha: '' });
      setCriando(false);
      contasQ.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  async function excluir(c: ContaCozinha) {
    if (!(await confirmar({ titulo: `Excluir o acesso de "${c.nome}"?`, confirmar: 'Excluir', destrutivo: true }))) return;
    try {
      await api('DELETE', `/api/lojista/cozinha-contas/${c.id}`);
      mostrar({ tipo: 'sucesso', titulo: 'Acesso removido.' });
      contasQ.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <ChefHat className="size-6" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold">Cozinha (KDS)</h1>
          <p className="text-sm text-muted-foreground">Logins do painel de cozinha da sua loja.</p>
        </div>
      </div>

      {/* Onde a cozinha entra */}
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Endereço de acesso</div>
            <div className="font-mono text-sm truncate">{urlCozinha}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Abra esse endereço no tablet da cozinha e entre com um dos acessos abaixo.
            </p>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => window.open('/cozinha', '_blank')}>
            <ExternalLink className="size-4" /> Abrir
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCriando(c => !c)}>
          <Plus className="size-4" /> Novo acesso
        </Button>
      </div>

      {criando && (
        <Card className="border-primary/30">
          <CardContent className="p-4">
            <form onSubmit={criar} className="space-y-3">
              <div>
                <Label>Nome (ex.: Cozinha, Chapa, Forno)</Label>
                <Input required value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} placeholder="Cozinha" />
              </div>
              <div>
                <Label>E-mail de acesso</Label>
                <Input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="cozinha@sualoja.com" />
              </div>
              <div>
                <Label>Senha (mínimo 6 caracteres)</Label>
                <Input required type="text" value={form.senha} onChange={e => setForm(f => ({ ...f, senha: e.target.value }))} placeholder="••••••" />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={enviando}>{enviando ? 'Criando…' : 'Criar acesso'}</Button>
                <Button type="button" variant="ghost" onClick={() => setCriando(false)}>Cancelar</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {contasQ.isLoading && (
        <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-16" />)}</div>
      )}

      {!contasQ.isLoading && contas.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground space-y-2">
            <ChefHat className="size-10 mx-auto opacity-30" />
            <p>Nenhum acesso de cozinha ainda.</p>
            <p className="text-sm">Crie um para o tablet da cozinha.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {contas.map(c => (
          <Card key={c.id}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold shrink-0">
                {(c.nome || '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold leading-tight">{c.nome}</div>
                <div className="text-xs text-muted-foreground truncate">{c.email}</div>
              </div>
              <button
                onClick={() => excluir(c)}
                className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0"
                title="Excluir acesso"
              >
                <Trash2 className="size-4" />
              </button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}


const STATUS_ATIVOS = ['pendente', 'aceito', 'preparando', 'pronto', 'em_entrega'];

function imprimirPedidoPainel(p: PedidoComItens, config?: { largura?: '80' | '58'; loja_nome?: string }) {
  const largura = config?.largura === '58' ? '58' : '80';
  const larguraMm = largura === '58' ? 58 : 80;
  const areaMm = larguraMm - 4;
  const fonte = largura === '58' ? 11 : 12.5;
  const escapar = (s: string) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
  const fmt = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
  const pagto =
    p.forma_pagamento === 'pix' ? 'Pix'
    : p.forma_pagamento === 'dinheiro' ? `Dinheiro${p.troco_para_centavos ? ` / troco ${fmt(p.troco_para_centavos)}` : ''}`
    : 'Cartão na entrega';
  const itensHtml = (p.itens || []).map(i => {
    const obs = (i as { opcoes_texto?: string }).opcoes_texto;
    return `<div class="row"><span class="nome">${i.quantidade}× ${escapar(i.nome_produto)}</span><span class="val">${fmt(i.preco_unit_centavos * i.quantidade)}</span></div>`
      + (obs ? `<div class="obs">${escapar(obs)}</div>` : '');
  }).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pedido #${p.id}</title>
<style>
  @page { size: ${larguraMm}mm auto; margin: 2mm; }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Courier New',monospace;font-size:${fonte}px;width:${areaMm}mm;color:#000}
  .center{text-align:center}
  .loja{font-weight:bold;font-size:${fonte + 2}px}
  h1{font-size:${fonte + 2}px;font-weight:bold;text-align:center;margin:4px 0}
  .row{display:flex;gap:4px;justify-content:space-between;margin-bottom:2px}
  .row .nome{flex:1 1 auto;word-break:break-word}
  .row .val{flex:0 0 auto;text-align:right;white-space:nowrap}
  .obs{font-size:${fonte - 2}px;padding-left:12px}
  .sep{border-top:1px dashed #000;margin:5px 0}
  .total{font-weight:bold;font-size:${fonte + 3}px}
  .end{margin-top:4px}
  .note{border:1px solid #000;padding:4px;margin-top:6px}
</style></head><body>
${config?.loja_nome ? `<div class="center loja">${escapar(config.loja_nome)}</div>` : ''}
<h1>PEDIDO #${p.id}</h1>
<div class="row"><span>Cliente</span><span>${escapar(p.cliente_nome || '')}</span></div>
<div class="row"><span>Pagamento</span><span>${escapar(pagto)}</span></div>
<div class="row"><span>Data</span><span>${dataLocal(p.criado_em)}</span></div>
<div class="sep"></div>
${itensHtml}
<div class="sep"></div>
<div class="row total"><span>TOTAL</span><span>${fmt(p.total_centavos)}</span></div>
${p.endereco_entrega ? `<div class="sep"></div><div class="end">📍 ${escapar(p.endereco_entrega)}</div>` : ''}
${p.observacoes ? `<div class="note">📝 ${escapar(p.observacoes)}</div>` : ''}
</body></html>`;
  // Blocos ESC/POS pro nosso agente (com fallback pro HTML no diálogo/QZ).
  const blocos: BlocoImpressao[] = [
    ...(config?.loja_nome ? [{ t: 'center' as const, b: true, txt: config.loja_nome }] : []),
    { t: 'titulo', txt: `PEDIDO #${p.id}` },
    { t: 'lr', l: 'Cliente', r: p.cliente_nome || '' },
    { t: 'lr', l: 'Pagamento', r: pagto },
    { t: 'lr', l: 'Data', r: dataLocal(p.criado_em) },
    { t: 'linha' },
    ...(p.itens || []).flatMap(i => {
      const obs = (i as { opcoes_texto?: string }).opcoes_texto;
      const arr: BlocoImpressao[] = [{ t: 'lr', l: `${i.quantidade}x ${i.nome_produto}`, r: fmt(i.preco_unit_centavos * i.quantidade) }];
      if (obs) arr.push({ t: 'texto', txt: '  ' + obs });
      return arr;
    }),
    { t: 'linha' },
    { t: 'lr', b: true, l: 'TOTAL', r: fmt(p.total_centavos) },
    ...(p.endereco_entrega ? [{ t: 'texto' as const, txt: 'End: ' + p.endereco_entrega }] : []),
    ...(p.observacoes ? [{ t: 'texto' as const, txt: 'Obs: ' + p.observacoes }] : []),
    { t: 'corte' },
  ];
  despacharImpressao(html, larguraMm, blocos);

  // Roteamento por setor (Cozinha/Bar): pedidos vindos do app do cliente
  // agora também disparam a via de produção separada, igual balcão/mesa —
  // best-effort, só age se houver setor+impressora configurados neste PC.
  imprimirComandasProducao({
    titulo: `PEDIDO #${p.id}`,
    linhas: (p.itens || []).map(i => ({
      qtd: String(i.quantidade),
      nome: i.nome_produto,
      valor: fmt(i.preco_unit_centavos * i.quantidade),
      observacao: (i as { opcoes_texto?: string }).opcoes_texto,
      categoria: (i as { categoria?: string }).categoria || undefined,
    })),
    totais: [],
    tipoVenda: 'Delivery', referencia: `#${p.id}`,
    cliente: p.cliente_nome,
  }, { largura, auto: true, loja_nome: config?.loja_nome || '', rodape: '' });
}

function PedidosLoja() {
  const [aba, setAba] = useState<'ativos' | 'historico'>('ativos');

  const ativos_q = usePedidosLojaAtivos();

  const historico_q = useQuery({
    queryKey: ['pedidos-loja-historico'],
    queryFn: () => api<{ pedidos: PedidoComItens[] }>('GET', '/api/lojista/pedidos-historico').then(r => r.pedidos),
    enabled: aba === 'historico',
    refetchInterval: aba === 'historico' ? 15000 : false,
  });

  const pedidosAtivos = ativos_q.data?.filter(p => STATUS_ATIVOS.includes(p.status)) ?? [];
  const pendentes = pedidosAtivos.filter(p => p.status === 'pendente').length;

  return (
    <div className="space-y-4">
      {/* Abas */}
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        <button
          onClick={() => setAba('ativos')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-all',
            aba === 'ativos' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground',
          )}
        >
          <Bell className="size-4" />
          Em andamento
          {pendentes > 0 && (
            <span className="flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
              {pendentes}
            </span>
          )}
        </button>
        <button
          onClick={() => setAba('historico')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-all',
            aba === 'historico' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground',
          )}
        >
          <History className="size-4" />
          Histórico
        </button>
      </div>

      {/* ABA: Ativos */}
      {aba === 'ativos' && (
        <>
          {ativos_q.isLoading && (
            <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-32" />)}</div>
          )}
          {pedidosAtivos.length === 0 && !ativos_q.isLoading && (
            <Card>
              <CardContent className="p-10 text-center text-muted-foreground space-y-2">
                <Bell className="size-10 mx-auto opacity-20" />
                <p className="font-medium">Nenhum pedido em andamento</p>
                <p className="text-sm">Os pedidos aparecem aqui em tempo real.</p>
              </CardContent>
            </Card>
          )}
          <div className="space-y-3">
            {pedidosAtivos.map(p => (
              <CardPedidoLojista key={p.id} pedido={p} aoAtualizar={() => ativos_q.refetch()} />
            ))}
          </div>
        </>
      )}

      {/* ABA: Histórico */}
      {aba === 'historico' && (
        <>
          {historico_q.isLoading && (
            <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16" />)}</div>
          )}
          {(historico_q.data ?? []).length === 0 && !historico_q.isLoading && (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                Nenhum pedido no histórico ainda.
              </CardContent>
            </Card>
          )}
          <div className="space-y-2">
            {(historico_q.data ?? []).map(p => (
              <CardHistoricoPedido key={p.id} pedido={p} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CardHistoricoPedido({ pedido }: { pedido: PedidoComItens }) {
  const { mostrar } = useToast();
  const [expandido, setExpandido] = useState(false);
  const [emitindo, setEmitindo] = useState(false);
  const [notaFeita, setNotaFeita] = useState(false);
  const STATUS_COR: Record<string, string> = {
    entregue: 'success', cancelado: 'danger', recusado: 'danger',
    pendente: 'warning', aceito: 'info', preparando: 'info', pronto: 'info', em_entrega: 'info',
  };

  async function emitirNfce() {
    setEmitindo(true);
    try {
      const r = await api<{ autorizada: boolean; protocolo: string; motivo: string; numero: number }>(
        'POST', `/api/lojista/nfce/emitir/${pedido.id}`
      );
      if (r.autorizada) {
        setNotaFeita(true);
        mostrar({ tipo: 'sucesso', titulo: `NFC-e nº ${r.numero} autorizada`, descricao: `Protocolo ${r.protocolo}` });
      } else {
        mostrar({ tipo: 'erro', titulo: 'A SEFAZ recusou a NFC-e', descricao: r.motivo });
      }
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally { setEmitindo(false); }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <button className="w-full flex items-center gap-3 text-left" onClick={() => setExpandido(e => !e)}>
          <span className="font-mono text-xs text-muted-foreground">#{pedido.id}</span>
          <Badge variant={(STATUS_COR[pedido.status] as any) ?? 'secondary'}>{pedido.status}</Badge>
          <span className="flex-1 text-sm font-semibold truncate">{pedido.cliente_nome}</span>
          <span className="tabular-nums font-bold text-sm shrink-0">{brl(pedido.total_centavos)}</span>
          <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">{dataLocal(pedido.criado_em)}</span>
        </button>
        {expandido && (
          <div className="mt-3 pt-3 border-t space-y-1 text-sm">
            {pedido.itens?.map((i, idx) => (
              <div key={idx} className="flex justify-between gap-2 text-muted-foreground">
                <span>{i.quantidade}× {i.nome_produto}</span>
                <span className="tabular-nums">{brl(i.preco_unit_centavos * i.quantidade)}</span>
              </div>
            ))}
            <div className="text-xs pt-2 text-muted-foreground">📍 {pedido.endereco_entrega}</div>
            <div className="text-xs text-muted-foreground">{dataLocal(pedido.criado_em)}</div>
            {pedido.status === 'entregue' && (
              <div className="pt-2">
                <Button size="sm" variant="outline" onClick={emitirNfce} disabled={emitindo || notaFeita}>
                  <FileText className="size-3.5" />
                  {notaFeita ? 'NFC-e emitida' : emitindo ? 'Emitindo…' : 'Emitir NFC-e'}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CardPedidoLojista({ pedido, aoAtualizar }: { pedido: PedidoComItens; aoAtualizar: () => void }) {
  const { mostrar } = useToast();
  const [recusando, setRecusando] = useState(false);
  const [motivoRecusa, setMotivoRecusa] = useState('');
  const [carregando, setCarregando] = useState(false);

  const isPendente = pedido.status === 'pendente';

  async function acao(tipo: 'aceitar' | 'recusar' | 'preparar' | 'pronto', motivo?: string) {
    setCarregando(true);
    try {
      await api('POST', `/api/lojista/pedidos/${pedido.id}/acao`, { acao: tipo, motivo });
      setRecusando(false);
      setMotivoRecusa('');
      aoAtualizar();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally {
      setCarregando(false);
    }
  }

  const botoes = () => {
    switch (pedido.status) {
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
              <CheckCircle2 className="size-4" /> Aceitar
            </Button>
            <Button variant="destructive" size="sm" disabled={carregando} onClick={() => setRecusando(true)}>
              <XCircle className="size-4" /> Recusar
            </Button>
          </>
        );
      case 'aceito':
        return (
          <Button size="sm" disabled={carregando} onClick={() => acao('preparar')}>
            <ChefHat className="size-4" /> Iniciar preparo
          </Button>
        );
      case 'preparando':
        return (
          <Button variant="success" size="sm" disabled={carregando} onClick={() => acao('pronto')}>
            <Package className="size-4" /> Marcar como pronto
          </Button>
        );
      case 'pronto':
        return <Badge variant="info">Aguardando entregador</Badge>;
      case 'em_entrega':
        return <Badge variant="info">Saiu para entrega 🛵</Badge>;
      default:
        return null;
    }
  };

  return (
    <Card className={cn(
      isPendente && 'border-amber-500/70 bg-amber-500/5 shadow-sm shadow-amber-500/20',
    )}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold">#{pedido.id} · {pedido.cliente_nome}</span>
              {isPendente && (
                <span className="animate-pulse rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  NOVO
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {tempoRelativo(pedido.criado_em)} · {dataLocal(pedido.criado_em)}
              {' · '}
              {pedido.forma_pagamento === 'pix' && 'Pix'}
              {pedido.forma_pagamento === 'dinheiro' && 'Dinheiro'}
              {pedido.forma_pagamento === 'cartao_entrega' && 'Cartão na entrega'}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => imprimirPedidoPainel(pedido)}
              className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"
              title="Imprimir"
            >
              <Printer className="size-4" />
            </button>
            <StatusBadge status={pedido.status} />
          </div>
        </div>

        <div className="mt-3 text-sm space-y-1">
          {pedido.itens.map((i, idx) => (
            <div key={idx} className="flex justify-between gap-2">
              <span className="flex-1">
                <span className="text-muted-foreground tabular-nums mr-1">{i.quantidade}×</span>
                {i.nome_produto}
                {i.opcoes_texto && (
                  <span className="block text-xs text-muted-foreground pl-5">{i.opcoes_texto}</span>
                )}
              </span>
              <span className="tabular-nums font-medium">{brl(i.preco_unit_centavos * i.quantidade)}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between border-t pt-3 font-bold">
          <span>Total</span>
          <span className="tabular-nums">{brl(pedido.total_centavos)}</span>
        </div>

        {pedido.endereco_entrega && (
          <div className="mt-2 text-xs text-muted-foreground">📍 {pedido.endereco_entrega}</div>
        )}
        {pedido.observacoes && (
          <div className="mt-2 rounded-lg bg-blue-500/10 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
            📝 {pedido.observacoes}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">{botoes()}</div>
      </CardContent>
    </Card>
  );
}

function LoginLojista() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [duploFator, setDuploFator] = useState<{ tokenPreAuth: string; modo: 'configurar' | 'verificar' } | null>(null);
  const { mostrar } = useToast();

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<{ token: string; usuario: any } | { precisa2fa: true; modo2fa: 'configurar' | 'verificar'; tokenPreAuth: string }>(
        'POST', '/api/auth/login', { email, senha }
      );
      if ('precisa2fa' in r) {
        setDuploFator({ tokenPreAuth: r.tokenPreAuth, modo: r.modo2fa });
        return;
      }
      if (r.usuario.perfil !== 'lojista') {
        mostrar({ tipo: 'erro', titulo: 'Esta conta não é de lojista.' });
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

  if (duploFator) {
    return (
      <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-10">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-accent/30" />
        <div className="relative">
          <Portal2FA
            tokenPreAuth={duploFator.tokenPreAuth}
            modo={duploFator.modo}
            onCancelar={() => setDuploFator(null)}
            onSucesso={(token, usuario) => { salvarSessao(token, usuario); window.location.reload(); }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-accent/30" />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/30">
            <Store className="size-8 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <h1 className="text-2xl font-extrabold">Painel do lojista</h1>
          <p className="mt-1 text-sm text-muted-foreground">Entre com sua conta para gerenciar a loja.</p>
        </div>

        <Card className="border-border/60 shadow-xl shadow-black/5">
          <CardContent className="p-6">
            <form onSubmit={enviar} className="space-y-4">
              <div>
                <Label htmlFor="email-lojista">E-mail</Label>
                <div className="relative mt-1.5">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email-lojista"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="seu@email.com"
                    className="pl-9"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="senha-lojista">Senha</Label>
                <div className="relative mt-1.5">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="senha-lojista"
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="pl-9"
                    value={senha}
                    onChange={e => setSenha(e.target.value)}
                  />
                </div>
              </div>
              <Button type="submit" size="lg" className="w-full shadow-lg shadow-primary/25" disabled={enviando}>
                {enviando ? 'Entrando…' : 'Entrar'}
              </Button>
              <Link to="/esqueci-senha" className="block text-center text-sm text-muted-foreground hover:text-primary">
                Esqueci minha senha
              </Link>
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Ainda não tem uma loja?{' '}
          <a href="mailto:suporte.cristopher@unimaxx.com.br" className="font-semibold text-primary hover:underline">
            Fale com a gente
          </a>
        </p>
      </div>
    </div>
  );
}

function ClientesLoja() {
  const consulta = useQuery({
    queryKey: ['lojista-clientes'],
    queryFn: () => api<{ clientes: any[]; total: number }>('GET', '/api/lojista/clientes'),
  });

  const clientes = consulta.data?.clientes ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Users className="size-5 text-primary" /> Clientes ({consulta.data?.total ?? 0})
        </h2>
      </div>

      {consulta.isLoading && (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}</div>
      )}

      {clientes.length === 0 && !consulta.isLoading && (
        <Card className="p-8 text-center text-muted-foreground">
          Nenhum cliente cadastrado ainda. 🌱
        </Card>
      )}

      <div className="space-y-3">
        {clientes.map((c: any) => (
          <Card key={c.id}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold shrink-0">
                {(c.nome || '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold leading-tight">{c.nome}</div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                  {c.email && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Mail className="size-3" /> {c.email}
                    </span>
                  )}
                  {c.telefone && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="size-3" /> {c.telefone}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-xs text-muted-foreground shrink-0">
                {new Date(c.criado_em).toLocaleDateString('pt-BR')}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

void CheckCircle2; void ChefHat; void Package;
