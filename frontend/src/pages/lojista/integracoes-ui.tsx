/**
 * AS PEÇAS DA TELA DE INTEGRAÇÕES: card da grade e moldura do modal.
 *
 * Separado da tela para o arquivo principal continuar sendo sobre a LÓGICA de
 * cada integração — ligar, salvar código, importar, sincronizar — e não sobre
 * medidas de borda.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { Modal, ModalConteudo, ModalTitulo, ModalDescricao, ModalClose } from '@/components/ui/modal';
import { cn } from '@/lib/utils';

/**
 * O LOGO DA MARCA VEM DE ARQUIVO, NUNCA DESENHADO À MÃO.
 *
 * Redesenhar o logo do iFood ou do WhatsApp em SVG produz uma cópia
 * aproximada de marca registrada — e uma cópia aproximada é pior que nenhuma:
 * parece oficial de longe e está errada de perto. Os arquivos ficam em
 * `public/integracoes/` e vêm da fonte da própria marca.
 *
 * ENQUANTO O ARQUIVO NÃO EXISTE, cai no monograma cinza. É deliberado: a tela
 * inteira não pode depender de um asset que ainda não foi baixado, e um
 * quadrado com a inicial não finge ser o logo de ninguém.
 */
export function LogoIntegracao({ src, nome, icone, ativa }: {
  src?: string;
  nome: string;
  /** Ícone de traço, para integrações internas (impressão, balança). */
  icone?: React.ReactNode;
  ativa: boolean;
}) {
  const [falhou, setFalhou] = useState(false);

  const moldura = cn(
    'flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[11px]',
    ativa ? 'bg-primary/[0.08] text-primary' : 'bg-[#F5F4F1] text-muted-foreground dark:bg-muted',
  );

  if (src && !falhou) {
    return (
      <span className={moldura}>
        <img src={src} alt="" aria-hidden className="size-full object-contain p-1.5" onError={() => setFalhou(true)} />
      </span>
    );
  }

  if (icone) return <span className={moldura}>{icone}</span>;

  return <span className={cn(moldura, 'text-[15px] font-bold')}>{nome.slice(0, 1)}</span>;
}

/** Verde quando está funcionando; cinza quando não. Sem badge, sem texto. */
export function Ponto({ ligada }: { ligada: boolean }) {
  return (
    <span
      aria-hidden
      className={cn('size-2 shrink-0 rounded-full', ligada ? 'bg-[#3F8F62]' : 'bg-[#DCD8D2] dark:bg-muted-foreground/40')}
    />
  );
}

/**
 * Um card da grade.
 *
 * O CARD INTEIRO É O BOTÃO. Com um botão pequeno dentro do card, metade dos
 * cliques cai na área morta em volta dele — e no celular essa área é a maior
 * parte do card.
 *
 * O STATUS É UMA LINHA CONCRETA, não um selo. "Ligado" não diz se está
 * funcionando: a loja pode estar ligada e sem o código, e aí nenhum pedido
 * chega. "Falta o código da loja" diz o que fazer.
 */
export function CardIntegracao({ logo, nome, status, ligada, onAbrir }: {
  logo: React.ReactNode;
  nome: string;
  status: string;
  ligada: boolean;
  onAbrir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={cn(
        'group flex flex-col gap-3 rounded-[14px] border border-border bg-card p-4 text-left',
        'shadow-[0_1px_2px_rgba(28,25,23,.04)] transition-all',
        'hover:-translate-y-px hover:shadow-[0_6px_16px_rgba(28,25,23,.08)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <span className="flex w-full items-start justify-between gap-2">
        {logo}
        <Ponto ligada={ligada} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-bold">{nome}</span>
        <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{status}</span>
      </span>
    </button>
  );
}

/** A moldura do modal: cabeçalho fixo, corpo rolando. */
export function ModalIntegracao({ aberta, aoFechar, logo, nome, status, children }: {
  aberta: boolean;
  aoFechar: () => void;
  logo: React.ReactNode;
  nome: string;
  status: string;
  children: React.ReactNode;
}) {
  return (
    <Modal open={aberta} onOpenChange={v => { if (!v) aoFechar(); }}>
      <ModalConteudo className="sm:w-[min(620px,100vw-48px)]">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          {logo}
          <div className="min-w-0 flex-1">
            <ModalTitulo className="truncate text-[17px] font-extrabold">{nome}</ModalTitulo>
            <ModalDescricao className="truncate text-[12.5px] text-muted-foreground">{status}</ModalDescricao>
          </div>
          <ModalClose
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </ModalClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </ModalConteudo>
    </Modal>
  );
}

/**
 * Uma linha do modal, separada por fio — não card dentro de card.
 *
 * Cards aninhados criam três molduras para o olho atravessar antes de chegar
 * no interruptor. O fio separa com uma linha de um pixel.
 */
export function Linha({ titulo, descricao, acao, children }: {
  titulo: string;
  descricao?: React.ReactNode;
  /** Interruptor ou botão, à direita. */
  acao?: React.ReactNode;
  /** O que aparece embaixo da linha quando há conteúdo (prévias, listas). */
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-border px-5 py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{titulo}</p>
          {descricao && (
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{descricao}</p>
          )}
        </div>
        {acao && <div className="flex shrink-0 items-center gap-2">{acao}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * Acordeão FECHADO por padrão.
 *
 * As quatro regras da sincronização são importantes e longas — e importantes e
 * longas, sempre abertas, viram o tapete embaixo do qual o controle some. Quem
 * já entendeu não lê de novo; quem não entendeu abre.
 */
export function Sanfona({ titulo, aoLado, children }: {
  titulo: string;
  aoLado?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [aberta, setAberta] = useState(false);
  return (
    <div className="bg-[#FCFCFB] px-5 py-3 dark:bg-muted/30">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setAberta(a => !a)}
          aria-expanded={aberta}
          className="text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
        >
          {titulo} {aberta ? '−' : '+'}
        </button>
        {aoLado && <span className="text-[12px] text-muted-foreground">{aoLado}</span>}
      </div>
      {aberta && <div className="mt-3">{children}</div>}
    </div>
  );
}
