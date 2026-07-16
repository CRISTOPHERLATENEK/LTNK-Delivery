/**
 * Landing page do produto (SaaS) — exibida no domínio principal quando NÃO
 * há uma "loja padrão" configurada (ver marca.loja_id em useTema). Antes o
 * domínio principal mostrava um marketplace genérico listando lojas; como o
 * modelo real é white-label (cada loja no seu próprio domínio/slug), essa
 * página vende a PLATAFORMA em si, com um botão "Ver demonstração" que leva
 * pra uma loja de exemplo (a primeira aprovada).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Store, Smartphone, Bike, ChefHat, Palette, Receipt, ArrowRight, Check, Star, Shield, Users, Mail, Phone, X, Quote, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTema } from '@/lib/tema';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Loja, LandingRecurso, LandingIcone, LandingDepoimento, LandingDestaque } from '@/types';

/**
 * Anima a entrada de uma seção (fade + subida) quando ela cruza a viewport
 * ao rolar a página — mesma sensação de "scroll reveal" de landing pages
 * de referência do setor. Sem lib externa: só IntersectionObserver.
 */
function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisivel(true); obs.disconnect(); } },
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn(
      'transition-all duration-700 ease-out',
      visivel ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6',
      className,
    )}>
      {children}
    </div>
  );
}

/**
 * Moldura de janela de navegador que emoldura um print do app (ou um
 * placeholder quando ainda não há imagem). Dá o ar de "produto de verdade"
 * das landings SaaS de referência.
 */
function MockupNavegador({ src, nome, flutuar }: { src?: string; nome: string; flutuar?: boolean }) {
  return (
    <div className="relative">
      <div className="absolute inset-0 -z-10 translate-y-6 scale-95 rounded-3xl bg-primary/20 blur-2xl" />
      <div className={cn('overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10', flutuar && 'animar-flutuar')}>
        {/* Barra do navegador */}
        <div className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-red-400" />
          <span className="size-2.5 rounded-full bg-yellow-400" />
          <span className="size-2.5 rounded-full bg-green-400" />
          <div className="ml-3 flex-1 rounded-md bg-background/60 px-3 py-1 text-[11px] text-muted-foreground truncate">
            {nome ? `${nome.toLowerCase().replace(/\s+/g, '')}.com.br` : 'seudelivery.com.br'}
          </div>
        </div>
        {/* Conteúdo */}
        {src ? (
          <img src={src} alt="Prévia do aplicativo" className="w-full object-cover" />
        ) : (
          <div className="aspect-[4/3] bg-gradient-to-br from-primary/5 to-muted flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Store className="h-12 w-12 opacity-30" />
            <span className="text-xs">Prévia do app</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Moldura de celular (bezel escuro + notch) que emoldura um print vertical
 * do app. Usada nos blocos de destaque marcados como formato "celular".
 */
function MolduraCelular({ src, flutuar }: { src?: string; flutuar?: boolean }) {
  return (
    <div className={cn('relative mx-auto w-[240px] max-w-full', flutuar && 'animar-flutuar')}>
      <div className="absolute inset-0 -z-10 translate-y-8 scale-90 rounded-[3rem] bg-primary/20 blur-2xl" />
      <div className="rounded-[2.4rem] border-[6px] border-neutral-800 bg-neutral-800 shadow-2xl shadow-primary/10">
        {/* Notch */}
        <div className="relative">
          <div className="absolute left-1/2 top-1.5 z-10 h-4 w-24 -translate-x-1/2 rounded-b-2xl bg-neutral-800" />
          <div className="overflow-hidden rounded-[2rem] bg-background">
            {src ? (
              <img src={src} alt="Prévia no celular" className="w-full object-cover" />
            ) : (
              <div className="aspect-[9/19] bg-gradient-to-br from-primary/5 to-muted flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <Smartphone className="h-10 w-10 opacity-30" />
                <span className="text-[11px]">Prévia no celular</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mapa de ícones disponíveis pro admin escolher na edição da landing (ver PUT /admin/landing). */
export const ICONES_LANDING: Record<LandingIcone, LucideIcon> = {
  store: Store, palette: Palette, bike: Bike, chefhat: ChefHat, receipt: Receipt,
  smartphone: Smartphone, check: Check, star: Star, shield: Shield, users: Users,
};

const RECURSOS_PADRAO: LandingRecurso[] = [
  { icone: 'store', titulo: 'Multi-lojas', desc: 'Cada loja com seu próprio painel, cardápio e domínio.' },
  { icone: 'palette', titulo: 'White label', desc: 'Cores, logo e visual totalmente personalizáveis por loja.' },
  { icone: 'bike', titulo: 'Rastreio ao vivo', desc: 'Entregador com GPS em tempo real, do jeito que o cliente vê no mapa.' },
  { icone: 'chefhat', titulo: 'Cozinha (KDS)', desc: 'Painel de produção próprio, sem misturar com o financeiro.' },
  { icone: 'receipt', titulo: 'NFC-e integrada', desc: 'Emissão fiscal direto na venda, sem depender de outro sistema.' },
  { icone: 'smartphone', titulo: 'PDV + Comandas', desc: 'Venda no balcão e mesas do salão, tudo no mesmo lugar.' },
];

const BENEFICIOS_PADRAO = ['Sem taxa de setup', 'Cada loja com domínio próprio', 'Suporte a Pix, cartão e dinheiro'];

const SEM_PADRAO = ['Desorganização no atendimento', 'Falhas de comunicação', 'Erros nos pedidos'];
const COM_PADRAO = ['Agilidade e organização nos pedidos', 'Cada loja com sua própria operação', 'Menos erro, mais venda'];
const SEGMENTOS_PADRAO = ['Pizzaria', 'Hamburgueria', 'Açaiteria', 'Padaria', 'Sorveteria', 'Sushiteria'];

const DESTAQUES_PADRAO: LandingDestaque[] = [
  { imagem_url: '/landing/storefront-mobile.png', formato: 'celular', titulo: 'Seu cliente pede direto pelo celular', desc: 'Cardápio digital com foto, categorias e busca — sem app pra baixar. O cliente monta o pedido e finaliza em segundos, com Pix, cartão ou dinheiro.' },
  { imagem_url: '/landing/storefront-desktop.png', formato: 'navegador', titulo: 'Sua loja online com a sua cara', desc: 'Cores, logo e capa personalizados por loja. Cada negócio com seu próprio endereço, cardápio e visual — do jeito da marca.' },
  { imagem_url: '/landing/cupom-fiscal.png', formato: 'livre', titulo: 'Cupom fiscal (NFC-e) na hora da venda', desc: 'A nota sai com itens, total, chave de acesso e QR code — direto do sistema, sem precisar de outro programa nem digitar os dados de novo.' },
];

export function PaginaLanding() {
  const { marca } = useTema();
  const recursos = marca.landing_recursos?.length ? marca.landing_recursos : RECURSOS_PADRAO;
  const beneficios = marca.landing_beneficios?.length ? marca.landing_beneficios : BENEFICIOS_PADRAO;
  const ctaTexto = marca.landing_cta_texto || 'Ver demonstração';
  const semLista = marca.landing_comparativo_sem?.length ? marca.landing_comparativo_sem : SEM_PADRAO;
  const comLista = marca.landing_comparativo_com?.length ? marca.landing_comparativo_com : COM_PADRAO;
  const segmentos = marca.landing_segmentos?.length ? marca.landing_segmentos : SEGMENTOS_PADRAO;
  const depoimentos: LandingDepoimento[] = marca.landing_depoimentos ?? [];
  const destaques = marca.landing_destaques?.length ? marca.landing_destaques : DESTAQUES_PADRAO;

  const heroEyebrow = marca.landing_hero_eyebrow || 'Sistema para deliveries e restaurantes';
  const heroTitulo = marca.landing_hero_titulo || `Gestão simples, fácil e eficiente para seu negócio`;
  const heroSubtitulo = marca.landing_hero_subtitulo || marca.slogan || 'Cardápio, pedidos, entrega e fiscal — tudo em um só sistema, do seu jeito.';
  const heroImagem = marca.landing_hero_imagem || '/landing/storefront-desktop.png';

  const demo = useQuery({
    queryKey: ['landing-loja-demo'],
    queryFn: () => api<{ lojas: Loja[] }>('GET', '/api/lojas').then(r => r.lojas[0]),
    staleTime: 5 * 60_000,
  });

  const linkDemo = demo.data ? `/loja/${demo.data.id}` : undefined;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            {marca.logo_url ? (
              <img src={marca.logo_url} alt={marca.nome} className="h-8 w-auto" />
            ) : (
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Store className="h-4 w-4" />
              </div>
            )}
            <span className="font-extrabold">{marca.nome}</span>
          </div>
          <nav className="flex items-center gap-2">
            <Link to="/lojista" className="hidden sm:block text-sm font-semibold text-muted-foreground hover:text-foreground px-3 py-2">
              Sou lojista
            </Link>
            <Button size="sm" asChild disabled={!linkDemo}>
              {linkDemo ? <Link to={linkDemo}>{ctaTexto}</Link> : <span>{ctaTexto}</span>}
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" />
        <div className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 sm:py-24 lg:grid-cols-2">
          {/* Coluna de texto */}
          <div className="text-center lg:text-left">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
              <Store className="h-3.5 w-3.5" /> {heroEyebrow}
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
              {heroTitulo}
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground lg:mx-0">
              {heroSubtitulo}
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <Button size="xl" asChild disabled={!linkDemo}>
                {linkDemo ? (
                  <Link to={linkDemo}>{ctaTexto} <ArrowRight className="h-4 w-4" /></Link>
                ) : (
                  <span>{ctaTexto}</span>
                )}
              </Button>
              <Button size="xl" variant="outline" asChild>
                <Link to="/lojista">Sou lojista, quero começar</Link>
              </Button>
            </div>
            <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground lg:justify-start">
              {beneficios.slice(0, 3).map(b => (
                <li key={b} className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-primary" /> {b}
                </li>
              ))}
            </ul>
          </div>

          {/* Coluna de imagem (mockup de navegador) */}
          <MockupNavegador src={heroImagem} nome={marca.nome} flutuar />
        </div>
      </section>

      {/* Segmentos que atendem */}
      <section className="border-b border-border bg-muted/30 py-8">
        <Reveal className="mx-auto max-w-6xl px-6">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Feito para todo tipo de negócio
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {segmentos.map(s => (
              <span key={s} className="rounded-full border border-border bg-card px-4 py-1.5 text-sm font-semibold text-muted-foreground">
                {s}
              </span>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Comparativo sem/com */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <Reveal>
          <h2 className="text-center text-2xl font-bold sm:text-3xl">Diga adeus ao atendimento caótico</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-muted-foreground">
            O futuro é integrado, rápido e automatizado.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="text-sm font-bold text-muted-foreground">O JEITO ANTIGO</div>
              <ul className="mt-4 space-y-3">
                {semLista.map(item => (
                  <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border-2 border-primary bg-primary/5 p-6">
              <div className="text-sm font-bold text-primary">O JEITO NOVO</div>
              <ul className="mt-4 space-y-3">
                {comLista.map(item => (
                  <li key={item} className="flex items-start gap-2 text-sm font-medium">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Destaques (foto + texto, alternando lado) */}
      {destaques.length > 0 && (
        <section className="mx-auto max-w-6xl px-6 py-16 space-y-16 sm:space-y-24">
          {destaques.map((d, i) => (
            <Reveal key={i} className={cn('grid items-center gap-8 sm:grid-cols-2', i % 2 === 1 && 'sm:[&>*:first-child]:order-2')}>
              <div className="flex justify-center">
                {!d.imagem_url ? (
                  <div className="flex aspect-video w-full items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-accent/40">
                    <Receipt className="h-16 w-16 text-primary/40" />
                  </div>
                ) : d.formato === 'celular' ? (
                  <MolduraCelular src={d.imagem_url} flutuar />
                ) : d.formato === 'livre' ? (
                  <img src={d.imagem_url} alt={d.titulo} className="mx-auto max-h-[520px] w-auto rounded-2xl shadow-xl animar-flutuar" />
                ) : (
                  <MockupNavegador src={d.imagem_url} nome={marca.nome} flutuar />
                )}
              </div>
              <div className="text-center sm:text-left">
                <h3 className="text-2xl font-bold sm:text-3xl">{d.titulo}</h3>
                <p className="mt-3 text-muted-foreground">{d.desc}</p>
              </div>
            </Reveal>
          ))}
        </section>
      )}

      {/* Recursos */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <Reveal>
          <h2 className="text-center text-2xl font-bold sm:text-3xl">Tudo que uma operação de delivery precisa</h2>
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {recursos.map(({ icone, titulo, desc }) => {
              const Icone = ICONES_LANDING[icone] || Store;
              return (
                <div key={titulo} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                    <Icone className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-semibold">{titulo}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                </div>
              );
            })}
          </div>
        </Reveal>
      </section>

      {/* Depoimentos */}
      {depoimentos.length > 0 && (
        <section className="border-t border-border bg-muted/30 py-16">
          <Reveal className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-2xl font-bold sm:text-3xl">Sucesso comprovado contado por quem usa</h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {depoimentos.map((d, i) => (
                <div key={i} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                  <Quote className="h-5 w-5 text-primary" />
                  <p className="mt-3 text-sm text-muted-foreground">{d.texto}</p>
                  <div className="mt-4 font-semibold text-sm">{d.nome}</div>
                  {d.negocio && <div className="text-xs text-muted-foreground">{d.negocio}</div>}
                </div>
              ))}
            </div>
          </Reveal>
        </section>
      )}

      {/* CTA final */}
      <section className="border-t border-border bg-accent/40">
        <Reveal className="mx-auto max-w-3xl px-6 py-16 text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">Quer ver funcionando na prática?</h2>
          <p className="mt-3 text-muted-foreground">
            Explore uma loja de demonstração completa — cardápio, carrinho e checkout de verdade.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" asChild disabled={!linkDemo}>
              {linkDemo ? <Link to={linkDemo}>{ctaTexto}</Link> : <span>{ctaTexto}</span>}
            </Button>
          </div>
          <ul className="mx-auto mt-8 flex max-w-md flex-col gap-2 text-left text-sm text-muted-foreground">
            {beneficios.map(item => (
              <li key={item} className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-primary" /> {item}
              </li>
            ))}
          </ul>
        </Reveal>
      </section>

      {/* Rodapé */}
      <footer className="mt-auto border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-10 grid gap-8 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2 font-extrabold">
              {marca.logo_url ? (
                <img src={marca.logo_url} alt={marca.nome} className="h-6 w-auto" />
              ) : (
                <Store className="h-5 w-5 text-primary" />
              )}
              {marca.nome}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {marca.slogan || 'A plataforma completa de delivery multi-lojas.'}
            </p>
          </div>

          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Plataforma</div>
            <ul className="mt-3 space-y-2 text-sm">
              {linkDemo && (
                <li><Link to={linkDemo} className="text-muted-foreground hover:text-foreground">Ver demonstração</Link></li>
              )}
              <li><Link to="/lojista" className="text-muted-foreground hover:text-foreground">Sou lojista</Link></li>
              {marca.termos_url && (
                <li><a href={marca.termos_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">Termos de uso</a></li>
              )}
            </ul>
          </div>

          {(marca.suporte_email || marca.suporte_telefone) && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Contato</div>
              <ul className="mt-3 space-y-2 text-sm">
                {marca.suporte_email && (
                  <li>
                    <a href={`mailto:${marca.suporte_email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                      <Mail className="h-3.5 w-3.5 shrink-0" /> {marca.suporte_email}
                    </a>
                  </li>
                )}
                {marca.suporte_telefone && (
                  <li className="flex items-center gap-1.5 text-muted-foreground">
                    <Phone className="h-3.5 w-3.5 shrink-0" /> {marca.suporte_telefone}
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
        <div className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} {marca.nome}. Todos os direitos reservados.
        </div>
      </footer>
    </div>
  );
}
