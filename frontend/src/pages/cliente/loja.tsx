import { useState, useEffect, useRef } from 'react';
import { precoVigente, promocaoVigente } from '@/lib/preco-produto';
import { precoMinimoItem, precoVariavel } from '@/lib/opcoes-preco';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useTema, injetarFonteLink, foregroundContraste } from '@/lib/tema';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Bike, Clock, Plus, Minus, Star, Search, X, ShoppingBag, Trash2, Check, ArrowRight, ShoppingCart, UtensilsCrossed, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, ApiError, definirTenantDemo } from '@/lib/api';
import { Falha } from '@/components/ui/estado';
import { brl } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { adicionarAoCarrinho, useCarrinho, mudarQuantidade } from '@/lib/carrinho';
import { registrarLojaAtual, registrarCorLoja } from '@/lib/loja-atual';
import { iconeCategoria } from '@/lib/icones-categoria';
import { classesCategoria } from '@/lib/categoria-visual';
import { ModalProduto } from './modal-produto';
import { BannerCarousel } from '@/components/banner-carousel';
import {
  parseVisualJson, corOuPadrao, estiloBotaoIcone, classNameBotao, FONTES_VISUAL,
  injetarAnalytics, removerAnalytics,
} from '@/lib/visual';
import type { Loja, Produto, Banner, VisualJson } from '@/types';

interface CategoriaMeta { nome: string; icone: string; ordem: number; imagem?: string }
interface RespostaCardapio {
  loja: Loja & { categoria_estilo?: 'cards' | 'chips'; categoria_formato?: string; categoria_tamanho?: string; categoria_todos_imagem?: string };
  cardapio: Record<string, Produto[]>;
  categorias_meta?: CategoriaMeta[];
  banners: Banner[];
}

type ProdutoComCat = Produto & { _cat: string };

export function PaginaLoja({ idFixo }: { idFixo?: number | string } = {}) {
  const params = useParams();
  // idFixo: raiz de um domínio já amarrado a uma loja (loja_padrao_id) —
  // mostra o cardápio direto em "/" sem redirecionar pra "/:id" (cada
  // domínio já É uma loja só, não faz sentido expor o id na URL).
  const id = idFixo != null ? String(idFixo) : params.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const [produtoAberto, setProdutoAberto] = useState<Produto | null>(null);
  const [catAtiva, setCatAtiva] = useState<string | null>(null);
  const [subCatAtiva, setSubCatAtiva] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [adicionado, setAdicionado] = useState<Produto | null>(null);
  const { aplicarCorPrimaria, resetarCorPrimaria, aplicarFaviconLoja, resetarFavicon, marca } = useTema();

  // ?tenant=<slug> força a resolução de tenant por slug em vez do Host da
  // aba — usado pelo preview do editor Visual (PhonePreview.tsx) e pela
  // vitrine de demo (/demo/:slug), pra alcançar lojas sem domínio próprio
  // configurado. Precisa rodar antes do useQuery abaixo disparar o fetch.
  const tenantParam = searchParams.get('tenant');
  // Setado direto no corpo do render (não num useEffect) de propósito: precisa
  // estar gravado no sessionStorage ANTES do primeiro fetch do useQuery abaixo
  // disparar. Um useEffect aqui dependeria da ordem entre este efeito e o
  // efeito interno do react-query que dispara o fetch — não é uma garantia
  // documentada da lib, só um detalhe de implementação que pode mudar. Chamada
  // idempotente (sessionStorage.setItem), sem efeito colateral visível.
  if (tenantParam) definirTenantDemo(tenantParam);
  // Mesma lógica/motivo do tenantParam acima: precisa estar gravado antes
  // do cliente clicar em "Início" ou no logo, então roda direto no render.
  if (id) registrarLojaAtual(id);

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
    if (corMarcaEfetiva) {
      aplicarCorPrimaria(corMarcaEfetiva, corSecundariaEfetiva);
      registrarCorLoja(corMarcaEfetiva, corSecundariaEfetiva);
    }
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

  /**
   * FALHA DE REDE não é "loja não encontrada".
   *
   * Este ramo dizia "Loja não encontrada" pra QUALQUER motivo de `data` vazio —
   * inclusive servidor fora do ar. O cliente com fome, prestes a pedir, era
   * informado de que a loja não existe; muitos nunca voltam depois disso.
   * Falha de transporte e 5xx agora mostram o que é, com botão de tentar de novo.
   */
  if (consulta.isError) {
    const e = consulta.error;
    const ehAusente = e instanceof ApiError && !e.semRede && e.status === 404;
    if (!ehAusente) {
      return <Falha erro={e} aoTentar={() => consulta.refetch()} />;
    }
  }

  // Sem `data` a página não tem o que renderizar. Antes devolvia null aqui, o
  // que deixava só o cabeçalho e a nav do layout na tela (parecia um bug de
  // tela preta) — a causa mais comum é a loja não existir NESTE tenant, ex.
  // abrir /:slug de outro tenant direto no domínio da plataforma.
  if (!consulta.data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <UtensilsCrossed className="size-7" />
        </div>
        <h1 className="text-lg font-bold">Loja não encontrada</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Esse endereço não corresponde a nenhuma loja disponível aqui. Confira o link ou volte para o início.
        </p>
        <Link
          to="/"
          className="mt-1 inline-flex h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98]"
        >
          Voltar ao início
        </Link>
      </div>
    );
  }

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
  const formatoCat = loja.categoria_formato;
  const tamanhoCat = loja.categoria_tamanho;
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
  /*
   * OS DESTAQUES, NO TOPO DO CARDÁPIO.
   *
   * `produtos.destaque` existia e só desenhava um selo "Top" no card, perdido no
   * meio da categoria dele — o lojista marca o produto e nada muda de posição.
   * Marcar destaque tem que colocar o item na frente; é isso que a palavra
   * promete.
   *
   * ESGOTADO E INDISPONÍVEL FICAM FORA. Vitrine é o lugar de maior atenção da
   * tela: pôr ali o que não pode ser vendido gasta o melhor espaço da loja pra
   * frustrar. O produto continua aparecendo na categoria dele, com o selo de
   * esgotado, que é onde essa informação serve.
   *
   * O TETO DE 12 é pra vitrine continuar sendo escolha. Loja que marca tudo
   * como destaque não tem destaque nenhum, e um carrossel de 40 itens é uma
   * segunda listagem do cardápio.
   */
  const destaques = todosComCat
    .filter(p => p.destaque && p.disponivel !== 0
      && !(p.controla_estoque && (p.estoque ?? 0) <= 0))
    .slice(0, 12);

  const semFiltro = !catAtiva && !busca;
  // Categoria selecionada sem subcategoria: agrupa por subcategoria dentro da cat
  const catSemSubfiltro = !!catAtiva && !subCatAtiva && !busca && subcategorias.length > 0;
  const categoriasFiltradas = semFiltro ? categorias : [];

  /*
   * TOCAR NO CARD ABRE O PRODUTO; só o "+" põe no carrinho.
   *
   * Antes os dois faziam a mesma coisa, e num item sem complementos tocar no
   * card jogava direto no carrinho — o cliente não conseguia ler a descrição,
   * ver a foto grande nem escolher a quantidade antes de decidir. Pra quem só
   * quer repetir o de sempre, o "+" continua sendo um toque.
   */
  function abrirProduto(p: Produto) {
    if (!loja.aberta) return;
    setProdutoAberto(p);
  }

  function adicionarRapido(p: Produto) {
    if (!loja.aberta) return;
    // Com complementos não existe "adicionar rápido": faltaria escolher o
    // obrigatório. O "+" então abre o produto, em vez de não fazer nada.
    if (p.grupos && p.grupos.length > 0) {
      setProdutoAberto(p);
      return;
    }
    const precoBase = precoVigente(p);
    const ok = adicionarAoCarrinho(loja, {
      produto_id: p.id, nome: p.nome, preco_centavos: precoBase, quantidade: 1, opcoes: [], opcoes_texto: '', foto_url: p.foto_url,
    });
    if (ok) setAdicionado(p);
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
            <button aria-label="Limpar busca" onClick={() => setBusca('')} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Categorias — estilo "cards" (com ícone) ou "chips" (texto) */}
        {estiloCat === 'cards' ? (
          <div className="-mx-4 px-4 overflow-x-auto scrollbar-hide">
            <div className="flex gap-2.5 pb-1">
              {/* O "Todos" também aceita foto escolhida — sem isso ele era o
                  único da fileira sempre em ícone, e destoava dos vizinhos. */}
              <CardCategoria icone="geral" imagem={loja.categoria_todos_imagem} label="Todos" ativo={!catAtiva}
                formato={formatoCat} tamanho={tamanhoCat} onClick={() => selecionarCat(null)} />
              {metaCat.map(c => (
                <CardCategoria
                  key={c.nome}
                  icone={c.icone}
                  imagem={c.imagem}
                  label={c.nome}
                  ativo={catAtiva === c.nome}
                  formato={formatoCat}
                  tamanho={tamanhoCat}
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

      {/*
        A vitrine só existe SEM FILTRO. Com busca ou categoria escolhida o
        cliente já disse o que quer; uma faixa de "principais" ali competiria
        com a resposta que ele pediu — e mostraria itens fora do filtro, o que
        parece defeito.
      */}
      {semFiltro && destaques.length > 0 && (
        <VitrineDestaques
          produtos={destaques}
          podeAbrir={!!loja.aberta}
          onAbrir={abrirProduto}
          visual={visual}
          corMarca={loja.cor_marca}
        />
      )}

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
                      <GridProdutos produtos={semSub} podeAbrir={!!loja.aberta} onAbrir={abrirProduto} onAdicionar={adicionarRapido} visual={visual} corMarca={loja.cor_marca} />
                    )}
                    {subs.map(sub => (
                      <div key={sub} className="mt-4">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mb-2 pl-0.5">{sub}</h3>
                        <GridProdutos produtos={prods.filter(p => p.subcategoria === sub)} podeAbrir={!!loja.aberta} onAbrir={abrirProduto} onAdicionar={adicionarRapido} visual={visual} corMarca={loja.cor_marca} />
                      </div>
                    ))}
                  </>
                ) : (
                  <GridProdutos produtos={prods} podeAbrir={!!loja.aberta} onAbrir={abrirProduto} onAdicionar={adicionarRapido} visual={visual} corMarca={loja.cor_marca} />
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
                    <GridProdutos produtos={semSub} podeAbrir={!!loja.aberta} onAbrir={abrirProduto} onAdicionar={adicionarRapido} visual={visual} corMarca={loja.cor_marca} />
                  )}
                  {subcategorias.map(sub => (
                    <div key={sub} className="mt-4">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mb-2 pl-0.5">{sub}</h3>
                      <GridProdutos produtos={prods.filter(p => p.subcategoria === sub)} podeAbrir={!!loja.aberta} onAbrir={abrirProduto} onAdicionar={adicionarRapido} visual={visual} corMarca={loja.cor_marca} />
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
              onAbrir={abrirProduto} onAdicionar={adicionarRapido}
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
            <button aria-label="Fechar" onClick={onFechar} className="absolute top-3.5 right-3.5 text-muted-foreground hover:text-foreground transition-colors">
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
                <img src={produto.foto_url} alt="" className="size-14 shrink-0 rounded-2xl object-contain border border-border/60 bg-white" />
              ) : (
                <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground/60">
                  <UtensilsCrossed className="size-6" strokeWidth={1.5} />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-border/60 p-2.5">
              <button
                onClick={onFechar}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-bold text-muted-foreground hover:bg-muted active:scale-[0.98] transition-all"
              >
                Continuar comprando <ArrowRight className="size-4" />
              </button>
              <Link
                to="/carrinho"
                onClick={onFechar}
                className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-bold text-primary-foreground shadow-sm shadow-primary/30 hover:opacity-90 active:scale-[0.98] transition-all"
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
                  <img src={item.foto_url} alt="" className="size-9 shrink-0 rounded-xl bg-white object-contain" />
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
                <div className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-background px-1">
                  <button aria-label={item.quantidade === 1 ? `Remover ${item.nome}` : `Diminuir quantidade de ${item.nome}`} onClick={() => mudarQuantidade(item.chave, -1)} className="flex size-11 items-center justify-center rounded-full text-muted-foreground transition-transform touch-manipulation hover:text-foreground active:scale-90">
                    {item.quantidade === 1 ? <Trash2 className="size-4" /> : <Minus className="size-4" />}
                  </button>
                  <span key={item.quantidade} className="min-w-5 text-center text-sm font-bold tabular-nums anim-pop">{item.quantidade}</span>
                  <button aria-label={`Aumentar quantidade de ${item.nome}`} onClick={() => mudarQuantidade(item.chave, 1)} className="flex size-11 items-center justify-center rounded-full text-muted-foreground transition-transform touch-manipulation hover:text-primary active:scale-90">
                    <Plus className="size-4" />
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
              className="mt-2 flex items-center justify-center gap-2 rounded-full bg-primary py-3 text-sm font-bold text-primary-foreground shadow-sm shadow-primary/30 hover:opacity-90 active:scale-[0.98] transition-all"
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
function CardCategoria({ icone, imagem, label, ativo, formato, tamanho, onClick }: {
  icone: string; imagem?: string; label: string; ativo: boolean;
  formato?: string; tamanho?: string; onClick: () => void;
}) {
  const Icone = iconeCategoria(icone);
  const c = classesCategoria(formato, tamanho);
  return (
    <button
      onClick={onClick}
      className={cn('flex shrink-0 flex-col items-center gap-1.5 active:scale-90 transition-transform', c.botao)}
    >
      <span
        className={cn(
          'flex items-center justify-center overflow-hidden border-2 transition-all',
          c.bolha, c.raio,
          ativo ? 'border-primary bg-primary/10' : 'border-border bg-muted/40',
        )}
      >
        {imagem ? (
          <img src={imagem} alt="" className="size-full object-cover" />
        ) : Icone ? (
          <Icone className={cn(c.icone, ativo ? 'text-primary' : 'text-muted-foreground')} strokeWidth={1.75} />
        ) : (
          <span className="text-2xl">{icone || '🍽️'}</span>
        )}
      </span>
      <span className={cn(
        'text-center font-semibold leading-tight line-clamp-2', c.texto,
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
        'shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap active:scale-95',
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
        'shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap border active:scale-95',
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
/**
 * VITRINE DE DESTAQUES — carrossel horizontal no topo do cardápio.
 *
 * Rolagem nativa com `scroll-snap`, não biblioteca de carrossel: o gesto de
 * arrastar já é o do sistema (com a inércia e a barra que o cliente conhece), e
 * uma dependência a mais no bundle do cardápio atrasa a primeira tela.
 *
 * As setas só aparecem no desktop e só com mais de 3 itens: no celular quem
 * rola é o dedo, e seta que não tem pra onde ir é botão morto.
 *
 * O item destacado CONTINUA na categoria dele, embaixo. Tirar de lá deixaria um
 * buraco em "Pizzas" e o cliente que rola até a categoria não acharia o
 * produto — a vitrine é um atalho, não uma mudança de lugar.
 */
/**
 * A COR DO SELO PROMO, E POR QUE O VERMELHO SAIU.
 *
 * O selo caía num `#dc2640` cravado quando a loja não escolhia `cor_badges` —
 * vermelho, de antes do white-label. Numa loja de marca laranja (`#ffa200`) a
 * tela toda era laranja e só o selo era vermelho, parecendo peça de outro site.
 * O botão já resolvia isto certo (`corOuPadrao(cor_botoes, corMarca ...)`); o
 * selo tinha ficado atrás.
 *
 * A ordem é: cor de badge escolhida → cor da marca → vermelho. O vermelho segue
 * no fim porque loja sem marca definida precisa de algum contraste, e não pode
 * herdar a cor da PLATAFORMA (o cardápio é da loja, não nosso).
 *
 * O TEXTO NÃO PODE SER SEMPRE BRANCO. "PROMO" em branco sobre `#ffa200` fica
 * ilegível — laranja é claro. `foregroundContraste` já existe pra isso e é o
 * que o botão usa; devolve HSL, então aqui vai como `hsl(...)`.
 */
function corSelo(visual: VisualJson, corMarca?: string | null): { fundo: string; texto: string } {
  const fundo = corOuPadrao(visual.cores.cor_badges, corMarca || '#dc2640');
  return { fundo, texto: `hsl(${foregroundContraste(fundo)})` };
}

function VitrineDestaques({ produtos, podeAbrir, onAbrir, visual, corMarca }: {
  produtos: Produto[];
  podeAbrir: boolean;
  onAbrir: (p: Produto) => void;
  visual: VisualJson;
  corMarca?: string;
}) {
  const trilha = useRef<HTMLDivElement | null>(null);
  const c = visual.cardapio;
  const selo = corSelo(visual, corMarca);

  /* Rola quase uma tela (85%) e não uma tela inteira: o pedaço que sobra na
     borda mostra que existe mais coisa depois, e é o que faz o cliente rolar
     de novo. */
  function empurrar(direcao: 1 | -1) {
    const el = trilha.current;
    if (el) el.scrollBy({ left: direcao * el.clientWidth * 0.85, behavior: 'smooth' });
  }

  const comSetas = produtos.length > 3;

  return (
    <section className="mt-3 px-4" aria-label="Destaques da loja">
      <div className="mb-2.5 flex items-end justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-extrabold uppercase tracking-widest text-muted-foreground">
          <Star className="size-3.5 fill-amber-400 text-amber-400" />
          Destaques
        </h2>
        {comSetas && (
          <div className="flex gap-1 max-sm:hidden">
            {([-1, 1] as const).map(d => (
              <button
                key={d}
                type="button"
                onClick={() => empurrar(d)}
                aria-label={d < 0 ? 'Ver anteriores' : 'Ver próximos'}
                className="flex size-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {d < 0 ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/*
        `-mx-4 px-4` faz a trilha sangrar até as bordas da tela: o último card
        cortado pela margem parece o fim da lista, e o cliente não rola.
      */}
      <div
        ref={trilha}
        className="scrollbar-hide -mx-4 flex snap-x snap-mandatory overflow-x-auto px-4 pb-1"
        style={{ gap: c.espacamento }}
      >
        {produtos.map(p => {
          const temPromo = promocaoVigente(p);
          const preco = precoMinimoItem(precoVigente(p), p.grupos ?? []);
          const aPartirDe = precoVariavel(p.grupos ?? []);
          return (
            <motion.button
              key={p.id}
              type="button"
              whileTap={podeAbrir ? { scale: 0.96 } : {}}
              onClick={() => podeAbrir && onAbrir(p)}
              disabled={!podeAbrir}
              className={cn(
                'group w-[152px] shrink-0 snap-start overflow-hidden border border-border/60 text-left transition-shadow sm:w-[168px]',
                c.sombra === 'nenhuma' ? 'shadow-none' : c.sombra === 'forte' ? 'shadow-lg' : 'shadow-sm',
                podeAbrir ? 'cursor-pointer hover:shadow-md' : 'cursor-default',
              )}
              style={{
                borderRadius: c.raio_bordas,
                backgroundColor: visual.cores.cor_cards || undefined,
              }}
            >
              {/* Mesmas regras do card da listagem: loja que desligou a foto, ou
                  que escolheu retrato/paisagem, vê o mesmo formato aqui. */}
              {c.mostrar_foto && (
              <div className={cn('relative overflow-hidden bg-white',
                c.formato_foto === 'retrato' ? 'aspect-[3/4]'
                  : c.formato_foto === 'paisagem' ? 'aspect-[16/10]' : 'aspect-square')}>
                {p.foto_url ? (
                  <img
                    src={p.foto_url}
                    alt={p.nome}
                    loading="lazy"
                    /* `contain` como na grade: é a mesma foto do mesmo produto,
                       e cortar só no destaque faria o item parecer outro. */
                    className={cn('size-full object-contain transition-transform duration-300',
                      podeAbrir && 'group-hover:scale-105')}
                  />
                ) : (
                  <div className="flex size-full items-center justify-center bg-muted text-muted-foreground/60">
                    <UtensilsCrossed className="size-8" strokeWidth={1.5} />
                  </div>
                )}
                {/*
                  SEM SELO "Top" AQUI. O título da seção já diz que tudo isto é
                  destaque; repetir em cada card é ruído. O de promoção fica,
                  porque é informação que a seção NÃO dá.
                */}
                {temPromo && c.badge_promocao && (
                  <span
                    className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold shadow"
                    style={{ backgroundColor: selo.fundo, color: selo.texto }}
                  >
                    PROMO
                  </span>
                )}
              </div>
              )}

              <div className="p-2.5">
                <p className={cn('text-[13px] font-bold leading-snug',
                  c.linhas_nome === 1 ? 'line-clamp-1' : 'line-clamp-2')}>{p.nome}</p>
                {/* "a partir de" na linha de cima e miúdo: o valor tem que
                    continuar sendo a coisa grande do card. */}
                {aPartirDe && (
                  <span className="mt-1 block text-[10px] leading-none text-muted-foreground">a partir de</span>
                )}
                <div className={cn('flex items-baseline gap-1.5', aPartirDe ? 'mt-0.5' : 'mt-1.5')}>
                  {/* `text-primary` e não cor inline: é exatamente o que o card
                      da listagem usa, e resolve pra cor da marca da loja. Com
                      cor cravada aqui, o mesmo produto tinha preço vermelho na
                      vitrine e laranja no card, dois passos abaixo. */}
                  <span className={cn('tabular-nums',
                    c.preco_destacado ? 'text-sm font-extrabold' : 'text-[13px] font-semibold',
                    temPromo ? 'text-primary' : 'text-foreground')}>
                    {brl(preco)}
                  </span>
                  {temPromo && (
                    <span className="text-[11px] text-muted-foreground line-through tabular-nums">
                      {brl(p.preco_centavos)}
                    </span>
                  )}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}

function GridProdutos({ produtos, podeAbrir, onAbrir, onAdicionar, visual, corMarca, animado }: {
  produtos: Produto[];
  podeAbrir: boolean;
  onAbrir: (p: Produto) => void;
  onAdicionar: (p: Produto) => void;
  visual: VisualJson;
  corMarca?: string;
  animado?: boolean;
}) {
  const premium = visual.cardapio.layout === 'premium';
  const grid = visual.cardapio.layout === 'grid' || premium;
  const uma = visual.cardapio.colunas_mobile === 1;
  return (
    <div
      className={cn(
        // COLUNAS NO CELULAR: 1 coluna = card grande com foto maior, que vende
        // melhor cardápio curto e de foto boa; 2 colunas cabem mais item na tela.
        // Só o breakpoint base muda -- de sm pra cima segue igual, senão desktop
        // ficaria com uma coluna gigante.
        premium
          ? cn(uma ? 'grid grid-cols-1' : 'grid grid-cols-2', 'sm:grid-cols-2 lg:grid-cols-3')
          : grid
          ? cn(uma ? 'grid grid-cols-1' : 'grid grid-cols-2', 'sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4')
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
            <CardProduto produto={p} podeAbrir={podeAbrir} onAbrir={() => onAbrir(p)} onAdicionar={() => onAdicionar(p)} visual={visual} corMarca={corMarca} layoutGrid={grid} premium={premium} />
          </motion.div>
        ) : (
          <CardProduto key={p.id} produto={p} podeAbrir={podeAbrir} onAbrir={() => onAbrir(p)} onAdicionar={() => onAdicionar(p)} visual={visual} corMarca={corMarca} layoutGrid={grid} premium={premium} />
        )
      )}
    </div>
  );
}

/* ── Card de produto ── */
function CardProduto({ produto, podeAbrir, onAbrir, onAdicionar, visual, corMarca, layoutGrid, premium }: {
  produto: Produto; podeAbrir: boolean; onAbrir: () => void; onAdicionar: () => void;
  visual: VisualJson; corMarca?: string; layoutGrid: boolean; premium?: boolean;
}) {
  // Promoção com prazo vencido não mostra selo nem preço riscado — ver
  // lib/preco-produto.ts, a mesma regra que o backend usa pra cobrar.
  const temPromo = promocaoVigente(produto);
  const preco = precoVigente(produto);
  /*
   * O PREÇO DO CARD É O MÍNIMO REAL, não o preço base.
   *
   * Num produto com grupo obrigatório em que toda opção tem acréscimo — a pizza
   * onde todo tamanho soma — o preço base é um valor que ninguém consegue pagar.
   * O cliente via R$ 39,90, abria o item e o mínimo era R$ 54,90.
   *
   * "A partir de" só quando existe mais de um total possível: em item de preço
   * único aquilo é ruído, e ruído em todo card treina o olho a ignorar.
   */
  const precoExibido = precoMinimoItem(preco, produto.grupos ?? []);
  const aPartirDe = precoVariavel(produto.grupos ?? []);
  const esgotado = !!produto.controla_estoque && (produto.estoque ?? 0) <= 0;
  const poucas = !esgotado && !!produto.controla_estoque && (produto.estoque ?? 0) <= 5;
  const abrivel = podeAbrir && !esgotado;
  const c = visual.cardapio;
  const selo = corSelo(visual, corMarca);
  // Cor do ícone "+" — contrasta com a cor real do botão (preto sobre cor clara).
  const corBotao = corOuPadrao(visual.cores.cor_botoes, corMarca || '#dc2640');
  const fgBotao = foregroundContraste(corBotao) === '0 0% 100%' ? '#fff' : '#111';

  return (
    <motion.div
      whileTap={abrivel ? { scale: 0.96 } : {}}
      onClick={abrivel ? onAbrir : undefined}
      className={cn(
        'group border overflow-hidden transition-all duration-300',
        premium ? 'border-transparent' : 'border-border/60',
        c.sombra === 'nenhuma' ? 'shadow-none' : c.sombra === 'forte' ? 'shadow-lg' : premium ? 'shadow-md' : 'shadow-sm',
        /*
          ALINHAMENTO DO BOTAO "+": no grid o card e coluna flex de altura cheia.
          Sem isto, o bloco de preco/+ ficava logo apos o texto, entao nome de
          duas linhas ("Pizza Quatro Queijos") empurrava o + pra baixo e ele
          desalinhava dos vizinhos de uma linha. `h-full` faz o card ocupar a
          altura da linha do grid (que o CSS Grid ja iguala por padrao) e o
          rodape desce sozinho com `mt-auto` la embaixo.
        */
        layoutGrid && 'flex h-full flex-col',
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
        <div className={cn('relative overflow-hidden bg-white', layoutGrid
          ? (c.formato_foto === 'retrato' ? 'aspect-[3/4]' : c.formato_foto === 'paisagem' ? 'aspect-[16/10]' : 'aspect-square')
          : 'size-16 shrink-0 rounded-xl')}>
          {/*
            A FOTO INTEIRA, SEM CORTE.

            `object-cover` preenche a moldura cortando o que sobra — e o que
            sobra é sempre a borda: a pizza perdia a crosta, a lata perdia o
            topo. A moldura tem proporção fixa (o lojista escolhe quadrada,
            retrato ou paisagem) e a foto vem de qualquer câmera, então o corte
            era garantido em quase todas.

            `contain` cabe a foto inteira e sobra faixa nas laterais — o troco
            certo: faixa branca não engana ninguém, foto cortada mostra um
            produto que não é o que chega.

            VALE PRA LISTA TAMBÉM. A miniatura de 64px é pequena, e o primeiro
            instinto é preencher — mas é justamente nela que o corte engana
            mais: numa lata cortada no topo sobra um cilindro sem marca, e a
            miniatura é tudo que o cliente vê antes de tocar.
          */}
          {produto.foto_url
            ? <img src={produto.foto_url} alt={produto.nome}
                /* `lazy` porque o cardápio inteiro cabe numa página: 21 das 30
                   imagens estavam abaixo da dobra e baixavam junto, competindo
                   com as que o cliente está olhando. O navegador carrega na
                   hora as que já estão na viewport, então nada some da
                   primeira tela. */
                loading="lazy"
                decoding="async"
                onError={e => {
                  // Foto quebrada (ex.: arquivo /uploads/... que não existe no
                  // servidor) — troca por um placeholder em vez de mostrar o
                  // ícone de imagem quebrada do navegador.
                  const img = e.currentTarget;
                  img.style.display = 'none';
                  const ph = img.nextElementSibling as HTMLElement | null;
                  if (ph) ph.style.display = 'flex';
                }}
                className={cn('size-full object-contain transition-transform duration-300',
                  abrivel && 'group-hover:scale-105', esgotado && 'grayscale')} />
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
              {!!produto.destaque && !esgotado && c.badge_destaque && (
                <span className="absolute top-2 left-2 flex items-center gap-0.5 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-900 shadow">
                  <Star className="size-2.5 fill-amber-900" /> Top
                </span>
              )}
              {temPromo && !esgotado && c.badge_promocao && (
                <span className="absolute top-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-bold shadow"
                  style={{ backgroundColor: selo.fundo, color: selo.texto }}>
                  PROMO
                </span>
              )}
            </>
          ) : (
            <>
              {!!produto.destaque && !esgotado && c.badge_destaque && (
                <span className="absolute top-1 left-1 flex size-4 items-center justify-center rounded-full bg-amber-400 shadow ring-1 ring-white"
                  title="Destaque">
                  <Star className="size-2.5 fill-amber-900 text-amber-900" />
                </span>
              )}
              {temPromo && !esgotado && c.badge_promocao && (
                <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full text-[9px] font-extrabold shadow ring-1 ring-white"
                  style={{ backgroundColor: selo.fundo, color: selo.texto }} title="Em promoção">
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
                {aPartirDe && <span className="mr-1 text-[9px] font-semibold uppercase tracking-wide opacity-60">a partir de</span>}
                {brl(precoExibido)}
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
      <div className={layoutGrid ? 'flex flex-1 flex-col p-3' : 'min-w-0 flex-1'}>
        {c.mostrar_categoria && produto.subcategoria && (
          <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground mb-1">
            {produto.subcategoria}
          </span>
        )}
        <h3 className={cn('font-bold text-[13px] sm:text-sm leading-snug', c.linhas_nome === 1 ? 'line-clamp-1' : 'line-clamp-2')}>{produto.nome}</h3>
        {c.mostrar_descricao && produto.descricao && (
          <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5 leading-relaxed">{produto.descricao}</p>
        )}
        <div className={cn('flex items-end justify-between gap-1', layoutGrid ? 'mt-auto pt-2' : 'mt-2 items-center')}>
          <div>
            {/* Premium com foto já mostra o preço flutuando sobre a imagem —
                não repete aqui pra não duplicar a informação. */}
            {!(premium && c.mostrar_foto) && (
              <>
                {temPromo && (
                  <span className="text-[10px] text-muted-foreground line-through block">
                    {/* O riscado também soma o mínimo obrigatório: sem isso, um
                        item com tamanho obrigatório mostrava "de R$ 39,90 por
                        R$ 54,90" — o "por" maior que o "de". */}
                    {brl(precoMinimoItem(produto.preco_centavos, produto.grupos ?? []))}
                  </span>
                )}
                {aPartirDe && (
                  <span className="block text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">a partir de</span>
                )}
                <span className={cn(c.preco_destacado ? 'font-extrabold text-[14px]' : 'font-semibold text-[12px]', temPromo ? 'text-primary' : 'text-foreground')}>
                  {brl(precoExibido)}
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
              aria-label={`Adicionar ${produto.nome}`}
              // stopPropagation pro toque no "+" não abrir o produto também.
              onClick={e => { e.stopPropagation(); onAdicionar(); }}
              className={cn(
                'flex shrink-0 items-center justify-center gap-1 rounded-full transition-opacity active:opacity-70 touch-manipulation',
                // 44px de alvo nos dois formatos (diretriz de toque em celular).
                c.estilo_botao === 'texto' ? 'h-11 px-3.5 text-xs font-bold' : 'size-11',
                classNameBotao(visual),
              )}
              style={{ ...estiloBotaoIcone(visual, corMarca || ''), color: fgBotao }}
            >
              <Plus className="size-4" />
              {c.estilo_botao === 'texto' && <span>Adicionar</span>}
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
