/**
 * Geocodificação de endereço via OpenStreetMap / Nominatim — grátis, sem chave.
 * Converte rua/número/cidade/UF em coordenadas (lat/lon) pra deixar o mapa e a
 * navegação do entregador precisos (ponto exato em vez de busca por texto).
 *
 * Regras de uso do Nominatim: máximo ~1 req/s e User-Agent identificável (por
 * isso rodamos no backend, não no browser). É best-effort: qualquer falha
 * devolve null e o endereço é salvo sem coordenadas.
 */

export interface Coordenadas { lat: number; lon: number; }

const USER_AGENT = process.env.NOMINATIM_UA || 'DeliveryMultilojas/1.0 (+https://unimaxx.com.br)';
const BASE = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';

export interface EnderecoParaGeo {
  rua: string;
  numero: string;
  bairro?: string;
  cidade: string;
  uf: string;
  cep?: string;
}

export async function geocodificar(e: EnderecoParaGeo): Promise<Coordenadas | null> {
  if (!e.rua || !e.cidade || !e.uf) return null;
  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      limit: '1',
      countrycodes: 'br',
      street: `${e.numero} ${e.rua}`.trim(),
      city: e.cidade,
      state: e.uf,
    });
    if (e.cep) params.set('postalcode', e.cep);

    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort(), 6000);
    const resp = await fetch(`${BASE}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pt-BR' },
      signal: controlador.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return null;

    const arr = await resp.json();
    if (!Array.isArray(arr) || !arr[0]) return null;
    const lat = parseFloat(arr[0].lat);
    const lon = parseFloat(arr[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } catch {
    return null; // offline, timeout, rate limit — segue sem coordenadas
  }
}
