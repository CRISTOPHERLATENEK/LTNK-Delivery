/**
 * MODAL CENTRADO, sobre o Radix Dialog.
 *
 * POR QUE UM COMPONENTE NOVO: o projeto já tinha `Sheet`, mas Sheet desliza de uma
 * BORDA (`inset-y-0 right-0`) — não existe variante centrada, e forçar uma dentro dele
 * misturaria duas coisas com nomes trocados. Formulário largo em duas colunas quer o
 * centro da tela: nas bordas, uma das colunas fica na periferia da visão.
 *
 * O Radix resolve de graça o que costuma quebrar quando se faz modal à mão: foco preso
 * dentro do conteúdo, Esc, clique no overlay, `aria-modal`, e devolver o foco ao
 * elemento que abriu quando fecha.
 */
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';

const Modal = DialogPrimitive.Root;
const ModalClose = DialogPrimitive.Close;

const ModalConteudo = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      className="fixed inset-0 z-[100] bg-zinc-900/50 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
    />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-[101] flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
        'rounded-[18px] border border-border bg-card shadow-2xl',
        'data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        // Teto de largura e de altura: o corpo rola por dentro, a janela não cresce
        // além da tela. No celular ocupa tudo — em telefone, modal com margem sobrando
        // desperdiça a única dimensão que falta.
        'max-h-dvh w-full max-w-full sm:max-h-[calc(100dvh-56px)] sm:w-[min(1040px,calc(100vw-56px))]',
        'max-sm:inset-0 max-sm:left-0 max-sm:top-0 max-sm:h-dvh max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none',
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
ModalConteudo.displayName = 'ModalConteudo';

/** Título e descrição são obrigatórios pro Radix anunciar o diálogo corretamente. */
const ModalTitulo = DialogPrimitive.Title;
const ModalDescricao = DialogPrimitive.Description;

export { Modal, ModalClose, ModalConteudo, ModalTitulo, ModalDescricao };
