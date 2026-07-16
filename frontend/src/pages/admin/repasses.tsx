import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Percent, Filter, X, Download } from 'lucide-react';
import { AdminLayout } from './layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, ehSuperAdmin, tokenSessao } from '@/lib/api';
import { brl } from '@/lib/format';

interface Repasse {
  loja_id: number;
  loja_nome: string;
  pedidos: number;
  faturamento_centavos: number;
  comissao_centavos: number;
  repasse_centavos: number;
}

export function TelaRepasses() {
  const { mostrar } = useToast();
  const superAdmin = ehSuperAdmin();
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [aplicados, setAplicados] = useState({ de: '', ate: '' });
  const [novaComissao, setNovaComissao] = useState('');
  const [salvandoComissao, setSalvandoComissao] = useState(false);

  const repassesQ = useQuery({
    queryKey: ['admin-repasses', aplicados],
    queryFn: () => {
      const params = new URLSearchParams();
      if (aplicados.de) params.set('de', aplicados.de);
      if (aplicados.ate) params.set('ate', aplicados.ate);
      const qs = params.toString();
      return api<{ repasses: Repasse[] }>('GET', `/api/admin/repasses${qs ? '?' + qs : ''}`).then(r => r.repasses);
    },
  });

  const comissaoQ = useQuery({
    queryKey: ['admin-comissao'],
    queryFn: () => api<{ comissao_percentual: number }>('GET', '/api/admin/comissao'),
  });

  async function salvarComissao(e: React.FormEvent) {
    e.preventDefault();
    setSalvandoComissao(true);
    try {
      await api('PUT', '/api/admin/comissao', { comissao_percentual: Number(novaComissao) });
      mostrar({ tipo: 'sucesso', titulo: `Comissão atualizada para ${novaComissao}%` });
      comissaoQ.refetch();
      setNovaComissao('');
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setSalvandoComissao(false);
    }
  }

  async function exportarCsv() {
    try {
      const params = new URLSearchParams();
      if (aplicados.de) params.set('de', aplicados.de);
      if (aplicados.ate) params.set('ate', aplicados.ate);
      const qs = params.toString();
      const resp = await fetch(`/api/admin/repasses/csv${qs ? '?' + qs : ''}`, {
        headers: { Authorization: `Bearer ${tokenSessao('admin')}` },
      });
      if (!resp.ok) throw new Error('Falha ao gerar o CSV.');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `repasses-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      mostrar({ tipo: 'erro', titulo: err.message || 'Não foi possível exportar.' });
    }
  }

  const repasses = repassesQ.data ?? [];
  const totalFaturamento = repasses.reduce((s, r) => s + r.faturamento_centavos, 0);
  const totalComissao = repasses.reduce((s, r) => s + r.comissao_centavos, 0);
  const totalRepasse = repasses.reduce((s, r) => s + r.repasse_centavos, 0);

  return (
    <AdminLayout titulo="Repasses">
      <div className="space-y-5 max-w-4xl mx-auto">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2">
            <TrendingUp className="size-6 text-primary" /> Comissão e repasses
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Relatório financeiro por loja — apenas pedidos entregues.
          </p>
        </div>

        {/* Comissão */}
        <Card className="border-primary/20">
          <CardContent className="p-5">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
                  <Percent className="size-6 text-primary" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Comissão da plataforma</div>
                  <div className="text-3xl font-extrabold tabular-nums mt-0.5">
                    {comissaoQ.isLoading ? '…' : `${comissaoQ.data?.comissao_percentual ?? 0}%`}
                  </div>
                </div>
              </div>
              {superAdmin && (
                <form onSubmit={salvarComissao} className="flex items-end gap-2">
                  <div>
                    <Label>Novo %</Label>
                    <Input
                      type="number" min="0" max="50" step="0.5"
                      value={novaComissao}
                      onChange={e => setNovaComissao(e.target.value)}
                      placeholder="Ex: 10"
                      className="w-28"
                      required
                    />
                  </div>
                  <Button type="submit" size="sm" disabled={salvandoComissao}>
                    {salvandoComissao ? 'Salvando…' : 'Alterar'}
                  </Button>
                </form>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Filtro período */}
        <Card>
          <CardContent className="p-4">
            <form
              onSubmit={e => { e.preventDefault(); setAplicados({ de, ate }); }}
              className="flex items-end gap-3 flex-wrap"
            >
              <div>
                <Label>De</Label>
                <Input type="date" value={de} onChange={e => setDe(e.target.value)} />
              </div>
              <div>
                <Label>Até</Label>
                <Input type="date" value={ate} onChange={e => setAte(e.target.value)} />
              </div>
              <Button type="submit"><Filter className="size-3.5" /> Filtrar</Button>
              {(de || ate) && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setDe(''); setAte(''); setAplicados({ de: '', ate: '' }); }}>
                  <X className="size-3.5" /> Limpar
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={exportarCsv}>
                <Download className="size-3.5" /> Exportar CSV
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Totais */}
        {!repassesQ.isLoading && repasses.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-5 text-center">
                <div className="text-xl font-extrabold tabular-nums">{brl(totalFaturamento)}</div>
                <div className="text-xs text-muted-foreground mt-1 font-medium">Faturamento total</div>
              </CardContent>
            </Card>
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-5 text-center">
                <div className="text-xl font-extrabold tabular-nums text-primary">{brl(totalComissao)}</div>
                <div className="text-xs text-muted-foreground mt-1 font-medium">Comissão da plataforma</div>
              </CardContent>
            </Card>
            <Card className="border-emerald-500/20 bg-emerald-500/5">
              <CardContent className="p-5 text-center">
                <div className="text-xl font-extrabold tabular-nums text-emerald-600">{brl(totalRepasse)}</div>
                <div className="text-xs text-muted-foreground mt-1 font-medium">A repassar às lojas</div>
              </CardContent>
            </Card>
          </div>
        )}

        {repassesQ.isLoading && (
          <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        )}

        {!repassesQ.isLoading && repasses.length === 0 && (
          <Card><CardContent className="p-10 text-center text-muted-foreground">
            Nenhum pedido entregue no período selecionado.
          </CardContent></Card>
        )}

        <div className="space-y-2">
          {repasses.map(r => (
            <Card key={r.loja_id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{r.loja_nome}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {r.pedidos} pedido{r.pedidos !== 1 ? 's' : ''} entregues
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-6 text-right text-sm">
                    <div>
                      <div className="tabular-nums font-semibold">{brl(r.faturamento_centavos)}</div>
                      <div className="text-xs text-muted-foreground">faturamento</div>
                    </div>
                    <div>
                      <div className="tabular-nums font-semibold text-primary">{brl(r.comissao_centavos)}</div>
                      <div className="text-xs text-muted-foreground">comissão</div>
                    </div>
                    <div>
                      <div className="tabular-nums font-bold text-emerald-600">{brl(r.repasse_centavos)}</div>
                      <div className="text-xs text-muted-foreground">repasse</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
