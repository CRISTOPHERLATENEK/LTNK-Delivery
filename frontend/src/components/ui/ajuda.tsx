/**
 * AJUDA CONTEXTUAL — um `?` ao lado do título, com a resposta ali.
 *
 * O painel não tinha nada disso. A alternativa que se costuma escolher — tour
 * guiado na primeira entrada — falha pelo motivo óbvio: ninguém lembra de tour.
 * Lembra do `?` que estava ali no momento em que travou.
 *
 * A IMAGEM VEM ANTES DO VÍDEO, sempre. Ela responde sem tirar a pessoa da
 * tarefa; o vídeo exige sair, assistir e voltar — e quem está com o cliente na
 * frente não vai fazer isso. O vídeo é para quem quer entender, a imagem é para
 * quem quer continuar.
 *
 * CONTEÚDO AUSENTE NÃO RENDERIZA NADA. Enquanto imagem e vídeo não existirem, o
 * `?` some da tela em vez de abrir um painel vazio — assim os pontos de
 * ancoragem podem ser colocados agora e o conteúdo chegar depois, sem prometer
 * ajuda que não existe.
 */
import { useEffect, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ConteudoAjuda {
  titulo: string;
  /** Uma frase que responda sozinha, para quem não vai abrir nada. */
  resumo: string;
  /** Caminho da imagem em `public/ajuda`. Sem ela, só o resumo aparece. */
  imagem?: string;
  /**
   * Gravação do fluxo na tela, em GIF.
   *
   * Fica entre a imagem e o vídeo porque é o que resolve o "onde clico" sem
   * exigir que a pessoa saia da tarefa — o gesto se vê, e é MUDO, então não
   * atrapalha quem está no balcão com o cliente na frente.
   *
   * Carregado só quando o painel abre (`loading="lazy"`): são ~1,5 MB cada, e
   * baixá-los junto do painel puniria quem nunca abre a ajuda.
   */
  gif?: string;
  /** Link do vídeo. Sem ele, o bloco de vídeo não aparece. */
  video?: string;
  /** Duração legível, ex.: "3 min" — some a dúvida de "vou perder quanto tempo?". */
  duracao?: string;
  /** Folha para imprimir, quando existir (a cola do balcão). */
  imprimivel?: string;
}

/**
 * O catálogo, num lugar só.
 *
 * Centralizado de propósito: o texto de ajuda espalhado pelas telas é o que
 * envelhece sem ninguém notar — some a função e a explicação dela fica. Aqui dá
 * pra revisar tudo de uma vez quando o produto muda.
 *
 * As chaves acompanham a numeração de `docs/roteiro-treinamento.md`.
 */
export const AJUDA: Record<string, ConteudoAjuda> = {
  'complementos-grupo': {
    titulo: 'Um grupo para várias pizzas',
    resumo: 'Duplicar um produto LIGA ao mesmo grupo de complementos — não copia. '
      + 'Mudar o preço da borda aqui muda em todos os produtos que usam este grupo.',
    imagem: '/ajuda/grupo-compartilhado.svg',
  },
  'complementos-soltar': {
    titulo: 'Quando uma pizza precisa ser diferente',
    resumo: '"Soltar deste produto" clona o grupo só para ele. Os outros continuam juntos.',
  },
  'complementos-preco': {
    titulo: 'Como os sabores são cobrados',
    resumo: 'Somar cobra todos os adicionais; maior cobra só o do sabor mais caro; '
      + 'proporcional divide pelos pedaços. Com somar, uma pizza de 4 sabores caros fica impagável.',
    imagem: '/ajuda/modo-preco.svg',
  },
  'composicao-combo': {
    titulo: 'Como um combo é montado',
    resumo: 'Cada item do combo vira um bloco na tela do cliente, com os complementos dele. '
      + 'O componente deve ter "vender avulso" desligado para não aparecer no cardápio.',
    imagem: '/ajuda/anatomia-combo.svg',
  },
  'horario-fechar': {
    titulo: 'Os dois jeitos de fechar',
    resumo: 'No horário automático, "Fechar agora" é uma pausa de 2 horas — depois a loja reabre '
      + 'sozinha. Para encerrar o dia, use "Encerrar o dia".',
    imagem: '/ajuda/fechar-loja.svg',
  },
  'produtos-ordem': {
    titulo: 'A ordem do cardápio',
    resumo: 'Arraste pela alça, ou use as setas no celular. Vale para categoria, faixa e produto. '
      + 'Com busca ou filtro ativo as alças somem — clique em "Todas".',
    imagem: '/ajuda/alcas-ordenacao.svg',
    gif: '/ajuda/ordenar-cardapio.gif',
  },
  'balcao-atalhos': {
    titulo: 'Atalhos do balcão',
    resumo: 'Cada opção tem um número — digite o número completo. Enquanto ele ainda puder crescer (numa lista longa, "3" pode virar 31), o sistema espera: o que você digitou aparece no topo da janela e some quando aplica.',
    imagem: '/ajuda/atalhos-balcao.svg',
    gif: '/ajuda/pdv-complementos.gif',
    imprimivel: '/ajuda/cola-balcao.html',
  },
  'mesa-fluxo': {
    titulo: 'Como a mesa funciona',
    resumo: '"Enviar para produção" trabalha em rodadas: só manda o que ainda não foi enviado. '
      + 'Adicionou depois, clique de novo.',
    imagem: '/ajuda/fluxo-mesa.svg',
  },
};

export function Ajuda({ chave, className }: { chave: keyof typeof AJUDA | string; className?: string }) {
  const conteudo = AJUDA[chave];
  const [aberto, setAberto] = useState(false);

  /* Esc fecha. Um painel de ajuda que prende a pessoa é o oposto de ajuda. */
  useEffect(() => {
    if (!aberto) return;
    const ao = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    window.addEventListener('keydown', ao);
    return () => window.removeEventListener('keydown', ao);
  }, [aberto]);

  if (!conteudo) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label={`Ajuda: ${conteudo.titulo}`}
        title={conteudo.titulo}
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-full',
          'text-muted-foreground/50 transition-colors hover:text-primary',
          className,
        )}
      >
        <HelpCircle className="size-[15px]" />
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-[60] flex justify-end bg-black/40"
          onClick={() => setAberto(false)}
        >
          <aside
            className="flex h-full w-full max-w-[420px] flex-col bg-card shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 border-b border-border px-5 py-4">
              <p className="min-w-0 flex-1 text-[16px] font-bold leading-tight">{conteudo.titulo}</p>
              <button
                type="button" onClick={() => setAberto(false)} aria-label="Fechar"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
              ><X className="size-4" /></button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {/* O RESUMO PRIMEIRO, sempre. É o que resolve pra quem não vai
                  abrir imagem nem vídeo — e essa é a maioria. */}
              <p className="text-[14.5px] leading-relaxed">{conteudo.resumo}</p>

              {conteudo.imagem && (
                <img
                  src={conteudo.imagem}
                  alt={conteudo.titulo}
                  className="w-full rounded-xl border border-border bg-white"
                />
              )}

              {conteudo.gif && (
                <figure className="space-y-1.5">
                  <img
                    src={conteudo.gif}
                    alt={`${conteudo.titulo} — gravação da tela`}
                    loading="lazy"
                    className="w-full rounded-xl border border-border bg-white"
                  />
                  <figcaption className="text-[11.5px] text-muted-foreground">
                    Gravação da tela, sem som.
                  </figcaption>
                </figure>
              )}

              {conteudo.imprimivel && (
                <a
                  href={conteudo.imprimivel} target="_blank" rel="noreferrer"
                  className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-[14px] font-semibold hover:bg-accent"
                >
                  Folha para imprimir
                  <span className="text-[12px] font-normal text-muted-foreground">abre em nova aba</span>
                </a>
              )}

              {conteudo.video && (
                <a
                  href={conteudo.video} target="_blank" rel="noreferrer"
                  className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-[14px] font-semibold hover:bg-accent"
                >
                  Ver o vídeo
                  {conteudo.duracao && (
                    <span className="text-[12px] font-normal text-muted-foreground">{conteudo.duracao}</span>
                  )}
                </a>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
