import { TemaContext, useTemaProvider } from '@/lib/tema';

export function TemaProvider({ children }: { children: React.ReactNode }) {
  const ctx = useTemaProvider();
  return <TemaContext.Provider value={ctx}>{children}</TemaContext.Provider>;
}
