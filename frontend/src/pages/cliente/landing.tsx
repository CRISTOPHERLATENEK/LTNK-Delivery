/**
 * Landing page do produto (SaaS "Maxx Delivery") — exibida no domínio
 * principal quando NÃO há uma "loja padrão" configurada (ver marca.loja_id em
 * useTema). Vende a PLATAFORMA em si, com um botão "Ver demonstração" que leva
 * pra uma loja de exemplo.
 *
 * CORES: tudo sai dos tokens do tema (`primary`, `background`, `card`,
 * `muted`, `accent`, `destructive`...), que o painel admin → Marca edita via
 * reaplicarPaletaTema(). NUNCA hardcodar hex de marca aqui — senão a edição de
 * cores no admin deixaria de refletir na landing. As únicas cores fixas são as
 * do CUPOM (papel térmico branco/preto), por ser a representação de um recibo
 * impresso de verdade.
 *
 * ANIMAÇÃO: GSAP + ScrollTrigger + DrawSVGPlugin (progressive enhancement — os
 * estados iniciais escondidos são aplicados SÓ via gsap.set() no JS; se o JS
 * falhar, todo o conteúdo aparece visível e clicável). Respeita
 * prefers-reduced-motion via gsap.matchMedia().
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { Store, Smartphone, Bike, ChefHat, Palette, Receipt, ArrowRight, Check, Star, Shield, ShieldCheck, Users, Mail, Phone, Quote, Printer, QrCode, KeyRound, Cloud, BarChart3, Sun, Moon, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTema, reaplicarPaletaTema } from '@/lib/tema';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Loja, LandingRecurso, LandingIcone, LandingDepoimento, LandingDestaque } from '@/types';

gsap.registerPlugin(ScrollTrigger, DrawSVGPlugin);

/**
 * Moldura de janela de navegador que emoldura um print do app (ou um
 * placeholder quando ainda não há imagem).
 */
function MockupNavegador({ src, nome, flutuar }: { src?: string; nome: string; flutuar?: boolean }) {
  return (
    <div className="relative">
      <div className="absolute inset-0 -z-10 translate-y-6 scale-95 rounded-3xl bg-primary/20 blur-2xl" />
      <div className={cn('overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10', flutuar && 'animar-flutuar')}>
        <div className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-red-400" />
          <span className="size-2.5 rounded-full bg-yellow-400" />
          <span className="size-2.5 rounded-full bg-green-400" />
          <div className="ml-3 flex-1 rounded-md bg-background/60 px-3 py-1 text-[11px] text-muted-foreground truncate">
            {nome ? `${nome.toLowerCase().replace(/\s+/g, '')}.com.br` : 'seudelivery.com.br'}
          </div>
        </div>
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

/** Moldura de celular (bezel escuro + notch) que emoldura um print vertical. */
function MolduraCelular({ src, flutuar }: { src?: string; flutuar?: boolean }) {
  return (
    <div className={cn('relative mx-auto w-[240px] max-w-full', flutuar && 'animar-flutuar')}>
      <div className="absolute inset-0 -z-10 translate-y-8 scale-90 rounded-[3rem] bg-primary/20 blur-2xl" />
      <div className="rounded-[2.4rem] border-[6px] border-neutral-800 bg-neutral-800 shadow-2xl shadow-primary/10">
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

/** Mapa de ícones disponíveis pro admin escolher na edição da landing. */
export const ICONES_LANDING: Record<LandingIcone, LucideIcon> = {
  store: Store, palette: Palette, bike: Bike, chefhat: ChefHat, receipt: Receipt,
  smartphone: Smartphone, check: Check, star: Star, shield: Shield, users: Users,
};

const RECURSOS_PADRAO: LandingRecurso[] = [
  { icone: 'store', titulo: 'Multi-lojas', desc: 'Cada loja com painel, cardápio e domínio próprios.' },
  { icone: 'palette', titulo: 'White label', desc: 'Cores, logo e visual do jeito da sua marca.' },
  { icone: 'bike', titulo: 'Rastreio ao vivo', desc: 'Entregador com GPS em tempo real no mapa.' },
  { icone: 'chefhat', titulo: 'Cozinha (KDS)', desc: 'Painel de produção, sem misturar com o financeiro.' },
  { icone: 'receipt', titulo: 'NFC-e integrada', desc: 'Emissão fiscal direto na venda.' },
  { icone: 'smartphone', titulo: 'PDV + Comandas', desc: 'Balcão e mesas do salão no mesmo lugar.' },
];

const BENEFICIOS_PADRAO = ['Sem taxa de setup', 'Cada loja com domínio próprio', 'Suporte a Pix, cartão e dinheiro'];

const SEM_PADRAO = ['Desorganização no atendimento', 'Falhas de comunicação', 'Erros nos pedidos', 'Nota fiscal em outro programa'];
const COM_PADRAO = [
  'Agilidade e organização (pedido entra e já aparece na cozinha)',
  'Cada loja com sua operação (painel, cardápio e domínio próprios)',
  'Menos erro, mais venda (nada de anotar pedido no papel)',
  'Cupom fiscal na hora (NFC-e sai junto com a venda, direto na SEFAZ)',
];
const SEGMENTOS_PADRAO = ['Pizzaria', 'Hamburgueria', 'Açaiteria', 'Padaria', 'Sorveteria', 'Sushiteria'];

const DESTAQUES_PADRAO: LandingDestaque[] = [
  { imagem_url: '/landing/storefront-mobile.png', formato: 'celular', titulo: 'Seu cliente pede direto pelo celular', desc: 'Cardápio digital com foto, categorias e busca — sem app pra baixar. O cliente monta o pedido e finaliza em segundos, com Pix, cartão ou dinheiro.' },
  { imagem_url: '/landing/storefront-desktop.png', formato: 'navegador', titulo: 'Sua loja online com a sua cara', desc: 'Cores, logo e capa personalizados por loja. Cada negócio com seu próprio endereço, cardápio e visual — do jeito da marca.' },
];

const FISCAL_BULLETS: { icone: LucideIcon; titulo: string; desc: string }[] = [
  { icone: Printer, titulo: 'Emissão automática', desc: 'NFC-e emitida na hora da finalização do pedido.' },
  { icone: QrCode, titulo: 'QR Code para o cliente', desc: 'Mais praticidade e transparência na entrega.' },
  { icone: KeyRound, titulo: 'Chave de acesso', desc: 'Consulta rápida em qualquer portal da SEFAZ.' },
  { icone: Receipt, titulo: 'Impressão rápida e confiável', desc: 'Compatível com as principais impressoras do mercado.' },
];

const FISCAL_STATS: { icone: LucideIcon; titulo: string; desc: string }[] = [
  { icone: ShieldCheck, titulo: 'NFC-e autorizada', desc: 'Autorização instantânea pela SEFAZ.' },
  { icone: Shield, titulo: 'Segurança total', desc: 'Dados protegidos e transmitidos com segurança.' },
  { icone: Cloud, titulo: 'Tudo integrado', desc: 'Funciona 100% dentro do sistema.' },
  { icone: BarChart3, titulo: 'Relatórios completos', desc: 'Acompanhe vendas e emissões em tempo real.' },
];

/** Itens ilustrativos do cupom fiscal (loja demo). */
const CUPOM_ITENS = [
  { q: 1, nome: 'X-SALADA ARTESANAL', v: '28,00' },
  { q: 1, nome: 'PORCAO BATATA RUSTICA', v: '16,00' },
  { q: 2, nome: 'REFRIGERANTE LATA', v: '12,00' },
];
const CUPOM_TOTAL = '56,00';

/* ───────────────────────── helpers visuais ───────────────────────── */

/**
 * Sublinhado "rabisco à mão" (traço SVG irregular) sob a palavra-chave.
 * currentColor = cor do texto do container (use com text-primary). Quando
 * `anima` é true recebe a classe alvo do DrawSVG do hero.
 */
function Rabisco({ anima }: { anima?: boolean }) {
  return (
    <svg
      className={cn('pointer-events-none absolute -bottom-1.5 left-0 h-[0.5em] w-full overflow-visible', anima && 'js-hero-rabisco')}
      viewBox="0 0 300 16" fill="none" preserveAspectRatio="none" aria-hidden="true"
    >
      <path d="M3 11 C 55 3, 105 15, 152 8 S 245 3, 297 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** Quebra "texto com *palavra* marcada" em segmentos; sem marcador, destaca a última palavra. */
function segmentosTitulo(texto: string): { t: string; d: boolean }[] {
  if (texto.includes('*')) {
    return texto.split(/\*([^*]+)\*/).map((t, i) => ({ t, d: i % 2 === 1 })).filter(s => s.t.length > 0);
  }
  const palavras = texto.trim().split(/\s+/);
  if (palavras.length <= 1) return [{ t: texto, d: true }];
  const ultima = palavras.pop() as string;
  return [{ t: palavras.join(' ') + ' ', d: false }, { t: ultima, d: true }];
}

/** Headline de seção: branco (foreground) + palavra-chave em laranja (primary) com rabisco. */
function TituloSecao({ texto, className }: { texto: string; className?: string }) {
  return (
    <h2 className={cn('font-extrabold tracking-tight text-foreground', className)}>
      {segmentosTitulo(texto).map((s, i) => s.d ? (
        <span key={i} className="relative inline-block text-primary">{s.t}<Rabisco /></span>
      ) : (
        <span key={i}>{s.t}</span>
      ))}
    </h2>
  );
}

/** Faixa-ticker marquee (CSS puro). Conteúdo duplicado pra emenda invisível. */
function Marquee({ itens, sep = '✕', className }: { itens: string[]; sep?: string; className?: string }) {
  const bloco = (dup: number) => (
    <div className="flex items-center" aria-hidden={dup === 1}>
      {itens.map((it, i) => (
        <span key={i} className="flex items-center">
          <span className="px-5 text-sm font-extrabold uppercase tracking-wider sm:text-base">{it}</span>
          <span className="px-1 opacity-60">{sep}</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className={cn('marquee', className)} aria-label={itens.join(', ')}>
      <div className="marquee__track">{bloco(0)}{bloco(1)}</div>
    </div>
  );
}

/** Item de lista com parêntese: frase principal em destaque + complemento suave. */
function TextoComComplemento({ texto, forte }: { texto: string; forte?: boolean }) {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(texto);
  if (!m) return <span className={forte ? 'font-semibold text-foreground' : 'text-muted-foreground'}>{texto}</span>;
  return (
    <>
      <span className="font-semibold text-foreground">{m[1]}</span>{' '}
      <span className="text-muted-foreground">({m[2]})</span>
    </>
  );
}

/**
 * Cupom fiscal (NFC-e) desenhado como recibo térmico — papel branco, fonte
 * monoespaçada, itens da loja demo, VALOR TOTAL, QR Code e borda serrilhada.
 * Cores fixas de propósito (representa papel impresso). Rotacionado ~3°.
 */
function CupomTermico() {
  // Zigue-zague da borda inferior (papel rasgado da bobina).
  const dentes = 26, prof = 7, largura = 300, passo = largura / dentes;
  let serra = 'M0 0';
  for (let i = 0; i < dentes; i++) serra += ` L${(i * passo + passo / 2).toFixed(1)} ${prof} L${(i + 1) * passo} 0`;
  serra += ' Z';

  return (
    <div className="relative mx-auto w-[280px] max-w-full [transform:rotate(3deg)]">
      <div className="absolute inset-0 -z-10 translate-y-6 scale-95 rounded-2xl bg-primary/20 blur-2xl" />
      <div className="js-cupom will-change-transform overflow-hidden rounded-t-md bg-white text-neutral-900 shadow-2xl">
        <div className="fonte-cupom px-5 py-5 text-[11px] leading-relaxed">
          <div className="js-cupom-linha text-center">
            <div className="text-[13px] font-bold tracking-tight">UNIMAXX — MOSTRUÁRIO</div>
            <div className="text-[10px] text-neutral-500">CNPJ 00.000.000/0001-00</div>
          </div>
          <div className="js-cupom-linha my-2 border-t border-dashed border-neutral-300" />
          <div className="js-cupom-linha text-center text-[10px] font-bold text-neutral-600">
            DANFE NFC-e — DOCUMENTO AUXILIAR<br />DA NOTA FISCAL DE CONSUMIDOR ELETRÔNICA
          </div>
          <div className="js-cupom-linha my-2 border-t border-dashed border-neutral-300" />
          {CUPOM_ITENS.map((it, i) => (
            <div key={i} className="js-cupom-linha flex justify-between gap-2">
              <span className="truncate">{it.q}x {it.nome}</span>
              <span className="shrink-0 tabular-nums">{it.v}</span>
            </div>
          ))}
          <div className="js-cupom-linha my-2 border-t border-dashed border-neutral-300" />
          <div className="js-cupom-linha flex justify-between text-[13px] font-bold">
            <span>VALOR TOTAL</span><span className="tabular-nums">R$ {CUPOM_TOTAL}</span>
          </div>
          <div className="js-cupom-linha mt-1 flex justify-between text-[10px] text-neutral-600">
            <span>FORMA PGTO</span><span>PIX</span>
          </div>
          <div className="js-cupom-linha my-2 border-t border-dashed border-neutral-300" />
          <div className="js-cupom-qr flex flex-col items-center gap-1.5">
            <QrCode className="size-24 text-neutral-900" strokeWidth={1.1} />
            <div className="text-center text-[9px] text-neutral-500">
              Consulte pela chave de acesso<br />
              <span className="tabular-nums">3526 0100 0000 0001 5500 1000 0000 0142 1098 7654 3210</span>
            </div>
          </div>
        </div>
      </div>
      {/* Borda serrilhada (papel rasgado) */}
      <svg viewBox={`0 0 ${largura} ${prof}`} preserveAspectRatio="none" className="block h-2 w-full drop-shadow-lg" aria-hidden="true">
        <path d={serra} fill="#ffffff" />
      </svg>
    </div>
  );
}

/* ───────────────────────── tema (claro/escuro) da landing ───────────────────────── */

const CHAVE_TEMA_LANDING = 'tema:landing';

function usarTemaLanding() {
  const [escuro, setEscuro] = useState(() => {
    const salvo = localStorage.getItem(CHAVE_TEMA_LANDING);
    if (salvo) return salvo === 'escuro';
    return matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const estadoAnteriorRef = useRef<boolean | null>(null);

  useEffect(() => {
    estadoAnteriorRef.current = document.documentElement.classList.contains('dark');
    return () => {
      if (estadoAnteriorRef.current !== null) {
        document.documentElement.classList.toggle('dark', estadoAnteriorRef.current);
        reaplicarPaletaTema();
      }
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', escuro);
    reaplicarPaletaTema();
    localStorage.setItem(CHAVE_TEMA_LANDING, escuro ? 'escuro' : 'claro');
  }, [escuro]);

  return { escuro, alternar: () => setEscuro(v => !v) };
}

function ToggleTemaLanding({ escuro, onClick }: { escuro: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent"
      aria-label={escuro ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
    >
      {escuro ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
    </button>
  );
}

/* ───────────────────────── página ───────────────────────── */

export function PaginaLanding() {
  const { marca } = useTema();
  const { escuro, alternar } = usarTemaLanding();
  const raiz = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  const recursos = marca.landing_recursos?.length ? marca.landing_recursos : RECURSOS_PADRAO;
  const beneficios = marca.landing_beneficios?.length ? marca.landing_beneficios : BENEFICIOS_PADRAO;
  const ctaTexto = marca.landing_cta_texto || 'Ver demonstração';
  const semLista = marca.landing_comparativo_sem?.length ? marca.landing_comparativo_sem : SEM_PADRAO;
  const comLista = marca.landing_comparativo_com?.length ? marca.landing_comparativo_com : COM_PADRAO;
  const segmentos = marca.landing_segmentos?.length ? marca.landing_segmentos : SEGMENTOS_PADRAO;
  const depoimentos: LandingDepoimento[] = marca.landing_depoimentos ?? [];
  const destaques = marca.landing_destaques?.length ? marca.landing_destaques : DESTAQUES_PADRAO;

  const heroEyebrow = marca.landing_hero_eyebrow || 'Sistema para deliveries e restaurantes';
  const heroTitulo = marca.landing_hero_titulo || 'Seu delivery rodando liso, do pedido à *nota fiscal*.';
  const heroSubtitulo = marca.landing_hero_subtitulo || 'Cardápio, pedidos, cozinha, PDV e NFC-e num sistema só. Cada loja com seu domínio e a sua cara.';
  const heroImagem = marca.landing_hero_imagem || '/landing/storefront-desktop.png';

  const demoUrlConfigurada = marca.landing_demo_url?.trim();
  const demo = useQuery({
    queryKey: ['landing-loja-demo'],
    queryFn: () => api<{ lojas: Loja[] }>('GET', '/api/lojas').then(r => r.lojas[0]),
    staleTime: 5 * 60_000,
    enabled: !demoUrlConfigurada,
  });

  const linkDemo = demoUrlConfigurada || (demo.data ? `/loja/${demo.data.id}` : undefined);
  const demoExterna = !!linkDemo && /^https?:\/\//i.test(linkDemo);

  // Botão de demo reutilizado no header, hero e CTA final.
  const BotaoDemo = ({ size, className }: { size: 'sm' | 'lg' | 'xl'; className?: string }) => (
    <Button size={size} className={className} asChild disabled={!linkDemo}>
      {!linkDemo ? <span>{ctaTexto}</span>
        : demoExterna ? <a href={linkDemo} target="_blank" rel="noreferrer">{ctaTexto} <ArrowRight className="h-4 w-4" /></a>
        : <Link to={linkDemo}>{ctaTexto} <ArrowRight className="h-4 w-4" /></Link>}
    </Button>
  );

  // Divide o título do hero em palavras (pra stagger) preservando o destaque.
  const heroSegs = segmentosTitulo(heroTitulo);

  useLayoutEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const q = gsap.utils.selector(el);

    const ctx = gsap.context(() => {
      // Nav ganha fundo sólido + borda ao rolar (independe de motion pref).
      ScrollTrigger.create({
        start: 'top -40',
        onUpdate: (self) => {
          const nav = navRef.current;
          if (!nav) return;
          const solida = self.scroll() > 40;
          ['bg-background/90', 'backdrop-blur', 'shadow-sm', 'border-border'].forEach(c => nav.classList.toggle(c, solida));
          nav.classList.toggle('border-transparent', !solida);
        },
      });

      const mm = gsap.matchMedia();

      // Movimento reduzido: sem timelines/loop, só fades curtos. Nada é
      // escondido em CSS, então tudo já está visível se isto não rodar.
      mm.add('(prefers-reduced-motion: reduce)', () => {
        q('[data-reveal]').forEach((s) => {
          gsap.from(s, { autoAlpha: 0, duration: 0.15, scrollTrigger: { trigger: s, start: 'top 85%' } });
        });
      });

      // Movimento normal.
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        // Estados iniciais (só aqui, nunca em CSS).
        gsap.set(navRef.current, { opacity: 0 });
        gsap.set(q('.js-hero-palavra'), { y: 24, opacity: 0 });
        gsap.set(q('.js-hero-rabisco path'), { drawSVG: '0%' });
        gsap.set(q('.js-hero-sub'), { y: 10, opacity: 0 });
        gsap.set(q('.js-hero-cta'), { scale: 0.9, opacity: 0 });
        gsap.set(q('.js-mockup'), { y: 80, opacity: 0 });
        gsap.set(q('.js-selo-nfce'), { scale: 0, rotation: -20, opacity: 0 });

        // Hero timeline.
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
        tl.to(navRef.current, { opacity: 1, duration: 0.3 })
          .to(q('.js-hero-palavra'), { y: 0, opacity: 1, stagger: 0.09, duration: 0.6 }, 0.05)
          .to(q('.js-hero-rabisco path'), { drawSVG: '100%', duration: 0.5 }, '-=0.25')
          .to(q('.js-hero-sub'), { y: 0, opacity: 1, stagger: 0.08, duration: 0.5 }, '-=0.3')
          .to(q('.js-hero-cta'), { scale: 1, opacity: 1, ease: 'back.out(1.4)', duration: 0.5 }, '-=0.2')
          .to(q('.js-mockup'), { y: 0, opacity: 1, ease: 'back.out(1.2)', duration: 0.9 }, '-=0.5')
          .to(q('.js-selo-nfce'), { scale: 1, rotation: -12, opacity: 1, ease: 'elastic.out(1, 0.5)', duration: 0.9 }, '-=0.5')
          .add(() => { gsap.to(q('.js-mockup'), { y: '+=6', duration: 3, yoyo: true, repeat: -1, ease: 'sine.inOut' }); });

        // Reveal genérico das seções.
        q('[data-reveal]').forEach((s) => {
          gsap.from(s, { y: 32, opacity: 0, duration: 0.5, ease: 'power3.out', scrollTrigger: { trigger: s, start: 'top 75%', toggleActions: 'play none none none' } });
        });

        // "Jeito antigo": riscos vermelhos desenhando (caneta riscando item a item).
        const riscos = q('.js-risco path');
        if (riscos.length) {
          gsap.set(riscos, { drawSVG: '0%' });
          ScrollTrigger.create({
            trigger: q('.js-antigo')[0], start: 'top 75%', once: true,
            onEnter: () => gsap.to(riscos, { drawSVG: '100%', stagger: 0.15, duration: 0.4, ease: 'power1.inOut' }),
          });
        }

        // "Jeito novo": checks laranja desenhando + pulse da caixa.
        const checks = q('.js-check-path'), caixas = q('.js-check-box');
        if (checks.length) {
          gsap.set(checks, { drawSVG: '0%' });
          ScrollTrigger.create({
            trigger: q('.js-novo')[0], start: 'top 75%', once: true,
            onEnter: () => {
              gsap.to(checks, { drawSVG: '100%', stagger: 0.12, duration: 0.35 });
              gsap.fromTo(caixas, { scale: 0.8 }, { scale: 1, stagger: 0.12, duration: 0.35, ease: 'back.out(2.5)' });
            },
          });
        }

        // Cupom: revela como saindo da impressora térmica (clipPath).
        const cupom = q('.js-cupom')[0];
        if (cupom) {
          gsap.set(cupom, { clipPath: 'inset(0 0 100% 0)' });
          gsap.set(q('.js-cupom-linha'), { opacity: 0, y: 6 });
          gsap.set(q('.js-cupom-qr'), { opacity: 0 });
          ScrollTrigger.create({
            trigger: cupom, start: 'top 78%', once: true,
            onEnter: () => {
              gsap.timeline()
                .to(cupom, { clipPath: 'inset(0 0 0% 0)', duration: 0.9, ease: 'power2.inOut' })
                .to(q('.js-cupom-linha'), { opacity: 1, y: 0, stagger: 0.1, duration: 0.3 }, 0.1)
                .to(q('.js-cupom-qr'), { opacity: 1, duration: 0.4 }, '-=0.1');
            },
          });
        }

        // Lista 01-06: linhas em stagger + divisórias crescendo da esquerda.
        const itens = q('.js-lista-item'), divs = q('.js-lista-div');
        if (itens.length) {
          gsap.set(itens, { opacity: 0, y: 16 });
          gsap.set(divs, { scaleX: 0, transformOrigin: 'left center' });
          ScrollTrigger.create({
            trigger: q('.js-lista')[0], start: 'top 75%', once: true,
            onEnter: () => {
              gsap.to(itens, { opacity: 1, y: 0, stagger: 0.08, duration: 0.4 });
              gsap.to(divs, { scaleX: 1, stagger: 0.08, duration: 0.4, delay: 0.05 });
            },
          });
        }

        // Selo "LOJA DEMO": rotação contínua, pausa no hover.
        const selo = q('.js-selo-demo')[0];
        if (selo) {
          const spin = gsap.to(selo, { rotation: 360, duration: 20, ease: 'none', repeat: -1 });
          selo.addEventListener('mouseenter', () => spin.pause());
          selo.addEventListener('mouseleave', () => spin.resume());
        }
      });
    }, el);

    // Recalcula posições após fontes/imagens carregarem.
    const refresh = () => ScrollTrigger.refresh();
    const t = window.setTimeout(refresh, 400);
    if (document.fonts?.ready) document.fonts.ready.then(refresh);
    window.addEventListener('load', refresh);

    return () => {
      ctx.revert();
      window.clearTimeout(t);
      window.removeEventListener('load', refresh);
    };
  }, []);

  return (
    <div ref={raiz} className="min-h-screen bg-background flex flex-col overflow-x-clip">
      {/* Header */}
      <header ref={navRef} className="sticky top-0 z-30 border-b border-transparent transition-colors duration-300">
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
            <ToggleTemaLanding escuro={escuro} onClick={alternar} />
            <Link to="/lojista" className="hidden px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground sm:block">
              Sou lojista
            </Link>
            <BotaoDemo size="sm" />
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" />
        <div className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 sm:py-24 lg:grid-cols-2">
          {/* Texto */}
          <div className="text-center lg:text-left">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
              <Store className="h-3.5 w-3.5" /> {heroEyebrow}
            </span>
            <h1 className="mt-5 text-[40px] font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              {heroSegs.map((seg, si) => (
                <span key={si} className={cn('relative inline', seg.d && 'text-primary')}>
                  {seg.t.split(/(\s+)/).map((w, wi) => (
                    /^\s+$/.test(w)
                      ? <span key={wi}> </span>
                      : <span key={wi} className="js-hero-palavra inline-block">{w}</span>
                  ))}
                  {seg.d && <Rabisco anima />}
                </span>
              ))}
            </h1>
            <p className="js-hero-sub mx-auto mt-5 max-w-xl text-lg text-muted-foreground lg:mx-0">
              {heroSubtitulo}
            </p>
            <div className="js-hero-cta mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <BotaoDemo size="xl" />
              <Button size="xl" variant="outline" asChild>
                <Link to="/lojista">Sou lojista, quero começar</Link>
              </Button>
            </div>
            <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground lg:justify-start">
              {beneficios.slice(0, 3).map(b => (
                <li key={b} className="js-hero-sub flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-primary" /> {b}
                </li>
              ))}
            </ul>
          </div>

          {/* Mockup torto + selo NFC-e (sangram pela borda da viewport) */}
          <div className="relative">
            <div className="mx-auto max-w-md lg:max-w-none lg:-rotate-6 lg:translate-x-10 lg:scale-110">
              <div className="js-mockup will-change-transform">
                <MockupNavegador src={heroImagem} nome={marca.nome} />
              </div>
            </div>
            <div className="js-selo-nfce absolute -left-2 -top-6 flex size-24 rotate-[-12deg] items-center justify-center rounded-full bg-primary text-center text-[10px] font-extrabold uppercase leading-tight tracking-wide text-primary-foreground shadow-xl sm:-left-4 lg:left-4">
              NFC-e<br />direto na<br />venda
            </div>
          </div>
        </div>
      </section>

      {/* Segmentos — faixa-ticker inclinada, fundo laranja */}
      <div className="relative overflow-hidden border-y border-border py-3">
        <div className="w-[104%] -translate-x-[2%] -rotate-2 bg-primary py-2.5 text-primary-foreground">
          <Marquee itens={segmentos.map(s => s.toUpperCase())} />
        </div>
      </div>

      {/* Diga adeus ao atendimento caótico */}
      <section data-reveal className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
        <TituloSecao texto="Diga adeus ao atendimento *caótico*" className="text-center text-3xl sm:text-4xl" />
        <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
          O futuro é integrado, rápido e automatizado.
        </p>

        <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          {/* Jeito antigo — riscos vermelhos */}
          <ul className="js-antigo space-y-4">
            <li className="text-sm font-bold uppercase tracking-wider text-muted-foreground">O jeito antigo</li>
            {semLista.map((item, i) => (
              <li key={i} className="relative w-fit text-base text-muted-foreground">
                <span>{item}</span>
                <svg className="js-risco pointer-events-none absolute left-0 top-1/2 h-3 w-full -translate-y-1/2 overflow-visible text-destructive" viewBox="0 0 200 8" fill="none" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M2 5 C 45 2, 90 7, 135 4 S 190 3, 198 5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </li>
            ))}
          </ul>

          {/* Faixa "O JEITO NOVO" inclinada (vertical no desktop, horizontal no mobile) */}
          <div className="overflow-hidden rounded-xl">
            <div className="-rotate-2 bg-primary py-2 text-primary-foreground lg:w-56">
              <Marquee itens={['O JEITO NOVO']} sep="✕" className="marquee--rapido" />
            </div>
          </div>

          {/* Jeito novo — checks laranja */}
          <ul className="js-novo space-y-4">
            <li className="text-sm font-bold uppercase tracking-wider text-primary">O jeito novo</li>
            {comLista.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-base">
                <span className="js-check-box mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-primary text-primary">
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
                    <path className="js-check-path" d="M4 12.5 L9.5 18 L20 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span><TextoComComplemento texto={item} forte /></span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Destaques (cliente pede pelo celular / loja com a sua cara) */}
      {destaques.length > 0 && (
        <section className="mx-auto max-w-6xl space-y-16 px-6 py-16 sm:space-y-24">
          {destaques.map((d, i) => (
            <div key={i} data-reveal className={cn('grid items-center gap-8 sm:grid-cols-2', i % 2 === 1 && 'sm:[&>*:first-child]:order-2')}>
              <div className="flex justify-center">
                {!d.imagem_url ? (
                  <div className="flex aspect-video w-full items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-accent/40">
                    <Receipt className="h-16 w-16 text-primary/40" />
                  </div>
                ) : d.formato === 'celular' ? (
                  <MolduraCelular src={d.imagem_url} flutuar />
                ) : d.formato === 'livre' ? (
                  <img src={d.imagem_url} alt={d.titulo} className="mx-auto max-h-[520px] w-auto rounded-2xl shadow-xl" />
                ) : (
                  <MockupNavegador src={d.imagem_url} nome={marca.nome} flutuar />
                )}
              </div>
              <div className="text-center sm:text-left">
                <TituloSecao texto={d.titulo} className="text-2xl sm:text-3xl" />
                <p className="mt-3 text-muted-foreground">{d.desc}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* NFC-e — assinatura visual da página */}
      <section data-reveal className="relative overflow-hidden py-16 sm:py-24">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-accent/20" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
              <Receipt className="h-3.5 w-3.5" /> Emissão fiscal
            </span>
            <TituloSecao texto="Cupom fiscal (NFC-e) *na hora da venda*" className="mt-5 text-3xl leading-tight sm:text-4xl" />
            <p className="mt-4 max-w-md text-muted-foreground">
              A nota sai com itens, total, chave de acesso e QR Code — direto do sistema, sem precisar de outro programa nem digitar os dados de novo.
            </p>

            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              {FISCAL_BULLETS.map(b => (
                <div key={b.titulo} className="flex gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <b.icone className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{b.titulo}</div>
                    <div className="text-xs text-muted-foreground">{b.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex items-center gap-3 rounded-2xl bg-primary/10 p-4">
              <ShieldCheck className="h-7 w-7 shrink-0 text-primary" />
              <div>
                <div className="text-sm font-bold">100% em conformidade com a SEFAZ</div>
                <div className="text-xs text-muted-foreground">Emissão segura, autorizada e sem complicação.</div>
              </div>
            </div>
          </div>

          {/* Cupom térmico + card flutuante de benefícios */}
          <div className="relative mx-auto">
            <CupomTermico />
            <div className="mt-8 grid grid-cols-2 gap-3 lg:absolute lg:-right-6 lg:top-6 lg:mt-0 lg:w-48 lg:grid-cols-1 lg:rounded-2xl lg:border lg:border-border lg:bg-card lg:p-4 lg:shadow-xl">
              {FISCAL_STATS.map(s => (
                <div key={s.titulo} className="flex items-start gap-2 rounded-xl border border-border bg-card p-2.5 lg:border-0 lg:bg-transparent lg:p-0">
                  <s.icone className="h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <div className="text-xs font-bold leading-tight">{s.titulo}</div>
                    <div className="hidden text-[10px] text-muted-foreground sm:block">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div data-reveal className="relative mx-auto mt-14 max-w-6xl px-6">
          <div className="flex flex-wrap items-center justify-between gap-5 rounded-2xl bg-primary/10 p-5">
            <div className="flex items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Receipt className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-bold">Mais agilidade, menos erros, mais controle.</div>
                <div className="text-xs text-muted-foreground">Emita NFC-e de forma simples, rápida e profissional.</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
              {['SAT / NFC-e', 'QR Code', 'Chave de acesso', 'Impressão automática'].map(t => (
                <span key={t} className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-primary" /> {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Recursos — lista numerada 01-06 */}
      <section data-reveal className="mx-auto max-w-4xl px-6 py-16">
        <TituloSecao texto="Tudo que uma operação de delivery *precisa*" className="text-center text-3xl sm:text-4xl" />
        <div className="js-lista mt-12">
          {recursos.map(({ titulo, desc }, i) => (
            <div key={titulo}>
              <div className="js-lista-item group flex items-baseline gap-5 rounded-xl px-3 py-5 transition-colors hover:bg-accent/40 sm:gap-8">
                <span className="w-12 shrink-0 text-2xl font-extrabold tabular-nums text-primary transition-transform duration-200 group-hover:translate-x-1 sm:text-3xl">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="flex-1">
                  <h3 className="text-lg font-bold sm:text-xl">{titulo}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                </div>
              </div>
              {i < recursos.length - 1 && <div className="js-lista-div h-px bg-border" />}
            </div>
          ))}
        </div>
      </section>

      {/* Depoimentos (opcional, vindos do admin) */}
      {depoimentos.length > 0 && (
        <section data-reveal className="border-t border-border bg-muted/30 py-16">
          <div className="mx-auto max-w-6xl px-6">
            <TituloSecao texto="Sucesso comprovado contado por *quem usa*" className="text-center text-2xl sm:text-3xl" />
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {depoimentos.map((d, i) => (
                <div key={i} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                  <Quote className="h-5 w-5 text-primary" />
                  <p className="mt-3 text-sm text-muted-foreground">{d.texto}</p>
                  <div className="mt-4 text-sm font-semibold">{d.nome}</div>
                  {d.negocio && <div className="text-xs text-muted-foreground">{d.negocio}</div>}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA final */}
      <section data-reveal className="relative border-t border-border bg-accent/40">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center sm:py-20">
          <div className="relative inline-block">
            <TituloSecao texto="Quer ver funcionando *na prática*?" className="text-2xl sm:text-3xl" />
            {/* Selo giratório "LOJA DEMO" */}
            <div className="js-selo-demo pointer-events-auto absolute -right-16 -top-12 hidden size-24 place-items-center rounded-full border-2 border-dashed border-primary text-center text-[10px] font-extrabold uppercase tracking-widest text-primary sm:grid">
              Loja<br />demo
            </div>
          </div>
          <p className="mt-3 text-muted-foreground">
            Explore uma loja de demonstração completa — cardápio, carrinho e checkout de verdade.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <BotaoDemo size="lg" />
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
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 sm:grid-cols-3">
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
                <li>{demoExterna
                  ? <a href={linkDemo} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">Ver demonstração</a>
                  : <Link to={linkDemo} className="text-muted-foreground hover:text-foreground">Ver demonstração</Link>}</li>
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
