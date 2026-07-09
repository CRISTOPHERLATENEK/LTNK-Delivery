import { ToggleLeft, ToggleRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { BannersLoja } from '../../banners';
import type { EstadoVisual } from '../types';

interface Props {
  estado: EstadoVisual;
  atualizar: (caminho: string, valor: any) => void;
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

export function BannersTab({ estado, atualizar }: Props) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 space-y-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Rotação do carrossel (vale pra todos os banners)
          </p>
          <div>
            <Label>Tempo de rotação ({(estado.banners.tempo_rotacao_ms / 1000).toFixed(1)}s)</Label>
            <input type="range" min={2000} max={10000} step={500} value={estado.banners.tempo_rotacao_ms}
              onChange={e => atualizar('banners.tempo_rotacao_ms', Number(e.target.value))} className="mt-2 w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Toggle label="Loop" ativo={estado.banners.loop} onClick={() => atualizar('banners.loop', !estado.banners.loop)} />
            <Toggle label="Mostrar indicadores" ativo={estado.banners.mostrar_indicadores}
              onClick={() => atualizar('banners.mostrar_indicadores', !estado.banners.mostrar_indicadores)} />
            <Toggle label="Mostrar setas" ativo={estado.banners.mostrar_setas}
              onClick={() => atualizar('banners.mostrar_setas', !estado.banners.mostrar_setas)} />
          </div>
        </CardContent>
      </Card>

      {/* CRUD de banners — já salva na hora (não faz parte do fluxo Salvar/dirty deste form). */}
      <BannersLoja />
    </div>
  );
}
