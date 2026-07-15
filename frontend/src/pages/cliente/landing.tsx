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
import { Store, Smartphone, Bike, ChefHat, Palette, Receipt, ArrowRight, Check, Star, Shield, Users, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTema } from '@/lib/tema';
import { api } from '@/lib/api';
import type { Loja, LandingRecurso, LandingIcone } from '@/types';

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

export function PaginaLanding() {
  const { marca } = useTema();
  const recursos = marca.landing_recursos?.length ? marca.landing_recursos : RECURSOS_PADRAO;
  const beneficios = marca.landing_beneficios?.length ? marca.landing_beneficios : BENEFICIOS_PADRAO;
  const ctaTexto = marca.landing_cta_texto || 'Ver demonstração';

  const demo = useQuery({
    queryKey: ['landing-loja-demo'],
    queryFn: () => api<{ lojas: Loja[] }>('GET', '/api/lojas').then(r => r.lojas[0]),
    staleTime: 5 * 60_000,
  });

  const linkDemo = demo.data ? `/loja/${demo.data.id}` : undefined;

  return (
    <div className="min-h-screen bg-background">
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
    </div>
  );
}
