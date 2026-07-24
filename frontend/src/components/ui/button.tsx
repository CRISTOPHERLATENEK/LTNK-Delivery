import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Botão polivalente — varia por intenção (default, secondary, ghost…) e tamanho.
 *
 * Micro-interações padrão (todas via CSS, sem JS): o ícone à direita (ex.
 * ArrowRight num CTA) desliza no hover; active reforça o toque (scale +
 * brightness). O "sweep" de preenchimento (::before crescendo da esquerda)
 * só existe em outline/ghost — ali faz sentido (transparente → preenchido).
 * Nos botões de cor sólida (default/destructive/success) ele NÃO é usado:
 * competia com a troca de opacidade do hover ao mesmo tempo, misturando duas
 * animações de cor e ficando poluído — nesses o hover é só escurecer +
 * levantar sombra, mais limpo.
 */
const buttonVariants = cva(
  cn(
    'relative isolate inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-xl text-sm font-semibold',
    'transition-all disabled:pointer-events-none disabled:opacity-50',
    'active:scale-[0.98] active:brightness-95',
    '[&_svg]:size-4 [&_svg]:shrink-0',
    '[&_svg:last-child]:transition-transform [&_svg:last-child]:duration-300 hover:[&_svg:last-child]:translate-x-0.5',
  ),
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 hover:shadow-lg hover:shadow-destructive/25',
        outline: cn(
          'border border-input bg-background transition-colors duration-300 hover:text-accent-foreground hover:shadow-sm',
          'before:absolute before:inset-0 before:origin-left before:scale-x-0 before:bg-accent before:transition-transform before:duration-300 before:content-[""] hover:before:scale-x-100',
        ),
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: cn(
          'transition-colors duration-300 hover:text-accent-foreground',
          'before:absolute before:inset-0 before:origin-left before:scale-x-0 before:bg-accent before:transition-transform before:duration-300 before:content-[""] hover:before:scale-x-100',
        ),
        link: 'text-primary underline-offset-4 hover:underline',
        success: 'bg-success text-success-foreground shadow-sm hover:bg-success/90 hover:shadow-lg hover:shadow-success/25',
      },
      size: {
        default: 'h-11 px-5 py-2',
        sm: 'h-9 px-4 text-xs',
        lg: 'h-12 rounded-2xl px-7 text-base',
        xl: 'h-14 rounded-2xl px-8 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Estado de carregamento: substitui o conteúdo por um spinner + texto, e desabilita o clique. */
  loading?: boolean;
  /** Texto mostrado ao lado do spinner quando `loading` está ativo (ex. "Salvando…"). */
  loadingText?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, loadingText, disabled, children, ...props }, ref) => {
    // asChild (Slot) precisa de UM filho real (ex. <Link>) pra herdar as props —
    // não dá pra envolver em <span> aqui, senão o Slot mescla no span em vez do
    // link de verdade e a navegação quebra. loading/spinner só existem no modo
    // <button> normal (não faz sentido num link).
    if (asChild) {
      return (
        <Slot ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <span className="relative z-10 inline-flex items-center gap-2">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            {loadingText ?? children}
          </span>
        ) : (
          <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
        )}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
