import { useState } from 'react';
import { Ajuda } from '@/components/ui/ajuda';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, TrendingUp, ShoppingBag, Ticket, Wallet, Download, XCircle, Clock,
  ArrowUpRight, ArrowDownRight, Layers, Package } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { brl } from '@/lib/format';
import { cn } from '@/lib/utils';

type Periodo = 'hoje' | 'ontem' | 'semana' | 'mes' | 'mes_passado' | 'personalizado';

interface Resumo {
  pedidos: number;
  faturamento_centavos: number;
  comissao_centavos: number;
  ticket_medio_centavos: number;
}
interface MaisVendido { nome_produto: string; quantidade: number; total_centavos: number; }
interface PorPagamento { forma_pagamento: string; qtd: number; total_centavos: number; }
interface PorHora { hora: number; qtd: number; }

interface Relatorio {
  periodo: Periodo;
  /** Intervalo REAL resolvido pelo servidor — é o que rotula a tela e o CSV. */
  intervalo: { de: string; ate: string; rotulo: string };
  resumo: Resumo;
  mais_vendidos: MaisVendido[];
  por_pagamento: PorPagamento[];
  cancelamento: { cancelados: number; total: number; taxa_percent: number };
  por_hora: PorHora[];
  financeiro: {
    faturamento_bruto_centavos: number;
    comissao_plataforma_centavos: number;
    liquido_centavos: number;
  };
  comparacao: Comparacao;
  curva_abc: { itens: ItemAbc[]; classes: ResumoClasse[] };
  por_canal: PorCanal[];
  estoque: {
    itens: ItemEstoque[];
    sem_estoque: number;
    baixo: number;
    valor_total_centavos: number;
  };
}

interface Comparacao {
  intervalo: { de: string; ate: string; rotulo: string };
  pedidos: number;
  faturamento_centavos: number;
  ticket_medio_centavos: number;
  /** null = período anterior sem venda; não há percentual a mostrar. */
  variacao: {
    pedidos_percent: number | null;
    faturamento_percent: number | null;
    ticket_percent: number | null;
  };
}
interface ItemAbc {
  nome_produto: string; quantidade: number; total_centavos: number;
  classe: 'A' | 'B' | 'C';
  participacao_percent: number; acumulado_percent: number;
}
interface ResumoClasse {
  classe: 'A' | 'B' | 'C'; itens: number;
  total_centavos: number; participacao_percent: number;
}
interface PorCanal { origem: string; qtd: number; total_centavos: number }
interface ItemEstoque {
  id: number; nome: string; estoque: number;
  preco_centavos: number; valor_centavos: number;
}

const LABEL: Record<Periodo, string> = {
  hoje: 'Hoje', ontem: 'Ontem', semana: '7 dias',
  mes: 'Este mês', mes_passado: 'Mês passado', personalizado: 'Escolher',
};
/*
 * "Este mês" e não "30 dias" de propósito: o lojista compara com o extrato do
 * banco e com a conta do contador, que são fechados por mês de calendário.
 * "Últimos 30 dias" nunca bate com nenhum dos dois.
 */
const NOME_PAGAMENTO: Record<string, string> = {
  pix: 'Pix', dinheiro: 'Dinheiro',
  cartao_entrega: 'Cartão na entrega', cartao_online: 'Cartão online',
};

/** Canal de venda. `app` é o delivery do próprio cardápio. */
const NOME_CANAL: Record<string, string> = {
  app: 'Delivery (app)', balcao: 'Balcão (PDV)', mesa: 'Mesa / comanda',
};

/** O que cada classe da curva significa, em uma linha. */
const SOBRE_CLASSE: Record<'A' | 'B' | 'C', string> = {
  A: 'Os que sustentam o faturamento — faltar estoque aqui dói',
  B: 'Importantes, mas não críticos',
  C: 'Cauda longa: vendem pouco e custam preparo, compra e espaço',
};

export function RelatoriosLoja() {
  const [periodo, setPeriodo] = useState<Periodo>('hoje');
  /*
   * `useState(fn)` e não cálculo no corpo do render: `Date.now()` durante o render
   * é impuro (o React reclama, com razão) e o valor mudaria a cada re-render — o
   * `max` dos campos de data poderia "andar" enquanto a pessoa digita. Aqui é
   * calculado uma vez, na montagem.
   *
   * −3h porque o corte é o dia de BRASÍLIA: perto da meia-noite, o `max` em UTC
   * ofereceria um dia que ainda não começou pro lojista (ou barraria o dia que
   * pra ele é hoje).
   */
  const [hojeISO] = useState(() => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10));
  const [de, setDe] = useState(hojeISO);
  const [ate, setAte] = useState(hojeISO);

  const consulta = useQuery({
    queryKey: ['lojista-relatorios', periodo, periodo === 'personalizado' ? de : '', periodo === 'personalizado' ? ate : ''],
    queryFn: () => {
      const q = new URLSearchParams({ periodo });
      if (periodo === 'personalizado') { q.set('de', de); q.set('ate', ate); }
      return api<Relatorio>('GET', `/api/lojista/relatorios?${q}`);
    },
  });

  const d = consulta.data;

  function exportarCSV() {
    if (!d) return;
    const linhas: string[] = [];
    linhas.push(`Relatório,${LABEL[periodo]},${d.intervalo?.rotulo || ''}`);
    linhas.push('');
    linhas.push('Resumo,Valor');
    linhas.push(`Pedidos entregues,${d.resumo.pedidos}`);
    linhas.push(`Faturamento bruto,${(d.financeiro.faturamento_bruto_centavos / 100).toFixed(2)}`);
    linhas.push(`Comissão plataforma,${(d.financeiro.comissao_plataforma_centavos / 100).toFixed(2)}`);
    linhas.push(`Líquido a receber,${(d.financeiro.liquido_centavos / 100).toFixed(2)}`);
    linhas.push(`Ticket médio,${(d.resumo.ticket_medio_centavos / 100).toFixed(2)}`);
    linhas.push(`Taxa de cancelamento,${d.cancelamento.taxa_percent}%`);
    linhas.push('');
    // Período anterior no CSV também: quem arquiva a planilha perde a comparação
    // se ela só existir na tela, e é justamente ao comparar meses que se usa o
    // arquivo.
    linhas.push(`Comparação,${d.comparacao.intervalo.rotulo}`);
    linhas.push(`Pedidos no período anterior,${d.comparacao.pedidos}`);
    linhas.push(`Faturamento no período anterior,${(d.comparacao.faturamento_centavos / 100).toFixed(2)}`);
    const pct = (v: number | null) => (v === null ? 'sem base' : `${v}%`);
    linhas.push(`Variação de pedidos,${pct(d.comparacao.variacao.pedidos_percent)}`);
    linhas.push(`Variação de faturamento,${pct(d.comparacao.variacao.faturamento_percent)}`);
    linhas.push('');
    linhas.push('Canal,Pedidos,Total');
    for (const c of d.por_canal) {
      linhas.push(`${NOME_CANAL[c.origem] || c.origem},${c.qtd},${(c.total_centavos / 100).toFixed(2)}`);
    }
    linhas.push('');
    linhas.push('Forma de pagamento,Pedidos,Total');
    for (const p of d.por_pagamento) {
      linhas.push(`${NOME_PAGAMENTO[p.forma_pagamento] || p.forma_pagamento},${p.qtd},${(p.total_centavos / 100).toFixed(2)}`);
    }
    linhas.push('');
    linhas.push('Produto,Quantidade,Total');
    for (const m of d.mais_vendidos) {
      linhas.push(`"${m.nome_produto}",${m.quantidade},${(m.total_centavos / 100).toFixed(2)}`);
    }
    linhas.push('');
    // Curva ABC completa (não os 12 da tela): é na planilha que se filtra e ordena.
    linhas.push('Curva ABC — por faturamento (custo não cadastrado; não é curva de lucro)');
    linhas.push('Classe,Produto,Quantidade,Total,Participação %,Acumulado %');
    for (const i of d.curva_abc.itens) {
      linhas.push(`${i.classe},"${i.nome_produto}",${i.quantidade},${(i.total_centavos / 100).toFixed(2)},${i.participacao_percent},${i.acumulado_percent}`);
    }
    linhas.push('');
    linhas.push('Estoque — valor a PREÇO DE VENDA (custo não cadastrado)');
    linhas.push('Produto,Estoque,Preço,Valor');
    for (const p of d.estoque.itens) {
      linhas.push(`"${p.nome}",${p.estoque},${(p.preco_centavos / 100).toFixed(2)},${(p.valor_centavos / 100).toFixed(2)}`);
    }
    const csv = '﻿' + linhas.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Nome com o intervalo, não com a data de hoje: relatório de março baixado em
    // abril ficava com nome de abril e não dava pra arquivar sem renomear.
    a.download = `relatorio-${d.intervalo?.de || periodo}_a_${d.intervalo?.ate || ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const maxHora = d ? Math.max(1, ...d.por_hora.map(h => h.qtd)) : 1;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <BarChart3 className="size-6" />
          </div>
          <div>
            <span className="inline-flex items-baseline gap-1.5"><h1 className="text-xl font-extrabold">Relatórios</h1><Ajuda chave="relatorios" /></span>
            <p className="text-sm text-muted-foreground">Vendas, financeiro e desempenho.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportarCSV} disabled={!d}>
          <Download className="size-4" /> CSV
        </Button>
      </div>

      {/* Seletor de período */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {(['hoje', 'ontem', 'semana', 'mes', 'mes_passado', 'personalizado'] as Periodo[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriodo(p)}
            className={`py-2 rounded-xl text-xs font-semibold transition-colors ${
              periodo === p ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground hover:text-foreground'
            }`}
          >
            {LABEL[p]}
          </button>
        ))}
      </div>

      {/* Intervalo livre — aparece só no "Escolher", pra não poluir o caminho comum. */}
      {periodo === 'personalizado' && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border p-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">De</label>
            <input type="date" value={de} max={ate} onChange={e => setDe(e.target.value)}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Até</label>
            <input type="date" value={ate} min={de} max={hojeISO} onChange={e => setAte(e.target.value)}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm" />
          </div>
          {/* `max`/`min` cruzados nos dois campos: o servidor troca datas invertidas,
              mas impedir no campo evita a consulta ida-e-volta com resultado estranho. */}
        </div>
      )}

      {/* O intervalo REAL, dito pelo servidor. "Este mês" sem dizer qual mês é
          relatório que ninguém consegue arquivar nem conferir depois. */}
      {d?.intervalo?.rotulo && (
        <p className="text-xs text-muted-foreground">
          Período: <b className="text-foreground">{d.intervalo.rotulo}</b>
          <span className="ml-1">· horário de Brasília</span>
        </p>
      )}

      {consulta.isLoading && (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      )}

      {d && (
        <>
          {/* Métricas principais, cada uma com a variação contra o período anterior */}
          <div className="grid grid-cols-2 gap-3">
            <Metric icone={ShoppingBag} valor={String(d.resumo.pedidos)} rotulo="Pedidos entregues"
              variacao={d.comparacao.variacao.pedidos_percent} />
            <Metric icone={TrendingUp} valor={brl(d.resumo.faturamento_centavos)} rotulo="Faturamento bruto"
              variacao={d.comparacao.variacao.faturamento_percent} />
            <Metric icone={Ticket} valor={brl(d.resumo.ticket_medio_centavos)} rotulo="Ticket médio"
              variacao={d.comparacao.variacao.ticket_percent} />
            <Metric icone={XCircle} valor={`${d.cancelamento.taxa_percent}%`} rotulo="Cancelamento" alerta={d.cancelamento.taxa_percent > 15} />
          </div>

          {/*
            CONTRA O QUE a comparação é feita. Sem dizer o intervalo, "+12%" não é
            verificável — e o lojista não tem como saber que a comparação usa o mesmo
            número de dias (em período parcial, comparar com um período fechado
            mostraria queda que é só aritmética).
          */}
          <p className="-mt-1 text-center text-[11px] text-muted-foreground">
            Comparado com {d.comparacao.intervalo.rotulo} · {brl(d.comparacao.faturamento_centavos)} em {d.comparacao.pedidos} pedido{d.comparacao.pedidos !== 1 ? 's' : ''}
          </p>

          {/* Financeiro — extrato de repasse */}
          <Card className="border-green-500/30 bg-green-500/[0.03]">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Wallet className="size-5 text-green-600" />
                <h3 className="font-bold">Financeiro — quanto você recebe</h3>
              </div>
              <div className="space-y-2 text-sm">
                <LinhaFin rotulo="Faturamento bruto" valor={brl(d.financeiro.faturamento_bruto_centavos)} />
                <LinhaFin rotulo="Comissão da plataforma" valor={`- ${brl(d.financeiro.comissao_plataforma_centavos)}`} vermelho />
                <div className="border-t pt-2 flex justify-between items-baseline">
                  <span className="font-bold">Líquido a receber</span>
                  <span className="text-xl font-extrabold tabular-nums text-green-600">{brl(d.financeiro.liquido_centavos)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/*
            POR CANAL — antes do "por forma de pagamento" de propósito: a primeira
            pergunta é de onde vem a venda (salão ou entrega, operações com custo e
            problema diferentes); a forma de pagamento é detalhe dentro disso.
          */}
          {d.por_canal.length > 0 && (
            <div>
              <h3 className="mb-3 font-bold">Por canal de venda</h3>
              <div className="space-y-2">
                {d.por_canal.map(c => {
                  const fatia = d.resumo.faturamento_centavos > 0
                    ? Math.round((c.total_centavos / d.resumo.faturamento_centavos) * 100) : 0;
                  return (
                    <Card key={c.origem}>
                      <CardContent className="p-3">
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold">{NOME_CANAL[c.origem] || c.origem}</div>
                            <div className="text-xs text-muted-foreground">
                              {c.qtd} pedido{c.qtd !== 1 ? 's' : ''} · {fatia}% do faturamento
                            </div>
                          </div>
                          <div className="shrink-0 text-sm font-bold tabular-nums">{brl(c.total_centavos)}</div>
                        </div>
                        {/* Barra: a proporção entre canais se lê de relance, o que
                            uma coluna de números não entrega. */}
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${fatia}%` }} />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Curva ABC */}
          {d.curva_abc.itens.length > 0 && <CurvaAbc dados={d.curva_abc} />}

          {/* Estoque */}
          {d.estoque.itens.length > 0 && <Estoque dados={d.estoque} />}

          {/* Formas de pagamento */}
          {d.por_pagamento.length > 0 && (
            <div>
              <h3 className="font-bold mb-3">Por forma de pagamento</h3>
              <div className="space-y-2">
                {d.por_pagamento.map(p => (
                  <Card key={p.forma_pagamento}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold">{NOME_PAGAMENTO[p.forma_pagamento] || p.forma_pagamento}</div>
                        <div className="text-xs text-muted-foreground">{p.qtd} pedido{p.qtd !== 1 ? 's' : ''}</div>
                      </div>
                      <div className="tabular-nums font-bold text-sm shrink-0">{brl(p.total_centavos)}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Horário de pico */}
          {d.por_hora.length > 0 && (
            <div>
              <h3 className="flex items-center gap-2 font-bold mb-3">
                <Clock className="size-4 text-primary" /> Horário de pico
              </h3>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-end gap-1 h-28">
                    {d.por_hora.map(h => (
                      <div key={h.hora} className="flex-1 flex flex-col items-center gap-1 group">
                        <div className="w-full flex items-end justify-center flex-1">
                          <div
                            className="w-full max-w-6 rounded-t bg-primary/80 group-hover:bg-primary transition-colors relative"
                            style={{ height: `${(h.qtd / maxHora) * 100}%`, minHeight: '4px' }}
                            title={`${h.hora}h — ${h.qtd} pedido(s)`}
                          />
                        </div>
                        <span className="text-[9px] text-muted-foreground">{h.hora}h</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Mais vendidos */}
          <div>
            <h3 className="font-bold mb-3">Top 10 mais vendidos</h3>
            {d.mais_vendidos.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground text-sm">
                  {/* Usa o intervalo do servidor em vez de recriar o texto por
                      período: era aí que ficava escrito "últimos 30 dias" mesmo
                      quando o período passou a ser o mês de calendário. */}
                  Nenhum pedido entregue em {d.intervalo?.rotulo || LABEL[periodo].toLowerCase()}.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {d.mais_vendidos.map((mv, i) => (
                  <Card key={i}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{mv.nome_produto}</div>
                        <div className="text-xs text-muted-foreground">{mv.quantidade} vendidos</div>
                      </div>
                      <div className="tabular-nums font-bold text-sm shrink-0">{brl(mv.total_centavos)}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ icone: Icone, valor, rotulo, alerta, variacao }: {
  icone: typeof ShoppingBag; valor: string; rotulo: string; alerta?: boolean;
  /** Variação % contra o período anterior. `null` = sem base de comparação. */
  variacao?: number | null;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <Icone className={`size-5 mb-2 ${alerta ? 'text-destructive' : 'text-muted-foreground'}`} />
        <div className={`text-2xl font-extrabold tabular-nums ${alerta ? 'text-destructive' : ''}`}>{valor}</div>
        <div className="text-xs text-muted-foreground mt-1">{rotulo}</div>
        {variacao !== undefined && <Variacao percent={variacao} />}
      </CardContent>
    </Card>
  );
}

/**
 * Variação contra o período anterior.
 *
 * VERDE/VERMELHO SEM DIZER O NÚMERO seria pior que nada: 0,4% e 40% pintam igual. E
 * `null` (período anterior sem venda) sai como TEXTO, não como "+100%" — sair de
 * zero pra qualquer coisa não é crescimento percentual, é a primeira venda, e um
 * "+100%" ali seria informação inventada.
 */
function Variacao({ percent }: { percent: number | null }) {
  if (percent === null) {
    return <div className="mt-1 text-[11px] text-muted-foreground">sem base de comparação</div>;
  }
  if (percent === 0) {
    return <div className="mt-1 text-[11px] text-muted-foreground">igual ao período anterior</div>;
  }
  const subiu = percent > 0;
  const Icone = subiu ? ArrowUpRight : ArrowDownRight;
  return (
    <div className={cn('mt-1 flex items-center gap-0.5 text-[11px] font-bold',
      subiu ? 'text-emerald-600' : 'text-destructive')}>
      <Icone className="size-3" />
      {subiu ? '+' : ''}{percent.toString().replace('.', ',')}%
    </div>
  );
}

const COR_CLASSE: Record<'A' | 'B' | 'C', string> = {
  A: 'bg-emerald-500', B: 'bg-amber-500', C: 'bg-muted-foreground/40',
};

/**
 * CURVA ABC.
 *
 * POR QUE NÃO É O "MAIS VENDIDOS": aquele ranking é por QUANTIDADE, e quantidade
 * não paga conta — refrigerante lidera em unidades em quase todo delivery e
 * responde por uma fatia pequena do dinheiro. Aqui a ordem é por FATURAMENTO.
 *
 * A tela diz que é curva de FATURAMENTO, e não de lucro, porque não existe custo
 * cadastrado no sistema. Omitir isso faria o lojista cortar da classe C um produto
 * de margem alta — decisão de margem tomada com número de receita.
 */
function CurvaAbc({ dados }: { dados: { itens: ItemAbc[]; classes: ResumoClasse[] } }) {
  const [tudo, setTudo] = useState(false);
  const visiveis = tudo ? dados.itens : dados.itens.slice(0, 12);

  return (
    <div>
      <h3 className="flex items-center gap-2 font-bold">
        <Layers className="size-4 text-primary" /> Curva ABC dos produtos
      </h3>
      <p className="mb-3 mt-0.5 text-[11px] text-muted-foreground">
        Por <strong>faturamento</strong>, não por quantidade — o que mais sai em unidades
        raramente é o que mais traz dinheiro. (Curva por <em>lucro</em> depende do custo
        de cada produto, que ainda não é cadastrado.)
      </p>

      <div className="mb-3 grid grid-cols-3 gap-2">
        {dados.classes.map(c => (
          <Card key={c.classe}>
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5">
                <span className={cn('size-2.5 rounded-full', COR_CLASSE[c.classe])} />
                <span className="text-sm font-extrabold">Classe {c.classe}</span>
              </div>
              <div className="mt-1 text-lg font-extrabold tabular-nums">{c.participacao_percent}%</div>
              <div className="text-[11px] text-muted-foreground">
                {c.itens} produto{c.itens !== 1 ? 's' : ''} · {brl(c.total_centavos)}
              </div>
              <div className="mt-1 text-[10px] leading-tight text-muted-foreground">{SOBRE_CLASSE[c.classe]}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="divide-y divide-border/60 p-0">
          {visiveis.map(i => (
            <div key={i.nome_produto} className="flex items-center gap-3 px-3 py-2.5">
              <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-extrabold text-white',
                COR_CLASSE[i.classe])}>
                {i.classe}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{i.nome_produto}</div>
                <div className="text-[11px] text-muted-foreground">
                  {i.quantidade} un · {i.participacao_percent}% do faturamento · acumulado {i.acumulado_percent}%
                </div>
              </div>
              <div className="shrink-0 text-sm font-bold tabular-nums">{brl(i.total_centavos)}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      {dados.itens.length > 12 && (
        <button type="button" onClick={() => setTudo(v => !v)}
          className="mt-2 w-full text-xs font-bold text-primary hover:underline">
          {tudo ? 'Mostrar menos' : `Ver todos os ${dados.itens.length} produtos`}
        </button>
      )}
    </div>
  );
}

/**
 * ESTOQUE.
 *
 * Ordenado do MENOR estoque pra cima — a lista existe pra responder "o que vai
 * faltar?", não pra inventariar. Quem tem 200 unidades não precisa de atenção hoje.
 *
 * O valor é a PREÇO DE VENDA e a tela diz isso: sem custo cadastrado, chamar de
 * "capital parado" seria mentira inflada pela margem.
 */
function Estoque({ dados }: { dados: { itens: ItemEstoque[]; sem_estoque: number; baixo: number; valor_total_centavos: number } }) {
  const [tudo, setTudo] = useState(false);
  const visiveis = tudo ? dados.itens : dados.itens.slice(0, 10);

  return (
    <div>
      <h3 className="flex items-center gap-2 font-bold">
        <Package className="size-4 text-primary" /> Estoque
      </h3>
      <p className="mb-3 mt-0.5 text-[11px] text-muted-foreground">
        Só produtos com controle de estoque ligado, do que está acabando pro que sobra.
      </p>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <Card className={dados.sem_estoque > 0 ? 'border-destructive/40' : undefined}>
          <CardContent className="p-3">
            <div className={cn('text-lg font-extrabold tabular-nums', dados.sem_estoque > 0 && 'text-destructive')}>
              {dados.sem_estoque}
            </div>
            <div className="text-[11px] text-muted-foreground">Zerados</div>
          </CardContent>
        </Card>
        <Card className={dados.baixo > 0 ? 'border-amber-500/40' : undefined}>
          <CardContent className="p-3">
            <div className={cn('text-lg font-extrabold tabular-nums', dados.baixo > 0 && 'text-amber-600')}>
              {dados.baixo}
            </div>
            <div className="text-[11px] text-muted-foreground">5 ou menos</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-lg font-extrabold tabular-nums">{brl(dados.valor_total_centavos)}</div>
            <div className="text-[11px] text-muted-foreground">A preço de venda</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="divide-y divide-border/60 p-0">
          {visiveis.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{p.nome}</div>
                <div className="text-[11px] text-muted-foreground">{brl(p.preco_centavos)} cada</div>
              </div>
              <span className={cn('shrink-0 rounded-lg px-2 py-1 text-xs font-extrabold tabular-nums',
                p.estoque <= 0 ? 'bg-destructive/10 text-destructive'
                  : p.estoque <= 5 ? 'bg-amber-500/10 text-amber-600'
                  : 'bg-muted text-muted-foreground')}>
                {p.estoque <= 0 ? 'sem estoque' : `${p.estoque} un`}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {dados.itens.length > 10 && (
        <button type="button" onClick={() => setTudo(v => !v)}
          className="mt-2 w-full text-xs font-bold text-primary hover:underline">
          {tudo ? 'Mostrar menos' : `Ver todos os ${dados.itens.length} produtos`}
        </button>
      )}
    </div>
  );
}

function LinhaFin({ rotulo, valor, vermelho }: { rotulo: string; valor: string; vermelho?: boolean }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className={`tabular-nums font-semibold ${vermelho ? 'text-destructive' : ''}`}>{valor}</span>
    </div>
  );
}
