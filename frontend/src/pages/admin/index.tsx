import { useEffect, useState } from 'react';
import { lerRepasse2FA, destinoRepasse2FA } from '../../lib/repasse-2fa';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Store, ShoppingBag, TrendingUp, AlertCircle,
  Crown, ArrowRight, Shield, Clock,
  Mail, Lock, Eye, EyeOff, ScrollText, Wallet,
} from 'lucide-react';
import { AdminLayout } from './layout';
import { ContaDeOutroPerfil } from '@/components/conta-outro-perfil';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, sessaoUsuario, ehSuperAdmin, salvarSessao, desviouParaRevendedor } from '@/lib/api';
import { brl } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Portal2FA } from '@/components/duplo-fator';

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
  // Mesma armadilha do painel do lojista: conta de outro perfil fazia o login
  // inteiro (2FA incluso) e caía de volta no formulário, sem mensagem. Ver
  // components/conta-outro-perfil.tsx.
  if (u && u.perfil !== 'admin') {
    return <ContaDeOutroPerfil perfil={u.perfil} nome={u.nome}
      areaAtual="painel da plataforma" chaveSessao="admin" />;
  }
  if (!u) return <LoginAdmin />;
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
    <div className="space-y-6 max-w-5xl mx-auto">
      {/*
        HEADER SIMPLES no lugar do hero gradiente.

        O bloco escuro ocupava a primeira dobra inteira pra dizer "Olá" e repetir
        o papel que já está na sidebar. Numa tela de operação o topo é o espaço
        mais caro — quem abre o painel quer ver número, não saudação.
      */}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">
          Olá, {u?.nome?.split(' ')[0] ?? 'Admin'}
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
            {superAdmin ? 'Super Admin' : 'Operacional'}
          </span>
        </h1>
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
        </p>
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
          cor="bg-primary/10 text-primary"
        />
        <KpiCard
          titulo="Faturamento hoje"
          valor={consulta.isLoading ? '…' : brl(d?.faturamento_hoje_centavos ?? 0)}
          icone={<TrendingUp className="size-5" />}
          cor="bg-primary/10 text-primary"
        />
        <KpiCard
          titulo="Comissão gerada"
          valor={consulta.isLoading ? '…' : brl(d?.comissao_hoje_centavos ?? 0)}
          icone={<Crown className="size-5" />}
          cor="bg-primary/10 text-primary"
        />
        <KpiCard
          titulo="Em andamento"
          valor={consulta.isLoading ? '…' : String(d?.pedidos_em_andamento ?? 0)}
          icone={<Clock className="size-5" />}
          cor="bg-primary/10 text-primary"
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

      {/*
        "ACESSO RÁPIDO" REMOVIDO: eram sete cards repetindo, um a um, itens que
        já estão na sidebar — dois caminhos pro mesmo lugar, e o de baixo
        exigindo rolar a página. O único atalho que se justificava era o de loja
        pendente, e esse já existe acima como alerta âmbar, que só aparece
        quando há pendência de verdade.
      */}

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


function LoginAdmin() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [duploFator, setDuploFator] = useState<{ tokenPreAuth: string; modo: 'configurar' | 'verificar' } | null>(null);
  const { mostrar } = useToast();

  // Chegada vinda do login da plataforma: retoma o 2FA já no domínio do tenant
  // dono da conta (ver lib/repasse-2fa).
  useEffect(() => {
    const repasse = lerRepasse2FA();
    if (repasse) setDuploFator(repasse);
  }, []);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    try {
      const r = await api<
        | { token: string; usuario: any }
        | { precisa2fa: true; modo2fa: 'configurar' | 'verificar'; tokenPreAuth: string; redirecionar?: string | null }
      >('POST', '/api/auth/login', { email, senha });
      // Revendedor entra pela mesma tela e vai pro painel dele.
      if (desviouParaRevendedor(r)) return;
      if ('precisa2fa' in r) {
        // Admin de outra marca: o token de pré-autenticação é carimbado com
        // aquele tenant e seria recusado aqui — o 2FA termina no domínio de lá.
        const repasse = { tokenPreAuth: r.tokenPreAuth, modo: r.modo2fa };
        const destino = destinoRepasse2FA(r.redirecionar, '/painel-admin', repasse);
        if (destino) {
          window.location.assign(destino);
          return;
        }
        setDuploFator(repasse);
        return;
      }
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

  if (duploFator) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
        <Portal2FA
          tokenPreAuth={duploFator.tokenPreAuth}
          modo={duploFator.modo}
          onCancelar={() => setDuploFator(null)}
          onSucesso={(token, usuario) => { salvarSessao(token, usuario); window.location.reload(); }}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh bg-background">
      {/* Painel de marca. Usa bg-foreground/text-background (mesmo recurso da
          faixa de números da landing) em vez de zinc fixo: fica escuro no tema
          claro e claro no escuro, acompanhando a marca do cliente — a versão
          anterior tinha 13 cores zinc hardcoded e ignorava o white-label. */}
      <div className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-foreground p-10 text-background lg:flex xl:p-14">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-primary/20 blur-3xl" />

        <div className="relative flex items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Shield className="size-5" strokeWidth={2.5} />
          </div>
          <span className="text-lg font-extrabold">Painel Admin</span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-black leading-tight tracking-tight xl:text-4xl">
            A plataforma inteira, num lugar só.
          </h2>
          <ul className="mt-8 space-y-4">
            {[
              { icone: Store, texto: 'Lojas, planos e aprovações' },
              { icone: Wallet, texto: 'Comissão e repasses dos lojistas' },
              { icone: ScrollText, texto: 'Auditoria de tudo que foi alterado' },
            ].map(v => (
              <li key={v.texto} className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background/10">
                  <v.icone className="size-4" />
                </span>
                <span className="text-sm font-medium text-background/90">{v.texto}</span>
              </li>
            ))}
          </ul>

          <div className="mt-10 flex items-center gap-3 rounded-2xl bg-background/10 p-4">
            <Lock className="size-5 shrink-0 text-primary" />
            <div className="text-xs text-background/70">
              Área restrita. Todo acesso exige verificação em duas etapas e fica registrado na auditoria.
            </div>
          </div>
        </div>

        <div className="relative text-xs text-background/50">© {new Date().getFullYear()}</div>
      </div>

      {/* Formulário */}
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center lg:text-left">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/30 lg:hidden">
              <Shield className="size-7 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <h1 className="text-2xl font-extrabold">Entrar no painel</h1>
            <p className="mt-1 text-sm text-muted-foreground">Acesso restrito a administradores da plataforma.</p>
          </div>

          <form onSubmit={entrar} className="space-y-4">
            <div>
              <Label htmlFor="email-admin">E-mail</Label>
              <div className="relative mt-1.5">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email-admin" type="email" required autoComplete="email"
                  placeholder="voce@empresa.com.br" className="pl-9"
                  value={email} onChange={e => setEmail(e.target.value)}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="senha-admin">Senha</Label>
                <Link to="/esqueci-senha" className="text-xs font-semibold text-primary hover:underline">
                  Esqueci minha senha
                </Link>
              </div>
              <div className="relative mt-1.5">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="senha-admin" type={mostrarSenha ? 'text' : 'password'} required autoComplete="current-password"
                  placeholder="••••••••" className="pl-9 pr-10"
                  value={senha} onChange={e => setSenha(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenha(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={mostrarSenha ? 'Esconder senha' : 'Mostrar senha'}
                >
                  {mostrarSenha ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" size="lg" className="w-full" loading={carregando} loadingText="Entrando…">
              Entrar no painel
            </Button>
          </form>

          {/* Sem "manter conectado" aqui, ao contrário do painel do lojista:
              conta de admin é o alvo mais valioso da plataforma e sessão
              persistente em máquina compartilhada é risco desproporcional. */}
          <p className="mt-6 text-center text-xs text-muted-foreground lg:hidden">
            Área restrita. Todo acesso fica registrado na auditoria.
          </p>
        </div>
      </div>
    </div>
  );
}
