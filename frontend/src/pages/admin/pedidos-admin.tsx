import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Bike, CreditCard, Phone, Check } from 'lucide-react';
import { AdminLayout } from './layout';
import {
  Cabecalho, Toolbar, Busca, Segmented, Tabela, TabelaCabecalho, TabelaLinha,
  TabelaRodape, CelulaNome, Num, Status, Vazio, Botao, PainelLateral, type Tom,
} from './ui';
import { Falha } from '@/components/ui/estado';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, tokenSessao } from '@/lib/api';
import { brl, dataLocal } from '@/lib/format';

const ROTULO: Record<string, string> = {
  pendente: 'Pendente', aceito: 'Aceito', preparando: 'Preparando', pronto: 'Pronto',
  em_entrega: 'Em entrega', entregue: 'Entregue', cancelado: 'Cancelado', recusado: 'Recusado',
};

interface PedidoAdmin {
  id: number;
  status: string;
  total_centavos: number;
  forma_pagamento: string;
  criado_em: string;
  loja_nome: string;
  cliente_nome: string;
  entregador_nome?: string;
  endereco_entrega: string;
  /** Presentes só na lista agregada do painel master (um id se repete entre clientes). */
  tenant_id?: number;
  tenant_nome?: string;
}

interface LojaSimples { id: number; nome: string; }

const STATUS_LISTA = ['pendente', 'aceito', 'preparando', 'pronto', 'em_entrega', 'entregue', 'cancelado', 'recusado'];
const ATIVOS = ['pendente', 'aceito', 'preparando', 'pronto', 'em_entrega'];

interface Filtros { status: string; loja_id: string; de: string; ate: string; }

/** Monta a query string dos filtros — a lista e o CSV usam exatamente a mesma. */
function queryFiltros(f: Filtros): string {
  const params = new URLSearchParams();
  if (f.status) params.set('status', f.status);
  if (f.loja_id) params.set('loja_id', f.loja_id);
  if (f.de) params.set('de', f.de);
  if (f.ate) params.set('ate', f.ate);
  return params.toString();
}

/** Quantos pedidos a lista mostra antes do "carregar mais". */
const PAGINA = 50;

export function TelaPedidosAdmin() {
  const { mostrar } = useToast();
  const [filtros, setFiltros] = useState({ status: '', loja_id: '', de: '', ate: '' });
  const [aoVivo, setAoVivo] = useState(true);
  const [aberto, setAberto] = useState<PedidoAdmin | null>(null);
  const [visiveis, setVisiveis] = useState(PAGINA);
  const [exportando, setExportando] = useState(false);
  const [busca, setBusca] = useState('');
  const [grupo, setGrupo] = useState<'todos' | 'andamento' | 'entregue' | 'problema'>('todos');

  const lojas = useQuery({
    queryKey: ['admin-lojas-simples'],
    queryFn: () => api<{ lojas: LojaSimples[] }>('GET', '/api/admin/lojas').then(r => r.lojas),
  });

  const consulta = useQuery({
    queryKey: ['admin-pedidos', filtros],
    queryFn: () => {
      const qs = queryFiltros(filtros);
      return api<{ pedidos: PedidoAdmin[] }>('GET', `/api/admin/pedidos${qs ? '?' + qs : ''}`).then(r => r.pedidos);
    },
    refetchInterval: aoVivo ? 10_000 : false,
  });

  /*
   * FILTRO APLICA SOZINHO ao mudar — não existe mais botão "Filtrar".
   *
   * Eram só selects e datas: escolher "Cancelados" e a tela não mudar até
   * apertar um segundo botão parecia bug. O "Limpar" fica, porque zerar quatro
   * campos na mão é que dá trabalho.
   */
  function mudar(campo: keyof typeof filtros, valor: string) {
    setFiltros(f => ({ ...f, [campo]: valor }));
    setVisiveis(PAGINA); // filtro novo, lista volta pro começo
  }
  function limpar() {
    setFiltros({ status: '', loja_id: '', de: '', ate: '' });
    setVisiveis(PAGINA);
  }

  async function exportarCsv() {
    setExportando(true);
    try {
      const qs = queryFiltros(filtros);
      const resp = await fetch(`/api/admin/pedidos/csv${qs ? '?' + qs : ''}`, {
        headers: { Authorization: `Bearer ${tokenSessao('admin')}` },
      });
      if (!resp.ok) throw new Error('Falha ao gerar o CSV.');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pedidos-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      mostrar({ tipo: 'erro', titulo: err instanceof Error ? err.message : 'Não foi possível exportar.' });
    } finally {
      setExportando(false);
    }
  }

  const pedidos = consulta.data ?? [];

  /*
   * A BUSCA É LOCAL, os filtros são do servidor.
   *
   * Loja, status e período mudam o CONJUNTO consultado (vão na query). A busca
   * por texto peneira o que já veio — mandá-la ao servidor faria cada tecla
   * digitada virar uma consulta a 500 pedidos.
   */
  const t = busca.trim().toLowerCase();
  const visiveisFiltrados = t
    ? pedidos.filter(p =>
      `${p.loja_nome} ${p.cliente_nome} ${p.id} ${p.entregador_nome ?? ''}`.toLowerCase().includes(t))
    : pedidos;

  const faturamento = visiveisFiltrados.filter(p => p.status === 'entregue').reduce((s, p) => s + p.total_centavos, 0);
  const emAndamento = visiveisFiltrados.filter(p => ATIVOS.includes(p.status)).length;
  const temFiltros = !!(filtros.status || filtros.loja_id || filtros.de || filtros.ate || busca);
  const naTela = visiveisFiltrados.slice(0, visiveis);

  /*
   * O SEGMENTED AGRUPA, e não repete os oito status.
   *
   * Oito opções lado a lado não cabem e não são a pergunta que alguém faz aqui:
   * "o que está rolando agora", "o que fechou", "o que deu errado". O status
   * exato continua no seletor ao lado, para quem precisa de um só.
   */
  const GRUPOS = [
    { v: 'todos' as const, label: 'Todos', membros: STATUS_LISTA },
    { v: 'andamento' as const, label: 'Em andamento', membros: ATIVOS },
    { v: 'entregue' as const, label: 'Entregues', membros: ['entregue'] },
    { v: 'problema' as const, label: 'Cancelados', membros: ['cancelado', 'recusado'] },
  ];
  const grupoAtivo = GRUPOS.find(g => g.v === grupo)!;
  const daTela = grupo === 'todos'
    ? naTela
    : naTela.filter(p => grupoAtivo.membros.includes(p.status));

  return (
    <AdminLayout titulo="Pedidos">
      <div className="mx-auto max-w-5xl">
        <Cabecalho
          titulo="Pedidos"
          subtitulo={
            consulta.isLoading ? 'Carregando…' : (
              <>
                {pedidos.length} na visão atual · {emAndamento} em andamento · {brl(faturamento)} entregue
              </>
            )
          }
          acoes={
            <>
              {/* AO VIVO é um interruptor de texto, não um pill pulsante: a
                  animação piscando na borda da tela puxa o olho o tempo todo
                  para uma informação que muda uma vez por sessão. */}
              <Botao onClick={() => setAoVivo(v => !v)}>
                {aoVivo ? 'Ao vivo' : 'Pausado'}
              </Botao>
              <Botao variante="primario" onClick={() => void exportarCsv()} desabilitado={exportando || pedidos.length === 0}>
                {exportando ? 'Gerando…' : 'Exportar CSV'}
              </Botao>
            </>
          }
        />

        <Toolbar>
          <div className="min-w-[200px] flex-1">
            <Busca valor={busca} aoMudar={v => { setBusca(v); setVisiveis(PAGINA); }}
              placeholder="Buscar por loja, cliente, entregador ou nº…" />
          </div>
          <Segmented
            valor={grupo}
            aoMudar={g => { setGrupo(g); setVisiveis(PAGINA); }}
            opcoes={GRUPOS.map(g => ({
              v: g.v,
              label: g.label,
              contagem: g.v === 'todos'
                ? visiveisFiltrados.length
                : visiveisFiltrados.filter(p => g.membros.includes(p.status)).length,
            }))}
          />
        </Toolbar>

        <Toolbar>
          <select
            value={filtros.loja_id}
            onChange={e => mudar('loja_id', e.target.value)}
            aria-label="Loja"
            className="h-[34px] px-2 text-[12.5px] outline-none"
            style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, background: '#fff' }}
          >
            <option value="">Todas as lojas</option>
            {lojas.data?.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
          <select
            value={filtros.status}
            onChange={e => mudar('status', e.target.value)}
            aria-label="Status exato"
            className="h-[34px] px-2 text-[12.5px] outline-none"
            style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, background: '#fff' }}
          >
            <option value="">Qualquer status</option>
            {STATUS_LISTA.map(st => <option key={st} value={st}>{ROTULO[st]}</option>)}
          </select>
          <input type="date" value={filtros.de} onChange={e => mudar('de', e.target.value)} aria-label="De"
            className="h-[34px] px-2 text-[12.5px] outline-none"
            style={{ border: '1px solid var(--adm-linha)', borderRadius: 4 }} />
          <input type="date" value={filtros.ate} onChange={e => mudar('ate', e.target.value)} aria-label="Até"
            className="h-[34px] px-2 text-[12.5px] outline-none"
            style={{ border: '1px solid var(--adm-linha)', borderRadius: 4 }} />
          {temFiltros && <Botao altura={34} onClick={() => { limpar(); setBusca(''); setGrupo('todos'); }}>Limpar</Botao>}
        </Toolbar>

        {consulta.isError && <Falha compacto erro={consulta.error} aoTentar={() => consulta.refetch()} />}

        {consulta.isLoading ? (
          <Skeleton className="h-72" />
        ) : (
          <Tabela colunas="minmax(0,1.2fr) minmax(0,1fr) 100px 130px 120px">
            <TabelaCabecalho>
              <span>Loja</span>
              <span>Cliente</span>
              <span className="text-right">Valor</span>
              <span>Quando</span>
              <span>Status</span>
            </TabelaCabecalho>
            {/* key com o cliente junto: o id 77 existe em mais de um cliente */}
            {daTela.map((pd, i) => (
              <TabelaLinha key={`${pd.tenant_id ?? 0}-${pd.id}`} primeira={i === 0} aoClicar={() => setAberto(pd)}>
                <CelulaNome
                  nome={
                    <>
                      {pd.loja_nome}
                      {/* A etiqueta existe pra desambiguar. Quando o cliente da
                          plataforma se chama igual à loja, ela só repetiria o nome. */}
                      {pd.tenant_nome && pd.tenant_nome !== pd.loja_nome && (
                        <span className="ml-1.5 text-[11px] font-normal" style={{ color: 'var(--adm-rotulo)' }}>
                          {pd.tenant_nome}
                        </span>
                      )}
                    </>
                  }
                  sub={`#${String(pd.id).padStart(4, '0')}`}
                />
                <span className="truncate">{pd.cliente_nome || <Vazio />}</span>
                <Num className="text-right">{brl(pd.total_centavos)}</Num>
                <Num className="text-[12px]">{dataLocal(pd.criado_em)}</Num>
                <Status tom={TOM[pd.status] ?? 'neutro'}>{ROTULO[pd.status] ?? pd.status}</Status>
              </TabelaLinha>
            ))}
            <TabelaRodape
              total={daTela.length}
              filtro={grupo === 'todos' ? undefined : grupoAtivo.label}
            />
          </Tabela>
        )}

        {/*
          CARREGAR MAIS em vez de paginação numerada: a lista já vem ordenada
          por id decrescente e quem abre esta tela quer os recentes — trocar de
          "página" perderia esse fio. O backend corta em 500.
        */}
        {visiveisFiltrados.length > naTela.length && (
          <div className="flex flex-col items-center gap-1.5 pt-3">
            <Botao onClick={() => setVisiveis(v => v + PAGINA)}>
              Carregar mais {Math.min(PAGINA, visiveisFiltrados.length - naTela.length)}
            </Botao>
            <span className="text-[11.5px]" style={{ color: 'var(--adm-dado)' }}>
              Mostrando {naTela.length} de {visiveisFiltrados.length}
              {pedidos.length === 500 && ' (limite da consulta — filtre por data pra ver períodos maiores)'}
            </span>
          </div>
        )}
      </div>

      <PainelLateral
        aberto={aberto !== null}
        aoFechar={() => setAberto(null)}
        titulo={aberto ? `Pedido #${String(aberto.id).padStart(4, '0')}` : ''}
        subtitulo={aberto && (
          <>
            {ROTULO[aberto.status] ?? aberto.status} · {aberto.loja_nome}
            {aberto.tenant_nome && aberto.tenant_nome !== aberto.loja_nome && ` · ${aberto.tenant_nome}`}
            {' · '}{dataLocal(aberto.criado_em)}
          </>
        )}
      >
        {aberto && <DetalhePedido id={aberto.id} tenantId={aberto.tenant_id} />}
      </PainelLateral>
    </AdminLayout>
  );
}

/** O status do pedido no vocabulário de cor do painel. */
const TOM: Record<string, Tom> = {
  entregue: 'ok',
  cancelado: 'erro',
  recusado: 'erro',
  pendente: 'atencao',
  aceito: 'neutro',
  preparando: 'neutro',
  pronto: 'neutro',
  em_entrega: 'neutro',
};

interface DetalheResp {
  pedido: {
    id: number; status: string; subtotal_centavos: number; taxa_entrega_centavos: number;
    total_centavos: number; forma_pagamento: string; troco_para_centavos?: number | null;
    observacoes?: string; endereco_entrega: string; cliente_nome: string;
    cliente_telefone?: string | null; entregador_nome?: string | null;
  };
  itens: { nome_produto: string; preco_unit_centavos: number; quantidade: number; opcoes_texto?: string }[];
  historico: { status: string; criado_em: string }[];
}

function DetalhePedido({ id, tenantId }: { id: number; tenantId?: number }) {
  const consulta = useQuery({
    // O tenant entra na chave: sem ele, abrir o #77 de dois clientes
    // diferentes reaproveitaria o cache do primeiro.
    queryKey: ['admin-pedido-detalhe', tenantId ?? 0, id],
    queryFn: () => api<DetalheResp>('GET',
      `/api/admin/pedidos/${id}${tenantId ? `?tenant_id=${tenantId}` : ''}`),
  });

  if (consulta.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (!consulta.data) return null;
  const { pedido, itens, historico } = consulta.data;
  const pagamento = pedido.forma_pagamento === 'pix' ? 'Pix'
    : pedido.forma_pagamento === 'dinheiro' ? 'Dinheiro' : 'Cartão na entrega';

  return (
    // Uma coluna: no drawer de 640px, duas colunas espremiam o endereço e a
    // lista de itens — que é justamente o que se vem conferir aqui.
    <div className="space-y-5">
      {/* Itens */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Itens</h4>
        <div className="space-y-1.5">
          {itens.map((it, i) => (
            <div key={i} className="flex justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="text-muted-foreground tabular-nums mr-1">{it.quantidade}×</span>
                {it.nome_produto}
                {it.opcoes_texto && <span className="block text-xs text-muted-foreground truncate">{it.opcoes_texto}</span>}
              </span>
              <span className="tabular-nums font-semibold shrink-0">{brl(it.preco_unit_centavos * it.quantidade)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-2 border-t border-border/60 space-y-1 text-sm">
          <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span className="tabular-nums">{brl(pedido.subtotal_centavos)}</span></div>
          <div className="flex justify-between text-muted-foreground"><span>Entrega</span><span className="tabular-nums">{pedido.taxa_entrega_centavos === 0 ? 'Grátis' : brl(pedido.taxa_entrega_centavos)}</span></div>
          <div className="flex justify-between font-bold"><span>Total</span><span className="tabular-nums">{brl(pedido.total_centavos)}</span></div>
        </div>
      </div>

      {/* Infos + timeline */}
      <div className="space-y-3 text-sm">
        <div className="space-y-1.5 text-muted-foreground">
          <div className="flex items-start gap-2"><CreditCard className="size-4 mt-0.5 shrink-0 text-primary" /><span>{pagamento}{pedido.troco_para_centavos ? ` · troco p/ ${brl(pedido.troco_para_centavos)}` : ''}</span></div>
          <div className="flex items-start gap-2"><MapPin className="size-4 mt-0.5 shrink-0 text-primary" /><span>{pedido.endereco_entrega}</span></div>
          {pedido.cliente_telefone && <div className="flex items-start gap-2"><Phone className="size-4 mt-0.5 shrink-0 text-primary" /><span>{pedido.cliente_nome} · {pedido.cliente_telefone}</span></div>}
          {pedido.entregador_nome && <div className="flex items-start gap-2"><Bike className="size-4 mt-0.5 shrink-0 text-primary" /><span>{pedido.entregador_nome}</span></div>}
          {pedido.observacoes && (
            <div className="rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground">
              <span className="font-semibold">Observação: </span>{pedido.observacoes}
            </div>
          )}
        </div>
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Linha do tempo</h4>
          <div className="space-y-1">
            {historico.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <Check className="size-3 text-success shrink-0" />
                <span className="font-medium">{ROTULO[h.status] ?? h.status}</span>
                <span className="text-muted-foreground">· {dataLocal(h.criado_em)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
