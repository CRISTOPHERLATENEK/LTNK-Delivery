import { useEffect, useRef, useState } from 'react';
import { Smartphone, Monitor, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EstadoVisual } from './types';

interface Props {
  estado: EstadoVisual;
  lojaId: number | null;
  /** Slug do tenant desta loja (ver GET /api/lojista/loja). Necessário quando
   * a loja não tem domínio próprio configurado: o iframe roda na mesma aba
   * do lojista, e sem esse hint o Host da requisição resolveria pro tenant
   * errado (SILO — cada loja pode morar num banco isolado). */
  tenantSlug?: string | null;
  modo: 'mobile' | 'desktop';
  onModoChange: (modo: 'mobile' | 'desktop') => void;
}

const LARGURA_MOBILE = 390;
const ALTURA_MOBILE = 720;
const LARGURA_DESKTOP = 1180;
const ALTURA_DESKTOP = 720;

/**
 * Preview ao vivo = a página REAL da loja (`/loja/:id?preview=1`) dentro de
 * um <iframe> same-origin, recebendo o estado ainda não salvo via
 * postMessage. Não é um mockup à parte — é literalmente o mesmo componente
 * que o cliente vê, então nunca diverge do site de verdade. O toggle
 * mobile/desktop só redimensiona o iframe: como é o app de verdade
 * renderizando, os breakpoints (`sm:`, `lg:`) reagem sozinhos, igual um
 * navegador de verdade.
 */
export function PhonePreview({ estado, lojaId, tenantSlug, modo, onModoChange }: Props) {
  const [pronto, setPronto] = useState(false);
  const [escala, setEscala] = useState(1);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Handshake: o iframe avisa "estou pronto" via postMessage assim que monta
  // (evita a corrida de mandar o estado antes do listener existir lá dentro).
  useEffect(() => {
    function aoReceberMensagem(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'preview-ready') setPronto(true);
    }
    window.addEventListener('message', aoReceberMensagem);
    return () => window.removeEventListener('message', aoReceberMensagem);
  }, []);

  // Reenvia o estado atual toda vez que algo muda (ou quando o iframe fica
  // pronto) — postMessage é local e instantâneo, sem chamada de rede.
  useEffect(() => {
    if (!pronto) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: 'visual-preview', payload: estado }, window.location.origin);
  }, [estado, pronto]);

  // Modo desktop: encolhe o iframe (que continua renderizando em 1180px de
  // verdade) pra caber na largura do painel lateral — igual o zoom do
  // DevTools, não é um layout "mobile forçado a parecer desktop".
  const largura = modo === 'mobile' ? LARGURA_MOBILE : LARGURA_DESKTOP;
  const altura = modo === 'mobile' ? ALTURA_MOBILE : ALTURA_DESKTOP;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    function recalcular() {
      if (modo === 'mobile') { setEscala(1); return; }
      const disponivel = wrapper!.clientWidth;
      setEscala(disponivel > 0 ? Math.min(1, disponivel / LARGURA_DESKTOP) : 1);
    }
    recalcular();
    const obs = new ResizeObserver(recalcular);
    obs.observe(wrapper);
    return () => obs.disconnect();
  }, [modo]);

  function recarregar() {
    setPronto(false);
    const el = iframeRef.current;
    if (el) el.src = el.src;
  }

  if (!lojaId) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg bg-muted p-0.5">
          <button type="button" onClick={() => onModoChange('mobile')}
            className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
              modo === 'mobile' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            <Smartphone className="size-3.5" /> Mobile
          </button>
          <button type="button" onClick={() => onModoChange('desktop')}
            className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
              modo === 'desktop' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            <Monitor className="size-3.5" /> Desktop
          </button>
        </div>
        <button type="button" onClick={recarregar} title="Recarregar preview"
          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      <div
        ref={wrapperRef}
        className={cn(
          'mx-auto overflow-hidden border-neutral-900 bg-neutral-900 shadow-2xl',
          modo === 'mobile' ? 'rounded-[2.5rem] border-8' : 'rounded-xl border-4 w-full',
        )}
        style={modo === 'mobile' ? { width: LARGURA_MOBILE, maxWidth: '100%' } : undefined}
      >
        {/* Status bar falsa só no modo mobile — o resto da tela é 100% real (iframe da própria loja). */}
        {modo === 'mobile' && (
          <div className="relative flex items-center justify-between bg-black px-5 py-1.5 text-[10px] font-semibold text-white">
            <span>9:41</span>
            <div className="absolute left-1/2 top-1/2 h-4 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-900" />
            <span>📶 🔋</span>
          </div>
        )}
        <div className="w-full overflow-hidden bg-white" style={{ height: altura * escala }}>
          <div style={{ width: largura, height: altura, transform: `scale(${escala})`, transformOrigin: 'top left' }}>
            <iframe
              ref={iframeRef}
              key={lojaId}
              src={`/loja/${lojaId}?preview=1${tenantSlug ? `&tenant=${encodeURIComponent(tenantSlug)}` : ''}`}
              title="Pré-visualização da loja"
              className="border-0 bg-white"
              style={{ width: largura, height: altura }}
              onLoad={() => setPronto(false)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
