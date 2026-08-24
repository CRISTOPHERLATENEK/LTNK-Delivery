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
 * A FASE 1 NÃO PODE MUDAR COMPORTAMENTO.
 *
 * É o que a torna aplicável e reversível: ela cria e preenche, e ninguém lê. Se
 * alguma rota começar a ler `produto_grupos` sem que este teste mude, a fase 1
 * deixou de ser o ponto de volta seguro que o escopo prometeu — e a revisão
 * passa a precisar de outro tipo de cuidado.
 */
describe('nada lê produto_grupos ainda (fase 1)', () => {
  function arquivos(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : arquivos(p);
      return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
    });
  }

  it('só schema-mysql.ts menciona a tabela', () => {
    const raiz = path.resolve(__dirname);
    const citam = arquivos(raiz)
      .filter(a => fs.readFileSync(a, 'utf8').includes('produto_grupos'))
      .map(a => path.basename(a));
    expect(citam).toEqual(['schema-mysql.ts']);
  });
});
