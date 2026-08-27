import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { detalheItem, linhasDoItem } from '@/lib/item-pedido';
import { lerRepasse2FA, destinoRepasse2FA } from '../../lib/repasse-2fa';
import { useQuery } from '@tanstack/react-query';
import { Routes, Route, Link } from 'react-router-dom';
import {
  CheckCircle2, ChefHat, XCircle, Package, Bell, Save, Eye, EyeOff, History,
  Printer, Store, Banknote, HelpCircle } from 'lucide-react';
import { AppLayout, NavBadge } from '@/components/app-layout';
import { Card, CardContent } from '@/components/ui/card';
import { ContaDeOutroPerfil } from '@/components/conta-outro-perfil';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Falha } from '@/components/ui/estado';
import { CaixaLoja } from './caixa';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError, sessaoUsuario, salvarSessao, abrirSessaoLojistaImpersonada, lerRepasseImpersonacao, desviouParaRevendedor } from '@/lib/api';
import { Portal2FA } from '@/components/duplo-fator';
import { usePedidosLojaAtivos } from '@/lib/pedidos-loja';
import { brl, dataLocal } from '@/lib/format';
import { useTema, foregroundContraste } from '@/lib/tema';
import { cn } from '@/lib/utils';
import { ErroLogin } from '@/components/ui/tela-login';
import { urgenciaPedido } from '@/lib/urgencia-pedido';
import { alturaLogo } from '@/lib/logo-escala';
import { Home, Box, Settings, BarChart3, Users, Phone, Mail, Palette, Ticket, Clock, Bike, Image, ShoppingCart, UtensilsCrossed, LayoutGrid, Star, ChevronRight, Plus, Trash2, ExternalLink, CreditCard, FileText, Tag, MessageCircle, ShieldCheck, Check } from 'lucide-react';
import { ImageUpload } from '@/components/ui/image-upload';
import {
  garantirPermissaoNotificacao, notificarNovoPedido,
  sincronizarLembrete, pararLembrete,
} from '@/lib/alerta-pedido';
import { suportaPush, ativarPush } from '@/lib/push';
import { despacharImpressao, imprimirComandasProducao } from '@/lib/impressao';
import type { BlocoImpressao } from '@/lib/agente';
import { ProdutosLoja } from './produtos';
import { LojaConfiguracao, HorarioLoja, ZonasEntrega, PagamentosLoja, ImpressaoLoja, EntregadoresLoja, SegurancaLoja, UsuariosLoja } from './loja-config';
import { AjudaLoja } from './ajuda';
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
  // "Entrar como lojista" (Admin) chega de duas formas: sessão já pronta no
  // storage (loja sem domínio próprio — abrirSessaoLojistaImpersonada rodou
  // no domínio do admin, que é o mesmo desta aba), OU um token no FRAGMENTO da
  // URL (loja com domínio próprio — precisou trocar de domínio, e localStorage
  // não atravessa origem; ver destinoImpersonacao em lib/api.ts). Este segundo
  // caso precisa ser consumido — validado e gravado no storage LOCAL (agora
  // sim a origem certa) — antes de decidir se mostra o painel ou o login.
  const [tokenImpersonado] = useState(() => lerRepasseImpersonacao());
  const [validandoRepasse, setValidandoRepasse] = useState(!!tokenImpersonado);

  useEffect(() => {
    if (!tokenImpersonado) return;
    abrirSessaoLojistaImpersonada(tokenImpersonado)
      .then(() => window.location.reload())
      .catch(() => setValidandoRepasse(false)); // token inválido/expirado: cai pro login normal
  }, [tokenImpersonado]);

  const u = sessaoUsuario();
  const ehLojista = !!u && u.perfil === 'lojista';

  const pedidosQ = usePedidosLojaAtivos({ enabled: ehLojista, conduzPolling: true });
  const pedidos = pedidosQ.data ?? [];
  const pendentes = pedidos.filter((p: PedidoComItens) => p.status === 'pendente').length;

  // Config da loja (largura da bobina, auto-impressão) para o auto-print.
  const lojaQ = useQuery({
    queryKey: ['minha-loja-cfg'],
    queryFn: () => api<{ loja: Record<string, unknown>; permissoes?: string[] }>('GET', '/api/lojista/loja'),
    enabled: ehLojista,
    staleTime: 60000,
  });
  /*
   * Áreas que este usuário pode abrir. Enquanto a resposta não chega, assume
   * TUDO liberado: esconder por padrão faria o menu piscar itens sumindo e
   * voltando a cada F5. Quem manda de verdade é o servidor, que bloqueia a
   * requisição — o menu aqui é conveniência, não cadeado.
   */
  const permissoes = lojaQ.data?.permissoes ?? null;
  const podeVer = (area: string) => permissoes === null || permissoes.includes(area);
  const lojaRef = useRef<Record<string, unknown> | null>(null);
  lojaRef.current = lojaQ.data?.loja ?? null;

  // Aplica a cor da marca da loja em TODO o painel do lojista (não só na aba de
  // aparência) — senão, ao dar F5, o painel voltava pro vermelho padrão.
  // Depende também de `marca`: o tema da PLATAFORMA (/api/tema, root do app)
  // carrega em paralelo com esta config da loja — se resolver depois, ele
  // sobrescreve --primary pro padrão. Incluir `marca` reaplica a cor da loja
  // assim que isso acontece (mesma corrida existe na página pública da loja).
  const { aplicarCorPrimaria, marca } = useTema();
  useEffect(() => {
    const cor = lojaQ.data?.loja?.cor_marca as string | undefined;
    const corSecundaria = lojaQ.data?.loja?.cor_secundaria as string | undefined;
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

  /*
   * DUAS NAVEGAÇÕES, de propósito.
   *
   * `itensNav` é a barra INFERIOR do mobile: grade de largura fixa, então acima de
   * 5 itens cada alvo fica menor que o dedo e o rótulo não cabe. Ela precisa do
   * "Mais".
   *
   * `gruposNav` é a sidebar do DESKTOP, onde havia uma coluna inteira vazia com 5
   * itens em cima e o resto escondido atrás de "Mais" — um clique a mais pra
   * chegar em qualquer coisa, todo dia. Agora tudo aparece, agrupado pela mesma
   * intenção da tela "Mais" (que continua existindo, é o caminho do celular).
   */
  const itemPedidos = {
    rota: '/lojista/pedidos', icone: Bell, rotulo: 'Pedidos',
    badge: pendentes > 0 ? <NavBadge valor={pendentes} /> : undefined,
  };

  // Barra de baixo do CELULAR — mesma regra de permissão da sidebar.
  const itensNav = [
    { rota: '/lojista', icone: Home, rotulo: 'Início', fim: true, area: null },
    { ...itemPedidos, area: 'pedidos' },
    { rota: '/lojista/vendas', icone: ShoppingCart, rotulo: 'Vendas', area: 'vendas' },
    { rota: '/lojista/produtos', icone: Box, rotulo: 'Produtos', area: 'produtos' },
    { rota: '/lojista/mais', icone: LayoutGrid, rotulo: 'Mais', area: null },
  ].filter(i => !i.area || podeVer(i.area));

  const gruposNav = [
    {
      itens: [
        { rota: '/lojista', icone: Home, rotulo: 'Início', fim: true },
        itemPedidos,
        { rota: '/lojista/vendas', icone: ShoppingCart, rotulo: 'Vendas' },
        { rota: '/lojista/produtos', icone: Box, rotulo: 'Produtos' },
      ],
    },
    {
      titulo: 'Operação',
      itens: [
        { rota: '/lojista/cupons', icone: Ticket, rotulo: 'Cupons' },
        { rota: '/lojista/categorias', icone: Tag, rotulo: 'Categorias' },
        { rota: '/lojista/clientes', icone: Users, rotulo: 'Clientes' },
        { rota: '/lojista/avaliacoes', icone: Star, rotulo: 'Avaliações' },
        { rota: '/lojista/cozinha-equipe', icone: ChefHat, rotulo: 'Cozinha (KDS)' },
        { rota: '/lojista/ajuda', icone: HelpCircle, rotulo: 'Treinamento' },
      ],
    },
    {
      titulo: 'Análise',
      itens: [{ rota: '/lojista/relatorios', icone: BarChart3, rotulo: 'Relatórios', area: 'relatorios' }],
    },
    {
      titulo: 'Configuração',
      itens: [{ rota: '/lojista/config', icone: Settings, rotulo: 'Configurações' }],
    },
  ];

  // Enquanto valida o repasse, não mostra o formulário de login por baixo —
  // ele piscaria na tela por uma fração de segundo antes do reload.
  if (validandoRepasse) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  /*
   * SESSÃO VÁLIDA DE OUTRO PERFIL: explica, em vez de pedir login de novo.
   *
   * ISTO ERA O "LOGUEI E VOLTOU PRA TELA DE LOGIN". Quem entrasse aqui com uma
   * conta de admin (ou cliente, ou entregador) fazia o login inteiro — senha,
   * 2FA, tudo — a sessão era gravada, a página recarregava, `ehLojista` dava
   * false e caía direto no formulário. Zero mensagem: do lado de quem usa, o
   * login simplesmente não funcionou, e não havia nada na tela sugerindo tentar
   * outro endereço.
   *
   * A checagem de perfil existia no `enviar()`, mas é INALCANÇÁVEL pra estas
   * contas: lojista e admin sempre passam pelo 2FA, e o caminho do 2FA grava a
   * sessão e recarrega sem conferir perfil nenhum. Guardar aqui — no ponto por
   * onde TODA entrada passa, inclusive o repasse entre domínios — cobre os três
   * caminhos de uma vez.
   */
  if (u && !ehLojista) {
    return <ContaDeOutroPerfil perfil={u.perfil} nome={u.nome}
      areaAtual="painel do lojista" chaveSessao="lojista" />;
  }

  if (!ehLojista) {
    return <LoginLojista />;
  }

  return (
    <AppLayout itens={itensNav} grupos={gruposNav} titulo="Painel do lojista">
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
        <Route path="ajuda" element={<AjudaLoja />} />
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
type AbaConfig =
  | 'loja' | 'horario' | 'entrega' | 'entregadores' | 'visual'
  | 'banners' | 'pagamentos' | 'impressao' | 'fiscal' | 'whatsapp' | 'seguranca' | 'usuarios';

/**
 * Agrupadas por TAREFA, não pela ordem em que foram construídas: eram 11 abas
 * numa barra com rolagem horizontal, onde as últimas ficavam fora da tela e
 * "Pix" aparecia colado em "Entregadores". O lojista pensa "vou mexer no
 * dinheiro" ou "vou mexer na operação" — os grupos seguem isso.
 */
const GRUPOS_CONFIG: { titulo: string; itens: { id: AbaConfig; label: string; icone: typeof Settings }[] }[] = [
  {
    titulo: 'A loja',
    itens: [
      { id: 'loja', label: 'Dados', icone: Settings },
      { id: 'horario', label: 'Horário', icone: Clock },
    ],
  },
  {
    titulo: 'Operação',
    itens: [
      { id: 'entrega', label: 'Entrega', icone: Bike },
      { id: 'entregadores', label: 'Entregadores', icone: Users },
      { id: 'impressao', label: 'Impressão', icone: Printer },
    ],
  },
  {
    titulo: 'Dinheiro',
    itens: [
      // "Pagamentos", não "Pix": a tela cuida de Pix E cartão. Quem procurava
      // onde configurar cartão não tinha por que clicar num item chamado "Pix".
      { id: 'pagamentos', label: 'Pagamentos', icone: CreditCard },
      { id: 'fiscal', label: 'Fiscal', icone: FileText },
    ],
  },
  {
    titulo: 'Aparência e acesso',
    itens: [
      { id: 'visual', label: 'Visual', icone: Palette },
      { id: 'banners', label: 'Banners', icone: Image },
      { id: 'whatsapp', label: 'WhatsApp', icone: MessageCircle },
      // Ao lado de Segurança: quem entra no painel é assunto de acesso, não de
      // operação. Fica logo antes dela porque criar usuário vem antes de
      // proteger o login deles.
      { id: 'usuarios', label: 'Usuários', icone: Users },
      { id: 'seguranca', label: 'Segurança', icone: ShieldCheck },
    ],
  },
];

function ConfiguracoesLoja() {
  const [aba, setAba] = useState<AbaConfig>('loja');

  const conteudo = (
    <>
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
      {aba === 'usuarios' && <UsuariosLoja />}
      {aba === 'seguranca' && <SegurancaLoja />}
    </>
  );

  return (
    <div className="lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6">
      {/* Mobile: select nativo com optgroup — mantém o agrupamento sem gastar
          15 linhas de tela nem rolar de lado (o problema original). */}
      <div className="mb-4 lg:hidden">
        <label htmlFor="aba-config" className="sr-only">Seção das configurações</label>
        <select
          id="aba-config"
          value={aba}
          onChange={e => setAba(e.target.value as AbaConfig)}
          className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-semibold"
        >
          {GRUPOS_CONFIG.map(g => (
            <optgroup key={g.titulo} label={g.titulo}>
              {g.itens.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Desktop: navegação vertical agrupada, tudo visível de uma vez. */}
      <nav className="hidden lg:block" aria-label="Configurações">
        {GRUPOS_CONFIG.map(g => (
          <div key={g.titulo} className="mb-5">
            <div className="mb-1.5 px-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {g.titulo}
            </div>
            {g.itens.map(i => {
              const Icone = i.icone;
              const ativo = aba === i.id;
              return (
                <button
                  key={i.id}
                  onClick={() => setAba(i.id)}
                  aria-current={ativo ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors',
                    ativo
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icone className="size-4 shrink-0" />
                  {i.label}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="min-w-0">{conteudo}</div>
    </div>
  );
}

/* ── Vendas: hub que junta PDV (balcão), Mesas (salão), Caixa e NFC-e ── */
function VendasLoja() {
  const [aba, setAba] = useState<'pdv' | 'mesas' | 'delivery' | 'caixa'>('pdv');

  /**
   * SEM CAIXA ABERTO, PDV E MESAS NÃO APARECEM — a tela de abertura vem primeiro.
   *
   * POR QUE: venda registrada com o caixa fechado não entra em conferência
   * nenhuma. O dinheiro entra na gaveta e não há turno pra comparar, então a
   * diferença só aparece dias depois, sem dono e sem período. Pôr a abertura no
   * caminho de quem opera é o que faz a conferência existir de fato — a
   * alternativa é uma tela que ninguém lembra de abrir.
   *
   * DELIVERY (emissão de NFC-e) segue acessível de propósito: não mexe na gaveta,
   * e travar reemissão de nota atrás da abertura de caixa viraria armadilha num
   * dia em que ninguém abriu o caixa ainda.
   */
  const caixaQ = useQuery({
    queryKey: ['lojista-caixa'],
    queryFn: () => api<{ aberto: { id: number } | null }>('GET', '/api/lojista/caixa'),
  });
  const caixaAberto = !!caixaQ.data?.aberto;

  // Aba EFETIVA derivada, não setState em efeito: se o caixa fecha enquanto a
  // pessoa está no PDV, ela cai na abertura sem render extra nem loop.
  const abaEfetiva = !caixaAberto && (aba === 'pdv' || aba === 'mesas') ? 'caixa' : aba;

  const TODAS = [
    { id: 'pdv' as const, label: 'PDV Balcão', icone: ShoppingCart, exigeCaixa: true },
    { id: 'mesas' as const, label: 'Mesas', icone: UtensilsCrossed, exigeCaixa: true },
    { id: 'caixa' as const, label: 'Caixa', icone: Banknote, exigeCaixa: false },
    { id: 'delivery' as const, label: 'Delivery', icone: FileText, exigeCaixa: false },
  ];
  const ABAS = TODAS.filter(a => caixaAberto || !a.exigeCaixa);

  // Enquanto não se sabe se há caixa aberto, não mostra aba nenhuma: piscar o PDV
  // e trocar pra abertura meio segundo depois é pior que esperar.
  if (caixaQ.isLoading) return <Skeleton className="h-64" />;

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
                abaEfetiva === a.id ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icone className="size-4 shrink-0" />
              {a.label}
            </button>
          );
        })}
      </div>

      {!caixaAberto && abaEfetiva === 'caixa' && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          <b>Abra o caixa para começar a vender.</b>{' '}
          <span className="text-muted-foreground">
            PDV Balcão e Mesas aparecem assim que o caixa estiver aberto — venda com caixa
            fechado não entra em conferência nenhuma.
          </span>
        </div>
      )}

      {abaEfetiva === 'pdv' ? <BalcaoLoja />
        : abaEfetiva === 'mesas' ? <MesasLoja />
        : abaEfetiva === 'caixa' ? <CaixaLoja />
        : <NfceDeliveryLoja />}
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
        /* Junto das telas de operação, e não escondido no rodapé: quem procura
           treinamento procura onde procuraria a função. */
        { rota: '/lojista/ajuda', icone: HelpCircle, rotulo: 'Treinamento', desc: 'Como usar o sistema, com imagens' },
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

      {contasQ.isError && (
        <Falha compacto erro={contasQ.error} aoTentar={() => contasQ.refetch()} />
      )}

      {!contasQ.isLoading && contas.length === 0 && !contasQ.isError && (
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
  /*
   * "Cartão na entrega" NÃO PODE SER O FALLBACK. Com `cartao_online`, o cupom que vai
   * junto com a comida diria pro entregador cobrar de novo um pedido JÁ PAGO — o tipo
   * de erro que vira discussão na porta do cliente. Cada forma tem seu texto, e o
   * caso desconhecido sai neutro.
   */
  const pagto =
    p.forma_pagamento === 'pix' ? 'Pix (pago online)'
    : p.forma_pagamento === 'cartao_online' ? 'Cartão (pago online)'
    : p.forma_pagamento === 'dinheiro' ? `Dinheiro${p.troco_para_centavos ? ` / troco ${fmt(p.troco_para_centavos)}` : ''}`
    : p.forma_pagamento === 'cartao_entrega' ? 'Cartão na entrega — COBRAR'
    : 'A combinar';
  const itensHtml = (p.itens || []).map(i => {
    /* Uma linha por complemento, igual ao ESC/POS logo abaixo: o HTML é o
       fallback pra quem imprime pelo diálogo do navegador, e os dois caminhos
       não podem sair com layouts diferentes. */
    const linhas = linhasDoItem(i as { opcoes_texto?: string; observacao?: string });
    return `<div class="row"><span class="nome">${i.quantidade}× ${escapar(i.nome_produto)}</span><span class="val">${fmt(i.preco_unit_centavos * i.quantidade)}</span></div>`
      + linhas.map(l => `<div class="obs">${escapar(l)}</div>`).join('');
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
${p.tipo_entrega === 'retirada' ? `<div class="sep"></div><div class="end"><b>*** RETIRADA NO LOCAL ***</b></div>` : ''}
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
      /*
       * UM BLOCO POR LINHA, não um bloco com tudo junto.
       *
       * Numa bobina de 58mm cabem 32 colunas. Com os complementos numa linha
       * só, uma pizza de dois sabores saía "Sabores: Mussarela ? Sabores:
       * Frango com Catup / iry" — nome de grupo repetido e palavra partida.
       */
      const arr: BlocoImpressao[] = [{ t: 'lr', l: `${i.quantidade}x ${i.nome_produto}`, r: fmt(i.preco_unit_centavos * i.quantidade) }];
      for (const linha of linhasDoItem(i as { opcoes_texto?: string; observacao?: string })) {
        arr.push({ t: 'texto', txt: '  ' + linha });
      }
      return arr;
    }),
    { t: 'linha' },
    { t: 'lr', b: true, l: 'TOTAL', r: fmt(p.total_centavos) },
    ...(p.tipo_entrega === 'retirada' ? [{ t: 'center' as const, b: true, txt: '*** RETIRADA NO LOCAL ***' }] : []),
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
      /*
       * A COMPOSIÇÃO VAI EM `detalhes`, ESTRUTURADA, e só a instrução do cliente
       * fica em `observacao`.
       *
       * Antes as duas iam juntas numa string só, que a comanda imprimia em
       * maiúscula e centralizada. `linhasDoItem` recebe só `opcoes_texto` aqui
       * de propósito: a observação entra pelo outro campo, e passá-la nos dois
       * lugares a imprimiria duas vezes.
       */
      detalhes: linhasDoItem({ opcoes_texto: (i as { opcoes_texto?: string }).opcoes_texto }),
      observacao: ((i as { observacao?: string }).observacao || '').trim() || undefined,
      categoria: (i as { categoria?: string }).categoria || undefined,
    })),
    totais: [],
    tipoVenda: 'Delivery', referencia: `#${p.id}`,
    cliente: p.cliente_nome,
  }, { largura, auto: true, loja_nome: config?.loja_nome || '', rodape: '' });
}

function PedidosLoja() {
  const [aba, setAba] = useState<'ativos' | 'historico'>('ativos');

  /*
   * UM relógio pra lista inteira, batendo a cada segundo — é o que faz o
   * cronômetro de espera correr (ver lib/urgencia-pedido.ts). Um setState por
   * segundo é irrelevante; um timer por card, não.
   */
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

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
      {/*
        ABAS FIXAS AO ROLAR. Numa lista de 15 pedidos o lojista rolava até o fim
        e perdia de vista tanto a troca de aba quanto o contador de pendentes —
        que é justamente o que diz se chegou pedido novo enquanto ele lia.
        `top-14` desce abaixo do header do celular (h-14 em app-layout).
      */}
      <div className="sticky top-14 z-20 -mx-4 bg-background/95 px-4 py-2 backdrop-blur lg:top-0 lg:mx-0 lg:px-0">
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        <button
          onClick={() => setAba('ativos')}
          className={cn(
            'flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-all',
            aba === 'ativos' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground',
          )}
        >
          <Bell className="size-4" />
          Em andamento
          {pendentes > 0 && (
            <span
              className="flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-bold text-white"
              aria-live="polite"
            >
              {pendentes}
              <span className="sr-only"> pedido(s) aguardando</span>
            </span>
          )}
        </button>
        <button
          onClick={() => setAba('historico')}
          className={cn(
            'flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-all',
            aba === 'historico' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground',
          )}
        >
          <History className="size-4" />
          Histórico
        </button>
      </div>
      </div>

      {/* ABA: Ativos */}
      {aba === 'ativos' && (
        <>
          {ativos_q.isLoading && (
            <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-32" />)}</div>
          )}
          {ativos_q.isError && (
            <Falha compacto erro={ativos_q.error} aoTentar={() => ativos_q.refetch()} />
          )}

          {pedidosAtivos.length === 0 && !ativos_q.isLoading && !ativos_q.isError && (
            <Card>
              <CardContent className="p-10 text-center text-muted-foreground space-y-2">
                <Bell className="size-10 mx-auto opacity-20" />
                <p className="font-medium">Nenhum pedido em andamento</p>
                <p className="text-sm">Os pedidos aparecem aqui em tempo real.</p>
              </CardContent>
            </Card>
          )}
          {/*
            Uma coluna no celular, mais colunas conforme a tela cresce.

            A lista era sempre de uma coluna só, herdada do desenho pra
            telefone. Numa tela de 27" do balcão isso vira uma faixa estreita no
            meio com dois palmos de branco dos lados, e o lojista rola pra ver o
            quarto pedido de uma hora de pico — que é exatamente quando ele não
            pode rolar.

            `items-start` é o que faz a diferença aqui: sem ele o grid estica
            todos os cards da linha até a altura do maior, e um pedido de 1 item
            fica com um vão vazio do tamanho de um pedido de 12 itens.
          */}
          <div className="grid items-start gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {pedidosAtivos.map(p => (
              <CardPedidoLojista key={p.id} pedido={p} agora={agora} aoAtualizar={() => ativos_q.refetch()} />
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
          {historico_q.isError && (
            <Falha compacto erro={historico_q.error} aoTentar={() => historico_q.refetch()} />
          )}

          {(historico_q.data ?? []).length === 0 && !historico_q.isLoading && !historico_q.isError && (
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

function CardPedidoLojista({ pedido, aoAtualizar, agora }: {
  pedido: PedidoComItens; aoAtualizar: () => void; agora: number;
}) {
  /*
   * O relógio vem da LISTA, não de um intervalo por card: com 20 pedidos na
   * tela seriam 20 timers fazendo a mesma coisa. Mesma decisão do KDS.
   */
  const urg = urgenciaPedido(pedido.criado_em, agora);
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
                  variant="destructive" className="flex-1" loading={carregando} loadingText="Recusando…"
                  onClick={() => acao('recusar', motivoRecusa || 'Pedido recusado.')}
                >
                  <XCircle className="size-4" /> Confirmar recusa
                </Button>
                <Button variant="outline" disabled={carregando}
                  onClick={() => { setRecusando(false); setMotivoRecusa(''); }}>
                  Cancelar
                </Button>
              </div>
            </div>
          );
        }
        /*
         * ACEITAR É A PRIMÁRIA e ocupa a linha inteira no celular; RECUSAR sai
         * do caminho, como texto abaixo. Antes as duas eram `size="sm"` (36px)
         * lado a lado com o mesmo peso — a ação que se toma em 95% dos pedidos
         * disputava espaço e atenção com a que se toma em 5%, e ambas abaixo do
         * mínimo tocável.
         */
        return (
          <div className="w-full space-y-2">
            <Button variant="success" className="w-full" loading={carregando} loadingText="Aceitando…"
              onClick={() => acao('aceitar')}>
              <CheckCircle2 className="size-4" /> Aceitar pedido
            </Button>
            <button
              type="button"
              disabled={carregando}
              onClick={() => setRecusando(true)}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <XCircle className="size-4" /> Recusar pedido
            </button>
          </div>
        );
      case 'aceito':
        return (
          <Button className="w-full sm:w-auto" loading={carregando} loadingText="Iniciando…"
            onClick={() => acao('preparar')}>
            <ChefHat className="size-4" /> Iniciar preparo
          </Button>
        );
      case 'preparando':
        return (
          <Button variant="success" className="w-full sm:w-auto" loading={carregando} loadingText="Marcando…"
            onClick={() => acao('pronto')}>
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
      // Pedido atrasado ganha a MESMA borda do KDS — quem olha o balcão e quem
      // olha a cozinha veem o mesmo alerta.
      urg.atrasado && 'border-red-500/50 shadow-sm shadow-red-500/10',
      isPendente && 'border-amber-500/70 bg-amber-500/5 shadow-sm shadow-amber-500/20',
    )}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold">#{pedido.id} · {pedido.cliente_nome}</span>
              {isPendente && <Badge variant="warning" className="animate-pulse">NOVO</Badge>}
            </div>
            {/*
              TEMPO DE ESPERA EM LINHA PRÓPRIA, com o mesmo semáforo do KDS
              (ver lib/urgencia-pedido.ts). Antes ele dividia uma linha de
              `text-xs` cinza com a data e a forma de pagamento — a informação
              que decide "atender agora ou depois" tinha o mesmo peso visual da
              data, e um pedido parado há 15 minutos não se distinguia de um que
              acabou de entrar.
            */}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-bold tabular-nums', urg.faixa)}
                title={`Esperando há ${urg.rotulo}`}
              >
                <Clock className={cn('size-3.5', urg.atrasado && 'animate-pulse')} />
                {urg.rotulo}
                <span className="sr-only">{urg.descricao}</span>
              </span>
              <span className="text-sm text-muted-foreground">
                {pedido.forma_pagamento === 'pix' && 'Pix'}
                {pedido.forma_pagamento === 'dinheiro' && 'Dinheiro'}
                {pedido.forma_pagamento === 'cartao_entrega' && 'Cartão na entrega'}
                {pedido.forma_pagamento === 'cartao_online' && 'Cartão (pago)'}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{dataLocal(pedido.criado_em)}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* 44×44 reais: antes eram 28×28 (p-1.5 + ícone de 16px), abaixo do
                mínimo tocável, e `title` não é lido como nome do botão. */}
            <button
              type="button"
              onClick={() => imprimirPedidoPainel(pedido)}
              aria-label={`Imprimir pedido #${pedido.id}`}
              className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
            >
              <Printer className="size-5" />
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
                {detalheItem(i) && (
                  <span className="block text-xs text-muted-foreground pl-5">{detalheItem(i)}</span>
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

        {/*
          RETIRADA precisa aparecer ANTES do endereço, e em destaque.
          O campo de endereço guarda o endereço da LOJA nesses pedidos — sem o
          selo, a linha "📍 Rua tal" se lê como destino de entrega e alguém
          despacha um entregador pra buscar o pedido na própria loja.
        */}
        {pedido.tipo_entrega === 'retirada' && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-700 dark:text-amber-400">
            RETIRADA NO LOCAL — o cliente vem buscar
          </div>
        )}
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

const LOJISTA_ZAP_MSG = 'Olá! Preciso de ajuda pra entrar no painel do lojista.';
/**
 * Título quebrado em PALAVRAS aqui e não no componente: o GSAP anima uma por uma, e
 * a lista precisa ser estável entre renders pra o `key` não recriar os spans (o que
 * reiniciaria a animação a cada digitação no formulário).
 */
const LOGIN_TITULO = 'Sua loja, seus pedidos, seu controle.'.split(' ');

/** Uma frase por linha — o filete separa, o texto não precisa de subtítulo. */
const LOJISTA_VALOR = [
  'Pedidos em tempo real, direto na cozinha',
  'NFC-e emitida na hora, sem outro sistema',
  'Relatórios e faturamento no mesmo painel',
];

/**
 * Campo do login: 52px de altura e canto de 10px.
 *
 * O foco sobrescreve o padrão do `Input` (anel de 2px na cor `ring`, com offset) por
 * borda na cor da marca + anel de 3px translúcido e SEM offset — offset abre um vão
 * branco entre borda e anel, que num campo de 52px fica visível como falha.
 */
const CAMPO_LOGIN = 'mt-1.5 h-[52px] rounded-[10px] text-[15px] shadow-none '
  + 'focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15 focus-visible:ring-offset-0';

function LoginLojista() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erroLogin, setErroLogin] = useState<string | null>(null);
  const [lembrar, setLembrar] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [duploFator, setDuploFator] = useState<{ tokenPreAuth: string; modo: 'configurar' | 'verificar' } | null>(null);
  const { mostrar } = useToast();
  // Logo e nome vêm da MARCA do domínio: é o que mantém o login white-label.
  const { marca } = useTema();

  // Chegada vinda do login da plataforma (ver `lerRepasse2FA`): retoma o 2FA
  // aqui, já no domínio do tenant dono da conta.
  useEffect(() => {
    const repasse = lerRepasse2FA();
    if (repasse) setDuploFator(repasse);
  }, []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<
        | { token: string; usuario: any }
        | { precisa2fa: true; modo2fa: 'configurar' | 'verificar'; tokenPreAuth: string; redirecionar?: string | null }
      >('POST', '/api/auth/login', { email, senha, manter_conectado: lembrar });
      // Revendedor entra pela mesma tela e vai pro painel dele.
      if (desviouParaRevendedor(r)) return;
      // `manter_conectado` decide a VALIDADE do token no servidor (30d vs 12h);
      // `lembrar` no salvarSessao decide so ONDE ele fica (localStorage vs
      // sessionStorage). Antes so o segundo existia: o token sobrevivia a fechar a
      // aba, mas expirava em 12h e a caixinha nao servia pra nada.
      if ('precisa2fa' in r) {
        // Conta que mora em OUTRA marca: o 2FA precisa ser concluído no
        // domínio dela, porque o token de pré-autenticação é carimbado com
        // aquele tenant e seria recusado aqui.
        const repasse = { tokenPreAuth: r.tokenPreAuth, modo: r.modo2fa };
        const destino = destinoRepasse2FA(r.redirecionar, '/lojista', repasse);
        if (destino) {
          window.location.assign(destino);
          return;
        }
        setDuploFator(repasse);
        return;
      }
      if (r.usuario.perfil !== 'lojista') {
        setErroLogin('Esta conta não é de lojista.');
        mostrar({ tipo: 'erro', titulo: 'Esta conta não é de lojista.' });
        return;
      }
      salvarSessao(r.token, r.usuario, undefined, lembrar);
      window.location.reload();
    } catch (err) {
      if (err instanceof ApiError) {
        // Junto do formulário além do toast: o toast some sozinho e nasce no
        // canto da tela, longe de onde a pessoa está olhando ao errar a senha.
        setErroLogin(err.message);
        mostrar({ tipo: 'erro', titulo: err.message });
      }
    } finally {
      setEnviando(false);
    }
  }

  /*
   * ANIMAÇÃO DE ENTRADA (GSAP).
   *
   * `gsap.context` com escopo no container: o `revert()` no cleanup desfaz tudo o que
   * foi criado aqui e nada mais — sem ele, remontar a tela (o `reload()` depois do
   * login, o hot-reload em desenvolvimento) deixaria tweens vivos mexendo em nós que
   * já saíram do DOM.
   *
   * SEM `clearProps`: ele APAGA estilo inline, e o mascote e o círculo decorativo
   * dependem de estilo inline (posição em porcentagem que o Tailwind não expressa).
   * Um `clearProps: 'all'` num seletor amplo levaria os dois embora.
   *
   * `prefers-reduced-motion` pula tudo em vez de encurtar: quem liga isso costuma
   * fazer por enxaqueca ou sensibilidade vestibular, e movimento rápido é pior que
   * movimento nenhum. Os elementos já estão visíveis por padrão — a animação só sai
   * DE um estado deslocado (`gsap.from`), então não animar significa simplesmente a
   * tela pronta.
   */
  const escopo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-anim="logo"]', { y: -14, opacity: 0, duration: 0.6, ease: 'power3.out' });
      gsap.from('[data-anim="palavra"]', {
        y: '0.9em', opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.08, delay: 0.15,
      });
      gsap.from('[data-anim="apoio"]', {
        y: 22, opacity: 0, duration: 0.6, ease: 'power3.out', stagger: 0.09, delay: 0.55,
      });
      gsap.from('[data-anim="campo"]', {
        y: 18, opacity: 0, duration: 0.55, ease: 'power3.out', stagger: 0.07, delay: 0.25,
      });
      /*
       * O BOTÃO DE ENVIAR ANIMA SÓ A POSIÇÃO, NUNCA A OPACIDADE.
       *
       * `gsap.from` com opacity esconde o elemento e conta com o tween TERMINAR pra
       * revelá-lo. Se um frame não chega — aba em segundo plano, carga pesada,
       * `requestAnimationFrame` estrangulado —, o elemento fica parado no estado
       * inicial. Foi o que aconteceu: o botão ficou com `opacity: 0;
       * transform: translate(0px, 18px)` no estilo inline e o lojista viu um buraco
       * onde devia estar "Entrar".
       *
       * Num texto decorativo isso é um defeito visual. No botão que ENVIA O
       * FORMULÁRIO é a tela inteira inutilizada. Animando só `y`, a pior falha
       * possível é ele aparecer 18px fora do lugar — e clicável.
       *
       * Delay 0.67 = 0.25 + 0.07×6, a posição que ele teria no stagger dos campos.
       */
      gsap.from('[data-anim="botao"]', { y: 18, duration: 0.55, ease: 'power3.out', delay: 0.67 });
    }, escopo);
    return () => ctx.revert();
  }, []);

  if (duploFator) {
    return (
      <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-10">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-accent/30" />
        <div className="relative">
          <Portal2FA
            manterConectado={lembrar}
            tokenPreAuth={duploFator.tokenPreAuth}
            modo={duploFator.modo}
            onCancelar={() => setDuploFator(null)}
            onSucesso={(token, usuario) => { salvarSessao(token, usuario, undefined, lembrar); window.location.reload(); }}
          />
        </div>
      </div>
    );
  }

  return (
    /*
     * TUDO EM `--primary` / `--primary-foreground`. Nenhum laranja cravado: este
     * arquivo serve todo cliente white-label, e cor fixa aqui pintaria de laranja o
     * login de quem escolheu roxo. O verde do WhatsApp é a ÚNICA cor fixa da tela —
     * aquele é marca de outra empresa, não de quem usa o sistema.
     */
    <div ref={escopo} className="flex min-h-dvh bg-background">
      {/* ───────────── Painel da marca (só desktop) ───────────── */}
      <div
        className="relative hidden shrink-0 grow-0 basis-[46%] flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex xl:p-14"
      >
        {/* Único elemento decorativo. Sem gradiente, textura ou blur: cor chapada
            aguenta qualquer `--primary` que o cliente escolher, inclusive os claros,
            onde gradiente e textura viram sujeira. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-full bg-white/10"
          style={{ width: '46rem', height: '46rem', right: '-16rem', bottom: '-20rem' }}
        />

        {/*
          LOGO DO TENANT, não um arquivo fixo da plataforma: `logo-unimaxx.png` no
          código faria a marca da Unimaxx aparecer no login de todos os clientes —
          o oposto do white-label. Sem logo cadastrado, cai num selo com o nome.
        */}
        <div className="relative z-10" data-anim="logo">
          {marca.logo_url ? (
            <img src={marca.logo_url} alt={marca.nome} draggable={false}
              style={{ height: alturaLogo(44, marca.logo_escala) }}
              className="w-auto max-w-[280px] object-contain" />
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-primary-foreground/15">
                <Store className="size-5" strokeWidth={2.5} />
              </div>
              <span className="text-lg font-extrabold">{marca.nome}</span>
            </div>
          )}
        </div>

        {/*
          `max-w-[19rem]` no BLOCO, não só no título: o filete (`border-t`) tem a
          largura do item da lista, e com o bloco largo ele atravessava o mascote — um
          risco branco cortando o personagem no meio.

          21rem é o número medido: em 19rem as três frases quebravam em DUAS linhas
          cada (76px de altura em vez de 52px), e em 23rem o filete encostava no
          mascote. Mascote grande e linhas largas não cabem juntos em 46% da tela, e a
          lista é a parte que aceita ser estreita sem perder informação.
        */}
        <div className="relative z-10 max-w-[21rem]">
          {/*
            Título dividido POR PALAVRA em spans `inline-block`, montados no JSX e não
            por manipulação de DOM: o GSAP anima cada palavra, e transform só funciona
            em elemento que não seja inline puro. Feito no JSX, o texto continua
            selecionável e legível por leitor de tela como uma frase.
          */}
          <h2
            className="font-extrabold leading-[1.06]"
            style={{ fontSize: 'clamp(30px, 2.9vw, 44px)', letterSpacing: '-0.035em' }}
          >
            {LOGIN_TITULO.map((palavra, i) => (
              <span key={`${palavra}-${i}`} className="inline-block" data-anim="palavra">
                {palavra}{i < LOGIN_TITULO.length - 1 ? ' ' : ''}
              </span>
            ))}
          </h2>

          <p className="mt-4 text-[15px] leading-relaxed text-primary-foreground/80" data-anim="apoio">
            Gerencie o balcão, a cozinha e a entrega em um só painel.
          </p>

          {/*
            Benefícios como LINHAS com filete, não cards: card sugere que dá pra
            clicar. Aqui é texto informativo, e o filete separa sem prometer ação.
          */}
          <ul className="mt-8">
            {LOJISTA_VALOR.map(v => (
              <li
                key={v}
                className="flex items-center gap-3 border-t border-white/20 py-[15px] text-[15px] font-medium last:border-b"
                data-anim="apoio"
              >
                <Check className="size-[18px] shrink-0" strokeWidth={3} />
                {v}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 text-xs text-white/60" data-anim="apoio">
          © {new Date().getFullYear()} — sistema de delivery
        </div>

        {/*
          Mascote sem animação: é o elemento mais pesado da tela, e movimento nele puxa
          o olho pra longe do formulário.

          DIMENSIONADO POR ALTURA porque o arquivo foi RECORTADO: o original tinha
          1536x1024 com o personagem ocupando só 636x935 no meio — 506px de vazio à
          esquerda. Dimensionar por largura escalava a margem transparente junto, então
          o mascote saía pequeno e empurrado pra direita. Recortado, altura da imagem =
          altura do personagem, e o tamanho na tela vira o que se pede.

          LARGURA E NÃO ALTURA, e nunca as duas juntas: fixar `height` E `maxWidth` ao
          mesmo tempo criou uma caixa de 424x860 com a imagem de 424x621 flutuando
          letterboxed dentro — ar sobrando embaixo do personagem. Com largura em % do
          painel, a caixa É a imagem, ancorada no rodapé, sem distorcer.

          `w-[42%]` até 1536px e `50%` acima: medindo em 1280, com 50% fixo ele cobria
          as linhas por 27px — o painel encolhe com a tela, o texto não encolhe junto, e
          o aperto aparece só na ponta de baixo. Em classe (não em estilo inline) porque
          porcentagem com breakpoint o Tailwind expressa, e assim o elemento fica sem
          estilo inline nenhum.

          `z-0` com o texto em `z-10`: como último filho do painel, ele pintava POR CIMA
          das linhas de benefício e cortava as frases no meio ("...sem outro si").
        */}
        <img
          src="/mascote/avatar.png"
          alt="" aria-hidden="true" draggable={false}
          className="pointer-events-none absolute bottom-[-1%] right-[-12%] z-0 w-[42%] max-w-[470px] select-none object-contain object-bottom 2xl:w-[50%]"
        />
      </div>

      {/* ───────────── Formulário ───────────── */}
      <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        {/* SEM card: sem borda e sem sombra. Ao lado de um bloco de cor chapada, a
            moldura só adiciona uma segunda caixa competindo com a primeira. */}
        <div className="w-full max-w-[404px]">
          {/* No mobile o painel da marca não existe, então o selo aparece aqui —
              senão a tela abre sem nada que diga de quem ela é. */}
          <div className="mb-7 lg:hidden" data-anim="campo">
            {marca.logo_url ? (
              <img src={marca.logo_url} alt={marca.nome} draggable={false}
                style={{ height: alturaLogo(36, marca.logo_escala) }}
                className="w-auto max-w-[220px] object-contain" />
            ) : (
              <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <Store className="size-5" strokeWidth={2.5} />
              </div>
            )}
          </div>

          <h1 className="text-[30px] font-extrabold leading-tight tracking-tight" data-anim="campo">
            Entrar no painel
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground" data-anim="campo">
            Acesse com o e-mail cadastrado da sua loja.
          </p>

          <form onSubmit={enviar} className="mt-7 space-y-4">
            <ErroLogin mensagem={erroLogin} />
            <div data-anim="campo">
              <Label htmlFor="email-lojista">E-mail</Label>
              {/* Sem ícone dentro do campo: com o placeholder já explicando o que vai
                  ali, o ícone é decoração que come o recuo do texto. */}
              <Input
                id="email-lojista"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                enterKeyHint="next"
                placeholder="seu@email.com"
                className={CAMPO_LOGIN}
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>

            <div data-anim="campo">
              <Label htmlFor="senha-lojista">Senha</Label>
              <div className="relative mt-1.5">
                <Input
                  id="senha-lojista"
                  type={mostrarSenha ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  enterKeyHint="go"
                  placeholder="Sua senha"
                  className={cn(CAMPO_LOGIN, 'mt-0 pr-12')}
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenha(v => !v)}
                  className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={mostrarSenha ? 'Esconder senha' : 'Mostrar senha'}
                >
                  {mostrarSenha ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
                </button>
              </div>
            </div>

            {/* Lembrar e "esqueci" na MESMA linha: são as duas decisões secundárias da
                tela, e empilhadas empurram o botão pra baixo da dobra no celular. */}
            <div className="flex items-center justify-between gap-3" data-anim="campo">
              <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={lembrar}
                  onChange={e => setLembrar(e.target.checked)}
                  className="size-4 shrink-0 rounded border-input accent-[hsl(var(--primary))]"
                />
                Manter conectado
              </label>
              {/* -my-3 + py-3: o alvo cresce pra 44px sem a linha crescer junto. */}
              <Link to="/esqueci-senha" className="-my-3 flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">
                Esqueci minha senha
              </Link>
            </div>

            {/* Wrapper pro GSAP não escrever estilo inline no próprio <button>: ele
                tem `transition-all` do variante, e transição CSS disputando com
                animação JS na mesma propriedade é fonte de estado preso. */}
            <div data-anim="botao">
              <Button
                type="submit"
                className="h-[52px] w-full rounded-[10px] text-base font-bold hover:brightness-95"
                loading={enviando}
                loadingText="Entrando…"
              >
                Entrar
              </Button>
            </div>
          </form>

          <div className="my-6 flex items-center gap-3" data-anim="campo">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">ou</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <a
            href={`https://wa.me/?text=${encodeURIComponent(LOJISTA_ZAP_MSG)}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[10px] text-sm font-semibold text-foreground transition-colors hover:bg-accent"
            data-anim="campo"
          >
            {/* Verde fixo: é a marca do WhatsApp. Trocar pela cor do tenant faria o
                ícone deixar de ser reconhecível, que é a única função dele aqui. */}
            <MessageCircle className="size-[18px]" style={{ color: '#25d366' }} />
            Falar com o suporte
          </a>

          <p className="mt-7 text-center text-xs text-muted-foreground" data-anim="campo">
            Ainda não tem uma loja?{' '}
            <a href="mailto:suporte.cristopher@unimaxx.com.br" className="font-semibold text-primary hover:underline">
              Fale com a gente
            </a>
          </p>
        </div>
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

      {consulta.isError && (
        <Falha compacto erro={consulta.error} aoTentar={() => consulta.refetch()} />
      )}

      {clientes.length === 0 && !consulta.isLoading && !consulta.isError && (
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
