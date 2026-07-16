import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Store, Users, ShoppingBag, TrendingUp,
  ChevronDown, ChevronUp, Plus, Mail, Phone, Search, Lock, Unlock, Pencil, X, KeyRound,
} from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError } from '@/lib/api';
import { brl, dataLocal } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Lojista {
  id: number;
  loja_nome: string;
  status_aprovacao: string;
  aberta: 0 | 1;
  logo_url: string;
  categoria: string;
  loja_criada_em: string;
  usuario_id: number;
  dono_nome: string;
  dono_email: string;
  dono_telefone: string;
  dono_bloqueado: 0 | 1;
  total_pedidos: number;
  faturamento_centavos: number;
  total_clientes: number;
}

interface Cliente {
  id: number;
  nome: string;
  email: string;
  telefone: string;
  bloqueado: 0 | 1;
  criado_em: string;
}

export function TelaLojistas() {
  const [expandido, setExpandido] = useState<number | null>(null);
  const [busca, setBusca] = useState('');

  const consulta = useQuery({
    queryKey: ['admin-lojistas'],
    queryFn: () => api<{ lojistas: Lojista[] }>('GET', '/api/admin/lojistas').then(r => r.lojistas),
  });

  const lista = (consulta.data ?? []).filter(l =>
    !busca ||
    l.loja_nome.toLowerCase().includes(busca.toLowerCase()) ||
    l.dono_nome.toLowerCase().includes(busca.toLowerCase()) ||
    l.dono_email.toLowerCase().includes(busca.toLowerCase())
  );

  return (
    <AdminLayout titulo="Lojistas">
      <div className="space-y-5 max-w-4xl mx-auto">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-extrabold flex items-center gap-2">
              <Store className="size-6 text-primary" /> Lojistas
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {consulta.data?.length ?? 0} lojistas · clientes e pedidos de cada loja
            </p>
          </div>
          <Button asChild>
            <Link to="/painel-admin/lojas"><Plus className="size-4" /> Nova loja</Link>
          </Button>
        </div>

        {/* O cadastro do lojista é feito junto com a loja (sempre vinculado). */}
        <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          <Store className="size-4 text-primary shrink-0 mt-0.5" />
          <span className="text-muted-foreground">
            O acesso do lojista é criado <b className="text-foreground">dentro do cadastro da loja</b>, em{' '}
            <Link to="/painel-admin/lojas" className="text-primary font-semibold hover:underline">Lojas → Nova loja</Link>.
            Assim a conta fica sempre vinculada à loja certa.
          </span>
        </div>

        {/* Busca */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, dono ou e-mail…"
            className="w-full h-10 pl-10 pr-4 rounded-xl border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>

        {consulta.isLoading && (
          <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
        )}

        <div className="space-y-3">
          {lista.map(l => (
            <CardLojista
              key={l.id}
              lojista={l}
              expandido={expandido === l.id}
              onToggle={() => setExpandido(expandido === l.id ? null : l.id)}
            />
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}

function CardLojista({ lojista: l, expandido, onToggle }: {
  lojista: Lojista;
  expandido: boolean;
  onToggle: () => void;
}) {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();
  const [criandoCliente, setCriandoCliente] = useState(false);
  const [editandoCliente, setEditandoCliente] = useState<Cliente | null>(null);

  const clientesQ = useQuery({
    queryKey: ['admin-clientes', l.id],
    queryFn: () => api<{ clientes: Cliente[] }>('GET', `/api/admin/lojistas/${l.id}/clientes`).then(r => r.clientes),
    enabled: expandido,
  });

  function aoSalvarCliente() {
    setCriandoCliente(false);
    setEditandoCliente(null);
    qc.invalidateQueries({ queryKey: ['admin-clientes', l.id] });
    qc.invalidateQueries({ queryKey: ['admin-lojistas'] });
  }
  const pedidosQ = useQuery({
    queryKey: ['admin-pedidos-lojista', l.id],
    queryFn: () => api<{ pedidos: any[] }>('GET', `/api/admin/lojistas/${l.id}/pedidos`).then(r => r.pedidos),
    enabled: expandido,
  });

  async function alternarBloqueio(usuarioId: number, nome: string, bloqueadoAtual: 0 | 1) {
    const ok = await confirmar({
      titulo: bloqueadoAtual ? `Desbloquear ${nome}?` : `Bloquear ${nome}?`,
      descricao: bloqueadoAtual
        ? 'A conta volta a ter acesso normal imediatamente.'
        : 'A conta perde acesso ao app imediatamente (não consegue mais logar).',
      confirmar: bloqueadoAtual ? 'Desbloquear' : 'Bloquear',
      destrutivo: !bloqueadoAtual,
    });
    if (!ok) return;
    try {
      await api('POST', `/api/admin/usuarios/${usuarioId}/bloquear-desbloquear`);
      mostrar({ tipo: 'info', titulo: bloqueadoAtual ? 'Desbloqueado.' : 'Bloqueado.' });
      qc.invalidateQueries({ queryKey: ['admin-lojistas'] });
      qc.invalidateQueries({ queryKey: ['admin-clientes', l.id] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  return (
    <Card className={cn('transition-shadow', expandido && 'shadow-md ring-1 ring-primary/10')}>
      <CardContent className="p-5">
        {/* Cabeçalho */}
        <div className="flex items-center gap-4">
          <div className="shrink-0">
            {l.logo_url
              ? <img src={l.logo_url} alt="" className="size-14 rounded-2xl object-cover border border-border" />
              : <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-2xl">🏪</div>
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-[15px]">{l.loja_nome}</span>
              <Badge variant={l.status_aprovacao === 'aprovada' ? 'success' : l.status_aprovacao === 'suspensa' ? 'danger' : 'warning'} className="text-[10px]">
                {l.status_aprovacao}
              </Badge>
              {l.aberta ? <Badge variant="success" className="text-[10px]">Aberta</Badge> : <Badge variant="secondary" className="text-[10px]">Fechada</Badge>}
              {!!l.dono_bloqueado && <Badge variant="danger" className="text-[10px]">DONO BLOQUEADO</Badge>}
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {l.dono_nome} · {l.dono_email}
            </div>
            <div className="flex gap-4 mt-2 text-xs font-semibold text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1.5"><Users className="size-3.5 text-primary" />{l.total_clientes} clientes</span>
              <span className="flex items-center gap-1.5"><ShoppingBag className="size-3.5 text-primary" />{l.total_pedidos} pedidos</span>
              <span className="flex items-center gap-1.5"><TrendingUp className="size-3.5 text-emerald-500" />{brl(l.faturamento_centavos)}</span>
            </div>
          </div>
          <Button
            variant={l.dono_bloqueado ? 'outline' : 'ghost'}
            size="sm"
            className="shrink-0"
            onClick={() => alternarBloqueio(l.usuario_id, l.dono_nome, l.dono_bloqueado)}
          >
            {l.dono_bloqueado ? <><Unlock className="size-4" /> Desbloquear</> : <><Lock className="size-4" /> Bloquear</>}
          </Button>
          <button
            onClick={onToggle}
            className="shrink-0 flex size-9 items-center justify-center rounded-xl hover:bg-accent text-muted-foreground transition-colors"
          >
            {expandido ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        </div>

        {/* Drill-down */}
        {expandido && (
          <div className="mt-5 space-y-5 border-t pt-5">
            {/* Clientes */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold flex items-center gap-2 text-sm uppercase tracking-wide text-muted-foreground">
                  <Users className="size-4" /> Clientes ({clientesQ.data?.length ?? 0})
                </h3>
                <Button size="sm" variant="outline" onClick={() => setCriandoCliente(v => !v)}>
                  <Plus className="size-3.5" /> Novo cliente
                </Button>
              </div>

              {criandoCliente && (
                <FormCliente lojaId={l.id} onCancelar={() => setCriandoCliente(false)} onSalvo={aoSalvarCliente} />
              )}

              {clientesQ.isLoading && <Skeleton className="h-16 rounded-xl" />}
              {clientesQ.data?.length === 0 && !criandoCliente && <p className="text-sm text-muted-foreground">Nenhum cliente cadastrado.</p>}
              <div className="space-y-2">
                {clientesQ.data?.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 rounded-xl bg-muted/50 px-4 py-2.5">
                    <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">
                      {c.nome.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold">{c.nome}</div>
                        {!!c.bloqueado && <Badge variant="danger" className="text-[9px] px-1.5">BLOQUEADO</Badge>}
                      </div>
                      <div className="flex gap-3 flex-wrap">
                        {c.email && <span className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="size-3"/>{c.email}</span>}
                        {c.telefone && <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="size-3"/>{c.telefone}</span>}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">{new Date(c.criado_em).toLocaleDateString('pt-BR')}</div>
                    <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setEditandoCliente(c)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="sm" className="shrink-0"
                      onClick={() => alternarBloqueio(c.id, c.nome, c.bloqueado)}
                    >
                      {c.bloqueado ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />}
                    </Button>
                  </div>
                ))}
              </div>

              {editandoCliente && (
                <ModalEditarCliente cliente={editandoCliente} onFechar={() => setEditandoCliente(null)} onSalvo={aoSalvarCliente} />
              )}
            </div>

            {/* Pedidos */}
            <div>
              <h3 className="font-bold mb-3 flex items-center gap-2 text-sm uppercase tracking-wide text-muted-foreground">
                <ShoppingBag className="size-4" /> Últimos pedidos
              </h3>
              {pedidosQ.isLoading && <Skeleton className="h-16 rounded-xl" />}
              {pedidosQ.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum pedido ainda.</p>}
              <div className="space-y-2">
                {pedidosQ.data?.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-4 py-2.5 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">#{p.id}</span>
                    <span className="flex-1 truncate">{p.cliente_nome}</span>
                    <Badge variant={p.status === 'entregue' ? 'success' : p.status === 'cancelado' ? 'danger' : 'info'} className="text-[10px]">
                      {p.status}
                    </Badge>
                    <span className="font-bold tabular-nums">{brl(p.total_centavos)}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{dataLocal(p.criado_em)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────── Novo cliente (isolado nesta loja) ──────────────────── */
function FormCliente({ lojaId, onCancelar, onSalvo }: { lojaId: number; onCancelar: () => void; onSalvo: () => void }) {
  const { mostrar } = useToast();
  const [form, setForm] = useState({ nome: '', cpf: '', email: '', telefone: '', senha: '' });
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('POST', '/api/admin/usuarios', { ...form, loja_id: lojaId });
      mostrar({ tipo: 'sucesso', titulo: 'Cliente criado!' });
      onSalvo();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card className="border-primary/30 mb-3">
      <CardContent className="p-4">
        <form onSubmit={salvar} className="grid gap-2.5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Nome *</Label>
            <Input required value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
          </div>
          <div>
            <Label>CPF *</Label>
            <Input required value={form.cpf} maxLength={11} inputMode="numeric"
              onChange={e => setForm(f => ({ ...f, cpf: e.target.value.replace(/\D/g, '') }))} />
          </div>
          <div>
            <Label>Telefone</Label>
            <Input value={form.telefone} inputMode="numeric"
              onChange={e => setForm(f => ({ ...f, telefone: e.target.value.replace(/\D/g, '') }))} />
          </div>
          <div>
            <Label>E-mail (opcional)</Label>
            <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <Label>Senha inicial (mín. 6) *</Label>
            <Input required type="password" minLength={6} value={form.senha} onChange={e => setForm(f => ({ ...f, senha: e.target.value }))} />
          </div>
          <div className="sm:col-span-2 flex gap-2 pt-1">
            <Button type="submit" size="sm" disabled={enviando}>{enviando ? 'Criando…' : 'Criar cliente'}</Button>
            <Button type="button" size="sm" variant="outline" onClick={onCancelar}>Cancelar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ──────────────────── Editar cliente / resetar senha ──────────────────── */
function ModalEditarCliente({ cliente, onFechar, onSalvo }: { cliente: Cliente; onFechar: () => void; onSalvo: () => void }) {
  const { mostrar } = useToast();
  const [nome, setNome] = useState(cliente.nome);
  const [email, setEmail] = useState(cliente.email);
  const [telefone, setTelefone] = useState(cliente.telefone);
  const [novaSenha, setNovaSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resetando, setResetando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await api('PUT', `/api/admin/usuarios/${cliente.id}`, { nome, email, telefone });
      mostrar({ tipo: 'sucesso', titulo: 'Cliente atualizado!' });
      onSalvo();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  async function resetarSenha() {
    if (novaSenha.length < 6) { mostrar({ tipo: 'erro', titulo: 'Senha mínima de 6 caracteres.' }); return; }
    setResetando(true);
    try {
      await api('POST', `/api/admin/usuarios/${cliente.id}/resetar-senha`, { senha: novaSenha });
      mostrar({ tipo: 'sucesso', titulo: 'Senha redefinida!' });
      setNovaSenha('');
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setResetando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onFechar} />
      <Card className="relative w-full max-w-sm">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-extrabold">Editar cliente</h2>
            <button onClick={onFechar} className="p-1 rounded-lg hover:bg-muted text-muted-foreground"><X className="size-4" /></button>
          </div>
          <form onSubmit={salvar} className="space-y-3">
            <div>
              <Label>Nome</Label>
              <Input required value={nome} onChange={e => setNome(e.target.value)} />
            </div>
            <div>
              <Label>E-mail</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input value={telefone} inputMode="numeric" onChange={e => setTelefone(e.target.value.replace(/\D/g, ''))} />
            </div>
            <Button type="submit" className="w-full" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar alterações'}</Button>
          </form>

          <div className="border-t pt-4 space-y-2">
            <Label className="flex items-center gap-1.5"><KeyRound className="size-3.5" /> Redefinir senha</Label>
            <div className="flex gap-2">
              <Input type="password" placeholder="Nova senha (mín. 6)" value={novaSenha} onChange={e => setNovaSenha(e.target.value)} />
              <Button type="button" variant="outline" onClick={resetarSenha} disabled={resetando || !novaSenha}>
                {resetando ? '…' : 'Definir'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

