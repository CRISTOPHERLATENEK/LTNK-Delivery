import { useEffect } from 'react';
import { Star, Clock, Bike, ChevronLeft, ChevronRight } from 'lucide-react';
import { foregroundContraste, injetarFonteLink } from '@/lib/tema';
import { FONTES_VISUAL, corOuPadrao, estiloBotao, classNameBotao } from '@/lib/visual';
import type { EstadoVisual } from './types';

interface Props {
  estado: EstadoVisual;
  lojaId: number | null;
}

const RAIO_LOGO = { quadrado: '10%', arredondado: '28%', circular: '50%' };

/**
 * Mockup do celular — moldura desenhada em CSS (não imagem), reage a cada
 * campo do `estado` via re-render normal (sem debounce: não há chamada de
 * rede por tecla, tudo local até o Salvar).
 */
export function PhonePreview({ estado }: Props) {
  const cor = estado.cor_marca || '#dc2640';
  const fg = foregroundContraste(cor) === '0 0% 100%' ? '#fff' : '#111';
  const fonte = FONTES_VISUAL[estado.tipografia.fonte] ?? FONTES_VISUAL.inter;

  useEffect(() => {
    injetarFonteLink(fonte, 'fonte-preview-visual');
  }, [fonte]);

  const corCabecalho = corOuPadrao(estado.cores.cor_cabecalho, cor);
  const corFundo = corOuPadrao(estado.cores.cor_fundo, '#f7f7f5');
  const corCards = corOuPadrao(estado.cores.cor_cards, '#ffffff');
  const corTexto = corOuPadrao(estado.cores.cor_texto, '#1f1f1f');
  const corBadges = corOuPadrao(estado.cores.cor_badges, '#16a34a');
  const corRodape = corOuPadrao(estado.cores.cor_rodape, '#1a1a1a');

  const raioLogo = RAIO_LOGO[estado.logo.formato];

  const produtos = ['Produto exemplo A', 'Produto exemplo B', 'Produto exemplo C'];
  const grid = estado.cardapio.layout === 'grid' || estado.cardapio.layout === 'premium';

  return (
    <div className="mx-auto w-[300px] select-none">
      <style>{`
        @keyframes botao-preview-scale { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }
        @keyframes botao-preview-glow { 0%,100%{box-shadow:0 0 0 0 rgba(0,0,0,.25)} 50%{box-shadow:0 0 0 6px rgba(0,0,0,0)} }
        @keyframes botao-preview-fade { 0%,100%{opacity:1} 50%{opacity:.7} }
        .botao-anim-scale{ animation: botao-preview-scale 1.4s ease-in-out infinite; }
        .botao-anim-glow{ animation: botao-preview-glow 1.4s ease-in-out infinite; }
        .botao-anim-fade{ animation: botao-preview-fade 1.4s ease-in-out infinite; }
        .botao-anim-ripple:active{ opacity:.7 }
      `}</style>

      <div className="overflow-hidden rounded-[2.5rem] border-8 border-neutral-900 bg-neutral-900 shadow-2xl">
        {/* Status bar */}
        <div className="flex items-center justify-between px-5 py-1.5 text-[10px] font-semibold text-white" style={{ backgroundColor: corCabecalho }}>
          <span>9:41</span>
          <div className="absolute left-1/2 top-1 h-4 w-20 -translate-x-1/2 rounded-full bg-neutral-900" />
          <span>📶 🔋</span>
        </div>

        {/* Tela */}
        <div className="h-[560px] overflow-y-auto" style={{ backgroundColor: corFundo, fontFamily: fonte.stack, fontWeight: estado.tipografia.peso, letterSpacing: `${estado.tipografia.espacamento / 100}px`, fontSize: estado.tipografia.tamanho_base, lineHeight: estado.tipografia.altura_linha, color: corTexto }}>
          {/* Hero (capa + logo) */}
          <div className="relative h-32 overflow-hidden" style={{ backgroundColor: corCabecalho }}>
            {estado.capa_url && (
              <img src={estado.capa_url} alt="" className="absolute inset-0 size-full"
                style={{
                  objectFit: estado.capa.ajuste === 'repeat' ? 'cover' : estado.capa.ajuste,
                  filter: estado.capa.blur ? `blur(${estado.capa.blur}px)` : undefined,
                  opacity: estado.capa.opacidade / 100,
                  objectPosition: estado.capa.posicao === 'topo' ? 'top' : estado.capa.posicao === 'base' ? 'bottom' : 'center',
                }} />
            )}
            {estado.capa.gradiente && (
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,.7), rgba(0,0,0,.1) 60%, transparent)' }} />
            )}
            {estado.capa.overlay && (
              <div className="absolute inset-0" style={{ backgroundColor: `rgba(0,0,0,${estado.capa.escurecimento / 100})` }} />
            )}
            <div className="absolute bottom-0 left-0 right-0 flex items-end gap-2.5 px-3 pb-2.5">
              <div
                className="flex shrink-0 items-center justify-center overflow-hidden bg-white text-lg font-extrabold"
                style={{
                  width: estado.logo.tamanho * 0.55, height: estado.logo.tamanho * 0.55,
                  borderRadius: raioLogo,
                  boxShadow: estado.logo.sombra ? '0 4px 10px rgba(0,0,0,.35)' : undefined,
                  border: estado.logo.borda_branca ? '2.5px solid #fff' : estado.logo.borda ? `2px solid ${cor}` : undefined,
                  padding: estado.logo.padding ? 4 : 0,
                }}>
                {estado.logo_url
                  ? <img src={estado.logo_url} alt="" className="size-full object-contain" />
                  : <span style={{ color: cor }}>{(estado.nome || 'L').charAt(0)}</span>}
              </div>
              <div className="min-w-0 pb-0.5">
                <p className="truncate text-sm font-extrabold text-white drop-shadow">{estado.nome || 'Sua loja'}</p>
                {estado.geral.slogan && <p className="truncate text-[10px] text-white/80 drop-shadow">{estado.geral.slogan}</p>}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[9px] font-semibold text-white/85 drop-shadow">
                  {estado.geral.mostrar_avaliacao && <span className="flex items-center gap-0.5"><Star className="size-2.5 fill-amber-400 text-amber-400" /> 4.8</span>}
                  {estado.geral.mostrar_tempo_medio && <span className="flex items-center gap-0.5"><Clock className="size-2.5" /> 30 min</span>}
                  {estado.geral.mostrar_taxa_entrega && <span className="flex items-center gap-0.5"><Bike className="size-2.5" /> Grátis</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Banner fake */}
          <div className="relative m-2.5 h-16 overflow-hidden rounded-xl" style={{ backgroundColor: cor + '22' }}>
            <div className="flex h-full items-center justify-center text-[11px] font-bold" style={{ color: cor }}>Banner promocional</div>
            {estado.banners.mostrar_setas && (
              <>
                <ChevronLeft className="absolute left-1 top-1/2 size-4 -translate-y-1/2 text-black/40" />
                <ChevronRight className="absolute right-1 top-1/2 size-4 -translate-y-1/2 text-black/40" />
              </>
            )}
            {estado.banners.mostrar_indicadores && (
              <div className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 gap-1">
                <span className="size-1.5 rounded-full bg-black/60" />
                <span className="size-1.5 rounded-full bg-black/25" />
                <span className="size-1.5 rounded-full bg-black/25" />
              </div>
            )}
          </div>

          {/* Produtos */}
          <div className={grid ? 'grid grid-cols-2 gap-2 px-2.5' : 'flex flex-col gap-2 px-2.5'}>
            {produtos.slice(0, grid ? 4 : 3).map((nome, i) => (
              <div key={nome} className="overflow-hidden shadow-sm"
                style={{
                  backgroundColor: corCards,
                  borderRadius: estado.cardapio.raio_bordas,
                  height: grid ? estado.cardapio.altura_cards * 0.55 : undefined,
                }}>
                <div className={grid ? 'flex h-full flex-col' : 'flex items-center gap-2 p-2'}>
                  {estado.cardapio.mostrar_foto && (
                    <div className={grid ? 'h-1/2 w-full bg-muted' : 'size-11 shrink-0 rounded-lg bg-muted'} />
                  )}
                  <div className="min-w-0 flex-1 p-1.5">
                    <div className="flex items-start justify-between gap-1">
                      <p className="truncate text-[11px] font-semibold">{nome}</p>
                      {estado.cardapio.badge_promocao && i === 0 && (
                        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold text-white" style={{ backgroundColor: corBadges }}>-10%</span>
                      )}
                    </div>
                    {estado.cardapio.mostrar_descricao && <p className="truncate text-[9px] text-muted-foreground">Descrição do produto de exemplo</p>}
                    <div className="mt-1 flex items-center justify-between gap-1">
                      {estado.cardapio.preco_destacado
                        ? <span className="text-xs font-extrabold">R$ 24,90</span>
                        : <span className="text-[10px]">R$ 24,90</span>}
                      {estado.cardapio.botao_comprar && (
                        <button type="button" className={classNameBotao(estado)}
                          style={{ ...estiloBotao(estado, cor), color: fg, padding: '3px 10px', fontSize: 10 }}>
                          +
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="h-6" />
          <div className="h-2" style={{ backgroundColor: corRodape }} />
        </div>
      </div>
    </div>
  );
}
