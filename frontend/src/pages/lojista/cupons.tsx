/**
 * Gestão de cupons de desconto do lojista — criar, ativar/desativar e remover.
 * Tipos: percentual (% off) ou fixo (R$ off), com pedido mínimo, limite de
 * usos e validade opcionais.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ticket, Plus, Pencil, Trash2, X, ToggleLeft, ToggleRight, Percent, BadgeDollarSign,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, ApiError } from '@/lib/api';
import { brl } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Cupom {
  id: number;
  codigo: string;
  tipo: 'percentual' | 'fixo';
  valor: number;
  minimo_centavos: number;
  usos_max: number;
  usos_count: number;
  validade: string | null;
  ativo: 0 | 1;
}

const FORM_VAZIO = {
  codigo: '', tipo: 'percentual' as 'percentual' | 'fixo',
  valor: '', minimo: '', usos_max: '', validade: '',
};
type FormCupom = typeof FORM_VAZIO;

export function CuponsLoja() {
  const [editando, setEditando] = useState<number | 'novo' | null>(null);
  const [form, setForm] = useState<FormCupom>(FORM_VAZIO);
  const [enviando, setEnviando] = useState(false);
  const { mostrar } = useToast();
  const confirmar = useConfirm();
  const qc = useQueryClient();

  const consulta = useQuery({
    queryKey: ['lojista-cupons'],
    queryFn: () => api<{ cupons: Cupom[] }>('GET', '/api/lojista/cupons').then(r => r.cupons),
  });

  const cupons = consulta.data ?? [];

  function abrirNovo() {
    setForm(FORM_VAZIO);
    setEditando('novo');
  }

  function abrirEdicao(c: Cupom) {
    setForm({
      codigo: c.codigo,
      tipo: c.tipo,
      valor: c.tipo === 'percentual' ? String(c.valor) : (c.valor / 100).toFixed(2),
      minimo: c.minimo_centavos ? (c.minimo_centavos / 100).toFixed(2) : '',
      usos_max: c.usos_max ? String(c.usos_max) : '',
      validade: c.validade || '',
    });
    setEditando(c.id);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    const corpo = {
      codigo: form.codigo,
      tipo: form.tipo,
      valor: form.valor,
      minimo: form.minimo || undefined,
      usos_max: form.usos_max || undefined,
      validade: form.validade || undefined,
    };
    try {
      if (editando === 'novo') {
        await api('POST', '/api/lojista/cupons', corpo);
        mostrar({ tipo: 'sucesso', titulo: 'Cupom criado!' });
      } else {
        await api('PUT', `/api/lojista/cupons/${editando}`, corpo);
        mostrar({ tipo: 'sucesso', titulo: 'Cupom atualizado!' });
      }
      setEditando(null);
      qc.invalidateQueries({ queryKey: ['lojista-cupons'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    } finally {
      setEnviando(false);
    }
  }

  async function alternarAtivo(c: Cupom) {
    try {
      await api('PUT', `/api/lojista/cupons/${c.id}`, { ativo: !c.ativo });
      qc.invalidateQueries({ queryKey: ['lojista-cupons'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  async function excluir(c: Cupom) {
    if (!(await confirmar({ titulo: `Remover o cupom ${c.codigo}?`, confirmar: 'Remover', destrutivo: true }))) return;
    try {
      await api('DELETE', `/api/lojista/cupons/${c.id}`);
      mostrar({ tipo: 'sucesso', titulo: 'Cupom removido.' });
      qc.invalidateQueries({ queryKey: ['lojista-cupons'] });
    } catch (err) {
      if (err instanceof ApiError) mostrar({ tipo: 'erro', titulo: err.message });
    }
  }

  function set<K extends keyof FormCupom>(k: K, v: FormCupom[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Ticket className="size-5 text-primary" /> Cupons ({cupons.length})
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Descontos que o cliente aplica no carrinho.</p>
        </div>
        <Button size="sm" onClick={abrirNovo} disabled={editando !== null}>
          <Plus className="size-4" /> Novo cupom
        </Button>
      </div>

      {/* Formulário */}
      {editando !== null && (
        <Card className="border-primary/40">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">{editando === 'novo' ? '🎟️ Novo cupom' : '✏️ Editar cupom'}</h3>
              <button type="button" onClick={() => setEditando(null)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={salvar} className="space-y-4">
              <div>
                <Label>Código *</Label>
                <Input
                  required
                  value={form.codigo}
                  onChange={e => set('codigo', e.target.value.toUpperCase().replace(/\s/g, ''))}
                  placeholder="Ex.: BEMVINDO10"
                  className="font-mono uppercase tracking-wider"
                  maxLength={20}
                />
                <p className="text-xs text-muted-foreground mt-1">3 a 20 letras/números, sem espaços.</p>
              </div>

              {/* Tipo */}
              <div>
                <Label>Tipo de desconto *</Label>
                <div className="flex gap-2 mt-1.5">
                  <button type="button" onClick={() => set('tipo', 'percentual')}
                    className={cn('flex-1 flex items-center justify-center gap-1.5 rounded-xl border-2 py-2.5 text-sm font-semibold transition-colors',
                      form.tipo === 'percentual' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40')}>
                    <Percent className="size-4" /> Percentual
                  </button>
                  <button type="button" onClick={() => set('tipo', 'fixo')}
                    className={cn('flex-1 flex items-center justify-center gap-1.5 rounded-xl border-2 py-2.5 text-sm font-semibold transition-colors',
                      form.tipo === 'fixo' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40')}>
                    <BadgeDollarSign className="size-4" /> Valor fixo
                  </button>
                </div>
              </div>

              {/* Valor + mínimo */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{form.tipo === 'percentual' ? 'Desconto (%) *' : 'Desconto (R$) *'}</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      {form.tipo === 'percentual' ? '%' : 'R$'}
                    </span>
                    <Input required type="number" min={form.tipo === 'percentual' ? 1 : 0.01}
                      max={form.tipo === 'percentual' ? 90 : undefined}
                      step={form.tipo === 'percentual' ? 1 : 0.01}
                      value={form.valor} onChange={e => set('valor', e.target.value)}
                      placeholder={form.tipo === 'percentual' ? '10' : '5,00'} className="pl-9" />
                  </div>
                </div>
                <div>
                  <Label>Pedido mínimo</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">R$</span>
                    <Input type="number" min={0} step={0.01} value={form.minimo}
                      onChange={e => set('minimo', e.target.value)} placeholder="0,00" className="pl-9" />
                  </div>
                </div>
              </div>

              {/* Limite de usos + validade */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Limite de usos</Label>
                  <Input type="number" min={0} value={form.usos_max}
                    onChange={e => set('usos_max', e.target.value)} placeholder="0 = ilimitado" />
                </div>
                <div>
                  <Label>Validade</Label>
                  <Input type="date" value={form.validade} onChange={e => set('validade', e.target.value)} />
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <Button type="submit" size="lg" className="flex-1" disabled={enviando}>
                  {enviando ? 'Salvando…' : editando === 'novo' ? 'Criar cupom' : 'Salvar'}
                </Button>
                <Button type="button" size="lg" variant="outline" onClick={() => setEditando(null)} disabled={enviando}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Loading / vazio */}
      {consulta.isLoading && <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>}
      {!consulta.isLoading && cupons.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center space-y-2">
            <div className="text-4xl">🎟️</div>
            <p className="font-semibold text-muted-foreground">Nenhum cupom ainda</p>
            <p className="text-sm text-muted-foreground">Crie cupons para atrair e fidelizar clientes.</p>
          </CardContent>
        </Card>
      )}

      {/* Lista */}
      <div className="space-y-2">
        {cupons.map(c => {
          const expirado = c.validade && c.validade < new Date().toISOString().slice(0, 10);
          const esgotado = c.usos_max > 0 && c.usos_count >= c.usos_max;
          return (
            <Card key={c.id} className={!c.ativo || expirado || esgotado ? 'opacity-60' : ''}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                  {c.tipo === 'percentual' ? <Percent className="size-5" /> : <BadgeDollarSign className="size-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold tracking-wider">{c.codigo}</span>
                    <Badge variant="success" className="text-[10px] px-1.5">
                      {c.tipo === 'percentual' ? `${c.valor}% OFF` : `${brl(c.valor)} OFF`}
                    </Badge>
                    {!c.ativo && <Badge variant="secondary" className="text-[10px] px-1.5">Inativo</Badge>}
                    {expirado && <Badge variant="danger" className="text-[10px] px-1.5">Expirado</Badge>}
                    {esgotado && <Badge variant="danger" className="text-[10px] px-1.5">Esgotado</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                    {c.minimo_centavos > 0 && <span>mín. {brl(c.minimo_centavos)}</span>}
                    <span>usos: {c.usos_count}{c.usos_max > 0 ? `/${c.usos_max}` : ''}</span>
                    {c.validade && <span>até {c.validade.split('-').reverse().join('/')}</span>}
                  </div>
                </div>
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <button onClick={() => alternarAtivo(c)} title={c.ativo ? 'Desativar' : 'Ativar'}>
                    {c.ativo ? <ToggleRight className="size-6 text-primary" /> : <ToggleLeft className="size-6 text-muted-foreground" />}
                  </button>
                  <div className="flex gap-0.5">
                    <button onClick={() => abrirEdicao(c)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground" title="Editar">
                      <Pencil className="size-3.5" />
                    </button>
                    <button onClick={() => excluir(c)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-destructive" title="Excluir">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
