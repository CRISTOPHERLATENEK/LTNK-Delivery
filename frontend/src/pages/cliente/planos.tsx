/**
 * `/planos` — a página de planos, com endereço próprio.
 *
 * ────────────────── POR QUE ELA EXISTE ──────────────────
 *
 * O site tinha UMA página. O Google só classifica endereço que existe, então
 * "quanto custa", "tem fidelidade", "tem taxa por pedido" — perguntas que
 * alguém digita antes de contratar — não tinham onde ser respondidas. Tudo
 * vivia dentro da home, competindo entre si por um endereço só.
 *
 * NÃO HÁ TEXTO NOVO AQUI. O conteúdo é o mesmo `landing_planos` que o admin já
 * preencheu, renderizado pelo MESMO componente da landing (`SecaoPlanos`) —
 * preço divergindo entre duas páginas do site é reclamação de cliente, não
 * detalhe de código.
 *
 * A CASCA É LEVE de propósito: logo, voltar, a seção, e o convite. A landing
 * tem herói, carrossel, depoimentos e comparativo, que existem para convencer
 * quem chega sem saber o que quer. Quem abre `/planos` já sabe.
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTema } from '@/lib/tema';
import { alturaLogo } from '@/lib/logo-escala';
import { SecaoPlanos, usarLinkZap, PLANOS_PADRAO } from './landing';

export function PaginaPlanos() {
  const { marca } = useTema();
  const linkZap = usarLinkZap(marca);
  const planos = marca.landing_planos?.length ? marca.landing_planos : PLANOS_PADRAO;
  const titulo = marca.landing_planos_titulo || 'Planos sem *pegadinha*';
  const subtitulo = marca.landing_planos_subtitulo
    || 'Sem taxa por pedido, sem fidelidade. Você paga a mensalidade e pronto.';

  /*
   * O BLOCO DO BUSCADOR SAI QUANDO O APP MONTA — e aqui isso é feito na mão.
   *
   * Na home quem limpa é o próprio React: o bloco vive DENTRO do `#root` e o
   * `createRoot` esvazia o contêiner antes de desenhar. Estas páginas montam
   * pelo roteador, com o `#root` já desenhado, então o bloco do servidor
   * continuaria na tela abaixo do conteúdo real — o mesmo texto duas vezes.
   */
  useEffect(() => {
    document.getElementById('seo-inicial')?.remove();
  }, []);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-extrabold">
            {marca.logo_url
              ? <img src={marca.logo_url} alt={marca.nome}
                  style={{ height: alturaLogo(36, marca.logo_escala) }}
                  className="w-auto max-w-[170px] object-contain" />
              : marca.nome}
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Voltar ao início
          </Link>
        </div>
      </header>

      <main>
        <SecaoPlanos titulo={titulo} subtitulo={subtitulo} planos={planos} linkZap={linkZap} />

        <section className="mx-auto max-w-3xl px-5 pb-20 text-center sm:px-6">
          <p className="text-muted-foreground">
            Ficou com dúvida sobre qual plano serve para a sua operação?
          </p>
          <a
            href={linkZap('Olá! Quero ajuda para escolher o plano.') || '/lojista'}
            {...(linkZap() ? { target: '_blank', rel: 'noreferrer' } : {})}
            className="mt-4 inline-flex h-12 items-center justify-center rounded-2xl bg-primary px-7 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98]"
          >
            Falar com a gente
          </a>
        </section>
      </main>
    </div>
  );
}
