import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Combina classes Tailwind com merge inteligente (dedup do mesmo "namespace"). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
