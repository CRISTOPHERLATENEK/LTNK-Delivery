import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-3 py-1 text-xs font-bold transition-colors whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        outline: 'border border-border text-foreground',
        success: 'bg-success/15 text-success border border-success/30',
        warning: 'bg-amber-500/15 text-amber-700 border border-amber-500/30 dark:text-amber-400',
        info: 'bg-blue-500/15 text-blue-700 border border-blue-500/30 dark:text-blue-400',
        danger: 'bg-destructive/15 text-destructive border border-destructive/30',
        promo: 'bg-gradient-to-r from-primary to-rose-500 text-white shadow-sm',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
