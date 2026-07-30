/**
 * Editor de ÁREAS DE ENTREGA no mapa (Leaflet puro, sem plugin de desenho).
 *
 * O lojista clica no mapa pra marcar os cantos da região e fecha a área. Optei
 * por implementar o desenho com primitivas do Leaflet em vez de trazer
 * `leaflet-draw`: a interação que precisamos é pequena (clicar pontos, desfazer,
 * fechar) e a lib traria CSS/ícones próprios pra manter alinhados com o tema.
 *
 * Só desenha e reporta — quem salva é a tela que usa este componente.
 */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Undo2, Check, X, MapPin, Search, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export type PontoMapa = [number, number];

export interface AreaMapa {
  id: number;
  nome: string;
  taxa_centavos: number;
  poligono: PontoMapa[];
}

/** Cor vinda do tema (o CSS var é HSL cru, ex.: "24 95% 53%"). */
function corDoTema(nome: string, alfa = 1): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  return v ? `hsl(${v} / ${alfa})` : `rgba(120,120,120,${alfa})`;
}

/**
 * Estilos de mapa disponíveis.
 *
 * SATÉLITE existe por um motivo prático: desenhando área de entrega, a foto
 * mostra quadra, rio, mata e loteamento novo que o mapa vetorial ainda não tem —
 * é o que decide se a rua do outro lado do córrego entra ou não.
 * CLARO deixa o polígono colorido saltar, porque tira a cor do fundo.
 *
 * Todos sem chave de API e sem custo. `img-src https:` já está liberado na CSP,
 * então azulejo de terceiro carrega sem mexer em nada — mas a atribuição é
 * obrigação de licença dos três, não é enfeite.
 */
const ESTILOS = {
  padrao: {
    rotulo: 'Padrão',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    atribuicao: '&copy; OpenStreetMap',
    maxZoom: 19,
  },
  claro: {
    rotulo: 'Claro',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    atribuicao: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 20,
  },
  satelite: {
    rotulo: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    atribuicao: 'Imagens &copy; Esri',
    maxZoom: 19,
  },
} as const;

type ChaveEstilo = keyof typeof ESTILOS;
const CHAVE_ESTILO_LS = 'mapa_areas_estilo';

function estiloSalvo(): ChaveEstilo {
  try {
    const v = localStorage.getItem(CHAVE_ESTILO_LS);
    if (v && v in ESTILOS) return v as ChaveEstilo;
  } catch { /* localStorage bloqueado */ }
  return 'padrao';
}

export interface LocalBusca {
  nome: string;
  lat: number;
  lon: number;
  caixa: [number, number, number, number] | null;
  contorno: PontoMapa[] | null;
}

export function MapaAreas({
  centro, centroEhReal = true, areas, areaSelecionada, desenhando, onDesenhoConcluido,
  onCancelarDesenho, onSelecionar, onUsarContorno,
}: {
  centro: PontoMapa;
  /** false = `centro` é só um chute pra abrir o mapa; não marca "Sua loja" nem recentra. */
  centroEhReal?: boolean;
  areas: AreaMapa[];
  areaSelecionada?: number | null;
  desenhando: boolean;
  onDesenhoConcluido: (poligono: PontoMapa[]) => void;
  onCancelarDesenho: () => void;
  onSelecionar?: (id: number) => void;
  /** Chamado quando o lojista aceita o contorno pronto de um bairro buscado. */
  onUsarContorno?: (poligono: PontoMapa[], nome: string) => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const camadaBase = useRef<L.TileLayer | null>(null);
  const camadaAreas = useRef<L.LayerGroup | null>(null);
  const camadaDesenho = useRef<L.LayerGroup | null>(null);
  const [pontos, setPontos] = useState<PontoMapa[]>([]);
  const [estilo, setEstilo] = useState<ChaveEstilo>(estiloSalvo);
  const [telaCheia, setTelaCheia] = useState(false);
  /** Envolve mapa + controles: é ele que vai pra tela cheia, pros botões irem junto. */
  const molduraRef = useRef<HTMLDivElement>(null);

  /** Troca o azulejo sem recriar o mapa (mantém zoom, centro e o desenho em curso). */
  function trocarEstilo(chave: ChaveEstilo) {
    setEstilo(chave);
    try { localStorage.setItem(CHAVE_ESTILO_LS, chave); } catch { /* ignore */ }
    const mapa = mapaRef.current;
    if (!mapa) return;
    if (camadaBase.current) mapa.removeLayer(camadaBase.current);
    const e = ESTILOS[chave];
    // Os estilos não têm o mesmo zoom máximo (Carto vai a 20, Esri a 19): sem
    // recuar, quem estava no zoom 20 e trocasse pro satélite ficava com a tela
    // cinza, sem azulejo nenhum pra mostrar.
    if (mapa.getZoom() > e.maxZoom) mapa.setZoom(e.maxZoom);
    camadaBase.current = L.tileLayer(e.url, { attribution: e.atribuicao, maxZoom: e.maxZoom }).addTo(mapa);
    // Azulejo por baixo de tudo: sem isto ele entra por cima das áreas já desenhadas.
    camadaBase.current.bringToBack();
  }

  /**
   * Tela cheia de verdade (Fullscreen API), não um `position:fixed` fingindo.
   * Desenhar área num quadro de 380px é ruim: ou você vê a região inteira sem
   * detalhe, ou o detalhe e perde a noção do conjunto.
   */
  async function alternarTelaCheia() {
    const el = molduraRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch { /* navegador/permissão negou — o botão simplesmente não faz nada */ }
  }

  // Segue o estado real do navegador, não o clique: Esc e o F11 do sistema saem
  // da tela cheia sem passar pelo nosso botão. O invalidateSize é obrigatório —
  // o Leaflet mede o container na montagem e não sabe que ele mudou de tamanho.
  useEffect(() => {
    const aoMudar = () => {
      const cheio = !!document.fullscreenElement;
      setTelaCheia(cheio);
      setTimeout(() => mapaRef.current?.invalidateSize(), 80);
    };
    document.addEventListener('fullscreenchange', aoMudar);
    return () => document.removeEventListener('fullscreenchange', aoMudar);
  }, []);

  // Busca por nome de lugar (bairro/cidade/rua) — evita arrastar o mapa
  // procurando a região a demarcar.
  const [consulta, setConsulta] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<LocalBusca[] | null>(null);
  const camadaPrevia = useRef<L.LayerGroup | null>(null);
  const [previa, setPrevia] = useState<LocalBusca | null>(null);

  // `desenhando` é lido dentro do handler de clique do Leaflet, que é registrado
  // uma única vez — sem ref, o handler capturaria o valor do primeiro render e o
  // desenho nunca funcionaria. A escrita vai num efeito, não no corpo do render:
  // mexer em ref durante o render é impuro (e o lint do React reclama). Efeito
  // basta, porque roda no commit, antes de qualquer clique acontecer.
  const desenhandoRef = useRef(desenhando);
  useEffect(() => { desenhandoRef.current = desenhando; }, [desenhando]);

  // Monta o mapa uma vez.
  useEffect(() => {
    if (!divRef.current || mapaRef.current) return;
    // Sem coordenada da loja, abrir em zoom 14 mostra um close de lugar nenhum
    // (foi o que dava a impressão de "estou no meio do mato"). Zoom 4 mostra o
    // país inteiro, deixando claro que é uma visão inicial e que é pra buscar.
    const mapa = L.map(divRef.current, { zoomControl: true }).setView(centro, centroEhReal ? 14 : 4);
    const e = ESTILOS[estiloSalvo()];
    camadaBase.current = L.tileLayer(e.url, { attribution: e.atribuicao, maxZoom: e.maxZoom }).addTo(mapa);

    /**
     * Marca a loja: é a referência de "onde eu estou" pra desenhar em volta.
     *
     * Só desenha se a loja REALMENTE tem coordenada. Sem `centroEhReal`, o
     * marcador aparecia sobre o centro geográfico do Brasil (o fallback usado
     * pra não abrir o mapa no oceano) rotulado "Sua loja" — o lojista via a
     * própria loja cravada no meio do Mato Grosso e concluía, com razão, que o
     * mapa estava quebrado.
     */
    if (centroEhReal) {
      L.marker(centro, {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:${corDoTema('--primary')};width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
          iconSize: [14, 14], iconAnchor: [7, 7],
        }),
      }).addTo(mapa).bindTooltip('Sua loja');
    }

    camadaAreas.current = L.layerGroup().addTo(mapa);
    camadaDesenho.current = L.layerGroup().addTo(mapa);
    camadaPrevia.current = L.layerGroup().addTo(mapa);

    mapa.on('click', (e: L.LeafletMouseEvent) => {
      if (!desenhandoRef.current) return;
      setPontos(p => [...p, [e.latlng.lat, e.latlng.lng]]);
    });

    mapaRef.current = mapa;
    // Leaflet mede errado quando o container aparece depois (aba/acordeão):
    // um invalidateSize no próximo tick evita o mapa "meio cinza".
    setTimeout(() => mapa.invalidateSize(), 60);
    return () => { mapa.remove(); mapaRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recentra se a loja ganhar coordenada depois (ex.: acabou de geocodificar).
  // Sem coordenada real não recentra: arrastaria o lojista de volta pro chute
  // inicial justamente depois de ele ter buscado a região onde quer desenhar.
  useEffect(() => {
    if (!centroEhReal) return;
    mapaRef.current?.setView(centro, mapaRef.current.getZoom() || 14);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro[0], centro[1], centroEhReal]);

  // Redesenha as áreas salvas.
  useEffect(() => {
    const grupo = camadaAreas.current;
    if (!grupo) return;
    grupo.clearLayers();
    for (const a of areas) {
      if (a.poligono.length < 3) continue;
      const selecionada = areaSelecionada === a.id;
      const poly = L.polygon(a.poligono, {
        color: corDoTema('--primary'),
        weight: selecionada ? 4 : 2,
        fillColor: corDoTema('--primary'),
        fillOpacity: selecionada ? 0.35 : 0.15,
      }).addTo(grupo);
      const taxa = a.taxa_centavos === 0
        ? 'grátis'
        : (a.taxa_centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      poly.bindTooltip(`${a.nome || 'Área'} — ${taxa}`, { sticky: true });
      if (onSelecionar) poly.on('click', () => onSelecionar(a.id));
    }
  }, [areas, areaSelecionada, onSelecionar]);

  // Desenha o rascunho conforme o lojista clica.
  useEffect(() => {
    const grupo = camadaDesenho.current;
    if (!grupo) return;
    grupo.clearLayers();
    if (pontos.length === 0) return;
    // Com 1–2 pontos ainda não há área: mostra a linha pra dar retorno visual.
    if (pontos.length < 3) {
      L.polyline(pontos, { color: corDoTema('--primary'), weight: 3, dashArray: '6 6' }).addTo(grupo);
    } else {
      L.polygon(pontos, {
        color: corDoTema('--primary'), weight: 3, dashArray: '6 6',
        fillColor: corDoTema('--primary'), fillOpacity: 0.2,
      }).addTo(grupo);
    }
    pontos.forEach(p => {
      L.circleMarker(p, {
        radius: 5, color: '#fff', weight: 2,
        fillColor: corDoTema('--primary'), fillOpacity: 1,
      }).addTo(grupo);
    });
  }, [pontos]);

  // Sair do modo desenho limpa o rascunho.
  useEffect(() => { if (!desenhando) setPontos([]); }, [desenhando]);

  /**
   * Busca disparada por AÇÃO EXPLÍCITA (Enter/botão), nunca a cada tecla: o
   * Nominatim permite ~1 requisição por segundo e busca-enquanto-digita
   * queimaria a cota (e poderia bloquear o servidor).
   */
  async function buscar() {
    const q = consulta.trim();
    if (q.length < 3) return;
    setBuscando(true);
    setResultados(null);
    try {
      const r = await api<{ locais: LocalBusca[] }>('GET', `/api/lojista/buscar-local?q=${encodeURIComponent(q)}`);
      setResultados(r.locais);
      if (r.locais.length > 0) irPara(r.locais[0]);
    } catch {
      setResultados([]);
    } finally {
      setBuscando(false);
    }
  }

  /** Enquadra o mapa no lugar e, se houver contorno, mostra como prévia. */
  function irPara(local: LocalBusca) {
    const mapa = mapaRef.current;
    if (!mapa) return;
    if (local.caixa) {
      const [sul, norte, oeste, leste] = local.caixa;
      mapa.fitBounds([[sul, oeste], [norte, leste]], { padding: [24, 24] });
    } else {
      mapa.setView([local.lat, local.lon], 15);
    }
    setPrevia(local.contorno && local.contorno.length >= 3 ? local : null);
  }

  // Desenha a prévia do contorno buscado (tracejado, cor distinta das áreas já
  // salvas — é proposta, não área ativa).
  useEffect(() => {
    const grupo = camadaPrevia.current;
    if (!grupo) return;
    grupo.clearLayers();
    if (!previa?.contorno) return;
    L.polygon(previa.contorno, {
      color: corDoTema('--foreground'), weight: 2, dashArray: '4 6',
      fillColor: corDoTema('--foreground'), fillOpacity: 0.08,
    }).addTo(grupo);
  }, [previa]);

  return (
    <div className="space-y-2">
      {/* Busca por nome do lugar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={consulta}
            onChange={e => setConsulta(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } }}
            placeholder="Buscar bairro ou cidade — ex.: Centro, Blumenau"
            className="h-10 pl-8"
          />
        </div>
        <Button type="button" className="h-10 shrink-0" onClick={buscar} disabled={buscando || consulta.trim().length < 3}>
          {buscando ? 'Buscando…' : 'Buscar'}
        </Button>
      </div>

      {/* Resultados: clicar leva o mapa até o lugar */}
      {resultados !== null && (
        resultados.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">
            Nada encontrado. Tente incluir a cidade — ex.: “Centro, Blumenau, SC”.
          </p>
        ) : (
          <div className="max-h-32 overflow-y-auto rounded-xl border border-border divide-y divide-border/60">
            {resultados.map((l, i) => (
              <button
                key={i} type="button" onClick={() => irPara(l)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-accent/50"
              >
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <span className="flex-1">{l.nome}</span>
                {l.contorno && l.contorno.length >= 3 && (
                  <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] font-bold text-primary">
                    tem contorno
                  </span>
                )}
              </button>
            ))}
          </div>
        )
      )}

      {/* Contorno pronto: o atalho que evita desenhar à mão */}
      {previa?.contorno && onUsarContorno && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-dashed border-border bg-accent/30 p-2.5">
          <span className="flex-1 text-xs">
            Encontrei o contorno deste bairro no mapa ({previa.contorno.length} pontos).
            Pode usar como área e ajustar depois.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => setPrevia(null)}>
            Descartar
          </Button>
          <Button type="button" size="sm" onClick={() => { onUsarContorno(previa.contorno!, previa.nome.split(',')[0]); setPrevia(null); }}>
            <Check className="size-3.5" /> Usar este contorno
          </Button>
        </div>
      )}

      <div
        ref={molduraRef}
        className={cn('relative', telaCheia && 'bg-background p-2')}
      >
      <div
        ref={divRef}
        className={cn(
          'w-full rounded-2xl border border-border',
          // Em tela cheia o mapa ocupa a altura toda menos a margem da moldura.
          telaCheia ? 'h-[calc(100vh-1rem)]' : 'h-[380px]',
        )}
      />

      {/*
        Busca DENTRO da tela cheia. A barra de busca normal fica fora da moldura,
        então em tela cheia ela desaparecia — e aí a tela cheia virava uma
        armadilha: você entra pra desenhar com espaço e perde justamente o jeito
        de chegar no bairro. Mesmo estado e mesma função da busca de cima.
      */}
      {telaCheia && (
        <div className="absolute left-3 top-3 z-[600] flex w-[min(420px,60vw)] gap-1.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={consulta}
              onChange={e => setConsulta(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } }}
              placeholder="Buscar bairro ou cidade"
              className="h-9 bg-card/95 pl-9 shadow-lg backdrop-blur"
            />
          </div>
          <Button type="button" size="sm" className="h-9 shadow-lg" disabled={buscando} onClick={buscar}>
            {buscando ? '…' : 'Buscar'}
          </Button>
        </div>
      )}

      {/* Estilo do mapa + tela cheia. z alto: tem que ficar acima dos painéis do Leaflet. */}
      <div className="absolute right-3 top-3 z-[600] flex items-center gap-1.5">
        <div className="flex overflow-hidden rounded-xl border border-border bg-card/95 shadow-lg backdrop-blur">
          {(Object.keys(ESTILOS) as ChaveEstilo[]).map(k => (
            <button
              key={k}
              type="button"
              onClick={() => trocarEstilo(k)}
              className={cn(
                'px-2.5 py-1.5 text-[11px] font-bold transition-colors',
                estilo === k ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
              )}
            >
              {ESTILOS[k].rotulo}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={alternarTelaCheia}
          title={telaCheia ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}
          className="flex size-8 items-center justify-center rounded-xl border border-border bg-card/95 shadow-lg backdrop-blur hover:bg-accent"
        >
          {telaCheia ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      </div>

      {desenhando && (
        <div className="absolute inset-x-3 bottom-3 z-[500] flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/95 p-2.5 shadow-lg backdrop-blur">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MapPin className="size-3.5 text-primary" />
            {pontos.length < 3
              ? `Toque no mapa pra marcar os cantos (${pontos.length}/3 mínimo)`
              : `${pontos.length} pontos — feche a área quando terminar`}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button type="button" size="sm" variant="outline" disabled={pontos.length === 0}
              onClick={() => setPontos(p => p.slice(0, -1))}>
              <Undo2 className="size-3.5" /> Desfazer
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCancelarDesenho}>
              <X className="size-3.5" /> Cancelar
            </Button>
            <Button type="button" size="sm" disabled={pontos.length < 3}
              onClick={() => onDesenhoConcluido(pontos)}>
              <Check className="size-3.5" /> Fechar área
            </Button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
