/**
 * Editor visual completo da loja ("Visual" no painel do lojista) — tipos
 * default, parse seguro do blob `Loja.visual_json` e helpers de estilo
 * COMPARTILHADOS entre o preview do editor (`PhonePreview`) e o storefront
 * real (`pages/cliente/loja.tsx`), pra não duplicar a lógica de estilo.
 *
 * Independente do tema white-label da PLATAFORMA (`lib/tema.ts`,
 * `RAIOS`/`FONTES`/`FonteMarca`) — este é o tema de UMA loja só.
 */
import type { CSSProperties } from 'react';
import type { VisualJson } from '@/types';

export const DEFAULT_VISUAL: VisualJson = {
  geral: {
    slogan: '',
    mostrar_avaliacao: true,
    mostrar_tempo_medio: true,
    mostrar_taxa_entrega: true,
    mostrar_pedido_minimo: true,
    mostrar_distancia: false,
  },
  cores: {
    cor_botoes: '', cor_cards: '', cor_fundo: '', cor_cabecalho: '',
    cor_rodape: '', cor_texto: '', cor_badges: '',
  },
  logo: {
    tamanho: 64, formato: 'arredondado',
    sombra: true, borda: false, borda_branca: true, padding: false,
  },
  capa: {
    overlay: true, gradiente: true, blur: 0, escurecimento: 30, opacidade: 100,
    posicao: 'centro', ajuste: 'cover',
  },
  cardapio: {
    layout: 'lista',
    mostrar_foto: true, mostrar_descricao: true, mostrar_categoria: true,
    mostrar_avaliacao: false, mostrar_tempo: false,
    preco_destacado: true, badge_promocao: true, botao_comprar: true,
    espacamento: 12, raio_bordas: 16, altura_cards: 180,
  },
  botoes: {
    hover: true, sombra: true, gradiente: false, icone: false, borda: false,
    raio: 999, tamanho: 'md', animacao: 'nenhuma',
  },
  tipografia: {
    fonte: 'inter', peso: 600, espacamento: 0, tamanho_base: 15, altura_linha: 1.5,
  },
  banners: {
    botao_texto: '', tempo_rotacao_ms: 5000, loop: true,
    mostrar_indicadores: true, mostrar_setas: true,
  },
  avancado: {
    meta_description: '', meta_keywords: '', og_image: '',
    ga_measurement_id: '', gtm_container_id: '', fb_pixel_id: '',
    tiktok_pixel_id: '', clarity_project_id: '',
  },
};

/** Fontes disponíveis pro editor da LOJA — mapa próprio, não mexe no FONTES da plataforma. */
export const FONTES_VISUAL: Record<VisualJson['tipografia']['fonte'], { label: string; stack: string; google?: string }> = {
  inter:      { label: 'Inter',      stack: "'Inter', system-ui, sans-serif",      google: 'Inter:wght@400;500;600;700;800' },
  poppins:    { label: 'Poppins',    stack: "'Poppins', system-ui, sans-serif",    google: 'Poppins:wght@400;500;600;700;800' },
  roboto:     { label: 'Roboto',     stack: "'Roboto', system-ui, sans-serif",     google: 'Roboto:wght@400;500;700;900' },
  montserrat: { label: 'Montserrat', stack: "'Montserrat', system-ui, sans-serif", google: 'Montserrat:wght@400;500;600;700;800' },
  nunito:     { label: 'Nunito',     stack: "'Nunito', system-ui, sans-serif",     google: 'Nunito:wght@400;500;600;700;800' },
};

function mesclar<T extends object>(padrao: T, parcial: any): T {
  if (!parcial || typeof parcial !== 'object') return { ...padrao };
  const resultado: any = { ...padrao };
  for (const chave of Object.keys(padrao)) {
    if (parcial[chave] !== undefined) resultado[chave] = parcial[chave];
  }
  return resultado;
}

/** Parse seguro do `visual_json` cru — nunca lança, sempre volta uma árvore completa. */
export function parseVisualJson(raw: string | undefined | null): VisualJson {
  let obj: any = {};
  if (raw) {
    try { obj = JSON.parse(raw); } catch { obj = {}; }
  }
  if (!obj || typeof obj !== 'object') obj = {};
  return {
    geral: mesclar(DEFAULT_VISUAL.geral, obj.geral),
    cores: mesclar(DEFAULT_VISUAL.cores, obj.cores),
    logo: mesclar(DEFAULT_VISUAL.logo, obj.logo),
    capa: mesclar(DEFAULT_VISUAL.capa, obj.capa),
    cardapio: mesclar(DEFAULT_VISUAL.cardapio, obj.cardapio),
    botoes: mesclar(DEFAULT_VISUAL.botoes, obj.botoes),
    tipografia: mesclar(DEFAULT_VISUAL.tipografia, obj.tipografia),
    banners: mesclar(DEFAULT_VISUAL.banners, obj.banners),
    avancado: mesclar(DEFAULT_VISUAL.avancado, obj.avancado),
  };
}

/** Cor com fallback — string vazia = "herda" a cor informada. */
export function corOuPadrao(cor: string, padrao: string): string {
  return cor && cor.trim() ? cor : padrao;
}

const RAIO_BOTAO: Record<VisualJson['botoes']['tamanho'], number> = { sm: 8, md: 12, lg: 16 };
const PADDING_BOTAO: Record<VisualJson['botoes']['tamanho'], string> = {
  sm: '6px 14px', md: '10px 20px', lg: '14px 28px',
};
const FONTE_BOTAO: Record<VisualJson['botoes']['tamanho'], string> = { sm: '13px', md: '14px', lg: '16px' };

/** Estilo inline do botão "Adicionar"/CTA, derivado de `visual.botoes` + a cor da marca. */
export function estiloBotao(visual: VisualJson, corMarca: string): CSSProperties {
  const cor = corOuPadrao(visual.cores.cor_botoes, corMarca || '#dc2640');
  return {
    backgroundColor: visual.botoes.gradiente ? undefined : cor,
    backgroundImage: visual.botoes.gradiente ? `linear-gradient(135deg, ${cor}, ${cor}cc)` : undefined,
    borderRadius: Math.min(visual.botoes.raio, RAIO_BOTAO[visual.botoes.tamanho] * 3),
    padding: PADDING_BOTAO[visual.botoes.tamanho],
    fontSize: FONTE_BOTAO[visual.botoes.tamanho],
    boxShadow: visual.botoes.sombra ? '0 4px 14px rgba(0,0,0,.18)' : 'none',
    border: visual.botoes.borda ? `1.5px solid ${cor}` : 'none',
  };
}

/**
 * Estilo do botão-ÍCONE redondo (o "+" de adicionar no card do produto). Ao
 * contrário de `estiloBotao`, NÃO aplica padding/fontSize (que são pro botão
 * grande com texto) — num botão de 32px o padding empurraria o ícone pra fora
 * e o botão apareceria vazio. Aqui só a cor, a sombra e a borda importam; o
 * tamanho e o formato redondo vêm das classes (`size-8 rounded-full`).
 */
export function estiloBotaoIcone(visual: VisualJson, corMarca: string): CSSProperties {
  const cor = corOuPadrao(visual.cores.cor_botoes, corMarca || '#dc2640');
  return {
    backgroundColor: visual.botoes.gradiente ? undefined : cor,
    backgroundImage: visual.botoes.gradiente ? `linear-gradient(135deg, ${cor}, ${cor}cc)` : undefined,
    boxShadow: visual.botoes.sombra ? '0 4px 14px rgba(0,0,0,.18)' : 'none',
    border: visual.botoes.borda ? `1.5px solid ${cor}` : 'none',
  };
}

/** Classe utilitária de animação do botão — as keyframes ficam em `PhonePreview`/`loja.tsx`. */
export function classNameBotao(visual: VisualJson): string {
  if (visual.botoes.animacao === 'nenhuma') return '';
  return `botao-anim-${visual.botoes.animacao}`;
}

/** Estilo inline do card de produto, derivado de `visual.cardapio` + `visual.cores`. */
export function estiloCardProduto(visual: VisualJson): CSSProperties {
  return {
    backgroundColor: visual.cores.cor_cards || undefined,
    borderRadius: visual.cardapio.raio_bordas,
    height: visual.cardapio.layout === 'grid' || visual.cardapio.layout === 'premium'
      ? visual.cardapio.altura_cards : undefined,
    gap: visual.cardapio.espacamento,
  };
}

/**
 * Injeta os snippets OFICIAIS de analytics/pixel (nunca script livre do
 * usuário — só os 5 IDs tipados validados pelo backend). Idempotente por
 * `id` de tag: trocar de loja troca o conteúdo, não empilha tags.
 */
export function injetarAnalytics(avancado: VisualJson['avancado']) {
  // GA4
  const gaId = 'analytics-ga4';
  const antigoGa = document.getElementById(gaId);
  if (antigoGa) antigoGa.remove();
  document.getElementById('analytics-ga4-inline')?.remove();
  if (avancado.ga_measurement_id) {
    const s = document.createElement('script');
    s.id = gaId; s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${avancado.ga_measurement_id}`;
    document.head.appendChild(s);
    const inline = document.createElement('script');
    inline.id = 'analytics-ga4-inline';
    inline.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${avancado.ga_measurement_id}');`;
    document.head.appendChild(inline);
  }

  // GTM
  const gtmId = 'analytics-gtm';
  document.getElementById(gtmId)?.remove();
  if (avancado.gtm_container_id) {
    const s = document.createElement('script');
    s.id = gtmId;
    s.textContent = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${avancado.gtm_container_id}');`;
    document.head.appendChild(s);
  }

  // Meta (Facebook) Pixel
  const fbId = 'analytics-fbpixel';
  document.getElementById(fbId)?.remove();
  if (avancado.fb_pixel_id) {
    const s = document.createElement('script');
    s.id = fbId;
    s.textContent = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${avancado.fb_pixel_id}');fbq('track','PageView');`;
    document.head.appendChild(s);
  }

  // TikTok Pixel
  const ttId = 'analytics-tiktok';
  document.getElementById(ttId)?.remove();
  if (avancado.tiktok_pixel_id) {
    const s = document.createElement('script');
    s.id = ttId;
    s.textContent = `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${avancado.tiktok_pixel_id}');ttq.page();}(window,document,'ttq');`;
    document.head.appendChild(s);
  }

  // Microsoft Clarity
  const clId = 'analytics-clarity';
  document.getElementById(clId)?.remove();
  if (avancado.clarity_project_id) {
    const s = document.createElement('script');
    s.id = clId;
    s.textContent = `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script","${avancado.clarity_project_id}");`;
    document.head.appendChild(s);
  }
}

/** Remove todos os scripts de analytics injetados (ex.: ao sair da página da loja). */
export function removerAnalytics() {
  ['analytics-ga4', 'analytics-ga4-inline', 'analytics-gtm', 'analytics-fbpixel', 'analytics-tiktok', 'analytics-clarity']
    .forEach(id => document.getElementById(id)?.remove());
}
