/**
 * Mapa com a rota completa da corrida: ponto de retirada (loja), ponto de
 * entrega (cliente) e, se disponível, a posição ao vivo do entregador — com
 * a linha da rota real desenhada via OSRM (roteamento gratuito, sem chave).
 * Best-effort: se o OSRM falhar/estiver fora do ar, cai numa linha reta.
 */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface Ponto { lat: number; lng: number; rotulo?: string }

interface Props {
  origem: Ponto;
  destino: Ponto;
  entregador?: Ponto | null;
  className?: string;
  /** Chamado quando a rota é calculada (distância/tempo do trajeto retirada→entrega). */
  onRota?: (info: { distanciaKm: number; duracaoMin: number }) => void;
}

function pino(emoji: string, cor: string, pulsar = false) {
  return L.divIcon({
    className: 'mapa-pino',
    html: `
      <div style="position:relative;display:flex;align-items:center;justify-content:center;">
        ${pulsar ? `<div style="position:absolute;width:40px;height:40px;border-radius:9999px;background:${cor}40;animation:pino-pulso 1.8s ease-out infinite;"></div>` : ''}
        <div style="position:relative;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9999px;background:${cor};color:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);font-size:16px;">${emoji}</div>
      </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

export function MapaRota({ origem, destino, entregador, className, onRota }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const marcadorOrigemRef = useRef<L.Marker | null>(null);
  const marcadorDestinoRef = useRef<L.Marker | null>(null);
  const marcadorEntregadorRef = useRef<L.Marker | null>(null);
  const linhaRef = useRef<L.Polyline | null>(null);
  const [erroRota, setErroRota] = useState(false);

  // Cria o mapa uma única vez.
  useEffect(() => {
    if (!divRef.current || mapaRef.current) return;

    const mapa = L.map(divRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,
    });
    mapa.fitBounds([[origem.lat, origem.lng], [destino.lat, destino.lng]], { padding: [40, 40] });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(mapa);

    marcadorOrigemRef.current = L.marker([origem.lat, origem.lng], { icon: pino('🏪', '#f59e0b') })
      .addTo(mapa).bindPopup(origem.rotulo || 'Retirada');
    marcadorDestinoRef.current = L.marker([destino.lat, destino.lng], { icon: pino('🏠', 'hsl(var(--primary))') })
      .addTo(mapa).bindPopup(destino.rotulo || 'Entrega');

    mapaRef.current = mapa;
    setTimeout(() => mapa.invalidateSize(), 200);

    return () => {
      mapa.remove();
      mapaRef.current = null;
      marcadorOrigemRef.current = null;
      marcadorDestinoRef.current = null;
      marcadorEntregadorRef.current = null;
      linhaRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Busca a rota real (OSRM) entre origem e destino — best-effort.
  useEffect(() => {
    let cancelado = false;
    async function buscarRota() {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${origem.lng},${origem.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson`;
        const controlador = new AbortController();
        const timer = setTimeout(() => controlador.abort(), 6000);
        const resp = await fetch(url, { signal: controlador.signal });
        clearTimeout(timer);
        if (!resp.ok) throw new Error('osrm falhou');
        const dados = await resp.json();
        const rota = dados?.routes?.[0];
        if (!rota || cancelado || !mapaRef.current) throw new Error('sem rota');

        const coords: [number, number][] = rota.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);
        if (linhaRef.current) linhaRef.current.remove();
        linhaRef.current = L.polyline(coords, { color: 'hsl(var(--primary))', weight: 4, opacity: 0.85 }).addTo(mapaRef.current);
        mapaRef.current.fitBounds(linhaRef.current.getBounds(), { padding: [40, 40] });

        onRota?.({ distanciaKm: rota.distance / 1000, duracaoMin: rota.duration / 60 });
        setErroRota(false);
      } catch {
        if (cancelado) return;
        setErroRota(true);
        // Fallback: linha reta + distância "de pássaro" (só pra não deixar sem número nenhum).
        if (mapaRef.current) {
          if (linhaRef.current) linhaRef.current.remove();
          linhaRef.current = L.polyline(
            [[origem.lat, origem.lng], [destino.lat, destino.lng]],
            { color: 'hsl(var(--primary))', weight: 3, opacity: 0.6, dashArray: '6 6' },
          ).addTo(mapaRef.current);
        }
        const R = 6371;
        const dLat = (destino.lat - origem.lat) * Math.PI / 180;
        const dLng = (destino.lng - origem.lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(origem.lat * Math.PI / 180) * Math.cos(destino.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        const distanciaKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        onRota?.({ distanciaKm, duracaoMin: (distanciaKm / 25) * 60 }); // ~25km/h estimado
      }
    }
    buscarRota();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origem.lat, origem.lng, destino.lat, destino.lng]);

  // Marcador do entregador ao vivo — some quando não há posição.
  useEffect(() => {
    if (!mapaRef.current) return;
    if (!entregador) {
      marcadorEntregadorRef.current?.remove();
      marcadorEntregadorRef.current = null;
      return;
    }
    if (!marcadorEntregadorRef.current) {
      marcadorEntregadorRef.current = L.marker([entregador.lat, entregador.lng], { icon: pino('🛵', 'hsl(var(--primary))', true) })
        .addTo(mapaRef.current);
    } else {
      marcadorEntregadorRef.current.setLatLng([entregador.lat, entregador.lng]);
    }
  }, [entregador?.lat, entregador?.lng]);

  return (
    <div className="relative h-full w-full">
      <div ref={divRef} className={className} style={{ width: '100%', height: '100%', zIndex: 0 }} />
      {erroRota && (
        <div className="absolute bottom-2 left-2 z-10 rounded-full bg-background/90 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground shadow">
          Rota estimada (sem conexão com o serviço de rotas)
        </div>
      )}
    </div>
  );
}
