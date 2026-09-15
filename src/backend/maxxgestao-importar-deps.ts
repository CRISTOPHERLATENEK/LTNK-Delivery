/**
 * A GRAVAÇÃO DA IMPORTAÇÃO DO MAXX GESTÃO.
 *
 * O banco mora aqui e a decisão mora em `maxxgestao-importar`. A separação não
 * é gosto: é o que deixa as regras que custam dinheiro (nunca mexer no preço,
 * nunca apagar, nunca publicar sozinho) serem testadas sem MySQL.
 */
import db from './db-mysql';
import { agoraUTC } from './util';
import type { PlanoImportacao, ProdutoNosso, EspelhoErp } from './maxxgestao-importar';
import type { AjusteDeEstoque, ProdutoComEstoque } from './maxxgestao-estoque';

/**
 * O cardápio do delivery, do jeito que a decisão precisa ver.
 *
 * Traz TODOS os produtos, não só os vinculados ao ERP: é o que permite ao
 * planejador saber que um produto nasceu aqui (`variacaoErp = 0`) e não
 * encostar nele. Sem isso, a primeira importação pausaria o cardápio inteiro
 * que o lojista montou à mão.
 */
export async function produtosDaLoja(lojaId: number): Promise<ProdutoNosso[]> {
  const linhas = await db.prepare(
    `SELECT id, nome, descricao, categoria, maxxgestao_variacao_id, disponivel,
            preco_centavos, sku, maxxgestao_espelho, codigo_barras
       FROM produtos WHERE loja_id = ? AND excluido = 0`
  ).all(lojaId) as Array<{
    id: number; nome: string; descricao: string | null; categoria: string | null;
    maxxgestao_variacao_id: number; disponivel: number; preco_centavos: number;
    sku: string | null; maxxgestao_espelho: string | null; codigo_barras: string | null;
  }>;
  return linhas.map(l => ({
    id: l.id,
    nome: l.nome ?? '',
    descricao: l.descricao ?? '',
    categoria: l.categoria ?? '',
    variacaoErp: Number(l.maxxgestao_variacao_id ?? 0),
    disponivel: !!l.disponivel,
    precoCentavos: Number(l.preco_centavos ?? 0),
    sku: l.sku ?? '',
    /* O segundo jeito de reconhecer o mesmo produto quando o vínculo com o ERP
       se perdeu — ver `codigoBarras` em `ProdutoNosso`. */
    codigoBarras: l.codigo_barras ?? '',
    /*
     * Espelho ilegível vale COMO AUSENTE, não como vazio: ausente significa
     * "trate como não editado" (o comportamento antigo), e vazio significaria
     * "o ERP mandou string vazia", o que congelaria o campo de quem tem JSON
     * estragado por qualquer motivo.
     */
    espelho: lerEspelho(l.maxxgestao_espelho),
  }));
}

/** O espelho gravado, ou `undefined` quando não há (ou está ilegível). */
function lerEspelho(bruto: string | null): EspelhoErp | undefined {
  if (!bruto) return undefined;
  try {
    const d = JSON.parse(bruto) as Partial<EspelhoErp>;
    if (typeof d?.nome !== 'string') return undefined;
    return {
      nome: d.nome,
      descricao: typeof d.descricao === 'string' ? d.descricao : '',
      categoria: typeof d.categoria === 'string' ? d.categoria : '',
    };
  } catch {
    return undefined;
  }
}

export interface ResultadoGravacao {
  criados: number;
  atualizados: number;
  pausados: number;
  /** Já existiam aqui e ganharam de volta o vínculo com o ERP. */
  religados: number;
  /**
   * O QUE NÃO ENTROU, e por quê.
   *
   * Existe porque UMA linha recusada pelo banco derrubava a gravação INTEIRA —
   * medido no Mostruário: um `Duplicate entry ... uq_produto_ean` levou junto
   * 1.118 atualizações legítimas, e no laço automático isso se repetiria toda
   * hora, em silêncio, para sempre.
   */
  falhas: string[];
}

/** Aplica o plano. Só isto escreve no banco. */
export async function aplicarPlano(lojaId: number, plano: PlanoImportacao): Promise<ResultadoGravacao> {
  const agora = agoraUTC();
  const falhas: string[] = [];
  let criados = 0;

  /*
   * O VÍNCULO QUE FALTAVA, ANTES DE TUDO.
   *
   * Religar primeiro importa: são produtos que já existem aqui e cujo EAN o ERP
   * também tem. Se um `criar` da mesma passada rodasse antes, ele bateria no
   * índice único do EAN — que é exatamente o defeito que isto conserta.
   */
  let religados = 0;
  for (const r of plano.religar) {
    try {
      await db.prepare(
        'UPDATE produtos SET maxxgestao_variacao_id = ? WHERE id = ? AND loja_id = ?'
      ).run(r.variacao, r.id, lojaId);
      religados++;
    } catch (e) {
      falhas.push(`religar produto ${r.id}: ${(e as Error).message}`);
    }
  }

  for (const p of plano.criar) {
    /*
     * NASCE PAUSADO, com o preço que o ERP tiver.
     *
     * Sem preço lá, entra no marcador de R$ 0,01 — visivelmente errado de
     * propósito: qualquer valor plausível passaria batido e o produto seria
     * vendido por ele.
     *
     * PAUSADO MESMO COM PREÇO, e `disponivel_pdv` também zero. Publicar 1.100
     * produtos na loja de alguém porque uma importação rodou seria decidir pelo
     * lojista o que ele vende — e ele descobriria pelo cliente pedindo.
     */
    /*
     * UMA LINHA RECUSADA NÃO DERRUBA A PASSADA.
     *
     * Antes um `INSERT` recusado pelo banco estourava para fora de
     * `aplicarPlano` e levava junto TODO o resto — medido no Mostruário, um
     * `Duplicate entry ... uq_produto_ean` custou 1.118 atualizações legítimas.
     * No laço automático o estrago é maior: falharia toda hora, em silêncio.
     *
     * O EAN duplicado em si foi resolvido pelo religamento acima; isto aqui é
     * a rede embaixo — para o PRÓXIMO motivo, que ninguém previu.
     */
    try {
      await db.prepare(
        `INSERT INTO produtos (loja_id, nome, descricao, categoria, preco_centavos,
                               codigo_barras, maxxgestao_variacao_id, sku,
                               maxxgestao_espelho,
                               disponivel, disponivel_pdv, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`
      ).run(lojaId, p.nome, p.descricao, p.categoria, p.precoCentavos,
            p.codigoBarras, p.variacao, p.sku, JSON.stringify(p.espelho), agora);
      criados++;
    } catch (e) {
      falhas.push(`criar "${p.nome}": ${(e as Error).message}`);
    }
  }

  let atualizados = 0;
  for (const a of plano.atualizar) {
    /*
     * O UPDATE MONTA SÓ O QUE VEIO. O preço aparece aqui apenas quando o
     * planejador o incluiu — e ele só inclui por cima do marcador de R$ 0,01,
     * nunca por cima de preço que gente definiu.
     */
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (a.nome !== undefined) { sets.push('nome = ?'); vals.push(a.nome); }
    if (a.descricao !== undefined) { sets.push('descricao = ?'); vals.push(a.descricao); }
    if (a.categoria !== undefined) { sets.push('categoria = ?'); vals.push(a.categoria); }
    if (a.precoCentavos !== undefined) { sets.push('preco_centavos = ?'); vals.push(a.precoCentavos); }
    if (a.sku !== undefined) { sets.push('sku = ?'); vals.push(a.sku); }
    if (a.espelho !== undefined) { sets.push('maxxgestao_espelho = ?'); vals.push(JSON.stringify(a.espelho)); }
    if (!sets.length) continue;
    vals.push(a.id, lojaId);
    try {
      await db.prepare(`UPDATE produtos SET ${sets.join(', ')} WHERE id = ? AND loja_id = ?`).run(...vals);
      atualizados++;
    } catch (e) {
      falhas.push(`atualizar produto ${a.id}: ${(e as Error).message}`);
    }
  }

  let pausados = 0;
  for (const id of plano.pausar) {
    /* PAUSA, NÃO EXCLUI: o histórico de pedidos aponta para este produto. */
    try {
      await db.prepare(
        'UPDATE produtos SET disponivel = 0, disponivel_pdv = 0 WHERE id = ? AND loja_id = ?'
      ).run(id, lojaId);
      pausados++;
    } catch (e) {
      falhas.push(`pausar produto ${id}: ${(e as Error).message}`);
    }
  }

  return { criados, atualizados, pausados, religados, falhas };
}

/* ────────────────────────────── ESTOQUE ──────────────────────────────── */

/** Os produtos vinculados ao ERP, do jeito que a decisão de estoque precisa. */
export async function produtosComEstoque(lojaId: number): Promise<ProdutoComEstoque[]> {
  const linhas = await db.prepare(
    `SELECT id, maxxgestao_variacao_id, estoque, controla_estoque, disponivel, estoque_do_erp
       FROM produtos WHERE loja_id = ? AND excluido = 0 AND maxxgestao_variacao_id > 0`
  ).all(lojaId) as Array<{
    id: number; maxxgestao_variacao_id: number; estoque: number | null;
    controla_estoque: number; disponivel: number; estoque_do_erp: number;
  }>;
  return linhas.map(l => ({
    id: l.id,
    variacaoErp: Number(l.maxxgestao_variacao_id ?? 0),
    estoque: Number(l.estoque ?? 0),
    controlaEstoque: !!l.controla_estoque,
    estoqueDoErp: !!l.estoque_do_erp,
    disponivel: !!l.disponivel,
  }));
}

/**
 * Grava os saldos. SÓ A COLUNA `estoque` — `controla_estoque` não é tocado.
 *
 * Ligar o bloqueio junto tiraria 33% do cardápio do Galderio do ar no primeiro
 * minuto (medido: 210 de 644). Quem decide isso é o lojista, e o painel mostra
 * o número dele antes do clique.
 */
export async function aplicarEstoque(
  lojaId: number,
  ajustes: AjusteDeEstoque[],
): Promise<{ ajustados: number; falhas: string[] }> {
  const falhas: string[] = [];
  let ajustados = 0;
  for (const a of ajustes) {
    try {
      await db.prepare('UPDATE produtos SET estoque = ? WHERE id = ? AND loja_id = ?')
        .run(a.estoque, a.id, lojaId);
      ajustados++;
    } catch (e) {
      falhas.push(`estoque do produto ${a.id}: ${(e as Error).message}`);
    }
  }
  return { ajustados, falhas };
}

/**
 * LIGA E DESLIGA O "ESGOTA SOZINHO" dos produtos que vêm do ERP.
 *
 * `estoque_do_erp` anda JUNTO com `controla_estoque`, e é o que torna o
 * interruptor reversível: ao desligar, só voltam atrás os produtos que esta
 * função ligou — o que o lojista controlava à mão fica como estava.
 *
 * Em lote de 500 porque são mais de mil produtos e uma consulta por item seria
 * mil idas ao banco a cada passada; e em lote o MySQL resolve numa varredura de
 * índice só.
 */
export async function aplicarControleDeEstoque(
  lojaId: number,
  ligar: number[],
  desligar: number[],
): Promise<{ ligados: number; desligados: number; falhas: string[] }> {
  const falhas: string[] = [];
  const emLotes = async (ids: number[], sql: string): Promise<number> => {
    let feitos = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const lote = ids.slice(i, i + 500);
      try {
        await db.prepare(
          `UPDATE produtos SET ${sql} WHERE loja_id = ? AND id IN (${lote.map(() => '?').join(',')})`
        ).run(lojaId, ...lote);
        feitos += lote.length;
      } catch (e) {
        falhas.push(`controle de estoque (${lote.length} produtos): ${(e as Error).message}`);
      }
    }
    return feitos;
  };

  const ligados = ligar.length
    ? await emLotes(ligar, 'controla_estoque = 1, estoque_do_erp = 1') : 0;
  const desligados = desligar.length
    ? await emLotes(desligar, 'controla_estoque = 0, estoque_do_erp = 0') : 0;
  return { ligados, desligados, falhas };
}
