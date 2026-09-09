/**
 * DETALHE DA LOJA EM TELA CHEIA, COM ABAS.
 *
 * A versão anterior tinha três colunas rolando separadas. Funcionava para os
 * números, mas espremia o resto: endereço e razão social quebravam em quatro
 * linhas numa coluna de 288px, e a configuração pesada precisava de um botão
 * "avançado" porque não cabia em lugar nenhum.
 *
 * Uma aba por ASSUNTO, largura inteira, um scroll só. Barra de topo, abas e
 * rodapé de ações ficam parados — o contexto (de quem é esta loja) e o que se
 * pode fazer com ela não somem enquanto se percorre pedidos ou histórico.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, ehSuperAdmin, entrarComoLojista as entrarNoPainelDoLojista } from '@/lib/api';
import { brl, dataLocal } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { Skeleton } from '@/components/ui/skeleton';
import { Falha } from '@/components/ui/estado';
import { cn } from '@/lib/utils';
import {
  Num, Status, Botao, Busca, Segmented, Vazio, baixarCsv, type Tom,
} from './ui';
import { MarcaX } from './marca-x';
/*
 * Os editores pesados vêm da tela de Lojas, onde já viviam. Domínio, WhatsApp,
 * canal e cadastro fiscal não têm outra casa no painel — cada um agora aparece
 * na ABA do seu assunto, em largura inteira, em vez de espremido numa coluna.
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
  nfce_razao_social: string | null; nfce_cnpj: string | null; nfce_ie: string | null;
  nfce_crt: number; nfce_cmun: string | null; nfce_ambiente: number;
  nfce_serie: number; nfce_proximo_numero: number;
  nfce_ncm_padrao: string; nfce_cfop_padrao: string; nfce_csosn_padrao: string;
  nfce_csc_id: string | null; nfce_cert_titular: string | null; nfce_cert_validade: string | null;
  tem_csc: 0 | 1;
  whatsapp_permite_oficial: 0 | 1; whatsapp_permite_nao_oficial: 0 | 1;
  dono_id: number; dono_nome: string; dono_email: string;
  dono_telefone: string | null; dono_bloqueado: 0 | 1; dono_totp: 0 | 1;
  /** Vazio = não entrou desde que a coluna existe — NÃO é o mesmo que nunca. */
  dono_ultimo_acesso: string | null;
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
  auditoria: {
    acao: string; alvo_desc: string; detalhes: string; criado_em: string;
    admin_nome: string; ip: string | null;
  }[];
  comissao_padrao: number;
  abertura_automatica: boolean;
  certificado_instalado: boolean;
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

type Aba = 'resumo' | 'pedidos' | 'cadastro' | 'configuracao' | 'fiscal' | 'historico';
type Grupo = 'todos' | 'entregue' | 'andamento' | 'cancelado';
/**
 * O CHAT DE DIAGNÓSTICO E SUPORTE ESTÁ FORA DA TELA.
 *
 * Desligado a pedido, enquanto a metade de IA não tem crédito de API pago:
 * botão que abre um painel onde a pergunta não é respondida ensina a
 * desconfiar do painel inteiro. O dossiê da loja funciona sem chave e sem
 * custo, mas sem a pergunta ele não justificava um botão flutuante próprio.
 *
 * Para trazer de volta: `true` aqui, e o teste que guarda o desligamento
 * (`loja-painel.test.ts`, "o chat está fora da tela por um interruptor só")
 * passa a esperar `true`. São duas linhas de propósito: religar é decisão, e
 * decisão fica registrada. A fiação está inteira — botão, estado e
 * `ChatSuporte` continuam no arquivo, e a rota `POST /lojas/:id/suporte`
 * continua no servidor. Nada mais precisa mudar.
 */
const SUPORTE_NA_TELA = false;

const ATIVOS = ['pendente', 'aceito', 'preparando', 'pronto', 'em_entrega'];
const PAGINA = 12;

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

  const [aba, setAba] = useState<Aba>('resumo');
  const [chat, setChat] = useState(false);

  /* ── O que se edita ────────────────────────────────────────────────────── */
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
   * Comissão e os dois módulos moram em endpoints diferentes porque são
   * decisões diferentes. A barra junta as três na TELA — que é onde a pessoa
   * pensa nelas juntas — sem juntar no servidor.
   */
  async function salvar(forcarFiscal?: boolean) {
    if (!d) return;
    const alvoFiscal = forcarFiscal ?? fiscal;
    setSalvando(true);
    try {
      if (comissao !== comissaoOriginal) {
        const n = comissao.trim() === '' ? null : Number(comissao.replace(',', '.'));
        if (n !== null && (!Number.isFinite(n) || n < 0 || n > 50)) {
          throw new ApiError(400, 'Comissão inválida: use um número entre 0 e 50, ou deixe vazio para herdar o padrão.');
        }
        await api('PUT', comTenant(`/api/admin/lojas/${d.loja.id}/comissao`), { comissao_percentual: n });
      }
      if (alvoFiscal !== !!d.loja.fiscal_liberado) {
        await api('PUT', comTenant(`/api/admin/lojas/${d.loja.id}/modulo/fiscal`), { liberado: alvoFiscal });
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
      await entrarNoPainelDoLojista(tenantId, {
        avisar: msg => mostrar({ tipo: 'info', titulo: msg }),
      });
    } catch (e) {
      mostrar({ tipo: 'erro', titulo: e instanceof Error ? e.message : 'Falha ao entrar como lojista.' });
    }
  }

  /* ── Aba de pedidos ───────────────────────────────────────────────────── */
  const [grupo, setGrupo] = useState<Grupo>('todos');
  const [busca, setBusca] = useState('');
  const [visiveis, setVisiveis] = useState(PAGINA);

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
    return <div className="adm p-6"><Falha erro={consulta.error} aoTentar={() => consulta.refetch()} /></div>;
  }

  const l = d.loja;
  const r = d.resumo;
  const url = l.dominio_personalizado
    ? `https://${l.dominio_personalizado}`
    : l.slug ? `/loja/${l.slug}` : '';
  const taxaCancelamento = r.total > 0 ? Math.round((r.cancelados / r.total) * 100) : 0;

  /*
   * OS PONTOS DE ATENÇÃO alimentam o Resumo E o contador da aba Configuração.
   *
   * Calculados uma vez: se o Resumo dissesse "3 pendências" e a aba mostrasse
   * 2, a pessoa deixaria de confiar nos dois números.
   */
  const atencao: { texto: string; consequencia: string; aba: Aba }[] = [];
  if (!l.fiscal_liberado) {
    atencao.push({
      texto: 'Módulo fiscal bloqueado',
      consequencia: 'A aba Fiscal não aparece no painel dele e nenhuma nota sai.',
      aba: 'fiscal',
    });
  }
  if (!l.vendas_liberado) {
    atencao.push({
      texto: 'Módulo de vendas bloqueado',
      consequencia: 'A aba Vendas não aparece no painel dele. O histórico fica guardado.',
      aba: 'configuracao',
    });
  }
  if (l.comissao_percentual == null && d.comissao_padrao === 0) {
    atencao.push({
      texto: 'Comissão herdando 0%',
      consequencia: 'A plataforma não recebe nada desta loja.',
      aba: 'configuracao',
    });
  }
  if (l.dono_bloqueado) {
    atencao.push({
      texto: 'O acesso do lojista está bloqueado',
      consequencia: 'Ele não consegue entrar no painel.',
      aba: 'cadastro',
    });
  }

  const ABAS: { id: Aba; rotulo: string; contagem?: number; alerta?: boolean; nota?: string }[] = [
    { id: 'resumo', rotulo: 'Resumo' },
    { id: 'pedidos', rotulo: 'Pedidos', contagem: d.pedidos.length },
    { id: 'cadastro', rotulo: 'Cadastro' },
    { id: 'configuracao', rotulo: 'Configuração', contagem: atencao.length || undefined, alerta: atencao.length > 0 },
    { id: 'fiscal', rotulo: 'Fiscal (NFC-e)', nota: l.fiscal_liberado ? undefined : 'bloqueado' },
    { id: 'historico', rotulo: 'Histórico', contagem: d.auditoria.length },
  ];

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
          {url && <a href={url} target="_blank" rel="noreferrer"><Botao altura={30}>Abrir loja</Botao></a>}
          {tenantId && (
            <Botao altura={30} onClick={() => void entrarComoLojista()}>Entrar como lojista</Botao>
          )}
          <Link to="/painel-admin/lojas" aria-label="Fechar"
            className="px-2 text-[18px] leading-none" style={{ color: 'var(--adm-dado)' }}>×</Link>
        </div>
      </header>

      {/* ── Abas ── */}
      <nav
        className="flex shrink-0 gap-1 overflow-x-auto px-4"
        style={{ borderBottom: '1px solid var(--adm-linha)' }}
      >
        {ABAS.map(a => {
          const ativa = aba === a.id;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setAba(a.id)}
              aria-current={ativa ? 'page' : undefined}
              className="flex shrink-0 items-center gap-1.5 px-2.5 py-2 text-[13px]"
              style={{
                /* Sem transition: `border-bottom-color` recebe o valor dinâmico,
                   e a transition congela o repaint na aba anterior. */
                borderBottom: `2px solid ${ativa ? 'var(--adm-fg)' : 'transparent'}`,
                fontWeight: ativa ? 600 : 400,
                color: ativa ? 'var(--adm-fg)' : 'var(--adm-fg2)',
                marginBottom: -1,
              }}
            >
              {a.rotulo}
              {a.contagem !== undefined && (
                <Num
                  className="text-[11px]"
                  style={{ color: a.alerta ? 'var(--adm-pendencia)' : 'var(--adm-dado)' }}
                >
                  {a.contagem}
                </Num>
              )}
              {a.nota && (
                <span className="text-[11px]" style={{ color: 'var(--adm-pendencia)' }}>{a.nota}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Conteúdo ── */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {aba === 'resumo' && (
          <>
            <div
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
              style={{ borderBottom: '1px solid var(--adm-linha)' }}
            >
              {[
                { rotulo: 'Faturamento', valor: brl(r.faturamento_centavos), apoio: `últimos ${d.periodo_dias} dias` },
                {
                  rotulo: 'Comissão', valor: brl(r.comissao_centavos),
                  apoio: l.comissao_percentual == null
                    ? `herda o padrão (${d.comissao_padrao}%)`
                    : `${l.comissao_percentual}% próprio`,
                },
                { rotulo: 'Repasse', valor: brl(r.repasse_centavos), apoio: 'a pagar', cor: 'var(--adm-ok)' },
                { rotulo: 'Ticket médio', valor: brl(r.ticket_medio_centavos), apoio: `${r.pedidos} entregues` },
                {
                  /*
                    CANCELAMENTO VIRA NÚMERO DE PRIMEIRA LINHA. Antes vivia numa
                    pill ao lado de "entregues", do mesmo tamanho e da mesma
                    importância — e é o único dos cinco que indica problema.
                  */
                  rotulo: 'Cancelamento', valor: `${taxaCancelamento}%`,
                  apoio: `${r.cancelados} de ${r.total} pedidos`,
                  cor: r.cancelados > 0 ? 'var(--adm-erro)' : undefined,
                },
              ].map((k, i) => (
                <div key={k.rotulo} className="px-4 py-3"
                  style={{ borderLeft: i === 0 ? undefined : '1px solid var(--adm-linha2)' }}>
                  <div className="text-[11.5px]" style={{ color: 'var(--adm-rotulo)' }}>{k.rotulo}</div>
                  <Num className="block text-[23px] leading-tight">{k.valor}</Num>
                  <div className="text-[11.5px]" style={{ color: k.cor ?? 'var(--adm-dado)' }}>{k.apoio}</div>
                </div>
              ))}
            </div>

            <div className="grid gap-5 p-4 lg:grid-cols-2">
              <section>
                <Rotulo>Precisa de atenção</Rotulo>
                {atencao.length === 0 ? (
                  <p className="text-[12.5px]" style={{ color: 'var(--adm-dado)' }}>
                    Nada pendente nesta loja.
                  </p>
                ) : (
                  <div style={{ border: '1px solid var(--adm-linha)', borderRadius: 6 }}>
                    {atencao.map((a, i) => (
                      <div key={a.texto} className="flex flex-wrap items-center gap-3 px-3 py-2.5"
                        style={{ borderTop: i === 0 ? undefined : '1px solid var(--adm-linha3)' }}>
                        <div className="min-w-0 flex-1">
                          <Status tom="atencao">{a.texto}</Status>
                          <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--adm-dado)' }}>
                            {a.consequencia}
                          </p>
                        </div>
                        {/* Leva PARA A ABA CERTA: mandar a pessoa "procurar em
                            Configuração" é fazê-la repetir a busca que este
                            bloco acabou de fazer. */}
                        <Botao altura={30} onClick={() => setAba(a.aba)}>Resolver</Botao>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className="flex items-baseline justify-between">
                  <Rotulo>Últimos pedidos</Rotulo>
                  <button type="button" className="pb-1.5 text-[12px] text-primary" onClick={() => setAba('pedidos')}>
                    ver todos
                  </button>
                </div>
                <div style={{ border: '1px solid var(--adm-linha)', borderRadius: 6 }}>
                  {d.pedidos.slice(0, 5).map((p, i) => (
                    <div key={p.id} className="grid items-center gap-3 px-3 py-2 text-[12.5px]"
                      style={{
                        gridTemplateColumns: '70px minmax(0,1fr) 104px 92px',
                        borderTop: i === 0 ? undefined : '1px solid var(--adm-linha3)',
                      }}>
                      <Num className="text-[11.5px]">#{String(p.id).padStart(4, '0')}</Num>
                      <span className="truncate">{p.cliente_nome || <Vazio />}</span>
                      <Status tom={TOM_PEDIDO[p.status] ?? 'neutro'}>{ROTULO_PEDIDO[p.status] ?? p.status}</Status>
                      <Num className="text-right">{brl(p.total_centavos)}</Num>
                    </div>
                  ))}
                  {d.pedidos.length === 0 && (
                    <p className="px-3 py-6 text-center text-[12.5px]" style={{ color: 'var(--adm-dado)' }}>
                      Nenhum pedido nos últimos {d.periodo_dias} dias.
                    </p>
                  )}
                </div>
              </section>
            </div>
          </>
        )}

        {aba === 'pedidos' && (
          <div className="p-4">
            <div className="flex flex-wrap items-center gap-2 pb-3">
              <Segmented
                valor={grupo}
                aoMudar={g => { setGrupo(g); setVisiveis(PAGINA); }}
                opcoes={(['todos', 'entregue', 'andamento', 'cancelado'] as Grupo[])
                  .map(g => ({ v: g, label: rotuloGrupo[g], contagem: contagem(g) }))}
              />
              <div className="min-w-[180px] flex-1">
                <Busca valor={busca} aoMudar={v => { setBusca(v); setVisiveis(PAGINA); }}
                  placeholder="Buscar cliente ou nº…" />
              </div>
              <Botao
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

            <div style={{ border: '1px solid var(--adm-linha)', borderRadius: 6 }}>
              <div className="grid items-center gap-3 px-3 py-2 text-[11px] font-medium"
                style={{
                  gridTemplateColumns: '84px minmax(0,1fr) 168px 130px 116px',
                  color: 'var(--adm-dado)',
                  borderBottom: '1px solid var(--adm-linha)',
                  background: 'var(--adm-fundo2)',
                }}>
                <span>Pedido</span>
                <span>Cliente</span>
                <span>Quando</span>
                <span>Status</span>
                <span className="text-right">Total</span>
              </div>
              {pedidos.slice(0, visiveis).map((p, i) => (
                <div key={p.id} className="grid items-center gap-3 px-3 py-[10px] text-[13px]"
                  style={{
                    gridTemplateColumns: '84px minmax(0,1fr) 168px 130px 116px',
                    borderTop: i === 0 ? undefined : '1px solid var(--adm-linha3)',
                  }}>
                  <Num className="text-[12px]">#{String(p.id).padStart(4, '0')}</Num>
                  <span className="truncate">{p.cliente_nome || <Vazio />}</span>
                  {/* Data E HORA completas: "34 cancelados" não dizia se foram
                      todos numa noite ou espalhados em três meses. */}
                  <Num className="text-[12px]">{dataLocal(p.criado_em)}</Num>
                  <Status tom={TOM_PEDIDO[p.status] ?? 'neutro'}>{ROTULO_PEDIDO[p.status] ?? p.status}</Status>
                  <Num className="text-right">{brl(p.total_centavos)}</Num>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 px-3 py-2"
                style={{ borderTop: '1px solid var(--adm-linha)', background: 'var(--adm-fundo2)' }}>
                <span className="text-[12px]" style={{ color: 'var(--adm-dado)' }}>
                  {pedidos.length === 0
                    ? `Nenhum pedido em ${rotuloGrupo[grupo]}`
                    : `${Math.min(visiveis, pedidos.length)} de ${pedidos.length} pedidos${grupo === 'todos' ? '' : ` em ${rotuloGrupo[grupo]}`}`}
                </span>
                {pedidos.length > visiveis && (
                  <Botao altura={30} onClick={() => setVisiveis(v => v + PAGINA)}>Carregar mais</Botao>
                )}
              </div>
            </div>
          </div>
        )}

        {aba === 'cadastro' && (
          <div className="grid gap-5 p-4 lg:grid-cols-3">
            <Bloco titulo="Loja" linhas={[
              ['slug', l.slug ?? '—', true],
              ['segmento', l.categoria, false],
              ['endereço', l.endereco || '—', false],
              ['cidade', [l.nfce_municipio, l.nfce_uf].filter(Boolean).join(' · ') || '—', false],
              ['criada em', l.criado_em ? dataLocal(l.criado_em) : '—', true],
              ['canal', l.canal_versao === 'teste' ? 'Teste' : l.canal_versao === 'beta' ? 'Beta' : 'Recomendado', false],
            ]} />
            <Bloco titulo="Cadastro fiscal" linhas={[
              ['razão social', l.nfce_razao_social || '—', false],
              ['CNPJ', l.nfce_cnpj || '—', true],
              ['inscrição estadual', l.nfce_ie || '—', true],
              ['emissão', l.fiscal_liberado ? (l.nfce_ativo ? 'ligada' : 'liberada, desligada') : 'módulo bloqueado', false],
              ['certificado', d.certificado_instalado
                ? `instalado${l.nfce_cert_validade ? ` · vence ${dataLocal(l.nfce_cert_validade)}` : ''}`
                : 'não enviado', false],
            ]} />
            <Bloco titulo="Responsável" linhas={[
              ['lojista', l.dono_nome, false],
              ['e-mail', l.dono_email, true],
              ['telefone', l.dono_telefone || '—', true],
              ['acesso', l.dono_bloqueado ? 'bloqueado' : 'ativo', false],
              ['2FA', l.dono_totp ? 'ativo' : 'não configurado', false],
              /*
                "sem registro" e não "nunca entrou": quem entrou ANTES de a
                coluna existir aparece vazio até o próximo login, e escrever
                "nunca entrou" acusaria de inativo um cliente que usa o sistema
                todo dia.
              */
              ['último acesso', l.dono_ultimo_acesso ? dataLocal(l.dono_ultimo_acesso) : 'sem registro', true],
            ]} />
          </div>
        )}

        {aba === 'configuracao' && (
          <div className="grid gap-5 p-4 lg:grid-cols-2">
            <section>
              <Rotulo>Módulos contratados</Rotulo>
              <div style={{ border: '1px solid var(--adm-linha)', borderRadius: 6 }}>
                <Interruptor
                  titulo="Vendas (PDV, mesas e caixa)"
                  descricao="A aba Vendas não aparece no painel dele. O histórico fica guardado."
                  descricaoLigado="O lojista vê a aba Vendas: balcão, mesas e caixa."
                  ligado={vendas} aoMudar={setVendas} primeira
                />
                <Interruptor
                  titulo="Fiscal (NFC-e)"
                  descricao="A aba Fiscal não aparece e nenhuma nota sai. O cadastro fica guardado."
                  descricaoLigado="O lojista vê a aba Fiscal e pode emitir NFC-e."
                  ligado={fiscal} aoMudar={setFiscal}
                />
                {/*
                  "LOJA ABERTA" É LEITURA, NÃO INTERRUPTOR.
                  Com o horário automático, um job a cada 60s força `aberta`
                  conforme a agenda. Um interruptor aqui seria desfeito sozinho
                  em um minuto — e controle que não obedece é pior que controle
                  que não existe, porque ensina a desconfiar dos outros.
                */}
                <div className="px-3 py-2.5" style={{ borderTop: '1px solid var(--adm-linha3)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium">Loja aberta</span>
                    <Status tom={l.aberta ? 'ok' : 'inativo'}>{l.aberta ? 'Aberta' : 'Fechada'}</Status>
                  </div>
                  <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--adm-dado)' }}>
                    controlada pelo lojista — o admin não altera
                  </p>
                </div>
              </div>
            </section>

            <section>
              <Rotulo>Comissão</Rotulo>
              <div className="px-3 py-3" style={{ border: '1px solid var(--adm-linha)', borderRadius: 6 }}>
                <div className="flex items-center gap-2">
                  <input
                    value={comissao}
                    onChange={e => setComissao(e.target.value.replace(/[^\d.,]/g, ''))}
                    inputMode="decimal"
                    placeholder="—"
                    aria-label="Comissão desta loja em %"
                    className="adm-num h-[34px] w-[68px] px-2 text-right text-[13px] outline-none"
                    style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, boxSizing: 'border-box' }}
                  />
                  <span className="text-[12.5px]" style={{ color: 'var(--adm-fg2)' }}>%</span>
                </div>
                {/* A REFERÊNCIA HERDADA à vista: sem ela, quem digita 10 não
                    sabe se está aumentando ou diminuindo o que a loja pagava. */}
                <p className="pt-1.5 text-[11.5px]" style={{ color: 'var(--adm-dado)' }}>
                  vazio = herda o padrão da plataforma ({d.comissao_padrao}%)
                </p>
              </div>
            </section>

            {superAdmin && (
              <section className="lg:col-span-2">
                <ModulosDaLoja loja={comoLoja(l, tenantId)} />
              </section>
            )}

            <section>
              <DominioLojaEditor loja={comoLoja(l, tenantId)} onSalvo={() => void consulta.refetch()} />
            </section>

            <section>
              <WhatsAppPermissoesEditor loja={comoLoja(l, tenantId)} onSalvo={() => void consulta.refetch()} />
            </section>
          </div>
        )}

        {aba === 'fiscal' && (
          <div className="p-4">
            {/*
              A FAIXA RESOLVE SEM SAIR DA ABA.
              Quem abre "Fiscal" e encontra tudo cinza precisa saber por quê — e
              poder liberar ali, em vez de descobrir que o interruptor está em
              outra aba.
            */}
            {!l.fiscal_liberado && (
              <div className="mb-4 flex flex-wrap items-center gap-3 px-3 py-2.5"
                style={{ border: '1px solid var(--adm-atencao)', borderRadius: 6, background: 'rgba(199,154,75,0.06)' }}>
                <div className="min-w-0 flex-1">
                  <Status tom="atencao">Módulo fiscal bloqueado para esta loja</Status>
                  <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--adm-dado)' }}>
                    A aba Fiscal não aparece no painel dele e nenhuma nota sai. O cadastro abaixo fica guardado.
                  </p>
                </div>
                {/* Passa o alvo direto: sem isso, o `salvar` leria o estado
                    anterior do React e o clique não faria nada. */}
                <Botao altura={30} variante="primario" desabilitado={salvando}
                  onClick={() => { setFiscal(true); void salvar(true); }}>
                  Liberar módulo
                </Botao>
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <section>
                <Rotulo>Etapas do lojista</Rotulo>
                <div style={{ border: '1px solid var(--adm-linha)', borderRadius: 6 }}>
                  {[
                    {
                      n: 1, nome: 'Certificado A1', apoio: 'assina cada nota emitida',
                      ok: d.certificado_instalado,
                      estado: d.certificado_instalado ? 'instalado' : 'não enviado',
                    },
                    {
                      n: 2, nome: 'Dados do emitente', apoio: 'CNPJ, razão social, endereço',
                      ok: !!l.nfce_cnpj, estado: l.nfce_cnpj ? 'confirmado' : 'incompleto',
                    },
                    {
                      n: 3, nome: 'CSC e numeração', apoio: 'código do contribuinte e série',
                      ok: !!l.tem_csc, estado: l.tem_csc ? `série ${l.nfce_serie}` : 'não configurado',
                    },
                    {
                      n: 4, nome: 'Tributação padrão', apoio: 'NCM, CFOP e CSOSN dos produtos',
                      ok: !!l.nfce_ncm_padrao, estado: l.nfce_ncm_padrao ? 'definida' : 'revisar',
                    },
                    {
                      n: 5, nome: 'Ambiente', apoio: 'onde as notas são autorizadas',
                      ok: Number(l.nfce_ambiente) === 1,
                      estado: Number(l.nfce_ambiente) === 1 ? 'produção' : 'homologação',
                    },
                  ].map((e, i) => (
                    <div key={e.n} className="flex items-center gap-3 px-3 py-2.5"
                      style={{ borderTop: i === 0 ? undefined : '1px solid var(--adm-linha3)' }}>
                      <Num className="w-4 shrink-0 text-[12px]" style={{ color: 'var(--adm-dado)' }}>{e.n}</Num>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium">{e.nome}</div>
                        <div className="text-[11.5px]" style={{ color: 'var(--adm-dado)' }}>{e.apoio}</div>
                      </div>
                      <Status tom={e.ok ? 'ok' : 'atencao'}>{e.estado}</Status>
                    </div>
                  ))}
                </div>
                <p className="pt-2 text-[11.5px] leading-relaxed" style={{ color: 'var(--adm-dado)' }}>
                  O lojista completa estas etapas no painel dele. Aqui você só acompanha e libera o módulo.
                </p>
              </section>

              <Bloco titulo="Dados declarados" linhas={[
                ['regime', Number(l.nfce_crt) === 1 ? 'Simples Nacional' : `CRT ${l.nfce_crt}`, false],
                ['CNPJ', l.nfce_cnpj || '—', true],
                ['inscrição estadual', l.nfce_ie || '—', true],
                ['município (IBGE)', l.nfce_cmun || '—', true],
                ['NCM padrão', l.nfce_ncm_padrao || '—', true],
                ['CSOSN', l.nfce_csosn_padrao || '—', true],
                ['CFOP', l.nfce_cfop_padrao || '—', true],
                ['série / próximo nº', `${l.nfce_serie} / ${l.nfce_proximo_numero}`, true],
              ]} />
            </div>

            {superAdmin && (
              <div className="pt-5">
                <FiscalLojaAdmin loja={comoLoja(l, tenantId)} />
              </div>
            )}
          </div>
        )}

        {aba === 'historico' && (
          <div className="p-4">
            <div style={{ border: '1px solid var(--adm-linha)', borderRadius: 6 }}>
              <div className="grid items-center gap-3 px-3 py-2 text-[11px] font-medium"
                style={{
                  gridTemplateColumns: '150px minmax(0,1fr) 190px 150px',
                  color: 'var(--adm-dado)',
                  borderBottom: '1px solid var(--adm-linha)',
                  background: 'var(--adm-fundo2)',
                }}>
                <span>Quando</span>
                <span>Ação</span>
                <span>Autor</span>
                <span>Origem</span>
              </div>
              {d.auditoria.map((a, i) => (
                <div key={i} className="grid items-center gap-3 px-3 py-2.5 text-[13px]"
                  style={{
                    gridTemplateColumns: '150px minmax(0,1fr) 190px 150px',
                    borderTop: i === 0 ? undefined : '1px solid var(--adm-linha3)',
                  }}>
                  <Num className="text-[12px]">{dataLocal(a.criado_em)}</Num>
                  <span className="min-w-0">
                    {a.acao}
                    {a.detalhes && <span style={{ color: 'var(--adm-dado)' }}> — {a.detalhes}</span>}
                  </span>
                  <span className="truncate text-[12.5px]" style={{ color: 'var(--adm-fg2)' }}>{a.admin_nome}</span>
                  {/* O IP responde "de onde" — a pergunta que só aparece num
                      incidente de acesso, e que o nome da conta não responde,
                      porque conta pode ter sido usada por outra pessoa. */}
                  {a.ip
                    ? <Num className="truncate text-[12px]">{a.ip}</Num>
                    : <Vazio>sem registro</Vazio>}
                </div>
              ))}
              {d.auditoria.length === 0 && (
                <p className="px-3 py-8 text-center text-[12.5px]" style={{ color: 'var(--adm-dado)' }}>
                  Nada registrado para esta loja.
                </p>
              )}
              <div className="px-3 py-2 text-[12px]"
                style={{ borderTop: '1px solid var(--adm-linha)', background: 'var(--adm-fundo2)', color: 'var(--adm-dado)' }}>
                {d.auditoria.length} {d.auditoria.length === 1 ? 'registro' : 'registros'} desta loja
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── Rodapé de ações ── */}
      <footer
        className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-2.5"
        style={{ borderTop: '1px solid var(--adm-linha)', background: 'var(--adm-fundo2)' }}
      >
        <div className="flex items-center gap-2">
          <Botao altura={30} onClick={() => void suspender()}>
            {l.status_aprovacao === 'suspensa' ? 'Reativar' : 'Suspender'}
          </Botao>
          {superAdmin && (
            <Botao altura={30} variante="perigo" onClick={() => void excluir()}>Excluir</Botao>
          )}
        </div>
        {sujo ? (
          <div className="flex items-center gap-2">
            <span className="text-[12.5px]" style={{ color: 'var(--adm-fg2)' }}>Alterações não salvas</span>
            <Botao altura={30} onClick={descartar} desabilitado={salvando}>Descartar</Botao>
            <Botao altura={30} variante="primario" onClick={() => void salvar()} desabilitado={salvando}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Botao>
          </div>
        ) : (
          <Num className="text-[11.5px]" style={{ color: 'var(--adm-dado)' }}>tudo salvo</Num>
        )}
      </footer>

      {/*
        O CHAT É UM BOTÃO FLUTUANTE, não uma aba.
        Aba daria a ele o mesmo peso de "Pedidos" e "Fiscal", que são assuntos da
        loja; o suporte é uma ferramenta que se chama de qualquer lugar — e
        chamá-la sem perder a aba onde a pessoa estava é justamente o ponto.
      */}
      {SUPORTE_NA_TELA && !chat && (
        <button
          type="button"
          onClick={() => setChat(true)}
          aria-label="Diagnóstico e suporte com IA"
          title="Diagnóstico e suporte"
          className="fixed bottom-16 right-5 z-40 flex size-11 items-center justify-center"
          style={{ background: '#fff', border: '1px solid var(--adm-linha)', borderRadius: 999 }}
        >
          <MarcaX tamanho={22} />
        </button>
      )}
      {SUPORTE_NA_TELA && chat && (
        <ChatSuporte lojaId={l.id} nome={l.nome} comTenant={comTenant} aoFechar={() => setChat(false)} />
      )}
    </div>
  );
}

/**
 * Os editores da tela de Lojas esperam o objeto `Loja` da lista. Aqui só
 * existem os campos que esta tela usa, então o objeto é montado com eles.
 */
function comoLoja(l: LojaPainel, tenantId: string | null): Loja {
  return { ...l, tenant_id: tenantId ? Number(tenantId) : undefined } as unknown as Loja;
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
    <section>
      <Rotulo>{titulo}</Rotulo>
      <dl style={{ border: '1px solid var(--adm-linha)', borderRadius: 6 }}>
        {linhas.map(([chave, valor, mono], i) => (
          <div key={chave} className="flex gap-3 px-3 py-2"
            style={{ borderTop: i === 0 ? undefined : '1px solid var(--adm-linha3)' }}>
            <dt className="w-[104px] shrink-0 text-[12px]" style={{ color: 'var(--adm-rotulo)' }}>{chave}</dt>
            {/* `pretty` evita a última linha com uma palavra só, e o
                `line-height` de 1.5 é o que faz um endereço de quatro linhas
                continuar legível. */}
            <dd className="min-w-0 flex-1 break-words text-[12.5px]"
              style={{ lineHeight: 1.5, textWrap: 'pretty' } as React.CSSProperties}>
              {mono ? <Num>{valor}</Num> : valor}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Interruptor 38×21 chapado. SEM transition na propriedade que muda de valor —
 * transition em `background`/`left` congela o repaint e o controle mostra o
 * estado anterior. Foi o bug que derrubou o protótipo duas vezes.
 */
function Interruptor({ titulo, descricao, descricaoLigado, ligado, aoMudar, primeira }: {
  titulo: string; descricao: string; descricaoLigado: string;
  ligado: boolean; aoMudar: (v: boolean) => void; primeira?: boolean;
}) {
  return (
    <div className="px-3 py-2.5" style={{ borderTop: primeira ? undefined : '1px solid var(--adm-linha3)' }}>
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
      <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--adm-dado)' }}>
        {ligado ? descricaoLigado : descricao}
      </p>
    </div>
  );
}

/**
 * DIAGNÓSTICO E SUPORTE, em painel flutuante.
 *
 * Abre mostrando o DOSSIÊ — o estado real da loja em texto, gerado sem custo
 * nenhum. Metade dos chamados morre aí ("ah, o emissor está apontado para o
 * sistema"), e essa metade não deveria custar uma chamada de API.
 *
 * A pergunta à IA é o segundo passo, explícito. Fosse automático, toda abertura
 * de tela viraria uma cobrança.
 */
function ChatSuporte({ lojaId, nome, comTenant, aoFechar }: {
  lojaId: number; nome: string; comTenant: (u: string) => string; aoFechar: () => void;
}) {
  const { mostrar } = useToast();
  const [pergunta, setPergunta] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [dados, setDados] = useState<{
    dossie: string; alertas: string[]; resposta: string | null;
    modelo?: string; tokens?: { entrada: number; saida: number; cache_lido: number };
  } | null>(null);

  /* O dossiê carrega sozinho ao abrir; a IA só quando alguém pergunta. */
  useEffect(() => {
    let vivo = true;
    api<NonNullable<typeof dados>>('POST', comTenant(`/api/admin/lojas/${lojaId}/suporte`), {})
      .then(r => { if (vivo) setDados(r); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [lojaId]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aoFechar]);

  async function perguntar() {
    const t = pergunta.trim();
    if (!t) return;
    setCarregando(true);
    try {
      const r = await api<NonNullable<typeof dados>>(
        'POST', comTenant(`/api/admin/lojas/${lojaId}/suporte`), { pergunta: t });
      setDados(r);
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally { setCarregando(false); }
  }

  return (
    <aside
      className={cn(
        'adm fixed bottom-4 right-4 z-50 flex flex-col',
        'w-[min(440px,calc(100vw-2rem))] max-h-[min(640px,calc(100vh-2rem))]',
      )}
      style={{ background: '#fff', border: '1px solid var(--adm-linha)', borderRadius: 6 }}
      role="dialog"
      aria-label="Diagnóstico e suporte"
    >
      <header className="flex shrink-0 items-center gap-2 px-3 py-2.5"
        style={{ borderBottom: '1px solid var(--adm-linha)' }}>
        <MarcaX tamanho={18} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">Diagnóstico e suporte</div>
          <div className="truncate text-[11px]" style={{ color: 'var(--adm-rotulo)' }}>{nome}</div>
        </div>
        <button onClick={aoFechar} aria-label="Fechar"
          className="px-1.5 text-[16px] leading-none" style={{ color: 'var(--adm-dado)' }}>×</button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {/* Os alertas primeiro e separados: são as linhas que explicam chamado,
            e no meio de vinte fatos elas se perdem. */}
        {!!dados?.alertas.length && (
          <ul className="mb-2 space-y-1">
            {dados.alertas.map((a, i) => (
              <li key={i} className="text-[12.5px] leading-relaxed" style={{ color: 'var(--adm-erro)' }}>{a}</li>
            ))}
          </ul>
        )}
        <pre className="whitespace-pre-wrap text-[11.5px] leading-relaxed"
          style={{ color: 'var(--adm-fg2)', fontFamily: 'inherit' }}>
          {dados?.dossie ?? 'Lendo o estado da loja…'}
        </pre>

        {dados?.resposta && (
          <div className="mt-3 whitespace-pre-wrap px-3 py-2.5 text-[13px] leading-relaxed"
            style={{ border: '1px solid var(--adm-linha)', borderRadius: 6, background: 'var(--adm-fundo2)' }}>
            {dados.resposta}
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 py-2.5" style={{ borderTop: '1px solid var(--adm-linha)' }}>
        <textarea
          value={pergunta}
          onChange={e => setPergunta(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Ex.: o lojista diz que os pedidos não estão gerando nota."
          onKeyDown={e => {
            /* Enter envia, Shift+Enter quebra linha — o reflexo de qualquer
               chat. Sem isso, quem digita rápido manda a pergunta pela metade
               com o Enter e não entende por quê. */
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void perguntar(); }
          }}
          className="w-full px-2.5 py-2 text-[13px] outline-none"
          style={{ border: '1px solid var(--adm-linha)', borderRadius: 4, background: '#fff', boxSizing: 'border-box' }}
        />
        <div className="mt-1.5 flex items-center gap-2">
          <Botao altura={30} variante="primario" desabilitado={carregando || !pergunta.trim()}
            onClick={() => void perguntar()}>
            {carregando ? 'Pensando…' : 'Perguntar'}
          </Botao>
          {/* O custo à vista: sem isso ninguém percebe que cada clique gasta. */}
          {dados?.tokens && (
            <Num className="text-[11px]" style={{ color: 'var(--adm-dado)' }}>
              {dados.tokens.entrada + dados.tokens.saida} tokens
              {dados.tokens.cache_lido > 0 && ` · ${dados.tokens.cache_lido} do cache`}
            </Num>
          )}
        </div>
        <p className="pt-1.5 text-[11px] leading-relaxed" style={{ color: 'var(--adm-dado)' }}>
          A IA lê o estado da loja e explica. Ela não altera nada — quem age é você.
        </p>
      </div>
    </aside>
  );
}
