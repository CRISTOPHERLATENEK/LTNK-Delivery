/**
 * AS DEPENDÊNCIAS DE BANCO DA IMPORTAÇÃO DO CARDÁPIO.
 *
 * Vivem aqui, e não dentro da rota, porque a importação também precisa rodar
 * fora de um request — de um comando no servidor, quando a sessão do painel não
 * está à mão. Duplicar os INSERT no script seria pior que não ter script: o
 * comando passaria e o botão continuaria quebrado, ou o contrário, e ninguém
 * saberia qual dos dois caminhos foi testado.
 */
import db from './db-mysql';
import { agoraUTC } from './util';
import { grupoParaNosso, type DepsImportar } from './ifood-importar-gravar';
import type { DepsSincronizar } from './ifood-sincronizar-gravar';
import type { ProdutoNosso } from './ifood-sincronizar';

export function depsImportacaoIfood(
  registrar?: (nivel: 'info' | 'erro', msg: string) => void,
): DepsImportar {
  return {
    produtosPorCodigo: async lojaId => {
      const m = new Map<string, number>();
      for (const p of await db.prepare(
        "SELECT id, codigo_barras FROM produtos WHERE loja_id = ? AND excluido = 0 AND codigo_barras <> ''"
      ).all(lojaId) as Array<{ id: number; codigo_barras: string }>) m.set(p.codigo_barras, p.id);
      return m;
    },

    criarProduto: async (lojaId, p) => {
      const info = await db.prepare(
        `INSERT INTO produtos (loja_id, nome, descricao, categoria, preco_centavos,
                               codigo_barras, disponivel, disponivel_pdv, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`
      ).run(lojaId, p.nome, p.descricao, p.categoria,
            /*
             * O CHECK da coluna exige preco_centavos > 0, então não dá para
             * gravar zero. Grava 1 centavo — visivelmente errado, que é o
             * ponto: um produto a R$ 0,01 pausado grita "me preencha", e
             * qualquer valor plausível passaria despercebido.
             */
            Math.max(1, p.precoCentavos), p.codigoBarras, agoraUTC());
      return Number(info.lastInsertRowid);
    },

    criarGrupo: async (produtoId, g, ordem) => {
      const n = grupoParaNosso(g);
      const info = await db.prepare(
        `INSERT INTO grupos_opcoes (produto_id, nome, tipo, obrigatorio, max_escolhas, ordem)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(produtoId, g.nome || 'Complementos', n.tipo, n.obrigatorio ? 1 : 0, n.maxEscolhas, ordem);
      return Number(info.lastInsertRowid);
    },

    criarOpcao: async (grupoId, o, ordem) => {
      await db.prepare(
        `INSERT INTO opcoes_itens (grupo_id, nome, preco_adicional_centavos, disponivel, ordem)
         VALUES (?, ?, ?, ?, ?)`
      ).run(grupoId, o.nome, o.precoCentavos, o.disponivel ? 1 : 0, ordem);
    },

    registrar: registrar ?? ((nivel, msg) => { if (nivel === 'erro') console.error(msg); else console.log(msg); }),
  };
}

/**
 * O cardápio da loja no formato que o plano de sincronização compara.
 *
 * Traz grupos e opções junto porque o plano precisa saber o que JÁ existe para
 * não duplicar complemento — e um complemento duplicado é o cliente vendo
 * "Bacon" duas vezes na mesma lista.
 */
export async function lerProdutosDaLoja(lojaId: number): Promise<ProdutoNosso[]> {
  const produtos = await db.prepare(
    `SELECT id, nome, descricao, codigo_barras, preco_centavos, disponivel
       FROM produtos WHERE loja_id = ? AND excluido = 0`
  ).all(lojaId) as Array<{
    id: number; nome: string; descricao: string | null;
    codigo_barras: string | null; preco_centavos: number; disponivel: number;
  }>;
  if (produtos.length === 0) return [];

  const ids = produtos.map(p => p.id);
  const marcas = ids.map(() => '?').join(',');
  const grupos = await db.prepare(
    `SELECT id, produto_id, nome FROM grupos_opcoes WHERE produto_id IN (${marcas})`
  ).all(...ids) as Array<{ id: number; produto_id: number; nome: string }>;

  const opcoesPorGrupo = new Map<number, Array<{ id: number; nome: string }>>();
  if (grupos.length > 0) {
    const marcasG = grupos.map(() => '?').join(',');
    for (const o of await db.prepare(
      `SELECT id, grupo_id, nome FROM opcoes_itens WHERE grupo_id IN (${marcasG})`
    ).all(...grupos.map(g => g.id)) as Array<{ id: number; grupo_id: number; nome: string }>) {
      const lista = opcoesPorGrupo.get(o.grupo_id) ?? [];
      lista.push({ id: o.id, nome: o.nome });
      opcoesPorGrupo.set(o.grupo_id, lista);
    }
  }

  const gruposPorProduto = new Map<number, ProdutoNosso['grupos']>();
  for (const g of grupos) {
    const lista = gruposPorProduto.get(g.produto_id) ?? [];
    lista.push({ id: g.id, nome: g.nome, opcoes: opcoesPorGrupo.get(g.id) ?? [] });
    gruposPorProduto.set(g.produto_id, lista);
  }

  return produtos.map(p => ({
    id: p.id,
    nome: p.nome,
    descricao: p.descricao ?? '',
    codigoBarras: p.codigo_barras ?? '',
    precoCentavos: p.preco_centavos,
    disponivel: p.disponivel === 1,
    grupos: gruposPorProduto.get(p.id) ?? [],
  }));
}

/**
 * As dependências da sincronização: as da importação MAIS a atualização.
 *
 * `atualizarProduto` monta o UPDATE só com os campos recebidos, e recebe apenas
 * nome, descrição e disponibilidade. Não há como passar preço por aqui — a
 * assinatura é a guarda.
 */
export function depsSincronizacaoIfood(
  registrar?: (nivel: 'info' | 'erro', msg: string) => void,
): DepsSincronizar {
  return {
    ...depsImportacaoIfood(registrar),
    atualizarProduto: async (produtoId, campos) => {
      const pedacos: string[] = [];
      const valores: unknown[] = [];
      if (campos.nome !== undefined) { pedacos.push('nome = ?'); valores.push(campos.nome); }
      if (campos.descricao !== undefined) { pedacos.push('descricao = ?'); valores.push(campos.descricao); }
      if (campos.disponivel !== undefined) { pedacos.push('disponivel = ?'); valores.push(campos.disponivel ? 1 : 0); }
      if (pedacos.length === 0) return;
      await db.prepare(`UPDATE produtos SET ${pedacos.join(', ')} WHERE id = ?`).run(...valores, produtoId);
    },
  };
}
