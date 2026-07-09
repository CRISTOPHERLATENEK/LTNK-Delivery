import { RotateCcw, ToggleLeft, ToggleRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';
import { cn } from '@/lib/utils';
import type { EstadoVisual } from '../types';

interface Props {
  estado: EstadoVisual;
  atualizar: (caminho: string, valor: any) => void;
  restaurarPadrao: () => void;
}

function Toggle({ label, ativo, onClick }: { label: string; ativo: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition-colors hover:border-primary/40">
      {ativo ? <ToggleRight className="size-4 text-primary" /> : <ToggleLeft className="size-4 text-muted-foreground" />}
      {label}
    </button>
  );
}

function Escolha<T extends string>({ opcoes, valor, onEscolher }: { opcoes: Array<{ id: T; label: string }>; valor: T; onEscolher: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {opcoes.map(o => (
        <button key={o.id} type="button" onClick={() => onEscolher(o.id)}
          className={cn('rounded-lg border-2 px-3 py-1.5 text-xs font-semibold transition-colors',
            valor === o.id ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CapaTab({ estado, atualizar, restaurarPadrao }: Props) {
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Capa</p>
          <Button type="button" size="sm" variant="outline" onClick={restaurarPadrao}>
            <RotateCcw className="size-3.5" /> Restaurar padrão
          </Button>
        </div>

        <ImageUpload value={estado.capa_url} onChange={url => atualizar('capa_url', url)} aspectRatio="wide" />

        <div className="flex flex-wrap gap-2">
          <Toggle label="Overlay escuro" ativo={estado.capa.overlay} onClick={() => atualizar('capa.overlay', !estado.capa.overlay)} />
          <Toggle label="Gradiente" ativo={estado.capa.gradiente} onClick={() => atualizar('capa.gradiente', !estado.capa.gradiente)} />
        </div>

        <div>
          <Label>Blur ({estado.capa.blur}px)</Label>
          <input type="range" min={0} max={20} value={estado.capa.blur}
            onChange={e => atualizar('capa.blur', Number(e.target.value))} className="mt-2 w-full" />
        </div>
        <div>
          <Label>Escurecimento ({estado.capa.escurecimento}%)</Label>
          <input type="range" min={0} max={100} value={estado.capa.escurecimento}
            onChange={e => atualizar('capa.escurecimento', Number(e.target.value))} className="mt-2 w-full" />
        </div>
        <div>
          <Label>Opacidade ({estado.capa.opacidade}%)</Label>
          <input type="range" min={0} max={100} value={estado.capa.opacidade}
            onChange={e => atualizar('capa.opacidade', Number(e.target.value))} className="mt-2 w-full" />
        </div>

        <div>
          <Label className="mb-2 block">Posição</Label>
          <Escolha opcoes={[{ id: 'topo', label: 'Topo' }, { id: 'centro', label: 'Centro' }, { id: 'base', label: 'Base' }] as const}
            valor={estado.capa.posicao} onEscolher={v => atualizar('capa.posicao', v)} />
        </div>
        <div>
          <Label className="mb-2 block">Ajuste</Label>
          <Escolha opcoes={[{ id: 'cover', label: 'Cover' }, { id: 'contain', label: 'Contain' }, { id: 'repeat', label: 'Repetir' }] as const}
            valor={estado.capa.ajuste} onEscolher={v => atualizar('capa.ajuste', v)} />
        </div>
      </CardContent>
    </Card>
  );
}
