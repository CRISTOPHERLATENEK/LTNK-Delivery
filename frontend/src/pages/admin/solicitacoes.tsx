/**
 * Fila de solicitações — clientes que os revendedores pediram e ainda não
 * existem.
 *
 * Nada aqui foi provisionado: aprovar é o que cria o banco. Por isso a recusa
 * é barata (não há o que desfazer) e a aprovação é a decisão de peso.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, Check, X, Handshake, Building2, Mail, Phone } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Falha } from '@/components/ui/estado';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError } from '@/lib/api';
import { dataLocal } from '@/lib/format';

interface Solicitacao {
  id: number;
  revendedor_id: number;
  revendedor_nome: string | null;
  nome: string;
  slug: string;
  nome_loja: string;
  categoria: string;
  dono_nome: string;
  dono_email: string;
  dono_telefone: string;
  status: 'pendente' | 'aprovada' | 'recusada';
  motivo_recusa: string | null;
  tenant_id: number | null;
  criado_em: string;
  decidido_em: string;
}

export function PainelSolicitacoes() {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();
  const [recusando, setRecusando] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const consulta = useQuery({
    queryKey: ['admin-solicitacoes'],
    queryFn: () => api<{ solicitacoes: Solicitacao[] }>('GET', '/api/admin/solicitacoes').then(r => r.solicitacoes),
  });
  const lista = consulta.data ?? [];
  const pendentes = lista.filter(s => s.status === 'pendente');

  async function aprovar(s: Solicitacao) {
    const ok = await confirmar({
      titulo: `Aprovar ${s.nome}?`,
      // O que a aprovação FAZ, dito antes de fazer: é aqui que a infraestrutura
      // do cliente passa a existir e a cobrança começa a valer.
      descricao: `Cria o banco de dados do cliente e o acesso de ${s.dono_nome}. `
        + `O endereço ${s.slug}.maxxpedidos.com.br passa a funcionar, e o cliente entra na conta de ${s.revendedor_nome || 'quem pediu'}.`,
      confirmar: 'Aprovar e criar',
    });
    if (!ok) return;
    setOcupado(true);
    try {
      await api('POST', `/api/admin/solicitacoes/${s.id}/aprovar`);
      mostrar({ tipo: 'sucesso', titulo: 'Cliente criado.', descricao: `${s.slug}.maxxpedidos.com.br já está no ar.` });
      qc.invalidateQueries({ queryKey: ['admin-solicitacoes'] });
      qc.invalidateQueries({ queryKey: ['admin-tenants'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setOcupado(false);
    }
  }

  async function recusar(s: Solicitacao) {
    setOcupado(true);
    try {
      await api('POST', `/api/admin/solicitacoes/${s.id}/recusar`, { motivo });
      mostrar({ tipo: 'info', titulo: 'Solicitação recusada.', descricao: 'O revendedor vê o motivo no painel dele.' });
      setRecusando(null); setMotivo('');
      qc.invalidateQueries({ queryKey: ['admin-solicitacoes'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setOcupado(false);
    }
  }

  return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {pendentes.length > 0
            ? `${pendentes.length} aguardando sua análise`
            : 'Nada aguardando análise'}
          {' · '}pedidas pelos revendedores
        </p>

        {consulta.isLoading && (
          <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
        )}
        {consulta.isError && <Falha compacto erro={consulta.error} aoTentar={() => consulta.refetch()} />}

        {!consulta.isLoading && lista.length === 0 && !consulta.isError && (
          <Card><CardContent className="space-y-2 p-10 text-center text-muted-foreground">
            <Inbox className="mx-auto size-10 opacity-20" />
            <p className="font-medium">Nenhuma solicitação ainda</p>
            <p className="text-sm">Quando um revendedor pedir um cliente novo, ele aparece aqui.</p>
          </CardContent></Card>
        )}

        <div className="space-y-3">
          {lista.map(s => (
            <Card key={s.id} className={s.status === 'pendente' ? 'border-amber-500/40' : 'opacity-75'}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Building2 className="size-4 shrink-0 text-primary" />
                      <span className="font-bold">{s.nome}</span>
                      <span className="font-mono text-xs text-muted-foreground">{s.slug}</span>
                      {s.status === 'pendente' && <Badge variant="warning">pendente</Badge>}
                      {s.status === 'aprovada' && <Badge variant="success">aprovada</Badge>}
                      {s.status === 'recusada' && <Badge variant="danger">recusada</Badge>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Handshake className="size-3" /> {s.revendedor_nome || 'revendedor removido'}
                      </span>
                      <span className="flex items-center gap-1"><Mail className="size-3" /> {s.dono_email}</span>
                      {s.dono_telefone && <span className="flex items-center gap-1"><Phone className="size-3" /> {s.dono_telefone}</span>}
                      <span>{dataLocal(s.criado_em)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Loja: <b className="text-foreground">{s.nome_loja}</b> · {s.categoria} · responsável {s.dono_nome}
                    </p>
                  </div>

                  {s.status === 'pendente' && recusando !== s.id && (
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="success" disabled={ocupado} onClick={() => aprovar(s)}>
                        <Check className="size-4" /> Aprovar
                      </Button>
                      <Button size="sm" variant="destructive" disabled={ocupado} onClick={() => { setRecusando(s.id); setMotivo(''); }}>
                        <X className="size-4" /> Recusar
                      </Button>
                    </div>
                  )}
                </div>

                {/*
                  MOTIVO OBRIGATÓRIO na recusa. Sem ele o revendedor reenvia o
                  mesmo pedido sem saber o que mudar, e a fila vira um ciclo.
                */}
                {recusando === s.id && (
                  <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                    <label htmlFor={`motivo-${s.id}`} className="text-xs font-semibold">
                      Por que está recusando? O revendedor vai ler.
                    </label>
                    <textarea
                      id={`motivo-${s.id}`}
                      rows={2}
                      maxLength={300}
                      value={motivo}
                      onChange={e => setMotivo(e.target.value)}
                      placeholder="Ex.: o identificador escolhido é muito genérico, use o nome da marca."
                      className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-destructive focus:ring-2 focus:ring-destructive/25"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" disabled={ocupado || motivo.trim().length < 3} onClick={() => recusar(s)}>
                        Confirmar recusa
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setRecusando(null); setMotivo(''); }}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}

                {s.status === 'recusada' && s.motivo_recusa && (
                  <p className="rounded-lg bg-muted px-3 py-2 text-xs">
                    <span className="font-semibold">Motivo: </span>{s.motivo_recusa}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
  );
}
