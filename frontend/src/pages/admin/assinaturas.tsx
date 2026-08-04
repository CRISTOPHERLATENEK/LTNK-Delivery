/**
 * ASSINATURAS — quanto cada cliente (tenant) paga, quando vence, e o corte.
 *
 * POR QUE ESTA TELA EXISTE: o sistema já era multi-tenant, mas não havia onde
 * registrar quem paga o quê. Isso significava controlar cobrança de cabeça, o que
 * funciona com 2 clientes e vira caos com 15 — a decisão de "corto ou não" passa
 * a ser tomada 15 vezes por mês, de memória.
 *
 * A tela mostra o status recalculado PARA AGORA (`status_agora`), não o gravado
 * pelo último job: assinatura que venceu hoje apareceria "ativa" até a madrugada.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, AlertTriangle, CheckCircle2, Ban, Clock, RefreshCw, Plus } from 'lucide-react';
import { AdminLayout } from './layout';
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

type Status = 'teste' | 'ativa' | 'inadimplente' | 'suspensa' | 'cancelada';

interface Assinatura {
  id: number;
  tenant_id: number;
  tenant_nome: string;
  tenant_slug: string;
  tenant_ativo: 0 | 1;
  plano: string;
  valor_centavos: number;
  dia_vencimento: number;
  dias_tolerancia: number;
  status: Status;
  status_agora: Status;
  dias_atraso: number;
  vence_em: string;
  pago_em: string;
  observacoes: string | null;
}

interface SemAssinatura {
  tenant_id: number; tenant_nome: string; tenant_slug: string; tenant_ativo: 0 | 1;
}

const APARENCIA: Record<Status, { rotulo: string; classe: string; Icone: typeof CheckCircle2 }> = {
  teste:        { rotulo: 'Em teste',      classe: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',  Icone: Clock },
  ativa:        { rotulo: 'Em dia',        classe: 'bg-emerald-500/15 text-emerald-600',               Icone: CheckCircle2 },
  inadimplente: { rotulo: 'Atrasada',      classe: 'bg-amber-500/20 text-amber-700 dark:text-amber-400', Icone: AlertTriangle },
  suspensa:     { rotulo: 'Suspensa',      classe: 'bg-destructive/15 text-destructive',               Icone: Ban },
  cancelada:    { rotulo: 'Cancelada',     classe: 'bg-muted text-muted-foreground',                   Icone: Ban },
};

function Selo({ status }: { status: Status }) {
  const { rotulo, classe, Icone } = APARENCIA[status] ?? APARENCIA.teste;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold', classe)}>
      <Icone className="size-3.5" /> {rotulo}
    </span>
  );
}

export function TelaAssinaturas() {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();
  const [editando, setEditando] = useState<number | null>(null);

  const consulta = useQuery({
    queryKey: ['admin-assinaturas'],
    queryFn: () => api<{ assinaturas: Assinatura[]; sem_assinatura: SemAssinatura[] }>('GET', '/api/admin/assinaturas'),
  });

  async function processarAgora() {
    if (!(await confirmar({
      titulo: 'Processar vencimentos agora?',
      descricao: 'Recalcula o status de todas as assinaturas e SUSPENDE quem passou da tolerância. '
        + 'É o mesmo que roda automaticamente a cada 6 horas.',
      confirmar: 'Processar',
    }))) return;
    try {
      const r = await api<{ verificadas: number; suspensos: number; reativados: number }>(
        'POST', '/api/admin/assinaturas/processar');
      mostrar({
        tipo: 'sucesso',
        titulo: `${r.verificadas} assinatura(s) verificada(s)`,
        descricao: `${r.suspensos} suspensa(s), ${r.reativados} reativada(s).`,
      });
      qc.invalidateQueries({ queryKey: ['admin-assinaturas'] });
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    }
  }

  const dados = consulta.data;
  const emRisco = (dados?.assinaturas ?? []).filter(a =>
    a.status_agora === 'inadimplente' || a.status_agora === 'suspensa');
  const receita = (dados?.assinaturas ?? [])
    .filter(a => a.status_agora === 'ativa' || a.status_agora === 'inadimplente')
    .reduce((s, a) => s + a.valor_centavos, 0);

  return (
    <AdminLayout titulo="Assinaturas">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <CreditCard className="size-5 text-primary" /> Assinaturas
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Quanto cada cliente paga, quando vence e o corte automático de acesso.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={processarAgora}>
            <RefreshCw className="size-4" /> Processar vencimentos
          </Button>
        </div>

        {/* Receita recorrente: soma de quem está em dia OU atrasado (atrasado
            ainda é receita a receber; suspenso e cancelado não entram). */}
        {!!dados && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Card><CardContent className="p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Receita recorrente</div>
              <div className="text-xl font-extrabold tabular-nums text-emerald-600">{brl(receita)}</div>
              <div className="text-[11px] text-muted-foreground">por mês, contando atrasados</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Clientes</div>
              <div className="text-xl font-extrabold tabular-nums">{dados.assinaturas.length}</div>
              <div className="text-[11px] text-muted-foreground">{dados.sem_assinatura.length} sem assinatura</div>
            </CardContent></Card>
            <Card className={emRisco.length ? 'border-amber-500/40' : undefined}><CardContent className="p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Em risco</div>
              <div className={cn('text-xl font-extrabold tabular-nums', emRisco.length && 'text-amber-600')}>
                {emRisco.length}
              </div>
              <div className="text-[11px] text-muted-foreground">atrasadas ou suspensas</div>
            </CardContent></Card>
          </div>
        )}

        {consulta.isLoading && <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-28" />)}</div>}
        {consulta.isError && <Falha erro={consulta.error} aoTentar={() => consulta.refetch()} />}

        {/* Tenants SEM assinatura vêm primeiro: são os que estão usando de graça
            sem ninguém ter decidido isso. */}
        {!!dados?.sem_assinatura.length && (
          <Card className="border-dashed">
            <CardContent className="p-4 space-y-2">
              <div className="text-sm font-bold">Sem assinatura definida</div>
              <p className="text-xs text-muted-foreground">
                Estes clientes estão no ar sem cobrança registrada. Defina o plano para entrarem no controle de vencimento.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {dados.sem_assinatura.map(t => (
                  <Button key={t.tenant_id} type="button" size="sm" variant="outline"
                    onClick={() => setEditando(t.tenant_id)}>
                    <Plus className="size-3.5" /> {t.tenant_nome}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {dados?.assinaturas.map(a => (
          <LinhaAssinatura
            key={a.tenant_id}
            a={a}
            aberta={editando === a.tenant_id}
            onAlternar={() => setEditando(e => (e === a.tenant_id ? null : a.tenant_id))}
            onMudou={() => qc.invalidateQueries({ queryKey: ['admin-assinaturas'] })}
          />
        ))}

        {/* Formulário de tenant que ainda não tem assinatura */}
        {editando !== null && !dados?.assinaturas.some(a => a.tenant_id === editando) && (
          <Card><CardContent className="p-4">
            <Formulario
              tenantId={editando}
              nome={dados?.sem_assinatura.find(t => t.tenant_id === editando)?.tenant_nome || ''}
              onSalvo={() => { setEditando(null); qc.invalidateQueries({ queryKey: ['admin-assinaturas'] }); }}
            />
          </CardContent></Card>
        )}
      </div>
    </AdminLayout>
  );
}

function LinhaAssinatura({ a, aberta, onAlternar, onMudou }: {
  a: Assinatura; aberta: boolean; onAlternar: () => void; onMudou: () => void;
}) {
  const { mostrar } = useToast();
  const [valorPago, setValorPago] = useState((a.valor_centavos / 100).toFixed(2));
  const [registrando, setRegistrando] = useState(false);

  async function registrarPagamento() {
    const centavos = Math.round(parseFloat(valorPago.replace(',', '.')) * 100);
    if (!Number.isFinite(centavos) || centavos <= 0) {
      mostrar({ tipo: 'erro', titulo: 'Informe o valor recebido.' });
      return;
    }
    setRegistrando(true);
    try {
      await api('POST', `/api/admin/assinaturas/${a.id}/pagamento`, {
        valor_centavos: centavos, forma: 'manual',
      });
      mostrar({
        tipo: 'sucesso',
        titulo: 'Pagamento registrado!',
        // O acesso volta na hora: esperar o job da madrugada seria suporte na certa.
        descricao: 'Vencimento avançado e acesso liberado imediatamente.',
      });
      onMudou();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally {
      setRegistrando(false);
    }
  }

  return (
    <Card className={a.status_agora === 'suspensa' ? 'border-destructive/40' : undefined}>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{a.tenant_nome}</span>
              <Selo status={a.status_agora} />
              {/* Acesso cortado é o que o lojista SENTE — mostra separado do status
                  da assinatura, porque um tenant pode estar desativado à mão. */}
              {a.tenant_ativo === 0 && (
                <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-bold text-destructive">
                  acesso cortado
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {brl(a.valor_centavos)}/mês · vence dia {a.dia_vencimento} · tolera {a.dias_tolerancia} dia(s)
              {a.vence_em && <> · próximo: <b>{a.vence_em.split('-').reverse().join('/')}</b></>}
              {a.dias_atraso > 0 && <span className="font-bold text-amber-600"> · {a.dias_atraso} dia(s) de atraso</span>}
            </div>
            {a.pago_em && (
              <div className="text-[11px] text-muted-foreground">último pagamento: {dataLocal(a.pago_em)}</div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">R$</span>
              <Input value={valorPago} onChange={e => setValorPago(e.target.value)}
                inputMode="decimal" className="h-9 w-24 text-right" />
            </div>
            <Button type="button" size="sm" disabled={registrando} onClick={registrarPagamento}>
              {registrando ? '…' : 'Registrar pagamento'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onAlternar}>
              {aberta ? 'Fechar' : 'Editar'}
            </Button>
          </div>
        </div>

        {aberta && (
          <div className="border-t border-border pt-3">
            <Formulario tenantId={a.tenant_id} nome={a.tenant_nome} atual={a} onSalvo={onMudou} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const STATUS_EDITAVEIS: Status[] = ['teste', 'ativa', 'cancelada'];

function Formulario({ tenantId, nome, atual, onSalvo }: {
  tenantId: number; nome: string; atual?: Assinatura; onSalvo: () => void;
}) {
  const { mostrar } = useToast();
  const [plano, setPlano] = useState(atual?.plano || 'mensal');
  const [valor, setValor] = useState(atual ? (atual.valor_centavos / 100).toFixed(2) : '');
  const [dia, setDia] = useState(String(atual?.dia_vencimento ?? 5));
  const [tolerancia, setTolerancia] = useState(String(atual?.dias_tolerancia ?? 5));
  const [status, setStatus] = useState<Status>(atual?.status ?? 'teste');
  const [obs, setObs] = useState(atual?.observacoes || '');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      await api('PUT', `/api/admin/assinaturas/${tenantId}`, {
        plano,
        valor_centavos: Math.round((parseFloat(valor.replace(',', '.')) || 0) * 100),
        dia_vencimento: Number(dia) || 5,
        dias_tolerancia: Number(tolerancia) || 0,
        status,
        observacoes: obs,
      });
      mostrar({ tipo: 'sucesso', titulo: `Assinatura de ${nome} salva!` });
      onSalvo();
    } catch (e) {
      if (e instanceof ApiError) mostrar({ tipo: 'erro', titulo: e.message });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Plano</Label>
          <Input value={plano} onChange={e => setPlano(e.target.value)} placeholder="mensal" />
        </div>
        <div>
          <Label>Valor (R$)</Label>
          <Input value={valor} onChange={e => setValor(e.target.value)} inputMode="decimal" placeholder="199,00" />
        </div>
        <div>
          <Label>Dia do vencimento</Label>
          <Input value={dia} onChange={e => setDia(e.target.value)} inputMode="numeric" placeholder="5" />
          {/* 1–28 não é capricho: dia 29+ não existe em fevereiro e a data
              escorregaria pra março, atrasando a cobrança um mês inteiro. */}
          <p className="mt-1 text-[11px] text-muted-foreground">De 1 a 28 (fevereiro não tem dia 29+).</p>
        </div>
        <div>
          <Label>Tolerância (dias)</Label>
          <Input value={tolerancia} onChange={e => setTolerancia(e.target.value)} inputMode="numeric" placeholder="5" />
          <p className="mt-1 text-[11px] text-muted-foreground">Dias de atraso antes de cortar o acesso.</p>
        </div>
      </div>

      <div>
        <Label className="mb-2 block">Situação</Label>
        <div className="flex flex-wrap gap-2">
          {STATUS_EDITAVEIS.map(s => (
            <button key={s} type="button" onClick={() => setStatus(s)}
              className={cn('rounded-lg border-2 px-3 py-1.5 text-xs font-semibold transition-colors',
                status === s ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
              {APARENCIA[s].rotulo}
            </button>
          ))}
        </div>
        {/* "Atrasada" e "Suspensa" não são editáveis de propósito: são calculadas
            pela data. Deixar o operador setar à mão criaria um estado que o job
            desfaz na próxima passada, o que parece bug. */}
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Atrasada e Suspensa são calculadas pelo vencimento — não se escolhem aqui.
        </p>
      </div>

      <div>
        <Label>Observações</Label>
        <Input value={obs} onChange={e => setObs(e.target.value)} placeholder="Negociação, desconto combinado, contato…" />
      </div>

      <Button type="button" onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando…' : 'Salvar assinatura'}
      </Button>
    </div>
  );
}
