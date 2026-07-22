/**
 * Landing page do produto (SaaS "Maxx Delivery") — domínio principal, quando
 * não há loja padrão configurada (ver marca.loja_id em useTema). Vende a
 * PLATAFORMA, com "Ver demonstração" apontando pra uma loja de exemplo.
 *
 * CORES: 100% dos tokens do tema (`primary`, `background`, `foreground`,
 * `card`, `muted`, `accent`, `border`...), editáveis no admin → Marca. NUNCA
 * hex de marca aqui. As ÚNICAS cores fixas permitidas: o verde do WhatsApp
 * (#25d366, convenção universal do app) e o papel branco/preto do CUPOM
 * (representa um recibo térmico impresso de verdade).
 *
 * ANIMAÇÃO: GSAP + ScrollTrigger + DrawSVGPlugin, PROGRESSIVE ENHANCEMENT —
 * nada é escondido em CSS; os estados iniciais só existem via gsap.set() dentro
 * do matchMedia 'no-preference'. Se o JS falhar, tudo aparece visível. Reveals
 * são fail-open: clearProps ao terminar + um fail-safe por timeout que força
 * qualquer elemento ainda invisível E dentro da viewport a aparecer. Respeita
 * prefers-reduced-motion.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import {
  Store, Smartphone, Bike, ChefHat, Palette, Receipt, ArrowRight, Check, Star,
  Shield, ShieldCheck, Users, Mail, Phone, Printer, QrCode, KeyRound, Cloud,
  BarChart3, Sun, Moon, Menu, X, ChevronDown, Lock, MapPin, type LucideIcon,
} from 'lucide-react';
import { useTema, reaplicarPaletaTema } from '@/lib/tema';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Loja, LandingRecurso, LandingIcone, LandingPlano, LandingFaq } from '@/types';

gsap.registerPlugin(ScrollTrigger, DrawSVGPlugin);

/* ───────────────────────── ícones + defaults ───────────────────────── */

/** Mapa de ícones disponíveis pro admin escolher na edição da landing. */
export const ICONES_LANDING: Record<LandingIcone, LucideIcon> = {
  store: Store, palette: Palette, bike: Bike, chefhat: ChefHat, receipt: Receipt,
  smartphone: Smartphone, check: Check, star: Star, shield: Shield, users: Users,
};

const RECURSOS_PADRAO: LandingRecurso[] = [
  { icone: 'store', titulo: 'Multi-lojas', desc: 'Cada loja com painel, cardápio e domínio próprios.' },
  { icone: 'palette', titulo: 'White label', desc: 'Cores, logo e visual totalmente do jeito da sua marca.' },
  { icone: 'bike', titulo: 'Rastreio ao vivo', desc: 'Entregador com GPS em tempo real, do jeito que o cliente vê no mapa.' },
  { icone: 'chefhat', titulo: 'Cozinha (KDS)', desc: 'Painel de produção próprio, sem misturar com o financeiro.' },
  { icone: 'receipt', titulo: 'NFC-e integrada', desc: 'Emissão fiscal direto na venda, sem depender de outro sistema.' },
  { icone: 'smartphone', titulo: 'PDV + Comandas', desc: 'Venda no balcão e mesas do salão, tudo no mesmo lugar.' },
];

const BENEFICIOS_PADRAO = ['Sem taxa de setup', 'Cada loja com domínio próprio', 'Suporte a Pix, cartão e dinheiro'];
const SEM_PADRAO = ['Desorganização no atendimento', 'Falhas de comunicação', 'Erros nos pedidos', 'Nota fiscal em outro programa'];
const COM_PADRAO = [
  'Agilidade e organização (pedido entra e já aparece na cozinha)',
  'Cada loja com sua operação (painel, cardápio e domínio próprios)',
  'Menos erro, mais venda (nada de anotar pedido no papel)',
  'Cupom fiscal na hora (NFC-e sai junto com a venda, direto na SEFAZ)',
];
const SEGMENTOS_PADRAO = ['Pizzaria', 'Hamburgueria', 'Açaiteria', 'Padaria', 'Sorveteria', 'Sushiteria', 'Cafeteria', 'Marmitaria'];

const STATS_PADRAO = [
  { numero: '2 min', texto: 'do pedido à cozinha' },
  { numero: '100%', texto: 'NFC-e autorizada na SEFAZ' },
  { numero: '0', texto: 'taxa por pedido' },
  { numero: '1 dia', texto: 'para a loja ficar no ar' },
];

const FISCAL_MINI: { icone: LucideIcon; titulo: string; desc: string }[] = [
  { icone: Printer, titulo: 'Emissão automática', desc: 'NFC-e sai na finalização do pedido.' },
  { icone: QrCode, titulo: 'QR Code', desc: 'Consulta rápida pelo consumidor.' },
  { icone: KeyRound, titulo: 'Chave de acesso', desc: 'Válida em qualquer portal da SEFAZ.' },
  { icone: Cloud, titulo: 'Impressão', desc: 'Compatível com térmicas 80/58mm.' },
];

const PLANOS_PADRAO: LandingPlano[] = [
  { nome: 'Iniciante', preco: 'R$ 97/mês', cta: 'Começar agora', recursos: ['1 loja com domínio próprio', 'Cardápio digital ilimitado', 'Pedidos, cozinha e PDV', 'Pix, cartão e dinheiro', 'Suporte por WhatsApp'] },
  { nome: 'Profissional', preco: 'R$ 197/mês', destaque: true, cta: 'Assinar Profissional', recursos: ['Tudo do Iniciante', 'NFC-e integrada (nota na venda)', 'Rastreio de entregador ao vivo', 'Comandas e mesas do salão', 'Relatórios completos', 'Suporte prioritário'] },
  { nome: 'Multi-lojas', preco: 'Sob consulta', cta: 'Falar com a gente', recursos: ['Várias lojas num painel só', 'Cada loja com sua marca e domínio', 'Gestão centralizada', 'Onboarding assistido', 'Gerente de conta dedicado'] },
];

const FAQ_PADRAO: LandingFaq[] = [
  { pergunta: 'Preciso de CNPJ pra usar?', resposta: 'Pra vender e emitir NFC-e, sim (a nota exige CNPJ e certificado A1). Mas você pode montar o cardápio e testar tudo antes de decidir.' },
  { pergunta: 'Em quanto tempo minha loja fica no ar?', resposta: 'No mesmo dia. Você cadastra os produtos, define cores e logo, e já compartilha o link da sua loja com os clientes.' },
  { pergunta: 'Vocês cobram taxa por pedido?', resposta: 'Não. Você paga só a mensalidade do plano — nenhuma comissão por venda. O que você fatura é seu.' },
  { pergunta: 'Tem fidelidade ou multa de cancelamento?', resposta: 'Não. Sem contrato de fidelidade e sem multa. Você cancela quando quiser.' },
  { pergunta: 'Funciona com a minha impressora?', resposta: 'Sim. Somos compatíveis com as principais impressoras térmicas do mercado (80mm e 58mm), pro cupom e pro DANFE da NFC-e.' },
];

const CUPOM_ITENS = [
  { q: 1, nome: 'X-SALADA ARTESANAL', v: '28,00' },
  { q: 1, nome: 'PORCAO BATATA RUSTICA', v: '16,00' },
  { q: 2, nome: 'REFRIGERANTE LATA', v: '12,00' },
];
const CUPOM_TOTAL = '56,00';

const WHATSAPP_VERDE = '#25d366'; // única cor de marca fixa: convenção universal do WhatsApp.

/* ───────────────────────── helpers de UI ───────────────────────── */

/** Ícone do WhatsApp (glifo oficial simplificado). */
function IconeWhatsapp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.372-.025-.521-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

/** Sublinhado "rabisco à mão" (SVG irregular) sob a palavra-chave do título. */
function Rabisco({ anima, className }: { anima?: boolean; className?: string }) {
  return (
    <svg
      className={cn('pointer-events-none absolute -bottom-1 left-0 h-[0.42em] w-full overflow-visible text-primary', anima && 'js-rabisco', className)}
      viewBox="0 0 300 16" fill="none" preserveAspectRatio="none" aria-hidden="true"
    >
      <path d="M3 11 C 55 3, 105 15, 152 8 S 245 3, 297 10" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
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

/** Headline de seção com palavra-chave em primary + rabisco. */
function TituloSecao({ texto, className }: { texto: string; className?: string }) {
  return (
    <h2 className={cn('font-black tracking-tight text-foreground', className)}>
      {segmentosTitulo(texto).map((s, i) => s.d ? (
        <span key={i} className="relative inline-block text-primary">{s.t}<Rabisco /></span>
      ) : <span key={i}>{s.t}</span>)}
    </h2>
  );
}

/** Frase principal em destaque + complemento entre parênteses esmaecido. */
function TextoComComplemento({ texto }: { texto: string }) {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(texto);
  if (!m) return <span className="font-semibold text-foreground">{texto}</span>;
  return (
    <>
      <span className="font-semibold text-foreground">{m[1]}</span>{' '}
      <span className="text-muted-foreground">({m[2]})</span>
    </>
  );
}

/** Marquee reto (CSS puro), conteúdo duplicado pra emenda invisível. */
function MarqueeSegmentos({ itens }: { itens: string[] }) {
  const bloco = (dup: number) => (
    <div className="flex items-center" aria-hidden={dup === 1}>
      {itens.map((it, i) => (
        <span key={i} className="flex items-center">
          <span className="px-6 text-sm font-bold uppercase tracking-[0.2em] sm:text-base">{it}</span>
          <span className="text-primary">•</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className="marquee" aria-label={itens.join(', ')}>
      <div className="marquee__track">{bloco(0)}{bloco(1)}</div>
    </div>
  );
}

/**
 * Cupom fiscal (NFC-e) desenhado como recibo térmico — papel branco, fonte
 * monoespaçada, borda serrilhada. Cores fixas de propósito (papel impresso).
 */
function CupomTermico() {
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
      <svg viewBox={`0 0 ${largura} ${prof}`} preserveAspectRatio="none" className="block h-2 w-full drop-shadow-lg" aria-hidden="true">
        <path d={serra} fill="#ffffff" />
      </svg>
    </div>
  );
}

/**
 * Notebook do hero: tela com moldura escura + barra de navegador (cadeado +
 * domínio) e base metálica. `.js-notebook-screen` é o alvo do lid-open/tilt.
 */
function NotebookHero({ src, nome }: { src?: string; nome: string }) {
  // Domínio real da página (não inventado) — evita mostrar algo tipo
  // "nomedaLoja.com.br" quando o domínio de verdade é outro (.app.br etc.).
  const dominio = typeof window !== 'undefined' && window.location.host
    ? window.location.host
    : (nome ? `${nome.toLowerCase().replace(/\s+/g, '')}.com.br` : 'seudelivery.com.br');
  return (
    <div className="[perspective:1400px]">
      <div className="js-notebook-screen [transform-style:preserve-3d]">
        {/* moldura escura */}
        <div className="rounded-t-2xl border-[10px] border-b-[14px] border-neutral-900 bg-neutral-900 shadow-2xl [background:linear-gradient(160deg,theme(colors.neutral.700),theme(colors.neutral.900))]">
          {/* barra de navegador */}
          <div className="flex items-center gap-2 rounded-t-lg bg-neutral-800 px-3 py-2">
            <span className="size-2.5 rounded-full bg-red-400/90" />
            <span className="size-2.5 rounded-full bg-yellow-400/90" />
            <span className="size-2.5 rounded-full bg-green-400/90" />
            <div className="ml-2 flex flex-1 items-center gap-1.5 rounded-md bg-neutral-900/70 px-2.5 py-1 text-[11px] text-neutral-300">
              <Lock className="size-3 text-green-400" />
              <span className="truncate">{dominio}</span>
            </div>
          </div>
          {/* conteúdo */}
          <div className="overflow-hidden bg-background">
            {src ? (
              <img src={src} alt="Prévia do painel da loja" className="w-full object-cover object-top" />
            ) : (
              <div className="flex aspect-[16/10] flex-col items-center justify-center gap-3 bg-gradient-to-br from-primary/5 to-muted text-muted-foreground">
                <Store className="h-12 w-12 opacity-30" />
                <span className="text-xs">Prévia do painel</span>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* base metálica */}
      <div className="relative mx-auto h-3 w-[112%] -translate-x-[5%] rounded-b-xl [background:linear-gradient(180deg,theme(colors.neutral.400),theme(colors.neutral.600))] shadow-lg">
        <div className="absolute left-1/2 top-0 h-1.5 w-24 -translate-x-1/2 rounded-b-lg bg-neutral-700/80" />
      </div>
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

  useLayoutEffect(() => {
    estadoAnteriorRef.current = document.documentElement.classList.contains('dark');
    return () => {
      if (estadoAnteriorRef.current !== null) {
        document.documentElement.classList.toggle('dark', estadoAnteriorRef.current);
        reaplicarPaletaTema();
      }
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', escuro);
    reaplicarPaletaTema();
    localStorage.setItem(CHAVE_TEMA_LANDING, escuro ? 'escuro' : 'claro');
  }, [escuro]);

  return { escuro, alternar: () => setEscuro(v => !v) };
}

/* ───────────────────────── página ───────────────────────── */

const ANCORAS = [
  { href: '#recursos', label: 'Recursos' },
  { href: '#nota-fiscal', label: 'Nota fiscal' },
  { href: '#planos', label: 'Planos' },
  { href: '#duvidas', label: 'Dúvidas' },
];

export function PaginaLanding() {
  const { marca } = useTema();
  const { escuro, alternar } = usarTemaLanding();
  const raiz = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [menuAberto, setMenuAberto] = useState(false);

  const recursos = marca.landing_recursos?.length ? marca.landing_recursos : RECURSOS_PADRAO;
  const beneficios = marca.landing_beneficios?.length ? marca.landing_beneficios : BENEFICIOS_PADRAO;
  const ctaTexto = marca.landing_cta_texto || 'Ver demonstração';
  const semLista = marca.landing_comparativo_sem?.length ? marca.landing_comparativo_sem : SEM_PADRAO;
  const comLista = marca.landing_comparativo_com?.length ? marca.landing_comparativo_com : COM_PADRAO;
  const segmentos = marca.landing_segmentos?.length ? marca.landing_segmentos : SEGMENTOS_PADRAO;
  const planos = marca.landing_planos?.length ? marca.landing_planos : PLANOS_PADRAO;
  const faq = marca.landing_faq?.length ? marca.landing_faq : FAQ_PADRAO;

  const heroEyebrow = marca.landing_hero_eyebrow || 'Sistema para deliveries e restaurantes';
  const heroTitulo = marca.landing_hero_titulo || 'Seu delivery rodando liso, do pedido à *nota fiscal*.';
  const heroSubtitulo = marca.landing_hero_subtitulo || 'Cardápio, pedidos, cozinha, PDV e NFC-e num sistema só. Cada loja com seu domínio e a sua cara.';
  const heroImagem = marca.landing_hero_imagem || '/landing/storefront-desktop.png';
  const heroImagemMobile = marca.landing_hero_imagem_mobile || '/landing/storefront-mobile.png';

  // Link do WhatsApp (número editável no admin; cai no suporte_telefone).
  const zapDigitos = (marca.landing_whatsapp || marca.suporte_telefone || '').replace(/\D/g, '');
  const zapNum = zapDigitos ? (zapDigitos.length <= 11 ? '55' + zapDigitos : zapDigitos) : '';
  const linkZap = (msg?: string) => zapNum ? `https://wa.me/${zapNum}${msg ? `?text=${encodeURIComponent(msg)}` : ''}` : undefined;

  // Link da loja de demonstração (URL fixa do admin OU a 1ª loja aprovada do tenant).
  const demoUrlConfigurada = marca.landing_demo_url?.trim();
  const demo = useQuery({
    queryKey: ['landing-loja-demo'],
    queryFn: () => api<{ lojas: Loja[] }>('GET', '/api/lojas').then(r => r.lojas[0]),
    staleTime: 5 * 60_000,
    enabled: !demoUrlConfigurada,
  });
  const linkDemo = demoUrlConfigurada || (demo.data ? `/${demo.data.id}` : undefined);
  const demoExterna = !!linkDemo && /^https?:\/\//i.test(linkDemo);

  /**
   * Botão "Ver demonstração". Corrige o bug antigo (disabled + asChild não
   * funciona: o Slot repassa `disabled` pra um <a>/<Link>, que ignora). Quando
   * não há link, renderiza um <button disabled> de verdade.
   */
  const BotaoDemo = ({ size, variant, className, texto }: { size: 'sm' | 'lg' | 'xl'; variant?: 'primary' | 'branco'; className?: string; texto?: string }) => {
    const alturas = { sm: 'h-9 px-4 text-xs rounded-xl', lg: 'h-12 px-7 text-base rounded-2xl', xl: 'h-14 px-8 text-base rounded-2xl' };
    const cor = variant === 'branco'
      ? 'bg-background text-foreground hover:bg-background/90'
      : 'bg-primary text-primary-foreground hover:bg-primary/90';
    const base = cn('inline-flex items-center justify-center gap-2 font-semibold shadow-sm transition-all active:scale-[0.98]', alturas[size], cor, className);
    const conteudo = <>{texto || ctaTexto} <ArrowRight className="size-4" /></>;
    if (!linkDemo) return <button type="button" disabled className={cn(base, 'cursor-not-allowed opacity-50')}>{texto || ctaTexto}</button>;
    if (demoExterna) return <a href={linkDemo} target="_blank" rel="noreferrer" className={base}>{conteudo}</a>;
    return <Link to={linkDemo} className={base}>{conteudo}</Link>;
  };

  /** Botão do WhatsApp (cai pro /lojista quando não há número). */
  const BotaoZap = ({ size, texto, msg, className }: { size: 'sm' | 'lg' | 'xl'; texto: string; msg?: string; className?: string }) => {
    const alturas = { sm: 'h-9 px-4 text-xs rounded-xl', lg: 'h-12 px-7 text-base rounded-2xl', xl: 'h-14 px-8 text-base rounded-2xl' };
    const base = cn('inline-flex items-center justify-center gap-2 border border-input bg-background font-semibold text-foreground transition-all hover:bg-accent active:scale-[0.98]', alturas[size], className);
    const conteudo = <><IconeWhatsapp className="size-[1.1em]" /> {texto}</>;
    const href = linkZap(msg);
    if (href) return <a href={href} target="_blank" rel="noreferrer" className={base}>{conteudo}</a>;
    return <Link to="/lojista" className={base}>{texto}</Link>;
  };

  const heroSegs = segmentosTitulo(heroTitulo);

  useLayoutEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const q = gsap.utils.selector(el);
    const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const limpezas: Array<() => void> = [];

    // Reveal robusto via IntersectionObserver (dispara em QUALQUER scroll — real
    // ou programático — sem depender de eventos que o ScrollTrigger às vezes
    // perde). Roda a animação uma vez quando o elemento entra na viewport.
    const aoVer = (alvo: Element | null | undefined, fn: () => void) => {
      if (!alvo) return;
      const io = new IntersectionObserver((entradas, obs) => {
        entradas.forEach(e => { if (e.isIntersecting) { fn(); obs.disconnect(); } });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
      io.observe(alvo);
      limpezas.push(() => io.disconnect());
    };

    const ctx = gsap.context(() => {
      // Nav: fundo translúcido + blur ao rolar (listener direto, sempre confiável).
      const aoRolar = () => {
        const nav = navRef.current;
        if (!nav) return;
        const solida = window.scrollY > 20;
        ['bg-background/80', 'backdrop-blur-md', 'shadow-sm', 'border-border'].forEach(c => nav.classList.toggle(c, solida));
        nav.classList.toggle('border-transparent', !solida);
      };
      window.addEventListener('scroll', aoRolar, { passive: true });
      aoRolar();
      limpezas.push(() => window.removeEventListener('scroll', aoRolar));

      // Movimento reduzido: nada é escondido — tudo já visível, sem animação.
      if (reduzido) return;

      // ── Estados iniciais (SÓ via JS; se algo falhar, o fail-safe revela) ──
      gsap.set(navRef.current, { opacity: 0 });
      gsap.set(q('.js-hero-item'), { y: 22, opacity: 0 });
      gsap.set(q('.js-rabisco path'), { drawSVG: '0%' });
      gsap.set(q('.js-notebook-screen'), { rotationX: -32, y: 40, opacity: 0, transformOrigin: '50% 100%', transformPerspective: 1400 });
      gsap.set(q('.js-hero-phone'), { y: 60, opacity: 0, scale: 0.85 });

      // ── Hero timeline (na montagem) ──
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.to(navRef.current, { opacity: 1, duration: 0.3 })
        .to(q('.js-hero-item'), { y: 0, opacity: 1, stagger: 0.09, duration: 0.6 }, 0.05)
        .to(q('.js-rabisco path'), { drawSVG: '100%', duration: 0.5 }, '-=0.3')
        .to(q('.js-notebook-screen'), { rotationX: 0, y: 0, opacity: 1, duration: 1, ease: 'power2.out' }, '-=0.7')
        .to(q('.js-hero-phone'), { y: 0, opacity: 1, scale: 1, ease: 'back.out(1.5)', duration: 0.7 }, '-=0.4')
        .add(() => { gsap.to(q('.js-hero-phone'), { y: '-=10', duration: 2.4, yoyo: true, repeat: -1, ease: 'sine.inOut' }); });

      // ── Tilt 3D no mousemove (notebook + celular parallax) ──
      const palco = q('.js-hero-palco')[0] as HTMLElement | undefined;
      const tela = q('.js-notebook-screen')[0];
      const fone = q('.js-hero-phone')[0];
      if (palco && tela && fone) {
        const rY = gsap.quickTo(tela, 'rotationY', { duration: 0.5, ease: 'power2.out' });
        const rX = gsap.quickTo(tela, 'rotationX', { duration: 0.5, ease: 'power2.out' });
        const fX = gsap.quickTo(fone, 'x', { duration: 0.5, ease: 'power2.out' });
        const fY = gsap.quickTo(fone, 'y', { duration: 0.5, ease: 'power2.out' });
        const fR = gsap.quickTo(fone, 'rotation', { duration: 0.5, ease: 'power2.out' });
        const mover = (e: MouseEvent) => {
          const r = palco.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width - 0.5;
          const py = (e.clientY - r.top) / r.height - 0.5;
          rY(px * 18); rX(-py * 18);          // ±9°
          fX(px * 40); fY(py * 30); fR(px * 6);
        };
        const sair = () => { rY(0); rX(0); fX(0); fY(0); fR(0); };
        palco.addEventListener('mousemove', mover);
        palco.addEventListener('mouseleave', sair);
      }

      // ── Reveal genérico das seções ──
      q('[data-reveal]').forEach((s) => {
        gsap.set(s, { y: 34, opacity: 0 });
        aoVer(s, () => gsap.to(s, { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out', clearProps: 'transform' }));
      });

      // ── "Jeito antigo": riscos desenhando ──
      const riscos = q('.js-risco path');
      if (riscos.length) {
        gsap.set(riscos, { drawSVG: '0%' });
        aoVer(q('.js-antigo')[0], () => gsap.to(riscos, { drawSVG: '100%', stagger: 0.14, duration: 0.4, ease: 'power1.inOut' }));
      }

      // ── "Jeito novo": checks desenhando + pulse ──
      const checks = q('.js-check-path'), caixas = q('.js-check-box');
      if (checks.length) {
        gsap.set(checks, { drawSVG: '0%' });
        aoVer(q('.js-novo')[0], () => {
          gsap.to(checks, { drawSVG: '100%', stagger: 0.11, duration: 0.35 });
          gsap.fromTo(caixas, { scale: 0.8 }, { scale: 1, stagger: 0.11, duration: 0.35, ease: 'back.out(2.5)' });
        });
      }

      // ── Stats em stagger ──
      const stats = q('.js-stat');
      if (stats.length) {
        gsap.set(stats, { y: 20, opacity: 0 });
        aoVer(q('.js-stats')[0], () => gsap.to(stats, { y: 0, opacity: 1, stagger: 0.1, duration: 0.5, ease: 'back.out(1.4)' }));
      }

      // ── Celular "pede pelo celular": desliza da esquerda + cards flutuam ──
      const foneSec = q('.js-fone-sec')[0], cardsFone = q('.js-fone-card');
      if (foneSec) {
        gsap.set(foneSec, { x: -60, opacity: 0 });
        gsap.set(cardsFone, { scale: 0.7, opacity: 0 });
        aoVer(foneSec, () => {
          gsap.to(foneSec, { x: 0, opacity: 1, duration: 0.7, ease: 'power3.out', clearProps: 'transform' });
          gsap.to(cardsFone, { scale: 1, opacity: 1, stagger: 0.15, delay: 0.25, duration: 0.5, ease: 'back.out(2)' });
          gsap.to(cardsFone, { y: '-=8', duration: 2.2, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 0.9 });
        });
      }

      // ── Cupom saindo da impressora (clipPath) + linhas em stagger ──
      const cupom = q('.js-cupom')[0];
      if (cupom) {
        gsap.set(cupom, { clipPath: 'inset(0 0 100% 0)' });
        gsap.set(q('.js-cupom-linha'), { opacity: 0, y: 6 });
        gsap.set(q('.js-cupom-qr'), { opacity: 0 });
        aoVer(cupom, () => {
          gsap.timeline()
            .to(cupom, { clipPath: 'inset(0 0 0% 0)', duration: 0.9, ease: 'power2.inOut' })
            .to(q('.js-cupom-linha'), { opacity: 1, y: 0, stagger: 0.09, duration: 0.3 }, 0.1)
            .to(q('.js-cupom-qr'), { opacity: 1, duration: 0.4 }, '-=0.1');
        });
      }

      // ── Lista 01-06 ──
      const litens = q('.js-lista-item'), divs = q('.js-lista-div');
      if (litens.length) {
        gsap.set(litens, { opacity: 0, y: 16 });
        gsap.set(divs, { scaleX: 0, transformOrigin: 'left center' });
        aoVer(q('.js-lista')[0], () => {
          gsap.to(litens, { opacity: 1, y: 0, stagger: 0.08, duration: 0.4 });
          gsap.to(divs, { scaleX: 1, stagger: 0.08, duration: 0.4, delay: 0.05 });
        });
      }

      // ── Mascote do CTA final ──
      const mascote = q('.js-mascote')[0];
      if (mascote) {
        gsap.set(mascote, { y: 40, opacity: 0 });
        aoVer(mascote, () => gsap.to(mascote, { y: 0, opacity: 1, duration: 0.7, ease: 'back.out(1.4)' }));
      }
    }, el);

    // FAIL-SAFE: nada pode ficar preso invisível. Após 3.5s, qualquer elemento
    // ainda escondido (opacity 0 ou visibility hidden) é forçado a aparecer, e
    // os traços SVG são completados — cobre qualquer falha do IO/GSAP.
    const failsafe = window.setTimeout(() => {
      el.querySelectorAll<HTMLElement>('.js-hero-item,.js-notebook-screen,.js-hero-phone,[data-reveal],.js-stat,.js-lista-item,.js-lista-div,.js-fone-sec,.js-fone-card,.js-cupom,.js-cupom-linha,.js-cupom-qr,.js-mascote').forEach((n) => {
        const cs = getComputedStyle(n);
        if (cs.opacity === '0' || cs.visibility === 'hidden') gsap.set(n, { clearProps: 'opacity,visibility,transform,clipPath' });
      });
      q('.js-check-path,.js-risco path').forEach(p => gsap.set(p, { drawSVG: '100%' }));
    }, 3500);

    return () => {
      ctx.revert();
      limpezas.forEach(fn => fn());
      window.clearTimeout(failsafe);
    };
  }, []);

  return (
    <div ref={raiz} className="min-h-screen bg-background text-foreground flex flex-col overflow-x-clip">
      {/* ───── Header sticky ───── */}
      <header ref={navRef} className="sticky top-0 z-40 border-b border-transparent transition-colors duration-300">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-6">
          <a href="#topo" className="flex items-center gap-2 min-w-0">
            {marca.logo_url ? (
              <img src={marca.logo_url} alt={marca.nome} className="h-8 w-auto" />
            ) : (
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Store className="h-4 w-4" /></div>
            )}
            <span className="truncate font-extrabold">{marca.nome}</span>
          </a>

          <nav className="hidden items-center gap-1 lg:flex">
            {ANCORAS.map(a => (
              <a key={a.href} href={a.href} className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">{a.label}</a>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
            <button
              onClick={alternar}
              className="inline-flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent"
              aria-label={escuro ? 'Modo claro' : 'Modo escuro'}
            >
              {escuro ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
            </button>
            <Link to="/lojista" className="hidden px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground sm:block">Sou lojista</Link>
            <div className="hidden sm:block"><BotaoDemo size="sm" /></div>
            <button onClick={() => setMenuAberto(v => !v)} className="inline-flex size-9 items-center justify-center rounded-full text-foreground hover:bg-accent lg:hidden" aria-label="Menu">
              {menuAberto ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
        {/* Menu mobile */}
        {menuAberto && (
          <div className="border-t border-border bg-background px-5 py-3 lg:hidden">
            <div className="flex flex-col gap-1">
              {ANCORAS.map(a => (
                <a key={a.href} href={a.href} onClick={() => setMenuAberto(false)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">{a.label}</a>
              ))}
              <Link to="/lojista" onClick={() => setMenuAberto(false)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Sou lojista</Link>
              <div className="pt-1"><BotaoDemo size="sm" className="w-full" /></div>
            </div>
          </div>
        )}
      </header>

      {/* ───── Hero ───── */}
      <section id="topo" className="bg-background">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-14 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-8">
          {/* Texto */}
          <div className="text-center lg:text-left">
            <p className="js-hero-item text-sm font-bold uppercase tracking-widest text-primary">{heroEyebrow}</p>
            <h1 className="mt-4 text-[38px] font-black leading-[1.04] tracking-tight sm:text-5xl lg:text-[52px]">
              {heroSegs.map((seg, si) => (
                <span key={si} className={cn('js-hero-item relative inline', seg.d && 'text-primary')}>
                  {seg.t}{seg.d && <Rabisco anima />}
                </span>
              ))}
            </h1>
            <p className="js-hero-item mx-auto mt-5 max-w-xl text-lg text-muted-foreground lg:mx-0">{heroSubtitulo}</p>
            <div className="js-hero-item mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center lg:justify-start">
              <BotaoDemo size="xl" className="bg-foreground text-background hover:bg-foreground/90" />
              <BotaoZap size="xl" texto="Falar no WhatsApp" msg="Olá! Quero saber mais sobre o sistema de delivery." />
            </div>
            <ul className="js-hero-item mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground lg:justify-start">
              {beneficios.slice(0, 3).map(b => (
                <li key={b} className="flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" /> {b}</li>
              ))}
            </ul>
          </div>

          {/* Notebook + celular (palco do tilt 3D) */}
          <div className="js-hero-palco relative mx-auto w-full max-w-[560px]">
            <div className="js-hero-item">
              <NotebookHero src={heroImagem} nome={marca.nome} />
            </div>
            {/* Celular sobreposto */}
            <div className="js-hero-phone absolute -bottom-8 -right-1 w-[128px] will-change-transform sm:w-[150px] sm:-right-4">
              <div className="rounded-[1.6rem] border-[5px] border-neutral-900 bg-neutral-900 shadow-2xl">
                <div className="relative overflow-hidden rounded-[1.2rem] bg-background">
                  <div className="absolute left-1/2 top-1 z-10 h-2.5 w-12 -translate-x-1/2 rounded-b-xl bg-neutral-900" />
                  {heroImagemMobile ? (
                    <img src={heroImagemMobile} alt="Prévia no celular" className="w-full object-cover object-top" />
                  ) : (
                    <div className="flex aspect-[9/19] items-center justify-center bg-muted"><Smartphone className="h-8 w-8 text-muted-foreground/40" /></div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───── Faixa de segmentos (marquee reto, fundo escuro) ───── */}
      <div className="bg-foreground py-3 text-background">
        <MarqueeSegmentos itens={segmentos.map(s => s.toUpperCase())} />
      </div>

      {/* ───── Diga adeus ao atendimento caótico ───── */}
      <section data-reveal className="mx-auto max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
        <TituloSecao texto="Diga adeus ao atendimento *caótico*" className="text-center text-3xl sm:text-4xl" />
        <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">O futuro é integrado, rápido e automatizado.</p>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {/* Jeito antigo */}
          <div className="js-antigo rounded-3xl bg-muted p-7">
            <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground">O jeito antigo</div>
            <ul className="mt-5 space-y-4">
              {semLista.map((item, i) => (
                <li key={i} className="relative w-fit text-base text-muted-foreground">
                  <span>{item}</span>
                  <svg className="js-risco pointer-events-none absolute left-0 top-1/2 h-3 w-full -translate-y-1/2 overflow-visible text-primary" viewBox="0 0 200 8" fill="none" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M2 5 C 45 2, 90 7, 135 4 S 190 3, 198 5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                </li>
              ))}
            </ul>
          </div>

          {/* Jeito novo */}
          <div className="js-novo rounded-3xl border-2 border-primary bg-card p-7 shadow-lg shadow-primary/10">
            <div className="text-sm font-bold uppercase tracking-wider text-primary">O jeito novo</div>
            <ul className="mt-5 space-y-4">
              {comLista.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-base">
                  <span className="js-check-box mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-primary text-primary">
                    <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
                      <path className="js-check-path" d="M4 12.5 L9.5 18 L20 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span><TextoComComplemento texto={item} /></span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ───── Faixa de números ───── */}
      <div className="js-stats bg-foreground text-background">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {STATS_PADRAO.map((s, i) => (
            <div key={i} className="js-stat text-center lg:text-left">
              <div className="text-4xl font-black text-primary sm:text-5xl">{s.numero}</div>
              <div className="mt-1.5 text-sm text-background/70">{s.texto}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ───── Seção celular ───── */}
      <section data-reveal className="mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          {/* Celular grande + cards flutuantes */}
          <div className="js-fone-sec relative mx-auto w-[240px] max-w-full">
            <div className="rounded-[2.4rem] border-[7px] border-neutral-900 bg-neutral-900 shadow-2xl shadow-primary/10">
              <div className="relative overflow-hidden rounded-[1.9rem] bg-background">
                <div className="absolute left-1/2 top-1.5 z-10 h-4 w-24 -translate-x-1/2 rounded-b-2xl bg-neutral-900" />
                <img src={heroImagemMobile} alt="App do cliente" className="w-full object-cover object-top" />
              </div>
            </div>
            {/* Card: pedido recebido */}
            <div className="js-fone-card absolute -left-6 top-10 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-xl sm:-left-10">
              <span className="flex size-7 items-center justify-center rounded-full bg-success/15 text-success"><Check className="size-4" /></span>
              <div>
                <div className="text-xs font-bold leading-tight">Pedido #482 recebido</div>
                <div className="text-[10px] text-muted-foreground">agora mesmo</div>
              </div>
            </div>
            {/* Card: pix aprovado */}
            <div className="js-fone-card absolute -right-4 bottom-16 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-xl sm:-right-10">
              <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-primary"><Receipt className="size-4" /></span>
              <div>
                <div className="text-xs font-bold leading-tight">Pix aprovado</div>
                <div className="text-[10px] text-muted-foreground">R$ 56,00</div>
              </div>
            </div>
          </div>

          <div className="text-center lg:text-left">
            <TituloSecao texto="Seu cliente pede direto *pelo celular*" className="text-3xl sm:text-4xl" />
            <p className="mt-4 text-muted-foreground">
              Cardápio digital com foto, categorias e busca — sem app pra baixar. O cliente monta o pedido e finaliza em segundos.
            </p>
            <ul className="mt-6 space-y-3 text-left">
              {[
                { i: Smartphone, t: 'Sem baixar app', d: 'Abre o link e já pede — funciona em qualquer celular.' },
                { i: MapPin, t: 'Entrega com rastreio', d: 'O cliente acompanha o entregador ao vivo no mapa.' },
                { i: Receipt, t: 'Pix, cartão ou dinheiro', d: 'Pagamento na hora ou na entrega, do jeito que ele preferir.' },
              ].map(b => (
                <li key={b.t} className="flex gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><b.i className="size-5" /></span>
                  <div>
                    <div className="text-sm font-semibold">{b.t}</div>
                    <div className="text-sm text-muted-foreground">{b.d}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ───── NFC-e ───── */}
      <section id="nota-fiscal" data-reveal className="relative overflow-hidden py-16 sm:py-24">
        <div className="absolute inset-0 bg-primary/5" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-primary">Emissão fiscal</p>
            <TituloSecao texto="Cupom fiscal (NFC-e) *na hora da venda*" className="mt-4 text-3xl leading-tight sm:text-4xl" />
            <p className="mt-4 max-w-md text-muted-foreground">
              A nota sai com itens, total, chave de acesso e QR Code — direto do sistema, sem precisar de outro programa nem digitar os dados de novo.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-4">
              {FISCAL_MINI.map(b => (
                <div key={b.titulo} className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><b.icone className="size-5" /></div>
                  <div className="mt-2.5 text-sm font-semibold">{b.titulo}</div>
                  <div className="text-xs text-muted-foreground">{b.desc}</div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-center gap-3 rounded-2xl bg-primary/10 p-4">
              <ShieldCheck className="h-7 w-7 shrink-0 text-primary" />
              <div>
                <div className="text-sm font-bold">100% em conformidade com a SEFAZ</div>
                <div className="text-xs text-muted-foreground">Emissão segura, autorizada e sem complicação.</div>
              </div>
            </div>
          </div>
          <div className="relative mx-auto">
            <CupomTermico />
          </div>
        </div>
      </section>

      {/* ───── Recursos: lista 01-06 ───── */}
      <section id="recursos" data-reveal className="mx-auto max-w-4xl px-5 py-16 sm:px-6">
        <TituloSecao texto="Tudo que uma operação de delivery *precisa*" className="text-center text-3xl sm:text-4xl" />
        <div className="js-lista mt-12">
          {recursos.map(({ titulo, desc }, i) => (
            <div key={titulo}>
              <div className="js-lista-item group flex items-baseline gap-5 rounded-xl px-3 py-5 transition-colors hover:bg-accent/40 sm:gap-8">
                <span className="w-12 shrink-0 text-2xl font-black tabular-nums text-primary transition-transform duration-200 group-hover:translate-x-1 sm:text-3xl">
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

      {/* ───── Planos ───── */}
      <section id="planos" data-reveal className="mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-20">
        <TituloSecao texto="Planos sem *pegadinha*" className="text-center text-3xl sm:text-4xl" />
        <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
          Sem taxa por pedido, sem fidelidade. Você paga a mensalidade e pronto.
        </p>
        <div className="mt-12 grid items-start gap-6 lg:grid-cols-3">
          {planos.map((p) => {
            const destaque = !!p.destaque;
            return (
              <div key={p.nome} className={cn(
                'relative flex flex-col rounded-3xl border p-7',
                destaque ? 'border-transparent bg-foreground text-background shadow-2xl lg:-translate-y-3' : 'border-border bg-card',
              )}>
                {destaque && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-primary-foreground">Mais escolhido</span>
                )}
                <div className={cn('text-sm font-bold uppercase tracking-wider', destaque ? 'text-primary' : 'text-muted-foreground')}>{p.nome}</div>
                <div className="mt-2 text-3xl font-black">{p.preco}</div>
                <ul className="mt-6 flex-1 space-y-3">
                  {p.recursos.map((r, ri) => (
                    <li key={ri} className="flex items-start gap-2.5 text-sm">
                      <Check className={cn('mt-0.5 size-4 shrink-0', destaque ? 'text-primary' : 'text-primary')} />
                      <span className={destaque ? 'text-background/90' : ''}>{r}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href={linkZap(`Olá! Tenho interesse no plano ${p.nome}.`) || '/lojista'}
                  {...(linkZap() ? { target: '_blank', rel: 'noreferrer' } : {})}
                  className={cn(
                    'mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-6 text-sm font-semibold transition-all active:scale-[0.98]',
                    destaque ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-foreground text-background hover:bg-foreground/90',
                  )}
                >
                  <IconeWhatsapp className="size-4" /> {p.cta}
                </a>
              </div>
            );
          })}
        </div>
      </section>

      {/* ───── FAQ ───── */}
      <section id="duvidas" data-reveal className="mx-auto max-w-3xl px-5 py-16 sm:px-6">
        <TituloSecao texto="Dúvidas *frequentes*" className="text-center text-3xl sm:text-4xl" />
        <div className="mt-10 space-y-3">
          {faq.map((f, i) => (
            <details key={i} className="faq group rounded-2xl border border-border bg-card px-5">
              <summary className="flex items-center justify-between gap-4 py-4 text-left text-base font-semibold">
                {f.pergunta}
                <ChevronDown className="faq-chevron size-5 shrink-0 text-muted-foreground" />
              </summary>
              <p className="pb-5 text-sm text-muted-foreground">{f.resposta}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ───── CTA final ───── */}
      <section data-reveal className="relative overflow-hidden bg-primary text-primary-foreground">
        <div className="relative mx-auto grid max-w-6xl items-center gap-8 px-5 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1fr_auto]">
          <div className="text-center lg:text-left">
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Quer ver funcionando na prática?</h2>
            <p className="mt-3 max-w-lg text-primary-foreground/80">
              Explore uma loja de demonstração completa — cardápio, carrinho e checkout de verdade.
            </p>
            <div className="mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center lg:justify-start">
              <BotaoDemo size="lg" variant="branco" texto="Abrir loja demo" />
              <a
                href={linkZap('Olá! Quero falar sobre o sistema de delivery.') || '/lojista'}
                {...(linkZap() ? { target: '_blank', rel: 'noreferrer' } : {})}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-primary-foreground/40 px-7 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/10"
              >
                <IconeWhatsapp className="size-5" /> Falar no WhatsApp
              </a>
            </div>
          </div>
          {/* Mascote sangrando na borda inferior */}
          <div className="pointer-events-none relative hidden justify-center self-end lg:flex">
            <img src="/mascote/mascote.png" alt="" className="js-mascote -mb-16 sm:-mb-20 h-56 w-auto drop-shadow-2xl" />
          </div>
        </div>
      </section>

      {/* ───── Rodapé ───── */}
      <footer className="mt-auto border-t border-border bg-background">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-6 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2 font-extrabold">
              {marca.logo_url ? <img src={marca.logo_url} alt={marca.nome} className="h-6 w-auto" /> : <Store className="h-5 w-5 text-primary" />}
              {marca.nome}
            </div>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">{marca.slogan || 'A plataforma completa de delivery multi-lojas.'}</p>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Plataforma</div>
            <ul className="mt-3 space-y-2 text-sm">
              {linkDemo && (
                <li>{demoExterna
                  ? <a href={linkDemo} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">Ver demonstração</a>
                  : <Link to={linkDemo} className="text-muted-foreground hover:text-foreground">Ver demonstração</Link>}</li>
              )}
              <li><a href="#planos" className="text-muted-foreground hover:text-foreground">Planos</a></li>
              <li><a href="#duvidas" className="text-muted-foreground hover:text-foreground">Dúvidas</a></li>
              <li><Link to="/lojista" className="text-muted-foreground hover:text-foreground">Sou lojista</Link></li>
              {marca.termos_url && <li><a href={marca.termos_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">Termos de uso</a></li>}
            </ul>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Contato</div>
            <ul className="mt-3 space-y-2 text-sm">
              {marca.suporte_email && (
                <li><a href={`mailto:${marca.suporte_email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"><Mail className="h-3.5 w-3.5 shrink-0" /> {marca.suporte_email}</a></li>
              )}
              {marca.suporte_telefone && (
                <li className="flex items-center gap-1.5 text-muted-foreground"><Phone className="h-3.5 w-3.5 shrink-0" /> {marca.suporte_telefone}</li>
              )}
            </ul>
          </div>
        </div>
        <div className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} {marca.nome}. Todos os direitos reservados.
        </div>
      </footer>

      {/* ───── Botão flutuante do WhatsApp ───── */}
      {linkZap() && (
        <a
          href={linkZap('Olá! Quero saber mais sobre o sistema.')}
          target="_blank" rel="noreferrer"
          aria-label="Falar no WhatsApp"
          className="fixed bottom-5 right-5 z-50 flex size-14 items-center justify-center rounded-full text-white shadow-2xl transition-transform hover:scale-105 active:scale-95"
          style={{ backgroundColor: WHATSAPP_VERDE }}
        >
          <IconeWhatsapp className="size-7" />
        </a>
      )}
    </div>
  );
}
