/**
 * Layout do painel admin — sidebar no desktop, drawer no mobile.
 * Substitui o AppLayout genérico em todas as páginas do admin.
 */
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Store, Users, ShoppingBag, TrendingUp,
  Image, Palette, Shield, Crown, LogOut, Menu, X, ChevronRight, Radio, Bike, Building2, History,
  CreditCard, UserCog, LayoutTemplate, Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { api, encerrarSessao, sessaoUsuario, ehSuperAdmin } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';

interface NavItem {
  rota: string;
  icone: typeof LayoutDashboard;
  label: string;
  somenteSuper?: boolean;
  /** Filete separando blocos de intenção — ver comentário em ITENS. */
  divisorDepois?: boolean;
}

/*
 * LISTA ÚNICA, não seis grupos.
 *
 * Metade dos grupos tinha UM item — 'Financeiro' com só Repasses, 'Operação'
 * separada de 'Pessoas' sem que a divisão ajudasse a achar nada. Títulos de
 * seção existem pra reduzir a busca; com um item cada, só empurram o menu pra
 * baixo e escondem o resto atrás de rolagem.
 *
 * A ordem agora é por FREQUÊNCIA DE USO, e os divisores separam blocos de
 * intenção: o dia a dia primeiro, cadastro no meio, configuração no fim.
 */
const ITENS: NavItem[] = [
  { rota: '/painel-admin',              icone: LayoutDashboard, label: 'Dashboard' },
  { rota: '/painel-admin/monitor',      icone: Radio,           label: 'Monitor', divisorDepois: true },

  { rota: '/painel-admin/pedidos',      icone: ShoppingBag,     label: 'Pedidos' },
  { rota: '/painel-admin/lojas',        icone: Store,           label: 'Lojas' },
  { rota: '/painel-admin/entregadores', icone: Bike,            label: 'Entregadores' },
  { rota: '/painel-admin/banners',      icone: Image,           label: 'Banners', divisorDepois: true },

  /*
   * 'Clientes' é o nome do tenant em TODO lugar agora. Antes a mesma coisa
   * aparecia como 'Tenants' no título e 'Bancos por loja' no menu — dois nomes
   * técnicos pra algo que, do ponto de vista do negócio, é o cliente que
   * contratou a plataforma.
   */
  { rota: '/painel-admin/clientes',     icone: Building2,       label: 'Clientes',    somenteSuper: true },
  { rota: '/painel-admin/assinaturas',  icone: CreditCard,      label: 'Assinaturas', somenteSuper: true },
  { rota: '/painel-admin/lojistas',     icone: Users,           label: 'Lojistas',    somenteSuper: true, divisorDepois: true },

  { rota: '/painel-admin/repasses',     icone: TrendingUp,      label: 'Repasses',  somenteSuper: true },
  { rota: '/painel-admin/marca',        icone: Palette,         label: 'Marca',        somenteSuper: true },
  { rota: '/painel-admin/marca/landing', icone: LayoutTemplate, label: 'Landing page', somenteSuper: true },
  { rota: '/painel-admin/configuracoes', icone: Settings,      label: 'Configurações', somenteSuper: true },
  { rota: '/painel-admin/admins',       icone: Shield,          label: 'Admins',    somenteSuper: true },
  { rota: '/painel-admin/auditoria',    icone: History,         label: 'Auditoria', somenteSuper: true },
];

export function AdminLayout({ children, titulo }: { children: ReactNode; titulo?: string }) {
  const [drawerAberto, setDrawerAberto] = useState(false);
  const superAdmin = ehSuperAdmin();
  const u = sessaoUsuario();

  const itens = ITENS.filter(i => !i.somenteSuper || superAdmin);

  /*
   * LOJAS AGUARDANDO APROVAÇÃO viram um ponto âmbar no menu.
   *
   * É a única pendência do admin que trava um cliente do outro lado: enquanto
   * ninguém aprova, a loja não vende. Sem o aviso, só descobria quem abrisse a
   * tela de Lojas por acaso.
   */
  const pendentes = useQuery({
    queryKey: ['admin-lojas-pendentes'],
    queryFn: () => api<{ lojas: { status_aprovacao: string }[] }>('GET', '/api/admin/lojas')
      .then(r => r.lojas.filter(l => l.status_aprovacao === 'pendente').length),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  function sair() {
    encerrarSessao();
    window.location.href = '/painel-admin';
  }

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* ── SIDEBAR DESKTOP ── */}
      <aside className="hidden md:flex md:flex-col w-60 shrink-0 bg-zinc-900 text-zinc-100">
        <SidebarContent itens={itens} pendentesLojas={pendentes.data ?? 0} superAdmin={superAdmin} u={u} onSair={sair} />
      </aside>

      {/* ── DRAWER MOBILE ── */}
      {drawerAberto && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawerAberto(false)} />
          <aside className="relative flex flex-col w-72 max-w-[85vw] bg-zinc-900 text-zinc-100 shadow-2xl">
            <button
              onClick={() => setDrawerAberto(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/10 text-zinc-400"
            >
              <X className="size-5" />
            </button>
            <SidebarContent itens={itens} pendentesLojas={pendentes.data ?? 0} superAdmin={superAdmin} u={u} onSair={sair} />
          </aside>
        </div>
      )}

      {/* ── ÁREA DE CONTEÚDO ── */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header mobile */}
        <header className="md:hidden flex items-center gap-3 border-b border-border bg-background px-4 h-14 shrink-0">
          <button
            onClick={() => setDrawerAberto(true)}
            className="p-2 rounded-xl hover:bg-accent text-muted-foreground"
          >
            <Menu className="size-5" />
          </button>
          <span className="font-bold text-sm flex items-center gap-1.5">
            {superAdmin && <Crown className="size-4 text-amber-400" />}
            {titulo ?? 'Admin'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>

        {/* Header desktop */}
        <header className="hidden md:flex items-center gap-3 border-b border-border bg-background/80 backdrop-blur px-6 h-14 shrink-0">
          {titulo && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Admin</span>
              <ChevronRight className="size-3.5" />
              <span className="font-semibold text-foreground">{titulo}</span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarContent({ itens, pendentesLojas, superAdmin, u, onSair }: {
  itens: NavItem[];
  pendentesLojas: number;
  superAdmin: boolean;
  u: ReturnType<typeof sessaoUsuario>;
  onSair: () => void;
}) {
  return (
    <>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/10">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary shrink-0">
          {superAdmin ? <Crown className="size-4 text-primary-foreground" /> : <Shield className="size-4 text-primary-foreground" />}
        </div>
        <div className="min-w-0">
          <div className="font-extrabold text-sm leading-tight truncate">Painel Admin</div>
          <div className="text-[10px] text-zinc-400 leading-tight">
            {superAdmin ? 'Super Admin' : 'Operacional'}
          </div>
        </div>
      </div>

      {/* Navegação */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {itens.map(item => (
          <div key={item.rota}>
            <NavLink
              to={item.rota}
              // `end` no Dashboard (senão TUDO fica ativo) e em Marca, que é
              // prefixo de /marca/landing — sem isso os dois acendiam juntos.
              end={item.rota === '/painel-admin' || item.rota === '/painel-admin/marca'}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-zinc-400 hover:bg-white/8 hover:text-zinc-100',
              )}
            >
              <item.icone className="size-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {/* Ponto âmbar, não número: o que importa é 'tem coisa parada',
                  e a contagem exata está na própria tela de Lojas. */}
              {item.rota === '/painel-admin/lojas' && pendentesLojas > 0 && (
                <span
                  className="size-2 shrink-0 rounded-full bg-amber-500"
                  title={`${pendentesLojas} loja(s) aguardando aprovação`}
                />
              )}
            </NavLink>
            {item.divisorDepois && <div className="my-2 border-t border-white/10" />}
          </div>
        ))}
      </nav>

      {/* Footer usuário */}
      <div className="border-t border-white/10 px-4 py-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-zinc-100 shrink-0">
            {u?.nome?.charAt(0).toUpperCase() ?? 'A'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate text-zinc-100">{u?.nome ?? 'Admin'}</div>
            <div className="text-[11px] text-zinc-400 truncate">{u?.email}</div>
          </div>
        </div>
        {/* MINHA CONTA sai de "Admins" e vem pro rodapé: trocar a PRÓPRIA senha
            não é administrar os outros, e misturar as duas coisas fazia o admin
            procurar a própria conta numa tela de gerenciar terceiros. */}
        <NavLink
          to="/painel-admin/minha-conta"
          className={({ isActive }) => cn(
            'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
            isActive ? 'bg-white/10 text-zinc-100' : 'text-zinc-400 hover:bg-white/8 hover:text-zinc-100',
          )}
        >
          <UserCog className="size-4" />
          Minha conta
        </NavLink>
        <button
          onClick={onSair}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-zinc-400 hover:bg-white/8 hover:text-zinc-100 transition-colors"
        >
          <LogOut className="size-4" />
          Sair
        </button>
      </div>
    </>
  );
}
