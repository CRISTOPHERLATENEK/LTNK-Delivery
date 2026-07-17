import { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useTema, injetarFonteLink, foregroundContraste } from '@/lib/tema';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Bike, Clock, Plus, Minus, Star, Search, X, ShoppingBag, Trash2, Check, ArrowRight, ShoppingCart, UtensilsCrossed } from 'lucide-react';
import { api } from '@/lib/api';
import { brl } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { adicionarAoCarrinho, useCarrinho, mudarQuantidade } from '@/lib/carrinho';
import { iconeCategoria } from '@/lib/icones-categoria';
import { ModalProduto } from './modal-produto';
import { BannerCarousel } from '@/components/banner-carousel';
import {
  parseVisualJson, corOuPadrao, estiloBotaoIcone, classNameBotao, FONTES_VISUAL,
  injetarAnalytics, removerAnalytics,
} from '@/lib/visual';
import type { Loja, Produto, Banner, VisualJson } from '@/types';

interface CategoriaMeta { nome: string; icone: string; ordem: number; imagem?: string }
interface RespostaCardapio {
  loja: Loja & { categoria_estilo?: 'cards' | 'chips' };
  cardapio: Record<string, Produto[]>;
  categorias_meta?: CategoriaMeta[];
  banners: Banner[];
}

type ProdutoComCat = Produto & { _cat: string };

export function PaginaLoja() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [produtoAberto, setProdutoAberto] = useState<Produto | null>(null);
  const [catAtiva, setCatAtiva] = useState<string | null>(null);
  const [subCatAtiva, setSubCatAtiva] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [adicionado, setAdicionado] = useState<Produto | null>(null);
  const { aplicarCorPrimaria, resetarCorPrimaria, aplicarFaviconLoja, resetarFavicon, marca } = useTema();

  const consulta = useQuery({
    queryKey: ['cardapio', id],
    queryFn: () => api<RespostaCardapio>('GET', `/api/lojas/${id}`),
    enabled: !!id,
  });

  // Modo preview: esta página roda dentro de um <iframe> no editor "Visual"
  // do lojista (visual/PhonePreview.tsx), same-origin, recebendo por
  // postMessage o estado AINDA NÃO SALVO do formulário — assim o preview do
  // editor é literalmente esta mesma página renderizando de verdade, sem
  // duplicar CSS/lógica em dois lugares que puderiam divergir.
  const modoPreview = searchParams.get('preview') === '1';
  const [previewOverride, setPreviewOverride] = useState<any | null>(null);
  useEffect(() => {
    if (!modoPreview) return;
    function aoReceberMensagem(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'visual-preview') setPreviewOverride(e.data.payload);
    }
    window.addEventListener('message', aoReceberMensagem);
    try { window.parent.postMessage({ type: 'preview-ready' }, window.location.origin); } catch { /* sem parent */ }
    return () => window.removeEventListener('message', aoReceberMensagem);
  }, [modoPreview]);

  const corMarcaEfetiva = previewOverride?.cor_marca ?? consulta.data?.loja.cor_marca;
  const corSecundariaEfetiva = previewOverride?.cor_secundaria ?? consulta.data?.loja.cor_secundaria;
  // Reage também a `marca`: o tema da PLATAFORMA (/api/tema) carrega em
  // paralelo com o cardápio desta loja, e se resolver DEPOIS ele sobrescreve
  // --primary de volta pro padrão da plataforma. Incluir `marca` nas
  // dependências faz reaplicar a cor da loja assim que isso acontecer —
  // sem isso, dava pra "ganhar a corrida" e a cor ficar errada (ou piscar).
  useEffect(() => {
    if (corMarcaEfetiva) aplicarCorPrimaria(corMarcaEfetiva, corSecundariaEfetiva);
    return () => { resetarCorPrimaria(); };
  }, [corMarcaEfetiva, corSecundariaEfetiva, aplicarCorPrimaria, resetarCorPrimaria, marca]);

  // Favicon próprio da loja na aba do navegador enquanto o cliente navega
  // nela — volta pro favicon da plataforma ao sair. Mesma corrida do tema
  // acima: reage a `marca` pra reaplicar se a plataforma sobrescrever depois.
  const faviconEfetivo = previewOverride?.favicon_url ?? consulta.data?.loja.favicon_url;
  useEffect(() => {
    if (faviconEfetivo) aplicarFaviconLoja(faviconEfetivo);
    return () => { resetarFavicon(); };
  }, [faviconEfetivo, aplicarFaviconLoja, resetarFavicon, marca]);

  // Deep link: ?produto=ID
  useEffect(() => {
    const produtoIdParam = searchParams.get('produto');
    if (!produtoIdParam || !consulta.data) return;
    const pid = Number(produtoIdParam);
    const todos = Object.values(consulta.data.cardapio).flat();
    const encontrado = todos.find(p => p.id === pid);
    if (encontrado) {
      setProdutoAberto(encontrado);
      setSearchParams(p => { p.delete('produto'); return p; }, { replace: true });
    }
  }, [searchParams, consulta.data, setSearchParams]);

  // Visual completo da loja (editor "Visual" do lojista) — parse feito uma
  // vez aqui em cima, reusado no resto do componente e nos efeitos abaixo
  // (que precisam rodar ANTES do early-return de loading, regra dos hooks).
  // Em modo preview, os 9 blocos do visual_json vêm do override (postMessage)
  // em vez do que está salvo no banco.
  const visualSalvo: VisualJson = parseVisualJson((consulta.data as any)?.loja?.visual_json);
  const visual: VisualJson = previewOverride ? {
    geral: previewOverride.geral, cores: previewOverride.cores, logo: previewOverride.logo,
    capa: previewOverride.capa, cardapio: previewOverride.cardapio, botoes: previewOverride.botoes,
    tipografia: previewOverride.tipografia, banners: previewOverride.banners, avancado: previewOverride.avancado,
  } : visualSalvo;
  const fonteLoja = FONTES_VISUAL[visual.tipografia.fonte];

  // Fonte da LOJA — só o <link> do Google Fonts, sem sobrescrever
  // document.body.style.fontFamily global (isso vazaria pro resto do app
  // quando o cliente navegar pra fora da página da loja).
  useEffect(() => {
    injetarFonteLink(fonteLoja, 'fonte-loja');
  }, [fonteLoja]);

  // Analytics/pixels da loja (visual_json.avancado) — só na página pública
  // de verdade, nunca dentro do iframe de preview do editor.
  useEffect(() => {
    if (consulta.data && !modoPreview) injetarAnalytics(visual.avancado);
    return () => { removerAnalytics(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(visual.avancado), !!consulta.data, modoPreview]);

  if (consulta.isLoading) return <Skeleton_Loja />;
  if (!consulta.data) return null;

  const { cardapio, banners } = consulta.data;
  const loja = previewOverride ? {
    ...consulta.data.loja,
    nome: previewOverride.nome ?? consulta.data.loja.nome,
    cor_marca: previewOverride.cor_marca ?? consulta.data.loja.cor_marca,
    cor_secundaria: previewOverride.cor_secundaria ?? consulta.data.loja.cor_secundaria,
    logo_url: previewOverride.logo_url ?? consulta.data.loja.logo_url,
    capa_url: previewOverride.capa_url ?? consulta.data.loja.capa_url,
    favicon_url: previewOverride.favicon_url ?? consulta.data.loja.favicon_url,
  } : consulta.data.loja;
  const modoWhiteLabel = marca.loja_id > 0;
  const estiloCat: 'cards' | 'chips' = loja.categoria_estilo === 'chips' ? 'chips' : 'cards';
  const metaCat: CategoriaMeta[] = consulta.data.categorias_meta?.length
    ? consulta.data.categorias_meta
    : Object.keys(cardapio).map((nome, i) => ({ nome, icone: '', ordem: i }));
  const categorias = metaCat.map(c => c.nome);

  // Achata todos os produtos com sua categoria
  const todosComCat: ProdutoComCat[] = Object.entries(cardapio).flatMap(
    ([cat, prods]) => prods.map(p => ({ ...p, _cat: cat }))
  );

  // Subcategorias disponíveis para a categoria ativa
  const subcategorias: string[] = catAtiva
    ? [...new Set(
        (cardapio[catAtiva] ?? [])
          .map(p => p.subcategoria)
          .filter((s): s is string => !!s)
      )]
    : [];

  function selecionarCat(cat: string | null) {
    setCatAtiva(cat);
    setSubCatAtiva(null);
  }

  // Aplica filtros
  const buscaLower = busca.toLowerCase();
  const filtrados = todosComCat.filter(p => {
    const matchCat = !catAtiva || p._cat === catAtiva;
    const matchSubCat = !subCatAtiva || p.subcategoria === subCatAtiva;
    const matchBusca = !busca ||
      p.nome.toLowerCase().includes(buscaLower) ||
      (p.descricao?.toLowerCase().includes(buscaLower) ?? false);
    return matchCat && matchSubCat && matchBusca;
  });

  // Modo sem filtro: agrupa por categoria (com subcategorias dentro)
  const semFiltro = !catAtiva && !busca;
  // Categoria selecionada sem subcategoria: agrupa por subcategoria dentro da cat
  const catSemSubfiltro = !!catAtiva && !subCatAtiva && !busca && subcategorias.length > 0;
  const categoriasFiltradas = semFiltro ? categorias : [];

  function handleClickProduto(p: Produto) {
    if (!loja.aberta) return;
    const temGrupos = p.grupos && p.grupos.length > 0;
    if (!temGrupos) {
      const precoBase = p.preco_promocional_centavos && p.preco_promocional_centavos > 0
        ? p.preco_promocional_centavos : p.preco_centavos;
      const ok = adicionarAoCarrinho(loja, {
        produto_id: p.id, nome: p.nome, preco_centavos: precoBase, quantidade: 1, opcoes: [], opcoes_texto: '', foto_url: p.foto_url,
      });
      if (ok) setAdicionado(p);
      return;
    }
    setProdutoAberto(p);
  }

  const RAIO_LOGO: Record<VisualJson['logo']['formato'], string> = { quadrado: '10%', arredondado: '28%', circular: '50%' };
  const estiloTipografia: React.CSSProperties = {
    fontFamily: fonteLoja.stack,
    fontWeight: visual.tipografia.peso,
    letterSpacing: `${visual.tipografia.espacamento / 100}px`,
    fontSize: visual.tipografia.tamanho_base,
    lineHeight: visual.tipografia.altura_linha,
    color: visual.cores.cor_texto || undefined,
  };

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_330px] lg:gap-6" style={estiloTipografia}>
    <div className="-mx-4 lg:mx-0 min-w-0">
      {/* ── HERO ── */}
      <div className="relative lg:rounded-3xl lg:overflow-hidden">
        <div className="relative h-44 sm:h-52 overflow-hidden bg-gradient-to-br from-primary/30 via-primary/10 to-muted"
          style={{ backgroundColor: visual.cores.cor_cabecalho || undefined }}>
          {loja.capa_url && (
            <img src={loja.capa_url} alt="" className="absolute inset-0 size-full object-cover"
              style={{
                objectFit: visual.capa.ajuste === 'repeat' ? 'cover' : visual.capa.ajuste,
                objectPosition: visual.capa.posicao === 'topo' ? 'top' : visual.capa.posicao === 'base' ? 'bottom' : 'center',
                filter: visual.capa.blur ? `blur(${visual.capa.blur}px)` : undefined,
                opacity: visual.capa.opacidade / 100,
              }} />
          )}
          {visual.capa.gradiente && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          )}
          {visual.capa.overlay && (
            <div className="absolute inset-0" style={{ backgroundColor: `rgba(0,0,0,${visual.capa.escurecimento / 100})` }} />
          )}

          {!modoWhiteLabel && (
            <Link
              to="/"
              className="absolute top-4 left-4 flex size-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm"
            >
              <ArrowLeft className="size-4" />
            </Link>
          )}

          <div className="absolute top-4 right-4">
            <Badge variant={loja.aberta ? 'success' : 'secondary'} className="shadow text-xs">
              {loja.aberta ? '● Aberta' : '● Fechada'}
            </Badge>
          </div>

          {/* Info sobreposta ao hero */}
          <div className="absolute bottom-0 left-0 right-0 px-4 pb-4 flex items-end gap-3">
            <div className="shrink-0 overflow-hidden bg-white"
              style={{
                width: visual.logo.tamanho, height: visual.logo.tamanho,
                borderRadius: RAIO_LOGO[visual.logo.formato],
                boxShadow: visual.logo.sombra ? '0 8px 20px rgba(0,0,0,.35)' : undefined,
                border: visual.logo.borda_branca ? '3px solid rgba(255,255,255,.9)' : visual.logo.borda ? `3px solid ${loja.cor_marca || '#dc2640'}` : undefined,
                padding: visual.logo.padding ? 6 : 0,
              }}>
              {loja.logo_url
                ? <img src={loja.logo_url} alt={loja.nome} className="size-full object-cover" />
                : <div className="flex size-full items-center justify-center text-2xl bg-gradient-to-br from-primary/20 to-accent">🍕</div>
              }
            </div>
            <div className="pb-0.5 min-w-0">
              <h1 className="text-xl sm:text-2xl font-extrabold text-white leading-tight drop-shadow">{loja.nome}</h1>
              {visual.geral.slogan && (
                <p className="text-xs text-white/85 drop-shadow leading-tight">{visual.geral.slogan}</p>
              )}
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1">
                {visual.geral.mostrar_avaliacao && !!loja.nota_qtd && loja.nota_qtd > 0 && (
                  <span className="flex items-center gap-1 text-xs font-bold text-amber-300 drop-shadow">
                    <Star className="size-3 fill-amber-300 text-amber-300" />
                    {loja.nota_media?.toFixed(1)}
                    <span className="font-normal text-white/70">({loja.nota_qtd})</span>
                  </span>
                )}
                {visual.geral.mostrar_taxa_entrega && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-white/80 drop-shadow">
                    <Bike className="size-3" />
                    {loja.taxa_entrega_centavos === 0
                      ? <span className="text-green-300 font-bold">Grátis</span>
                      : brl(loja.taxa_entrega_centavos)
                    }
                  </span>
                )}
                {visual.geral.mostrar_tempo_medio && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-white/80 drop-shadow">
                    <Clock className="size-3" />
                    {loja.tempo_estimado_min} min
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {/* Aviso fechada */}
        {!loja.aberta && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
            Loja fechada — você pode ver o cardápio mas não fazer pedidos.
          </div>
        )}

        {/* Banners */}
        {banners && banners.length > 0 && (
          <BannerCarousel
            banners={banners}
            onProdutoClick={pid => {
              const p = todosComCat.find(x => x.id === pid);
              if (p) setProdutoAberto(p);
            }}
            tempoRotacaoMs={visual.banners.tempo_rotacao_ms}
            loop={visual.banners.loop}
            mostrarIndicadores={visual.banners.mostrar_indicadores}
            mostrarSetas={visual.banners.mostrar_setas}
          />
        )}

        {/* Busca */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="search"
            placeholder="Buscar no cardápio…"
            value={busca}
            onChange={e => { setBusca(e.target.value); selecionarCat(null); }}
            className="w-full h-11 rounded-2xl border border-border bg-muted/50 pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
          />
          {busca && (
            <button onClick={() => setBusca('')} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Categorias — estilo "cards" (com ícone) ou "chips" (texto) */}
        {estiloCat === 'cards' ? (
          <div className="-mx-4 px-4 overflow-x-auto scrollbar-hide">
            <div className="flex gap-2.5 pb-1">
              <CardCategoria icone="geral" imagem="" label="Todos" ativo={!catAtiva} onClick={() => selecionarCat(null)} />
              {metaCat.map(c => (
                <CardCategoria
                  key={c.nome}
                  icone={c.icone}
                  imagem={c.imagem}
                  label={c.nome}
                  ativo={catAtiva === c.nome}
                  onClick={() => selecionarCat(catAtiva === c.nome ? null : c.nome)}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="-mx-4 px-4 overflow-x-auto scrollbar-hide">
            <div className="flex gap-2 pb-1">
              <ChipCategoria label="Todos" ativo={!catAtiva} onClick={() => selecionarCat(null)} />
              {categorias.map(cat => (
                <ChipCategoria
                  key={cat}
                  label={cat}
                  ativo={catAtiva === cat}
                  onClick={() => selecionarCat(catAtiva === cat ? null : cat)}
                />
              ))}
            </div>
          </div>
        )}
        {/* Subcategorias — chips de filtro secundário, aparece só quando catAtiva tem subcats */}
        {subcategorias.length > 0 && (
          <div className="-mx-4 px-4 overflow-x-auto scrollbar-hide">
            <div className="flex gap-2 pb-1">
              <ChipSubcat label="Todos" ativo={!subCatAtiva} onClick={() => setSubCatAtiva(null)} />
              {subcategorias.map(sub => (
                <ChipSubcat
                  key={sub}
                  label={sub}
                  ativo={subCatAtiva === sub}
                  onClick={() => setSubCatAtiva(subCatAtiva === sub ? null : sub)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── GRID DE PRODUTOS ── */}
      <div className="px-4 pb-10 mt-2">
        {semFiltro ? (
          /* Agrupado por categoria, e por subcategoria dentro de cada uma */
          categorias.map(cat => {
            const prods = cardapio[cat] ?? [];
            const subs = [...new Set(prods.map(p => p.subcategoria).filter((s): s is string => !!s))];
            const semSub = prods.filter(p => !p.subcategoria);
            return (
              <div key={cat} className="mb-8">
                <h2 className="text-sm font-extrabold uppercase tracking-widest text-muted-foreground mb-3">{cat}</h2>
                {subs.length > 0 ? (
                  <>
                    {semSub.length > 0 && (
                      <GridProdutos produtos={semSub} podeAbrir={!!loja.aberta} onClick={handleClickProduto} visual={visual} corMarca={loja.cor_marca} />
                    )}
                    {subs.map(sub => (
                      <div key={sub} className="mt-4">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mb-2 pl-0.5">{sub}</h3>
                        <GridProdutos produtos={prods.filter(p => p.subcategoria === sub)} podeAbrir={!!loja.aberta} onClick={handleClickProduto} visual={visual} corMarca={loja.cor_marca} />
                      </div>
                    ))}
                  </>
                ) : (
                  <GridProdutos produtos={prods} podeAbrir={!!loja.aberta} onClick={handleClickProduto} visual={visual} corMarca={loja.cor_marca} />
                )}
              </div>
            );
          })
        ) : catSemSubfiltro ? (
          /* Categoria selecionada sem subcat ativa: agrupa por subcategoria */
          <div>
            {(() => {
              const prods = cardapio[catAtiva!] ?? [];
              const semSub = prods.filter(p => !p.subcategoria);
              return (
                <>
                  {semSub.length > 0 && (
                    <GridProdutos produtos={semSub} podeAbrir={!!loja.aberta} onClick={handleClickProduto} visual={visual} corMarca={loja.cor_marca} />
                  )}
                  {subcategorias.map(sub => (
                    <div key={sub} className="mt-4">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mb-2 pl-0.5">{sub}</h3>
                      <GridProdutos produtos={prods.filter(p => p.subcategoria === sub)} podeAbrir={!!loja.aberta} onClick={handleClickProduto} visual={visual} corMarca={loja.cor_marca} />
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        ) : filtrados.length > 0 ? (
          /* Filtrado flat */
          <AnimatePresence mode="popLayout">
            <GridProdutos
              produtos={filtrados}
              podeAbrir={!!loja.aberta}
              onClick={handleClickProduto}
              visual={visual}
              corMarca={loja.cor_marca}
              animado
            />
          </AnimatePresence>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="text-5xl mb-4">🔍</span>
            <p className="font-semibold text-muted-foreground">Nenhum produto encontrado</p>
            <button
              onClick={() => { setBusca(''); selecionarCat(null); }}
              className="mt-3 text-sm text-primary underline underline-offset-2"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>
    </div>

      {/* ── CARRINHO LATERAL (desktop) ── */}
      <aside className="hidden lg:block">
        <div className="sticky top-6">
          <CarrinhoLateral loja={loja} />
        </div>
      </aside>

      {produtoAberto && (
        <ModalProduto
          produto={produtoAberto}
          loja={loja}
          aberto={!!produtoAberto}
          onFechar={() => setProdutoAberto(null)}
        />
      )}

      <ModalAdicionado produto={adicionado} onFechar={() => setAdicionado(null)} />
    </div>
  );
}

/* ── Card flutuante "produto adicionado" (cor do tema, não bloqueia a navegação) ── */
function ModalAdicionado({ produto, onFechar }: { produto: Produto | null; onFechar: () => void }) {
  // Fecha sozinho depois de alguns segundos; reinicia o timer a cada novo produto.
  useEffect(() => {
    if (!produto) return;
    const t = setTimeout(onFechar, 4000);
    return () => clearTimeout(t);
  }, [produto, onFechar]);

  return (
    <AnimatePresence>
      {produto && (
        <motion.div
          key={produto.id}
          initial={{ opacity: 0, y: 30, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.96 }}
          transition={{ type: 'spring', damping: 24, stiffness: 320 }}
          className="fixed z-50 inset-x-3 bottom-24 mx-auto max-w-md sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[420px]"
        >
          <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-card shadow-2xl">
            <div className="absolute left-0 top-0 h-full w-1.5 bg-primary" />
            <button onClick={onFechar} className="absolute top-3.5 right-3.5 text-muted-foreground hover:text-foreground transition-colors">
              <X className="size-5" />
            </button>
            <div className="flex items-center gap-3.5 p-4 pl-5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Check className="size-6" strokeWidth={3} />
              </div>
              <div className="flex-1 min-w-0 pr-5">
                <h3 className="text-base font-extrabold text-primary leading-tight">Produto adicionado!</h3>
                <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                  <span className="font-semibold text-foreground">{produto.nome}</span> foi adicionado ao seu pedido
                </p>
              </div>
              {produto.foto_url ? (
                <img src={produto.foto_url} alt="" className="size-14 shrink-0 rounded-2xl object-cover border border-border/60 bg-white" />
              ) : (
                <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground/60">
                  <UtensilsCrossed className="size-6" strokeWidth={1.5} />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-border/60 p-2.5">
              <button
                onClick={onFechar}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-bold text-muted-foreground hover:bg-muted transition-colors"
              >
                Continuar comprando <ArrowRight className="size-4" />
              </button>
              <Link
                to="/carrinho"
                onClick={onFechar}
                className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-bold text-primary-foreground shadow-sm shadow-primary/30 hover:opacity-90 transition-opacity"
              >
                <ShoppingCart className="size-4" /> Ver carrinho
              </Link>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Carrinho lateral fixo (estilo Food.Z, só desktop) ── */
function CarrinhoLateral({ loja }: { loja: Loja }) {
  const carrinho = useCarrinho();
  const doMesmo = carrinho && carrinho.loja_id === loja.id ? carrinho : null;
  const itens = doMesmo?.itens ?? [];
  const subtotal = itens.reduce((s, i) => s + i.preco_centavos * i.quantidade, 0);
  const taxa = doMesmo?.taxa_entrega_centavos ?? loja.taxa_entrega_centavos;
  const total = subtotal + (itens.length ? taxa : 0);

  return (
    <div className="rounded-3xl border border-border/60 bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-border/60">
        <ShoppingBag className="size-5 text-primary" />
        <span className="font-extrabold">Meu carrinho</span>
        {itens.length > 0 && (
          <span className="ml-auto rounded-full bg-primary/10 text-primary text-xs font-bold px-2 py-0.5">
            {itens.reduce((s, i) => s + i.quantidade, 0)}
          </span>
        )}
      </div>

      {itens.length === 0 ? (
        <div className="px-5 py-12 text-center text-muted-foreground">
          <ShoppingBag className="size-9 mx-auto opacity-30 mb-2" />
          <p className="text-sm">Seu carrinho está vazio.</p>
          <p className="text-xs mt-1">Toque nos produtos para adicionar.</p>
        </div>
      ) : (
        <>
          <div className="max-h-[42vh] overflow-y-auto divide-y divide-border/50">
            {itens.map(item => (
              <div key={item.chave} className="flex items-center gap-3 px-5 py-3">
                {item.foto_url ? (
                  <img src={item.foto_url} alt="" className="size-9 shrink-0 rounded-xl object-cover" />
                ) : (
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-100 to-rose-200 text-neutral-500">
                    <UtensilsCrossed className="size-4" strokeWidth={1.5} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold leading-tight line-clamp-1">{item.nome}</div>
                  {item.opcoes_texto && (
                    <div className="text-[11px] text-muted-foreground line-clamp-1">{item.opcoes_texto}</div>
                  )}
                  <div className="text-sm font-bold text-primary mt-0.5">{brl(item.preco_centavos * item.quantidade)}</div>
                </div>
                <div className="flex items-center gap-1 rounded-full border border-border bg-background shrink-0">
                  <button onClick={() => mudarQuantidade(item.chave, -1)} className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
                    {item.quantidade === 1 ? <Trash2 className="size-3.5" /> : <Minus className="size-3.5" />}
                  </button>
                  <span className="min-w-5 text-center text-sm font-bold tabular-nums">{item.quantidade}</span>
                  <button onClick={() => mudarQuantidade(item.chave, 1)} className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-primary">
                    <Plus className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="px-5 py-4 space-y-1.5 border-t border-border/60">
            <div className="flex justify-between text-sm text-muted-foreground"><span>Subtotal</span><span className="tabular-nums">{brl(subtotal)}</span></div>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Entrega</span>
              <span className="tabular-nums">{taxa === 0 ? <span className="text-success font-semibold">Grátis</span> : brl(taxa)}</span>
            </div>
            <div className="flex justify-between font-extrabold text-lg pt-1"><span>Total</span><span className="tabular-nums text-primary">{brl(total)}</span></div>
            <Link
              to="/carrinho"
              className="mt-2 flex items-center justify-center gap-2 rounded-full bg-primary py-3 text-sm font-bold text-primary-foreground shadow-sm shadow-primary/30 hover:opacity-90 transition-opacity"
            >
              Finalizar pedido
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Card de categoria com foto (estilo iFood) ── */
function CardCategoria({ icone, imagem, label, ativo, onClick }: { icone: string; imagem?: string; label: string; ativo: boolean; onClick: () => void }) {
  const Icone = iconeCategoria(icone);
  return (
    <button
      onClick={onClick}
      className="flex shrink-0 flex-col items-center gap-1.5 w-[68px]"
    >
      <span
        className={cn(
          'flex size-14 items-center justify-center overflow-hidden rounded-full border-2 transition-all',
          ativo ? 'border-primary bg-primary/10' : 'border-border bg-muted/40',
        )}
      >
        {imagem ? (
          <img src={imagem} alt="" className="size-full object-cover" />
        ) : Icone ? (
          <Icone className={cn('size-6', ativo ? 'text-primary' : 'text-muted-foreground')} strokeWidth={1.75} />
        ) : (
          <span className="text-2xl">{icone || '🍽️'}</span>
        )}
      </span>
      <span className={cn(
        'text-center text-[11px] font-semibold leading-tight line-clamp-2',
        ativo ? 'text-primary' : 'text-muted-foreground',
      )}>
        {label}
      </span>
    </button>
  );
}

/* ── Chip de categoria ── */
function ChipCategoria({ label, ativo, onClick }: { label: string; ativo: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap',
        ativo
          ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/30'
          : 'bg-muted text-muted-foreground hover:bg-muted/70',
      )}
    >
      {label}
    </button>
  );
}

/* ── Chip de subcategoria (menor que o de categoria) ── */
function ChipSubcat({ label, ativo, onClick }: { label: string; ativo: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap border',
        ativo
          ? 'bg-primary/10 text-primary border-primary/30'
          : 'bg-background text-muted-foreground border-border hover:border-primary/30 hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

/* ── Grid de produtos ── */
function GridProdutos({ produtos, podeAbrir, onClick, visual, corMarca, animado }: {
  produtos: Produto[];
  podeAbrir: boolean;
  onClick: (p: Produto) => void;
  visual: VisualJson;
  corMarca?: string;
  animado?: boolean;
}) {
  const premium = visual.cardapio.layout === 'premium';
  const grid = visual.cardapio.layout === 'grid' || premium;
  return (
    <div
      className={cn(
        premium
          ? 'grid grid-cols-2 lg:grid-cols-3'
          : grid
          ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4'
          : visual.cardapio.layout === 'compacto' ? 'grid grid-cols-1 sm:grid-cols-2' : 'flex flex-col',
      )}
      style={{ gap: premium ? Math.max(visual.cardapio.espacamento, 16) : visual.cardapio.espacamento }}
    >
      {produtos.map((p, i) =>
        animado ? (
          <motion.div
            key={p.id}
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.18, delay: i * 0.03 }}
          >
            <CardProduto produto={p} podeAbrir={podeAbrir} onClick={() => onClick(p)} visual={visual} corMarca={corMarca} layoutGrid={grid} premium={premium} />
          </motion.div>
        ) : (
          <CardProduto key={p.id} produto={p} podeAbrir={podeAbrir} onClick={() => onClick(p)} visual={visual} corMarca={corMarca} layoutGrid={grid} premium={premium} />
        )
      )}
    </div>
  );
}

/* ── Card de produto ── */
function CardProduto({ produto, podeAbrir, onClick, visual, corMarca, layoutGrid, premium }: {
  produto: Produto; podeAbrir: boolean; onClick: () => void; visual: VisualJson; corMarca?: string; layoutGrid: boolean; premium?: boolean;
}) {
  const temPromo = !!produto.preco_promocional_centavos && produto.preco_promocional_centavos > 0;
  const preco = temPromo ? produto.preco_promocional_centavos! : produto.preco_centavos;
  const esgotado = !!produto.controla_estoque && (produto.estoque ?? 0) <= 0;
  const poucas = !esgotado && !!produto.controla_estoque && (produto.estoque ?? 0) <= 5;
  const abrivel = podeAbrir && !esgotado;
  const c = visual.cardapio;
  const corBadge = corOuPadrao(visual.cores.cor_badges, '');
  // Cor do ícone "+" — contrasta com a cor real do botão (preto sobre cor clara).
  const corBotao = corOuPadrao(visual.cores.cor_botoes, corMarca || '#dc2640');
  const fgBotao = foregroundContraste(corBotao) === '0 0% 100%' ? '#fff' : '#111';

  return (
    <motion.div
      whileTap={abrivel ? { scale: 0.96 } : {}}
      onClick={abrivel ? onClick : undefined}
      className={cn(
        'group border overflow-hidden transition-all duration-300',
        premium ? 'border-transparent shadow-md' : 'border-border/60 shadow-sm',
        !layoutGrid && 'flex items-center gap-3 p-2',
        abrivel && (premium ? 'cursor-pointer hover:shadow-xl hover:-translate-y-1' : 'cursor-pointer hover:shadow-md'),
        esgotado && 'opacity-90',
      )}
      style={{
        borderRadius: premium ? Math.max(c.raio_bordas, 20) : c.raio_bordas,
        backgroundColor: visual.cores.cor_cards || undefined,
        // minHeight (não height): a foto quadrada cresce com a largura do card
        // (grid de 2-3 colunas) e pode passar da altura configurada — com
        // height fixo + overflow-hidden isso cortava o nome/descrição embaixo.
        minHeight: layoutGrid ? (premium ? Math.max(c.altura_cards, 240) : c.altura_cards) : undefined,
      }}
    >
      {/* Imagem */}
      {c.mostrar_foto && (
        <div className={cn('relative overflow-hidden bg-white', layoutGrid ? 'aspect-square' : 'size-16 shrink-0 rounded-xl')}>
          {produto.foto_url
            ? <img src={produto.foto_url} alt={produto.nome}
                onError={e => {
                  // Foto quebrada (ex.: arquivo /uploads/... que não existe no
                  // servidor) — troca por um placeholder em vez de mostrar o
                  // ícone de imagem quebrada do navegador.
                  const img = e.currentTarget;
                  img.style.display = 'none';
                  const ph = img.nextElementSibling as HTMLElement | null;
                  if (ph) ph.style.display = 'flex';
                }}
                className={cn('size-full object-cover transition-transform duration-300', abrivel && 'group-hover:scale-105', esgotado && 'grayscale')} />
            : null}
          <div className="size-full items-center justify-center bg-muted text-muted-foreground/60" style={{ display: produto.foto_url ? 'none' : 'flex' }}>
            <UtensilsCrossed className={layoutGrid ? 'size-9' : 'size-6'} strokeWidth={1.5} />
          </div>
          {/* Overlay esgotado */}
          {esgotado && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/45">
              <span className="rounded-full bg-white/95 px-3 py-1 text-xs font-extrabold text-neutral-800 shadow">
                Esgotado
              </span>
            </div>
          )}
          {/* Badges destaque/promo — na thumbnail grande (grid/premium) mostra o
              texto completo ("Top"/"PROMO"); na lista (thumbnail de 64px) o
              texto não cabe, então vira um selo redondo compacto com ícone
              (estrela pro destaque, "%" pra promoção) em vez de um pontinho
              genérico que ninguém entendia o que era. */}
          {layoutGrid ? (
            <>
              {!!produto.destaque && !esgotado && c.badge_promocao && (
                <span className="absolute top-2 left-2 flex items-center gap-0.5 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-900 shadow">
                  <Star className="size-2.5 fill-amber-900" /> Top
                </span>
              )}
              {temPromo && !esgotado && c.badge_promocao && (
                <span className="absolute top-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow"
                  style={{ backgroundColor: corBadge || '#dc2640' }}>
                  PROMO
                </span>
              )}
            </>
          ) : (
            <>
              {!!produto.destaque && !esgotado && c.badge_promocao && (
                <span className="absolute top-1 left-1 flex size-4 items-center justify-center rounded-full bg-amber-400 shadow ring-1 ring-white"
                  title="Destaque">
                  <Star className="size-2.5 fill-amber-900 text-amber-900" />
                </span>
              )}
              {temPromo && !esgotado && c.badge_promocao && (
                <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full text-[9px] font-extrabold text-white shadow ring-1 ring-white"
                  style={{ backgroundColor: corBadge || '#dc2640' }} title="Em promoção">
                  %
                </span>
              )}
            </>
          )}
          {/* Premium: preço vira uma etiqueta flutuando sobre a foto (com
              gradiente pra garantir legibilidade), em vez de só texto embaixo
              — é o que diferencia visualmente esse layout do "Grid" normal. */}
          {premium && (
            <>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
              <span className="absolute bottom-2 left-2 rounded-full bg-white/95 backdrop-blur px-2.5 py-1 text-[13px] font-extrabold text-neutral-900 shadow-lg">
                {brl(preco)}
              </span>
              {temPromo && (
                <span className="absolute bottom-2 right-2 rounded-full bg-black/50 backdrop-blur px-2 py-1 text-[10px] font-semibold text-white/90 line-through">
                  {brl(produto.preco_centavos)}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* Info */}
      <div className={layoutGrid ? 'p-3' : 'min-w-0 flex-1'}>
        {c.mostrar_categoria && produto.subcategoria && (
          <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground mb-1">
            {produto.subcategoria}
          </span>
        )}
        <h3 className="font-bold text-[13px] sm:text-sm leading-snug line-clamp-2">{produto.nome}</h3>
        {c.mostrar_descricao && produto.descricao && (
          <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5 leading-relaxed">{produto.descricao}</p>
        )}
        <div className="flex items-center justify-between mt-2 gap-1">
          <div>
            {/* Premium com foto já mostra o preço flutuando sobre a imagem —
                não repete aqui pra não duplicar a informação. */}
            {!(premium && c.mostrar_foto) && (
              <>
                {temPromo && (
                  <span className="text-[10px] text-muted-foreground line-through block">{brl(produto.preco_centavos)}</span>
                )}
                <span className={cn(c.preco_destacado ? 'font-extrabold text-[14px]' : 'font-semibold text-[12px]', temPromo ? 'text-primary' : 'text-foreground')}>
                  {brl(preco)}
                </span>
              </>
            )}
            {esgotado ? (
              <span className="text-[10px] font-semibold text-muted-foreground block mt-0.5">Indisponível</span>
            ) : poucas ? (
              <span className="text-[10px] font-semibold text-amber-600 block mt-0.5">Últimas {produto.estoque} un.</span>
            ) : produto.grupos && produto.grupos.length > 0 && (
              <span className="text-[10px] text-muted-foreground block mt-0.5">Toque para personalizar</span>
            )}
          </div>
          {abrivel && c.botao_comprar && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onClick(); }}
              className={cn('flex size-8 shrink-0 items-center justify-center rounded-full active:opacity-70 transition-opacity touch-manipulation', classNameBotao(visual))}
              style={{ ...estiloBotaoIcone(visual, corMarca || ''), color: fgBotao }}
            >
              <Plus className="size-4" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ── Skeleton de loading ── */
function Skeleton_Loja() {
  return (
    <div className="-mx-4">
      <Skeleton className="h-44 w-full rounded-none" />
      <div className="px-4 pt-4 space-y-4">
        <Skeleton className="h-11 rounded-2xl" />
        <div className="flex gap-2">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-9 w-20 rounded-full" />)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="aspect-square rounded-2xl" />)}
        </div>
      </div>
    </div>
  );
}
