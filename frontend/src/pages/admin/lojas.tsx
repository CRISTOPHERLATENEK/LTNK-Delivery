import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Store, CheckCircle2, XCircle, Clock, Search, Building2, Trash2,
  ChevronDown, ChevronRight, TrendingUp, Receipt, Ticket, Activity,
  FileText, ShieldCheck, Upload, Package, Save, ChevronUp, Globe, Loader2, LogIn,
} from 'lucide-react';
import { AdminLayout } from './layout';
import {
  Cabecalho, Toolbar, Busca, Segmented, Tabela, TabelaCabecalho, TabelaLinha,
  TabelaRodape, CelulaNome, Status, Vazio, Botao, PainelLateral, baixarCsv, type Tom,
} from './ui';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Falha } from '@/components/ui/estado';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError, ehSuperAdmin, tokenSessao, abrirSessaoLojistaImpersonada, destinoImpersonacao } from '@/lib/api';
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
  /**
   * Quem emite a nota desta loja, DERIVADO no servidor.
   *
   * Vem pronto porque a regra soma quatro ajustes; recalcular no navegador
   * garantiria que as duas versões discordassem no primeiro emissor novo.
   */
  situacao_nota?: {
    estado: 'erp' | 'maquininha' | 'proprio' | 'nenhum' | 'sem_credencial';
    rotulo: string;
    detalhe: string;
    alerta: boolean;
  };
  /** Presentes só quando a lista vem agregada de todos os clientes (painel master). */
  tenant_id?: number;
  tenant_nome?: string;
  tenant_slug?: string;
}

/** Anexa `?tenant_id=` na URL quando a loja pertence a um tenant (lista agregada do master) — o backend usa isso pra trocar de banco antes de executar a ação. */
function comTenant(url: string, l: Pick<Loja, 'tenant_id'>): string {
  return l.tenant_id ? `${url}${url.includes('?') ? '&' : '?'}tenant_id=${l.tenant_id}` : url;
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

  async function aprovar(l: Loja) {
    try {
      await api('POST', comTenant(`/api/admin/lojas/${l.id}/aprovar`, l));
      mostrar({ tipo: 'sucesso', titulo: 'Loja aprovada!' });
      qc.invalidateQueries({ queryKey: ['admin-lojas'] });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    }
  }

  async function suspender(l: Loja) {
    if (!(await confirmar({ titulo: 'Suspender esta loja?', descricao: 'Ela ficará invisível para os clientes até ser reativada.', confirmar: 'Suspender', destrutivo: true }))) return;
    try {
      await api('POST', comTenant(`/api/admin/lojas/${l.id}/suspender`, l));
      mostrar({ tipo: 'sucesso', titulo: 'Loja suspensa.' });
      qc.invalidateQueries({ queryKey: ['admin-lojas'] });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    }
  }

  async function excluir(l: Loja) {
    if (!(await confirmar({ titulo: `Excluir "${l.nome}"?`, descricao: 'Esta ação é permanente e não pode ser desfeita.', confirmar: 'Excluir', destrutivo: true }))) return;
    try {
      await api('DELETE', comTenant(`/api/admin/lojas/${l.id}`, l));
      mostrar({ tipo: 'sucesso', titulo: 'Loja excluída.' });
      if (selecionada === l.id) setSelecionada(null);
      qc.invalidateQueries({ queryKey: ['admin-lojas'] });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message, descricao: 'Dica: se tiver pedidos, suspenda a loja.' });
    }
  }

  async function entrarComoLojista(l: Loja) {
    if (!l.tenant_id) return;
    try {
      const token = tokenSessao();
      const resp = await fetch(`/api/admin/tenants/${l.tenant_id}/impersonar`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.erro || `Falha ao entrar (HTTP ${resp.status}).`);
      // Loja com domínio próprio: abre já lá (ver destinoImpersonacao). Sem
      // domínio: sessão via storage (compartilhado entre abas same-origin),
      // sem jogar o token na URL (vazaria em histórico/logs/Referer).
      const destino = destinoImpersonacao(corpo.redirecionar, corpo.token);
      if (destino) { window.open(destino, '_blank'); return; }
      await abrirSessaoLojistaImpersonada(corpo.token);
      window.open('/lojista', '_blank');
    } catch (e) {
      mostrar({ tipo: 'erro', titulo: e instanceof Error ? e.message : 'Falha ao entrar como lojista.' });
    }
  }

  const todas = consulta.data ?? [];
  const pendentes = todas.filter(l => l.status_aprovacao === 'pendente').length;

  /*
   * VENDENDO SEM NOTA: o aviso do topo conta só LOJA APROVADA.
   *
   * Loja pendente ou suspensa não está vendendo, e incluí-la faria o número
   * viver inflado — que é como um aviso permanente deixa de ser lido.
   */
  const semNota = todas.filter(l => l.status_aprovacao === 'aprovada' && l.situacao_nota?.alerta);

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
        {/*
          O AVISO VEM ANTES DA LISTA, e nomeia as lojas.
          Um contador ("3 lojas sem nota") obrigaria a percorrer a lista
          procurando os selos amarelos — trabalho que o aviso existe pra poupar.
        */}
        {semNota.length > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.07] p-3">
            <p className="text-[13px] font-bold text-amber-700 dark:text-amber-500">
              {semNota.length === 1
                ? '1 loja aprovada sem emissão de nota resolvida'
                : `${semNota.length} lojas aprovadas sem emissão de nota resolvida`}
            </p>
            <ul className="mt-1.5 space-y-1">
              {semNota.slice(0, 8).map(l => (
                <li key={l.id} className="text-[12px] leading-relaxed text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => setSelecionada(l.id)}
                    className="font-semibold text-foreground underline decoration-dotted underline-offset-2"
                  >
                    {l.nome}
                  </button>
                  {' — '}{l.situacao_nota?.detalhe}
                </li>
              ))}
            </ul>
            {semNota.length > 8 && (
              <p className="mt-1 text-[11.5px] text-muted-foreground">e mais {semNota.length - 8}.</p>
            )}
          </div>
        )}

        <Cabecalho
          titulo="Lojas"
          subtitulo={
            consulta.isLoading ? 'Carregando…' : (
              <>
                {todas.length} cadastradas
                {pendentes > 0 && ` · ${pendentes} aguardando aprovação`}
              </>
            )
          }
          acoes={superAdmin && (
            <Link to="/painel-admin/clientes"><Botao variante="primario">Novo cliente</Botao></Link>
          )}
        />

        <Toolbar>
          <div className="min-w-[200px] flex-1">
            <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar por nome, dono ou e-mail…" />
          </div>
          <Segmented
            valor={filtro}
            aoMudar={setFiltro}
            opcoes={FILTROS.map(f => ({
              v: f.valor,
              label: f.label,
              contagem: f.valor === 'todas'
                ? todas.length
                : todas.filter(l => l.status_aprovacao === f.valor).length,
            }))}
          />
        </Toolbar>

        {consulta.isError && <Falha compacto erro={consulta.error} aoTentar={() => consulta.refetch()} />}

        {consulta.isLoading ? (
          <Skeleton className="h-72" />
        ) : (
          <Tabela colunas="minmax(0,1.4fr) minmax(0,1fr) 130px 110px 110px">
            <TabelaCabecalho>
              <span>Loja</span>
              <span>Dono</span>
              <span>Nota</span>
              <span>Situação</span>
              <span />
            </TabelaCabecalho>
            {lojas.map((l, i) => (
              <TabelaLinha key={l.id} primeira={i === 0} aoClicar={() => setSelecionada(l.id)}>
                <CelulaNome
                  nome={
                    <>
                      {l.nome}
                      {/* Aberta/fechada é estado do DIA, não do cadastro: vai
                          como texto discreto ao lado, não como mais um selo
                          competindo com a situação da loja. */}
                      {!l.aberta && (
                        <span className="ml-1.5 text-[11px] font-normal" style={{ color: 'var(--adm-rotulo)' }}>
                          fechada
                        </span>
                      )}
                      {l.tenant_nome && l.tenant_nome !== l.nome && (
                        <span className="ml-1.5 text-[11px] font-normal" style={{ color: 'var(--adm-rotulo)' }}>
                          {l.tenant_nome}
                        </span>
                      )}
                    </>
                  }
                  sub={l.dominio_personalizado || (l.slug ? `/${l.slug}` : '')}
                />
                <CelulaNome nome={l.dono_nome} sub={l.dono_email} />
                {/* Quem emite a nota — a coluna que mostra "vendendo sem nota",
                    o estado que não aparecia em tela nenhuma. */}
                {l.situacao_nota
                  ? <Status tom={TOM_NOTA[l.situacao_nota.estado] ?? 'neutro'}>{l.situacao_nota.rotulo}</Status>
                  : <Vazio />}
                <Status tom={TOM_SITUACAO[l.status_aprovacao] ?? 'neutro'}>
                  {ROTULO_SITUACAO[l.status_aprovacao] ?? l.status_aprovacao}
                </Status>
                {/*
                  AS AÇÕES DESTRUTIVAS SAÍRAM DA LINHA.
                  Aprovar, suspender e excluir ficavam a um clique de distância
                  numa lista onde a linha inteira já é clicável — vizinhança
                  perigosa demais para "excluir". Agora moram na gaveta, onde
                  quem clica já leu de qual loja se trata.
                */}
                <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                  {!!l.tenant_id && (
                    <Botao altura={30} onClick={() => entrarComoLojista(l)}>Entrar</Botao>
                  )}
                </div>
              </TabelaLinha>
            ))}
            <TabelaRodape
              total={lojas.length}
              filtro={filtro === 'todas' ? undefined : FILTROS.find(f => f.valor === filtro)?.label}
              aoExportar={lojas.length > 0 ? () => baixarCsv(
                'lojas',
                ['Loja', 'Slug', 'Domínio', 'Dono', 'E-mail', 'Situação', 'Aberta', 'Emissor da nota'],
                lojas.map(l => [
                  l.nome, l.slug ?? '', l.dominio_personalizado ?? '', l.dono_nome, l.dono_email,
                  ROTULO_SITUACAO[l.status_aprovacao] ?? l.status_aprovacao,
                  l.aberta ? 'sim' : 'não',
                  l.situacao_nota?.rotulo ?? '',
                ]),
              ) : undefined}
            />
          </Tabela>
        )}
      </div>

      {/* ── Detalhe em painel lateral ── */}
      {(() => {
        const l = todas.find(x => x.id === selecionada);
        if (!l) return null;
        return (
          <PainelLateral
            aberto
            aoFechar={() => setSelecionada(null)}
            titulo={l.nome}
            subtitulo={
              <>
                {ROTULO_SITUACAO[l.status_aprovacao] ?? l.status_aprovacao} · {l.categoria} · {l.dono_nome}
              </>
            }
            rodape={
              <>
                {l.status_aprovacao !== 'aprovada' && (
                  <Botao altura={30} variante="primario" onClick={() => aprovar(l)}>
                    {l.status_aprovacao === 'suspensa' ? 'Reativar' : 'Aprovar'}
                  </Botao>
                )}
                {l.status_aprovacao === 'aprovada' && (
                  <Botao altura={30} variante="perigo" onClick={() => suspender(l)}>Suspender</Botao>
                )}
                {superAdmin && (
                  <Botao altura={30} variante="perigo" onClick={() => excluir(l)}>Excluir</Botao>
                )}
              </>
            }
          >
            <div className="space-y-1">
              <PainelVendas loja={l} />
              {superAdmin && <ComissaoLojaEditor loja={l} onSalvo={() => consulta.refetch()} />}
              {superAdmin && <DominioLojaEditor loja={l} onSalvo={() => consulta.refetch()} />}
              {superAdmin && <WhatsAppPermissoesEditor loja={l} onSalvo={() => consulta.refetch()} />}
              {superAdmin && <ModulosDaLoja loja={l} />}
              {superAdmin && <FiscalLojaAdmin loja={l} />}
            </div>
          </PainelLateral>
        );
      })()}
    </AdminLayout>
  );
}

/** A situação do cadastro no vocabulário de cor do painel. */
const TOM_SITUACAO: Record<string, Tom> = {
  aprovada: 'ok', pendente: 'atencao', suspensa: 'erro',
};
const ROTULO_SITUACAO: Record<string, string> = {
  aprovada: 'Aprovada', pendente: 'Aguardando', suspensa: 'Suspensa',
};

/*
 * A COR DIZ SE TERMINA EM NOTA, não qual emissor é. `proprio` é âmbar como quem
 * não tem emissor nenhum: a emissão deste sistema está incompleta, então
 * apontar para ela também acaba em venda sem nota.
 */
const TOM_NOTA: Record<string, Tom> = {
  erp: 'ok', maquininha: 'ok', proprio: 'atencao', sem_credencial: 'atencao', nenhum: 'erro',
};


/* ──────────────────── Comissão customizada por loja ──────────────────── */

function ComissaoLojaEditor({ loja, onSalvo }: { loja: Loja; onSalvo: () => void }) {
  const { mostrar } = useToast();
  const [valor, setValor] = useState(loja.comissao_percentual != null ? String(loja.comissao_percentual) : '');
  const [salvando, setSalvando] = useState(false);

  /*
   * A comissão PADRÃO da plataforma como referência.
   *
   * O campo aceita vazio ("usa o padrão"), mas o padrão não aparecia em lugar
   * nenhum aqui — dava pra digitar 12% sem saber que o padrão já era 12%, ou
   * apagar o valor sem saber pra quanto a loja voltaria.
   */
  const padraoQ = useQuery({
    queryKey: ['admin-comissao-padrao'],
    queryFn: () => api<{ comissao_percentual: number }>('GET', '/api/admin/comissao').then(r => r.comissao_percentual),
    staleTime: 5 * 60_000,
  });

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      await api('PUT', comTenant(`/api/admin/lojas/${loja.id}/comissao`, loja), {
        comissao_percentual: valor === '' ? null : Number(valor),
      });
      mostrar({ tipo: 'sucesso', titulo: valor === '' ? 'Comissão padrão da plataforma aplicada.' : `Comissão desta loja: ${valor}%` });
      onSalvo();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally { setSalvando(false); }
  }

  return (
    <form onSubmit={salvar} className="mt-3 border-t pt-3">
      <div className="flex items-end gap-2">
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
      </div>
      {padraoQ.data != null && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Padrão da plataforma: <b className="text-foreground">{padraoQ.data}%</b>
          {valor === '' ? ' — é o que esta loja usa hoje.' : ' — deixe vazio pra voltar a usá-lo.'}
        </p>
      )}
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
      await api('PUT', comTenant(`/api/admin/lojas/${loja.id}/dominio`, loja), { dominio_personalizado: valor.trim() });
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
      await api('PUT', comTenant(`/api/admin/lojas/${loja.id}/whatsapp-permissoes`, loja), {
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

function PainelVendas({ loja }: { loja: Loja }) {
  const consulta = useQuery({
    queryKey: ['admin-loja-vendas', loja.id, loja.tenant_id],
    queryFn: () => api<Vendas>('GET', comTenant(`/api/admin/lojas/${loja.id}/vendas`, loja)),
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

/*
 * A COR DIZ SE TERMINA EM NOTA, não qual emissor é.
 *
 * `proprio` é âmbar como quem não tem emissor nenhum, de propósito: a emissão
 * deste sistema está incompleta, então apontar para ela também acaba em venda
 * sem nota. Verde é só para o que realmente emite.
 */
const SELO_NOTA: Record<string, string> = {
  erp: 'bg-green-500/15 text-green-600',
  maquininha: 'bg-green-500/15 text-green-600',
  proprio: 'bg-amber-500/15 text-amber-600',
  sem_credencial: 'bg-amber-500/15 text-amber-600',
  nenhum: 'bg-red-500/15 text-red-600',
};

interface FiscalCfg {
  ativo: 0 | 1; cnpj: string; ie: string; razao_social: string; nome_fantasia: string;
  crt: number; uf: string; cmun: string; municipio: string;
  logradouro: string; numero: string; bairro: string; cep: string;
  csc_id: string; ambiente: number; serie: number; proximo_numero: number; tem_csc: boolean;
  ncm_padrao: string; cfop_padrao: string; csosn_padrao: string;
  /* Módulo contratado (decisão da plataforma). Diferente de `ativo`, que é o
     lojista dizendo "emita nas minhas vendas". */
  liberado: 0 | 1;
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

/**
 * OS MÓDULOS CONTRATADOS desta loja, num bloco só.
 *
 * Juntos e não espalhados pela gaveta porque a pergunta que se faz aqui é uma
 * só — "o que este cliente tem?" — e respondê-la exigia abrir três seções.
 */
function ModulosDaLoja({ loja }: { loja: Loja }) {
  const { mostrar } = useToast();
  const [estado, setEstado] = useState<EstadoModulos | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);

  useEffect(() => {
    api<EstadoModulos>('GET', comTenant(`/api/admin/lojas/${loja.id}/modulos`, loja))
      .then(setEstado)
      .catch(() => {});
  }, [loja.id]);

  /*
   * TROCAR O CANAL grava na hora, sem confirmação.
   *
   * Nenhuma das três escolhas quebra nada: canal decide quão cedo a loja recebe
   * NOVIDADE, e voltar para "Recomendado" desfaz na mesma hora. Segurança não
   * passa por aqui — corrige para todo mundo no mesmo deploy.
   */
  async function trocarCanal(canal: Canal) {
    if (!estado || estado.canal === canal) return;
    setSalvando('canal');
    try {
      const r = await api<{ canal: Canal }>('PUT', comTenant(`/api/admin/lojas/${loja.id}/canal`, loja), { canal });
      /* Relê: a lista de funcionalidades do canal novo vem do servidor, e
         montá-la aqui repetiria a regra que já existe lá. */
      const novo = await api<EstadoModulos>('GET', comTenant(`/api/admin/lojas/${loja.id}/modulos`, loja));
      setEstado(novo);
      mostrar({ tipo: 'sucesso', titulo: `Canal: ${ROTULO_CANAL[r.canal]}` });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally { setSalvando(null); }
  }

  const MODULOS = [
    {
      chave: 'vendas' as const,
      titulo: 'Vendas (PDV, mesas e caixa)',
      ligado: 'O lojista vê a aba Vendas: balcão, mesas e caixa.',
      desligado: 'A aba Vendas não aparece no painel dele. O histórico fica guardado.',
      aviso: 'A aba Vendas some do painel dele e o PDV, as mesas e o caixa param de funcionar.',
    },
    {
      chave: 'fiscal' as const,
      titulo: 'Fiscal (NFC-e)',
      ligado: 'O lojista vê a aba Fiscal e pode emitir NFC-e.',
      desligado: 'A aba Fiscal não aparece e nenhuma nota sai. O cadastro fica guardado.',
      aviso: 'A aba Fiscal some do painel dele e a emissão para na hora. Certificado, CSC e numeração ficam guardados.',
    },
  ];

  async function alternar(chave: 'vendas' | 'fiscal', aviso: string) {
    if (!estado) return;
    const novo = estado[chave] ? 0 : 1;
    /*
     * Só BLOQUEAR pergunta. Liberar não quebra nada e um "tem certeza?" ali
     * seria só um clique a mais; bloquear tira uma tela de quem está usando.
     */
    if (!novo && !window.confirm(`Bloquear este módulo de ${loja.nome}?

${aviso}`)) return;
    setSalvando(chave);
    try {
      await api('PUT', comTenant(`/api/admin/lojas/${loja.id}/modulo/${chave}`, loja), { liberado: !!novo });
      setEstado(e => (e ? { ...e, [chave]: novo as 0 | 1 } : e));
      mostrar({ tipo: 'sucesso', titulo: novo ? 'Módulo liberado' : 'Módulo bloqueado' });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally { setSalvando(null); }
  }

  if (!estado) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-bold text-primary">
        <Package className="size-4" /> Módulos contratados
      </p>
      {/*
        O CANAL VEM DEPOIS DOS MÓDULOS, e a ordem é a da pergunta que se faz:
        primeiro "o que este cliente tem?", depois "quão cedo ele recebe?".
      */}
      <div className="space-y-2">
        {MODULOS.map(m => {
          const ligado = !!estado[m.chave];
          return (
            <div
              key={m.chave}
              className={cn('rounded-xl border p-3',
                ligado ? 'border-primary/40 bg-primary/[0.04]' : 'border-amber-500/40 bg-amber-500/[0.06]')}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-bold">{m.titulo}</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                    {ligado ? m.ligado : m.desligado}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void alternar(m.chave, m.aviso)}
                  disabled={salvando === m.chave}
                  role="switch"
                  aria-checked={ligado}
                  aria-label={`Liberar o módulo ${m.titulo}`}
                  className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
                    ligado ? 'bg-primary' : 'bg-muted-foreground/30')}
                >
                  <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all',
                    ligado ? 'left-[18px]' : 'left-0.5')} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3">
        <p className="mb-1.5 text-[13px] font-bold">Canal de liberação</p>
        <div className="flex" style={{ border: '1px solid var(--adm-linha, #ECEAE6)', borderRadius: 4, width: 'fit-content' }}>
          {(['estavel', 'beta', 'teste'] as Canal[]).map((c, i) => (
            <button
              key={c}
              type="button"
              disabled={salvando === 'canal'}
              aria-pressed={estado.canal === c}
              onClick={() => void trocarCanal(c)}
              className="h-[30px] px-3 text-[12px] disabled:opacity-50"
              style={{
                /* Sem transition no background: é a propriedade dinâmica. */
                background: estado.canal === c ? '#F1EFEC' : '#fff',
                fontWeight: estado.canal === c ? 600 : 400,
                borderLeft: i === 0 ? 'none' : '1px solid #ECEAE6',
              }}
            >
              {ROTULO_CANAL[c]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {DESCRICAO_CANAL[estado.canal]}
        </p>
        {estado.funcionalidades.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {estado.funcionalidades.map(f => (
              <li key={f.chave} className="text-[11.5px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">{f.titulo}</span>
                {f.porque && <> — {f.porque}</>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
          Correção de segurança <b>não</b> passa por canal: sai para todos os clientes no
          mesmo deploy.
        </p>
      </div>
    </div>
  );
}

type Canal = 'estavel' | 'beta' | 'teste';

const ROTULO_CANAL: Record<Canal, string> = {
  estavel: 'Recomendado', beta: 'Beta', teste: 'Teste',
};

const DESCRICAO_CANAL: Record<Canal, string> = {
  estavel: 'Só o que já foi provado em beta e teste. É o padrão de todo cliente novo.',
  beta: 'Recebe as novidades antes, depois de passarem pelo teste. Pode encontrar aresta.',
  teste: 'Recebe tudo assim que existe, inclusive o que ainda vai mudar. Para uso interno.',
};

interface EstadoModulos {
  vendas: 0 | 1;
  fiscal: 0 | 1;
  canal: Canal;
  funcionalidades: { chave: string; titulo: string; canal: Canal; porque: string }[];
}

function FiscalLojaAdmin({ loja }: { loja: Loja }) {
  const lojaId = loja.id;
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
  const [carregandoProdutos, setCarregandoProdutos] = useState(false);
  const timerRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  function carregar() {
    api<{ config: FiscalCfg; certificado: FiscalCert }>('GET', comTenant(`/api/admin/lojas/${lojaId}/fiscal`, loja))
      .then(r => { setCfg(r.config); setCert(r.certificado); })
      .catch(() => {});
  }

  function carregarProdutos() {
    setCarregandoProdutos(true);
    api<{ produtos: ProdFiscal[] }>('GET', comTenant(`/api/admin/lojas/${lojaId}/fiscal/produtos`, loja))
      .then(r => setProdutos(r.produtos))
      .catch(() => {})
      .finally(() => setCarregandoProdutos(false));
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
      await api('PUT', comTenant(`/api/admin/lojas/${lojaId}/fiscal`, loja), { ...cfg, csc: csc || undefined });
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
      const resp = await fetch(comTenant(`/api/admin/lojas/${lojaId}/fiscal/certificado`, loja), {
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
        if (prod) api('PUT', comTenant(`/api/admin/lojas/${lojaId}/fiscal/produtos/${id}`, loja), prod).catch(() => {});
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
          {/*
            O ESTADO DO MÓDULO, sem interruptor.
            O interruptor mora em "Módulos contratados", acima: dois controles
            para o mesmo campo fariam a pessoa mexer num e conferir no outro.
            Aqui basta o aviso de que preencher isto não vale de nada enquanto
            o módulo estiver bloqueado.
          */}
          {cfg && !cfg.liberado && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-3">
              <p className="text-[12.5px] leading-relaxed text-amber-700 dark:text-amber-500">
                <b>Módulo fiscal bloqueado.</b> O cadastro abaixo pode ser preenchido,
                mas nenhuma nota sai e o lojista não vê a aba Fiscal. Libere em
                "Módulos contratados", acima.
              </p>
            </div>
          )}

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
                    {/* "Vence em breve" por escrito, não só pela cor âmbar —
                        quem não distingue as duas cores perdia o aviso. */}
                    <span>{cert.titular} · válido até {validadeFmt}{venceProximo && ' · vence em breve'}</span>
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
                      {carregandoProdutos ? 'Carregando produtos…' : 'Nenhum produto cadastrado nesta loja.'}
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

