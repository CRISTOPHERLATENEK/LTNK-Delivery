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
