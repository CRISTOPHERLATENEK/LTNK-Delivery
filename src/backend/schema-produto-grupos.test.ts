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

/**
 * O arquivo SEM OS COMENTÁRIOS — é isto que as varreduras devem ler.
 *
 * Toda regra aqui é do tipo "esta forma não pode aparecer no código", e a forma
 * proibida aparece, necessariamente, no comentário que explica por que ela é
 * proibida. Lendo o arquivo inteiro, o teste reprova exatamente o commit que
 * documenta a correção — foi o que aconteceu: o comentário de `cliente.ts` cita
 * `FROM grupos_opcoes WHERE produto_id` pra contar que a varredura antiga não
 * pegava o caso, e virou o motivo da varredura falhar.
 *
 * Mesma lição do scanner de SQL, que pulava `prepare()` por causa de uma crase
 * dentro de um comentário. Comentário é prosa; varredura tem que olhar código.
 */
function codigo(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // bloco
    .replace(/^\s*\/\/.*$/gm, ' ');        // linha
}

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
  /* Comentário não conta: ver `codigo` lá em cima. */
  const arquivo = codigo;

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

/**
 * A JANELA ENTRE AS DUAS FASES.
 *
 * A fase 1 copiou `obrigatorio`/`max_escolhas`/`ordem` do grupo pra ligação, e
 * até a fase 2 subir o PUT continuou gravando só no grupo. Toda edição feita
 * nessa janela deixou a ligação parada — e aconteceu em menos de uma hora: o
 * grupo "Tamanho" da pizza ficou com 3 no grupo e 1 na ligação, e no instante em
 * que a fase 2 passou a ler pela ligação o limite voltou pra 1 sem ninguém pedir.
 *
 * A reconciliação fecha isso UMA VEZ. As duas condições abaixo são o que separa
 * "corrige a janela" de "apaga a configuração de todo mundo a cada reinício".
 */
describe('reconciliação da janela entre as fases', () => {
  const i = fonte.indexOf('UPDATE produto_grupos pg JOIN grupos_opcoes g');

  it('existe', () => {
    expect(i).toBeGreaterThan(-1);
  });

  /*
   * SÓ AS LIGAÇÕES QUE O BACKFILL CRIOU. `g.produto_id = pg.produto_id` é a
   * assinatura delas. Sem essa condição, uma ligação criada à mão pra um segundo
   * produto (fase 3) seria sobrescrita com o padrão do grupo — apagando a regra
   * específica daquele produto, que é exatamente o que a ligação existe pra
   * guardar.
   */
  it('só toca a ligação que veio daquele grupo', () => {
    expect(fonte.slice(i, fonte.indexOf(';', i))).toMatch(/g\.produto_id = pg\.produto_id/);
  });

  /*
   * RODA UMA VEZ POR TENANT. Depois da fase 2 a ligação é a autoridade, e
   * divergir do grupo é o comportamento CORRETO — borda obrigatória na pizza e
   * opcional na esfiha. Sem o marcador, cada reinício do PM2 sobrescreveria a
   * regra de cada produto com o padrão do grupo, e o lojista veria a
   * configuração voltar sozinha depois de todo deploy.
   */
  it('é one-shot, com marcador em configuracoes', () => {
    const antes = fonte.slice(Math.max(0, i - 900), i);
    expect(antes).toMatch(/mig_ligacao_reconciliada/);
    expect(antes).toMatch(/feito\.length === 0/);
    expect(fonte).toMatch(/INSERT IGNORE INTO configuracoes \(chave, valor\) VALUES \('mig_ligacao_reconciliada'/);
  });
});

/**
 * FASE 3 — O REAPROVEITAMENTO EXISTINDO DE VERDADE.
 *
 * As quatro rotas novas (biblioteca, ligar, desligar, soltar) e a mudança na
 * duplicação. Os testes olham o fonte pelo mesmo motivo dos anteriores: o que
 * quebra aqui não dá erro, dá dado errado — e o dado errado é o cardápio de
 * trinta pizzas.
 */
describe('fase 3 — ligar, desligar, soltar', () => {
  const lojista = fs.readFileSync(path.resolve(__dirname, 'rotas', 'lojista.ts'), 'utf8');

  it('as quatro rotas existem', () => {
    expect(lojista).toMatch(/router\.get\('\/grupos',/);
    expect(lojista).toMatch(/router\.get\('\/grupos\/:id\/produtos',/);
    expect(lojista).toMatch(/router\.post\('\/produtos\/:id\/grupos\/:grupoId',/);
    expect(lojista).toMatch(/router\.delete\('\/produtos\/:id\/grupos\/:grupoId',/);
    expect(lojista).toMatch(/router\.post\('\/produtos\/:id\/grupos\/:grupoId\/soltar',/);
  });

  /*
   * DESLIGAR NÃO É EXCLUIR — o defeito mais fácil de cometer em toda a fase 3.
   * Com o grupo compartilhado, apagar o grupo ao tirá-lo de UMA pizza apagaria a
   * borda de trinta. A rota só apaga quando não sobra vínculo nenhum.
   */
  it('tirar de um produto só apaga o grupo se for o último vínculo', () => {
    const i = lojista.indexOf("router.delete('/produtos/:id/grupos/:grupoId'");
    const rota = lojista.slice(i, lojista.indexOf('router.', i + 10));
    expect(rota).toMatch(/DELETE FROM produto_grupos WHERE produto_id = \? AND grupo_id = \?/);
    // O DELETE do grupo tem que estar DENTRO da condição de "não sobrou nenhum".
    const guarda = rota.indexOf('restantes.length === 0');
    const apagaGrupo = rota.indexOf('DELETE FROM grupos_opcoes');
    expect(guarda).toBeGreaterThan(-1);
    expect(apagaGrupo).toBeGreaterThan(guarda);
  });

  /*
   * SEM "SOLTAR", COMPARTILHAR É ARMADILHA: na primeira vez que o lojista quiser
   * a borda de UMA pizza diferente das outras 29, editar mexeria nas 30 e tirar
   * daqui perderia a configuração. O clone tem que levar TODOS os campos do item
   * — faltar um é o clone parecer igual na lista e vir quebrado por dentro, que
   * foi o que aconteceu duas vezes na duplicação de produto.
   */
  it('soltar clona o grupo com todos os campos do item', () => {
    const i = lojista.indexOf("/grupos/:grupoId/soltar");
    const rota = lojista.slice(i, lojista.indexOf("router.post('/grupos/:id/opcoes'", i));
    /*
     * OLHA OS ARGUMENTOS, NÃO A LISTA DE COLUNAS.
     *
     * A primeira versão deste teste conferia se a rota "continha" a palavra
     * `imagem` — e continha, no nome da coluna. Trocar `o.imagem || ''` por `''`
     * passava: a contagem de `?` seguia certa (o scanner de SQL não vê nada
     * errado) e o clone perdia a foto de todos os sabores em silêncio. É a mesma
     * classe de defeito que já quebrou a duplicação de produto duas vezes.
     */
    const argsClone = rota.slice(rota.indexOf('INSERT INTO opcoes_itens'));
    const run = argsClone.slice(argsClone.indexOf(').run('), argsClone.indexOf(');', argsClone.indexOf(').run(')));
    for (const campo of ['nome', 'preco_adicional_centavos', 'disponivel', 'ordem', 'sabores', 'secao', 'descricao', 'imagem']) {
      expect(run).toContain(`o.${campo}`);
    }
    /* E o vínculo DESTE produto passa a apontar pro clone — sem isso o clone
       nasce órfão e o produto continua no grupo compartilhado. */
    expect(rota).toMatch(/UPDATE produto_grupos SET grupo_id = \? WHERE produto_id = \? AND grupo_id = \?/);
  });

  /*
   * DUPLICAR PASSA A LIGAR. É o coração do recurso: as 30 pizzas de uma pizzaria
   * nascem de duplicação, e copiando os grupos cada uma ganhava a SUA borda — a
   * dor inteira recriada a cada clique.
   */
  it('duplicar produto liga os mesmos grupos, não copia', () => {
    const i = lojista.indexOf("router.post('/produtos/:id/duplicar'");
    const rota = lojista.slice(i, lojista.indexOf("router.post('/produtos/bulk'", i));
    expect(rota).toMatch(/INSERT INTO produto_grupos/);
    /* Se voltar a copiar, estas duas reaparecem — e o teste diz onde. */
    expect(rota).not.toMatch(/INSERT INTO grupos_opcoes/);
    expect(rota).not.toMatch(/INSERT INTO opcoes_itens/);
  });

  /*
   * O DUPLO CLIQUE EM "usar este grupo" não pode virar 500 nem grupo repetido no
   * cardápio. O UNIQUE barra, e a rota traduz o erro do banco em mensagem.
   */
  it('ligar duas vezes devolve 409, não erro de banco', () => {
    const i = lojista.indexOf("router.post('/produtos/:id/grupos/:grupoId',");
    const rota = lojista.slice(i, lojista.indexOf("router.delete('/produtos/:id/grupos/:grupoId'", i));
    expect(rota).toMatch(/ER_DUP_ENTRY/);
    expect(rota).toMatch(/erroHttp\(409/);
  });

  /*
   * `usos` NÃO PODE ENTRAR NO CAMINHO QUENTE. É uma subconsulta por grupo, e o
   * menu público carrega o cardápio inteiro a cada visita de cliente — pagar isso
   * pra mostrar um número que só o lojista vê é trocar desempenho de todo mundo
   * por conveniência de um.
   */
  it('a contagem de usos só existe na consulta do painel', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, 'grupos-sql.ts'), 'utf8');
    const comUsos = sql.indexOf('SQL_GRUPOS_DO_PRODUTO_COM_USOS');
    expect(comUsos).toBeGreaterThan(-1);
    /* O fragmento base e o de vários produtos (o do menu) não contam usos. */
    const base = sql.slice(sql.indexOf('export const SQL_GRUPOS_DO_PRODUTO ='), comUsos);
    expect(base).not.toMatch(/AS usos/);
    expect(sql.slice(sql.indexOf('sqlGruposDeProdutos'))).not.toMatch(/AS usos/);
    expect(fs.readFileSync(path.resolve(__dirname, 'rotas', 'publico.ts'), 'utf8'))
      .not.toMatch(/COM_USOS/);
  });
});

/**
 * PRODUTO EXCLUÍDO NÃO CONTA COMO USO.
 *
 * `produtos.excluido` é apagar SUAVE: a linha fica, e com ela o vínculo com o
 * grupo. Contar esses vínculos quebrava as três coisas que `usos` governa — o
 * selo ("em 2 produtos" com só uma pizza viva), o aviso ("mudar aqui muda em
 * todos" sem haver outros) e, o pior, o "tirar deste produto", que não apagava o
 * grupo por achar que sobrava vínculo. O grupo virava órfão: nenhum produto vivo
 * o usa, nenhuma tela alcança, e sem a biblioteca (fase 4) não há como remover.
 *
 * Não é hipótese: das 13 ligações da base real, SETE apontam pra produto
 * excluído — antes de qualquer lojista tocar no recurso.
 */
describe('uso conta só produto vivo', () => {
  const lojista = fs.readFileSync(path.resolve(__dirname, 'rotas', 'lojista.ts'), 'utf8');
  const sql = fs.readFileSync(path.resolve(__dirname, 'grupos-sql.ts'), 'utf8');

  /* É esta lista que decide se "tirar daqui" apaga o grupo ou só corta o
     vínculo — o lugar onde contar errado deixa lixo invisível. */
  it('produtosDoGrupo ignora excluído', () => {
    const i = lojista.indexOf('async function produtosDoGrupo');
    const fn = lojista.slice(i, lojista.indexOf('\n}', i));
    expect(fn).toMatch(/JOIN produtos p ON p\.id = pg\.produto_id/);
    expect(fn).toMatch(/p\.excluido = 0/);
  });

  it('a contagem do painel ignora excluído', () => {
    const i = sql.indexOf('SQL_GRUPOS_DO_PRODUTO_COM_USOS');
    expect(sql.slice(i, sql.indexOf('`;', i))).toMatch(/px\.excluido = 0/);
  });

  /* Ancorado na ROTA e não na primeira ocorrência de "AS usos": a primeira
     versão deste teste caiu numa consulta de sugestões que fica antes no
     arquivo, e reprovou a forma correta por estar olhando o lugar errado. */
  it('a contagem da biblioteca ignora excluído', () => {
    const i = lojista.indexOf("router.get('/grupos',");
    const rota = lojista.slice(i, lojista.indexOf("router.get('/grupos/:id/produtos'", i));
    expect(rota).toMatch(/AS usos/);
    expect(rota).toMatch(/p2\.excluido = 0/);
  });

  /*
   * E quando o grupo é apagado de verdade, as ligações que SOBRAM (as de produto
   * excluído, que `restantes` não conta) têm que sair antes: a FK recusa apagar
   * o grupo com vínculo pendurado, e o DELETE inteiro estouraria num erro que
   * não diz nada.
   */
  it('apagar o grupo limpa as ligações de produto excluído', () => {
    const i = lojista.indexOf("router.delete('/produtos/:id/grupos/:grupoId'");
    const rota = lojista.slice(i, lojista.indexOf('router.', i + 10));
    const limpaTodas = rota.indexOf("DELETE FROM produto_grupos WHERE grupo_id = ?");
    const apagaGrupo = rota.indexOf('DELETE FROM grupos_opcoes');
    expect(limpaTodas).toBeGreaterThan(-1);
    expect(limpaTodas).toBeLessThan(apagaGrupo);
  });
});

/**
 * `g.produto_id` NÃO PODE MAIS DECIDIR NADA.
 *
 * A coluna continua existindo (é o produto pra qual o grupo foi CRIADO), mas
 * depois da fase 3 ela não diz mais em quais produtos o grupo está — a ligação
 * diz. Usá-la pra filtrar dá o defeito mais traiçoeiro desta migração: consulta
 * que não acha nada, e código que trata "não achou" como "não tem".
 *
 * Aconteceu duas vezes, e nenhuma foi pega pela varredura antiga
 * (`FROM grupos_opcoes WHERE produto_id`), porque nos dois casos o filtro estava
 * no JOIN e não no WHERE:
 *
 *  - "pedir de novo" (cliente.ts) conferia `g.produto_id = ?` pra validar a
 *    opção. Com a borda compartilhada por trinta pizzas, repetir o pedido de
 *    qualquer uma das outras 29 descartava TODOS os complementos em silêncio: o
 *    cliente recebia a pizza pelada, no preço base.
 *  - as sugestões de item (lojista.ts) chegavam ao histórico da loja via
 *    `JOIN produtos p ON p.id = g.produto_id`, então grupo de produto excluído
 *    sumia do histórico — justamente o histórico que existe pra não redigitar.
 *
 * Por isso a regra agora é a mais burra possível: `g.produto_id` não aparece nas
 * rotas. Ponto.
 */
describe('nenhuma rota decide por g.produto_id', () => {
  for (const rel of ['rotas/cliente.ts', 'rotas/publico.ts', 'rotas/lojista.ts']) {
    it(rel, () => {
      /*
       * `(?<!p)` porque `g\.produto_id` casa DENTRO de `pg.produto_id` — e
       * `pg.produto_id` é justamente a forma CERTA. Sem o lookbehind, este teste
       * reprovaria toda consulta corrigida, que é o inverso do que ele existe
       * pra fazer. Mesmo tropeço do `g\.obrigatorio` dentro de `pg.obrigatorio`.
       */
      expect(codigo(rel)).not.toMatch(/(?<!p)g\.produto_id/);
    });
  }
});

/**
 * COMBO — FASE 1: schema e cadastro, e NADA MAIS.
 *
 * Um combo é um produto que contém outros produtos, um por slot. Esta fase
 * cadastra isso; o modal do cliente, o preço e o cupom ainda ignoram
 * `combo_itens` por completo — e é o que a torna aplicável sem risco.
 *
 * As regras abaixo, desfeitas, não dão erro. Dão recursão infinita, slot
 * fantasma, ou componente vendido avulso por um preço que só faz sentido dentro
 * do combo.
 */
describe('fase 1 do combo', () => {
  const lojista = fs.readFileSync(path.resolve(__dirname, 'rotas', 'lojista.ts'), 'utf8');
  const publico = fs.readFileSync(path.resolve(__dirname, 'rotas', 'publico.ts'), 'utf8');

  it('a tabela existe, com slot único por combo', () => {
    expect(fonte).toContain('CREATE TABLE IF NOT EXISTS combo_itens');
    /* Sem o UNIQUE, dois cliques em "adicionar" criam dois itens no mesmo slot e
       o cliente veria "Pizza 1 de 3" duas vezes. */
    expect(fonte).toMatch(/UNIQUE KEY uq_combo_slot \(combo_id, slot\)/);
  });

  /*
   * `slot` E NÃO `quantidade`: duas pizzas iguais são dois slots, porque cada
   * uma é configurada separadamente. Uma coluna de quantidade descreveria "duas
   * pizzas idênticas", que é o oposto do recurso.
   */
  it('não tem coluna de quantidade', () => {
    const ddl = fonte.slice(fonte.indexOf('CREATE TABLE IF NOT EXISTS combo_itens'));
    const corpo = ddl.slice(0, ddl.indexOf('SUFIXO_TABELA'));
    expect(corpo).toContain('slot');
    expect(corpo).not.toMatch(/quantidade/);
  });

  /*
   * COMBO DENTRO DE COMBO É RECUSADO NA ROTA, não pela FK.
   *
   * `combo_itens.produto_id` aponta pra `produtos`, e um combo É um produto —
   * o banco aceitaria A conter B conter A. O ciclo não daria erro: daria
   * recursão infinita no dia em que o modal montar a composição.
   */
  it('recusa combo dentro de combo', () => {
    const i = lojista.indexOf("router.post('/produtos/:id/combo'");
    const rota = lojista.slice(i, lojista.indexOf('router.', i + 10));
    expect(rota).toMatch(/COUNT\(\*\) AS n FROM combo_itens WHERE combo_id = \?/);
    /*
     * A CONDIÇÃO, e não só as peças. A primeira versão deste teste conferia que
     * a consulta e o `erroHttp` existiam — e trocar `if (n > 0)` por
     * `if (false)` passava: as duas peças continuavam lá, desligadas. Verificar
     * presença de pedaço não prova que estão ligados.
     */
    expect(rota).toMatch(/if \(n > 0\) throw erroHttp\(400/);
    /* E o produto não pode conter ele mesmo. */
    expect(rota).toMatch(/if \(componente\.id === combo\.id\) throw erroHttp\(400/);
  });

  /*
   * TIRAR UM ITEM RENUMERA OS SLOTS. Sem isso, tirar o slot 1 de três deixa 2 e
   * 3 — e o cliente veria "Pizza 2 de 2" como primeiro passo. Slot é posição,
   * não identidade.
   */
  it('remover renumera os slots', () => {
    const i = lojista.indexOf("router.delete('/produtos/:id/combo/:itemId'");
    const rota = lojista.slice(i, lojista.indexOf('// ----- Grupos', i));
    expect(rota).toMatch(/UPDATE combo_itens SET slot = \? WHERE id = \?/);
  });

  /*
   * `vendido_sozinho` É A ÚNICA COISA DESTA FASE QUE UMA TELA LÊ, e é de
   * propósito: interruptor que não faz nada é pior que interruptor nenhum. O
   * lojista que desmarca "vender avulso" espera o produto sair do cardápio.
   *
   * Os três lugares onde produto aparece pro cliente: cardápio da loja,
   * destaques da plataforma e busca. Faltar em um deles é o componente do combo
   * vazando pra venda avulsa por um preço que só faz sentido dentro do combo.
   */
  it('componente fora do cardápio, dos destaques e da busca', () => {
    /*
     * Conta com o `AND` na frente porque só SQL tem `AND` — o comentário que
     * explica a regra também escreve `vendido_sozinho = 1`, e contar sem a
     * âncora deu 4 onde havia 3 consultas. Terceira vez nesta base que um
     * comentário dispara a própria varredura que ele documenta.
     */
    expect((publico.match(/AND vendido_sozinho = 1/g) || []).length).toBe(1);      // cardápio
    expect((publico.match(/AND p\.vendido_sozinho = 1/g) || []).length).toBe(2);   // destaques + busca
  });

  it('o cadastro grava a coluna na criação e na edição', () => {
    expect(lojista).toMatch(/INSERT INTO produtos[\s\S]{0,400}vendido_sozinho/);
    expect(lojista).toMatch(/UPDATE produtos SET[\s\S]{0,400}vendido_sozinho = \?/);
  });
});

/**
 * A FRAÇÃO TEM QUE SOBREVIVER AO FECHAMENTO DO PEDIDO.
 *
 * Isto trava a correção de um defeito que estava no ar: a validação começava com
 *
 *     const ids = [...new Set(opcoesEscolhidas.map(...))]
 *
 * e o `Set` COLAPSAVA a repetição. O cliente montava "2/4 Calabresa + 1/4 Bacon
 * + 1/4 Frango" no modal, e o servidor gravava três sabores de uma fração cada:
 *
 *   - `opcoes_texto` saía "Sabores: Calabresa" em vez de "2/4 Calabresa", então
 *     a COZINHA nunca soube da divisão — o recurso era cosmético;
 *   - e com `modo_preco = 'proporcional'` o denominador virava o número de
 *     sabores distintos em vez de frações, cobrando errado.
 *
 * A leitura agora é centralizada em `lerEscolhas`, que preserva repetição e tem
 * teste próprio. O que este teste garante é que a rota USE essa porta, e não
 * volte a colapsar antes de chamar.
 */
describe('a validação do pedido não colapsa repetição', () => {
  const cliente = fs.readFileSync(path.resolve(__dirname, 'rotas', 'cliente.ts'), 'utf8');

  it('lê pelo `lerEscolhas`, que preserva fração', () => {
    expect(cliente).toMatch(/const escolhas = lerEscolhas\(opcoesEscolhidas\)/);
  });

  /* A assinatura exata do defeito: um Set construído a partir do que o cliente
     mandou. O `new Set` que sobrou na rota é outro — o das escolhas já
     reconhecidas, que existe pra recusar opção inválida. */
  it('não constrói Set a partir do que o cliente mandou', () => {
    expect(cliente).not.toMatch(/new Set\(\s*opcoesEscolhidas/);
    expect(cliente).not.toMatch(/\[\.\.\.new Set\(opcoes/);
  });

  /* E o preço roda POR SLOT: `precoDoGrupo` dentro do laço de slots. Achatar
     cobraria, com 'maior', uma pizza por duas. */
  it('o preço é somado dentro do laço de slots', () => {
    const i = cliente.indexOf('for (const alvo of slots)');
    const j = cliente.indexOf('const chaveDe =', i);
    expect(i).toBeGreaterThan(-1);
    expect(cliente.slice(i, j)).toMatch(/precoUnit \+= precoDoGrupo\(grupo, escolhidas\)/);
  });
});
