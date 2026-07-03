import { cn } from '@/lib/utils';

/** Bloco placeholder com shimmer (estado de carregamento). */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl bg-muted shimmer', className)} {...props} />;
}
