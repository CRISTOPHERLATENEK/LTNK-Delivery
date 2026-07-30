/**
 * Geometria das áreas de entrega — sem dependência externa.
 *
 * As zonas de entrega desenhadas no mapa são polígonos de [lat, lon]. Aqui vive
 * a pergunta que o checkout faz: "o endereço do cliente cai dentro desta área?".
 *
 * Erro de geometria é silencioso e caro (cobra frete errado, ou recusa cliente
 * que deveria ser atendido), por isso este módulo é isolado e tem teste próprio.
 */

/** Ponto no formato [latitude, longitude] — a mesma ordem que o Leaflet usa. */
export type Ponto = [number, number];

/**
 * O ponto está dentro do polígono? (algoritmo do raio / ray casting)
 *
 * Traça um raio horizontal do ponto para o infinito e conta quantas arestas ele
 * cruza: número ímpar = dentro. Funciona com polígono côncavo, e não exige que
 * os vértices estejam em ordem horária ou anti-horária.
 *
 * Usa coordenadas como plano cartesiano — a distorção da curvatura da Terra é
 * irrelevante na escala de uma área de entrega (poucos km).
 *
 * Ponto exatamente sobre a aresta é caso de borda ambíguo por natureza; aqui a
 * regra é "vale a implementação padrão", porque a chance de um endereço
 * geocodificado cair exatamente sobre a linha é desprezível e qualquer decisão
 * seria arbitrária.
 */
export function pontoDentroDoPoligono(ponto: Ponto, poligono: Ponto[]): boolean {
  // Menos de 3 vértices não delimita área nenhuma.
  if (!Array.isArray(poligono) || poligono.length < 3) return false;

  const [y, x] = ponto; // y = lat, x = lon
  let dentro = false;

  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [yi, xi] = poligono[i];
    const [yj, xj] = poligono[j];

    // A aresta cruza a horizontal que passa pelo ponto? E o cruzamento fica à
    // direita do ponto? (comparação em x)
    const cruzaHorizontal = (yi > y) !== (yj > y);
    if (!cruzaHorizontal) continue;
    const xNoCruzamento = xi + ((y - yi) / (yj - yi)) * (xj - xi);
    if (x < xNoCruzamento) dentro = !dentro;
  }
  return dentro;
}

/**
 * Valida e normaliza um polígono vindo do cliente (JSON do editor de mapa).
 * Devolve null se não for uma área utilizável — assim quem chama nunca precisa
 * confiar no formato do que veio pela rede.
 */
export function poligonoValido(bruto: unknown): Ponto[] | null {
  if (!Array.isArray(bruto) || bruto.length < 3) return null;
  // Limite de vértices: protege contra payload gigante (o editor gera dezenas,
  // não milhares) e mantém o ponto-em-polígono barato no caminho do checkout.
  if (bruto.length > 200) return null;

  const pontos: Ponto[] = [];
  for (const p of bruto) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const lat = Number(p[0]), lon = Number(p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    pontos.push([lat, lon]);
  }
  return pontos;
}

/**
 * Distância aproximada em km entre dois pontos (Haversine).
 *
 * Não é usada para decidir a zona (isso é polígono), e sim para ordenar/informar
 * — ex.: mostrar ao lojista a que distância está um endereço fora da área.
 */
export function distanciaKm(a: Ponto, b: Ponto): number {
  const R = 6371; // raio médio da Terra em km
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
