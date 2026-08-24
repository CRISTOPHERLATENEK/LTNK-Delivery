/**
 * COMO SE LÊ UM GRUPO DE COMPLEMENTO DEPOIS DA FASE 2.
 *
 * O grupo virou entidade da LOJA e o vínculo com o produto virou linha em
 * `produto_grupos`. Isso parte a leitura em duas fontes, e três consultas
 * diferentes precisam juntar as duas do mesmo jeito:
 *
 *   - o menu público (`rotas/publico.ts`) — o que o cliente vê;
 *   - a validação do pedido (`rotas/cliente.ts`) — o que o cliente PAGA;
 *   - o editor do lojista (`rotas/lojista.ts`) — o que ele configura.
 *
 * POR QUE ISTO É UM MÓDULO E NÃO TRÊS CÓPIAS. Já aconteceu exatamente uma vez
 * nesta parte do código: a consulta do menu listava colunas à mão e ficou sem
 * `papel`, `modo_preco` e `sabores`. A pizza parou de funcionar no app SEM DAR
 * ERRO NENHUM — o cardápio abria, o item abria, e o mecanismo simplesmente não
 * existia. Agora são duas tabelas em vez de uma, e a chance de uma cópia
 * divergir dobrou.
 *
 * A REGRA, EM UMA FRASE: `ordem`, `obrigatorio` e `max_escolhas` vêm da
 * LIGAÇÃO; todo o resto vem do grupo.
 *
 * As mesmas colunas continuam existindo em `grupos_opcoes` — são o PADRÃO que
 * uma ligação nova herda. Ler dali é ler o padrão em vez do valor, e é um erro
 * que não dá sintoma até alguém mudar a regra de um produto só.
 */

/**
 * Colunas do grupo, com os três campos da ligação sobrescrevendo os do grupo.
 *
 * A ORDEM DOS APELIDOS IMPORTA: `pg.obrigatorio` vem DEPOIS de qualquer coluna
 * homônima, então é o valor da ligação que chega ao objeto. Escrever `g.*` aqui
 * inverteria isso em silêncio — e o silêncio é o problema: um grupo obrigatório
 * num produto e opcional em outro passaria a ler o padrão do grupo nos dois.
 */
export const COLUNAS_GRUPO = `g.id, g.nome, g.tipo, g.papel, g.modo_preco, g.loja_id,
       pg.produto_id, pg.ordem, pg.obrigatorio, pg.max_escolhas`;

/** O JOIN que liga grupo e produto. Sempre `pg` como apelido da ligação. */
export const JOIN_GRUPOS = 'grupos_opcoes g JOIN produto_grupos pg ON pg.grupo_id = g.id';

/**
 * Os grupos de UM produto, na ordem em que o cliente monta o pedido.
 *
 * `ORDER BY pg.ordem, g.id`: o desempate por id é o que estava aqui antes e
 * precisa continuar — na base real existe produto com dois grupos na mesma
 * `ordem`, e sem o desempate a ordem deles mudaria de uma consulta pra outra.
 */
export const SQL_GRUPOS_DO_PRODUTO =
  `SELECT ${COLUNAS_GRUPO} FROM ${JOIN_GRUPOS}
    WHERE pg.produto_id = ? ORDER BY pg.ordem, g.id`;

/**
 * A MESMA COISA, MAIS "EM QUANTOS PRODUTOS ESTE GRUPO ESTÁ".
 *
 * Só o painel do lojista usa. `usos` é o número que decide o texto de toda ação
 * destrutiva na tela — apertar a lixeira num grupo usado por 30 pizzas não pode
 * significar a mesma coisa que num grupo usado por uma — e é o que acende o selo
 * "em N produtos".
 *
 * Fica SEPARADO do fragmento do menu de propósito: é uma subconsulta por grupo, e
 * o menu público carrega o cardápio inteiro a cada visita de cliente. Pagar isso
 * no caminho quente pra mostrar um número que só o lojista vê seria trocar
 * desempenho de todo mundo por conveniência de um.
 */
export const SQL_GRUPOS_DO_PRODUTO_COM_USOS =
  `SELECT ${COLUNAS_GRUPO},
          (SELECT COUNT(*) FROM produto_grupos x WHERE x.grupo_id = g.id) AS usos
     FROM ${JOIN_GRUPOS}
    WHERE pg.produto_id = ? ORDER BY pg.ordem, g.id`;

/** Idem, para vários produtos de uma vez (o menu inteiro numa consulta). */
export function sqlGruposDeProdutos(quantos: number): string {
  const marcas = Array.from({ length: quantos }, () => '?').join(',');
  return `SELECT ${COLUNAS_GRUPO} FROM ${JOIN_GRUPOS}
           WHERE pg.produto_id IN (${marcas}) ORDER BY pg.ordem, g.id`;
}
