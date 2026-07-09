import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  texto: string;
  children: ReactNode;
  className?: string;
}

/**
 * Tooltip mínimo em CSS puro (hover) — sem lib nova. Envolve o filho num
 * `span.group relative` e mostra uma bolha ao passar o mouse.
 */
export function Tooltip({ texto, children, className }: Props) {
  return (
    <span className={cn('group relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap
          rounded-lg bg-foreground px-2 py-1 text-[11px] font-medium text-background opacity-0
          shadow-lg transition-opacity duration-150 group-hover:opacity-100"
      >
        {texto}
      </span>
    </span>
  );
}
