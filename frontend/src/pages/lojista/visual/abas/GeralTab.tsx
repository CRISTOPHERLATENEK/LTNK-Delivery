import { useEffect, useState } from 'react';
import { Power, ToggleLeft, ToggleRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { EstadoVisual } from '../types';

interface Props {
  estado: EstadoVisual;
  atualizar: (caminho: string, valor: any) => void;
}

const TOGGLES: Array<{ campo: keyof EstadoVisual['geral']; label: string; desc: string }> = [
  { campo: 'mostrar_avaliacao', label: 'Mostrar avaliação', desc: 'Nota média (★) no cabeçalho da loja.' },
  { campo: 'mostrar_tempo_medio', label: 'Mostrar tempo médio', desc: 'Tempo estimado de entrega.' },
  { campo: 'mostrar_taxa_entrega', label: 'Mostrar taxa de entrega', desc: 'Valor do frete ou "Grátis".' },
  { campo: 'mostrar_pedido_minimo', label: 'Mostrar pedido mínimo', desc: 'Valor mínimo pra fechar o pedido.' },
  { campo: 'mostrar_distancia', label: 'Mostrar distância', desc: 'Distância até o cliente (se disponível).' },
];

function ToggleLinha({ label, desc, ativo, onClick }: { label: string; desc: string; ativo: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:border-primary/40">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-[11px] text-muted-foreground">{desc}</p>
      </div>
      {ativo
        ? <ToggleRight className="size-6 text-primary shrink-0" />
        : <ToggleLeft className="size-6 text-muted-foreground shrink-0" />}
    </button>
  );
}

export function GeralTab({ estado, atualizar }: Props) {
  const [aberta, setAberta] = useState<0 | 1 | null>(null);
  const [alternando, setAlternando] = useState(false);

  useEffect(() => {
    api<{ loja: { aberta: 0 | 1 } }>('GET', '/api/lojista/loja').then(r => setAberta(r.loja.aberta)).catch(() => {});
  }, []);

  async function alternarAberta() {
    setAlternando(true);
    try {
      const r = await api<{ aberta: boolean }>('POST', '/api/lojista/loja/abrir-fechar');
      setAberta(r.aberta ? 1 : 0);
    } finally {
      setAlternando(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 space-y-4">
          <div>
            <Label>Nome da loja</Label>
            <Input value={estado.nome} onChange={e => atualizar('nome', e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label>Slogan</Label>
            <Input value={estado.geral.slogan} onChange={e => atualizar('geral.slogan', e.target.value)}
              placeholder="Ex.: O melhor sabor da cidade" maxLength={140} className="mt-1.5" />
          </div>

          <button type="button" onClick={alternarAberta} disabled={alternando || aberta === null}
            className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:border-primary/40 disabled:opacity-60">
            <div className={cn('flex size-9 items-center justify-center rounded-full shrink-0',
              aberta ? 'bg-green-500/15 text-green-600' : 'bg-muted text-muted-foreground')}>
              <Power className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{aberta ? 'Loja aberta' : 'Loja fechada'}</p>
              <p className="text-[11px] text-muted-foreground">Clique pra {aberta ? 'fechar' : 'abrir'} agora — alterado na hora, não precisa Salvar.</p>
            </div>
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-2">
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">O que aparece no cabeçalho</p>
          {TOGGLES.map(t => (
            <ToggleLinha key={t.campo} label={t.label} desc={t.desc}
              ativo={!!estado.geral[t.campo]}
              onClick={() => atualizar(`geral.${t.campo}`, !estado.geral[t.campo])} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
