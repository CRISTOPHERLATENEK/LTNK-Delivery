/**
 * Log de auditoria — todas as ações administrativas mutáveis (aprovar/
 * suspender/excluir loja, criar/promover/remover admin, mudar comissão,
 * editar marca/configurações, criar/editar tenant, bloquear/desbloquear
 * usuário) ficam registradas aqui com quem fez, quando e o alvo.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Search, Calendar } from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { dataLocal } from '@/lib/format';

interface Registro {
  id: number;
  admin_id: number | null;
  admin_nome: string;
  admin_email: string;
  acao: string;
  alvo_tipo: string;
  alvo_id: number | null;
  alvo_desc: string;
  detalhes: string;
  criado_em: string;
}

const CORES: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'secondary'> = {
  aprovar: 'success', criar: 'success', promover: 'warning',
  suspender: 'danger', excluir: 'danger', remover: 'danger', bloquear: 'danger', rebaixar: 'warning',
  desbloquear: 'success', editar: 'info', alterar: 'info',
};

function corAcao(acao: string): 'success' | 'danger' | 'warning' | 'info' | 'secondary' {
  const sufixo = acao.split('.')[1] || acao;
  return CORES[sufixo] || 'secondary';
}

function rotuloAcao(acao: string): string {
  const mapa: Record<string, string> = {
    'loja.aprovar': 'Loja aprovada', 'loja.suspender': 'Loja suspensa', 'loja.criar': 'Loja criada',
    'loja.excluir': 'Loja excluída', 'loja.comissao': 'Comissão da loja alterada',
    'usuario.bloquear': 'Usuário bloqueado', 'usuario.desbloquear': 'Usuário desbloqueado',
    'admin.criar': 'Admin criado', 'admin.remover': 'Admin removido',
    'admin.promover': 'Promovido a super admin', 'admin.rebaixar': 'Rebaixado de super admin',
    'comissao.alterar': 'Comissão global alterada', 'marca.editar': 'Marca da plataforma editada',
    'configuracoes.editar': 'Configurações gerais editadas',
    'tenant.criar': 'Cliente (tenant) criado', 'tenant.editar': 'Cliente (tenant) editado',
  };
  return mapa[acao] || acao;
}

export function TelaAuditoria() {
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [busca, setBusca] = useState('');

  const consulta = useQuery({
    queryKey: ['admin-auditoria', de, ate],
    queryFn: () => {
      const params = new URLSearchParams();
      if (de) params.set('de', de);
      if (ate) params.set('ate', ate);
      return api<{ registros: Registro[] }>('GET', `/api/admin/auditoria?${params}`).then(r => r.registros);
    },
  });

  const lista = (consulta.data ?? []).filter(r =>
    !busca ||
    r.admin_nome.toLowerCase().includes(busca.toLowerCase()) ||
    r.alvo_desc.toLowerCase().includes(busca.toLowerCase()) ||
    rotuloAcao(r.acao).toLowerCase().includes(busca.toLowerCase())
  );

  return (
    <AdminLayout titulo="Auditoria">
      <div className="space-y-5 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <History className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Auditoria</h1>
            <p className="text-sm text-muted-foreground">
              Histórico de ações administrativas — quem fez o quê e quando.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por admin, ação ou alvo…"
              className="w-full h-10 pl-10 pr-4 rounded-xl border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <input type="date" value={de} onChange={e => setDe(e.target.value)}
              className="h-10 pl-9 pr-3 rounded-xl border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
          </div>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <input type="date" value={ate} onChange={e => setAte(e.target.value)}
              className="h-10 pl-9 pr-3 rounded-xl border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" />
          </div>
        </div>

        {consulta.isLoading && <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>}

        {!consulta.isLoading && lista.length === 0 && (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Nenhum registro encontrado.</CardContent></Card>
        )}

        <div className="space-y-1.5">
          {lista.map(r => (
            <Card key={r.id}>
              <CardContent className="p-3.5 flex items-center gap-3">
                <Badge variant={corAcao(r.acao)} className="text-[10px] shrink-0 min-w-[92px] justify-center">
                  {rotuloAcao(r.acao)}
                </Badge>
                <div className="flex-1 min-w-0 text-sm">
                  <span className="font-semibold">{r.admin_nome}</span>
                  {r.alvo_desc && <span className="text-muted-foreground"> · {r.alvo_desc}</span>}
                  {r.detalhes && <span className="text-muted-foreground"> ({r.detalhes})</span>}
                </div>
                <div className="text-xs text-muted-foreground shrink-0 tabular-nums">{dataLocal(r.criado_em)}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
