/**
 * Painel do revendedor — mesma porta de entrada, recorte próprio.
 *
 * Ele entra pela tela de login de sempre e cai aqui, vendo só os clientes
 * dele. O recorte é feito no servidor (`WHERE revendedor_id` amarrado à
 * sessão), não aqui: esta tela é só a apresentação.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Handshake, Building2, Store, ShoppingBag, Power, LogOut, ExternalLink, Plus, X, Boxes,
  Search, Trash2, Receipt, User, Users, AlertTriangle, ChevronRight, Ban,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Falha } from '@/components/ui/estado';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { ThemeToggle } from '@/components/theme-toggle';
import { DrawerDetalhe } from '@/components/ui/drawer-detalhe';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError, encerrarSessao, tokenSessao, desviouParaRevendedor } from '@/lib/api';
import { brl, dataLocal } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Eu {
  revendedor: { id: number; nome: string; email: string; telefone: string };
  novidades: { aprovadas: number; recusadas: number; pendentes: number };
  clientes: number;
  clientes_ativos: number;
  custo_centavos: number;
  mensalidades_centavos: number;
  modulos_centavos: number;
  total_centavos: number;
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
  modulos_centavos: number;
  modulos_nomes: string;
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

interface Solicitacao {
  id: number;
  tipo: 'cadastro' | 'exclusao';
  tenant_id: number | null;
  nome: string; slug: string; nome_loja: string;
  dono_nome: string; dono_email: string;
  status: 'pendente' | 'aprovada' | 'recusada';
  motivo_pedido: string | null;
  motivo_recusa: string | null;
  criado_em: string;
}

interface LinhaFatura {
  tenant_id: number; nome: string; ativo: boolean;
  mensalidade_centavos: number;
  modulos: Array<{ nome: string; preco_centavos: number }>;
  modulos_centavos: number;
  total_centavos: number;
}

interface Fatura {
  competencia: string;
  clientes_ativos: number;
  mensalidades_centavos: number;
  modulos_centavos: number;
  total_centavos: number;
  linhas: LinhaFatura[];
}

interface FaturaFechada {
  competencia: string;
  clientes_ativos: number;
  mensalidades_centavos: number;
  modulos_centavos: number;
  total_centavos: number;
  detalhe: LinhaFatura[];
  fechada_em: string;
}

const FORM_SOLIC = { nome: '', slug: '', nome_loja: '', categoria: 'Outros', dono_nome: '', email: '', telefone: '', senha: '' };

type Aba = 'clientes' | 'fatura' | 'solicitacoes' | 'conta';

function PainelInterno() {
  const [aba, setAba] = useState<Aba>('clientes');
  const qc = useQueryClient();

  const euQ = useQuery({
    queryKey: ['rev-eu'],
    queryFn: () => api<Eu>('GET', '/api/revendedor/eu'),
  });
  const eu = euQ.data;

  /*
   * Decisões que ele ainda não viu. O aviso é dado UMA vez e some ao abrir a
   * aba: antes, uma recusa só era descoberta por quem tivesse o hábito de
   * conferir a lista — e um pedido recusado sem leitura volta igual dias depois.
   */
  const naoVistas = (eu?.novidades.aprovadas ?? 0) + (eu?.novidades.recusadas ?? 0);
  async function abrirSolicitacoes() {
    setAba('solicitacoes');
    if (naoVistas > 0) {
      try {
        await api('POST', '/api/revendedor/solicitacoes/vistas');
        qc.invalidateQueries({ queryKey: ['rev-eu'] });
      } catch { /* o aviso a mais na próxima carga não atrapalha ninguém */ }
    }
  }

  function sair() {
    encerrarSessao();
    window.location.href = '/revenda';
  }

  const abas: Array<{ chave: Aba; rotulo: string; alerta?: number }> = [
    { chave: 'clientes', rotulo: 'Clientes' },
    { chave: 'fatura', rotulo: 'Minha fatura' },
    { chave: 'solicitacoes', rotulo: 'Solicitações', alerta: naoVistas + (eu?.novidades.pendentes ?? 0) },
    { chave: 'conta', rotulo: 'Minha conta' },
  ];

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

        {naoVistas > 0 && aba !== 'solicitacoes' && (
          <button
            type="button"
            onClick={abrirSolicitacoes}
            className="flex w-full items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-left text-sm"
          >
            <AlertTriangle className="size-4 shrink-0 text-amber-600" />
            <span className="flex-1">
              {eu!.novidades.aprovadas > 0 && <>{eu!.novidades.aprovadas} pedido(s) aprovado(s). </>}
              {eu!.novidades.recusadas > 0 && <>{eu!.novidades.recusadas} recusado(s) — veja o motivo.</>}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </button>
        )}

        <div className="flex gap-1 overflow-x-auto border-b border-border">
          {abas.map(t => (
            <button
              key={t.chave}
              type="button"
              onClick={() => (t.chave === 'solicitacoes' ? abrirSolicitacoes() : setAba(t.chave))}
              className={cn('relative -mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold transition-colors',
                aba === t.chave ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              {t.rotulo}
              {!!t.alerta && t.alerta > 0 && <span className="size-2 rounded-full bg-amber-500" />}
            </button>
          ))}
        </div>

        {aba === 'clientes' && <AbaClientes eu={eu} />}
        {aba === 'fatura' && <AbaFatura />}
        {aba === 'solicitacoes' && <AbaSolicitacoes />}
        {/*
          A aba de conta nasce com os dados já carregados (o formulário guarda
          o valor inicial no estado). Montar antes deixaria os campos vazios
          para sempre, com o nome certo logo ali no topo da tela.
        */}
        {aba === 'conta' && (eu ? <AbaConta eu={eu} /> : <Skeleton className="h-64 rounded-xl" />)}
      </main>
    </div>
  );
}

/* ─────────────────────────────── Clientes ─────────────────────────────── */

function AbaClientes({ eu }: { eu?: Eu }) {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'ativos' | 'suspensos'>('todos');
  const [aberto, setAberto] = useState<ClienteRev | null>(null);

  const clientesQ = useQuery({
    queryKey: ['rev-clientes'],
    queryFn: () => api<{ clientes: ClienteRev[] }>('GET', '/api/revendedor/clientes').then(r => r.clientes),
  });
  // O `?? []` precisa ser memoizado: um array novo a cada render invalidaria o
  // useMemo do filtro sempre, e a lista seria refiltrada à toa a cada tecla.
  const clientes = useMemo(() => clientesQ.data ?? [], [clientesQ.data]);

  /*
   * Busca por nome, identificador E domínio: quando o revendedor recebe uma
   * reclamação, o que ele tem na mão é o endereço da loja, não o nome que
   * cadastrou aqui.
   */
  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return clientes.filter(c => {
      if (filtro === 'ativos' && !c.ativo) return false;
      if (filtro === 'suspensos' && c.ativo) return false;
      if (!t) return true;
      return c.nome.toLowerCase().includes(t)
        || c.slug.toLowerCase().includes(t)
        || (c.dominio || '').toLowerCase().includes(t);
    });
  }, [clientes, busca, filtro]);

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
      qc.invalidateQueries({ queryKey: ['rev-cliente', c.id] });
      setAberto(a => (a && a.id === c.id ? { ...a, ativo: a.ativo ? 0 : 1 } : a));
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, identificador ou domínio"
            className="h-10 pl-9"
          />
        </div>
        <div className="flex gap-1">
          {([
            { chave: 'todos' as const, rotulo: `Todos (${clientes.length})` },
            { chave: 'ativos' as const, rotulo: `Ativos (${clientes.filter(c => c.ativo).length})` },
            { chave: 'suspensos' as const, rotulo: `Suspensos (${clientes.filter(c => !c.ativo).length})` },
          ]).map(f => (
            <button
              key={f.chave}
              type="button"
              onClick={() => setFiltro(f.chave)}
              className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                filtro === f.chave ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
      </div>

      {clientesQ.isLoading && (
        <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      )}
      {clientesQ.isError && <Falha compacto erro={clientesQ.error} aoTentar={() => clientesQ.refetch()} />}

      {!clientesQ.isLoading && clientes.length === 0 && !clientesQ.isError && (
        <Card><CardContent className="space-y-2 p-10 text-center text-muted-foreground">
          <Building2 className="mx-auto size-10 opacity-20" />
          <p className="font-medium">Nenhum cliente vinculado a você ainda</p>
          <p className="text-sm">Peça o primeiro na aba Solicitações.</p>
        </CardContent></Card>
      )}

      {!clientesQ.isLoading && clientes.length > 0 && filtrados.length === 0 && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          Nenhum cliente com esse filtro.
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {filtrados.map(c => (
          <Card key={c.id} className={c.ativo ? '' : 'opacity-60'}>
            <CardContent className="flex flex-wrap items-center gap-4 p-4">
              {/* O cartão inteiro abre o detalhe. Os botões de ação ficam fora
                  desse alvo pra um clique em "Suspender" não abrir o drawer
                  junto. */}
              <button
                type="button"
                onClick={() => setAberto(c)}
                className="flex min-w-0 flex-1 items-center gap-4 text-left"
              >
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
                    {/* O que ele paga a mais POR ESTE cliente. Sem isso, o
                        total do mês some e ele não tem como conferir de onde
                        veio. */}
                    {c.modulos_centavos > 0 && (
                      <span className="flex items-center gap-1" title={c.modulos_nomes}>
                        <Boxes className="size-3" /> {brl(c.modulos_centavos)} em módulos
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-extrabold tabular-nums">{brl(c.faturamento_mes_centavos)}</div>
                  <div className="text-[11px] text-muted-foreground">faturou no mês</div>
                </div>
              </button>
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
          Sua conta é {brl(eu?.custo_centavos ?? 0)} por cliente ativo
          {(eu?.modulos_centavos ?? 0) > 0 && <>, mais {brl(eu!.modulos_centavos)} de módulos</>}.
        </p>
      )}

      {aberto && (
        <DrawerCliente
          cliente={aberto}
          aoFechar={() => setAberto(null)}
          aoAlternar={() => alternar(aberto)}
        />
      )}
    </div>
  );
}

interface DetalheCliente {
  cliente: { id: number; nome: string; slug: string; dominio: string | null; ativo: 0 | 1; criado_em: string };
  modulos: Array<{ nome: string; preco_centavos: number; criado_em: string }>;
  modulos_centavos: number;
  lojas: Array<{ id: number; nome: string; slug: string; ativa: 0 | 1 }>;
  usuarios: number;
  pedidos_mes: number;
  faturamento_mes_centavos: number;
  ticket_medio_centavos: number;
  banco_ok: boolean;
  exclusao_pendente: { id: number; criado_em: string } | null;
}

function DrawerCliente({ cliente, aoFechar, aoAlternar }: {
  cliente: ClienteRev; aoFechar: () => void; aoAlternar: () => void;
}) {
  const { mostrar } = useToast();
  const qc = useQueryClient();
  const [pedindoExclusao, setPedindoExclusao] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  const q = useQuery({
    queryKey: ['rev-cliente', cliente.id],
    queryFn: () => api<DetalheCliente>('GET', `/api/revendedor/clientes/${cliente.id}`),
  });
  const d = q.data;
  const url = cliente.dominio ? `https://${cliente.dominio}` : `https://${cliente.slug}.maxxpedidos.com.br`;

  async function pedirExclusao() {
    setEnviando(true);
    try {
      await api('POST', `/api/revendedor/clientes/${cliente.id}/exclusao`, { motivo });
      mostrar({
        tipo: 'sucesso',
        titulo: 'Pedido enviado.',
        descricao: 'O cliente só é apagado depois que a plataforma aprovar.',
      });
      setPedindoExclusao(false);
      setMotivo('');
      qc.invalidateQueries({ queryKey: ['rev-cliente', cliente.id] });
      qc.invalidateQueries({ queryKey: ['rev-solicitacoes'] });
      qc.invalidateQueries({ queryKey: ['rev-eu'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <DrawerDetalhe
      aberto
      aoFechar={aoFechar}
      titulo={cliente.nome}
      subtitulo={<>
        <span className="font-mono text-xs">{cliente.slug}</span>
        {cliente.ativo ? <Badge variant="success">ativo</Badge> : <Badge variant="secondary">suspenso</Badge>}
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs hover:text-primary">
          <ExternalLink className="size-3" /> abrir loja
        </a>
      </>}
      rodape={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={aoAlternar}>
            <Power className="size-4" /> {cliente.ativo ? 'Suspender' : 'Reativar'}
          </Button>
          {!d?.exclusao_pendente && !pedindoExclusao && (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
              onClick={() => setPedindoExclusao(true)}>
              <Trash2 className="size-4" /> Pedir exclusão
            </Button>
          )}
        </div>
      }
    >
      {q.isLoading && <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>}
      {q.isError && <Falha compacto erro={q.error} aoTentar={() => q.refetch()} />}

      {d && (
        <div className="space-y-5">
          {!d.banco_ok && (
            <p className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
              <AlertTriangle className="size-4 shrink-0 text-amber-600" />
              Não consegui ler o banco deste cliente agora. Os números abaixo podem estar zerados.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Mini valor={String(d.lojas.length)} rotulo="lojas" />
            <Mini valor={String(d.pedidos_mes)} rotulo="pedidos no mês" />
            <Mini valor={brl(d.faturamento_mes_centavos)} rotulo="faturou no mês" />
            <Mini valor={brl(d.ticket_medio_centavos)} rotulo="ticket médio" />
          </div>

          <Bloco titulo="Lojas" icone={Store}>
            {d.lojas.length === 0
              ? <p className="text-sm text-muted-foreground">Nenhuma loja cadastrada.</p>
              : (
                <ul className="space-y-1.5">
                  {d.lojas.map(l => (
                    <li key={l.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate">{l.nome}</span>
                      {!l.ativa && <Badge variant="secondary">inativa</Badge>}
                      <span className="font-mono text-xs text-muted-foreground">{l.slug}</span>
                    </li>
                  ))}
                </ul>
              )}
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="size-3" /> {d.usuarios} usuário(s) com acesso ao painel
            </p>
          </Bloco>

          {/*
            O QUANTO CADA MÓDULO CUSTA, e não só o total. É a resposta pra "por
            que minha conta subiu": o preço é o COPIADO na hora em que o módulo
            foi ligado, então pode diferir do preço de tabela de hoje.
          */}
          <Bloco titulo="Módulos cobrados neste cliente" icone={Boxes}>
            {d.modulos.length === 0
              ? <p className="text-sm text-muted-foreground">Nenhum módulo. Você paga só a mensalidade por ele.</p>
              : (
                <>
                  <ul className="space-y-1.5">
                    {d.modulos.map(m => (
                      <li key={m.nome} className="flex items-center gap-2 text-sm">
                        <span className="flex-1 truncate">{m.nome}</span>
                        <span className="font-semibold tabular-nums">{brl(m.preco_centavos)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm">
                    <span className="text-muted-foreground">Total de módulos</span>
                    <span className="font-extrabold tabular-nums">{brl(d.modulos_centavos)}</span>
                  </div>
                </>
              )}
            <p className="mt-2 text-xs text-muted-foreground">
              Quem liga e desliga módulo é a plataforma. Isto aqui é o que entra na sua conta.
            </p>
          </Bloco>

          <Bloco titulo="Cadastro" icone={Building2}>
            <dl className="space-y-1.5 text-sm">
              <Linha rotulo="Identificador" valor={<span className="font-mono">{d.cliente.slug}</span>} />
              <Linha rotulo="Domínio" valor={d.cliente.dominio || <span className="text-muted-foreground">endereço padrão</span>} />
              <Linha rotulo="Cliente desde" valor={dataLocal(d.cliente.criado_em)} />
            </dl>
          </Bloco>

          {d.exclusao_pendente && (
            <p className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
              <Ban className="size-4 shrink-0 text-destructive" />
              Exclusão pedida em {dataLocal(d.exclusao_pendente.criado_em)} — aguardando a plataforma aprovar.
            </p>
          )}

          {pedindoExclusao && (
            <div className="space-y-2 rounded-xl border border-destructive/40 p-3">
              <p className="text-sm font-semibold text-destructive">Pedir exclusão deste cliente</p>
              <p className="text-xs text-muted-foreground">
                Se for aprovado, o banco inteiro dele é apagado — pedidos, produtos, histórico. Não tem volta.
                Se a ideia é só tirar do ar, use <b>Suspender</b>: dá pra reverter a qualquer momento.
              </p>
              <div>
                <Label htmlFor="motivo-exc">Motivo (quem aprova vai ler)</Label>
                <Textarea id="motivo-exc" rows={3} maxLength={300} value={motivo}
                  onChange={e => setMotivo(e.target.value)}
                  placeholder="Ex.: cliente encerrou as atividades e pediu o cancelamento." />
              </div>
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" disabled={enviando || motivo.trim().length < 3} onClick={pedirExclusao}>
                  {enviando ? 'Enviando…' : 'Enviar pedido'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setPedindoExclusao(false); setMotivo(''); }}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </DrawerDetalhe>
  );
}

/* ──────────────────────────────── Fatura ──────────────────────────────── */

function AbaFatura() {
  const atualQ = useQuery({
    queryKey: ['rev-fatura'],
    queryFn: () => api<Fatura>('GET', '/api/revendedor/fatura'),
  });
  const histQ = useQuery({
    queryKey: ['rev-faturas'],
    queryFn: () => api<{ faturas: FaturaFechada[] }>('GET', '/api/revendedor/faturas').then(r => r.faturas),
  });
  const f = atualQ.data;
  const historico = histQ.data ?? [];

  return (
    <div className="space-y-4">
      {atualQ.isLoading && <Skeleton className="h-40 rounded-xl" />}
      {atualQ.isError && <Falha compacto erro={atualQ.error} aoTentar={() => atualQ.refetch()} />}

      {f && (
        <Card>
          <CardContent className="p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 font-bold"><Receipt className="size-4 text-primary" /> {mesPorExtenso(f.competencia)}</h2>
                <p className="text-xs text-muted-foreground">
                  {f.clientes_ativos} cliente(s) ativo(s) · mensalidade {brl(f.mensalidades_centavos)} · módulos {brl(f.modulos_centavos)}
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-extrabold tabular-nums text-primary">{brl(f.total_centavos)}</div>
                <div className="text-[11px] text-muted-foreground">parcial do mês</div>
              </div>
            </div>

            <LinhasFatura linhas={f.linhas} />

            {/* Parcial, e dito com todas as letras: cliente ligado no dia 20
                muda este número, e quem lê precisa saber que ainda vai mudar. */}
            <p className="mt-3 text-xs text-muted-foreground">
              Valor parcial: muda se entrar cliente novo, alguém for suspenso ou um módulo for ligado até o fim do mês.
            </p>
          </CardContent>
        </Card>
      )}

      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Meses anteriores</h3>
        {histQ.isLoading && <Skeleton className="h-20 rounded-xl" />}
        {!histQ.isLoading && historico.length === 0 && (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
            Ainda não há mês fechado. O primeiro aparece aqui na virada do mês.
          </CardContent></Card>
        )}
        <div className="space-y-2">
          {historico.map(h => <FaturaFechadaItem key={h.competencia} fatura={h} />)}
        </div>
      </div>
    </div>
  );
}

function FaturaFechadaItem({ fatura }: { fatura: FaturaFechada }) {
  const [aberta, setAberta] = useState(false);
  return (
    <Card>
      <CardContent className="p-4">
        <button type="button" onClick={() => setAberta(v => !v)} className="flex w-full items-center gap-3 text-left">
          <div className="min-w-0 flex-1">
            <span className="font-semibold">{mesPorExtenso(fatura.competencia)}</span>
            <p className="text-xs text-muted-foreground">
              {fatura.clientes_ativos} cliente(s) · mensalidade {brl(fatura.mensalidades_centavos)} · módulos {brl(fatura.modulos_centavos)}
            </p>
          </div>
          <span className="shrink-0 text-lg font-extrabold tabular-nums">{brl(fatura.total_centavos)}</span>
          <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', aberta && 'rotate-90')} />
        </button>
        {aberta && (
          <div className="mt-3 border-t border-border pt-3">
            <LinhasFatura linhas={fatura.detalhe} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LinhasFatura({ linhas }: { linhas: LinhaFatura[] }) {
  if (!linhas || linhas.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum cliente nesta competência.</p>;
  }
  return (
    <div className="space-y-1.5">
      {linhas.map(l => (
        <div key={l.tenant_id} className={cn('flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-sm', !l.ativo && 'opacity-60')}>
          <span className="min-w-0 flex-1 truncate">
            {l.nome}
            {!l.ativo && <span className="ml-2 text-xs text-muted-foreground">suspenso — não cobrado</span>}
          </span>
          <span className="text-xs text-muted-foreground">
            {brl(l.mensalidade_centavos)}
            {l.modulos_centavos > 0 && <> + {brl(l.modulos_centavos)} ({l.modulos.map(m => m.nome).join(', ')})</>}
          </span>
          <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{brl(l.total_centavos)}</span>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── Solicitações ───────────────────────────── */

function AbaSolicitacoes() {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();
  const [pedindo, setPedindo] = useState(false);

  const solicQ = useQuery({
    queryKey: ['rev-solicitacoes'],
    queryFn: () => api<{ solicitacoes: Solicitacao[] }>('GET', '/api/revendedor/solicitacoes').then(r => r.solicitacoes),
  });
  const solicitacoes = solicQ.data ?? [];

  async function cancelar(s: Solicitacao) {
    const ok = await confirmar({
      titulo: 'Cancelar este pedido?',
      descricao: s.tipo === 'exclusao'
        ? 'O cliente continua como está. Você pode pedir a exclusão de novo depois.'
        : 'O pedido sai da fila da plataforma. Nada foi criado, então não há o que desfazer.',
      confirmar: 'Cancelar pedido',
      destrutivo: true,
    });
    if (!ok) return;
    try {
      await api('DELETE', `/api/revendedor/solicitacoes/${s.id}`);
      mostrar({ tipo: 'sucesso', titulo: 'Pedido cancelado.' });
      qc.invalidateQueries({ queryKey: ['rev-solicitacoes'] });
      qc.invalidateQueries({ queryKey: ['rev-eu'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Nada aqui existe até a plataforma aprovar.</p>
        <Button size="sm" onClick={() => setPedindo(v => !v)}>
          <Plus className="size-4" /> Pedir cliente novo
        </Button>
      </div>

      {pedindo && (
        <FormSolicitacao
          onFechar={() => setPedindo(false)}
          onEnviado={() => {
            setPedindo(false);
            qc.invalidateQueries({ queryKey: ['rev-solicitacoes'] });
            qc.invalidateQueries({ queryKey: ['rev-eu'] });
          }}
        />
      )}

      {solicQ.isLoading && <Skeleton className="h-24 rounded-xl" />}
      {solicQ.isError && <Falha compacto erro={solicQ.error} aoTentar={() => solicQ.refetch()} />}

      {!solicQ.isLoading && solicitacoes.length === 0 && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          Nenhuma solicitação ainda.
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {solicitacoes.map(sol => (
          <Card key={sol.id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                {sol.tipo === 'exclusao' && <Badge variant="danger">exclusão</Badge>}
                <span className="font-semibold">{sol.nome}</span>
                <span className="font-mono text-xs text-muted-foreground">{sol.slug}</span>
                {sol.status === 'pendente' && <Badge variant="warning">aguardando aprovação</Badge>}
                {sol.status === 'aprovada' && <Badge variant="success">aprovada</Badge>}
                {sol.status === 'recusada' && <Badge variant="danger">recusada</Badge>}
                <span className="ml-auto text-xs text-muted-foreground">{dataLocal(sol.criado_em)}</span>
              </div>

              {sol.tipo === 'exclusao' && sol.motivo_pedido && (
                <p className="mt-1.5 text-xs text-muted-foreground">Seu motivo: {sol.motivo_pedido}</p>
              )}

              {/* O motivo da recusa é o que evita o revendedor reenviar o
                  mesmo pedido sem saber o que mudar. */}
              {sol.status === 'recusada' && sol.motivo_recusa && (
                <p className="mt-1.5 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                  {sol.motivo_recusa}
                </p>
              )}

              {sol.status === 'pendente' && (
                <Button variant="ghost" size="sm" className="mt-2 text-muted-foreground" onClick={() => cancelar(sol)}>
                  <X className="size-3.5" /> Cancelar pedido
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────── Minha conta ──────────────────────────── */

function AbaConta({ eu }: { eu: Eu }) {
  const { mostrar } = useToast();
  const qc = useQueryClient();
  const [perfil, setPerfil] = useState({ nome: eu.revendedor.nome, telefone: eu.revendedor.telefone ?? '' });
  const [senha, setSenha] = useState({ atual: '', nova: '', repetir: '' });
  const [salvando, setSalvando] = useState(false);
  const [trocando, setTrocando] = useState(false);

  async function salvarPerfil(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      await api('PUT', '/api/revendedor/perfil', perfil);
      mostrar({ tipo: 'sucesso', titulo: 'Dados salvos.' });
      qc.invalidateQueries({ queryKey: ['rev-eu'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setSalvando(false);
    }
  }

  async function trocarSenha(e: React.FormEvent) {
    e.preventDefault();
    // A conferência é feita aqui porque o servidor não tem como saber que a
    // pessoa errou ao digitar a nova senha duas vezes diferentes.
    if (senha.nova !== senha.repetir) {
      mostrar({ tipo: 'erro', titulo: 'A nova senha e a repetição não são iguais.' });
      return;
    }
    setTrocando(true);
    try {
      await api('PUT', '/api/revendedor/senha', { atual: senha.atual, nova: senha.nova });
      mostrar({ tipo: 'sucesso', titulo: 'Senha alterada.' });
      setSenha({ atual: '', nova: '', repetir: '' });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setTrocando(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5">
          <h3 className="mb-3 flex items-center gap-2 font-bold"><User className="size-4 text-primary" /> Meus dados</h3>
          <form onSubmit={salvarPerfil} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="rev-nome">Nome</Label>
                <Input id="rev-nome" required value={perfil.nome} onChange={e => setPerfil(p => ({ ...p, nome: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="rev-tel">Telefone</Label>
                <Input id="rev-tel" value={perfil.telefone} onChange={e => setPerfil(p => ({ ...p, telefone: e.target.value }))} />
              </div>
            </div>
            {/* E-mail é o login. Trocar login é outra operação, com outros
                riscos (perder o acesso), então continua com a plataforma. */}
            <p className="text-xs text-muted-foreground">
              E-mail de acesso: <span className="font-mono">{eu?.revendedor.email}</span> — para trocar, fale com a plataforma.
            </p>
            <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <h3 className="mb-3 font-bold">Trocar senha</h3>
          <form onSubmit={trocarSenha} className="space-y-3">
            <div>
              <Label htmlFor="rev-atual">Senha atual</Label>
              <Input id="rev-atual" type="password" required autoComplete="current-password"
                value={senha.atual} onChange={e => setSenha(s => ({ ...s, atual: e.target.value }))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="rev-nova">Nova senha (mín. 6)</Label>
                <Input id="rev-nova" type="password" required minLength={6} autoComplete="new-password"
                  value={senha.nova} onChange={e => setSenha(s => ({ ...s, nova: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="rev-rep">Repetir a nova senha</Label>
                <Input id="rev-rep" type="password" required minLength={6} autoComplete="new-password"
                  value={senha.repetir} onChange={e => setSenha(s => ({ ...s, repetir: e.target.value }))} />
              </div>
            </div>
            <Button type="submit" disabled={trocando}>{trocando ? 'Trocando…' : 'Trocar senha'}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────────────────────── Peças ──────────────────────────────── */

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

function Mini({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="text-base font-extrabold tabular-nums">{valor}</div>
      <div className="text-[11px] text-muted-foreground">{rotulo}</div>
    </div>
  );
}

function Bloco({ titulo, icone: Icone, children }: {
  titulo: string; icone: typeof Store; children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <Icone className="size-3.5" /> {titulo}
      </h4>
      {children}
    </section>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-32 shrink-0 text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 flex-1 truncate">{valor}</dd>
    </div>
  );
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** '2026-07' → 'julho de 2026'. Competência inválida volta como veio. */
function mesPorExtenso(competencia: string): string {
  const [ano, mes] = String(competencia || '').split('-').map(Number);
  const nome = MESES[(mes || 0) - 1];
  return nome ? `${nome} de ${ano}` : String(competencia);
}

/** Formulário do pedido de cliente novo. */
function FormSolicitacao({ onFechar, onEnviado }: { onFechar: () => void; onEnviado: () => void }) {
  const { mostrar } = useToast();
  const [form, setForm] = useState(FORM_SOLIC);
  const [enviando, setEnviando] = useState(false);

  const campo = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  /*
   * O SLUG É O ENDEREÇO do cliente, então é sugerido a partir do nome em vez
   * de deixado em branco: quem preenche não tem como saber que aquele campo
   * vira `nome.maxxpedidos.com.br`. Continua editável.
   */
  function mudarNome(e: React.ChangeEvent<HTMLInputElement>) {
    const nome = e.target.value;
    setForm(f => ({
      ...f,
      nome,
      slug: f.slug === sugerirSlug(f.nome) ? sugerirSlug(nome) : f.slug,
    }));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('POST', '/api/revendedor/solicitacoes', form);
      mostrar({
        tipo: 'sucesso',
        titulo: 'Pedido enviado.',
        descricao: 'O cliente é criado assim que a plataforma aprovar.',
      });
      onEnviado();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-bold">Pedir cliente novo</h3>
          <Button variant="ghost" size="sm" onClick={onFechar}><X className="size-4" /></Button>
        </div>
        <form onSubmit={enviar} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="s-nome">Nome do cliente</Label>
              <Input id="s-nome" required value={form.nome} onChange={mudarNome} />
            </div>
            <div>
              <Label htmlFor="s-slug">Identificador (endereço)</Label>
              <Input id="s-slug" required value={form.slug} onChange={campo('slug')} className="font-mono" />
              <p className="mt-1 text-xs text-muted-foreground">
                Vira o endereço: <span className="font-mono">{form.slug || 'nome'}.maxxpedidos.com.br</span>
              </p>
            </div>
            <div>
              <Label htmlFor="s-loja">Nome da loja</Label>
              <Input id="s-loja" value={form.nome_loja} onChange={campo('nome_loja')} placeholder="Igual ao nome do cliente" />
            </div>
            <div>
              <Label htmlFor="s-cat">Categoria</Label>
              <Input id="s-cat" value={form.categoria} onChange={campo('categoria')} />
            </div>
            <div>
              <Label htmlFor="s-dono">Responsável</Label>
              <Input id="s-dono" required value={form.dono_nome} onChange={campo('dono_nome')} />
            </div>
            <div>
              <Label htmlFor="s-email">E-mail do responsável</Label>
              <Input id="s-email" type="email" required value={form.email} onChange={campo('email')} />
            </div>
            <div>
              <Label htmlFor="s-tel">Telefone</Label>
              <Input id="s-tel" value={form.telefone} onChange={campo('telefone')} />
            </div>
            <div>
              <Label htmlFor="s-senha">Senha de acesso (mín. 6)</Label>
              <Input id="s-senha" type="password" required minLength={6} value={form.senha} onChange={campo('senha')} autoComplete="new-password" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Nada é criado agora. O cliente passa por aprovação da plataforma antes de existir.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar pedido'}</Button>
            <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Mesma normalização do servidor: minúsculo, sem acento, hífen no lugar do resto. */
function sugerirSlug(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
