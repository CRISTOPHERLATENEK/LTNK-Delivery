/**
 * Painel do revendedor — mesma porta de entrada, recorte próprio.
 *
 * Ele entra pela tela de login de sempre e cai aqui, vendo só os clientes
 * dele. O recorte é feito no servidor (`WHERE revendedor_id` amarrado à
 * sessão), não aqui: esta tela é só a apresentação.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Handshake, Building2, Store, ShoppingBag, Power, LogOut, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Falha } from '@/components/ui/estado';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { ThemeToggle } from '@/components/theme-toggle';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError, encerrarSessao, tokenSessao, desviouParaRevendedor } from '@/lib/api';
import { brl } from '@/lib/format';

interface Eu {
  revendedor: { id: number; nome: string; email: string };
  clientes: number;
  clientes_ativos: number;
  custo_centavos: number;
  total_mes_centavos: number;
}

interface ClienteRev {
  id: number;
  nome: string;
  slug: string;
  dominio: string | null;
  ativo: 0 | 1;
  lojas: number;
  pedidos_mes: number;
  faturamento_mes_centavos: number;
}

export function PainelRevendedor() {
  // Sem sessão, a página é a porta de entrada — e não uma tela de erro 401.
  if (!tokenSessao('revendedor')) return <LoginRevendedor />;
  return <PainelInterno />;
}

function LoginRevendedor() {
  const { mostrar } = useToast();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<unknown>('POST', '/api/auth/login', { email, senha });
      if (desviouParaRevendedor(r)) return;
      // Credencial certa, mas de outro tipo de conta: dizer isso evita a
      // pessoa ficar tentando a mesma senha achando que errou.
      mostrar({ tipo: 'erro', titulo: 'Esta conta não é de revendedor.' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6">
          <div className="mb-5 flex items-center gap-2">
            <Handshake className="size-5 text-primary" />
            <h1 className="text-lg font-extrabold">Painel do revendedor</h1>
          </div>
          <form onSubmit={entrar} className="space-y-3">
            <div>
              <Label htmlFor="rev-login-email">E-mail</Label>
              <Input id="rev-login-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" />
            </div>
            <div>
              <Label htmlFor="rev-login-senha">Senha</Label>
              <Input id="rev-login-senha" type="password" required value={senha} onChange={e => setSenha(e.target.value)} autoComplete="current-password" />
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={enviando}>
              {enviando ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function PainelInterno() {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();

  const euQ = useQuery({
    queryKey: ['rev-eu'],
    queryFn: () => api<Eu>('GET', '/api/revendedor/eu'),
  });
  const clientesQ = useQuery({
    queryKey: ['rev-clientes'],
    queryFn: () => api<{ clientes: ClienteRev[] }>('GET', '/api/revendedor/clientes').then(r => r.clientes),
  });

  const eu = euQ.data;
  const clientes = clientesQ.data ?? [];

  async function alternar(c: ClienteRev) {
    const ok = await confirmar({
      titulo: c.ativo ? `Suspender ${c.nome}?` : `Reativar ${c.nome}?`,
      descricao: c.ativo
        // O aviso precisa ser explícito: quem clica aqui está tirando uma loja
        // do ar, e quem sente isso primeiro é o consumidor final dela.
        ? 'A loja sai do ar imediatamente. Quem tentar acessar vê um aviso de que está indisponível.'
        : 'A loja volta ao ar imediatamente.',
      confirmar: c.ativo ? 'Suspender' : 'Reativar',
      destrutivo: !!c.ativo,
    });
    if (!ok) return;
    try {
      await api('POST', `/api/revendedor/clientes/${c.id}/suspender`);
      mostrar({ tipo: 'sucesso', titulo: c.ativo ? 'Cliente suspenso.' : 'Cliente reativado.' });
      qc.invalidateQueries({ queryKey: ['rev-clientes'] });
      qc.invalidateQueries({ queryKey: ['rev-eu'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  function sair() {
    encerrarSessao();
    window.location.href = '/revenda';
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="flex h-14 items-center gap-3 border-b border-border bg-background px-4 sm:px-6">
        <Handshake className="size-5 text-primary" />
        <span className="font-bold">Revendedor</span>
        {eu && <span className="hidden text-sm text-muted-foreground sm:inline">· {eu.revendedor.nome}</span>}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={sair}><LogOut className="size-4" /> Sair</Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
        {euQ.isError && <Falha compacto erro={euQ.error} aoTentar={() => euQ.refetch()} />}

        {/* Resumo */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Kpi carregando={euQ.isLoading} valor={String(eu?.clientes_ativos ?? 0)} rotulo="Clientes ativos" />
          <Kpi carregando={euQ.isLoading} valor={brl(eu?.custo_centavos ?? 0)} rotulo="Por cliente" />
          <Kpi carregando={euQ.isLoading} valor={brl(eu?.total_mes_centavos ?? 0)} rotulo="Sua conta no mês" destaque />
        </div>

        {clientesQ.isLoading && (
          <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        )}
        {clientesQ.isError && <Falha compacto erro={clientesQ.error} aoTentar={() => clientesQ.refetch()} />}

        {!clientesQ.isLoading && clientes.length === 0 && !clientesQ.isError && (
          <Card><CardContent className="space-y-2 p-10 text-center text-muted-foreground">
            <Building2 className="mx-auto size-10 opacity-20" />
            <p className="font-medium">Nenhum cliente vinculado a você ainda</p>
          </CardContent></Card>
        )}

        <div className="space-y-2">
          {clientes.map(c => (
            <Card key={c.id} className={c.ativo ? '' : 'opacity-60'}>
              <CardContent className="flex flex-wrap items-center gap-4 p-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Building2 className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{c.nome}</span>
                    {c.ativo ? <Badge variant="success">ativo</Badge> : <Badge variant="secondary">suspenso</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Store className="size-3" /> {c.lojas} loja(s)</span>
                    <span className="flex items-center gap-1"><ShoppingBag className="size-3" /> {c.pedidos_mes} pedidos no mês</span>
                    {c.dominio && (
                      <a href={`https://${c.dominio}`} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 font-mono hover:text-primary">
                        <ExternalLink className="size-3" /> {c.dominio}
                      </a>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-extrabold tabular-nums">{brl(c.faturamento_mes_centavos)}</div>
                  <div className="text-[11px] text-muted-foreground">faturou no mês</div>
                </div>
                <Button variant="ghost" size="sm" className="shrink-0" onClick={() => alternar(c)}>
                  <Power className="size-4" /> {c.ativo ? 'Suspender' : 'Reativar'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/*
          O QUE ELE VÊ É FATURAMENTO DA LOJA, não o dele. Sem esta linha, os
          números grandes ao lado de "Sua conta no mês" se confundem — e o
          revendedor acha que vai receber o faturamento do cliente.
        */}
        {clientes.length > 0 && (
          <p className="px-1 text-xs text-muted-foreground">
            O valor de cada cliente é o que a loja dele faturou no mês, não o seu ganho.
            Sua conta é {brl(eu?.custo_centavos ?? 0)} por cliente ativo.
          </p>
        )}
      </main>
    </div>
  );
}

function Kpi({ valor, rotulo, destaque, carregando }: {
  valor: string; rotulo: string; destaque?: boolean; carregando?: boolean;
}) {
  return (
    <Card className={destaque ? 'border-primary/40' : ''}>
      <CardContent className="p-4">
        {carregando
          ? <Skeleton className="h-7 w-20" />
          : <div className={`text-xl font-extrabold tabular-nums ${destaque ? 'text-primary' : ''}`}>{valor}</div>}
        <div className="mt-0.5 text-xs text-muted-foreground">{rotulo}</div>
      </CardContent>
    </Card>
  );
}
