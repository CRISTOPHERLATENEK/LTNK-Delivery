import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Store, CheckCircle2, XCircle, Clock, Search, Building2, Trash2,
  ChevronDown, TrendingUp, Receipt, Ticket, Activity,
  FileText, ShieldCheck, Upload, Package, Save, ChevronUp, Globe, Loader2,
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
import { api, ApiError, ehSuperAdmin, tokenSessao } from '@/lib/api';
import { brl, dataLocal } from '@/lib/format';
import { buscarCnpj, formatarCnpj, cnpjDigitos } from '@/lib/cnpj';
import { cn } from '@/lib/utils';

interface Loja {
  id: number;
  nome: string;
  descricao: string;
  categoria: string;
  endereco: string;
  status_aprovacao: 'pendente' | 'aprovada' | 'suspensa';
  aberta: 0 | 1;
  logo_url: string;
  usuario_id: number;
  dono_nome: string;
  dono_email: string;
  comissao_percentual: number | null;
  criado_em: string;
  slug: string | null;
  dominio_personalizado: string | null;
  whatsapp_permite_oficial: 0 | 1;
  whatsapp_permite_nao_oficial: 0 | 1;
}

type Filtro = 'todas' | 'pendente' | 'aprovada' | 'suspensa';

const FILTROS: { valor: Filtro; label: string }[] = [
  { valor: 'todas',    label: 'Todas' },
  { valor: 'pendente', label: 'Pendentes' },
  { valor: 'aprovada', label: 'Aprovadas' },
  { valor: 'suspensa', label: 'Suspensas' },
];

const CATEGORIAS = ['Pizzaria', 'Hamburgueria', 'Japonesa', 'Brasileira', 'Doces e bolos', 'Mercado', 'Outros'];

export function TelaLojas() {
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busca, setBusca] = useState('');
  const [selecionada, setSelecionada] = useState<number | null>(null);
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();
  const superAdmin = ehSuperAdmin();

  const consulta = useQuery({
    queryKey: ['admin-lojas'],
    queryFn: () => api<{ lojas: Loja[] }>('GET', '/api/admin/lojas').then(r => r.lojas),
  });

  async function aprovar(id: number) {
    try {
      await api('POST', `/api/admin/lojas/${id}/aprovar`);
      mostrar({ tipo: 'sucesso', titulo: 'Loja aprovada!' });
      qc.invalidateQueries({ queryKey: ['admin-lojas'] });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    }
  }

  async function suspender(id: number) {
    if (!(await confirmar({ titulo: 'Suspender esta loja?', descricao: 'Ela ficará invisível para os clientes até ser reativada.', confirmar: 'Suspender', destrutivo: true }))) return;
    try {
      await api('POST', `/api/admin/lojas/${id}/suspender`);
      mostrar({ tipo: 'sucesso', titulo: 'Loja suspensa.' });
      qc.invalidateQueries({ queryKey: ['admin-lojas'] });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    }
  }

  async function excluir(l: Loja) {
    if (!(await confirmar({ titulo: `Excluir "${l.nome}"?`, descricao: 'Esta ação é permanente e não pode ser desfeita.', confirmar: 'Excluir', destrutivo: true }))) return;
    try {
      await api('DELETE', `/api/admin/lojas/${l.id}`);
      mostrar({ tipo: 'sucesso', titulo: 'Loja excluída.' });
      if (selecionada === l.id) setSelecionada(null);
      qc.invalidateQueries({ queryKey: ['admin-lojas'] });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message, descricao: 'Dica: se tiver pedidos, suspenda a loja.' });
    }
  }

  const todas = consulta.data ?? [];
  const pendentes = todas.filter(l => l.status_aprovacao === 'pendente').length;

  const lojas = todas.filter(l => {
    const matchFiltro = filtro === 'todas' || l.status_aprovacao === filtro;
    const matchBusca = !busca ||
      l.nome.toLowerCase().includes(busca.toLowerCase()) ||
      l.dono_nome.toLowerCase().includes(busca.toLowerCase()) ||
      l.dono_email.toLowerCase().includes(busca.toLowerCase());
    return matchFiltro && matchBusca;
  });

  return (
    <AdminLayout titulo="Lojas">
      <div className="space-y-5 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-extrabold flex items-center gap-2">
              <Store className="size-6 text-primary" /> Lojas
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {todas.length} lojas cadastradas
              {pendentes > 0 && (
                <span className="ml-2 text-amber-600 font-semibold">· ⚠️ {pendentes} aguardando aprovação</span>
              )}
            </p>
          </div>
          {superAdmin && (
            <Link to="/painel-admin/clientes">
              <Button>
                <Building2 className="size-4" /> Nova loja (via Clientes)
              </Button>
            </Link>
          )}
        </div>

        {/* Busca + filtros */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por nome, dono ou e-mail…"
              className="w-full h-10 pl-10 pr-4 rounded-xl border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {FILTROS.map(f => (
              <button
                key={f.valor}
                onClick={() => setFiltro(f.valor)}
                className={cn(
                  'px-3 py-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap',
                  filtro === f.valor ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {f.label}
                {f.valor !== 'todas' && (
                  <span className="ml-1.5 tabular-nums opacity-60">
                    ({todas.filter(l => l.status_aprovacao === f.valor).length})
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {consulta.isLoading && (
          <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        )}

        {!consulta.isLoading && lojas.length === 0 && (
          <Card><CardContent className="p-10 text-center text-muted-foreground">Nenhuma loja encontrada.</CardContent></Card>
        )}

        {/* Lista */}
        <div className="space-y-3">
          {lojas.map(l => {
            const aberto = selecionada === l.id;
            return (
              <Card key={l.id} className={cn(
                'transition-shadow',
                aberto && 'ring-2 ring-primary/40',
                l.status_aprovacao === 'pendente' && 'border-amber-500/30 bg-amber-500/5',
                l.status_aprovacao === 'suspensa' && 'border-destructive/30',
              )}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-4">
                    {/* Logo */}
                    <button
                      onClick={() => setSelecionada(aberto ? null : l.id)}
                      className="shrink-0"
                      title="Ver vendas"
                    >
                      {l.logo_url
                        ? <img src={l.logo_url} alt="" className="size-14 rounded-2xl object-cover border border-border" />
                        : <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-2xl">🏪</div>}
                    </button>

                    {/* Info — clicável para abrir vendas */}
                    <button
                      onClick={() => setSelecionada(aberto ? null : l.id)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[15px]">{l.nome}</span>
                        <StatusBadge status={l.status_aprovacao} />
                        {l.aberta
                          ? <Badge variant="success" className="text-[10px]">Aberta</Badge>
                          : <Badge variant="secondary" className="text-[10px]">Fechada</Badge>}
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">{l.categoria} · {l.dono_nome}</div>
                      {(l.dominio_personalizado || l.slug) && (
                        <div className="text-xs text-muted-foreground mt-0.5 font-mono flex items-center gap-1">
                          <Globe className="size-3" />
                          {l.dominio_personalizado || `/loja/${l.slug}`}
                        </div>
                      )}
                      <div className="text-xs text-primary font-semibold mt-1 flex items-center gap-1">
                        <TrendingUp className="size-3" />
                        {aberto ? 'Ocultar vendas' : 'Ver vendas'}
                        <ChevronDown className={cn('size-3 transition-transform', aberto && 'rotate-180')} />
                      </div>
                    </button>

                    {/* Ações */}
                    <div className="flex flex-col gap-2 shrink-0">
                      {l.status_aprovacao !== 'aprovada' && (
                        <Button size="sm" variant="success" onClick={() => aprovar(l.id)}>
                          <CheckCircle2 className="size-3.5" /> {l.status_aprovacao === 'suspensa' ? 'Reativar' : 'Aprovar'}
                        </Button>
                      )}
                      {l.status_aprovacao === 'aprovada' && (
                        <Button size="sm" variant="destructive" onClick={() => suspender(l.id)}>
                          <XCircle className="size-3.5" /> Suspender
                        </Button>
                      )}
                      {superAdmin && (
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => excluir(l)}>
                          <Trash2 className="size-3.5" /> Excluir
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Painel de vendas */}
                  {aberto && <PainelVendas lojaId={l.id} />}
                  {aberto && superAdmin && (
                    <ComissaoLojaEditor loja={l} onSalvo={() => consulta.refetch()} />
                  )}
                  {aberto && superAdmin && (
                    <DominioLojaEditor loja={l} onSalvo={() => consulta.refetch()} />
                  )}
                  {aberto && superAdmin && (
                    <WhatsAppPermissoesEditor loja={l} onSalvo={() => consulta.refetch()} />
                  )}
                  {aberto && superAdmin && <FiscalLojaAdmin lojaId={l.id} />}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AdminLayout>
  );
}

/* ──────────────────── Comissão customizada por loja ──────────────────── */

function ComissaoLojaEditor({ loja, onSalvo }: { loja: Loja; onSalvo: () => void }) {
  const { mostrar } = useToast();
  const [valor, setValor] = useState(loja.comissao_percentual != null ? String(loja.comissao_percentual) : '');
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      await api('PUT', `/api/admin/lojas/${loja.id}/comissao`, {
        comissao_percentual: valor === '' ? null : Number(valor),
      });
      mostrar({ tipo: 'sucesso', titulo: valor === '' ? 'Comissão padrão da plataforma aplicada.' : `Comissão desta loja: ${valor}%` });
      onSalvo();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setSalvando(false); }
  }

  return (
    <form onSubmit={salvar} className="mt-3 flex items-end gap-2 border-t pt-3">
      <div className="flex-1 max-w-xs">
        <Label>Comissão desta loja (%)</Label>
        <Input
          type="number" min="0" max="50" step="0.5"
          value={valor}
          onChange={e => setValor(e.target.value)}
          placeholder="Vazio = usa a comissão padrão"
        />
      </div>
      <Button type="submit" size="sm" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
    </form>
  );
}

/* ──────────────────── Domínio próprio (definido pelo admin) ──────────────────── */

function DominioLojaEditor({ loja, onSalvo }: { loja: Loja; onSalvo: () => void }) {
  const { mostrar } = useToast();
  const [valor, setValor] = useState(loja.dominio_personalizado || '');
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      await api('PUT', `/api/admin/lojas/${loja.id}/dominio`, { dominio_personalizado: valor.trim() });
      mostrar({ tipo: 'sucesso', titulo: valor.trim() ? `Domínio vinculado: ${valor.trim()}` : 'Domínio removido.' });
      onSalvo();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setSalvando(false); }
  }

  return (
    <form onSubmit={salvar} className="mt-3 border-t pt-3 space-y-2">
      <Label className="flex items-center gap-1.5"><Globe className="size-3.5" /> Domínio próprio desta loja</Label>
      <div className="flex items-end gap-2">
        <Input
          value={valor}
          onChange={e => setValor(e.target.value)}
          placeholder="suaempresa.com.br"
          className="flex-1 font-mono text-sm"
        />
        <Button type="submit" size="sm" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Sem "https://" nem barras. Lembre de apontar o DNS do domínio (CNAME ou A) pro servidor — sem isso o domínio não vai funcionar mesmo salvo aqui.
      </p>
    </form>
  );
}

/* ──────────────────── Permissões de WhatsApp (definido pelo admin) ──────────────────── */

function WhatsAppPermissoesEditor({ loja, onSalvo }: { loja: Loja; onSalvo: () => void }) {
  const { mostrar } = useToast();
  const [oficial, setOficial] = useState(!!loja.whatsapp_permite_oficial);
  const [naoOficial, setNaoOficial] = useState(!!loja.whatsapp_permite_nao_oficial);
  const [salvando, setSalvando] = useState(false);

  async function salvar(permiteOficial: boolean, permiteNaoOficial: boolean) {
    setSalvando(true);
    try {
      await api('PUT', `/api/admin/lojas/${loja.id}/whatsapp-permissoes`, {
        permite_oficial: permiteOficial, permite_nao_oficial: permiteNaoOficial,
      });
      mostrar({ tipo: 'sucesso', titulo: 'Permissões de WhatsApp atualizadas.' });
      onSalvo();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setSalvando(false); }
  }

  return (
    <div className="mt-3 border-t pt-3 space-y-2">
      <Label>WhatsApp — o que esta loja pode usar</Label>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox" checked={oficial} disabled={salvando}
            onChange={e => { setOficial(e.target.checked); salvar(e.target.checked, naoOficial); }}
            className="accent-primary size-4"
          />
          API oficial (Meta)
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox" checked={naoOficial} disabled={salvando}
            onChange={e => { setNaoOficial(e.target.checked); salvar(oficial, e.target.checked); }}
            className="accent-primary size-4"
          />
          Não oficial (QR code)
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">
        O lojista só vê e pode configurar os métodos marcados aqui, na tela de WhatsApp do painel dele.
      </p>
    </div>
  );
}

/* ───────────────────────── Painel de vendas ───────────────────────── */

interface Vendas {
  loja: { id: number; nome: string };
  resumo: {
    pedidos: number;
    faturamento_centavos: number;
    comissao_centavos: number;
    repasse_centavos: number;
    ticket_medio_centavos: number;
    em_andamento: number;
    cancelados: number;
  };
  recentes: { id: number; status: string; total_centavos: number; criado_em: string; cliente_nome: string }[];
}

const ROTULO_STATUS: Record<string, string> = {
  pendente: 'Pendente', aceito: 'Aceito', preparando: 'Preparando', pronto: 'Pronto',
  em_entrega: 'Em entrega', entregue: 'Entregue', cancelado: 'Cancelado', recusado: 'Recusado',
};

function PainelVendas({ lojaId }: { lojaId: number }) {
  const consulta = useQuery({
    queryKey: ['admin-loja-vendas', lojaId],
    queryFn: () => api<Vendas>('GET', `/api/admin/lojas/${lojaId}/vendas`),
  });

  if (consulta.isLoading) {
    return <div className="mt-4 pt-4 border-t border-border"><Skeleton className="h-32 rounded-xl" /></div>;
  }
  if (!consulta.data) return null;
  const { resumo, recentes } = consulta.data;

  return (
    <div className="mt-4 pt-4 border-t border-border space-y-4">
      {/* KPIs financeiros */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi icone={Receipt}    cor="text-foreground"     valor={brl(resumo.faturamento_centavos)} rotulo="Faturamento" />
        <Kpi icone={TrendingUp} cor="text-primary"        valor={brl(resumo.comissao_centavos)}    rotulo="Comissão" />
        <Kpi icone={TrendingUp} cor="text-emerald-600"    valor={brl(resumo.repasse_centavos)}     rotulo="Repasse" />
        <Kpi icone={Ticket}     cor="text-foreground"     valor={brl(resumo.ticket_medio_centavos)} rotulo="Ticket médio" />
      </div>

      {/* Contadores */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 font-semibold">
          <CheckCircle2 className="size-3.5" /> {resumo.pedidos} entregues
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-300 px-2.5 py-1 font-semibold">
          <Activity className="size-3.5" /> {resumo.em_andamento} em andamento
        </span>
        {resumo.cancelados > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 text-destructive px-2.5 py-1 font-semibold">
            <XCircle className="size-3.5" /> {resumo.cancelados} cancelados
          </span>
        )}
      </div>

      {/* Pedidos recentes */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Pedidos recentes</h4>
        {recentes.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3 text-center">Nenhum pedido ainda.</p>
        ) : (
          <div className="divide-y divide-border/60 rounded-xl border border-border/60 overflow-hidden">
            {recentes.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className="font-mono text-xs text-muted-foreground w-12">#{String(p.id).padStart(4, '0')}</span>
                <span className="flex-1 min-w-0 truncate">{p.cliente_nome}</span>
                <Badge variant={p.status === 'entregue' ? 'success' : ['cancelado', 'recusado'].includes(p.status) ? 'danger' : 'secondary'} className="text-[10px]">
                  {ROTULO_STATUS[p.status] || p.status}
                </Badge>
                <span className="tabular-nums font-semibold w-20 text-right">{brl(p.total_centavos)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ icone: Icone, cor, valor, rotulo }: { icone: typeof Receipt; cor: string; valor: string; rotulo: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background p-3">
      <Icone className={cn('size-4 mb-1.5', cor)} />
      <div className={cn('text-base font-extrabold tabular-nums leading-none', cor)}>{valor}</div>
      <div className="text-[11px] text-muted-foreground mt-1">{rotulo}</div>
    </div>
  );
}

/* ───────────────── Configuração fiscal da loja (super admin) ───────────────── */

interface FiscalCfg {
  ativo: 0 | 1; cnpj: string; ie: string; razao_social: string; nome_fantasia: string;
  crt: number; uf: string; cmun: string; municipio: string;
  logradouro: string; numero: string; bairro: string; cep: string;
  csc_id: string; ambiente: number; serie: number; proximo_numero: number; tem_csc: boolean;
  ncm_padrao: string; cfop_padrao: string; csosn_padrao: string;
}
interface FiscalCert { instalado: boolean; titular: string | null; validade: string | null; }
interface ProdFiscal { id: number; nome: string; categoria: string; ncm: string; cfop: string; csosn: string; origem: string; unidade_comercial: string; cest: string; }

const CSOSNS_ADMIN = [
  { v: '102', l: '102 – Tributada sem crédito (SN)' }, { v: '103', l: '103 – Isenção ICMS SN' },
  { v: '300', l: '300 – Imune' }, { v: '400', l: '400 – Não tributada SN' },
  { v: '500', l: '500 – ICMS cobrado anteriormente (ST)' }, { v: '900', l: '900 – Outros' },
];
const ORIGENS_ADMIN = [
  '0 – Nacional', '1 – Estrangeira (import. direta)', '2 – Estrangeira (merc. interno)',
  '3 – Nacional >40% est.', '4 – Nacional (PPB)', '5 – Nacional ≤40% est.',
  '6 – Est. sem similar nacional', '7 – Est. c/ similar nacional', '8 – Nacional por encomenda',
];

function FiscalLojaAdmin({ lojaId }: { lojaId: number }) {
  const { mostrar } = useToast();
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<'emitente' | 'padroes' | 'produtos'>('emitente');
  const [cfg, setCfg] = useState<FiscalCfg | null>(null);
  const [cert, setCert] = useState<FiscalCert | null>(null);
  const [csc, setCsc] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senhaCert, setSenhaCert] = useState('');
  const [subindoCert, setSubindoCert] = useState(false);
  const [produtos, setProdutos] = useState<ProdFiscal[]>([]);
  const timerRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  function carregar() {
    api<{ config: FiscalCfg; certificado: FiscalCert }>('GET', `/api/admin/lojas/${lojaId}/fiscal`)
      .then(r => { setCfg(r.config); setCert(r.certificado); })
      .catch(() => {});
  }

  function carregarProdutos() {
    api<{ produtos: ProdFiscal[] }>('GET', `/api/admin/lojas/${lojaId}/fiscal/produtos`)
      .then(r => setProdutos(r.produtos))
      .catch(() => {});
  }

  useEffect(() => { if (aberto && !cfg) carregar(); }, [aberto]);
  useEffect(() => { if (aberto && aba === 'produtos' && produtos.length === 0) carregarProdutos(); }, [aberto, aba]);

  function campo<K extends keyof FiscalCfg>(k: K, v: FiscalCfg[K]) {
    setCfg(c => (c ? { ...c, [k]: v } : c));
  }

  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  async function aoDigitarCnpj(bruto: string) {
    const digitos = cnpjDigitos(bruto);
    campo('cnpj', digitos);
    if (digitos.length !== 14) return;
    setBuscandoCnpj(true);
    const d = await buscarCnpj(digitos);
    setBuscandoCnpj(false);
    if (!d) { mostrar({ tipo: 'erro', titulo: 'CNPJ não encontrado.' }); return; }
    setCfg(c => c ? {
      ...c,
      cnpj: digitos,
      razao_social: d.razao_social || c.razao_social,
      nome_fantasia: d.nome_fantasia || c.nome_fantasia,
      uf: d.uf || c.uf,
      cmun: d.cmun || c.cmun,
      municipio: d.municipio || c.municipio,
      logradouro: d.logradouro || c.logradouro,
      numero: d.numero || c.numero,
      bairro: d.bairro || c.bairro,
      cep: d.cep || c.cep,
    } : c);
    mostrar({ tipo: 'sucesso', titulo: 'Dados do CNPJ preenchidos!' });
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!cfg) return;
    setSalvando(true);
    try {
      await api('PUT', `/api/admin/lojas/${lojaId}/fiscal`, { ...cfg, csc: csc || undefined });
      setCsc('');
      mostrar({ tipo: 'sucesso', titulo: 'Dados fiscais salvos!' });
      carregar();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setSalvando(false); }
  }

  async function enviarCertificado() {
    if (!arquivo || !senhaCert) { mostrar({ tipo: 'erro', titulo: 'Escolha o .pfx e a senha.' }); return; }
    setSubindoCert(true);
    try {
      const fd = new FormData();
      fd.append('certificado', arquivo);
      fd.append('senha', senhaCert);
      const resp = await fetch(`/api/admin/lojas/${lojaId}/fiscal/certificado`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenSessao()}` },
        body: fd,
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.erro || 'Falha no upload.');
      mostrar({ tipo: 'sucesso', titulo: 'Certificado instalado!', descricao: json.titular });
      setArquivo(null); setSenhaCert(''); carregar();
    } catch (e) {
      mostrar({ tipo: 'erro', titulo: e instanceof Error ? e.message : 'Falha ao enviar.' });
    } finally { setSubindoCert(false); }
  }

  function editarProduto(id: number, campoProd: keyof ProdFiscal, valor: string) {
    setProdutos(ps => {
      const next = ps.map(p => p.id === id ? { ...p, [campoProd]: valor } : p);
      clearTimeout(timerRef.current[id]);
      timerRef.current[id] = setTimeout(() => {
        const prod = next.find(p => p.id === id);
        if (prod) api('PUT', `/api/admin/lojas/${lojaId}/fiscal/produtos/${id}`, prod).catch(() => {});
      }, 800);
      return next;
    });
  }

  const validadeFmt = cert?.validade ? new Date(cert.validade).toLocaleDateString('pt-BR') : null;
  const venceProximo = cert?.validade ? (new Date(cert.validade).getTime() - Date.now()) < 30 * 864e5 : false;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-primary">
          <FileText className="size-4" /> Configuração fiscal (NFC-e)
        </span>
        {aberto ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>

      {aberto && (
        <div className="mt-3 space-y-3">
          {/* Abas */}
          <div className="flex gap-1 p-1 rounded-xl bg-muted/50 border border-border/60">
            {(['emitente', 'padroes', 'produtos'] as const).map(a => (
              <button
                key={a}
                type="button"
                onClick={() => setAba(a)}
                className={cn('flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors', aba === a ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {a === 'emitente' ? 'Emitente & CSC' : a === 'padroes' ? 'Padrões fiscais' : `Produtos (${produtos.length})`}
              </button>
            ))}
          </div>

          {!cfg ? (
            <div className="h-32 rounded-xl bg-muted/40 animate-pulse" />
          ) : aba === 'emitente' ? (
            <form onSubmit={salvar} className="space-y-3">
              {/* Certificado */}
              <div className="rounded-xl border border-border p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold"><ShieldCheck className="size-3.5 text-primary" /> Certificado A1</div>
                {cert?.instalado ? (
                  <div className={cn('rounded-lg border p-2 text-xs flex items-center gap-2', venceProximo ? 'border-amber-500/50 bg-amber-500/5 text-amber-700' : 'border-green-500/40 bg-green-500/5 text-green-700')}>
                    <CheckCircle2 className="size-3.5 shrink-0" />
                    <span>{cert.titular} · válido até {validadeFmt}{venceProximo && ' ⚠️'}</span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Nenhum certificado instalado.</p>
                )}
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] items-end">
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">Arquivo .pfx</label>
                    <input type="file" accept=".pfx,.p12" onChange={e => setArquivo(e.target.files?.[0] || null)}
                      className="block w-full text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary file:px-2 file:py-1 file:font-semibold" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">Senha</label>
                    <input type="password" value={senhaCert} onChange={e => setSenhaCert(e.target.value)} placeholder="••••••"
                      className="h-9 w-32 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                  <button type="button" onClick={enviarCertificado} disabled={subindoCert || !arquivo || !senhaCert}
                    className="h-9 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-50">
                    <Upload className="size-3.5 inline mr-1" />{subindoCert ? 'Enviando…' : cert?.instalado ? 'Substituir' : 'Instalar'}
                  </button>
                </div>
              </div>

              {/* Emitente */}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="sm:col-span-2"><label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">Razão social</label>
                  <input value={cfg.razao_social} onChange={e => campo('razao_social', e.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" /></div>
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">CNPJ</label>
                  <div className="relative">
                    <input value={formatarCnpj(cfg.cnpj)} onChange={e => aoDigitarCnpj(e.target.value)} maxLength={18}
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30" />
                    {buscandoCnpj && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-muted-foreground" />}
                  </div>
                </div>
                <div><label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">IE</label>
                  <input value={cfg.ie} onChange={e => campo('ie', e.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" /></div>
                <div><label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">UF</label>
                  <input value={cfg.uf} onChange={e => campo('uf', e.target.value.toUpperCase().slice(0,2))} maxLength={2} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm uppercase font-mono focus:outline-none focus:ring-1 focus:ring-primary/30" /></div>
                <div><label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">Cód. IBGE município</label>
                  <input value={cfg.cmun} onChange={e => campo('cmun', e.target.value.replace(/\D/g,'').slice(0,7))} maxLength={7} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30" /></div>
                <div><label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">Município</label>
                  <input value={cfg.municipio} onChange={e => campo('municipio', e.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" /></div>
                <div className="sm:col-span-2 grid grid-cols-3 gap-2">
                  <div className="col-span-2"><label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">Logradouro</label>
                    <input value={cfg.logradouro} onChange={e => campo('logradouro', e.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" /></div>
                  <div><label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">Número</label>
                    <input value={cfg.numero} onChange={e => campo('numero', e.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" /></div>
                </div>
                <div><label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">Bairro</label>
                  <input value={cfg.bairro} onChange={e => campo('bairro', e.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" /></div>
                <div><label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">CEP</label>
                  <input value={cfg.cep} onChange={e => campo('cep', e.target.value.replace(/\D/g,'').slice(0,8))} maxLength={8} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30" /></div>
              </div>

              {/* CSC + Ambiente + Série */}
              <div className="grid gap-2 sm:grid-cols-2 border-t pt-2">
                <div><label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">CSC {cfg.tem_csc && <span className="text-green-600">✓ salvo</span>}</label>
                  <input value={csc} onChange={e => setCsc(e.target.value)} placeholder={cfg.tem_csc ? 'Deixe vazio p/ manter' : 'Cole o CSC da SEFAZ'} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30" /></div>
                <div><label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">ID do CSC</label>
                  <input value={cfg.csc_id} onChange={e => campo('csc_id', e.target.value.replace(/\D/g,''))} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30" /></div>
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">Ambiente</label>
                  <div className="flex gap-2">
                    {([[2,'Homologação'],[1,'Produção']] as const).map(([v,t]) => (
                      <button key={v} type="button" onClick={() => campo('ambiente', v)}
                        className={cn('flex-1 rounded-lg border-2 px-2 py-1.5 text-xs font-semibold transition-colors', cfg.ambiente === v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div><label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">Série</label>
                  <input type="number" min="1" value={cfg.serie} onChange={e => campo('serie', Number(e.target.value)||1)} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" /></div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <button type="button" onClick={() => campo('ativo', cfg.ativo ? 0 : 1)}
                    className={cn('relative h-5 w-9 rounded-full transition-colors', cfg.ativo ? 'bg-primary' : 'bg-muted-foreground/30')}>
                    <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', cfg.ativo ? 'left-[18px]' : 'left-0.5')} />
                  </button>
                  <span className="text-xs font-medium">Emitir NFC-e nas vendas</span>
                </label>
                <button type="submit" disabled={salvando}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-60">
                  <Save className="size-3.5" />{salvando ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </form>
          ) : aba === 'padroes' ? (
            <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">NCM padrão</label>
                <input value={cfg.ncm_padrao} onChange={e => campo('ncm_padrao', e.target.value.replace(/\D/g,'').slice(0,8))} maxLength={8} placeholder="21069090" className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">CFOP padrão</label>
                <select value={cfg.cfop_padrao} onChange={e => campo('cfop_padrao', e.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30">
                  <option value="5102">5102 – Venda dentro do estado</option>
                  <option value="5405">5405 – Venda com ST</option>
                  <option value="6102">6102 – Venda fora do estado</option>
                  <option value="5949">5949 – Outra saída dentro do estado</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground block mb-0.5">CSOSN padrão</label>
                <select value={cfg.csosn_padrao} onChange={e => campo('csosn_padrao', e.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/30">
                  {CSOSNS_ADMIN.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
                </select>
              </div>
              <div className="sm:col-span-3 flex justify-end">
                <button type="submit" disabled={salvando} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-60">
                  <Save className="size-3.5" />{salvando ? 'Salvando…' : 'Salvar padrões'}
                </button>
              </div>
            </form>
          ) : (
            /* Aba produtos */
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground min-w-[140px]">Produto</th>
                    <th className="px-2 py-2 text-left font-semibold text-muted-foreground w-[80px]">NCM</th>
                    <th className="px-2 py-2 text-left font-semibold text-muted-foreground w-[60px]">CFOP</th>
                    <th className="px-2 py-2 text-left font-semibold text-muted-foreground w-[90px]">CSOSN</th>
                    <th className="px-2 py-2 text-left font-semibold text-muted-foreground w-[100px]">Origem</th>
                    <th className="px-2 py-2 text-left font-semibold text-muted-foreground w-[50px]">Unid.</th>
                    <th className="px-2 py-2 text-left font-semibold text-muted-foreground w-[70px]">CEST</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {produtos.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      {produtos.length === 0 ? 'Carregando produtos…' : 'Nenhum produto.'}
                    </td></tr>
                  )}
                  {produtos.map(p => (
                    <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2">
                        <div className="font-medium leading-tight">{p.nome}</div>
                        <div className="text-[10px] text-muted-foreground">{p.categoria}</div>
                      </td>
                      <td className="px-2 py-1.5"><input value={p.ncm} onChange={e => editarProduto(p.id,'ncm',e.target.value.replace(/\D/g,'').slice(0,8))} maxLength={8} placeholder="NCM" className="w-full rounded border border-border bg-background px-1.5 py-1 font-mono text-[11px] focus:border-primary focus:outline-none" /></td>
                      <td className="px-2 py-1.5"><input value={p.cfop} onChange={e => editarProduto(p.id,'cfop',e.target.value.replace(/\D/g,'').slice(0,4))} maxLength={4} placeholder="CFOP" className="w-full rounded border border-border bg-background px-1.5 py-1 font-mono text-[11px] focus:border-primary focus:outline-none" /></td>
                      <td className="px-2 py-1.5">
                        <select value={p.csosn} onChange={e => editarProduto(p.id,'csosn',e.target.value)} className="w-full rounded border border-border bg-background px-1 py-1 text-[11px] focus:border-primary focus:outline-none">
                          <option value="">padrão</option>
                          {CSOSNS_ADMIN.map(c => <option key={c.v} value={c.v}>{c.v}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <select value={p.origem} onChange={e => editarProduto(p.id,'origem',e.target.value)} className="w-full rounded border border-border bg-background px-1 py-1 text-[11px] focus:border-primary focus:outline-none">
                          {ORIGENS_ADMIN.map((o,i) => <option key={i} value={String(i)}>{o}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5"><input value={p.unidade_comercial} onChange={e => editarProduto(p.id,'unidade_comercial',e.target.value.toUpperCase().slice(0,6))} maxLength={6} placeholder="UN" className="w-full rounded border border-border bg-background px-1.5 py-1 font-mono text-[11px] uppercase focus:border-primary focus:outline-none" /></td>
                      <td className="px-2 py-1.5"><input value={p.cest} onChange={e => editarProduto(p.id,'cest',e.target.value.replace(/\D/g,'').slice(0,7))} maxLength={7} placeholder="—" className="w-full rounded border border-border bg-background px-1.5 py-1 font-mono text-[11px] focus:border-primary focus:outline-none" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'pendente' | 'aprovada' | 'suspensa' }) {
  if (status === 'aprovada') return <Badge variant="success" className="text-[10px]"><CheckCircle2 className="size-3 mr-1" />Aprovada</Badge>;
  if (status === 'suspensa') return <Badge variant="danger" className="text-[10px]"><XCircle className="size-3 mr-1" />Suspensa</Badge>;
  return <Badge variant="warning" className="text-[10px]"><Clock className="size-3 mr-1" />Pendente</Badge>;
}
