/**
 * Vitrine do cliente — landing com banners, ofertas, busca global e atalhos.
 */
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTema } from '@/lib/tema';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Flame, Clock, Bike, Store, X, Star, Heart, Check } from 'lucide-react';
import { BannerCarousel } from '@/components/banner-carousel';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api, sessaoUsuario } from '@/lib/api';
import { brl } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Banner, Loja, ProdutoPromocao, CategoriaContagem } from '@/types';

const EMOJI: Record<string, string> = {
  Pizzaria: '🍕', Hamburgueria: '🍔', Japonesa: '🍣',
  Brasileira: '🍛', 'Doces e bolos': '🧁', Mercado: '🛒', Outros: '🍽️',
};

interface ProdutoBusca {
  id: number;
  nome: string;
  descricao: string;
  preco_centavos: number;
  preco_promocional_centavos: number | null;
  foto_url: string;
  loja_id: number;
  loja_nome: string;
  loja_aberta: 0 | 1;
}

export function PaginaVitrine() {
  const { marca } = useTema();
  const usuario = sessaoUsuario();
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState<string | null>(null);
  const [soFavoritos, setSoFavoritos] = useState(false);
  const [fAberto, setFAberto] = useState(false);
  const [fFrete, setFFrete] = useState(false);
  const [fAvaliado, setFAvaliado] = useState(false);

  const lojaUnica = marca.loja_id > 0;
  const buscaAtiva = busca.trim().length >= 2;

  const banners = useQuery({
    queryKey: ['banners'],
    queryFn: () => api<{ banners: Banner[] }>('GET', '/api/banners').then(r => r.banners),
    enabled: !lojaUnica,
  });

  const destaques = useQuery({
    queryKey: ['destaques'],
    queryFn: () => api<{ promocoes: ProdutoPromocao[]; categorias: CategoriaContagem[] }>(
      'GET', '/api/destaques',
    ),
    enabled: !lojaUnica,
  });

  const lojas = useQuery({
    queryKey: ['lojas', { categoria }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (categoria) params.set('categoria', categoria);
      const qs = params.toString();
      return api<{ lojas: Loja[] }>('GET', '/api/lojas' + (qs ? '?' + qs : '')).then(r => r.lojas);
    },
    enabled: !lojaUnica,
  });

  // Busca global de produtos + lojas (só dispara com 2+ caracteres).
  const resultados = useQuery({
    queryKey: ['buscar', busca.trim()],
    queryFn: () => api<{ produtos: ProdutoBusca[]; lojas: Loja[] }>(
      'GET', `/api/buscar?q=${encodeURIComponent(busca.trim())}`),
    enabled: !lojaUnica && buscaAtiva,
  });

  // Favoritos do cliente (só logado).
  const favoritos = useQuery({
    queryKey: ['favoritos'],
    queryFn: () => api<{ lojas: Loja[]; ids: number[] }>('GET', '/api/cliente/favoritos'),
    enabled: !lojaUnica && !!usuario,
  });
  const favIds = new Set(favoritos.data?.ids ?? []);

  async function alternarFavorito(loja: Loja) {
    if (!usuario) return;
    const eraFav = favIds.has(loja.id);
    try {
      await api(eraFav ? 'DELETE' : 'POST', `/api/cliente/favoritos/${loja.id}`);
      qc.invalidateQueries({ queryKey: ['favoritos'] });
    } catch { /* silencioso */ }
  }

  if (lojaUnica) {
    return <Navigate to={`/loja/${marca.loja_id}`} replace />;
  }

  // Lista exibida: favoritos, ou resultado de busca, ou lojas normais.
  const baseLojas = soFavoritos
    ? (favoritos.data?.lojas ?? [])
    : buscaAtiva
    ? (resultados.data?.lojas ?? [])
    : (lojas.data ?? []);

  // Filtros rápidos (aberto / frete grátis / melhor avaliado).
  let listaLojas = baseLojas;
  if (fAberto) listaLojas = listaLojas.filter(l => !!l.aberta);
  if (fFrete) listaLojas = listaLojas.filter(l => l.taxa_entrega_centavos === 0);
  if (fAvaliado) listaLojas = [...listaLojas].sort((a, b) => (b.nota_media ?? 0) - (a.nota_media ?? 0));
  const temFiltro = fAberto || fFrete || fAvaliado;
  function limparFiltros() { setFAberto(false); setFFrete(false); setFAvaliado(false); }

  const temFavoritos = (favoritos.data?.ids.length ?? 0) > 0;

  return (
    <div className="space-y-5">
      {!buscaAtiva && banners.data && banners.data.length > 0 && (
        <div className="-mx-4">
          <BannerCarousel banners={banners.data} />
        </div>
      )}

      {/* Barra de busca */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 size-4.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar loja ou comida…"
          className="pl-11 pr-10 h-12 rounded-2xl"
        />
        {busca && (
          <button
            onClick={() => setBusca('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* ───────── Modo busca ───────── */}
      {buscaAtiva ? (
        <BuscaResultados
          carregando={resultados.isLoading}
          produtos={resultados.data?.produtos ?? []}
          lojas={resultados.data?.lojas ?? []}
          favIds={favIds}
          podeFavoritar={!!usuario}
          onToggleFav={alternarFavorito}
        />
      ) : (
        <>
          {/* Chips de categoria + favoritos */}
          {destaques.data && destaques.data.categorias.length > 0 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1 snap-x">
              <Chip
                ativo={!categoria && !soFavoritos}
                onClick={() => { setCategoria(null); setSoFavoritos(false); }}
                icone={<Store className="size-3.5" />}
                label="Todas"
              />
              {usuario && temFavoritos && (
                <Chip
                  ativo={soFavoritos}
                  onClick={() => { setSoFavoritos(s => !s); setCategoria(null); }}
                  icone={<Heart className={cn('size-3.5', soFavoritos && 'fill-current')} />}
                  label="Favoritos"
                />
              )}
              {destaques.data.categorias.map(c => (
                <Chip
                  key={c.categoria}
                  ativo={categoria === c.categoria}
                  onClick={() => { setCategoria(categoria === c.categoria ? null : c.categoria); setSoFavoritos(false); }}
                  icone={<span>{EMOJI[c.categoria] || '🍽️'}</span>}
                  label={c.categoria}
                  sufixo={`(${c.qtd})`}
                />
              ))}
            </div>
          )}

          {/* Filtros rápidos */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1">
            <FiltroPill ativo={fAberto} onClick={() => setFAberto(v => !v)} label="Aberto agora" icone="🟢" />
            <FiltroPill ativo={fFrete} onClick={() => setFFrete(v => !v)} label="Frete grátis" icone="🛵" />
            <FiltroPill ativo={fAvaliado} onClick={() => setFAvaliado(v => !v)} label="Melhor avaliado" icone="⭐" />
            {temFiltro && (
              <button
                onClick={limparFiltros}
                className="shrink-0 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground whitespace-nowrap"
              >
                <X className="size-3.5" /> limpar
              </button>
            )}
          </div>

          {/* Ofertas imperdíveis */}
          {!soFavoritos && !temFiltro && destaques.data && destaques.data.promocoes.length > 0 && (
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="flex items-center gap-2 font-bold text-base">
                  <Flame className="size-4.5 text-primary" />
                  Ofertas imperdíveis
                </h2>
                <span className="text-xs text-muted-foreground">deslize ↔</span>
              </div>
              <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-2 snap-x snap-mandatory">
                {destaques.data.promocoes.map(p => (
                  <CardPromocao key={p.id} produto={p} />
                ))}
              </div>
            </section>
          )}

          {/* Lojas */}
          <section>
            <h2 className="flex items-center gap-2 font-bold text-base mb-3">
              {soFavoritos
                ? <><Heart className="size-4.5 text-primary fill-primary" /> Seus favoritos</>
                : <><Store className="size-4.5 text-primary" /> {categoria || 'Restaurantes'}</>}
            </h2>

            {((soFavoritos ? favoritos.isLoading : lojas.isLoading)) && (
              <div className="space-y-4">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-52 rounded-2xl" />)}
              </div>
            )}

            {listaLojas.length === 0 && !(soFavoritos ? favoritos.isLoading : lojas.isLoading) && (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                <div className="text-4xl">{soFavoritos && !temFiltro ? '💔' : '🔍'}</div>
                <p className="font-semibold text-muted-foreground">
                  {temFiltro ? 'Nenhuma loja com esses filtros' : soFavoritos ? 'Nenhum favorito ainda' : 'Nenhuma loja encontrada'}
                </p>
                {temFiltro
                  ? <button onClick={limparFiltros} className="text-sm text-primary font-semibold hover:underline">Limpar filtros</button>
                  : soFavoritos
                  ? <p className="text-sm text-muted-foreground">Toque no ♥ de uma loja para salvá-la aqui.</p>
                  : <button onClick={() => setCategoria(null)} className="text-sm text-primary font-semibold hover:underline">Limpar filtros</button>}
              </div>
            )}

            <div className="space-y-4">
              {listaLojas.map(l => (
                <CardLoja
                  key={l.id}
                  loja={l}
                  favorito={favIds.has(l.id)}
                  podeFavoritar={!!usuario}
                  onToggleFav={() => alternarFavorito(l)}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Chip({ ativo, onClick, icone, label, sufixo }: {
  ativo: boolean; onClick: () => void; icone: React.ReactNode; label: string; sufixo?: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={cn(
        'snap-start shrink-0 flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold border-2 transition-all whitespace-nowrap',
        ativo
          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
          : 'border-border bg-card text-muted-foreground hover:border-primary/50',
      )}
    >
      {icone}
      <span>{label}</span>
      {sufixo && <span className={cn('text-xs font-normal', ativo ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{sufixo}</span>}
    </motion.button>
  );
}

function FiltroPill({ ativo, onClick, label, icone }: {
  ativo: boolean; onClick: () => void; label: string; icone: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={cn(
        'snap-start shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border transition-all whitespace-nowrap',
        ativo
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-card text-muted-foreground hover:border-primary/40',
      )}
    >
      <span>{icone}</span>
      <span>{label}</span>
      {ativo && <Check className="size-3" />}
    </motion.button>
  );
}

function BuscaResultados({ carregando, produtos, lojas, favIds, podeFavoritar, onToggleFav }: {
  carregando: boolean;
  produtos: ProdutoBusca[];
  lojas: Loja[];
  favIds: Set<number>;
  podeFavoritar: boolean;
  onToggleFav: (loja: Loja) => void;
}) {
  if (carregando) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>;
  }

  if (produtos.length === 0 && lojas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
        <div className="text-4xl">🔍</div>
        <p className="font-semibold text-muted-foreground">Nada encontrado</p>
        <p className="text-sm text-muted-foreground">Tente outro termo.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {produtos.length > 0 && (
        <section>
          <h2 className="font-bold text-base mb-3">Pratos ({produtos.length})</h2>
          <div className="space-y-2">
            <AnimatePresence>
              {produtos.map(p => <LinhaProduto key={p.id} produto={p} />)}
            </AnimatePresence>
          </div>
        </section>
      )}
      {lojas.length > 0 && (
        <section>
          <h2 className="font-bold text-base mb-3">Lojas ({lojas.length})</h2>
          <div className="space-y-4">
            {lojas.map(l => (
              <CardLoja key={l.id} loja={l} favorito={favIds.has(l.id)} podeFavoritar={podeFavoritar} onToggleFav={() => onToggleFav(l)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function LinhaProduto({ produto }: { produto: ProdutoBusca }) {
  const temPromo = !!produto.preco_promocional_centavos && produto.preco_promocional_centavos > 0;
  const preco = temPromo ? produto.preco_promocional_centavos! : produto.preco_centavos;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <Link
        to={`/loja/${produto.loja_id}?produto=${produto.id}`}
        className="flex gap-3 rounded-2xl border border-border/60 bg-card p-2.5 hover:shadow-md transition-all active:scale-[0.99]"
      >
        <div className="size-16 rounded-xl overflow-hidden bg-gradient-to-br from-orange-100 to-rose-200 shrink-0 flex items-center justify-center">
          {produto.foto_url
            ? <img src={produto.foto_url} alt="" className="size-full object-cover" />
            : <span className="text-2xl opacity-50">🍽️</span>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">{produto.loja_nome}</div>
          <div className="font-bold text-sm leading-tight line-clamp-1">{produto.nome}</div>
          {produto.descricao && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{produto.descricao}</p>}
          <div className="flex items-baseline gap-2 mt-1">
            {temPromo && <span className="text-xs text-muted-foreground line-through">{brl(produto.preco_centavos)}</span>}
            <span className={cn('font-extrabold text-sm', temPromo ? 'text-success' : 'text-foreground')}>{brl(preco)}</span>
            {!produto.loja_aberta && <span className="text-[10px] text-muted-foreground">· loja fechada</span>}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function CardPromocao({ produto }: { produto: ProdutoPromocao }) {
  return (
    <Link
      to={`/loja/${produto.loja_id}?produto=${produto.id}`}
      className="snap-start shrink-0 w-52 rounded-2xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-lg transition-all hover:-translate-y-0.5 active:scale-[0.98]"
    >
      <div className="relative h-36 bg-gradient-to-br from-orange-300 to-rose-400 flex items-center justify-center text-5xl overflow-hidden">
        {produto.foto_url ? (
          <img src={produto.foto_url} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <span className="opacity-60">🍕</span>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
        <Badge variant="promo" className="absolute right-2 top-2 text-[10px] font-bold shadow-sm">PROMO</Badge>
      </div>
      <div className="p-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">
          {produto.loja_nome}
        </div>
        <div className="font-bold text-sm leading-tight line-clamp-1 mt-0.5">{produto.nome}</div>
        <div className="flex items-baseline gap-2 mt-1.5">
          <span className="text-xs text-muted-foreground line-through">{brl(produto.preco_centavos)}</span>
          <span className="font-extrabold text-success text-sm">{brl(produto.preco_promocional_centavos!)}</span>
        </div>
      </div>
    </Link>
  );
}

function CardLoja({ loja, favorito, podeFavoritar, onToggleFav }: {
  loja: Loja; favorito: boolean; podeFavoritar: boolean; onToggleFav: () => void;
}) {
  return (
    <Link to={`/loja/${loja.id}`} className="block group">
      <motion.div
        whileTap={{ scale: 0.98 }}
        className="rounded-2xl overflow-hidden border border-border/60 bg-card shadow-sm hover:shadow-md transition-all"
      >
        {/* Cover image */}
        <div className="relative h-36 overflow-hidden bg-gradient-to-br from-orange-100 to-rose-200">
          {loja.capa_url ? (
            <img
              src={loja.capa_url}
              alt=""
              className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-6xl opacity-15">
              {EMOJI[loja.categoria] || '🍽️'}
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />

          {/* Heart favorito (canto superior esquerdo) */}
          {podeFavoritar && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFav(); }}
              aria-label={favorito ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
              className="absolute top-3 left-3 flex size-9 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition-transform active:scale-90 hover:bg-black/55"
            >
              <Heart className={cn('size-4.5 transition-colors', favorito ? 'fill-red-500 text-red-500' : 'text-white')} />
            </button>
          )}

          {/* Open/closed badge top-right */}
          <div className="absolute top-3 right-3">
            <span className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold shadow-sm',
              loja.aberta ? 'bg-emerald-500 text-white' : 'bg-black/60 text-white/80 backdrop-blur-sm',
            )}>
              {loja.aberta ? '● Aberta' : '● Fechada'}
            </span>
          </div>

          {/* Floating logo */}
          <div className="absolute -bottom-5 left-4">
            {loja.logo_url ? (
              <img
                src={loja.logo_url}
                alt={loja.nome}
                className="size-14 rounded-xl object-cover border-2 border-background shadow-md"
              />
            ) : (
              <div className="flex size-14 items-center justify-center rounded-xl bg-card border-2 border-background shadow-md text-2xl">
                {EMOJI[loja.categoria] || '🍽️'}
              </div>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="px-4 pt-8 pb-4">
          <h3 className="font-bold leading-tight text-base">{loja.nome}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {loja.categoria}{loja.descricao ? ` · ${loja.descricao}` : ''}
          </p>
          <div className="flex items-center gap-4 mt-2.5 text-xs font-medium text-muted-foreground">
            {!!loja.nota_qtd && loja.nota_qtd > 0 && (
              <span className="flex items-center gap-1 font-bold text-amber-500">
                <Star className="size-3.5 fill-amber-400 text-amber-400" />
                {loja.nota_media?.toFixed(1)}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Bike className="size-3.5" />
              {loja.taxa_entrega_centavos === 0 ? 'Grátis' : brl(loja.taxa_entrega_centavos)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5" />
              {loja.tempo_estimado_min} min
            </span>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
