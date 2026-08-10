/**
 * Entregadores — visão da plataforma: métricas e bloqueio/desbloqueio.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bike, Phone, Mail, Ban, CheckCircle2, Search } from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Falha } from '@/components/ui/estado';
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
  /** Presente só na lista agregada do painel master. */
  tenant_id?: number;
  tenant_nome?: string;
}

type Situacao = 'disponiveis' | 'em_rota' | 'bloqueados';

const ABAS: Array<{ chave: Situacao | 'todos'; rotulo: string }> = [
  { chave: 'todos',       rotulo: 'Todos' },
  { chave: 'disponiveis', rotulo: 'Disponíveis' },
  { chave: 'em_rota',     rotulo: 'Em rota' },
  { chave: 'bloqueados',  rotulo: 'Bloqueados' },
];

export function TelaEntregadores() {
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const [termo, setTermo] = useState('');
  const [aba, setAba] = useState<Situacao | 'todos'>('todos');
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
      // `tenant_id` junto: o id do entregador se repete entre clientes, e sem
      // ele o bloqueio cairia no usuário de mesmo id do banco central.
      await api('POST', `/api/admin/usuarios/${e.id}/bloquear-desbloquear${e.tenant_id ? `?tenant_id=${e.tenant_id}` : ''}`);
      mostrar({ tipo: 'sucesso', titulo: `Entregador ${e.bloqueado ? 'desbloqueado' : 'bloqueado'}.` });
      consulta.refetch();
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  const totalEntregas = entregadores.reduce((s, e) => s + e.entregas, 0);
  const emRota = entregadores.reduce((s, e) => s + e.ativas, 0);

  /*
   * A situação de cada entregador é derivada, não é coluna: bloqueado vence
   * tudo, senão ter entrega ativa quer dizer que está em rota. É a mesma regra
   * do badge da linha — calculada uma vez só pra badge e chip não divergirem.
   */
  const situacao = (e: Entregador): Situacao =>
    e.bloqueado ? 'bloqueados' : e.ativas > 0 ? 'em_rota' : 'disponiveis';

  const busca = termo.trim().toLowerCase();
  const filtrados = entregadores.filter(e => {
    if (aba !== 'todos' && situacao(e) !== aba) return false;
    if (!busca) return true;
    return `${e.nome} ${e.email} ${e.telefone ?? ''}`.toLowerCase().includes(busca);
  });

  const contagem: Record<Situacao | 'todos', number> = {
    todos: entregadores.length,
    disponiveis: entregadores.filter(e => situacao(e) === 'disponiveis').length,
    em_rota: entregadores.filter(e => situacao(e) === 'em_rota').length,
    bloqueados: entregadores.filter(e => situacao(e) === 'bloqueados').length,
  };

  return (
    <AdminLayout titulo="Entregadores">
      <div className="space-y-5 max-w-4xl mx-auto">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2">
            <Bike className="size-6 text-primary" /> Entregadores
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {entregadores.length} cadastrados · {emRota} em rota agora · {totalEntregas} entregas no total
          </p>
        </div>

        {/* Busca + chips de situação */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por nome, e-mail ou telefone…"
              value={termo}
              onChange={ev => setTermo(ev.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {ABAS.map(a => (
              <button
                key={a.chave}
                type="button"
                onClick={() => setAba(a.chave)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                  aba === a.chave
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent',
                )}
              >
                {a.rotulo}
                <span className={cn(
                  'rounded-full px-1.5 tabular-nums',
                  aba === a.chave ? 'bg-primary-foreground/20' : 'bg-muted',
                )}>
                  {contagem[a.chave]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {consulta.isLoading && (
          <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
        )}

        {consulta.isError && (
          <Falha compacto erro={consulta.error} aoTentar={() => consulta.refetch()} />
        )}

        {!consulta.isLoading && entregadores.length === 0 && !consulta.isError && (
          <Card><CardContent className="p-10 text-center text-muted-foreground">
            Nenhum entregador cadastrado ainda.
          </CardContent></Card>
        )}

        {/* Filtro não achou nada — diferente de "não há entregadores" */}
        {!consulta.isLoading && entregadores.length > 0 && filtrados.length === 0 && (
          <Card><CardContent className="p-10 text-center text-muted-foreground">
            Nenhum entregador com esses filtros.
          </CardContent></Card>
        )}

        <div className="space-y-2">
          {filtrados.map(e => (
            <Card key={`${e.tenant_id ?? 0}-${e.id}`} className={e.bloqueado ? 'opacity-60' : ''}>
              <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary font-bold shrink-0">
                  {(e.nome || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{e.nome}</span>
                    {e.tenant_nome && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">{e.tenant_nome}</span>
                    )}
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
