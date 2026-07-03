/**
 * Mapa de rastreamento ao vivo (Leaflet + OpenStreetMap, sem chave de API).
 * Mostra a posição do entregador e a recentraliza suavemente a cada update.
 */
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface Props {
  lat: number;
  lng: number;
  /** Texto opcional exibido no popup do pino. */
  rotulo?: string;
  className?: string;
}

/** Ícone do entregador como divIcon (evita o bug de path dos ícones do Leaflet). */
function iconeEntregador() {
  return L.divIcon({
    className: 'mapa-pino-entregador',
    html: `
      <div style="position:relative;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;width:44px;height:44px;border-radius:9999px;background:hsl(var(--primary)/0.25);animation:pino-pulso 1.8s ease-out infinite;"></div>
        <div style="position:relative;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9999px;background:hsl(var(--primary));color:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-size:18px;">🛵</div>
      </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

export function MapaRastreamento({ lat, lng, rotulo, className }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const marcadorRef = useRef<L.Marker | null>(null);

  // Cria o mapa uma única vez.
  useEffect(() => {
    if (!divRef.current || mapaRef.current) return;

    const mapa = L.map(divRef.current, {
      center: [lat, lng],
      zoom: 16,
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(mapa);

    const marcador = L.marker([lat, lng], { icon: iconeEntregador() }).addTo(mapa);
    if (rotulo) marcador.bindPopup(rotulo);

    mapaRef.current = mapa;
    marcadorRef.current = marcador;

    // Garante o tamanho correto após o layout assentar.
    setTimeout(() => mapa.invalidateSize(), 200);

    return () => {
      mapa.remove();
      mapaRef.current = null;
      marcadorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atualiza a posição do pino e recentraliza suavemente a cada novo dado.
  useEffect(() => {
    if (!mapaRef.current || !marcadorRef.current) return;
    marcadorRef.current.setLatLng([lat, lng]);
    if (rotulo) marcadorRef.current.bindPopup(rotulo);
    mapaRef.current.panTo([lat, lng], { animate: true, duration: 0.8 });
  }, [lat, lng, rotulo]);

  return (
    <div
      ref={divRef}
      className={className}
      style={{ width: '100%', height: '100%', zIndex: 0 }}
    />
  );
}
