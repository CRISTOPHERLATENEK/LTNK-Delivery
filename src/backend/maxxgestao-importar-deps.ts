/**
 * A GRAVAÇÃO DA IMPORTAÇÃO DO MAXX GESTÃO.
 *
 * O banco mora aqui e a decisão mora em `maxxgestao-importar`. A separação não
 * é gosto: é o que deixa as regras que custam dinheiro (nunca mexer no preço,
 * nunca apagar, nunca publicar sozinho) serem testadas sem MySQL.
 */
import db from './db-mysql';
import { agoraUTC } from './util';
import type { PlanoImportacao, ProdutoNosso } from './maxxgestao-importar';

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
            preco_centavos
       FROM produtos WHERE loja_id = ? AND excluido = 0`
  ).all(lojaId) as Array<{
    id: number; nome: string; descricao: string | null; categoria: string | null;
    maxxgestao_variacao_id: number; disponivel: number; preco_centavos: number;
  }>;
  return linhas.map(l => ({
    id: l.id,
    nome: l.nome ?? '',
    descricao: l.descricao ?? '',
    categoria: l.categoria ?? '',
    variacaoErp: Number(l.maxxgestao_variacao_id ?? 0),
    disponivel: !!l.disponivel,
    precoCentavos: Number(l.preco_centavos ?? 0),
  }));
}

export interface ResultadoGravacao {
  criados: number;
  atualizados: number;
  pausados: number;
}

/** Aplica o plano. Só isto escreve no banco. */
export async function aplicarPlano(lojaId: number, plano: PlanoImportacao): Promise<ResultadoGravacao> {
  const agora = agoraUTC();
  let criados = 0;

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
    await db.prepare(
      `INSERT INTO produtos (loja_id, nome, descricao, categoria, preco_centavos,
                             codigo_barras, maxxgestao_variacao_id,
                             disponivel, disponivel_pdv, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`
    ).run(lojaId, p.nome, p.descricao, p.categoria, p.precoCentavos,
          p.codigoBarras, p.variacao, agora);
    criados++;
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
    if (!sets.length) continue;
    vals.push(a.id, lojaId);
    await db.prepare(`UPDATE produtos SET ${sets.join(', ')} WHERE id = ? AND loja_id = ?`).run(...vals);
    atualizados++;
  }

  let pausados = 0;
  for (const id of plano.pausar) {
    /* PAUSA, NÃO EXCLUI: o histórico de pedidos aponta para este produto. */
    await db.prepare(
      'UPDATE produtos SET disponivel = 0, disponivel_pdv = 0 WHERE id = ? AND loja_id = ?'
    ).run(id, lojaId);
    pausados++;
  }

  return { criados, atualizados, pausados };
}
