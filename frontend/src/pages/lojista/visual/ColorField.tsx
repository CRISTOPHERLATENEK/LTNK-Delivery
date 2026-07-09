import { RotateCcw } from 'lucide-react';
import { hexParaRgb, foregroundContraste } from '@/lib/tema';
import { Tooltip } from '@/components/ui/tooltip';

interface Props {
  label: string;
  value: string;
  /** Cor usada quando value === '' (herança) — só pra exibir o swatch/placeholder. */
  fallback?: string;
  onChange: (hex: string) => void;
  tooltip?: string;
}

/** Picker nativo + hex + rgb + swatch com contraste + reset, tudo num campo. */
export function ColorField({ label, value, fallback, onChange }: Props) {
  const cor = value || fallback || '#dc2640';
  const rgb = hexParaRgb(cor);
  const fg = foregroundContraste(cor) === '0 0% 100%' ? '#fff' : '#111';

  function onHex(v: string) {
    const s = v.trim();
    if (s === '' || /^#[0-9a-fA-F]{0,6}$/.test(s)) onChange(s);
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border p-3">
      <div className="relative shrink-0">
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(cor) ? cor : '#dc2640'}
          onChange={e => onChange(e.target.value)}
          className="size-11 cursor-pointer rounded-lg border border-input" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">{label}</p>
        <div className="mt-1 flex items-center gap-2">
          <input value={value} onChange={e => onHex(e.target.value)}
            placeholder={fallback ? `${fallback} (padrão)` : '#RRGGBB'}
            className="h-7 w-24 rounded-md border border-input bg-background px-2 text-xs font-mono" />
          {rgb && <span className="text-[10px] text-muted-foreground">rgb({rgb.r}, {rgb.g}, {rgb.b})</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="flex size-7 items-center justify-center rounded-full text-[10px] font-bold"
          style={{ backgroundColor: cor, color: fg }} title="Contraste automático do texto">Aa</div>
        {value && (
          <Tooltip texto="Restaurar padrão">
            <button type="button" onClick={() => onChange('')}
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
              <RotateCcw className="size-3.5" />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
