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

const FORMATOS: Array<{ id: EstadoVisual['logo']['formato']; label: string; raio: string }> = [
  { id: 'quadrado', label: 'Quadrado', raio: '10%' },
  { id: 'arredondado', label: 'Arredondado', raio: '28%' },
  { id: 'circular', label: 'Circular', raio: '50%' },
];

export function LogoTab({ estado, atualizar, restaurarPadrao }: Props) {
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Logo</p>
          <Button type="button" size="sm" variant="outline" onClick={restaurarPadrao}>
            <RotateCcw className="size-3.5" /> Restaurar padrão
          </Button>
        </div>

        <ImageUpload value={estado.logo_url} onChange={url => atualizar('logo_url', url)} aspectRatio="square" />

        <div>
          <Label>Tamanho ({estado.logo.tamanho}px)</Label>
          <input type="range" min={40} max={120} value={estado.logo.tamanho}
            onChange={e => atualizar('logo.tamanho', Number(e.target.value))}
            className="mt-2 w-full" />
        </div>

        <div>
          <Label className="mb-2 block">Formato</Label>
          <div className="grid grid-cols-3 gap-2">
            {FORMATOS.map(f => (
              <button key={f.id} type="button" onClick={() => atualizar('logo.formato', f.id)}
                className={cn('flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 transition-colors',
                  estado.logo.formato === f.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40')}>
                <div className="size-8 bg-muted-foreground/30" style={{ borderRadius: f.raio }} />
                <span className="text-[11px] font-semibold">{f.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Opções</Label>
          <div className="flex flex-wrap gap-2">
            <Toggle label="Sombra" ativo={estado.logo.sombra} onClick={() => atualizar('logo.sombra', !estado.logo.sombra)} />
            <Toggle label="Borda" ativo={estado.logo.borda} onClick={() => atualizar('logo.borda', !estado.logo.borda)} />
            <Toggle label="Borda branca" ativo={estado.logo.borda_branca} onClick={() => atualizar('logo.borda_branca', !estado.logo.borda_branca)} />
            <Toggle label="Padding" ativo={estado.logo.padding} onClick={() => atualizar('logo.padding', !estado.logo.padding)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
