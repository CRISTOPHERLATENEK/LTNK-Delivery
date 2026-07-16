/**
 * Landing page do produto (SaaS) — exibida no domínio principal quando NÃO
 * há uma "loja padrão" configurada (ver marca.loja_id em useTema). Antes o
 * domínio principal mostrava um marketplace genérico listando lojas; como o
 * modelo real é white-label (cada loja no seu próprio domínio/slug), essa
 * página vende a PLATAFORMA em si, com um botão "Ver demonstração" que leva
 * pra uma loja de exemplo (a primeira aprovada).
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Store, Smartphone, Bike, ChefHat, Palette, Receipt, ArrowRight, Check, Star, Shield, Users, Mail, Phone, X, Quote, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTema } from '@/lib/tema';
import { api } from '@/lib/api';
import type { Loja, LandingRecurso, LandingIcone, LandingDepoimento } from '@/types';

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

export function PaginaLanding() {
  const { marca } = useTema();
  const recursos = marca.landing_recursos?.length ? marca.landing_recursos : RECURSOS_PADRAO;
  const beneficios = marca.landing_beneficios?.length ? marca.landing_beneficios : BENEFICIOS_PADRAO;
  const ctaTexto = marca.landing_cta_texto || 'Ver demonstração';
  const semLista = marca.landing_comparativo_sem?.length ? marca.landing_comparativo_sem : SEM_PADRAO;
  const comLista = marca.landing_comparativo_com?.length ? marca.landing_comparativo_com : COM_PADRAO;
  const segmentos = marca.landing_segmentos?.length ? marca.landing_segmentos : SEGMENTOS_PADRAO;
  const depoimentos: LandingDepoimento[] = marca.landing_depoimentos ?? [];

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
        <div className="relative mx-auto max-w-4xl px-6 py-20 text-center sm:py-28">
          {marca.logo_url ? (
            <img src={marca.logo_url} alt={marca.nome} className="mx-auto mb-6 h-14 w-auto" />
          ) : (
            <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <Store className="h-7 w-7" />
            </div>
          )}
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
            {marca.nome}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            {marca.slogan || 'A plataforma completa de delivery multi-lojas: cardápio, pedidos, entrega e fiscal, tudo em um só lugar.'}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="xl" asChild disabled={!linkDemo}>
              {linkDemo ? (
                <Link to={linkDemo}>
                  {ctaTexto} <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <span>{ctaTexto}</span>
              )}
            </Button>
            <Button size="xl" variant="outline" asChild>
              <Link to="/lojista">Sou lojista, quero começar</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Segmentos que atendem */}
      <section className="border-b border-border bg-muted/30 py-8">
        <div className="mx-auto max-w-6xl px-6">
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
        </div>
      </section>

      {/* Comparativo sem/com */}
      <section className="mx-auto max-w-5xl px-6 py-16">
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
      </section>

      {/* Recursos */}
      <section className="mx-auto max-w-6xl px-6 py-16">
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
      </section>

      {/* Depoimentos */}
      {depoimentos.length > 0 && (
        <section className="border-t border-border bg-muted/30 py-16">
          <div className="mx-auto max-w-6xl px-6">
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
          </div>
        </section>
      )}

      {/* CTA final */}
      <section className="border-t border-border bg-accent/40">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
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
        </div>
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
