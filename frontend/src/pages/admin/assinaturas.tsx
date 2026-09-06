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
import {
  Cabecalho, Toolbar, Segmented, Tabela, TabelaCabecalho, TabelaLinha,
  TabelaRodape, CelulaNome, Num, Status, Botao, PainelLateral, baixarCsv, type Tom,
} from './ui';
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
  const [filtro, setFiltro] = useState<'todas' | 'risco' | 'ativa' | 'teste'>('todas');

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

  /*
   * ATRASADAS PRIMEIRO, e o resto por vencimento.
   *
   * Ordem alfabética faria a única assinatura atrasada de quinze aparecer no
   * meio da lista — que é o mesmo que não mostrar. A tela existe para responder
   * "de quem eu preciso cobrar", e a resposta tem que estar na primeira linha.
   */
  const PESO: Record<Status, number> = {
    inadimplente: 0, suspensa: 1, teste: 2, ativa: 3, cancelada: 4,
  };
  const ordenadas = [...(dados?.assinaturas ?? [])].sort((x, y) =>
    PESO[x.status_agora] - PESO[y.status_agora]
    || y.dias_atraso - x.dias_atraso
    || x.tenant_nome.localeCompare(y.tenant_nome));

  const visiveis = filtro === 'todas'
    ? ordenadas
    : filtro === 'risco'
      ? ordenadas.filter(a => a.status_agora === 'inadimplente' || a.status_agora === 'suspensa')
      : ordenadas.filter(a => a.status_agora === filtro);

  const emEdicao = editando === null
    ? null
    : dados?.assinaturas.find(a => a.tenant_id === editando) ?? null;
  const semAssinaturaEmEdicao = editando !== null && !emEdicao
    ? dados?.sem_assinatura.find(t => t.tenant_id === editando) ?? null
    : null;

  return (
    <AdminLayout titulo="Assinaturas">
      <div className="mx-auto max-w-4xl">
        <Cabecalho
          titulo="Assinaturas"
          subtitulo={
            consulta.isLoading ? 'Carregando…' : (
              <>
                {brl(receita)} por mês · {dados?.assinaturas.length ?? 0} clientes
                {!!dados?.sem_assinatura.length && ` · ${dados.sem_assinatura.length} sem assinatura`}
                {!!emRisco.length && ` · ${emRisco.length} em risco`}
              </>
            )
          }
          acoes={<Botao onClick={processarAgora}>Processar vencimentos</Botao>}
        />

        {/*
          TENANTS SEM ASSINATURA VÊM ANTES DA LISTA.
          São os que estão no ar sem ninguém ter decidido a cobrança — e é o
          único jeito de essa conta aparecer, já que eles não estão na tabela.
        */}
        {!!dados?.sem_assinatura.length && (
          <div className="mb-4 rounded-[6px] border p-3" style={{ borderColor: 'var(--adm-atencao)', background: 'rgba(199,154,75,0.06)' }}>
            <p className="text-[13px] font-bold">
              {dados.sem_assinatura.length === 1
                ? '1 cliente no ar sem cobrança registrada'
                : `${dados.sem_assinatura.length} clientes no ar sem cobrança registrada`}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {dados.sem_assinatura.map(t => (
                <Botao key={t.tenant_id} altura={30} onClick={() => setEditando(t.tenant_id)}>
                  {t.tenant_nome}
                </Botao>
              ))}
            </div>
          </div>
        )}

        <Toolbar>
          <Segmented
            valor={filtro}
            aoMudar={setFiltro}
            opcoes={[
              { v: 'todas', label: 'Todas', contagem: ordenadas.length },
              { v: 'risco', label: 'Em risco', contagem: ordenadas.filter(a => a.status_agora === 'inadimplente' || a.status_agora === 'suspensa').length },
              { v: 'ativa', label: 'Em dia', contagem: ordenadas.filter(a => a.status_agora === 'ativa').length },
              { v: 'teste', label: 'Em teste', contagem: ordenadas.filter(a => a.status_agora === 'teste').length },
            ]}
          />
        </Toolbar>

        {consulta.isError && <Falha erro={consulta.error} aoTentar={() => consulta.refetch()} />}

        {consulta.isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          <Tabela colunas="minmax(0,1.4fr) 110px 110px 90px 130px">
            <TabelaCabecalho>
              <span>Cliente</span>
              <span className="text-right">Valor</span>
              <span>Vence</span>
              <span className="text-right">Atraso</span>
              <span>Situação</span>
            </TabelaCabecalho>
            {visiveis.map((a, i) => (
              <TabelaLinha key={a.tenant_id} primeira={i === 0} aoClicar={() => setEditando(a.tenant_id)}>
                <CelulaNome nome={a.tenant_nome} sub={`/${a.tenant_slug} · ${a.plano}`} />
                <Num className="text-right">{brl(a.valor_centavos)}</Num>
                <Num className="text-[12px]">{a.vence_em ? dataLocal(a.vence_em) : '—'}</Num>
                {/* O atraso em dias é o número que decide cobrar ou cortar —
                    vermelho só quando existe, para não pintar a lista inteira. */}
                <Num className="text-right" >
                  {a.dias_atraso > 0
                    ? <span style={{ color: 'var(--adm-erro)' }}>{a.dias_atraso}d</span>
                    : <span style={{ color: 'var(--adm-dado)' }}>—</span>}
                </Num>
                <Status tom={TOM_ASSINATURA[a.status_agora] ?? 'neutro'}>
                  {APARENCIA[a.status_agora]?.rotulo ?? a.status_agora}
                </Status>
              </TabelaLinha>
            ))}
            <TabelaRodape
              total={visiveis.length}
              filtro={filtro === 'todas' ? undefined : filtro === 'risco' ? 'Em risco' : APARENCIA[filtro as Status]?.rotulo}
              aoExportar={visiveis.length > 0 ? () => baixarCsv(
                'assinaturas',
                ['Cliente', 'Slug', 'Plano', 'Valor', 'Dia', 'Vence em', 'Atraso (dias)', 'Situação'],
                visiveis.map(a => [
                  a.tenant_nome, a.tenant_slug, a.plano, (a.valor_centavos / 100).toFixed(2),
                  a.dia_vencimento, a.vence_em ?? '', a.dias_atraso,
                  APARENCIA[a.status_agora]?.rotulo ?? a.status_agora,
                ]),
              ) : undefined}
            />
          </Tabela>
        )}
      </div>

      <PainelLateral
        aberto={editando !== null}
        aoFechar={() => setEditando(null)}
        titulo={emEdicao?.tenant_nome ?? semAssinaturaEmEdicao?.tenant_nome ?? ''}
        subtitulo={emEdicao
          ? `${APARENCIA[emEdicao.status_agora]?.rotulo} · ${brl(emEdicao.valor_centavos)} · vence dia ${emEdicao.dia_vencimento}`
          : 'Sem assinatura definida'}
      >
        {emEdicao && (
          <LinhaAssinatura
            a={emEdicao}
            onMudou={() => qc.invalidateQueries({ queryKey: ['admin-assinaturas'] })}
          />
        )}
        {semAssinaturaEmEdicao && (
          <Formulario
            tenantId={semAssinaturaEmEdicao.tenant_id}
            nome={semAssinaturaEmEdicao.tenant_nome}
            onSalvo={() => { setEditando(null); qc.invalidateQueries({ queryKey: ['admin-assinaturas'] }); }}
          />
        )}
      </PainelLateral>
    </AdminLayout>
  );
}

/** A situação da assinatura no vocabulário de cor do painel. */
const TOM_ASSINATURA: Record<Status, Tom> = {
  ativa: 'ok',
  teste: 'neutro',
  inadimplente: 'atencao',
  suspensa: 'erro',
  cancelada: 'inativo',
};

/*
 * O CONTEÚDO do painel lateral de uma assinatura: registrar pagamento e editar.
 *
 * Deixou de ser uma linha que expande. Expandir empurrava as assinaturas
 * seguintes para baixo, e fechar exigia rolar de volta até achar a que abriu.
 */
function LinhaAssinatura({ a, onMudou }: {
  a: Assinatura; onMudou: () => void;
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
          </div>
        </div>

        {/* O formulário fica SEMPRE aberto dentro do painel: aqui não há lista
            atrás para preservar, e um segundo clique de "Editar" seria só um
            passo a mais entre a pessoa e o que ela veio fazer. */}
        <div className="border-t border-border pt-3">
          <Formulario tenantId={a.tenant_id} nome={a.tenant_nome} atual={a} onSalvo={onMudou} />
        </div>
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
