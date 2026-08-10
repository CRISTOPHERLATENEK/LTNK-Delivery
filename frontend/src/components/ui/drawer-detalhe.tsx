/**
 * Drawer de detalhe — o painel lateral usado por Lojas, Lojistas e Pedidos.
 *
 * Antes o detalhe abria INLINE, empurrando a lista pra baixo: quem clicava no
 * quinto pedido perdia de vista os quatro de cima, e fechar exigia rolar de
 * volta pra achar a linha. Num painel de operação, comparar dois registros é
 * rotina — o drawer deixa a lista parada atrás e sai com ESC.
 *
 * Sobre o Sheet do design system, que já resolve overlay, foco e ESC. O que
 * muda aqui é a largura (o `side="right"` padrão tem 384px, apertado pra
 * itens + timeline) e a estrutura fixa header/corpo/rodapé.
 */
import * as React from 'react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface DrawerDetalheProps {
  aberto: boolean;
  aoFechar: () => void;
  titulo: React.ReactNode;
  /** Linha de apoio sob o título (status, id, data). */
  subtitulo?: React.ReactNode;
  /** Ações fixas no rodapé. Sem elas o rodapé não é renderizado. */
  rodape?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function DrawerDetalhe({
  aberto, aoFechar, titulo, subtitulo, rodape, children, className,
}: DrawerDetalheProps) {
  return (
    <Sheet open={aberto} onOpenChange={a => { if (!a) aoFechar(); }}>
      <SheetContent
        side="right"
        // No celular ocupa a tela inteira: 640px num aparelho de 390px viraria
        // uma lista espremida com scroll horizontal.
        className={cn('flex w-full flex-col gap-0 p-0 sm:max-w-[min(640px,100vw)]', className)}
      >
        <div className="shrink-0 border-b border-border px-5 py-4 pr-14">
          <SheetTitle className="text-lg">{titulo}</SheetTitle>
          {subtitulo
            ? <SheetDescription className="mt-1 flex flex-wrap items-center gap-2">{subtitulo}</SheetDescription>
            /* O Radix exige uma Description acessível mesmo quando não há texto
               visível — sem isso ele reclama no console em dev. */
            : <SheetDescription className="sr-only">Detalhes do registro selecionado.</SheetDescription>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>

        {rodape && (
          <div className="shrink-0 border-t border-border bg-card p-4">{rodape}</div>
        )}
      </SheetContent>
    </Sheet>
  );
}
