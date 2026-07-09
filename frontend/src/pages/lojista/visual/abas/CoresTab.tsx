import { RotateCcw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ColorField } from '../ColorField';
import type { EstadoVisual } from '../types';

interface Props {
  estado: EstadoVisual;
  atualizar: (caminho: string, valor: any) => void;
  restaurarPadrao: () => void;
}

export function CoresTab({ estado, atualizar, restaurarPadrao }: Props) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cores da marca</p>
          </div>
          <ColorField label="Cor principal" value={estado.cor_marca} onChange={v => atualizar('cor_marca', v || '#dc2640')} />
          <ColorField label="Cor secundária" value={estado.cor_secundaria} fallback={estado.cor_marca}
            onChange={v => atualizar('cor_secundaria', v)} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cores específicas</p>
            <Button type="button" size="sm" variant="outline" onClick={restaurarPadrao}>
              <RotateCcw className="size-3.5" /> Restaurar padrão
            </Button>
          </div>
          <ColorField label="Cor dos botões" value={estado.cores.cor_botoes} fallback={estado.cor_marca}
            onChange={v => atualizar('cores.cor_botoes', v)} />
          <ColorField label="Cor dos cards" value={estado.cores.cor_cards} fallback="#ffffff"
            onChange={v => atualizar('cores.cor_cards', v)} />
          <ColorField label="Cor do fundo" value={estado.cores.cor_fundo} fallback="#f7f7f5"
            onChange={v => atualizar('cores.cor_fundo', v)} />
          <ColorField label="Cor do cabeçalho" value={estado.cores.cor_cabecalho} fallback={estado.cor_marca}
            onChange={v => atualizar('cores.cor_cabecalho', v)} />
          <ColorField label="Cor do rodapé" value={estado.cores.cor_rodape} fallback="#1a1a1a"
            onChange={v => atualizar('cores.cor_rodape', v)} />
          <ColorField label="Cor do texto" value={estado.cores.cor_texto} fallback="#1f1f1f"
            onChange={v => atualizar('cores.cor_texto', v)} />
          <ColorField label="Cor dos badges" value={estado.cores.cor_badges} fallback="#16a34a"
            onChange={v => atualizar('cores.cor_badges', v)} />
        </CardContent>
      </Card>
    </div>
  );
}
