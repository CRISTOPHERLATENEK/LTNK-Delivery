import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Store, Users, ShoppingBag, TrendingUp, AlertCircle,
  Crown, ArrowRight, Image, Palette, Shield, Clock,
} from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, sessaoUsuario, ehSuperAdmin, salvarSessao } from '@/lib/api';
import { brl } from '@/lib/format';
import { cn } from '@/lib/utils';

interface DadosDashboard {
  pedidos_hoje: number;
  faturamento_hoje_centavos: number;
  comissao_hoje_centavos: number;
  pedidos_em_andamento: number;
  lojas_ativas: number;
  lojas_pendentes: number;
  lojas_suspensas: number;
  total_usuarios: number;
  serie_vendas: { dia: string; pedidos: number; total_centavos: number }[];
  top_lojas: { id: number; nome: string; pedidos: number; total_centavos: number }[];
}

export function TelaAdmin() {
  const u = sessaoUsuario();
  if (!u || u.perfil !== 'admin') return <LoginAdmin />;
  return (
    <AdminLayout titulo="Dashboard">
      <Dashboard />
    </AdminLayout>
  );
}

function Dashboard() {
  const superAdmin = ehSuperAdmin();
  const u = sessaoUsuario();
  const consulta = useQuery({
    queryKey: ['dashboard-admin'],
    queryFn: () => api<DadosDashboard>('GET', '/api/admin/dashboard'),
    refetchInterval: 30_000,
  });

  const d = consulta.data;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Greeting hero */}
      <div className="rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 p-6 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary via-transparent to-transparent" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-1">
            {superAdmin
              ? <Crown className="size-5 text-amber-400" />
              : <Shield className="size-5 text-primary" />}
            <Badge variant={superAdmin ? 'warning' : 'info'} className="text-[10px]">
              {superAdmin ? 'SUPER ADMIN' : 'OPERACIONAL'}
            </Badge>
          </div>
          <h1 className="text-2xl font-extrabold">Olá, {u?.nome?.split(' ')[0] ?? 'Admin'} 👋</h1>
          <p className="text-zinc-400 text-sm mt-1">
            {superAdmin
              ? 'Você tem controle total da plataforma.'
              : 'Você pode aprovar lojas, ver pedidos e gerenciar banners.'}
          </p>
        </div>
      </div>

      {/* Alerta lojas pendentes */}
      {d && d.lojas_pendentes > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-5 py-4">
          <AlertCircle className="size-5 text-amber-500 shrink-0" />
          <div className="flex-1 text-sm font-semibold text-amber-700 dark:text-amber-400">
            {d.lojas_pendentes} loja{d.lojas_pendentes > 1 ? 's' : ''} aguardando aprovação
          </div>
          <Button size="sm" asChild>
            <Link to="/painel-admin/lojas">Revisar <ArrowRight className="size-3.5" /></Link>
          </Button>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          titulo="Pedidos hoje"
          valor={consulta.isLoading ? '…' : String(d?.pedidos_hoje ?? 0)}
          icone={<ShoppingBag className="size-5" />}
          cor="bg-blue-500/10 text-blue-600"
        />
        <KpiCard
          titulo="Faturamento hoje"
          valor={consulta.isLoading ? '…' : brl(d?.faturamento_hoje_centavos ?? 0)}
          icone={<TrendingUp className="size-5" />}
          cor="bg-emerald-500/10 text-emerald-600"
        />
        <KpiCard
          titulo="Comissão gerada"
          valor={consulta.isLoading ? '…' : brl(d?.comissao_hoje_centavos ?? 0)}
          icone={<Crown className="size-5" />}
          cor="bg-amber-500/10 text-amber-600"
        />
        <KpiCard
          titulo="Em andamento"
          valor={consulta.isLoading ? '…' : String(d?.pedidos_em_andamento ?? 0)}
          icone={<Clock className="size-5" />}
          cor="bg-purple-500/10 text-purple-600"
        />
      </div>

      {/* Gráfico de vendas + ranking */}
      <div className="grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardContent className="p-5">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-bold flex items-center gap-2">
                <TrendingUp className="size-4 text-primary" /> Vendas — últimos 14 dias
              </h2>
              {d && (
                <span className="text-xs text-muted-foreground">
                  {brl(d.serie_vendas?.reduce((s, x) => s + x.total_centavos, 0) ?? 0)} no período
                </span>
              )}
            </div>
            {consulta.isLoading
              ? <Skeleton className="h-40 rounded-xl" />
              : <GraficoVendas serie={d?.serie_vendas ?? []} />}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <h2 className="font-bold flex items-center gap-2 mb-4">
              <Crown className="size-4 text-amber-500" /> Lojas que mais vendem
            </h2>
            {consulta.isLoading
              ? <Skeleton className="h-40 rounded-xl" />
              : <RankingLojas lojas={d?.top_lojas ?? []} />}
          </CardContent>
        </Card>
      </div>

      {/* Status de lojas */}
      <div className="grid grid-cols-3 gap-3">
        <LojaStatus
          titulo="Ativas"
          valor={consulta.isLoading ? '…' : String(d?.lojas_ativas ?? 0)}
          cor="text-emerald-600"
          bg="bg-emerald-500/10"
        />
        <LojaStatus
          titulo="Pendentes"
          valor={consulta.isLoading ? '…' : String(d?.lojas_pendentes ?? 0)}
          cor={d && d.lojas_pendentes > 0 ? 'text-amber-600' : 'text-muted-foreground'}
          bg={d && d.lojas_pendentes > 0 ? 'bg-amber-500/10' : 'bg-muted/40'}
        />
        <LojaStatus
          titulo="Suspensas"
          valor={consulta.isLoading ? '…' : String(d?.lojas_suspensas ?? 0)}
          cor={d && d.lojas_suspensas > 0 ? 'text-destructive' : 'text-muted-foreground'}
          bg={d && d.lojas_suspensas > 0 ? 'bg-destructive/10' : 'bg-muted/40'}
        />
      </div>

      {/* Acesso rápido */}
      <div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-3">Acesso rápido</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <AcaoCard
            icone={<Store className="size-5" />}
            titulo="Gerenciar lojas"
            descricao="Aprovar, suspender ou reativar lojas da plataforma."
            rota="/painel-admin/lojas"
            cor="bg-blue-500"
          />
          <AcaoCard
            icone={<ShoppingBag className="size-5" />}
            titulo="Todos os pedidos"
            descricao="Filtrar por loja, status e período."
            rota="/painel-admin/pedidos"
            cor="bg-purple-500"
          />
          <AcaoCard
            icone={<Image className="size-5" />}
            titulo="Banners"
            descricao="Gerenciar carrossel da home da plataforma."
            rota="/painel-admin/banners"
            cor="bg-pink-500"
          />
          {superAdmin && (
            <>
              <AcaoCard
                icone={<Users className="size-5" />}
                titulo="Lojistas"
                descricao="Ver clientes, pedidos e faturamento de cada lojista."
                rota="/painel-admin/lojistas"
                cor="bg-emerald-500"
                destaque
              />
              <AcaoCard
                icone={<TrendingUp className="size-5" />}
                titulo="Comissão e repasses"
                descricao="Configurar % da plataforma e gerar relatório financeiro."
                rota="/painel-admin/repasses"
                cor="bg-amber-500"
                destaque
              />
              <AcaoCard
                icone={<Palette className="size-5" />}
                titulo="Marca da plataforma"
                descricao="Nome, logo e cor — white label do app inteiro."
                rota="/painel-admin/marca"
                cor="bg-rose-500"
                destaque
              />
              <AcaoCard
                icone={<Shield className="size-5" />}
                titulo="Gerenciar admins"
                descricao="Criar e remover admins operacionais."
                rota="/painel-admin/admins"
                cor="bg-zinc-600"
                destaque
              />
            </>
          )}
        </div>
      </div>

      {/* Total usuários */}
      {d && (
        <p className="text-xs text-muted-foreground text-center">
          {d.total_usuarios} usuário{d.total_usuarios !== 1 ? 's' : ''} cadastrados na plataforma
        </p>
      )}
    </div>
  );
}

/* ───────────────────────── Gráfico de vendas (SVG, sem libs) ───────────────────────── */

function GraficoVendas({ serie }: { serie: { dia: string; pedidos: number; total_centavos: number }[] }) {
  const max = Math.max(1, ...serie.map(s => s.total_centavos));
  const temVendas = serie.some(s => s.total_centavos > 0);

  if (!temVendas) {
    return (
      <div className="h-40 flex flex-col items-center justify-center text-center text-muted-foreground">
        <TrendingUp className="size-7 mb-2 opacity-30" />
        <p className="text-sm">Ainda sem vendas no período.</p>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-1.5 h-40">
      {serie.map((s, i) => {
        const altura = Math.round((s.total_centavos / max) * 100);
        const [, mes, dia] = s.dia.split('-');
        const ehHoje = i === serie.length - 1;
        return (
          <div key={s.dia} className="flex-1 flex flex-col items-center gap-1.5 group min-w-0">
            <div className="relative w-full flex-1 flex items-end">
              {/* Tooltip */}
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap rounded-lg bg-foreground text-background text-[10px] font-semibold px-2 py-1 shadow-lg">
                {brl(s.total_centavos)} · {s.pedidos} ped.
              </div>
              <div
                className={cn(
                  'w-full rounded-t-md transition-all',
                  ehHoje ? 'bg-primary' : 'bg-primary/35 group-hover:bg-primary/60',
                )}
                style={{ height: `${Math.max(altura, 2)}%` }}
              />
            </div>
            <span className={cn('text-[9px] tabular-nums', ehHoje ? 'text-primary font-bold' : 'text-muted-foreground')}>
              {dia}/{mes}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RankingLojas({ lojas }: { lojas: { id: number; nome: string; pedidos: number; total_centavos: number }[] }) {
  if (lojas.length === 0) {
    return (
      <div className="h-40 flex flex-col items-center justify-center text-center text-muted-foreground">
        <Crown className="size-7 mb-2 opacity-30" />
        <p className="text-sm">Sem vendas entregues ainda.</p>
      </div>
    );
  }
  const max = Math.max(1, ...lojas.map(l => l.total_centavos));
  const medalhas = ['🥇', '🥈', '🥉'];
  return (
    <div className="space-y-3">
      {lojas.map((l, i) => (
        <Link key={l.id} to="/painel-admin/lojas" className="block group">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm w-5 text-center">{medalhas[i] ?? <span className="text-xs text-muted-foreground font-bold">{i + 1}</span>}</span>
            <span className="text-sm font-semibold flex-1 min-w-0 truncate group-hover:text-primary transition-colors">{l.nome}</span>
            <span className="text-sm font-bold tabular-nums">{brl(l.total_centavos)}</span>
          </div>
          <div className="ml-7 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-primary" style={{ width: `${Math.round((l.total_centavos / max) * 100)}%` }} />
          </div>
        </Link>
      ))}
    </div>
  );
}

function KpiCard({ titulo, valor, icone, cor }: { titulo: string; valor: string; icone: React.ReactNode; cor: string }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className={cn('flex size-10 items-center justify-center rounded-xl', cor)}>
          {icone}
        </div>
        <div>
          <div className="text-2xl font-extrabold tabular-nums">{valor}</div>
          <div className="text-xs text-muted-foreground font-medium mt-0.5">{titulo}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function LojaStatus({ titulo, valor, cor, bg }: { titulo: string; valor: string; cor: string; bg: string }) {
  return (
    <Card>
      <CardContent className={cn('p-4 text-center rounded-xl', bg)}>
        <div className={cn('text-3xl font-extrabold tabular-nums', cor)}>{valor}</div>
        <div className="text-xs text-muted-foreground font-medium mt-1">Lojas {titulo.toLowerCase()}</div>
      </CardContent>
    </Card>
  );
}

function AcaoCard({ icone, titulo, descricao, rota, cor, destaque }: {
  icone: React.ReactNode; titulo: string; descricao: string;
  rota: string; cor: string; destaque?: boolean;
}) {
  return (
    <Link to={rota} className="block group">
      <Card className={cn(
        'h-full transition-all hover:shadow-md hover:-translate-y-0.5',
        destaque && 'border-primary/20',
      )}>
        <CardContent className="p-5 flex items-start gap-4">
          <div className={cn('flex size-10 items-center justify-center rounded-xl shrink-0 text-white shadow-sm', cor)}>
            {icone}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm">{titulo}</div>
            <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{descricao}</div>
          </div>
          <ArrowRight className="size-4 text-muted-foreground/40 shrink-0 mt-0.5 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
        </CardContent>
      </Card>
    </Link>
  );
}

function LoginAdmin() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);
  const { mostrar } = useToast();

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    try {
      const r = await api<{ token: string; usuario: any }>('POST', '/api/auth/login', { email, senha });
      if (r.usuario.perfil !== 'admin') {
        mostrar({ tipo: 'erro', titulo: 'Esta conta não é de admin.' });
        return;
      }
      salvarSessao(r.token, r.usuario);
      window.location.reload();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex size-16 items-center justify-center rounded-2xl bg-primary mb-4 shadow-lg shadow-primary/30">
            <Shield className="size-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-extrabold text-white">Painel Admin</h1>
          <p className="text-zinc-400 text-sm mt-1">Acesso restrito a administradores</p>
        </div>

        <form onSubmit={entrar} className="space-y-3">
          <input
            className="w-full h-12 px-4 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-sm"
            type="email" required placeholder="E-mail" autoComplete="email"
            value={email} onChange={e => setEmail(e.target.value)}
          />
          <input
            className="w-full h-12 px-4 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-sm"
            type="password" required placeholder="Senha" autoComplete="current-password"
            value={senha} onChange={e => setSenha(e.target.value)}
          />
          <Button type="submit" size="lg" className="w-full" disabled={carregando}>
            {carregando ? 'Entrando…' : 'Entrar no painel'}
          </Button>
          <Link to="/esqueci-senha" className="block text-center text-sm text-zinc-400 hover:text-primary">
            Esqueci minha senha
          </Link>
        </form>
      </div>
    </div>
  );
}
