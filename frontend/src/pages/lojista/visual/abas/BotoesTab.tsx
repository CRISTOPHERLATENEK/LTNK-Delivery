import { RotateCcw, ToggleLeft, ToggleRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { estiloBotao, classNameBotao } from '@/lib/visual';
import { foregroundContraste } from '@/lib/tema';
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

const TAMANHOS: Array<{ id: EstadoVisual['botoes']['tamanho']; label: string }> = [
  { id: 'sm', label: 'Pequeno' }, { id: 'md', label: 'Médio' }, { id: 'lg', label: 'Grande' },
];
const ANIMACOES: Array<{ id: EstadoVisual['botoes']['animacao']; label: string }> = [
  { id: 'nenhuma', label: 'Nenhuma' }, { id: 'scale', label: 'Scale' }, { id: 'ripple', label: 'Ripple' },
  { id: 'glow', label: 'Glow' }, { id: 'fade', label: 'Fade' },
];

export function BotoesTab({ estado, atualizar, restaurarPadrao }: Props) {
  const cor = estado.cor_marca || '#dc2640';
  const fg = foregroundContraste(cor) === '0 0% 100%' ? '#fff' : '#111';

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Botões</p>
          <Button type="button" size="sm" variant="outline" onClick={restaurarPadrao}>
            <RotateCcw className="size-3.5" /> Restaurar padrão
          </Button>
        </div>

        <div className="flex items-center justify-center rounded-xl border border-dashed border-border p-6">
          <button type="button" className={classNameBotao(estado)} style={{ ...estiloBotao(estado, cor), color: fg, fontWeight: 700 }}>
            Adicionar ao carrinho
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Toggle label="Hover" ativo={estado.botoes.hover} onClick={() => atualizar('botoes.hover', !estado.botoes.hover)} />
          <Toggle label="Sombra" ativo={estado.botoes.sombra} onClick={() => atualizar('botoes.sombra', !estado.botoes.sombra)} />
          <Toggle label="Gradiente" ativo={estado.botoes.gradiente} onClick={() => atualizar('botoes.gradiente', !estado.botoes.gradiente)} />
          <Toggle label="Ícone" ativo={estado.botoes.icone} onClick={() => atualizar('botoes.icone', !estado.botoes.icone)} />
          <Toggle label="Borda" ativo={estado.botoes.borda} onClick={() => atualizar('botoes.borda', !estado.botoes.borda)} />
        </div>

        <div>
          <Label>Raio ({estado.botoes.raio}px)</Label>
          <input type="range" min={0} max={32} value={estado.botoes.raio}
            onChange={e => atualizar('botoes.raio', Number(e.target.value))} className="mt-2 w-full" />
        </div>

        <div>
          <Label className="mb-2 block">Tamanho</Label>
          <div className="flex gap-2">
            {TAMANHOS.map(t => (
              <button key={t.id} type="button" onClick={() => atualizar('botoes.tamanho', t.id)}
                className={cn('flex-1 rounded-lg border-2 py-2 text-xs font-semibold transition-colors',
                  estado.botoes.tamanho === t.id ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Animação</Label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {ANIMACOES.map(a => (
              <button key={a.id} type="button" onClick={() => atualizar('botoes.animacao', a.id)}
                className={cn('rounded-lg border-2 py-2 text-[11px] font-semibold transition-colors',
                  estado.botoes.animacao === a.id ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
