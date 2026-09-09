/**
 * ITENS DO IFOOD QUE NÃO BAIXARAM ESTOQUE.
 *
 * Pedido do iFood com item que não casa com nenhum produto nosso entra no
 * sistema com `itens_pedido.produto_id = NULL` — de propósito: o cliente já
 * pagou lá, e recusar o pedido por problema de cadastro transformaria isso num
 * pedido perdido. O nome vem do iFood, então cozinha e cupom saem certos.
 *
 * O QUE SE PERDE é a baixa de estoque desse item. E o jeito como isso era
 * "registrado" é o problema real: uma linha no log de erro. Ninguém lê log, e
 * o estoque vai divergindo do físico em silêncio até alguém contar prateleira.
 *
 * Esta consulta transforma isso em lista acionável. Não precisa de tabela nova
 * — o dado já está no banco, só nunca foi perguntado:
 *
 *   itens de pedido do iFood, sem produto, agrupados pelo código que veio de lá.
 *
 * E o CÓDIGO é o que fecha o ciclo: o `externalCode` do iFood casa com
 * `produtos.codigo_barras`. Com o código na mão, o lojista cola no produto e o
 * próximo pedido baixa estoque. Sem ele, a lista diria "algo não bateu" e não
 * daria o que fazer.
 */
import db from './db-mysql';

export interface ItemSemProduto {
  /** Nome como o iFood mandou. */
  nome: string;
  /** `externalCode` do iFood — o que colar no `codigo_barras` do produto. */
  codigo: string;
  /** Quantas vezes já chegou assim. */
  vezes: number;
  /** Soma das quantidades — o tamanho da divergência de estoque. */
  unidades: number;
  /** Quando foi a última. */
  ultimoEm: string;
}

/** Quanto tempo para trás olhar. 90 dias cobre a sazonalidade de cardápio. */
const DIAS = 90;

export async function itensSemProduto(lojaId: number, agora = Date.now()): Promise<ItemSemProduto[]> {
  const corte = new Date(agora - DIAS * 86_400_000).toISOString();

  const linhas = await db.prepare(
    `SELECT ip.nome_produto            AS nome,
            ip.codigo_externo          AS codigo,
            COUNT(*)                   AS vezes,
            SUM(ip.quantidade)         AS unidades,
            MAX(p.criado_em)           AS ultimoEm
       FROM itens_pedido ip
       JOIN pedidos p ON p.id = ip.pedido_id
      WHERE p.loja_id = ?
        AND p.origem = 'ifood'
        AND ip.produto_id IS NULL
        AND p.criado_em >= ?
      GROUP BY ip.nome_produto, ip.codigo_externo
      ORDER BY unidades DESC, vezes DESC`
  ).all(lojaId, corte) as Array<{
    nome: string; codigo: string | null; vezes: number; unidades: number; ultimoEm: string;
  }>;

  return linhas.map(l => ({
    nome: l.nome,
    codigo: l.codigo || '',
    vezes: Number(l.vezes),
    unidades: Number(l.unidades),
    ultimoEm: l.ultimoEm,
  }));
}

/**
 * A frase que a tela mostra para um item.
 *
 * Separada da consulta para poder ser testada sem banco — e porque o texto é
 * a parte que decide se alguém age. "1 item sem produto" não faz ninguém
 * levantar; "12 unidades não baixaram do estoque" faz.
 */
export function descrever(item: ItemSemProduto): string {
  const u = item.unidades === 1 ? '1 unidade' : `${item.unidades} unidades`;
  const v = item.vezes === 1 ? '1 pedido' : `${item.vezes} pedidos`;
  return `${u} em ${v} — sem baixa de estoque`;
}

/**
 * O que fazer, em uma frase, para ESTE item.
 *
 * COM CÓDIGO é direto: cola no `codigo_barras` do produto e o próximo pedido
 * baixa estoque.
 *
 * SEM CÓDIGO a mensagem não pode afirmar POR QUE está sem. Eu escrevi
 * primeiro "este item chegou do iFood sem código" — e ao rodar em produção os
 * dois itens existentes apareceram sem código porque são de ANTES da coluna
 * existir, não porque o iFood não mandou. A frase mandaria a pessoa consertar
 * o cardápio do iFood, que talvez já esteja certo.
 *
 * Então diz o que se sabe ("não temos o código registrado") e dá o caminho que
 * funciona nos dois casos: conferir o código no cardápio de lá e cadastrar o
 * mesmo aqui.
 */
export function comoResolver(item: ItemSemProduto): string {
  return item.codigo
    ? `Cadastre o código ${item.codigo} no campo "código de barras" do produto correspondente.`
    : 'Não temos o código deste item registrado. Veja o "código externo" dele no cardápio do iFood e cadastre o mesmo no campo "código de barras" do produto aqui.';
}
