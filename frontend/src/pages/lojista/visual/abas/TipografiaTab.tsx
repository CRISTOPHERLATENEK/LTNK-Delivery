import { useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { FONTES_VISUAL } from '@/lib/visual';
import { injetarFonteLink } from '@/lib/tema';
import type { EstadoVisual } from '../types';

interface Props {
  estado: EstadoVisual;
  atualizar: (caminho: string, valor: any) => void;
  restaurarPadrao: () => void;
}

const PESOS = [400, 500, 600, 700, 800] as const;

export function TipografiaTab({ estado, atualizar, restaurarPadrao }: Props) {
  const fonteAtual = FONTES_VISUAL[estado.tipografia.fonte];

  useEffect(() => {
    injetarFonteLink(fonteAtual, 'fonte-preview-visual');
  }, [fonteAtual]);

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tipografia</p>
          <Button type="button" size="sm" variant="outline" onClick={restaurarPadrao}>
            <RotateCcw className="size-3.5" /> Restaurar padrão
          </Button>
        </div>

        <div
          className="rounded-xl border border-dashed border-border p-4 text-center"
          style={{
            fontFamily: fonteAtual.stack, fontWeight: estado.tipografia.peso,
            letterSpacing: `${estado.tipografia.espacamento / 100}px`,
            fontSize: estado.tipografia.tamanho_base, lineHeight: estado.tipografia.altura_linha,
          }}
        >
          Pizza Margherita — R$ 39,90
        </div>

        <div>
          <Label className="mb-2 block">Fonte</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(Object.keys(FONTES_VISUAL) as Array<keyof typeof FONTES_VISUAL>).map(f => (
              <button key={f} type="button" onClick={() => atualizar('tipografia.fonte', f)}
                style={{ fontFamily: FONTES_VISUAL[f].stack }}
                className={cn('rounded-xl border-2 px-3 py-2.5 text-left transition-colors',
                  estado.tipografia.fonte === f ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40')}>
                <div className="text-base font-bold leading-none">Aa</div>
                <div className="mt-1 text-xs text-muted-foreground">{FONTES_VISUAL[f].label}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Peso</Label>
          <div className="flex gap-2">
            {PESOS.map(p => (
              <button key={p} type="button" onClick={() => atualizar('tipografia.peso', p)}
                className={cn('flex-1 rounded-lg border-2 py-2 text-xs font-semibold transition-colors',
                  estado.tipografia.peso === p ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}
                style={{ fontWeight: p }}>
                {p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label>Espaçamento entre letras ({estado.tipografia.espacamento}px/100)</Label>
          <input type="range" min={-2} max={4} step={0.1} value={estado.tipografia.espacamento}
            onChange={e => atualizar('tipografia.espacamento', Number(e.target.value))} className="mt-2 w-full" />
        </div>
        <div>
          <Label>Tamanho da fonte ({estado.tipografia.tamanho_base}px)</Label>
          <input type="range" min={14} max={18} value={estado.tipografia.tamanho_base}
            onChange={e => atualizar('tipografia.tamanho_base', Number(e.target.value))} className="mt-2 w-full" />
        </div>
        <div>
          <Label>Altura da linha ({estado.tipografia.altura_linha.toFixed(1)})</Label>
          <input type="range" min={1.2} max={1.8} step={0.1} value={estado.tipografia.altura_linha}
            onChange={e => atualizar('tipografia.altura_linha', Number(e.target.value))} className="mt-2 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}
