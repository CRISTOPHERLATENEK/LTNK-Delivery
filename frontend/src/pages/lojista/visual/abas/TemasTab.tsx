import { Card, CardContent } from '@/components/ui/card';
import { PRESETS_TEMA } from '../presets';
import type { EstadoVisual } from '../types';

interface Props {
  estado: EstadoVisual;
  aplicarParcial: (parcial: Partial<EstadoVisual>) => void;
}

export function TemasTab({ estado, aplicarParcial }: Props) {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Temas prontos</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Escolher um tema preenche cores, botões e tipografia como ponto de partida — você ainda
            precisa clicar em <strong>Salvar</strong> pra aplicar de verdade.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Object.entries(PRESETS_TEMA).map(([id, { label, preset }]) => {
            const ativo = estado.cor_marca === preset.cor_marca;
            return (
              <button key={id} type="button" onClick={() => aplicarParcial(preset as any)}
                className={`rounded-xl border-2 p-3 text-left transition-colors ${ativo ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}>
                <div className="flex gap-1">
                  <span className="size-5 rounded-full border border-black/10" style={{ backgroundColor: preset.cor_marca }} />
                  <span className="size-5 rounded-full border border-black/10" style={{ backgroundColor: preset.cor_secundaria }} />
                </div>
                <p className="mt-2 text-xs font-bold">{label}</p>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
