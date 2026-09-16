import { useState } from 'react';
import { Ajuda } from '@/components/ui/ajuda';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, Printer, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { brl } from '@/lib/format';
import { cn } from '@/lib/utils';
import { NUM, Variacao, Cartao, Titulo, Linha, Barra, Vazio, Bloco, desdeQuando, duracao }
  from './relatorios-partes';

/*
 * ─────────────────────────── O RELATÓRIO ────────────────────────────────────
 *
 * Era uma coluna única: quatro números, um bloco financeiro e uma lista de
 * estoque que só dizia "sem estoque" — sem quantidade, sem mínimo, sem giro,
 * sem valor. Dava para saber O QUE acabou; nunca O QUE COMPRAR.
 *
 * Agora são seis abas, e a divisão não é estética: são seis perguntas
 * diferentes, feitas em momentos diferentes. "Como foi o dia" (visão geral) e
 * "o que eu compro amanhã" (estoque) não cabem na mesma tela sem que uma delas
 * vire rodapé da outra.
 *
 * ──────────────── A REGRA QUE VALE MAIS QUE O DESENHO ───────────────────────
 *
 * O NÚMERO QUE O LOJISTA CLICA TEM QUE SER O NÚMERO QUE ELE ENCONTRA.
 *
 * A tabela de estoque é uma PÁGINA do catálogo, não o catálogo: com 1.116
 * produtos, contar as linhas na tela responde "10 sem estoque" numa loja que
 * tem 463. Por isso toda contagem, todo valor e o rodapé vêm dos totais da
 * consulta — `itens.length` não aparece em lugar nenhum deste arquivo.
 *
 * ────────────────────── O QUE NÃO ESTÁ AQUI ────────────────────────────────
 *
 * MARGEM: não existe custo cadastrado no sistema. Todo valor de estoque é a
 * PREÇO DE VENDA, e a tela diz isso onde o número aparece — sem o rótulo, o
 * lojista lê como capital parado e o número está inflado pela margem.
 *
 * MOVIMENTAÇÕES DE ESTOQUE: nada registra entrada, perda ou contagem. O estoque
 * é um número que a venda decrementa e a sincronização do ERP sobrescreve.
 *
 * TAXA DE CARTÃO/PIX E PRAZO DE RECEBIMENTO: são do contrato com a adquirente,
 * não do nosso banco de dados. Estimar por percentual de mercado seria inventar
 * dedução dentro de um relatório financeiro.
 */

type Periodo = 'hoje' | 'ontem' | 'semana' | 'mes' | 'mes_passado' | 'personalizado';
type Aba = 'visao' | 'financeiro' | 'produtos' | 'estoque' | 'clientes' | 'operacao';

interface Resumo {
  pedidos: number; faturamento_centavos: number;
  comissao_centavos: number; ticket_medio_centavos: number;
}
interface MaisVendido { nome_produto: string; quantidade: number; total_centavos: number }
interface PorPagamento { forma_pagamento: string; qtd: number; total_centavos: number }
interface PorHora { hora: number; qtd: number }
interface PorDia { dia: string; qtd: number; total_centavos: number }
interface PorCanal { origem: string; qtd: number; total_centavos: number }
interface ItemAbc {
  nome_produto: string; quantidade: number; total_centavos: number;
  classe: 'A' | 'B' | 'C'; participacao_percent: number; acumulado_percent: number;
}
interface ResumoClasse {
  classe: 'A' | 'B' | 'C'; itens: number; total_centavos: number; participacao_percent: number;
}
interface ItemEstoqueSimples {
  id: number; nome: string; estoque: number; preco_centavos: number; valor_centavos: number;
}
interface Comparacao {
  intervalo: { de: string; ate: string; rotulo: string };
  pedidos: number; faturamento_centavos: number; ticket_medio_centavos: number;
  /** null = período anterior sem venda; não há percentual a mostrar. */
  variacao: {
    pedidos_percent: number | null;
    faturamento_percent: number | null;
    ticket_percent: number | null;
  };
}
interface Relatorio {
  periodo: Periodo;
  /** Intervalo REAL resolvido pelo servidor — é o que rotula a tela e o CSV. */
  intervalo: { de: string; ate: string; rotulo: string };
  resumo: Resumo;
  mais_vendidos: MaisVendido[];
  por_pagamento: PorPagamento[];
  cancelamento: { cancelados: number; total: number; taxa_percent: number };
  por_hora: PorHora[];
  por_dia: PorDia[];
  financeiro: {
    faturamento_bruto_centavos: number;
    comissao_plataforma_centavos: number;
    liquido_centavos: number;
  };
  comparacao: Comparacao;
  curva_abc: { itens: ItemAbc[]; classes: ResumoClasse[] };
  por_canal: PorCanal[];
  estoque: {
    itens: ItemEstoqueSimples[];
    sem_estoque: number; baixo: number; valor_total_centavos: number;
  };
}

interface LinhaEstoque {
  id: number; nome: string; categoria: string | null; estoque: number;
  preco_centavos: number; codigo_barras: string | null;
  minimo: number; valor_centavos: number;
  ultima_venda: string | null; giro_semana: number;
}
interface RespostaEstoque {
  filtro: string; busca: string; pagina: number; limite: number;
  total_do_filtro: number; valor_do_filtro_centavos: number; tem_mais: boolean;
  itens: LinhaEstoque[];
  totais: {
    zerados: number; repor: number; parados: number; todos: number;
    valor_total_centavos: number; valor_parado_centavos: number;
  };
  regras: { minimo_padrao: number; parado_dias: number };
}

interface Detalhes {
  financeiro: {
    itens_centavos: number; descontos_centavos: number; entrega_centavos: number;
    comissao_centavos: number; bruto_centavos: number; liquido_centavos: number;
    cancelado: { qtd: number; total_centavos: number };
    caixas: Array<{
      id: number; aberto_em: string; fechado_em: string; status: string;
      usuario_abertura_nome: string; usuario_fechamento_nome: string;
      valor_esperado_centavos: number; valor_contado_centavos: number; diferenca_centavos: number;
      vendas_quantidade: number;
    }>;
  };
  produtos: {
    encalhados: Array<{
      id: number; nome: string; categoria: string | null; estoque: number;
      preco_centavos: number; valor_centavos: number; ultima_venda: string | null;
    }>;
    complementos: Array<{
      id: number; nome: string; grupo: string;
      quantidade: number; total_centavos: number;
    }>;
  };
  clientes: {
    compraram: number; pedidos: number; novos: number;
    top: Array<{
      id: number; nome: string; telefone: string; pedidos: number;
      total_centavos: number; ticket_centavos: number; ultimo: string;
    }>;
    anterior: { compraram: number; pedidos: number };
  };
  operacao: {
    etapas: Array<{ status: string; segundos: number; amostras: number }>;
    motivos: Array<{ motivo: string; qtd: number; total_centavos: number }>;
    entregadores: Array<{ id: number; nome: string; entregas: number; taxas_centavos: number; segundos: number }>;
  };
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
  pix_entrega: 'Pix na entrega',
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
/** O nome de cada etapa do pedido, do jeito que o lojista fala. */
const NOME_ETAPA: Record<string, string> = {
  pendente: 'Chegou', aceito: 'Aceite', preparando: 'Preparo',
  pronto: 'Pronto', em_entrega: 'Saiu para entrega', entregue: 'Entregue',
  cancelado: 'Cancelado', recusado: 'Recusado',
};

const ABAS: Array<[Aba, string]> = [
  ['visao', 'Visão geral'], ['financeiro', 'Financeiro'], ['produtos', 'Produtos'],
  ['estoque', 'Estoque'], ['clientes', 'Clientes'], ['operacao', 'Operação'],
];

type FiltroEstoque = 'repor' | 'zerados' | 'parados' | 'todos';
const NOME_FILTRO: Record<FiltroEstoque, string> = {
  repor: 'Repor agora', zerados: 'Sem estoque', parados: 'Parados', todos: 'Todos',
};

export function RelatoriosLoja() {
  const [periodo, setPeriodo] = useState<Periodo>('hoje');
  const [aba, setAba] = useState<Aba>('visao');
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

  /* Estado da aba de estoque. Vive aqui porque a Visão geral navega para ela
     JÁ FILTRADA — "463 produtos zerados" leva ao balde dos zerados, não a uma
     tabela que a pessoa tem que filtrar de novo. */
  const [filtro, setFiltro] = useState<FiltroEstoque>('repor');
  const [buscaEstoque, setBuscaEstoque] = useState('');
  const [limite, setLimite] = useState(10);
  const [buscaProduto, setBuscaProduto] = useState('');

  const chaveDoPeriodo = [periodo, periodo === 'personalizado' ? de : '', periodo === 'personalizado' ? ate : ''];
  const querystring = () => {
    const q = new URLSearchParams({ periodo });
    if (periodo === 'personalizado') { q.set('de', de); q.set('ate', ate); }
    return q;
  };

  const consulta = useQuery({
    queryKey: ['lojista-relatorios', ...chaveDoPeriodo],
    queryFn: () => api<Relatorio>('GET', `/api/lojista/relatorios?${querystring()}`),
  });
  const d = consulta.data;

  /* As quatro abas pesadas só consultam quando são abertas: a primeira tela tem
     que abrir rápido, e ninguém abre um relatório pelo fechamento de caixa. */
  const detalhes = useQuery({
    queryKey: ['lojista-relatorios-detalhes', ...chaveDoPeriodo],
    queryFn: () => api<Detalhes>('GET', `/api/lojista/relatorios/detalhes?${querystring()}`),
    enabled: aba === 'financeiro' || aba === 'produtos' || aba === 'clientes' || aba === 'operacao',
  });
  const det = detalhes.data;

  const estoque = useQuery({
    queryKey: ['lojista-relatorios-estoque', filtro, buscaEstoque, limite],
    queryFn: () => {
      const q = new URLSearchParams({ filtro, limite: String(limite) });
      if (buscaEstoque.trim()) q.set('busca', buscaEstoque.trim());
      return api<RespostaEstoque>('GET', `/api/lojista/relatorios/estoque?${q}`);
    },
    enabled: aba === 'estoque',
  });
  const est = estoque.data;

  function irPara(destino: Aba, comFiltro?: FiltroEstoque) {
    if (comFiltro) { setFiltro(comFiltro); setLimite(10); setBuscaEstoque(''); }
    setAba(destino);
  }

  function exportarCSV() {
    if (!d) return;
    const linhas: string[] = [];
    const dec = (c: number) => (c / 100).toFixed(2);
    linhas.push(`Relatório,${LABEL[periodo]},${d.intervalo?.rotulo || ''}`);
    linhas.push('');
    linhas.push('Resumo,Valor');
    linhas.push(`Pedidos entregues,${d.resumo.pedidos}`);
    linhas.push(`Faturamento bruto,${dec(d.financeiro.faturamento_bruto_centavos)}`);
    linhas.push(`Comissão plataforma,${dec(d.financeiro.comissao_plataforma_centavos)}`);
    linhas.push(`Líquido a receber,${dec(d.financeiro.liquido_centavos)}`);
    linhas.push(`Ticket médio,${dec(d.resumo.ticket_medio_centavos)}`);
    linhas.push(`Taxa de cancelamento,${d.cancelamento.taxa_percent}%`);
    linhas.push('');
    // Período anterior no CSV também: quem arquiva a planilha perde a comparação
    // se ela só existir na tela, e é justamente ao comparar meses que se usa o
    // arquivo.
    linhas.push(`Comparação,${d.comparacao.intervalo.rotulo}`);
    linhas.push(`Pedidos no período anterior,${d.comparacao.pedidos}`);
    linhas.push(`Faturamento no período anterior,${dec(d.comparacao.faturamento_centavos)}`);
    const pct = (v: number | null) => (v === null ? 'sem base' : `${v}%`);
    linhas.push(`Variação de pedidos,${pct(d.comparacao.variacao.pedidos_percent)}`);
    linhas.push(`Variação de faturamento,${pct(d.comparacao.variacao.faturamento_percent)}`);
    linhas.push('');
    linhas.push('Dia,Pedidos,Faturamento');
    for (const x of d.por_dia || []) linhas.push(`${x.dia},${x.qtd},${dec(x.total_centavos)}`);
    linhas.push('');
    linhas.push('Canal,Pedidos,Total');
    for (const c of d.por_canal) {
      linhas.push(`${NOME_CANAL[c.origem] || c.origem},${c.qtd},${dec(c.total_centavos)}`);
    }
    linhas.push('');
    linhas.push('Forma de pagamento,Pedidos,Total');
    for (const p of d.por_pagamento) {
      linhas.push(`${NOME_PAGAMENTO[p.forma_pagamento] || p.forma_pagamento},${p.qtd},${dec(p.total_centavos)}`);
    }
    linhas.push('');
    linhas.push('Produto,Quantidade,Total');
    for (const m of d.mais_vendidos) {
      linhas.push(`"${m.nome_produto}",${m.quantidade},${dec(m.total_centavos)}`);
    }
    linhas.push('');
    // Curva ABC completa (não os 12 da tela): é na planilha que se filtra e ordena.
    linhas.push('Curva ABC — por faturamento (custo não cadastrado; não é curva de lucro)');
    linhas.push('Classe,Produto,Quantidade,Total,Participação %,Acumulado %');
    for (const i of d.curva_abc.itens) {
      linhas.push(`${i.classe},"${i.nome_produto}",${i.quantidade},${dec(i.total_centavos)},${i.participacao_percent},${i.acumulado_percent}`);
    }
    linhas.push('');
    linhas.push('Estoque — valor a PREÇO DE VENDA (custo não cadastrado)');
    linhas.push('Produto,Estoque,Preço,Valor');
    for (const p of d.estoque.itens) {
      linhas.push(`"${p.nome}",${p.estoque},${dec(p.preco_centavos)},${dec(p.valor_centavos)}`);
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

  /** A lista de compra: só o que o filtro atual diz que precisa ser comprado. */
  function listaDeCompra() {
    if (!est) return;
    const linhas = ['Produto,Categoria,Em estoque,Mínimo,Giro por semana,Comprar (sugestão)'];
    for (const p of est.itens) {
      const sugestao = Math.max(0, Math.ceil(p.minimo * 2 - p.estoque));
      linhas.push(`"${p.nome}","${p.categoria || ''}",${p.estoque},${p.minimo},${(Number(p.giro_semana) || 0).toFixed(1)},${sugestao}`);
    }
    const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lista-de-compra-${NOME_FILTRO[filtro].toLowerCase().replace(/ /g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const maxHora = d ? Math.max(1, ...d.por_hora.map(h => h.qtd)) : 1;
  const dias = d?.por_dia ?? [];
  const maxDia = Math.max(1, ...dias.map(x => x.total_centavos));
  const totalFatCanais = (d?.por_canal ?? []).reduce((s, c) => s + c.total_centavos, 0);
  const totalFatPagto = (d?.por_pagamento ?? []).reduce((s, p) => s + p.total_centavos, 0);

  return (
    <div className="space-y-5">
      {/* ─── Cabeçalho ─── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <BarChart3 className="size-6" />
          </div>
          <div>
            <span className="inline-flex items-baseline gap-1.5">
              <h1 className="text-[23px] font-bold">Relatórios</h1>
              <Ajuda chave="relatorios" />
            </span>
            <p className="text-[12.5px] text-muted-foreground">
              {d ? <>Período: <b className={NUM}>{d.intervalo.rotulo}</b> · horário de Brasília</>
                : 'Vendas, financeiro e desempenho.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 whitespace-nowrap" onClick={exportarCSV} disabled={!d}>
            <Download className="size-4" /> Exportar CSV
          </Button>
          <Button variant="outline" size="sm" className="h-9 whitespace-nowrap" onClick={() => window.print()} disabled={!d}>
            <Printer className="size-4" /> Imprimir
          </Button>
        </div>
      </div>

      {/* Seletor de período */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {(['hoje', 'ontem', 'semana', 'mes', 'mes_passado', 'personalizado'] as Periodo[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriodo(p)}
            className={cn('whitespace-nowrap rounded-xl py-2 text-xs font-semibold transition-colors',
              periodo === p ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground hover:text-foreground')}
          >
            {LABEL[p]}
          </button>
        ))}
      </div>

      {/* Intervalo livre — aparece só no "Escolher", pra não poluir o caminho comum. */}
      {periodo === 'personalizado' && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border p-3">
          <label className="text-[12px] font-semibold text-muted-foreground">
            De
            <Input type="date" value={de} max={hojeISO} onChange={e => setDe(e.target.value)} className="mt-1 h-9 w-[150px]" />
          </label>
          <label className="text-[12px] font-semibold text-muted-foreground">
            Até
            <Input type="date" value={ate} max={hojeISO} onChange={e => setAte(e.target.value)} className="mt-1 h-9 w-[150px]" />
          </label>
        </div>
      )}

      {/* Comparação com o período anterior — o número sozinho não diz se foi bom. */}
      {d && (
        <p className="text-[12.5px] text-muted-foreground">
          Comparado com o período anterior ({d.comparacao.intervalo.rotulo}):{' '}
          <b className={NUM}>{brl(d.comparacao.faturamento_centavos)}</b> em{' '}
          <b className={NUM}>{d.comparacao.pedidos}</b> {d.comparacao.pedidos === 1 ? 'pedido' : 'pedidos'}
        </p>
      )}

      {/* ─── Abas ─── */}
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {ABAS.map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            onClick={() => setAba(id)}
            aria-current={aba === id ? 'page' : undefined}
            className={cn('shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13.5px] font-semibold transition-colors',
              aba === id ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {rotulo}
            {/* A contagem só na aba de estoque, e vermelha: é a única que é
                PENDÊNCIA — produto zerado está fora do cardápio agora. */}
            {id === 'estoque' && !!d?.estoque.sem_estoque && (
              <span className={cn('ml-1.5 text-[11.5px] font-bold text-destructive', NUM)}>
                {d.estoque.sem_estoque}
              </span>
            )}
          </button>
        ))}
      </div>

      {consulta.isLoading && <Skeleton className="h-64" />}

      {/* ══════════════════ 1. VISÃO GERAL ══════════════════ */}
      {aba === 'visao' && d && (
        <div className="space-y-4">
          <Bloco className="p-0">
            <div className="grid grid-cols-2 divide-x divide-border/60 lg:grid-cols-4">
              <Cartao rotulo="Pedidos entregues" valor={d.resumo.pedidos}
                apoio={<Variacao percent={d.comparacao.variacao.pedidos_percent} />} />
              <Cartao rotulo="Faturamento bruto" valor={brl(d.resumo.faturamento_centavos)}
                apoio={<Variacao percent={d.comparacao.variacao.faturamento_percent} />} />
              <Cartao rotulo="Ticket médio" valor={brl(d.resumo.ticket_medio_centavos)}
                apoio={<Variacao percent={d.comparacao.variacao.ticket_percent} />} />
              <Cartao rotulo="Cancelamento" valor={`${d.cancelamento.taxa_percent}%`}
                apoio={`${d.cancelamento.cancelados} de ${d.cancelamento.total} pedidos`} />
            </div>
          </Bloco>

          <Bloco>
            <Titulo>Faturamento por dia</Titulo>
            {dias.length === 0 ? <Vazio>Nenhuma venda entregue no período.</Vazio> : (
              <>
                <div className="flex h-28 items-end gap-1">
                  {dias.map(x => (
                    <span key={x.dia} className="flex h-full flex-1 items-end" title={`${x.dia}: ${brl(x.total_centavos)}`}>
                      <Barra valor={x.total_centavos} maximo={maxDia} destaque={x.total_centavos === maxDia} />
                    </span>
                  ))}
                </div>
                <div className={cn('mt-1.5 flex justify-between text-[11px] text-muted-foreground', NUM)}>
                  <span>{dias[0]?.dia}</span>
                  <span>pico {brl(maxDia)}</span>
                  <span>{dias[dias.length - 1]?.dia}</span>
                </div>
              </>
            )}
          </Bloco>

          {/*
            PRECISA DE ATENÇÃO — e cada linha LEVA para o lugar de resolver, já
            filtrado. Aviso que não leva a lugar nenhum vira decoração na segunda
            semana.
          */}
          <Bloco>
            <Titulo>Precisa de atenção</Titulo>
            <div className="divide-y divide-border/60">
              {d.estoque.sem_estoque > 0 && (
                <button type="button" onClick={() => irPara('estoque', 'zerados')} className="block w-full text-left">
                  <Linha rotulo={`${d.estoque.sem_estoque} produtos zerados`}
                    apoio="saem do cardápio até a reposição"
                    valor="ver" cor="text-primary" />
                </button>
              )}
              {d.estoque.baixo > 0 && (
                <button type="button" onClick={() => irPara('estoque', 'repor')} className="block w-full text-left">
                  <Linha rotulo={`${d.estoque.baixo} com 5 unidades ou menos`}
                    apoio="vão acabar antes da próxima compra"
                    valor="ver" cor="text-primary" />
                </button>
              )}
              {d.cancelamento.taxa_percent > 0 && (
                <button type="button" onClick={() => irPara('operacao')} className="block w-full text-left">
                  <Linha rotulo={`Cancelamento em ${d.cancelamento.taxa_percent}% dos pedidos`}
                    apoio="ver os motivos registrados" valor="ver" cor="text-primary" />
                </button>
              )}
              {d.estoque.sem_estoque === 0 && d.estoque.baixo === 0 && d.cancelamento.taxa_percent === 0 && (
                <Vazio>Nada pendente neste período.</Vazio>
              )}
            </div>
          </Bloco>

          <div className="grid gap-4 lg:grid-cols-2">
            <Bloco>
              <Titulo>Formas de pagamento</Titulo>
              {d.por_pagamento.length === 0 ? <Vazio>Sem vendas no período.</Vazio>
                : d.por_pagamento.map(p => (
                  <Linha key={p.forma_pagamento}
                    rotulo={NOME_PAGAMENTO[p.forma_pagamento] || p.forma_pagamento}
                    apoio={`${p.qtd} ${p.qtd === 1 ? 'pedido' : 'pedidos'} · ${totalFatPagto > 0 ? Math.round((p.total_centavos / totalFatPagto) * 100) : 0}%`}
                    valor={brl(p.total_centavos)} />
                ))}
            </Bloco>
            <Bloco>
              <Titulo>Canais de venda</Titulo>
              {d.por_canal.length === 0 ? <Vazio>Sem vendas no período.</Vazio>
                : d.por_canal.map(c => (
                  <Linha key={c.origem}
                    rotulo={NOME_CANAL[c.origem] || c.origem}
                    apoio={`${c.qtd} ${c.qtd === 1 ? 'pedido' : 'pedidos'} · ${totalFatCanais > 0 ? Math.round((c.total_centavos / totalFatCanais) * 100) : 0}%`}
                    valor={brl(c.total_centavos)} />
                ))}
            </Bloco>
          </div>
        </div>
      )}

      {/* ══════════════════ 2. FINANCEIRO ══════════════════ */}
      {aba === 'financeiro' && (
        detalhes.isLoading || !det ? <Skeleton className="h-64" /> : (
          <div className="space-y-4">
            <Bloco>
              <Titulo>Do que entra ao que sobra</Titulo>
              <div className="divide-y divide-border/60">
                <Linha rotulo="Itens vendidos" valor={brl(det.financeiro.itens_centavos)} />
                <Linha rotulo="Descontos e cupons" valor={`−${brl(det.financeiro.descontos_centavos)}`}
                  cor={det.financeiro.descontos_centavos > 0 ? 'text-destructive' : undefined} />
                <Linha rotulo="Taxa de entrega recebida" valor={`+${brl(det.financeiro.entrega_centavos)}`} />
                <Linha rotulo="Faturamento bruto" valor={brl(det.financeiro.bruto_centavos)} forte />
                <Linha rotulo="Comissão da plataforma" valor={`−${brl(det.financeiro.comissao_centavos)}`}
                  cor={det.financeiro.comissao_centavos > 0 ? 'text-destructive' : undefined} />
                <div className="mt-1 rounded-lg bg-emerald-500/10 px-3">
                  <Linha rotulo="Líquido a receber" forte
                    valor={brl(det.financeiro.liquido_centavos)}
                    cor="text-emerald-700 dark:text-emerald-400" />
                </div>
              </div>
              {/*
                O CANCELADO NÃO É DEDUÇÃO — ele nunca entrou no bruto. Subtraí-lo
                faria o líquido sair menor do que a loja de fato recebe.
              */}
              <p className="mt-3 text-[12px] text-muted-foreground">
                Fora da conta: <b className={NUM}>{brl(det.financeiro.cancelado.total_centavos)}</b> em{' '}
                {det.financeiro.cancelado.qtd} {det.financeiro.cancelado.qtd === 1 ? 'pedido cancelado' : 'pedidos cancelados'} —
                dinheiro que deixou de entrar, e por isso não é desconto do que entrou.
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Taxa de cartão e prazo de recebimento não entram aqui: são do contrato com a
                sua adquirente, e o sistema não guarda esses valores.
              </p>
            </Bloco>

            <Bloco>
              <Titulo>Fechamento de caixa</Titulo>
              {det.financeiro.caixas.length === 0 ? (
                <Vazio>Nenhum caixa aberto no período.</Vazio>
              ) : (
                <div className="divide-y divide-border/60">
                  {det.financeiro.caixas.map(c => (
                    <Linha key={c.id}
                      rotulo={`${(c.aberto_em || '').slice(0, 10).split('-').reverse().join('/')} · ${c.usuario_abertura_nome || 'sem nome'}`}
                      apoio={c.status === 'aberto'
                        ? 'ainda aberto'
                        : `${c.vendas_quantidade} vendas · esperado ${brl(c.valor_esperado_centavos)} · contado ${brl(c.valor_contado_centavos)}`}
                      valor={c.status === 'aberto' ? '—'
                        : c.diferenca_centavos === 0 ? 'confere' : brl(c.diferenca_centavos)}
                      cor={c.status === 'aberto' ? 'text-muted-foreground'
                        : c.diferenca_centavos === 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'} />
                  ))}
                </div>
              )}
            </Bloco>
          </div>
        )
      )}

      {/* ══════════════════ 3. PRODUTOS ══════════════════ */}
      {aba === 'produtos' && d && (
        <div className="space-y-4">
          <Bloco>
            <Titulo acao={
              <span className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={buscaProduto} onChange={e => setBuscaProduto(e.target.value)}
                  placeholder="Buscar produto" aria-label="Buscar produto"
                  className="h-8 w-[180px] pl-7 text-[12.5px]" />
              </span>
            }>Mais vendidos</Titulo>
            {d.mais_vendidos.length === 0 ? <Vazio>Sem vendas no período.</Vazio> : (
              <div className="divide-y divide-border/60">
                {d.mais_vendidos
                  .filter(m => !buscaProduto.trim() || m.nome_produto.toLowerCase().includes(buscaProduto.trim().toLowerCase()))
                  .map((m, i) => (
                    <Linha key={m.nome_produto}
                      rotulo={<><span className={cn('mr-2 text-muted-foreground', NUM)}>{i + 1}</span>{m.nome_produto}</>}
                      apoio={`${m.quantidade} ${m.quantidade === 1 ? 'unidade' : 'unidades'}`}
                      valor={brl(m.total_centavos)} />
                  ))}
              </div>
            )}
            {/* Sem custo cadastrado não há margem — e uma coluna "Margem" com o
                preço dentro seria o preço com outro nome. */}
            <p className="mt-2 text-[12px] text-muted-foreground">
              Margem não aparece aqui: o sistema não tem custo de produto cadastrado.
            </p>
          </Bloco>

          <Bloco>
            <Titulo>Curva ABC</Titulo>
            <div className="divide-y divide-border/60">
              {d.curva_abc.classes.map(c => (
                <Linha key={c.classe} rotulo={`Classe ${c.classe}`} forte
                  apoio={`${c.itens} ${c.itens === 1 ? 'produto' : 'produtos'} · ${SOBRE_CLASSE[c.classe]}`}
                  valor={`${c.participacao_percent}%`} />
              ))}
            </div>
          </Bloco>

          {detalhes.isLoading || !det ? <Skeleton className="h-40" /> : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Bloco>
                <Titulo>Encalhados — sem venda no período</Titulo>
                {det.produtos.encalhados.length === 0 ? <Vazio>Todo produto do cardápio vendeu no período.</Vazio> : (
                  <div className="divide-y divide-border/60">
                    {det.produtos.encalhados.map(p => (
                      <Linha key={p.id} rotulo={p.nome}
                        apoio={`${p.categoria || 'sem categoria'} · última venda ${desdeQuando(p.ultima_venda)}`}
                        valor={brl(p.valor_centavos)} />
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[12px] text-muted-foreground">
                  Valor a preço de venda — o sistema não tem custo cadastrado.
                </p>
              </Bloco>
              <Bloco>
                <Titulo>Complementos mais pedidos</Titulo>
                {det.produtos.complementos.length === 0 ? <Vazio>Nenhum complemento escolhido no período.</Vazio> : (
                  <div className="divide-y divide-border/60">
                    {det.produtos.complementos.map(c => (
                      <Linha key={c.id} rotulo={c.nome} apoio={`${c.grupo} · ${c.quantidade}×`}
                        valor={brl(c.total_centavos)} />
                    ))}
                  </div>
                )}
              </Bloco>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════ 4. ESTOQUE ══════════════════ */}
      {aba === 'estoque' && (
        estoque.isLoading && !est ? <Skeleton className="h-64" /> : !est ? null : (
          <div className="space-y-4">
            {/*
              OS QUATRO CARTÕES SÃO O FILTRO. O número que se clica é o número
              que se encontra no chip e no rodapé — todos vindos da mesma
              consulta agregada, nunca da contagem das linhas da página.
            */}
            <Bloco className="p-0">
              <div className="grid grid-cols-2 divide-x divide-border/60 lg:grid-cols-4">
                <Cartao rotulo="Sem estoque" valor={est.totais.zerados}
                  apoio="fora do cardápio agora"
                  ativo={filtro === 'zerados'} cor="border-destructive"
                  onClick={() => { setFiltro('zerados'); setLimite(10); }} />
                <Cartao rotulo="Repor agora" valor={est.totais.repor}
                  apoio={`no mínimo ou abaixo (padrão ${est.regras.minimo_padrao})`}
                  ativo={filtro === 'repor'} cor="border-amber-500"
                  onClick={() => { setFiltro('repor'); setLimite(10); }} />
                <Cartao rotulo="Valor em estoque" valor={brl(est.totais.valor_total_centavos)}
                  apoio="a preço de venda" />
                <Cartao rotulo={`Parado há ${est.regras.parado_dias}+ dias`}
                  valor={brl(est.totais.valor_parado_centavos)}
                  apoio={`${est.totais.parados} ${est.totais.parados === 1 ? 'produto' : 'produtos'}`}
                  ativo={filtro === 'parados'} cor="border-primary"
                  onClick={() => { setFiltro('parados'); setLimite(10); }} />
              </div>
            </Bloco>

            <Bloco>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="flex gap-1 rounded-lg bg-muted p-1">
                  {(['repor', 'zerados', 'parados', 'todos'] as FiltroEstoque[]).map(f => (
                    <button key={f} type="button"
                      onClick={() => { setFiltro(f); setLimite(10); }}
                      className={cn('whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors',
                        filtro === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                      {NOME_FILTRO[f]}{' '}
                      <span className={NUM}>
                        {f === 'todos' ? est.totais.todos
                          : f === 'repor' ? est.totais.repor
                            : f === 'zerados' ? est.totais.zerados : est.totais.parados}
                      </span>
                    </button>
                  ))}
                </div>
                <span className="relative min-w-[200px] flex-1">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={buscaEstoque}
                    onChange={e => { setBuscaEstoque(e.target.value); setLimite(10); }}
                    placeholder="Buscar por nome ou código de barras"
                    aria-label="Buscar no estoque"
                    className="h-9 pl-7 text-[12.5px]" />
                </span>
                <Button variant="outline" size="sm" className="h-9 whitespace-nowrap"
                  onClick={listaDeCompra} disabled={est.itens.length === 0}>
                  <Download className="size-4" /> Gerar lista de compra
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left">
                  <thead>
                    <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      <th className="py-2 pr-3">Produto</th>
                      <th className="py-2 px-3 text-right">Em estoque</th>
                      <th className="py-2 px-3 text-right">Mínimo</th>
                      <th className="py-2 px-3 text-right">Giro/sem.</th>
                      <th className="py-2 px-3 text-right">Valor</th>
                      <th className="py-2 pl-3">Situação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {est.itens.length === 0 ? (
                      <tr><td colSpan={6}><Vazio>
                        {buscaEstoque.trim() ? 'Nenhum produto com esse nome ou código.' : 'Nada neste filtro.'}
                      </Vazio></td></tr>
                    ) : est.itens.map(p => {
                      const zerado = p.estoque <= 0;
                      const baixo = !zerado && p.estoque <= p.minimo;
                      return (
                        <tr key={p.id} className={cn(zerado && 'bg-destructive/5')}>
                          <td className="py-2 pr-3">
                            <span className="block text-[13px] font-semibold">{p.nome}</span>
                            <span className="block text-[11.5px] text-muted-foreground">
                              {p.categoria || 'sem categoria'} · {brl(p.preco_centavos)} cada
                            </span>
                          </td>
                          <td className={cn('px-3 text-right text-[13px] font-semibold', NUM,
                            zerado ? 'text-destructive' : baixo ? 'text-amber-600 dark:text-amber-400' : '')}>
                            {p.estoque}
                          </td>
                          <td className={cn('px-3 text-right text-[13px] text-muted-foreground', NUM)}>{p.minimo}</td>
                          <td className={cn('px-3 text-right text-[13px] text-muted-foreground', NUM)}>
                            {(Number(p.giro_semana) || 0).toFixed(1)}
                          </td>
                          <td className={cn('px-3 text-right text-[13px]', NUM)}>{brl(p.valor_centavos)}</td>
                          <td className="pl-3">
                            <span className="flex items-center gap-1.5 text-[12px]">
                              <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full',
                                zerado ? 'bg-destructive' : baixo ? 'bg-amber-500' : 'bg-emerald-600')} />
                              {zerado ? 'sem estoque' : baixo ? 'repor' : `vendeu ${desdeQuando(p.ultima_venda)}`}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/*
                O RODAPÉ FALA DO FILTRO INTEIRO, não da página. `itens.length`
                diria "10 de 10" numa loja com 463 zerados — e quem confere uma
                vez e vê que não fecha não confia no relatório de novo.
              */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
                <span>
                  {buscaEstoque.trim()
                    ? <>{est.total_do_filtro} {est.total_do_filtro === 1 ? 'resultado' : 'resultados'} para “{buscaEstoque.trim()}”</>
                    : <>Mostrando <b className={NUM}>{Math.min(est.limite, est.total_do_filtro)}</b> de{' '}
                      <b className={NUM}>{est.total_do_filtro}</b> · filtro {NOME_FILTRO[filtro]}
                      {' · valor do filtro '}<b className={NUM}>{brl(est.valor_do_filtro_centavos)}</b></>}
                </span>
                {est.tem_mais && (
                  <Button variant="outline" size="sm" className="h-8 whitespace-nowrap"
                    onClick={() => setLimite(l => Math.min(200, l + 20))}
                    disabled={limite >= 200}>
                    {limite >= 200 ? 'use a busca ou o CSV para o resto' : 'Carregar mais'}
                  </Button>
                )}
              </div>
            </Bloco>

            <Bloco>
              <Titulo>Valor em estoque por categoria</Titulo>
              {(() => {
                /* Da página carregada, e o rótulo diz isso: somar categoria no
                   servidor é outra consulta, e este bloco é leitura de apoio —
                   não pode passar por total da loja. */
                const porCat = new Map<string, { itens: number; valor: number }>();
                for (const p of est.itens) {
                  const k = p.categoria || 'sem categoria';
                  const a = porCat.get(k) ?? { itens: 0, valor: 0 };
                  porCat.set(k, { itens: a.itens + 1, valor: a.valor + p.valor_centavos });
                }
                const linhas = [...porCat.entries()].sort((a, b) => b[1].valor - a[1].valor);
                if (linhas.length === 0) return <Vazio>Nada neste filtro.</Vazio>;
                return (
                  <>
                    <div className="divide-y divide-border/60">
                      {linhas.map(([cat, v]) => (
                        <Linha key={cat} rotulo={cat} apoio={`${v.itens} ${v.itens === 1 ? 'item' : 'itens'}`}
                          valor={brl(v.valor)} />
                      ))}
                    </div>
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      Soma das {est.itens.length} linhas carregadas, não da loja inteira.
                    </p>
                  </>
                );
              })()}
            </Bloco>

            <p className="text-[12px] text-muted-foreground">
              Não há histórico de movimentação: o sistema não registra entrada, perda nem
              contagem de inventário — o estoque é um número que a venda diminui e a
              sincronização do Maxx Gestão sobrescreve.
            </p>
          </div>
        )
      )}

      {/* ══════════════════ 5. CLIENTES ══════════════════ */}
      {aba === 'clientes' && (
        detalhes.isLoading || !det ? <Skeleton className="h-64" /> : (
          <div className="space-y-4">
            <Bloco className="p-0">
              <div className="grid grid-cols-2 divide-x divide-border/60 lg:grid-cols-4">
                <Cartao rotulo="Clientes que compraram" valor={det.clientes.compraram}
                  apoio={`${det.clientes.anterior.compraram} no período anterior`} />
                <Cartao rotulo="Novos" valor={det.clientes.novos}
                  apoio={det.clientes.compraram > 0
                    ? `${Math.round((det.clientes.novos / det.clientes.compraram) * 100)}% dos compradores`
                    : '—'} />
                <Cartao rotulo="Recorrentes" valor={det.clientes.compraram - det.clientes.novos}
                  apoio={det.clientes.compraram > 0
                    ? `${(det.clientes.pedidos / det.clientes.compraram).toFixed(1)} pedidos por cliente`
                    : '—'} />
                <Cartao rotulo="Pedidos" valor={det.clientes.pedidos}
                  apoio={`${det.clientes.anterior.pedidos} no período anterior`} />
              </div>
            </Bloco>

            <Bloco>
              <Titulo>Quem compra mais</Titulo>
              {det.clientes.top.length === 0 ? <Vazio>Sem vendas no período.</Vazio> : (
                <div className="divide-y divide-border/60">
                  {det.clientes.top.map((c, i) => (
                    <Linha key={c.id}
                      rotulo={<><span className={cn('mr-2 text-muted-foreground', NUM)}>{i + 1}</span>{c.nome}</>}
                      apoio={`${c.pedidos} ${c.pedidos === 1 ? 'pedido' : 'pedidos'} · ticket ${brl(Math.round(c.ticket_centavos))} · último ${desdeQuando(c.ultimo)}`}
                      valor={brl(c.total_centavos)} />
                  ))}
                </div>
              )}
            </Bloco>
          </div>
        )
      )}

      {/* ══════════════════ 6. OPERAÇÃO ══════════════════ */}
      {aba === 'operacao' && d && (
        detalhes.isLoading || !det ? <Skeleton className="h-64" /> : (
          <div className="space-y-4">
            <Bloco>
              <Titulo>Tempo médio até cada etapa</Titulo>
              {det.operacao.etapas.length === 0 ? <Vazio>Sem pedidos entregues no período.</Vazio> : (
                <div className="divide-y divide-border/60">
                  {det.operacao.etapas.map(e => (
                    <Linha key={e.status} rotulo={NOME_ETAPA[e.status] || e.status}
                      apoio={`${e.amostras} ${e.amostras === 1 ? 'pedido' : 'pedidos'} · contado desde a entrada do pedido`}
                      valor={duracao(e.segundos)} />
                  ))}
                </div>
              )}
            </Bloco>

            <Bloco>
              <Titulo>Movimento por horário</Titulo>
              {d.por_hora.length === 0 ? <Vazio>Sem vendas no período.</Vazio> : (
                <div className="flex h-24 items-end gap-1">
                  {d.por_hora.map(h => (
                    <span key={h.hora} className="flex h-full flex-1 flex-col items-center justify-end"
                      title={`${h.hora}h: ${h.qtd} pedidos`}>
                      <Barra valor={h.qtd} maximo={maxHora} destaque={h.qtd === maxHora} />
                      <span className={cn('mt-1 text-[10px] text-muted-foreground', NUM)}>{h.hora}</span>
                    </span>
                  ))}
                </div>
              )}
            </Bloco>

            <div className="grid gap-4 lg:grid-cols-2">
              <Bloco>
                <Titulo>Cancelamentos por motivo</Titulo>
                {det.operacao.motivos.length === 0 ? <Vazio>Nenhum cancelamento no período.</Vazio> : (
                  <div className="divide-y divide-border/60">
                    {det.operacao.motivos.map(m => (
                      <Linha key={m.motivo} rotulo={m.motivo}
                        apoio={`${m.qtd} ${m.qtd === 1 ? 'pedido' : 'pedidos'}`}
                        valor={brl(m.total_centavos)} cor="text-destructive" />
                    ))}
                  </div>
                )}
              </Bloco>
              <Bloco>
                <Titulo>Entregadores</Titulo>
                {det.operacao.entregadores.length === 0 ? <Vazio>Nenhuma entrega com entregador no período.</Vazio> : (
                  <div className="divide-y divide-border/60">
                    {det.operacao.entregadores.map(e => (
                      <Linha key={e.id} rotulo={e.nome}
                        apoio={`${e.entregas} ${e.entregas === 1 ? 'entrega' : 'entregas'} · ${duracao(e.segundos)} em média`}
                        valor={brl(e.taxas_centavos)} />
                    ))}
                  </div>
                )}
              </Bloco>
            </div>
          </div>
        )
      )}
    </div>
  );
}
