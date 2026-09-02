/**
 * O PREÂMBULO DA IMPORTAÇÃO, GUARDADO ENTRE OS LOTES.
 *
 * Antes de varrer o catálogo é preciso ler três coisas do ERP:
 *
 *   ids da seção (11 requisições) · categorias (2) · tabela de preço (11)
 *
 * São 24 — mais que a janela inteira de 20 por minuto. Sem guardar, cada lote
 * gastava o orçamento todo no preâmbulo e sobrava zero para varrer letra: a
 * importação rodava minutos sem importar nada. Foi exatamente o que aconteceu
 * (`0 lidos em 0 letra(s) ... 1065 preços na tabela`).
 *
 * NO BANCO E NÃO EM MEMÓRIA porque o PM2 roda três instâncias: o lote 2 cai
 * numa instância diferente do lote 1, e um cache em memória estaria sempre frio
 * justamente na hora de servir.
 */
import db from './db-mysql';
import { agoraUTC } from './util';

/** Dez minutos: mais que uma importação inteira, menos que um cardápio mudar. */
export const VALIDADE_MS = 10 * 60_000;

export interface Preambulo {
  /** Códigos de mercadoria que existem no ERP — decide o que pausar. */
  ids: number[];
  /**
   * O catálogo escolhido e os ids dele, quando a importação é de um só.
   *
   * Guardado junto porque o lote seguinte precisa peneirar pelo MESMO catálogo:
   * trocar de catálogo no meio da varredura misturaria dois cardápios.
   */
  catalogo?: number;
  idsCatalogo?: number[];
  /** `codigoMercadoriaVariacao` → preço em centavos. */
  precos: Array<[number, number]>;
  subgrupos: Array<[number, string]>;
  grupos: Array<[number, string]>;
}

/** O que veio do banco, já datado. Nulo quando não há ou venceu. */
export async function lerPreambulo(lojaId: number, agoraMs = Date.now()): Promise<Preambulo | null> {
  const linha = await db.prepare(
    'SELECT dados, atualizado_em FROM maxxgestao_cache WHERE loja_id = ?'
  ).get(lojaId) as { dados: string; atualizado_em: string } | undefined;
  if (!linha?.dados) return null;

  const quando = Date.parse(linha.atualizado_em);
  /* Data ilegível conta como vencida: melhor pagar 24 requisições de novo que
     importar cardápio com preço de semana passada. */
  if (!Number.isFinite(quando) || agoraMs - quando > VALIDADE_MS) return null;

  try {
    const d = JSON.parse(linha.dados) as Partial<Preambulo>;
    if (!Array.isArray(d.ids) || !Array.isArray(d.precos)) return null;
    return {
      ids: d.ids,
      /* O catálogo tem que voltar: sem ele, o lote seguinte acharia que a
         importação é da empresa inteira e traria produto de outro cardápio. */
      catalogo: Number(d.catalogo ?? 0) || 0,
      idsCatalogo: Array.isArray(d.idsCatalogo) ? d.idsCatalogo : [],
      precos: d.precos,
      subgrupos: Array.isArray(d.subgrupos) ? d.subgrupos : [],
      grupos: Array.isArray(d.grupos) ? d.grupos : [],
    };
  } catch {
    /* JSON estragado é rascunho perdido, não erro de negócio. */
    return null;
  }
}

export async function gravarPreambulo(lojaId: number, p: Preambulo): Promise<void> {
  /* Uma linha por loja, sobrescrita: é rascunho, não histórico. */
  await db.prepare(
    `INSERT INTO maxxgestao_cache (loja_id, dados, atualizado_em) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE dados = VALUES(dados), atualizado_em = VALUES(atualizado_em)`
  ).run(lojaId, JSON.stringify(p), agoraUTC());
}

/** Depois de terminar, o rascunho não serve para nada. */
export async function apagarPreambulo(lojaId: number): Promise<void> {
  await db.prepare('DELETE FROM maxxgestao_cache WHERE loja_id = ?').run(lojaId);
}

/** Mapas prontos para uso, a partir do que foi guardado. */
export function abrirPreambulo(p: Preambulo): {
  ids: Set<number>;
  precos: Map<number, number>;
  mapas: { subgrupos: Map<number, string>; grupos: Map<number, string> };
} {
  return {
    ids: new Set(p.ids),
    precos: new Map(p.precos),
    mapas: { subgrupos: new Map(p.subgrupos), grupos: new Map(p.grupos) },
  };
}
