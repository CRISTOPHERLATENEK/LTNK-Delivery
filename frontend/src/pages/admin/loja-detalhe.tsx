/**
 * DETALHE DA LOJA EM TELA CHEIA.
 *
 * Substituiu o painel lateral de ~640px com rolagem interna. O problema não era
 * estética: naquela largura só cabiam três linhas de pedido, os números viravam
 * cards empilhados, e conferir "faturou quanto, com quantos cancelamentos" exigia
 * rolar para cima e para baixo comparando de memória.
 *
 * Três colunas que rolam SEPARADAS, com a barra de topo e a faixa de números
 * sempre visíveis: o contexto (de quem é esta loja, quanto ela fez) não sai da
 * tela enquanto se percorre os pedidos.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, ehSuperAdmin, tokenSessao, abrirSessaoLojistaImpersonada, destinoImpersonacao } from '@/lib/api';
import { brl, dataLocal } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { Skeleton } from '@/components/ui/skeleton';
import { Falha } from '@/components/ui/estado';
import {
  Num, Status, Botao, Busca, Segmented, Vazio, baixarCsv, type Tom,
} from './ui';
/*
 * OS EDITORES PESADOS vêm da tela de Lojas, onde já viviam.
 *
 * Domínio, permissões de WhatsApp, canal de liberação e o cadastro fiscal
 * completo não têm outra casa no painel — sumiram junto com o painel lateral
 * antigo e voltam aqui. Ficam num bloco que abre por baixo das três colunas, e
 * não dentro da coluna de 300px: o editor fiscal tem abas e uma tabela de
 * produtos, e espremê-lo ali seria trocar um problema de largura por outro.
 */
import {
  DominioLojaEditor, WhatsAppPermissoesEditor, ModulosDaLoja, FiscalLojaAdmin,
  type Loja,
} from './lojas';

interface LojaPainel {
  id: number; nome: string; slug: string | null; categoria: string; endereco: string;
  aberta: 0 | 1; auto_horario: 0 | 1; status_aprovacao: string; criado_em: string;
  dominio_personalizado: string | null; comissao_percentual: number | null;
  fiscal_liberado: 0 | 1; vendas_liberado: 0 | 1; canal_versao: string | null;
  nfce_ativo: 0 | 1; nfce_municipio: string | null; nfce_uf: string | null;
  nfce_razao_social: string | null; nfce_cnpj: string | null;
  dono_id: number; dono_nome: string; dono_email: string;
  dono_telefone: string | null; dono_bloqueado: 0 | 1;
}

interface PedidoLoja {
  id: number; status: string; total_centavos: number; criado_em: string;
  forma_pagamento: string; cliente_nome: string;
}

interface Painel {
  loja: LojaPainel;
  periodo_dias: number;
  resumo: {
    pedidos: number; faturamento_centavos: number; comissao_centavos: number;
    repasse_centavos: number; ticket_medio_centavos: number;
    em_andamento: number; cancelados: number; total: number;
  };
  pedidos: PedidoLoja[];
  auditoria: { acao: string; alvo_desc: string; detalhes: string; criado_em: string; admin_nome: string }[];
  comissao_padrao: number;
  abertura_automatica: boolean;
}

const TOM_PEDIDO: Record<string, Tom> = {
  entregue: 'ok', cancelado: 'erro', recusado: 'erro', pendente: 'atencao',
  aceito: 'neutro', preparando: 'neutro', pronto: 'neutro', em_entrega: 'neutro',
};
const ROTULO_PEDIDO: Record<string, string> = {
  pendente: 'Pendente', aceito: 'Aceito', preparando: 'Preparando', pronto: 'Pronto',
  em_entrega: 'Em entrega', entregue: 'Entregue', cancelado: 'Cancelado', recusado: 'Recusado',
};
const ROTULO_SITUACAO: Record<string, string> = {
  aprovada: 'Aprovada', pendente: 'Aguardando', suspensa: 'Suspensa',
};
const TOM_SITUACAO: Record<string, Tom> = {
  aprovada: 'ok', pendente: 'atencao', suspensa: 'erro',
};

type Grupo = 'todos' | 'entregue' | 'andamento' | 'cancelado';
const ATIVOS = ['pendente', 'aceito', 'preparando', 'pronto', 'em_entrega'];

export function TelaLojaDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navegar = useNavigate();
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const superAdmin = ehSuperAdmin();

  /*
   * O `tenant_id` VIAJA NA URL, vindo da lista.
   *
   * No painel master o id da loja se repete entre clientes: sem ele, a consulta
   * cairia no banco errado e mostraria a loja de outro cliente com o mesmo id.
   * Também é ele que identifica o tenant para a impersonação, que é por cliente
   * e não por loja.
   */
  const [params] = useSearchParams();
  const tenantId = params.get('tenant_id');
  const comTenant = (url: string) =>
    tenantId ? `${url}${url.includes('?') ? '&' : '?'}tenant_id=${tenantId}` : url;

  const consulta = useQuery({
    queryKey: ['admin-loja-painel', id, tenantId],
    queryFn: () => api<Painel>('GET', comTenant(`/api/admin/lojas/${id}/painel`)),
    enabled: !!id,
  });
  const d = consulta.data;

  /* ── O que se edita: comissão e os dois módulos ────────────────────────── */
  const [comissao, setComissao] = useState('');
  const [fiscal, setFiscal] = useState(false);
  const [vendas, setVendas] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!d) return;
    setComissao(d.loja.comissao_percentual == null ? '' : String(d.loja.comissao_percentual));
    setFiscal(!!d.loja.fiscal_liberado);
    setVendas(!!d.loja.vendas_liberado);
  }, [d?.loja.id, d?.loja.comissao_percentual, d?.loja.fiscal_liberado, d?.loja.vendas_liberado]);

  const comissaoOriginal = d?.loja.comissao_percentual == null ? '' : String(d.loja.comissao_percentual);
  const sujo = !!d && (
    comissao !== comissaoOriginal
    || fiscal !== !!d.loja.fiscal_liberado
    || vendas !== !!d.loja.vendas_liberado
  );

  function descartar() {
    if (!d) return;
    setComissao(comissaoOriginal);
    setFiscal(!!d.loja.fiscal_liberado);
    setVendas(!!d.loja.vendas_liberado);
  }

  /*
   * SALVA SÓ O QUE MUDOU, em rotas que já existiam.
   *
   * Comissão, módulo fiscal e módulo de vendas moram em endpoints diferentes
   * porque são decisões diferentes. A barra junta as três na TELA — que é onde
   * a pessoa pensa nelas juntas — sem juntar no servidor.
   */
  async function salvar() {
    if (!d) return;
    setSalvando(true);
    try {
      if (comissao !== comissaoOriginal) {
        const n = comissao.trim() === '' ? null : Number(comissao.replace(',', '.'));
        if (n !== null && (!Number.isFinite(n) || n < 0 || n > 50)) {
          throw new ApiError(400, 'Comissão inválida: use um número entre 0 e 50, ou deixe vazio para herdar o padrão.');
        }
        await api('PUT', comTenant(`/api/admin/lojas/${d.loja.id}/comissao`), { comissao_percentual: n });
      }
      if (fiscal !== !!d.loja.fiscal_liberado) {
        await api('PUT', comTenant(`/api/admin/lojas/${d.loja.id}/modulo/fiscal`), { liberado: fiscal });
      }
      if (vendas !== !!d.loja.vendas_liberado) {
        await api('PUT', comTenant(`/api/admin/lojas/${d.loja.id}/modulo/vendas`), { liberado: vendas });
      }
      await consulta.refetch();
      mostrar({ tipo: 'sucesso', titulo: 'Alterações salvas' });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally { setSalvando(false); }
  }

  async function suspender() {
    if (!d) return;
    const suspensa = d.loja.status_aprovacao === 'suspensa';
    if (!(await confirmar({
      titulo: suspensa ? `Reativar ${d.loja.nome}?` : `Suspender ${d.loja.nome}?`,
      descricao: suspensa
        ? 'A loja volta a aparecer para os clientes.'
        : 'Ela fica invisível para os clientes até ser reativada.',
      confirmar: suspensa ? 'Reativar' : 'Suspender',
      destrutivo: !suspensa,
    }))) return;
    try {
      await api('POST', comTenant(`/api/admin/lojas/${d.loja.id}/${suspensa ? 'aprovar' : 'suspender'}`));
      await consulta.refetch();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    }
  }

  async function excluir() {
    if (!d) return;
    if (!(await confirmar({
      titulo: `Excluir "${d.loja.nome}"?`,
      descricao: 'Esta ação é permanente e não pode ser desfeita.',
      confirmar: 'Excluir', destrutivo: true,
    }))) return;
    try {
      await api('DELETE', comTenant(`/api/admin/lojas/${d.loja.id}`));
      mostrar({ tipo: 'info', titulo: 'Loja excluída.' });
      navegar('/painel-admin/lojas');
    } catch (e) {
      if (e instanceof ApiError) {
        mostrar({ tipo: 'erro', titulo: e.message, descricao: 'Dica: se tiver pedidos, suspenda a loja.' });
      }
    }
  }

  /* A impersonação é POR CLIENTE (tenant), não por loja — por isso o botão só
     existe quando a loja veio da lista agregada, que é onde o tenant é sabido. */
  async function entrarComoLojista() {
    if (!tenantId) return;
    try {
      const token = tokenSessao();
      const resp = await fetch(`/api/admin/tenants/${tenantId}/impersonar`, {
        method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(corpo.erro || `Falha ao entrar (HTTP ${resp.status}).`);
      const destino = destinoImpersonacao(corpo.redirecionar, corpo.token);
      if (destino) { window.open(destino, '_blank'); return; }
      await abrirSessaoLojistaImpersonada(corpo.token);
      window.open('/lojista', '_blank');
    } catch (e) {
      mostrar({ tipo: 'erro', titulo: e instanceof Error ? e.message : 'Falha ao entrar como lojista.' });
    }
  }

  /* ── Coluna do meio: filtro e busca dos pedidos ────────────────────────── */
  const [grupo, setGrupo] = useState<Grupo>('todos');
  const [busca, setBusca] = useState('');
  /* Fechado por padrão: são ajustes raros, e abertos empurrariam os pedidos —
     que é o que se olha todo dia — para fora da tela. */
  const [avancado, setAvancado] = useState(false);

  const pedidos = useMemo(() => {
    const todos = d?.pedidos ?? [];
    const t = busca.trim().toLowerCase();
    return todos.filter(p => {
      if (grupo === 'entregue' && p.status !== 'entregue') return false;
      if (grupo === 'andamento' && !ATIVOS.includes(p.status)) return false;
      if (grupo === 'cancelado' && p.status !== 'cancelado' && p.status !== 'recusado') return false;
      if (!t) return true;
      return `${p.cliente_nome} ${p.id}`.toLowerCase().includes(t);
    });
  }, [d?.pedidos, grupo, busca]);

  const contagem = (g: Grupo) => {
    const todos = d?.pedidos ?? [];
    if (g === 'todos') return todos.length;
    if (g === 'entregue') return todos.filter(p => p.status === 'entregue').length;
    if (g === 'andamento') return todos.filter(p => ATIVOS.includes(p.status)).length;
    return todos.filter(p => p.status === 'cancelado' || p.status === 'recusado').length;
  };
  const rotuloGrupo: Record<Grupo, string> = {
    todos: 'Todos', entregue: 'Entregues', andamento: 'Em andamento', cancelado: 'Cancelados',
  };

  if (consulta.isLoading) {
    return <div className="adm p-6"><Skeleton className="h-64" /></div>;
  }
  if (consulta.isError || !d) {
    return (
      <div className="adm p-6">
        <Falha erro={consulta.error} aoTentar={() => consulta.refetch()} />
      </div>
    );
  }

  const l = d.loja;
  const r = d.resumo;
  const url = l.dominio_personalizado
    ? `https://${l.dominio_personalizado}`
    : l.slug ? `/loja/${l.slug}` : '';

  /* Cancelamento como PROPORÇÃO: "34" sozinho não diz se é muito. */
  const taxaCancelamento = r.total > 0 ? Math.round((r.cancelados / r.total) * 100) : 0;

  return (
    <div className="adm flex h-screen flex-col" style={{ background: '#fff' }}>
      {/* ── Barra de topo ── */}
      <header
        className="flex shrink-0 flex-wrap items-center gap-3 px-4 py-2.5"
        style={{ borderBottom: '1px solid var(--adm-linha)' }}
      >
        <Link to="/painel-admin/lojas" className="text-[13px]" style={{ color: 'var(--adm-fg2)' }}>
          ‹ Lojas
        </Link>
        <span className="h-4 w-px shrink-0" style={{ background: 'var(--adm-linha)' }} />
        <span className="text-[18px] font-semibold">{l.nome}</span>
        <Status tom={TOM_SITUACAO[l.status_aprovacao] ?? 'neutro'}>
          {ROTULO_SITUACAO[l.status_aprovacao] ?? l.status_aprovacao}
        </Status>
        <Num className="text-[11.5px]" style={{ color: 'var(--adm-dado)' }}>
          {l.slug ? `/${l.slug}` : 'sem slug'} · {l.categoria}
        </Num>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {url && (
            <a href={url} target="_blank" rel="noreferrer"><Botao altura={30}>Abrir loja</Botao></a>
          )}
          {tenantId && (
            <Botao altura={30} onClick={() => void entrarComoLojista()}>Entrar como lojista</Botao>
          )}
          <Link to="/painel-admin/lojas" aria-label="Fechar"
            className="px-2 text-[18px] leading-none" style={{ color: 'var(--adm-dado)' }}>×</Link>
        </div>
      </header>

      {/* ── Faixa de números ── */}
      <div
        className="grid shrink-0 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
        style={{ borderBottom: '1px solid var(--adm-linha)' }}
      >
        {[
          {
            rotulo: 'Faturamento', valor: brl(r.faturamento_centavos),
            apoio: `últimos ${d.periodo_dias} dias`, cor: undefined as string | undefined,
          },
          {
            rotulo: 'Comissão', valor: brl(r.comissao_centavos),
            apoio: r.comissao_centavos === 0 ? 'isenta neste período' : 'da plataforma',
          },
          {
            rotulo: 'Repasse', valor: brl(r.repasse_centavos),
            apoio: 'a pagar', cor: 'var(--adm-ok)',
          },
          {
            rotulo: 'Ticket médio', valor: brl(r.ticket_medio_centavos),
            apoio: `${r.pedidos} ${r.pedidos === 1 ? 'entregue' : 'entregues'}`,
          },
          {
            /*
              CANCELAMENTO VIRA NÚMERO DE PRIMEIRA LINHA.
              Antes vivia escondido numa pill ao lado de "entregues", do mesmo
              tamanho e da mesma importância visual — e é o único dos cinco que
              indica problema.
            */
            rotulo: 'Cancelamento', valor: `${taxaCancelamento}%`,
            apoio: `${r.cancelados} de ${r.total} pedidos`,
            cor: r.cancelados > 0 ? 'var(--adm-erro)' : undefined,
          },
        ].map((k, i) => (
          <div
            key={k.rotulo}
            className="px-4 py-2.5"
            style={{ borderLeft: i === 0 ? undefined : '1px solid var(--adm-linha2)' }}
          >
            <div className="text-[11.5px]" style={{ color: 'var(--adm-rotulo)' }}>{k.rotulo}</div>
            <Num className="block text-[21px] leading-tight">{k.valor}</Num>
            <div className="text-[11.5px]" style={{ color: k.cor ?? 'var(--adm-dado)' }}>{k.apoio}</div>
          </div>
        ))}
      </div>

      {/* ── Três colunas ── */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Esquerda: dados, leitura */}
        <aside
          className="shrink-0 overflow-y-auto p-4 lg:w-[288px]"
          style={{ borderRight: '1px solid var(--adm-linha)' }}
        >
          <Bloco titulo="Loja" linhas={[
            ['slug', l.slug ?? '—', true],
            ['segmento', l.categoria, false],
            ['endereço', l.endereco || '—', false],
            ['cidade', [l.nfce_municipio, l.nfce_uf].filter(Boolean).join(' · ') || '—', false],
            ['criada em', l.criado_em ? dataLocal(l.criado_em) : '—', true],
          ]} />
          <Bloco titulo="Cadastro fiscal" linhas={[
            ['razão social', l.nfce_razao_social || '—', false],
            ['CNPJ', l.nfce_cnpj || '—', true],
            ['emissão', l.fiscal_liberado ? (l.nfce_ativo ? 'ligada' : 'liberada, desligada') : 'módulo bloqueado', false],
            ['canal', l.canal_versao === 'teste' ? 'Teste' : l.canal_versao === 'beta' ? 'Beta' : 'Recomendado', false],
          ]} />
          <Bloco titulo="Responsável" linhas={[
            ['lojista', l.dono_nome, false],
            ['e-mail', l.dono_email, true],
            ['telefone', l.dono_telefone || '—', true],
            ['acesso', l.dono_bloqueado ? 'bloqueado' : 'ativo', false],
          ]} />
          {/*
            "Último acesso" está no desenho e NÃO existe no banco: nada registra
            quando o lojista entrou pela última vez. A linha fica de fora em vez
            de mostrar um traço — traço parece defeito da tela, e some é honesto.
          */}
        </aside>

        {/* Centro: pedidos */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2.5"
            style={{ borderBottom: '1px solid var(--adm-linha)' }}>
            <Segmented
              valor={grupo}
              aoMudar={setGrupo}
              opcoes={(['todos', 'entregue', 'andamento', 'cancelado'] as Grupo[])
                .map(g => ({ v: g, label: rotuloGrupo[g], contagem: contagem(g) }))}
            />
            <div className="min-w-[160px] flex-1">
              <Busca valor={busca} aoMudar={setBusca} placeholder="Buscar cliente ou nº…" />
            </div>
            <Botao
              altura={30}
              desabilitado={pedidos.length === 0}
              onClick={() => baixarCsv(
                `pedidos-${l.slug || l.id}`,
                ['Pedido', 'Cliente', 'Quando', 'Status', 'Pagamento', 'Total'],
                pedidos.map(p => [
                  p.id, p.cliente_nome, dataLocal(p.criado_em),
                  ROTULO_PEDIDO[p.status] ?? p.status, p.forma_pagamento,
                  (p.total_centavos / 100).toFixed(2),
                ]),
              )}
            >
              Exportar CSV
            </Botao>
          </div>

          <div
            className="grid shrink-0 items-center gap-3 px-4 py-2 text-[11px] font-medium"
            style={{
              gridTemplateColumns: '76px minmax(0,1fr) 128px 104px 92px',
              color: 'var(--adm-dado)',
              borderBottom: '1px solid var(--adm-linha)',
              background: 'var(--adm-fundo2)',
            }}
          >
            <span>Pedido</span>
            <span>Cliente</span>
            <span>Quando</span>
            <span>Status</span>
            <span className="text-right">Total</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {pedidos.map((p, i) => (
              <LinhaPedido key={p.id} p={p} primeira={i === 0} />
            ))}
            {pedidos.length === 0 && (
              <p className="px-4 py-10 text-center text-[12.5px]" style={{ color: 'var(--adm-dado)' }}>
                {grupo === 'todos' && !busca
                  ? `Nenhum pedido nos últimos ${d.periodo_dias} dias.`
                  : `Nenhum pedido em ${rotuloGrupo[grupo]}.`}
              </p>
            )}
          </div>

          <div
            className="flex shrink-0 items-center justify-between gap-3 px-4 py-2"
            style={{ borderTop: '1px solid var(--adm-linha)', background: 'var(--adm-fundo2)' }}
          >
            <span className="text-[12px]" style={{ color: 'var(--adm-dado)' }}>
              {pedidos.length === 0
                ? `Nenhum pedido em ${rotuloGrupo[grupo]}`
                : `${pedidos.length} de ${d.pedidos.length} pedidos${grupo === 'todos' ? '' : ` em ${rotuloGrupo[grupo]}`}`}
            </span>
            <Link to={`/painel-admin/pedidos?loja_id=${l.id}`} className="text-[12px] text-primary">
              Ver todos
            </Link>
          </div>
        </section>

        {/* Direita: o que se edita */}
        <aside
          className="flex shrink-0 flex-col overflow-hidden lg:w-[300px]"
          style={{ borderLeft: '1px solid var(--adm-linha)' }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <Rotulo>Comissão</Rotulo>
            <div className="flex items-center gap-2 pb-1">
              <input
                value={comissao}
                onChange={e => setComissao(e.target.value.replace(/[^\d.,]/g, ''))}
                inputMode="decimal"
                placeholder="—"
                aria-label="Comissão desta loja em %"
                className="adm-num h-[34px] w-16 px-2 text-right text-[13px] outline-none"
                style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, boxSizing: 'border-box' }}
              />
              <span className="text-[12.5px]" style={{ color: 'var(--adm-fg2)' }}>%</span>
            </div>
            {/*
              A REFERÊNCIA HERDADA precisa estar à vista: sem ela, o campo vazio
              não diz nada, e quem digita 10 não sabe se está aumentando ou
              diminuindo o que a loja já pagava.
            */}
            <p className="pb-5 text-[11.5px]" style={{ color: 'var(--adm-dado)' }}>
              {comissao.trim() === ''
                ? `vazio = herda o padrão da plataforma (${d.comissao_padrao}%)`
                : `acordo próprio · padrão da plataforma: ${d.comissao_padrao}%`}
            </p>

            <Rotulo>Módulos</Rotulo>
            <Interruptor
              titulo="Emissão fiscal"
              descricao={fiscal ? 'o lojista vê a aba Fiscal e pode emitir' : 'a aba Fiscal não aparece e nenhuma nota sai'}
              ligado={fiscal}
              aoMudar={setFiscal}
            />
            <Interruptor
              titulo="Vendas (PDV, mesas e caixa)"
              descricao={vendas ? 'o lojista vê a aba Vendas' : 'a aba Vendas não aparece no painel dele'}
              ligado={vendas}
              aoMudar={setVendas}
            />
            {/*
              "LOJA ABERTA" É LEITURA, NÃO INTERRUPTOR.
              Com `auto_horario`, um job a cada 60s força `aberta` conforme a
              agenda da loja. Um interruptor aqui seria desfeito sozinho em um
              minuto — controle que não obedece é pior que controle que não
              existe, porque ensina a desconfiar dos outros.
            */}
            <div className="py-2" style={{ borderTop: '1px solid var(--adm-linha3)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium">Loja aberta</span>
                <Status tom={l.aberta ? 'ok' : 'inativo'}>{l.aberta ? 'Aberta' : 'Fechada'}</Status>
              </div>
              <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--adm-dado)' }}>
                {d.abertura_automatica
                  ? 'segue o horário cadastrado pelo lojista — não dá para forçar daqui'
                  : 'controlada manualmente pelo lojista'}
              </p>
            </div>

            <div className="pt-4">
              <Botao altura={30} onClick={() => setAvancado(v => !v)}>
                {avancado ? 'Fechar configuração' : 'Configuração avançada'}
              </Botao>
              <p className="pt-1 text-[11.5px] leading-relaxed" style={{ color: 'var(--adm-dado)' }}>
                Domínio, WhatsApp, canal de liberação e cadastro fiscal.
              </p>
            </div>

            <div className="pt-4">
              <Rotulo>Histórico</Rotulo>
              {d.auditoria.length === 0 ? (
                <p className="text-[12px]" style={{ color: 'var(--adm-dado)' }}>
                  Nada registrado para esta loja.
                </p>
              ) : (
                <ul className="space-y-2">
                  {d.auditoria.map((a, i) => (
                    <li key={i} className="text-[12px] leading-relaxed">
                      <div>{a.acao}{a.detalhes && <span style={{ color: 'var(--adm-fg2)' }}> — {a.detalhes}</span>}</div>
                      <Num className="text-[11px]" style={{ color: 'var(--adm-dado)' }}>
                        {dataLocal(a.criado_em)} · {a.admin_nome}
                      </Num>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div
            className="flex shrink-0 items-center gap-2 px-4 py-2.5"
            style={{ borderTop: '1px solid var(--adm-linha)', background: 'var(--adm-fundo2)' }}
          >
            <Botao altura={30} onClick={() => void suspender()}>
              {l.status_aprovacao === 'suspensa' ? 'Reativar' : 'Suspender'}
            </Botao>
            {superAdmin && (
              <Botao altura={30} variante="perigo" onClick={() => void excluir()}>Excluir</Botao>
            )}
          </div>
        </aside>
      </div>

      {/*
        CONFIGURAÇÃO AVANÇADA em largura inteira, por baixo das colunas.
        Os editores que moravam no painel lateral antigo continuam aqui — nada
        do que existia se perdeu, só mudou de lugar.
      */}
      {avancado && (
        <div
          className="max-h-[60vh] shrink-0 overflow-y-auto px-4 py-3"
          style={{ borderTop: '1px solid var(--adm-linha)', background: 'var(--adm-fundo2)' }}
        >
          <div className="mx-auto max-w-3xl">
            {(() => {
              /* Os editores esperam o objeto `Loja` da lista. Aqui só existem os
                 campos que a tela usa, então o objeto é montado com eles. */
              const comoLoja = {
                ...l,
                tenant_id: tenantId ? Number(tenantId) : undefined,
              } as unknown as Loja;
              return (
                <>
                  <DominioLojaEditor loja={comoLoja} onSalvo={() => void consulta.refetch()} />
                  <WhatsAppPermissoesEditor loja={comoLoja} onSalvo={() => void consulta.refetch()} />
                  {superAdmin && <ModulosDaLoja loja={comoLoja} />}
                  {superAdmin && <FiscalLojaAdmin loja={comoLoja} />}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Barra de alterações ── */}
      {sujo && (
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-4 py-2.5"
          style={{ borderTop: '1px solid var(--adm-linha)', background: 'var(--adm-fundo2)' }}
        >
          <span className="text-[12.5px]" style={{ color: 'var(--adm-fg2)' }}>Alterações não salvas</span>
          <div className="flex items-center gap-2">
            <Botao altura={30} onClick={descartar} desabilitado={salvando}>Descartar</Botao>
            <Botao altura={30} variante="primario" onClick={() => void salvar()} desabilitado={salvando}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Botao>
          </div>
        </div>
      )}
    </div>
  );
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--adm-rotulo)' }}>
      {children}
    </div>
  );
}

/** Bloco de leitura: chave à esquerda, valor à direita, mono no dado técnico. */
function Bloco({ titulo, linhas }: { titulo: string; linhas: [string, string, boolean][] }) {
  return (
    <div className="pb-5">
      <Rotulo>{titulo}</Rotulo>
      <dl>
        {linhas.map(([chave, valor, mono], i) => (
          <div
            key={chave}
            className="flex gap-2 py-1.5"
            style={{ borderTop: i === 0 ? undefined : '1px solid var(--adm-linha3)' }}
          >
            <dt className="w-[96px] shrink-0 text-[12px]" style={{ color: 'var(--adm-rotulo)' }}>{chave}</dt>
            <dd className="min-w-0 flex-1 break-words text-[12.5px]">
              {mono ? <Num>{valor}</Num> : valor}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Interruptor 38×21 chapado. SEM transition na propriedade que muda de valor —
 * transition em `background`/`left` congela o repaint e o controle mostra o
 * estado anterior. Foi o bug que derrubou o protótipo duas vezes.
 */
function Interruptor({ titulo, descricao, ligado, aoMudar }: {
  titulo: string; descricao: string; ligado: boolean; aoMudar: (v: boolean) => void;
}) {
  return (
    <div className="py-2" style={{ borderTop: '1px solid var(--adm-linha3)' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium">{titulo}</span>
        <button
          type="button"
          role="switch"
          aria-checked={ligado}
          aria-label={titulo}
          onClick={() => aoMudar(!ligado)}
          className="adm-switch"
          style={{ background: ligado ? 'var(--adm-fg)' : '#D9D5D0' }}
        >
          <span style={{ left: ligado ? 20 : 3 }} />
        </button>
      </div>
      <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--adm-dado)' }}>{descricao}</p>
    </div>
  );
}

function LinhaPedido({ p, primeira }: { p: PedidoLoja; primeira: boolean }) {
  const [sobre, setSobre] = useState(false);
  return (
    <div
      onMouseEnter={() => setSobre(true)}
      onMouseLeave={() => setSobre(false)}
      className="grid items-center gap-3 px-4 py-[10px] text-[13px]"
      style={{
        gridTemplateColumns: '76px minmax(0,1fr) 128px 104px 92px',
        borderTop: primeira ? undefined : '1px solid var(--adm-linha3)',
        background: sobre ? 'var(--adm-fundo2)' : '#fff',
      }}
    >
      <Num className="text-[12px]">#{String(p.id).padStart(4, '0')}</Num>
      <span className="truncate">{p.cliente_nome || <Vazio />}</span>
      {/* A COLUNA "QUANDO" não existia no painel antigo — sem ela, "34
          cancelados" não dizia se foram ontem ou espalhados em três meses. */}
      <Num className="text-[12px]">{dataLocal(p.criado_em)}</Num>
      <Status tom={TOM_PEDIDO[p.status] ?? 'neutro'}>{ROTULO_PEDIDO[p.status] ?? p.status}</Status>
      <Num className="text-right">{brl(p.total_centavos)}</Num>
    </div>
  );
}
