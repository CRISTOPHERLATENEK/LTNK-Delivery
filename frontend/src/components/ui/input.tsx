import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Campo de texto.
 *
 * DUAS COISAS ACONTECEM AQUI SÓ PARA `type="number"`, e as duas resolvem
 * problema real de campo de dinheiro — são 22 desses no painel (preço, taxa de
 * entrega, valor de cupom, número da NFC-e...), então corrigir no componente
 * corrige todos de uma vez:
 *
 * 1. A RODA DO MOUSE. Um `input type=number` focado responde ao scroll: quem
 *    rolava a página com o cursor parado sobre o preço mudava o preço sem ver.
 *    Num campo de "39,90" isso vira "40,90" publicado no menu. O `onWheel`
 *    tira o foco em vez de bloquear o evento, senão a página também para de
 *    rolar — o problema era o campo capturar o scroll, não o scroll existir.
 *
 * 2. O TECLADO DO CELULAR. `type=number` sozinho abre teclado numérico, mas em
 *    parte dos Android sem a vírgula. `inputMode` é deduzido do `step`:
 *    step decimal (ou ausente) pede vírgula, `step="1"` não. Quem passar
 *    `inputMode` explícito continua manda.
 */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, inputMode, onWheel, step, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      step={step}
      inputMode={inputMode ?? (type === 'number' ? (step === undefined || String(step) === '1' ? 'numeric' : 'decimal') : undefined)}
      onWheel={type === 'number'
        ? e => { (e.currentTarget as HTMLInputElement).blur(); onWheel?.(e); }
        : onWheel}
      className={cn(
        'flex h-12 w-full rounded-xl border border-input bg-background px-4 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-xl border border-input bg-background px-4 py-3 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Input, Textarea };
