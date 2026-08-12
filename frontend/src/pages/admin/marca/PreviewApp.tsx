/**
 * Preview do app — mock que reflete cor, cantos e fonte em tempo real.
 * Movido do antigo marca.tsx sem alteração.
 */
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FONTES } from '@/lib/tema';
import type { TemaMarca } from '@/types';
/** Mock realista que reflete cor, cantos e fonte em tempo real. */
export function PreviewApp({ form }: { form: TemaMarca }) {
  const fonte = FONTES[form.fonte]?.stack ?? FONTES.inter.stack;
  return (
    <div className="rounded-2xl border-2 border-dashed border-border p-3 bg-muted/30"
      style={{ fontFamily: fonte }}>
      <div className="rounded-xl overflow-hidden border border-border bg-background shadow-sm">
        {/* Header da marca */}
        <div className="flex items-center gap-2.5 p-3 border-b border-border">
          {/* Mesmas classes do cabeçalho real (app-layout): object-contain e
              largura livre, senão a prévia mostraria a logo inteira e a loja
              mostraria ela recortada. */}
          {form.logo_url ? (
            <img src={form.logo_url} alt="" className="h-9 w-auto max-w-[120px] object-contain" />
          ) : (
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-extrabold">
              {(form.nome || 'D').charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            {(form.mostrar_nome !== false || !form.logo_url) && (
              <div className="font-extrabold leading-tight truncate text-sm">{form.nome || 'Nome da marca'}</div>
            )}
            <div className="text-[11px] text-muted-foreground truncate">{form.slogan || 'Seu slogan aqui'}</div>
          </div>
        </div>

        {/* Conteúdo mock */}
        <div className="p-3 space-y-3">
          {/* Card de produto */}
          <div className="flex gap-3 rounded-xl border border-border p-2.5">
            <div className="size-14 rounded-lg bg-accent shrink-0 flex items-center justify-center text-xl">🍔</div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm leading-tight">X-Burguer Especial</div>
              <div className="text-[11px] text-muted-foreground line-clamp-1">Pão, carne, queijo e bacon</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-bold text-sm">R$ 24,90</span>
                <Badge variant="success" className="text-[9px] px-1.5">Promo</Badge>
              </div>
            </div>
          </div>

          {/* Chips */}
          <div className="flex gap-1.5 flex-wrap">
            <span className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground">Selecionado</span>
            <span className="rounded-full bg-accent text-accent-foreground px-2.5 py-1 text-[11px] font-semibold">Lanches</span>
            <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold">Bebidas</span>
          </div>

          {/* Botões */}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1">Adicionar</Button>
            <Button size="sm" variant="outline">Ver mais</Button>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-center text-muted-foreground mt-2">
        É assim que o cliente vê o app.
      </p>
    </div>
  );
}
