/**
 * Resolução da taxa de entrega — ponto ÚNICO de decisão.
 *
 * Existe porque o cálculo do frete precisa dar o mesmo resultado em três
 * lugares: no checkout (que cobra), na prévia que o cliente vê antes de
 * finalizar, e na validação de "atende esse endereço?". Se cada um calculasse do
 * seu jeito, o cliente veria um valor e pagaria outro.
 *
 * Ordem de precedência:
 *   1. ÁREA desenhada no mapa (polígono) que contenha o endereço — a mais
 *      específica, é o que o lojista desenhou de propósito;
 *   2. BAIRRO cadastrado com o mesmo nome (modelo antigo, mantido);
 *   3. taxa padrão da loja.
 *
 * REGRA DE BLOQUEIO: se a loja tem ao menos uma ÁREA desenhada e o endereço não
 * cai em nenhuma, o pedido é recusado ("não entregamos aí"). O bloqueio é
 * portanto OPT-IN: quem nunca desenhou área nenhuma segue funcionando como antes
 * — desenhar é o ato de dizer "atendo só aqui". Sem isso, publicar esta feature
 * derrubaria o checkout de toda loja já existente.
 */
import db from './db-mysql';
import { pontoDentroDoPoligono, poligonoValido, type Ponto } from './geometria';
import { normalizarBairro } from './util';

export interface ResultadoFrete {
  taxaCentavos: number;
  /** De onde veio a taxa — útil pra explicar na UI e pra depurar. */
  fonte: 'area' | 'bairro' | 'padrao';
  /** Rótulo da zona que decidiu (nome da área ou bairro). Vazio na taxa padrão. */
  zona: string;
}

interface LinhaZona {
  id: number;
  bairro: string;
  taxa_centavos: number;
  nome: string | null;
  poligono_json: string | null;
}

/** Endereço mínimo pra decidir o frete. lat/lon podem faltar (endereço antigo). */
export interface EnderecoParaFrete {
  bairro?: string | null;
  lat?: number | null;
  lon?: number | null;
}

/**
 * Calcula o frete. Devolve `null` quando a loja NÃO ATENDE o endereço — o
 * chamador decide o que fazer (o checkout recusa; a prévia avisa).
 */
export async function resolverFrete(
  lojaId: number,
  endereco: EnderecoParaFrete,
  taxaPadraoCentavos: number,
): Promise<ResultadoFrete | null> {
  const zonas = await db.prepare(
    'SELECT id, bairro, taxa_centavos, nome, poligono_json FROM zonas_entrega WHERE loja_id = ?'
  ).all(lojaId) as LinhaZona[];

  const areas = zonas.filter(z => !!z.poligono_json);
  const temCoordenada = Number.isFinite(Number(endereco.lat)) && Number.isFinite(Number(endereco.lon));

  // 1) Área desenhada que contém o ponto.
  if (areas.length > 0 && temCoordenada) {
    const ponto: Ponto = [Number(endereco.lat), Number(endereco.lon)];
    for (const z of areas) {
      let pontos: Ponto[] | null = null;
      try { pontos = poligonoValido(JSON.parse(z.poligono_json as string)); } catch { pontos = null; }
      if (!pontos) continue; // zona corrompida não bloqueia nem cobra
      if (pontoDentroDoPoligono(ponto, pontos)) {
        return { taxaCentavos: z.taxa_centavos, fonte: 'area', zona: z.nome || 'Área de entrega' };
      }
    }
  }

  // 2) Bairro cadastrado (modelo antigo). Vale mesmo havendo áreas: cobre o
  //    endereço sem coordenada (geocodificação falhou) que a área não alcança.
  const bairroCliente = normalizarBairro(endereco.bairro || '');
  if (bairroCliente) {
    const porBairro = zonas.find(z => !z.poligono_json && normalizarBairro(z.bairro) === bairroCliente);
    if (porBairro) {
      return { taxaCentavos: porBairro.taxa_centavos, fonte: 'bairro', zona: porBairro.bairro };
    }
  }

  // 3) Fora de toda área desenhada = não atende (ver REGRA DE BLOQUEIO no topo).
  //    Só bloqueia se havia área E dava pra localizar o endereço: sem coordenada,
  //    recusar seria punir o cliente por uma falha nossa de geocodificação.
  if (areas.length > 0 && temCoordenada) return null;

  return { taxaCentavos: taxaPadraoCentavos, fonte: 'padrao', zona: '' };
}
