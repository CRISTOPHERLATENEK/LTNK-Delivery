/**
 * CAIXA POR TURNO — abrir, sangria/suprimento, fechar conferindo o dinheiro.
 *
 * POR QUE ESTA TELA EXISTE: não havia nada. O PDV registrava venda e o dia
 * terminava sem ninguém conferir a gaveta contra o que o sistema diz. Diferença
 * de dinheiro só aparecia quando alguém reclamava — e aí já não dava pra saber de
 * qual turno veio, nem quem estava no caixa.
 *
 * A DECISÃO QUE A TELA PRECISA DEIXAR ÓBVIA: a conferência é só de DINHEIRO.
 * Cartão e Pix aparecem em bloco separado, marcados como "não entram na gaveta" —
 * senão o operador conta o dinheiro, vê um esperado que inclui cartão, e acha que
 * está faltando milhares de reais.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote, LockOpen, Lock, ArrowDownCircle, ArrowUpCircle,
  AlertTriangle, CheckCircle2, CreditCard, QrCode, History, ChevronDown,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { Falha } from '@/components/ui/estado';
import { api, ApiError, sessaoUsuario } from '@/lib/api';
import { imprimirFechamentoCaixa } from '@/lib/impressao';
import { brl, dataLocal } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Resumo {
  abertura_centavos: number;
  vendas_dinheiro_centavos: number;
  suprimentos_centavos: number;
  sangrias_centavos: number;
  esperado_centavos: number;
  cartao_centavos: number;
  pix_centavos: number;
}
interface Movimento {
  id: number; tipo: 'sangria' | 'suprimento'; valor_centavos: number;
  motivo: string; usuario_nome: string; criado_em: string;
  /** Preenchido = cancelado. Fica no histórico riscado, não desaparece. */
  cancelado_em?: string; cancelado_por?: string;
}
interface CaixaAberto {
  id: number; aberto_em: string; usuario_abertura_nome: string; valor_abertura_centavos: number;
}
interface Fechado {
  id: number; aberto_em: string; fechado_em: string;
  usuario_abertura_nome: string; usuario_fechamento_nome: string;
  valor_abertura_centavos: number;
  valor_contado_centavos: number; valor_esperado_centavos: number;
  diferenca_centavos: number; observacoes: string | null;
  // Totais congelados no fechamento — antes eram descartados e só se
  // recuperavam reconsultando pedidos por data.
  vendas_dinheiro_centavos: number; vendas_cartao_centavos: number;
  vendas_pix_centavos: number; vendas_quantidade: number;
  sangrias_centavos: number; suprimentos_centavos: number;
}
interface Resposta {
  aberto: CaixaAberto | null;
  resumo?: Resumo;
  vendas?: { quantidade: number };
  movimentos?: Movimento[];
  historico?: Fechado[];
  /** Horas aberto + se já passou do razoável (caixa esquecido). */
  tempo?: { horas: number; alerta: boolean };
}

/** Reais digitados → centavos. Aceita vírgula, que é como se digita aqui. */
function paraCentavos(valor: string): number {
  const n = parseFloat(valor.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function CaixaLoja() {
  const { mostrar } = useToast();
  const qc = useQueryClient();

  const consulta = useQuery({
    queryKey: ['lojista-caixa'],
    queryFn: () => api<Resposta>('GET', '/api/lojista/caixa'),
    // Vendas entram pelo PDV enquanto esta tela está aberta; sem atualizar, o
    // esperado ficaria velho justo na hora de conferir.
    refetchInterval: 15000,
  });

  const recarregar = () => qc.invalidateQueries({ queryKey: ['lojista-caixa'] });

  if (consulta.isLoading) return <Skeleton className="h-64" />;
  if (consulta.isError) return <Falha erro={consulta.error} aoTentar={() => consulta.refetch()} />;

  const d = consulta.data;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Banknote className="size-5 text-primary" /> Caixa
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Abertura, retiradas e fechamento com conferência do dinheiro da gaveta.
        </p>
      </div>

      {!d?.aberto
        ? <Abrir onAberto={recarregar} historico={d?.historico ?? []} erroToast={mostrar} />
        : <Aberto caixa={d.aberto} resumo={d.resumo!} vendas={d.vendas!} movimentos={d.movimentos ?? []}
            tempo={d.tempo} historico={d.historico ?? []} onMudou={recarregar} />}
    </div>
  );
}

function Abrir({ onAberto, historico }: {
  onAberto: () => void; historico: Fechado[];
  erroToast: ReturnType<typeof useToast>['mostrar'];
}) {
  const { mostrar } = useToast();
  const [valor, setValor] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function abrir() {
    setEnviando(true);
    try {
      await api('POST', '/api/lojista/caixa/abrir', { valor_abertura_centavos: paraCentavos(valor) });
      mostrar({ tipo: 'sucesso', titulo: 'Caixa aberto!' });
      onAberto();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally { setEnviando(false); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center gap-2 font-bold">
            <LockOpen className="size-4 text-primary" /> Nenhum caixa aberto
          </div>
          <p className="text-sm text-muted-foreground">
            Informe quanto há de dinheiro na gaveta agora (fundo de troco) e abra o caixa.
            As vendas do balcão e das mesas passam a ser somadas a partir deste momento.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label>Valor de abertura (R$)</Label>
              <Input value={valor} onChange={e => setValor(e.target.value)}
                inputMode="decimal" placeholder="0,00" className="w-32 text-right" />
            </div>
            <Button type="button" size="lg" onClick={abrir} disabled={enviando}>
              {enviando ? 'Abrindo…' : <><LockOpen className="size-4" /> Abrir caixa</>}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Sem fundo de troco? Deixe 0,00 — dá pra reforçar depois com um suprimento.
          </p>
        </CardContent>
      </Card>

      <CardHistorico historico={historico} />
    </div>
  );
}

/**
 * Últimos fechamentos.
 *
 * Aparece com o caixa ABERTO também: é durante o turno que se quer comparar
 * ("ontem faltou 20 também, ou é só hoje?"), e antes o histórico só existia na
 * tela de caixa fechado. Com o turno em andamento vem recolhido, pra não empurrar
 * o formulário de fechamento pra fora da tela no celular.
 */
function CardHistorico({ historico, recolhido = false }: { historico: Fechado[]; recolhido?: boolean }) {
  if (historico.length === 0) return null;
  const lista = (
    <div className="divide-y divide-border/60">
      {historico.map(h => <LinhaHistorico key={h.id} h={h} />)}
    </div>
  );
  const titulo = (
    <span className="flex items-center gap-2 text-sm font-bold">
      <History className="size-4 text-muted-foreground" /> Últimos fechamentos
      <span className="font-normal text-muted-foreground">({historico.length})</span>
    </span>
  );
  return (
    <Card>
      <CardContent className="p-4">
        {recolhido ? (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
              {titulo}
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-2">{lista}</div>
          </details>
        ) : (
          <>
            <div className="mb-2">{titulo}</div>
            {lista}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LinhaHistorico({ h }: { h: Fechado }) {
  const falta = h.diferenca_centavos < -200;
  const sobra = h.diferenca_centavos > 200;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="font-semibold">{dataLocal(h.fechado_em)}</div>
        <div className="text-[11px] text-muted-foreground">
          abriu {h.usuario_abertura_nome || '—'} · fechou {h.usuario_fechamento_nome || '—'}
        </div>
        {h.observacoes?.trim() && (
          <div className="mt-0.5 text-[11px] italic text-muted-foreground">{h.observacoes.trim()}</div>
        )}
      </div>
      <div className="text-right">
        <div className="text-xs text-muted-foreground">
          contado {brl(h.valor_contado_centavos)} · esperado {brl(h.valor_esperado_centavos)}
        </div>
        <div className={cn('text-sm font-bold tabular-nums',
          falta ? 'text-destructive' : sobra ? 'text-amber-600' : 'text-emerald-600')}>
          {h.diferenca_centavos === 0 ? 'fechou exato'
            : `${h.diferenca_centavos > 0 ? 'sobra' : 'falta'} ${brl(Math.abs(h.diferenca_centavos))}`}
        </div>
      </div>
    </div>
  );
}

function Aberto({ caixa, resumo, vendas, movimentos, tempo, historico, onMudou }: {
  caixa: CaixaAberto; resumo: Resumo; vendas: { quantidade: number };
  movimentos: Movimento[]; tempo?: { horas: number; alerta: boolean };
  historico: Fechado[]; onMudou: () => void;
}) {
  const { mostrar } = useToast();
  const pedirConfirmacao = useConfirm();
  // Nome e largura da bobina saem da config da loja — MESMA query key que o PDV
  // usa, então não gera requisição extra (o React Query compartilha o cache).
  const lojaQ = useQuery({
    queryKey: ['lojista-loja'],
    queryFn: () => api<{ loja: Record<string, unknown> }>('GET', '/api/lojista/loja').then(r => r.loja),
    staleTime: 60_000,
  });
  const nomeLoja = String(lojaQ.data?.nome || 'Loja');
  const largura: '80' | '58' = lojaQ.data?.impressora_largura === '58' ? '58' : '80';
  const [contado, setContado] = useState('');
  const [obs, setObs] = useState('');
  const [fechando, setFechando] = useState(false);

  const contadoCent = paraCentavos(contado);
  const diferenca = contadoCent - resumo.esperado_centavos;
  const preencheu = contado.trim() !== '';

  async function fechar() {
    if (!preencheu) {
      mostrar({ tipo: 'erro', titulo: 'Informe o valor contado na gaveta.' });
      return;
    }
    // Confirmação com o número na frente: fechar é irreversível, e o valor
    // digitado errado vira "quebra de caixa" no relatório de alguém.
    const rotulo = diferenca === 0 ? 'fecha exato'
      : `${diferenca > 0 ? 'sobra' : 'falta'} de ${brl(Math.abs(diferenca))}`;
    if (!(await pedirConfirmacao({
      titulo: 'Fechar o caixa?',
      descricao: `Contado ${brl(contadoCent)} contra ${brl(resumo.esperado_centavos)} esperado — ${rotulo}. `
        + 'Depois de fechado não dá pra reabrir este turno.',
      confirmar: 'Fechar caixa',
    }))) return;

    setFechando(true);
    try {
      const r = await api<{ diferenca_centavos: number; situacao: 'ok' | 'sobra' | 'falta' }>(
        'POST', '/api/lojista/caixa/fechar',
        { valor_contado_centavos: contadoCent, observacoes: obs });

      /*
       * IMPRIME o comprovante: é o papel que o operador assina e guarda.
       * Conferência que só existe na tela não serve no dia em que houver
       * divergência e alguém precisar mostrar o que foi contado, por quem e
       * quando. Best-effort — impressora fora não pode desfazer o fechamento,
       * que já foi gravado no servidor.
       */
      try {
        imprimirFechamentoCaixa({
          loja_nome: nomeLoja,
          aberto_em: caixa.aberto_em,
          fechado_em: new Date().toISOString(),
          usuario_abertura: caixa.usuario_abertura_nome,
          usuario_fechamento: sessaoUsuario('lojista')?.nome || '',
          abertura_centavos: resumo.abertura_centavos,
          vendas_dinheiro_centavos: resumo.vendas_dinheiro_centavos,
          vendas_cartao_centavos: resumo.cartao_centavos,
          vendas_pix_centavos: resumo.pix_centavos,
          vendas_quantidade: vendas.quantidade,
          suprimentos_centavos: resumo.suprimentos_centavos,
          sangrias_centavos: resumo.sangrias_centavos,
          esperado_centavos: resumo.esperado_centavos,
          contado_centavos: contadoCent,
          diferenca_centavos: r.diferenca_centavos,
          observacoes: obs,
        }, largura);
      } catch { /* impressora fora não desfaz o fechamento */ }

      mostrar({
        tipo: r.situacao === 'ok' ? 'sucesso' : 'info',
        titulo: r.situacao === 'ok' ? 'Caixa fechado, conferido!' : `Caixa fechado com ${r.situacao}`,
        descricao: r.situacao === 'ok' ? undefined : brl(Math.abs(r.diferenca_centavos)),
      });
      onMudou();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally { setFechando(false); }
  }

  return (
    <div className="space-y-4">
      <Card className="border-primary/40">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold">
              <span className={cn('inline-flex size-2 rounded-full', tempo?.alerta ? 'bg-amber-500' : 'bg-emerald-500')} />
              Caixa aberto
              {tempo && <span className="font-normal text-muted-foreground">· {tempo.horas}h</span>}
            </div>
            <div className="text-xs text-muted-foreground">
              desde {dataLocal(caixa.aberto_em)} · {caixa.usuario_abertura_nome} · {vendas.quantidade} venda(s)
            </div>
          </div>
        </CardContent>
      </Card>

      {/*
        CAIXA ESQUECIDO ABERTO: continua somando as vendas dos dias seguintes, e
        quando alguém fechar a divergência será enorme e sem como reconstituir de
        qual dia veio o quê. O aviso não impede nada — faz o problema aparecer no
        dia em que ainda dá pra resolver.
      */}
      {tempo?.alerta && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div>
            <b className="text-amber-700 dark:text-amber-400">Este caixa está aberto há {tempo.horas} horas.</b>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Se o turno já acabou, feche-o. Caixa aberto continua somando as vendas dos dias
              seguintes, e depois não dá pra saber de qual dia veio a diferença.
            </p>
          </div>
        </div>
      )}

      {/* CONFERÊNCIA — só dinheiro */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Dinheiro na gaveta
          </div>
          <Linha rotulo="Abertura (fundo de troco)" valor={resumo.abertura_centavos} />
          <Linha rotulo="Vendas em dinheiro" valor={resumo.vendas_dinheiro_centavos} />
          {resumo.suprimentos_centavos > 0 && <Linha rotulo="Suprimentos" valor={resumo.suprimentos_centavos} />}
          {resumo.sangrias_centavos > 0 && <Linha rotulo="Sangrias" valor={-resumo.sangrias_centavos} />}
          <div className="flex items-center justify-between border-t border-border pt-2 text-base font-extrabold">
            <span>Esperado na gaveta</span>
            <span className="tabular-nums">{brl(resumo.esperado_centavos)}</span>
          </div>
        </CardContent>
      </Card>

      {/*
        Cartão e Pix em bloco SEPARADO e rotulado: eles caem no banco, não na
        gaveta. Somados no esperado, toda conferência fecharia errada por milhares
        de reais e o operador aprenderia a ignorar a divergência.
      */}
      {(resumo.cartao_centavos > 0 || resumo.pix_centavos > 0) && (
        <Card className="bg-muted/30">
          <CardContent className="space-y-2 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Não entra na gaveta — cai no banco
            </div>
            {resumo.cartao_centavos > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <CreditCard className="size-3.5" /> Cartão
                </span>
                <span className="tabular-nums">{brl(resumo.cartao_centavos)}</span>
              </div>
            )}
            {resumo.pix_centavos > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <QrCode className="size-3.5" /> Pix
                </span>
                <span className="tabular-nums">{brl(resumo.pix_centavos)}</span>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Confira estes valores pelo extrato da maquininha e do banco, não pela gaveta.
            </p>
          </CardContent>
        </Card>
      )}

      <Movimentos onMudou={onMudou} movimentos={movimentos} />

      {/* FECHAMENTO */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Lock className="size-4 text-primary" /> Fechar o caixa
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>Dinheiro contado (R$)</Label>
              <Input value={contado} onChange={e => setContado(e.target.value)}
                inputMode="decimal" placeholder="0,00" className="w-32 text-right" autoFocus />
            </div>
            <div className="flex-1 min-w-[12rem]">
              <Label>Observação (opcional)</Label>
              <Input value={obs} onChange={e => setObs(e.target.value)}
                placeholder="Ex.: R$ 20 usados pra troco na padaria" />
            </div>
          </div>

          {/* Prévia da divergência ANTES de fechar: fechar é irreversível, e ver
              o número antes evita o "digitei errado" que vira quebra de caixa. */}
          {preencheu && (
            <div className={cn('flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold',
              Math.abs(diferenca) <= 200 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : diferenca < 0 ? 'bg-destructive/10 text-destructive'
                : 'bg-amber-500/15 text-amber-700 dark:text-amber-400')}>
              {Math.abs(diferenca) <= 200 ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
              {diferenca === 0 ? 'Fecha exato.'
                : Math.abs(diferenca) <= 200 ? `Diferença de ${brl(Math.abs(diferenca))} — dentro da tolerância.`
                : diferenca < 0 ? `Faltam ${brl(Math.abs(diferenca))} na gaveta.`
                : `Sobram ${brl(diferenca)} na gaveta.`}
            </div>
          )}

          <Button type="button" size="lg" className="w-full" onClick={fechar} disabled={fechando || !preencheu}>
            {fechando ? 'Fechando…' : <><Lock className="size-4" /> Fechar caixa</>}
          </Button>
        </CardContent>
      </Card>

      <CardHistorico historico={historico} recolhido />
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className={cn('tabular-nums', valor < 0 && 'text-destructive')}>{brl(valor)}</span>
    </div>
  );
}

function Movimentos({ movimentos, onMudou }: { movimentos: Movimento[]; onMudou: () => void }) {
  const { mostrar } = useToast();
  const [tipo, setTipo] = useState<'sangria' | 'suprimento'>('sangria');
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function lancar() {
    setEnviando(true);
    try {
      await api('POST', '/api/lojista/caixa/movimento', {
        tipo, valor_centavos: paraCentavos(valor), motivo,
      });
      mostrar({ tipo: 'sucesso', titulo: tipo === 'sangria' ? 'Sangria lançada.' : 'Suprimento lançado.' });
      setValor(''); setMotivo('');
      onMudou();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally { setEnviando(false); }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Retirada e reforço
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setTipo('sangria')}
            className={cn('flex items-center justify-center gap-1.5 rounded-xl border-2 py-2.5 text-sm font-semibold transition-colors',
              tipo === 'sangria' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground')}>
            <ArrowDownCircle className="size-4" /> Sangria
          </button>
          <button type="button" onClick={() => setTipo('suprimento')}
            className={cn('flex items-center justify-center gap-1.5 rounded-xl border-2 py-2.5 text-sm font-semibold transition-colors',
              tipo === 'suprimento' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground')}>
            <ArrowUpCircle className="size-4" /> Suprimento
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label>Valor (R$)</Label>
            <Input value={valor} onChange={e => setValor(e.target.value)}
              inputMode="decimal" placeholder="0,00" className="w-28 text-right" />
          </div>
          <div className="flex-1 min-w-[12rem]">
            <Label>{tipo === 'sangria' ? 'Motivo (obrigatório)' : 'Motivo'}</Label>
            <Input value={motivo} onChange={e => setMotivo(e.target.value)}
              placeholder={tipo === 'sangria' ? 'Ex.: depósito no banco' : 'Ex.: troco de R$ 50'} />
          </div>
          <Button type="button" onClick={lancar} disabled={enviando}>
            {enviando ? '…' : 'Lançar'}
          </Button>
        </div>

        {movimentos.length > 0 && (
          <div className="divide-y divide-border/60 border-t border-border pt-1">
            {movimentos.map(m => (
              <LinhaMovimento key={m.id} m={m} onMudou={onMudou} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Linha de um movimento, com CANCELAMENTO.
 *
 * Cancelado fica no histórico riscado, com quem cancelou — não desaparece. Apagar
 * a linha sumiria com o rastro de que houve erro, que é justamente o que uma
 * conferência precisa mostrar depois.
 */
function LinhaMovimento({ m, onMudou }: { m: Movimento; onMudou: () => void }) {
  const { mostrar } = useToast();
  const pedirConfirmacao = useConfirm();
  const [cancelando, setCancelando] = useState(false);
  const cancelado = !!m.cancelado_em;

  async function cancelar() {
    if (!(await pedirConfirmacao({
      titulo: 'Cancelar este lançamento?',
      descricao: `${m.tipo === 'sangria' ? 'Sangria' : 'Suprimento'} de ${brl(m.valor_centavos)}. `
        + 'Ele sai da conta do caixa, mas continua no histórico marcado como cancelado.',
      confirmar: 'Cancelar lançamento',
      destrutivo: true,
    }))) return;
    setCancelando(true);
    try {
      await api('POST', `/api/lojista/caixa/movimento/${m.id}/cancelar`);
      mostrar({ tipo: 'sucesso', titulo: 'Lançamento cancelado.', descricao: 'O esperado na gaveta foi recalculado.' });
      onMudou();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally { setCancelando(false); }
  }

  return (
    <div className={cn('flex items-center justify-between gap-2 py-2 text-xs', cancelado && 'opacity-60')}>
      <div className="min-w-0">
        <span className={cn('font-semibold',
          cancelado ? 'text-muted-foreground line-through'
            : m.tipo === 'sangria' ? 'text-destructive' : 'text-emerald-600')}>
          {m.tipo === 'sangria' ? 'Sangria' : 'Suprimento'}
        </span>
        {m.motivo && <span className={cn('text-muted-foreground', cancelado && 'line-through')}> · {m.motivo}</span>}
        <div className="text-[10px] text-muted-foreground">
          {m.usuario_nome} · {dataLocal(m.criado_em)}
          {cancelado && (
            <span className="ml-1 font-semibold text-amber-600">
              · CANCELADO por {m.cancelado_por || '—'}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={cn('font-bold tabular-nums',
          cancelado ? 'text-muted-foreground line-through'
            : m.tipo === 'sangria' ? 'text-destructive' : 'text-emerald-600')}>
          {m.tipo === 'sangria' ? '−' : '+'}{brl(m.valor_centavos)}
        </span>
        {!cancelado && (
          <button type="button" onClick={cancelar} disabled={cancelando}
            aria-label="Cancelar lançamento"
            className="rounded-lg px-2 py-1 text-[10px] font-bold text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
            {cancelando ? '…' : 'cancelar'}
          </button>
        )}
      </div>
    </div>
  );
}
