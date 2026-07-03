import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, TrendingUp, ShoppingBag, Ticket, Wallet, Download, XCircle, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { brl } from '@/lib/format';

type Periodo = 'dia' | 'semana' | 'mes';

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
}

const LABEL: Record<Periodo, string> = {
  dia: 'Hoje', semana: '7 dias', mes: '30 dias',
};
const NOME_PAGAMENTO: Record<string, string> = {
  pix: 'Pix', dinheiro: 'Dinheiro', cartao_entrega: 'Cartão na entrega',
};

export function RelatoriosLoja() {
  const [periodo, setPeriodo] = useState<Periodo>('dia');

  const consulta = useQuery({
    queryKey: ['lojista-relatorios', periodo],
    queryFn: () => api<Relatorio>('GET', `/api/lojista/relatorios?periodo=${periodo}`),
  });

  const d = consulta.data;

  function exportarCSV() {
    if (!d) return;
    const linhas: string[] = [];
    linhas.push(`Relatório,${LABEL[periodo]}`);
    linhas.push('');
    linhas.push('Resumo,Valor');
    linhas.push(`Pedidos entregues,${d.resumo.pedidos}`);
    linhas.push(`Faturamento bruto,${(d.financeiro.faturamento_bruto_centavos / 100).toFixed(2)}`);
    linhas.push(`Comissão plataforma,${(d.financeiro.comissao_plataforma_centavos / 100).toFixed(2)}`);
    linhas.push(`Líquido a receber,${(d.financeiro.liquido_centavos / 100).toFixed(2)}`);
    linhas.push(`Ticket médio,${(d.resumo.ticket_medio_centavos / 100).toFixed(2)}`);
    linhas.push(`Taxa de cancelamento,${d.cancelamento.taxa_percent}%`);
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
    const csv = '﻿' + linhas.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-${periodo}-${new Date().toISOString().slice(0, 10)}.csv`;
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
            <h1 className="text-xl font-extrabold">Relatórios</h1>
            <p className="text-sm text-muted-foreground">Vendas, financeiro e desempenho.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportarCSV} disabled={!d}>
          <Download className="size-4" /> CSV
        </Button>
      </div>

      {/* Seletor de período */}
      <div className="flex gap-2">
        {(['dia', 'semana', 'mes'] as Periodo[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriodo(p)}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
              periodo === p ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground hover:text-foreground'
            }`}
          >
            {LABEL[p]}
          </button>
        ))}
      </div>

      {consulta.isLoading && (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      )}

      {d && (
        <>
          {/* Métricas principais */}
          <div className="grid grid-cols-2 gap-3">
            <Metric icone={ShoppingBag} valor={String(d.resumo.pedidos)} rotulo="Pedidos entregues" />
            <Metric icone={TrendingUp} valor={brl(d.resumo.faturamento_centavos)} rotulo="Faturamento bruto" />
            <Metric icone={Ticket} valor={brl(d.resumo.ticket_medio_centavos)} rotulo="Ticket médio" />
            <Metric icone={XCircle} valor={`${d.cancelamento.taxa_percent}%`} rotulo="Cancelamento" alerta={d.cancelamento.taxa_percent > 15} />
          </div>

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
                  Nenhum pedido entregue {periodo === 'dia' ? 'hoje' : `nos últimos ${periodo === 'semana' ? '7' : '30'} dias`}.
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

function Metric({ icone: Icone, valor, rotulo, alerta }: { icone: typeof ShoppingBag; valor: string; rotulo: string; alerta?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <Icone className={`size-5 mb-2 ${alerta ? 'text-destructive' : 'text-muted-foreground'}`} />
        <div className={`text-2xl font-extrabold tabular-nums ${alerta ? 'text-destructive' : ''}`}>{valor}</div>
        <div className="text-xs text-muted-foreground mt-1">{rotulo}</div>
      </CardContent>
    </Card>
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
