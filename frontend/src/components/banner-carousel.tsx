/**
 * Carrossel de banners com autoplay, swipe (mouse + touch via Framer drag),
 * setas e dots. Os slides são imagens cheias com legenda sobre gradiente.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Banner } from '@/types';
import { cn } from '@/lib/utils';

interface Props {
  banners: Banner[];
  /** Chamado ao clicar num banner que tem produto_id mas não loja_id (já estamos na loja). */
  onProdutoClick?: (produtoId: number) => void;
  /** Config de rotação da loja (visual_json.banners) — todos opcionais, com os defaults de sempre. */
  tempoRotacaoMs?: number;
  loop?: boolean;
  mostrarIndicadores?: boolean;
  mostrarSetas?: boolean;
}

export function BannerCarousel({
  banners, onProdutoClick,
  tempoRotacaoMs = 5000, loop = true, mostrarIndicadores = true, mostrarSetas = true,
}: Props) {
  const [atual, setAtual] = useState(0);
  const [pausado, setPausado] = useState(false);
  const navigate = useNavigate();
  const total = banners.length;
  const cronoRef = useRef<number | null>(null);

  const ir = (i: number) => setAtual(((i % total) + total) % total);
  const proximo = () => ir(loop ? atual + 1 : Math.min(atual + 1, total - 1));
  const anterior = () => ir(loop ? atual - 1 : Math.max(atual - 1, 0));

  useEffect(() => {
    if (pausado || total < 2) return;
    if (!loop && atual === total - 1) return;
    cronoRef.current = window.setTimeout(() => setAtual(v => (loop ? (v + 1) % total : Math.min(v + 1, total - 1))), tempoRotacaoMs);
    return () => { if (cronoRef.current) clearTimeout(cronoRef.current); };
  }, [atual, pausado, total, loop, tempoRotacaoMs]);

  if (total === 0) return null;
  const banner = banners[atual];

  const abrir = (b: Banner) => {
    if (!b.loja_id && b.produto_id && onProdutoClick) {
      onProdutoClick(b.produto_id);
    } else if (b.loja_id && b.produto_id) {
      navigate(`/${b.loja_id}?produto=${b.produto_id}`);
    } else if (b.loja_id) {
      navigate(`/${b.loja_id}`);
    } else if (b.link_url) {
      window.open(b.link_url, '_blank', 'noopener');
    }
  };

  return (
    <section
      className="relative -mx-4 sm:mx-0 sm:rounded-3xl overflow-hidden bg-black mb-5"
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      aria-roledescription="carousel"
    >
      <div className="relative aspect-[12/5]">
        <AnimatePresence initial={false}>
          <motion.button
            key={banner.id}
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
            className="absolute inset-0 w-full text-left"
            onClick={() => abrir(banner)}
            aria-label={`Slide ${atual + 1} de ${total}: ${banner.titulo}`}
          >
            <ImagemBanner src={banner.imagem} alt={banner.titulo} />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-5 pt-16 text-white">
              {(banner.loja_nome || banner.produto_nome) && (
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/80 mb-1">
                  {banner.loja_nome}{banner.produto_nome ? ` · ${banner.produto_nome}` : ''}
                </div>
              )}
              <div className="text-lg font-bold leading-tight line-clamp-2 sm:text-xl">{banner.titulo}</div>
              {banner.subtitulo && (
                <div className="text-sm text-white/75 mt-0.5 line-clamp-1">{banner.subtitulo}</div>
              )}
              {banner.botao_texto && (
                <span className="mt-2 inline-block rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-neutral-900">
                  {banner.botao_texto}
                </span>
              )}
            </div>
          </motion.button>
        </AnimatePresence>
      </div>

      {total > 1 && (
        <>
          {mostrarSetas && (
            <>
              <SetaCarrossel onClick={anterior} lado="esquerda" />
              <SetaCarrossel onClick={proximo} lado="direita" />
            </>
          )}

          {mostrarIndicadores && (
            <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2 pointer-events-none">
              {banners.map((_, i) => (
                <button
                  key={i}
                  onClick={() => ir(i)}
                  aria-label={`Ir para slide ${i + 1}`}
                  className={cn(
                    'h-2 rounded-full bg-white/50 backdrop-blur transition-all pointer-events-auto',
                    i === atual ? 'w-7 bg-white' : 'w-2 hover:bg-white/80',
                  )}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SetaCarrossel({ onClick, lado }: { onClick: () => void; lado: 'esquerda' | 'direita' }) {
  const Icone = lado === 'esquerda' ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick}
      aria-label={lado === 'esquerda' ? 'Slide anterior' : 'Próximo slide'}
      className={cn(
        'absolute top-1/2 hidden -translate-y-1/2 sm:flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-all hover:bg-black/60 hover:scale-110',
        lado === 'esquerda' ? 'left-3' : 'right-3',
      )}
    >
      <Icone className="size-5" />
    </button>
  );
}

function ImagemBanner({ src, alt }: { src: string; alt: string }) {
  const [erro, setErro] = useState(false);
  if (erro) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/40 to-rose-700">
        <ImageOff className="size-12 text-white/40" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setErro(true)}
      className="h-full w-full object-cover"
      draggable={false}
    />
  );
}
