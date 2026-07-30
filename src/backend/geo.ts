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

/** Resultado de busca por nome de lugar (bairro, cidade, rua). */
export interface LocalEncontrado {
  nome: string;
  lat: number;
  lon: number;
  /** [sul, norte, oeste, leste] — pra enquadrar o mapa no lugar todo. */
  caixa: [number, number, number, number] | null;
  /**
   * Contorno real do lugar, quando o OpenStreetMap tem (bairro e cidade
   * costumam ter; rua não). Em [lat, lon], já simplificado. É o que permite
   * "usar o contorno do bairro" em vez de desenhar à mão.
   */
  contorno: [number, number][] | null;
}

/**
 * Reduz a quantidade de vértices amostrando pontos a intervalo regular.
 *
 * Contorno de bairro no OSM vem com centenas a milhares de pontos — pesado pra
 * trafegar, pra guardar e pro ponto-em-polígono do checkout (que roda a cada
 * pedido). Na escala de uma área de entrega, a perda de precisão é de metros.
 */
export function simplificar(pontos: [number, number][], maximo = 120): [number, number][] {
  if (pontos.length <= maximo) return pontos;
  const passo = pontos.length / maximo;
  const saida: [number, number][] = [];
  for (let i = 0; i < maximo; i++) saida.push(pontos[Math.floor(i * passo)]);
  return saida;
}

/**
 * Extrai o maior anel de um GeoJSON de contorno, convertendo [lon,lat] (ordem
 * do GeoJSON) para [lat,lon] (ordem do Leaflet — trocar isso silenciosamente
 * joga a área pro outro lado do mundo).
 *
 * Pega só o ANEL EXTERNO MAIOR: bairro com ilha/enclave vira MultiPolygon, e
 * nosso modelo é um polígono por área. O lojista pode desenhar outra área pro
 * pedaço que faltar.
 */
export function contornoDoGeoJson(geo: unknown): [number, number][] | null {
  const g = geo as { type?: string; coordinates?: unknown };
  if (!g?.type || !Array.isArray(g.coordinates)) return null;

  let aneis: unknown[] = [];
  if (g.type === 'Polygon') aneis = [g.coordinates[0]];
  else if (g.type === 'MultiPolygon') aneis = (g.coordinates as unknown[][]).map(p => p[0]);
  else return null;

  let melhor: [number, number][] | null = null;
  for (const anel of aneis) {
    if (!Array.isArray(anel)) continue;
    const pontos: [number, number][] = [];
    for (const par of anel) {
      if (!Array.isArray(par) || par.length < 2) continue;
      const lon = Number(par[0]), lat = Number(par[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) pontos.push([lat, lon]);
    }
    if (pontos.length >= 3 && (!melhor || pontos.length > melhor.length)) melhor = pontos;
  }
  return melhor ? simplificar(melhor) : null;
}

/**
 * Busca lugares por nome no Brasil (bairro, cidade, rua…).
 *
 * Restrito a `countrycodes=br` — o produto é brasileiro, e sem isso "Centro"
 * traz resultado de qualquer país. `polygon_geojson=1` pede o contorno.
 *
 * ⚠️ O Nominatim permite ~1 req/s: a busca é disparada por ação explícita do
 * lojista (Enter/botão), nunca a cada tecla digitada.
 */
export async function buscarLocais(consulta: string, limite = 5): Promise<LocalEncontrado[]> {
  const q = consulta.trim();
  if (q.length < 3) return [];
  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      limit: String(Math.min(10, Math.max(1, limite))),
      countrycodes: 'br',
      polygon_geojson: '1',
      addressdetails: '1',
      q,
    });
    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort(), 8000);
    const resp = await fetch(`${BASE}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pt-BR' },
      signal: controlador.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return [];
    const arr = await resp.json();
    if (!Array.isArray(arr)) return [];

    return arr.flatMap((r: Record<string, unknown>) => {
      const lat = parseFloat(String(r.lat)), lon = parseFloat(String(r.lon));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
      const bb = Array.isArray(r.boundingbox) ? (r.boundingbox as string[]).map(Number) : null;
      const caixa = bb && bb.length === 4 && bb.every(Number.isFinite)
        ? [bb[0], bb[1], bb[2], bb[3]] as [number, number, number, number]
        : null;
      return [{
        nome: String(r.display_name || q),
        lat, lon, caixa,
        contorno: contornoDoGeoJson(r.geojson),
      }];
    });
  } catch {
    return [];
  }
}

const USER_AGENT = process.env.NOMINATIM_UA || 'DeliveryMultilojas/1.0 (+https://maxxtalk.com.br)';
const BASE = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';

export interface EnderecoParaGeo {
  rua: string;
  numero: string;
  bairro?: string;
  cidade: string;
  uf: string;
  cep?: string;
}

/**
 * Geocodifica um endereço em texto livre (ex.: o campo único `lojas.endereco`,
 * que não é estruturado em rua/número/cidade/UF como o endereço do cliente).
 * Mesma lógica best-effort de `geocodificar`, só troca os parâmetros de busca.
 */
export async function geocodificarTexto(endereco: string): Promise<Coordenadas | null> {
  const q = endereco.trim();
  if (!q) return null;
  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      limit: '1',
      countrycodes: 'br',
      q,
    });

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
    return null;
  }
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
