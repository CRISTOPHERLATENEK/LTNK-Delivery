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
    `SELECT id, nome, descricao, categoria, maxxgestao_variacao_id, disponivel
       FROM produtos WHERE loja_id = ? AND excluido = 0`
  ).all(lojaId) as Array<{
    id: number; nome: string; descricao: string | null; categoria: string | null;
    maxxgestao_variacao_id: number; disponivel: number;
  }>;
  return linhas.map(l => ({
    id: l.id,
    nome: l.nome ?? '',
    descricao: l.descricao ?? '',
    categoria: l.categoria ?? '',
    variacaoErp: Number(l.maxxgestao_variacao_id ?? 0),
    disponivel: !!l.disponivel,
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
     * NASCE PAUSADO E A R$ 0,01.
     *
     * O CHECK da coluna exige `preco_centavos > 0`, então zero não entra. Um
     * centavo é visivelmente errado de propósito: produto a R$ 0,01 e pausado
     * grita "me preencha", e qualquer valor plausível passaria batido — e seria
     * vendido por esse valor.
     *
     * `disponivel_pdv` também zero: publicar no balcão um produto sem preço
     * definido é o mesmo erro pela outra porta.
     */
    await db.prepare(
      `INSERT INTO produtos (loja_id, nome, descricao, categoria, preco_centavos,
                             codigo_barras, maxxgestao_variacao_id,
                             disponivel, disponivel_pdv, criado_em)
       VALUES (?, ?, ?, ?, 1, ?, ?, 0, 0, ?)`
    ).run(lojaId, p.nome, p.descricao, p.categoria, p.codigoBarras, p.variacao, agora);
    criados++;
  }

  let atualizados = 0;
  for (const a of plano.atualizar) {
    /*
     * O UPDATE MONTA SÓ O QUE VEIO, e NÃO tem coluna de preço nem por acidente.
     * Um `preco_centavos = ?` aqui, mesmo com valor "certo", desfaria o
     * trabalho de quem precificou o cardápio na próxima importação.
     */
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (a.nome !== undefined) { sets.push('nome = ?'); vals.push(a.nome); }
    if (a.descricao !== undefined) { sets.push('descricao = ?'); vals.push(a.descricao); }
    if (a.categoria !== undefined) { sets.push('categoria = ?'); vals.push(a.categoria); }
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
