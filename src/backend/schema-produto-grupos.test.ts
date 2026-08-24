/**
 * A FASE 1 DO REAPROVEITAMENTO DE GRUPOS, travada no código-fonte.
 *
 * Migração não tem teste de comportamento: ou você sobe um MySQL no teste, ou
 * confia. Mas as quatro decisões desta fase são LEGÍVEIS no arquivo, e cada uma
 * delas, desfeita, causa um estrago diferente e silencioso:
 *
 *  - sem o UNIQUE, "Borda" aparece duas vezes no cardápio do cliente;
 *  - sem `INSERT IGNORE`, uma das três instâncias do PM2 aborta a migração;
 *  - com mesclagem no backfill, preço de cardápio muda sozinho no boot;
 *  - sem a guarda do `IS_NULLABLE`, todo reinício reconstrói a tabela.
 *
 * Então o teste lê o arquivo. É burro de propósito — e é o mesmo padrão que já
 * pegou a regra de preço copiada (`preco-produto.test.ts`) e as colunas que
 * faltavam na consulta do menu (`opcoes-preco.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const fonte = fs.readFileSync(path.resolve(__dirname, 'schema-mysql.ts'), 'utf8');

describe('produto_grupos — a tabela de ligação', () => {
  it('existe, e como CREATE TABLE IF NOT EXISTS', () => {
    expect(fonte).toContain('CREATE TABLE IF NOT EXISTS produto_grupos');
  });

  /*
   * O UNIQUE É REGRA, NÃO OTIMIZAÇÃO. Sem ele, dois cliques em "usar este grupo"
   * ligam o mesmo grupo duas vezes e o cliente vê "Borda" duas vezes no
   * cardápio, com dois limites independentes. E é ele que faz o `INSERT IGNORE`
   * do backfill ser idempotente na corrida do PM2.
   */
  it('tem UNIQUE (produto_id, grupo_id)', () => {
    expect(fonte).toMatch(/UNIQUE KEY uq_produto_grupo \(produto_id, grupo_id\)/);
  });

  /*
   * `ordem`, `obrigatorio` e `max_escolhas` moram na LIGAÇÃO porque a resposta
   * muda por produto: reordenar os grupos da Pizza A não pode reordenar a Pizza
   * B, e borda é obrigatória na pizza e opcional na esfiha.
   */
  it('guarda o que é do par produto↔grupo, não do grupo', () => {
    const ddl = fonte.slice(fonte.indexOf('CREATE TABLE IF NOT EXISTS produto_grupos'));
    const corpo = ddl.slice(0, ddl.indexOf(')'));
    for (const coluna of ['produto_id', 'grupo_id', 'ordem', 'obrigatorio', 'max_escolhas']) {
      expect(corpo).toContain(coluna);
    }
  });

  it('tem índice pelo grupo — "quem usa este grupo?" é a pergunta da fase 3', () => {
    expect(fonte).toContain('KEY idx_pg_grupo (grupo_id)');
  });
});

describe('o backfill da fase 1', () => {
  /* Roda nas três instâncias do PM2 ao mesmo tempo. Sem IGNORE, a segunda
     estoura no UNIQUE e aborta a migração daquele tenant no meio. */
  it('insere com IGNORE', () => {
    expect(fonte).toMatch(/INSERT IGNORE INTO produto_grupos/);
  });

  /*
   * ESTE É O TESTE QUE IMPORTA.
   *
   * O backfill NÃO PODE MESCLAR grupos de nome igual. Os 5 "Tamanho" da base
   * real não são o mesmo grupo: um tem `Gigante` com `sabores = 4`, e os outros
   * podem ter itens e preços diferentes. Mesclar por nome mudaria preço de
   * cardápio e limite de sabores de produtos que ninguém pediu pra mexer — em
   * silêncio, no boot, em todos os tenants de uma vez.
   *
   * A migração é 1:1: cada grupo existente vira um grupo com UMA ligação. A
   * consolidação é ferramenta que o lojista aciona, comparando item a item.
   */
  it('é 1:1 — não agrupa nem casa por nome', () => {
    const i = fonte.indexOf('INSERT IGNORE INTO produto_grupos');
    const trecho = fonte.slice(i, fonte.indexOf(';', i));
    expect(trecho).toMatch(/FROM grupos_opcoes/);
    expect(trecho).not.toMatch(/GROUP BY/i);
    expect(trecho).not.toMatch(/\bnome\b/);
    expect(trecho).not.toMatch(/DISTINCT/i);
  });

  it('ignora grupo já sem produto (o da biblioteca, na fase 3)', () => {
    const i = fonte.indexOf('INSERT IGNORE INTO produto_grupos');
    expect(fonte.slice(i, fonte.indexOf(';', i))).toMatch(/produto_id IS NOT NULL/);
  });

  /* Preencher `loja_id` é o que evita grupo órfão sem dono quando `produto_id`
     ficar vazio — é autorização, não enfeite. */
  it('preenche loja_id a partir do produto, só onde falta', () => {
    expect(fonte).toMatch(/UPDATE grupos_opcoes g JOIN produtos p/);
    expect(fonte).toMatch(/WHERE g\.loja_id IS NULL/);
  });
});

describe('as guardas de custo no boot', () => {
  /*
   * `MODIFY COLUMN` reescreve a tabela em várias versões do MySQL, e isto roda
   * no boot de TODA instância de TODO tenant. Sem a checagem de `IS_NULLABLE`,
   * cada reinício do PM2 (três instâncias) reconstruiria `grupos_opcoes` três
   * vezes, sem nenhum efeito.
   */
  it('só faz MODIFY em produto_id se ele ainda for NOT NULL', () => {
    const i = fonte.indexOf('ALTER TABLE grupos_opcoes MODIFY produto_id INT NULL');
    expect(i).toBeGreaterThan(-1);
    const antes = fonte.slice(Math.max(0, i - 700), i);
    expect(antes).toMatch(/IS_NULLABLE/);
    expect(antes).toMatch(/=== 'NO'/);
  });

  /* Mesma ideia: sem a checagem, todo boot varre `grupos_opcoes` inteira pra
     reinserir nada. Com ela, o custo em regime é uma linha lida. */
  it('só roda o backfill se houver grupo sem ligação', () => {
    const i = fonte.indexOf('INSERT IGNORE INTO produto_grupos');
    const antes = fonte.slice(Math.max(0, i - 900), i);
    expect(antes).toMatch(/LEFT JOIN produto_grupos/);
    expect(antes).toMatch(/LIMIT 1/);
  });
});

/**
 * A FASE 2 LIGOU A TABELA NOS TRÊS CAMINHOS QUE IMPORTAM.
 *
 * Na fase 1 este bloco verificava o contrário: que NADA lia `produto_grupos`. Era
 * o que fazia dela um ponto de volta seguro. Agora o invariante virou: os três
 * lugares que leem grupo têm que ler pela ligação, e nenhum deles pode voltar a
 * consultar `grupos_opcoes` sozinha.
 *
 * Por que isso merece teste em vez de confiança: uma consulta que esquece o JOIN
 * não dá erro. Ela devolve os grupos com `obrigatorio` e `max_escolhas` do
 * PADRÃO do grupo em vez do valor da ligação — e no dia da fase 2, com uma
 * ligação por grupo, os dois são iguais. O defeito ficaria dormindo até o
 * primeiro grupo compartilhado, e apareceria como "a borda virou opcional na
 * pizza sozinha".
 */
describe('fase 2 — quem lê grupo lê pela ligação', () => {
  const arquivo = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

  it('o fragmento compartilhado faz o JOIN', () => {
    const sql = arquivo('grupos-sql.ts');
    expect(sql).toMatch(/JOIN produto_grupos pg ON pg\.grupo_id = g\.id/);
    expect(sql).toMatch(/WHERE pg\.produto_id = \?/);
  });

  /*
   * O caminho do DINHEIRO. É esta consulta que decide se o pedido é aceito e
   * quanto custa; se ela divergir da do menu, o cliente vê um preço e paga
   * outro.
   */
  it('a validação do pedido usa o mesmo fragmento do menu', () => {
    const cliente = arquivo('rotas/cliente.ts');
    expect(cliente).toMatch(/SQL_GRUPOS_DO_PRODUTO/);
    expect(cliente).not.toMatch(/FROM grupos_opcoes WHERE produto_id/);
  });

  it('o menu público usa o fragmento', () => {
    expect(arquivo('rotas/publico.ts')).toMatch(/sqlGruposDeProdutos/);
  });

  it('o editor do lojista usa o fragmento', () => {
    expect(arquivo('rotas/lojista.ts')).toMatch(/SQL_GRUPOS_DO_PRODUTO/);
  });

  /*
   * NENHUMA rota volta a ler grupo por `produto_id`. É a assinatura exata da
   * consulta que ignora a ligação.
   */
  it('nenhuma rota lê grupo por produto_id', () => {
    for (const rel of ['rotas/cliente.ts', 'rotas/publico.ts', 'rotas/lojista.ts']) {
      expect(arquivo(rel)).not.toMatch(/FROM grupos_opcoes\s+WHERE produto_id/);
    }
  });

  /*
   * CRIAR GRUPO SEM LIGAÇÃO É CRIAR GRUPO INVISÍVEL: depois da fase 2 toda
   * leitura passa pela ligação, então o grupo existiria no banco e em lugar
   * nenhum na tela. Vale pro POST da rota e pro seed.
   */
  it('quem cria grupo também cria a ligação', () => {
    for (const rel of ['rotas/lojista.ts', 'seed.ts']) {
      expect(arquivo(rel)).toMatch(/INSERT INTO produto_grupos/);
    }
  });

  /* A FK recusa apagar o grupo com ligação pendurada — a ligação sai antes. */
  it('quem apaga grupo apaga a ligação primeiro', () => {
    const lojista = arquivo('rotas/lojista.ts');
    const i = lojista.indexOf("DELETE FROM produto_grupos WHERE grupo_id = ?");
    const j = lojista.indexOf("DELETE FROM grupos_opcoes WHERE id = ?");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
  });

  /*
   * Excluir loja tem que levar o grupo pelo `loja_id` DELE, não pelos produtos:
   * pelo caminho antigo, grupo sem produto ligado — estado normal depois da fase
   * 3 — ficaria órfão apontando pra uma loja que não existe mais.
   */
  it('excluir loja apaga grupo por loja_id', () => {
    const admin = arquivo('rotas/admin.ts');
    expect(admin).toMatch(/DELETE FROM grupos_opcoes WHERE loja_id = \?/);
    expect(admin).not.toMatch(/DELETE FROM grupos_opcoes WHERE produto_id IN/);
  });
});
