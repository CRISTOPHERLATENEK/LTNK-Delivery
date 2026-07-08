/**
 * Entregadores — visão da plataforma: métricas e bloqueio/desbloqueio.
 */
import { useQuery } from '@tanstack/react-query';
import { Bike, Phone, Mail, Ban, CheckCircle2 } from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError } from '@/lib/api';

interface Entregador {
  id: number;
  nome: string;
  email: string;
  telefone: string | null;
  bloqueado: 0 | 1;
  entregas: number;
  ativas: number;
  criado_em: string;
}

export function TelaEntregadores() {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const consulta = useQuery({
    queryKey: ['admin-entregadores'],
    queryFn: () => api<{ entregadores: Entregador[] }>('GET', '/api/admin/entregadores').then(r => r.entregadores),
    refetchInterval: 15000,
  });
  const entregadores = consulta.data ?? [];

  async function alternarBloqueio(e: Entregador) {
    const acao = e.bloqueado ? 'desbloquear' : 'bloquear';
    if (!(await confirmar({ titulo: `${acao[0].toUpperCase() + acao.slice(1)} ${e.nome}?`, confirmar: acao[0].toUpperCase() + acao.slice(1), destrutivo: !e.bloqueado }))) return;
    try {
      await api('POST', `/api/admin/usuarios/${e.id}/bloquear-desbloquear`);
      mostrar({ tipo: 'sucesso', titulo: `Entregador ${e.bloqueado ? 'desbloqueado' : 'bloqueado'}.` });
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  const totalEntregas = entregadores.reduce((s, e) => s + e.entregas, 0);
  const emRota = entregadores.reduce((s, e) => s + e.ativas, 0);

  return (
    <AdminLayout titulo="Entregadores">
      <div className="space-y-5 max-w-4xl">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2">
            <Bike className="size-6 text-primary" /> Entregadores
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {entregadores.length} cadastrados · {emRota} em rota agora · {totalEntregas} entregas no total
          </p>
        </div>

        {consulta.isLoading && (
          <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
        )}

        {!consulta.isLoading && entregadores.length === 0 && (
          <Card><CardContent className="p-10 text-center text-muted-foreground">
            Nenhum entregador cadastrado ainda.
          </CardContent></Card>
        )}

        <div className="space-y-2">
          {entregadores.map(e => (
            <Card key={e.id} className={e.bloqueado ? 'opacity-60' : ''}>
              <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary font-bold shrink-0">
                  {e.nome.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{e.nome}</span>
                    {e.bloqueado
                      ? <Badge variant="danger">Bloqueado</Badge>
                      : e.ativas > 0
                        ? <Badge variant="info">Em rota</Badge>
                        : <Badge variant="success">Disponível</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                    {e.email && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="size-3" /> {e.email}</span>}
                    {e.telefone && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Phone className="size-3" /> {e.telefone}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-extrabold tabular-nums">{e.entregas}</div>
                  <div className="text-[11px] text-muted-foreground">entregas</div>
                </div>
                <Button
                  variant={e.bloqueado ? 'success' : 'destructive'}
                  size="sm"
                  className="shrink-0"
                  onClick={() => alternarBloqueio(e)}
                >
                  {e.bloqueado ? <><CheckCircle2 className="size-4" /> Desbloquear</> : <><Ban className="size-4" /> Bloquear</>}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
