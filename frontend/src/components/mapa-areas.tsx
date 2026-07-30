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
import { Undo2, Check, X, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';

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

export function MapaAreas({
  centro, areas, areaSelecionada, desenhando, onDesenhoConcluido, onCancelarDesenho, onSelecionar,
}: {
  centro: PontoMapa;
  areas: AreaMapa[];
  areaSelecionada?: number | null;
  desenhando: boolean;
  onDesenhoConcluido: (poligono: PontoMapa[]) => void;
  onCancelarDesenho: () => void;
  onSelecionar?: (id: number) => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const camadaAreas = useRef<L.LayerGroup | null>(null);
  const camadaDesenho = useRef<L.LayerGroup | null>(null);
  const [pontos, setPontos] = useState<PontoMapa[]>([]);

  // `desenhando`/`pontos` são lidos dentro do handler de clique do Leaflet, que é
  // registrado uma única vez — sem ref, o handler capturaria o valor do primeiro
  // render e o desenho nunca funcionaria.
  const desenhandoRef = useRef(desenhando);
  desenhandoRef.current = desenhando;

  // Monta o mapa uma vez.
  useEffect(() => {
    if (!divRef.current || mapaRef.current) return;
    const mapa = L.map(divRef.current, { zoomControl: true }).setView(centro, 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(mapa);

    // Marca a loja: é a referência de "onde eu estou" pra desenhar em volta.
    L.marker(centro, {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:${corDoTema('--primary')};width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
        iconSize: [14, 14], iconAnchor: [7, 7],
      }),
    }).addTo(mapa).bindTooltip('Sua loja');

    camadaAreas.current = L.layerGroup().addTo(mapa);
    camadaDesenho.current = L.layerGroup().addTo(mapa);

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
  useEffect(() => {
    mapaRef.current?.setView(centro, mapaRef.current.getZoom() || 14);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro[0], centro[1]]);

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

  return (
    <div className="relative">
      <div ref={divRef} className="h-[380px] w-full rounded-2xl border border-border" />

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
  );
}
