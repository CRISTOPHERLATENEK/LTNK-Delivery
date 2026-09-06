import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Store, Users, ShoppingBag, TrendingUp,
  ChevronRight, Plus, Mail, Phone, Search, Lock, Unlock, Pencil, X, KeyRound,
} from 'lucide-react';
import { AdminLayout } from './layout';
import {
  Cabecalho, Toolbar, Busca, Tabela, TabelaCabecalho, TabelaLinha, TabelaRodape,
  CelulaNome, Num, Status, Botao, PainelLateral, baixarCsv,
} from './ui';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { DrawerDetalhe } from '@/components/ui/drawer-detalhe';
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
  /** Presentes só na lista agregada do painel master (o id se repete entre clientes). */
  tenant_id?: number;
  tenant_nome?: string;
}

/**
 * Chave única de um lojista na lista agregada: o id da loja se repete entre
 * clientes da plataforma, então sozinho ele abriria dois drawers de uma vez.
 */
function chaveLojista(l: Pick<Lojista, 'id' | 'tenant_id'>): string {
  return `${l.tenant_id ?? 0}-${l.id}`;
}

/** Anexa `?tenant_id=` quando a linha veio da lista agregada do master. */
function comTenant(url: string, l: Pick<Lojista, 'tenant_id'>): string {
  return l.tenant_id ? `${url}${url.includes('?') ? '&' : '?'}tenant_id=${l.tenant_id}` : url;
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
  const [expandido, setExpandido] = useState<string | null>(null);
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
      <div className="mx-auto max-w-4xl">
        <Cabecalho
          titulo="Lojistas"
          subtitulo={
            consulta.isLoading
              ? 'Carregando…'
              : `${consulta.data?.length ?? 0} lojistas · clientes e pedidos de cada loja`
          }
          acoes={<Link to="/painel-admin/lojas"><Botao variante="primario">Nova loja</Botao></Link>}
        />

        {/* O cadastro do lojista é feito junto com a loja (sempre vinculado). */}
        <p className="pb-3 text-[12px] leading-relaxed" style={{ color: 'var(--adm-rotulo)' }}>
          O acesso do lojista é criado dentro do cadastro da loja, em{' '}
          <Link to="/painel-admin/lojas" className="text-primary">Lojas → Nova loja</Link>.
          Assim a conta fica sempre vinculada à loja certa.
        </p>

        <Toolbar>
          <div className="min-w-[200px] flex-1">
            <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar por loja, dono ou e-mail…" />
          </div>
        </Toolbar>

        {consulta.isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          <Tabela colunas="minmax(0,1.3fr) minmax(0,1.1fr) 90px 120px 110px">
            <TabelaCabecalho>
              <span>Loja</span>
              <span>Dono</span>
              <span className="text-right">Pedidos</span>
              <span className="text-right">Faturamento</span>
              <span>Acesso</span>
            </TabelaCabecalho>
            {lista.map((l, i) => (
              <TabelaLinha
                key={chaveLojista(l)}
                primeira={i === 0}
                aoClicar={() => setExpandido(chaveLojista(l))}
              >
                <CelulaNome
                  nome={
                    <>
                      {l.loja_nome}
                      {l.tenant_nome && l.tenant_nome !== l.loja_nome && (
                        <span className="ml-1.5 text-[11px] font-normal" style={{ color: 'var(--adm-rotulo)' }}>
                          {l.tenant_nome}
                        </span>
                      )}
                    </>
                  }
                  sub={l.categoria}
                />
                <CelulaNome nome={l.dono_nome} sub={l.dono_email} />
                <Num className="text-right">{l.total_pedidos}</Num>
                <Num className="text-right">{brl(l.faturamento_centavos)}</Num>
                {/*
                  A COLUNA É "ACESSO", não "situação da loja": aqui a pergunta é
                  sobre a PESSOA — ela consegue entrar? A situação do cadastro da
                  loja tem tela própria, e repeti-la aqui faria duas fontes para
                  o mesmo dado.
                */}
                <Status tom={l.dono_bloqueado ? 'erro' : 'ok'}>
                  {l.dono_bloqueado ? 'Bloqueado' : 'Ativo'}
                </Status>
              </TabelaLinha>
            ))}
            <TabelaRodape
              total={lista.length}
              aoExportar={lista.length > 0 ? () => baixarCsv(
                'lojistas',
                ['Loja', 'Categoria', 'Dono', 'E-mail', 'Telefone', 'Pedidos', 'Faturamento', 'Clientes', 'Acesso'],
                lista.map(l => [
                  l.loja_nome, l.categoria, l.dono_nome, l.dono_email, l.dono_telefone,
                  l.total_pedidos, (l.faturamento_centavos / 100).toFixed(2), l.total_clientes,
                  l.dono_bloqueado ? 'bloqueado' : 'ativo',
                ]),
              ) : undefined}
            />
          </Tabela>
        )}
      </div>

      {/* ── Detalhe em painel lateral ── */}
      {(() => {
        const l = lista.find(x => chaveLojista(x) === expandido);
        if (!l) return null;
        return (
          <PainelLateral
            aberto
            aoFechar={() => setExpandido(null)}
            titulo={l.loja_nome}
            subtitulo={`${l.dono_nome} · ${l.dono_email}`}
          >
            <CardLojista lojista={l} />
          </PainelLateral>
        );
      })()}
    </AdminLayout>
  );
}

/*
 * O CONTEÚDO do painel lateral de um lojista: clientes e pedidos daquela loja.
 *
 * Deixou de ser um card que expande na lista. Expandir empurrava as lojas
 * seguintes vários écrans para baixo — e as consultas de clientes e pedidos, que
 * antes dependiam do `expandido`, agora rodam porque o painel só existe quando
 * está aberto.
 */
function CardLojista({ lojista: l }: {
  lojista: Lojista;
}) {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();
  const [criandoCliente, setCriandoCliente] = useState(false);
  const [editandoCliente, setEditandoCliente] = useState<Cliente | null>(null);

  const clientesQ = useQuery({
    queryKey: ['admin-clientes', l.tenant_id ?? 0, l.id],
    queryFn: () => api<{ clientes: Cliente[] }>('GET', comTenant(`/api/admin/lojistas/${l.id}/clientes`, l)).then(r => r.clientes),
  });

  function aoSalvarCliente() {
    setCriandoCliente(false);
    setEditandoCliente(null);
    qc.invalidateQueries({ queryKey: ['admin-clientes', l.id] });
    qc.invalidateQueries({ queryKey: ['admin-lojistas'] });
  }
  const pedidosQ = useQuery({
    queryKey: ['admin-pedidos-lojista', l.tenant_id ?? 0, l.id],
    queryFn: () => api<{ pedidos: any[] }>('GET', comTenant(`/api/admin/lojistas/${l.id}/pedidos`, l)).then(r => r.pedidos),
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
      await api('POST', comTenant(`/api/admin/usuarios/${usuarioId}/bloquear-desbloquear`, l));
      mostrar({ tipo: 'info', titulo: bloqueadoAtual ? 'Desbloqueado.' : 'Bloqueado.' });
      qc.invalidateQueries({ queryKey: ['admin-lojistas'] });
      qc.invalidateQueries({ queryKey: ['admin-clientes', l.id] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  /*
   * O painel lateral já traz o nome da loja no header e o "Bloquear" no
   * corpo. O que sobra aqui é o drill-down: clientes e pedidos daquela loja.
   */
  return (
    <>
      <div className="pb-3">
        <Botao
          variante={l.dono_bloqueado ? 'primario' : 'perigo'}
          altura={30}
          onClick={() => alternarBloqueio(l.usuario_id, l.dono_nome, l.dono_bloqueado)}
        >
          {l.dono_bloqueado ? 'Desbloquear acesso' : 'Bloquear acesso'}
        </Botao>
      </div>
          <div className="space-y-5">
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
                <FormCliente lojaId={l.id} tenantId={l.tenant_id} onCancelar={() => setCriandoCliente(false)} onSalvo={aoSalvarCliente} />
              )}

              {clientesQ.isLoading && <Skeleton className="h-16 rounded-xl" />}
              {clientesQ.data?.length === 0 && !criandoCliente && <p className="text-sm text-muted-foreground">Nenhum cliente cadastrado.</p>}
              <div className="space-y-2">
                {clientesQ.data?.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 rounded-xl bg-muted/50 px-4 py-2.5">
                    <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">
                      {(c.nome || '?').charAt(0).toUpperCase()}
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
                <ModalEditarCliente cliente={editandoCliente} tenantId={l.tenant_id} onFechar={() => setEditandoCliente(null)} onSalvo={aoSalvarCliente} />
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
    </>
  );
}

/* ──────────────────── Novo cliente (isolado nesta loja) ──────────────────── */
function FormCliente({ lojaId, tenantId, onCancelar, onSalvo }: { lojaId: number; tenantId?: number; onCancelar: () => void; onSalvo: () => void }) {
  const { mostrar } = useToast();
  const [form, setForm] = useState({ nome: '', cpf: '', email: '', telefone: '', senha: '' });
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      // tenant_id no CORPO: o middleware aceita dos dois lados, e aqui a loja
      // pode ser de outro cliente da plataforma.
      await api('POST', '/api/admin/usuarios', { ...form, loja_id: lojaId, tenant_id: tenantId });
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
function ModalEditarCliente({ cliente, tenantId, onFechar, onSalvo }: { cliente: Cliente; tenantId?: number; onFechar: () => void; onSalvo: () => void }) {
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
      await api('PUT', `/api/admin/usuarios/${cliente.id}`, { nome, email, telefone, tenant_id: tenantId });
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
      await api('POST', `/api/admin/usuarios/${cliente.id}/resetar-senha`, { senha: novaSenha, tenant_id: tenantId });
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
            <button
              onClick={onFechar}
              aria-label="Fechar"
              className="-mr-2 flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" />
            </button>
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

