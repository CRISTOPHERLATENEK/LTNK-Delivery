/**
 * Tema (white label) — carrega a identidade da plataforma e aplica em toda a
 * interface via CSS variables, ANTES da primeira renderização.
 *
 * "Nível altíssimo": a partir da cor da marca o engine deriva uma paleta
 * completa (foreground com contraste automático, accent suave, ring), aplica
 * raio dos cantos, tipografia, cor da barra do navegador (theme-color) e
 * metadados de SEO/Open Graph.
 */
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { TemaMarca, RaioMarca, FonteMarca } from '@/types';

const PADRAO: TemaMarca = {
  nome: 'Delivery Já',
  slogan: 'Peça das melhores lojas',
  logo_url: '',
  favicon_url: '',
  cor_primaria: '#dc2640',
  cor_secundaria: '',
  raio: 'suave',
  fonte: 'inter',
  descricao: '',
  og_image: '',
  login_banner_url: '',
  loja_id: 0,
  // Assume master até o /api/tema real responder — evita que o guard do
  // painel admin (SoDominioMaster) redirecione no primeiro render, antes de
  // saber de fato qual domínio é esse.
  eh_master: true,
};

// Cache do último /api/tema resolvido pra ESTE domínio (localStorage já é
// isolado por origem — cada domínio de loja tem o seu). Sem isso, todo F5 na
// raiz nasce com o PADRAO (loja_id: 0) até o fetch responder, e um domínio
// já amarrado a uma loja pisca a landing antes de trocar pro cardápio.
const CHAVE_CACHE_TEMA = 'tema_cache_v1';

function lerTemaCacheado(): TemaMarca | null {
  try {
    const bruto = localStorage.getItem(CHAVE_CACHE_TEMA);
    return bruto ? { ...PADRAO, ...JSON.parse(bruto) } : null;
  } catch { return null; }
}

function gravarTemaCache(m: TemaMarca) {
  try { localStorage.setItem(CHAVE_CACHE_TEMA, JSON.stringify(m)); } catch { /* localStorage indisponível */ }
}

/* ───────────────────────── tabelas de raio e fonte ───────────────────────── */

export const RAIOS: Record<RaioMarca, string> = {
  reto: '0.25rem',
  suave: '0.875rem',
  redondo: '1.5rem',
};

export const FONTES: Record<FonteMarca, { label: string; stack: string; google?: string }> = {
  inter:      { label: 'Inter',      stack: "'Inter', system-ui, sans-serif", google: 'Inter:wght@400;500;600;700;800' },
  poppins:    { label: 'Poppins',    stack: "'Poppins', system-ui, sans-serif", google: 'Poppins:wght@400;500;600;700;800' },
  montserrat: { label: 'Montserrat', stack: "'Montserrat', system-ui, sans-serif", google: 'Montserrat:wght@400;500;600;700;800' },
  roboto:     { label: 'Roboto',     stack: "'Roboto', system-ui, sans-serif", google: 'Roboto:wght@400;500;700;900' },
  sistema:    { label: 'Sistema',    stack: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
};

interface TemaCtx {
  marca: TemaMarca;
  aplicarCorPrimaria: (hex: string | undefined | null, corSecundaria?: string | null) => void;
  resetarCorPrimaria: () => void;
  /** Sobrepõe o favicon (ex.: ao visitar a página de uma loja). */
  aplicarFaviconLoja: (url: string | undefined | null) => void;
  /** Volta o favicon para o da plataforma (ex.: ao sair da página da loja). */
  resetarFavicon: () => void;
  /** Pré-visualiza uma marca inteira sem persistir (usado no painel admin). */
  previsualizar: (parcial: Partial<TemaMarca>) => void;
  recarregar: () => Promise<void>;
}

export const TemaContext = createContext<TemaCtx>({
  marca: PADRAO,
  aplicarCorPrimaria: () => {},
  resetarCorPrimaria: () => {},
  aplicarFaviconLoja: () => {},
  resetarFavicon: () => {},
  previsualizar: () => {},
  recarregar: async () => {},
});

export function useTema() {
  return useContext(TemaContext);
}

/* ───────────────────────── utilidades de cor ───────────────────────── */

interface HSL { h: number; s: number; l: number }

/** #RRGGBB → {h,s,l} (h em graus, s/l em 0–100). */
export function hexParaHSLObj(hex: string): HSL | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const num = parseInt(m[1], 16);
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
      case g: h = ((b - r) / d + 2) * 60; break;
      case b: h = ((r - g) / d + 4) * 60; break;
    }
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** String "H S% L%" pronta para `hsl(var(--x))`. */
export function hexParaHSL(hex: string): string | null {
  const o = hexParaHSLObj(hex);
  return o ? `${o.h} ${o.s}% ${o.l}%` : null;
}

const fmt = (o: HSL) => `${o.h} ${o.s}% ${o.l}%`;

/**
 * Luminância relativa (WCAG) a partir de #RRGGBB, para decidir se o texto
 * sobre essa cor deve ser claro ou escuro.
 */
function luminancia(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const num = parseInt(m[1], 16);
  const canal = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = canal((num >> 16) & 255);
  const g = canal((num >> 8) & 255);
  const b = canal(num & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** #RRGGBB → {r,g,b} (0–255 cada), ou null se inválido. */
export function hexParaRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const num = parseInt(m[1], 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

/** Foreground com contraste garantido: preto sobre cores claras, branco sobre escuras. */
export function foregroundContraste(hex: string): string {
  return luminancia(hex) > 0.55 ? '240 10% 8%' : '0 0% 100%';
}

/* ───────────────────────── aplicação do tema no DOM ───────────────────────── */

/**
 * Só injeta o `<link>` do Google Fonts (idempotente por `elId`) — NÃO seta
 * `document.body.style.fontFamily` globalmente. Usada por telas que
 * precisam de uma fonte diferente da fonte-marca da plataforma só num
 * escopo próprio (ex.: a fonte que o LOJISTA escolheu pra loja dele, no
 * editor Visual e na página pública da loja) sem vazar pro resto do app.
 */
export function injetarFonteLink(cfg: { stack: string; google?: string }, elId: string) {
  if (!cfg.google) return;
  let link = document.getElementById(elId) as HTMLLinkElement | null;
  const href = `https://fonts.googleapis.com/css2?family=${cfg.google}&display=swap`;
  if (!link) {
    link = document.createElement('link');
    link.id = elId;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (link.href !== href) link.href = href;
}

function injetarFonte(fonte: FonteMarca) {
  const cfg = FONTES[fonte] ?? FONTES.inter;
  injetarFonteLink(cfg, 'fonte-marca');
  document.documentElement.style.setProperty('--fonte-marca', cfg.stack);
  document.body.style.fontFamily = cfg.stack;
}

function setMeta(seletor: string, criar: () => HTMLMetaElement, valor: string) {
  let el = document.head.querySelector(seletor) as HTMLMetaElement | null;
  if (!el) { el = criar(); document.head.appendChild(el); }
  el.setAttribute('content', valor);
}

/**
 * Última paleta aplicada — guardada para reaplicar quando o tema (claro/escuro)
 * muda, já que parte das variáveis (--accent) depende do modo atual.
 */
let ultimaPaleta: { primaria: string; secundaria?: string } | null = null;

/** Reaplica a paleta corrente recalculando as variáveis que dependem do tema. */
export function reaplicarPaletaTema() {
  if (ultimaPaleta) aplicarPaleta(ultimaPaleta.primaria, ultimaPaleta.secundaria);
}

/** Aplica a paleta derivada da cor primária (e secundária, se houver). */
function aplicarPaleta(corPrimaria: string, corSecundaria?: string) {
  const p = hexParaHSLObj(corPrimaria);
  if (!p) return;
  ultimaPaleta = { primaria: corPrimaria, secundaria: corSecundaria };
  const raiz = document.documentElement.style;

  raiz.setProperty('--primary', fmt(p));
  raiz.setProperty('--ring', fmt(p));
  raiz.setProperty('--primary-foreground', foregroundContraste(corPrimaria));

  // Accent = tint suave da marca (fundo de chips, hovers)
  const accentLight = `${p.h} ${Math.min(p.s, 80)}% 96%`;
  const accentDark = `${p.h} 30% 18%`;
  const accentFgLight = `${p.h} ${p.s}% 30%`;
  const accentFgDark = `${p.h} 80% 85%`;
  const escuro = document.documentElement.classList.contains('dark');
  raiz.setProperty('--accent', escuro ? accentDark : accentLight);
  raiz.setProperty('--accent-foreground', escuro ? accentFgDark : accentFgLight);

  // Cacheia os valores já calculados: o script inline do index.html reaplica
  // ANTES do React montar, matando o flash da cor padrão (vermelho) no F5.
  try {
    localStorage.setItem('paleta-marca', JSON.stringify({
      primary: fmt(p), ring: fmt(p), primaryFg: foregroundContraste(corPrimaria),
      accentLight, accentDark, accentFgLight, accentFgDark,
    }));
  } catch { /* localStorage indisponível */ }

  if (corSecundaria) {
    const s = hexParaHSLObj(corSecundaria);
    if (s) {
      raiz.setProperty('--secondary', fmt(s));
      raiz.setProperty('--secondary-foreground', foregroundContraste(corSecundaria));
    }
  } else {
    raiz.removeProperty('--secondary');
    raiz.removeProperty('--secondary-foreground');
  }
}

/** Troca o favicon da aba do navegador. Usado pela marca da plataforma e,
 * ao visitar a página de uma loja, temporariamente pelo favicon dela. */
export function aplicarFavicon(url: string) {
  let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = url;
}

/** Aplica a marca completa (cor, raio, fonte, theme-color, SEO/OG, favicon). */
export function aplicarMarca(m: TemaMarca) {
  aplicarPaleta(m.cor_primaria, m.cor_secundaria || undefined);

  // Cantos
  document.documentElement.style.setProperty('--radius', RAIOS[m.raio] ?? RAIOS.suave);

  // Tipografia
  injetarFonte(m.fonte ?? 'inter');

  // Cor da barra do navegador no mobile
  const hslPrim = hexParaHSL(m.cor_primaria);
  if (hslPrim) {
    setMeta("meta[name='theme-color']",
      () => Object.assign(document.createElement('meta'), { name: 'theme-color' }),
      m.cor_primaria);
  }

  // Título e SEO
  document.title = m.slogan ? `${m.nome} — ${m.slogan}` : m.nome;
  if (m.descricao) {
    setMeta("meta[name='description']",
      () => Object.assign(document.createElement('meta'), { name: 'description' }),
      m.descricao);
  }

  // Open Graph (compartilhamento em redes)
  const og = (prop: string, valor: string) => {
    if (!valor) return;
    setMeta(`meta[property='${prop}']`, () => {
      const el = document.createElement('meta');
      el.setAttribute('property', prop);
      return el;
    }, valor);
  };
  og('og:title', m.nome);
  og('og:description', m.descricao);
  og('og:image', m.og_image);
  og('og:type', 'website');

  if (m.favicon_url) aplicarFavicon(m.favicon_url);
}

/* ───────────────────────── hook do provider ───────────────────────── */

export function useTemaProvider(): TemaCtx {
  // Inicializador preguiçoso: usa o tema cacheado do domínio (se houver) já
  // na primeira renderização, em vez de sempre nascer no PADRAO — evita o
  // "pisca pra landing" num F5 num domínio já amarrado a uma loja, antes do
  // /api/tema (assíncrono) responder de verdade.
  const [marca, setMarca] = useState<TemaMarca>(() => lerTemaCacheado() ?? PADRAO);

  const aplicarCorPrimaria = useCallback((hex: string | undefined | null, corSecundaria?: string | null) => {
    if (!hex) return;
    aplicarPaleta(hex, corSecundaria || undefined);
  }, []);

  const resetarCorPrimaria = useCallback(() => {
    if (marca.cor_primaria) aplicarPaleta(marca.cor_primaria, marca.cor_secundaria || undefined);
  }, [marca.cor_primaria, marca.cor_secundaria]);

  const aplicarFaviconLoja = useCallback((url: string | undefined | null) => {
    if (url) aplicarFavicon(url);
  }, []);

  const resetarFavicon = useCallback(() => {
    if (marca.favicon_url) aplicarFavicon(marca.favicon_url);
  }, [marca.favicon_url]);

  const previsualizar = useCallback((parcial: Partial<TemaMarca>) => {
    aplicarMarca({ ...marca, ...parcial });
  }, [marca]);

  const recarregar = useCallback(async () => {
    try {
      const r = await fetch('/api/tema');
      if (!r.ok) return;
      const dados = (await r.json()) as Partial<TemaMarca>;
      const tema: TemaMarca = { ...PADRAO, ...dados };
      setMarca(tema);
      aplicarMarca(tema);
      gravarTemaCache(tema);
    } catch {
      // Sem internet ou backend caiu: mantém o padrão
    }
  }, []);

  useEffect(() => { recarregar(); }, [recarregar]);

  return { marca, aplicarCorPrimaria, resetarCorPrimaria, aplicarFaviconLoja, resetarFavicon, previsualizar, recarregar };
}
