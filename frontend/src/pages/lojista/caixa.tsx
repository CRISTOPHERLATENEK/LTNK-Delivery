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
  AlertTriangle, CheckCircle2, CreditCard, QrCode, History,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { Falha } from '@/components/ui/estado';
import { api, ApiError } from '@/lib/api';
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
}
interface CaixaAberto {
  id: number; aberto_em: string; usuario_abertura_nome: string; valor_abertura_centavos: number;
}
interface Fechado {
  id: number; aberto_em: string; fechado_em: string;
  usuario_abertura_nome: string; usuario_fechamento_nome: string;
  valor_contado_centavos: number; valor_esperado_centavos: number;
  diferenca_centavos: number; observacoes: string | null;
}
interface Resposta {
  aberto: CaixaAberto | null;
  resumo?: Resumo;
  vendas?: { quantidade: number };
  movimentos?: Movimento[];
  historico?: Fechado[];
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
        : <Aberto caixa={d.aberto} resumo={d.resumo!} vendas={d.vendas!} movimentos={d.movimentos ?? []} onMudou={recarregar} />}
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

      {historico.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold">
              <History className="size-4 text-muted-foreground" /> Últimos fechamentos
            </div>
            <div className="divide-y divide-border/60">
              {historico.map(h => <LinhaHistorico key={h.id} h={h} />)}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
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

function Aberto({ caixa, resumo, vendas, movimentos, onMudou }: {
  caixa: CaixaAberto; resumo: Resumo; vendas: { quantidade: number };
  movimentos: Movimento[]; onMudou: () => void;
}) {
  const { mostrar } = useToast();
  const pedirConfirmacao = useConfirm();
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
              <span className="inline-flex size-2 rounded-full bg-emerald-500" />
              Caixa aberto
            </div>
            <div className="text-xs text-muted-foreground">
              desde {dataLocal(caixa.aberto_em)} · {caixa.usuario_abertura_nome} · {vendas.quantidade} venda(s)
            </div>
          </div>
        </CardContent>
      </Card>

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
              <div key={m.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                <div className="min-w-0">
                  <span className={cn('font-semibold', m.tipo === 'sangria' ? 'text-destructive' : 'text-emerald-600')}>
                    {m.tipo === 'sangria' ? 'Sangria' : 'Suprimento'}
                  </span>
                  {m.motivo && <span className="text-muted-foreground"> · {m.motivo}</span>}
                  <div className="text-[10px] text-muted-foreground">{m.usuario_nome} · {dataLocal(m.criado_em)}</div>
                </div>
                <span className={cn('shrink-0 font-bold tabular-nums',
                  m.tipo === 'sangria' ? 'text-destructive' : 'text-emerald-600')}>
                  {m.tipo === 'sangria' ? '−' : '+'}{brl(m.valor_centavos)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
