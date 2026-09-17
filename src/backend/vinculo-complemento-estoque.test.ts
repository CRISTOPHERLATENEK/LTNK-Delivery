import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * O COMPLEMENTO LIGADO AO PRODUTO DO ESTOQUE.
 *
 * Pedido do lojista, com o pote de whisky na mão: "nesse caso do pote, o
 * energético não vai ter controle de estoque; aí preciso ter opção de controlar
 * o estoque no complemento, pra mim não ter que ficar fazendo gambiarra".
 *
 * A gambiarra que ele evitou era criar dois potes, um com gelo controlado e
 * outro sem. O desenho que substitui isso tem duas peças, e este arquivo prende
 * as duas:
 *
 *   1. O INTERRUPTOR É DO GRUPO (`grupos_opcoes.baixa_estoque`). No mesmo pote
 *      o gelo baixa e o energético não — regra global não resolveria.
 *   2. CADA OPÇÃO APONTA PARA UM PRODUTO (`opcoes_itens.produto_id`). "Gelo de
 *      coco" é texto; quem tem saldo e SKU é GELO DE COCO TRADICIONAL.
 *
 * A explosão do item em linhas de documento é de `erp-explodir-item.ts`, e tem
 * teste próprio. Aqui é o caminho que leva o dado até lá.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SCHEMA = semComentarios(ler('src', 'backend', 'schema-mysql.ts'));
const LOJISTA = semComentarios(ler('src', 'backend', 'rotas', 'lojista.ts'));
const GRUPOS_SQL = semComentarios(ler('src', 'backend', 'grupos-sql.ts'));
const TELA = semComentarios(ler('frontend', 'src', 'pages', 'lojista', 'produtos.tsx'));

describe('as duas colunas existem e nascem desligadas', () => {
  /*
   * NASCER DESLIGADO NÃO É DETALHE. Ligado por padrão, todo grupo de borda de
   * pizza que já existe passaria a tentar baixar estoque de um produto que não
   * existe — e o cardápio inteiro mudaria de comportamento numa migração.
   */
  it('grupos_opcoes.baixa_estoque nasce 0', () => {
    expect(SCHEMA).toMatch(/grupos_opcoes[\s\S]{0,400}baixa_estoque/);
    const i = SCHEMA.indexOf("'grupos_opcoes', 'baixa_estoque'");
    expect(i).toBeGreaterThan(0);
    expect(SCHEMA.slice(i, i + 200)).toContain('DEFAULT 0');
  });

  it('opcoes_itens.produto_id nasce 0', () => {
    const i = SCHEMA.indexOf("'opcoes_itens', 'produto_id'");
    expect(i).toBeGreaterThan(0);
    expect(SCHEMA.slice(i, i + 200)).toContain('DEFAULT 0');
  });
});

describe('o vínculo só aceita produto desta loja', () => {
  /*
   * A CONFERÊNCIA DE TENANT É O QUE IMPEDE O PIOR CASO DESTA FEATURE: um id de
   * outra empresa gravado aqui faria o estoque DELA cair a cada pedido daqui,
   * sem ninguém ver por que.
   */
  it('confere loja_id antes de gravar produto_id', () => {
    const i = LOJISTA.indexOf("router.put('/opcoes/:id'");
    expect(i).toBeGreaterThan(0);
    const corpo = LOJISTA.slice(i, LOJISTA.indexOf('\n});', i));
    expect(corpo).toContain('req.body.produto_id');
    expect(corpo).toMatch(/FROM produtos WHERE id = \? AND loja_id = \? AND excluido = 0/);
    expect(corpo).toContain('produtoVinculado');
  });

  /* Zero é como o lojista desfaz o vínculo sem apagar a opção — e não pode
     bater na consulta de existência, que nunca acharia o produto 0. */
  it('zero apaga o vínculo sem consultar o banco', () => {
    const i = LOJISTA.indexOf("router.put('/opcoes/:id'");
    const corpo = LOJISTA.slice(i, LOJISTA.indexOf('\n});', i));
    expect(corpo).toMatch(/if \(pedido === 0\) \{\s*produtoVinculado = 0;/);
  });
});

describe('o dado chega até a tela', () => {
  /*
   * ESTE É O DEFEITO MAIS FÁCIL DE COMETER AQUI: gravar `baixa_estoque` e nunca
   * devolvê-lo. O interruptor voltaria para desligado a cada recarga, e quem
   * usa concluiria que não salva.
   */
  it('baixa_estoque vem nas colunas do grupo', () => {
    expect(GRUPOS_SQL).toMatch(/COLUNAS_GRUPO = `[^`]*g\.baixa_estoque/);
  });

  /* As opções vêm com `SELECT *`, então `produto_id` viaja junto — mas só
     enquanto for `*`. */
  it('as opções do produto vêm inteiras', () => {
    const i = LOJISTA.indexOf('SELECT * FROM opcoes_itens WHERE grupo_id = ? ORDER BY ordem, id');
    expect(i).toBeGreaterThan(0);
  });

  /* A lista do seletor traz `variacao_erp` porque é ela que diz se o vínculo
     vai baixar no Maxx Gestão ou só aqui — sem isso o lojista liga tudo e
     descobre pelo estoque errado no fim do mês. */
  it('a rota do seletor devolve o SKU do ERP', () => {
    const i = LOJISTA.indexOf("router.get('/produtos-vinculaveis'");
    expect(i).toBeGreaterThan(0);
    const corpo = LOJISTA.slice(i, LOJISTA.indexOf('\n});', i));
    expect(corpo).toContain('maxxgestao_variacao_id AS variacao_erp');
    expect(corpo).toContain('loja_id = ? AND excluido = 0');
  });
});

describe('o clone do grupo leva o vínculo junto', () => {
  /*
   * DUPLICAR UM GRUPO COPIA PREÇO, SEÇÃO, INGREDIENTES E FOTO — e agora o
   * vínculo. Deixá-lo para trás é o clone parecer igual na tela e não baixar
   * nada, que é exatamente o modo de falha que o comentário da duplicação já
   * descrevia por outros campos.
   */
  it('a cópia das opções inclui produto_id', () => {
    const i = LOJISTA.indexOf('INSERT INTO opcoes_itens (grupo_id, nome, preco_adicional_centavos, disponivel, ordem, sabores');
    expect(i).toBeGreaterThan(0);
    const trecho = LOJISTA.slice(i, i + 700);
    expect(trecho).toContain('produto_id, sem_estoque)');
    expect(trecho).toContain('o.produto_id || 0');
  });
});

describe('a tela dos complementos', () => {
  it('o interruptor fica no grupo e salva baixa_estoque', () => {
    expect(TELA).toContain('salvarGrupo(grupo, { baixa_estoque: !grupo.baixa_estoque })');
  });

  /*
   * O SELETOR DE PRODUTO SÓ APARECE COM O GRUPO LIGADO. Em grupo de borda de
   * pizza ele seria uma pergunta sem resposta em cada linha.
   */
  it('o seletor de produto depende do grupo estar ligado', () => {
    expect(TELA).toContain('{!!grupo.baixa_estoque && (');
  });

  it('escolher um produto grava produto_id na opção', () => {
    /* `sem_estoque: false` vai junto desde que existe a marca explícita: os dois
       estados se excluem, e mandar só um deixaria a linha piscando com o estado
       velho até a releitura chegar. */
    expect(TELA).toContain('salvarOpcao(o, { produto_id: p.id, sem_estoque: false })');
  });

  it('dá pra desvincular', () => {
    expect(TELA).toContain('salvarOpcao(o, { produto_id: 0 })');
  });

  /*
   * OPÇÃO SEM VÍNCULO APARECE EM DESTAQUE, e não em cinza: com o grupo ligado,
   * ela é a única razão pela qual o estoque não vai baixar — e cinza é a cor de
   * "está tudo certo, não olhe aqui".
   */
  it('opção sem vínculo não passa despercebida', () => {
    const i = TELA.indexOf('Escolher de qual produto sai');
    expect(i).toBeGreaterThan(0);
    const bloco = TELA.slice(Math.max(0, i - 900), i);
    expect(bloco).toContain('o.produto_id');
    expect(bloco).toMatch(/amber/);
  });

  /* A lista é o cardápio inteiro — em loja grande, mil linhas. Sem teto e sem
     busca, achar o gelo é rolar. */
  it('a lista do seletor tem busca e teto', () => {
    expect(TELA).toContain('value={buscaVinculo}');
    /*
     * A BUSCA MUDOU DE LUGAR: virou `lib/busca-produto.ts`, com teste próprio
     * (`busca-produto.test.ts`) — ela ignora acento, aceita as palavras em
     * qualquer ordem e entende código de barras e SKU. O que este teste ainda
     * guarda é o TETO, que continua sendo da tela: sem ele a lista é o cardápio
     * inteiro, mil linhas num painel de 14rem.
     */
    expect(TELA).toContain('buscarProdutos(vinculaveis, buscaVinculo, 40)');
  });

  /* Carregar o cardápio inteiro junto com a tela seria pagar por todos o que um
     usa: a consulta só sai quando o seletor abre. */
  it('o cardápio do seletor só carrega quando abre', () => {
    const i = TELA.indexOf("queryKey: ['lojista-produtos-vinculaveis']");
    expect(i).toBeGreaterThan(0);
    expect(TELA.slice(i, i + 400)).toContain('enabled: vinculando !== null');
  });
});

describe('"não baixa estoque" como decisão, e não como esquecimento', () => {
  /*
   * O CASO REAL: no grupo "Energético" do balde, Monster e Red Bull saem do
   * estoque e os cinco Balys não — o Baly do balde vem de outra compra.
   *
   * Antes desta marca, opção sem vínculo num grupo ligado só podia significar
   * esquecimento, e a tela avisava em âmbar para sempre. Cinco alertas que
   * ninguém pode resolver ensinam a ignorar o alerta — e aí o esquecimento de
   * verdade passa junto com eles.
   */
  it('a coluna existe e nasce desligada', () => {
    const i = SCHEMA.indexOf("'opcoes_itens', 'sem_estoque'");
    expect(i).toBeGreaterThan(0);
    expect(SCHEMA.slice(i, i + 160)).toContain('DEFAULT 0');
  });

  /*
   * OS DOIS ESTADOS SÃO EXCLUSIVOS, e quem garante é o servidor: escolher um
   * produto desliga a marca, e marcar "não baixa" apaga o vínculo. Juntos
   * seriam um estado que a tela não sabe desenhar e que ninguém saberia ler.
   */
  it('vincular e "não baixa" se excluem, no servidor', () => {
    const i = LOJISTA.indexOf("router.put('/opcoes/:id'");
    const corpo = LOJISTA.slice(i, LOJISTA.indexOf('\n});', i));
    expect(corpo).toContain('if (req.body.produto_id !== undefined && produtoVinculado > 0) semEstoque = 0;');
    expect(corpo).toContain('if (semEstoque === 1) produtoVinculado = 0;');
    expect(corpo).toContain('sem_estoque = ?');
  });

  /* O clone leva a decisão junto, senão volta a pedir vínculo que ninguém dará. */
  it('duplicar o grupo preserva a marca', () => {
    const i = LOJISTA.indexOf('INSERT INTO opcoes_itens (grupo_id, nome, preco_adicional_centavos, disponivel, ordem, sabores');
    const trecho = LOJISTA.slice(i, i + 700);
    expect(trecho).toContain('sem_estoque)');
    expect(trecho).toContain('o.sem_estoque || 0');
  });

  /*
   * ÂMBAR SÓ PARA PENDÊNCIA DE VERDADE. É o ponto inteiro da mudança: decisão
   * tomada é cinza.
   */
  it('a marca tira o âmbar da linha', () => {
    expect(TELA).toContain('o.produto_id || o.sem_estoque');
    expect(TELA).toContain("'Não baixa estoque'");
  });

  it('dá para marcar pelo seletor', () => {
    expect(TELA).toContain('salvarOpcao(o, { sem_estoque: true })');
  });

  /* Escolher produto tem que limpar a marca também na tela, senão a linha
     pisca com o estado velho até a releitura chegar. */
  it('escolher produto limpa a marca', () => {
    expect(TELA).toContain('salvarOpcao(o, { produto_id: p.id, sem_estoque: false })');
  });
});

describe('complemento é de UM produto só', () => {
  /*
   * O DEFEITO, NAS PALAVRAS DO LOJISTA: "usei uma composição pronta lá, aí eu
   * alterei em outros, alterou em todas as outras composições de outros
   * produtos. A composição de um produto não pode interferir no outro."
   *
   * Ele tem razão sobre o efeito, e o efeito era intencional: trazer um grupo da
   * biblioteca criava uma LIGAÇÃO com o mesmo grupo, para que a pizzaria com 30
   * pizzas tivesse UMA borda para manter. A tela avisava ("em 10 produtos",
   * "mudar aqui muda em todos") e o aviso não bastou.
   *
   * A regra passou a ser a dele: cada produto tem o seu. O custo — 30 bordas
   * para manter — é sabido e foi aceito.
   */
  it('trazer da biblioteca COPIA, não liga o mesmo grupo', () => {
    const i = LOJISTA.indexOf("router.post('/produtos/:id/grupos/:grupoId',");
    expect(i).toBeGreaterThan(0);
    const rota = LOJISTA.slice(i, LOJISTA.indexOf("router.delete('/produtos/:id/grupos/:grupoId'", i));
    expect(rota).toContain('copiarGrupoPara(');
    /* A ligação nova aponta pro CLONE. Apontar pro original é o defeito. */
    expect(rota).toMatch(/\.run\(produto\.id, clone, proxima/);
  });

  /*
   * DUPLICAR PRODUTO TAMBÉM COPIA. É a mesma armadilha por outra porta: duplicar
   * um balde e ajustar o gelo de um mexeria no outro.
   */
  it('duplicar produto também copia os complementos', () => {
    const i = LOJISTA.indexOf("router.post('/produtos/:id/duplicar'");
    const rota = LOJISTA.slice(i, LOJISTA.indexOf("router.post('/produtos/bulk'", i));
    expect(rota).toContain('copiarGrupoPara(tx, loja.id, novoId, g, l)');
  });

  /*
   * A CÓPIA LEVA O INTERRUPTOR DE ESTOQUE. Sem ele a cópia nasce sem baixar
   * nada, e o lojista descobre pelo estoque errado no fim do mês.
   */
  it('a cópia leva baixa_estoque e os vínculos dos itens', () => {
    const i = LOJISTA.indexOf('async function copiarGrupoPara');
    const corpo = LOJISTA.slice(i, LOJISTA.indexOf('return clone;', i));
    /* O ARGUMENTO, não o nome da coluna: trocar o valor por `0` deixava a
       coluna na lista do INSERT e o teste passava — a cópia nascia sem baixar
       estoque nenhum, em silêncio. */
    expect(corpo).toContain('grupo.baixa_estoque ? 1 : 0');
    expect(corpo).toContain('o.produto_id || 0, o.sem_estoque || 0');
  });

  /*
   * DUPLO CLIQUE NÃO PODE VIRAR DOIS COMPLEMENTOS IGUAIS. Quem barrava era a
   * UNIQUE (produto_id, grupo_id); com cópias, cada uma tem id próprio e o banco
   * não reclama mais. Agora quem barra é o nome, que é o que o cliente lê.
   */
  it('o mesmo complemento não entra duas vezes no produto', () => {
    const i = LOJISTA.indexOf("router.post('/produtos/:id/grupos/:grupoId',");
    const rota = LOJISTA.slice(i, LOJISTA.indexOf("router.delete('/produtos/:id/grupos/:grupoId'", i));
    expect(rota).toMatch(/LOWER\(g\.nome\) = LOWER\(\?\)/);
    /* A GUARDA TEM QUE DEPENDER DA CONSULTA. `if (false)` mantinha a consulta e
       o 409 no arquivo, e o teste passava com a proteção desligada. */
    expect(rota).toMatch(/if \(jaTem\) throw erroHttp\(409/);
  });

  /* A tela não pode mais prometer o que o servidor não faz. */
  it('a tela diz que a biblioteca traz uma cópia', () => {
    expect(TELA).toContain('vem uma cópia pronta com os itens e os preços');
  });
});

describe('a biblioteca não repete o mesmo complemento', () => {
  /*
   * EFEITO COLATERAL DA CÓPIA, visto na tela pelo lojista: "tá cheio igual".
   *
   * Desde que cada produto tem o seu grupo, a lista "Da sua loja" passou a
   * mostrar o mesmo complemento uma vez por produto — "REFRIGERANTE" cinco
   * vezes, "Sabor do gelo — leva 1" seis, todas idênticas. Escolher qualquer
   * uma dá exatamente o mesmo resultado (uma cópia), então as seis linhas eram
   * só rolagem.
   */
  it('agrupa por nome + conteúdo', () => {
    expect(TELA).toContain('const porConteudo = new Map<string, GrupoBiblioteca & { copias: number }>()');
    expect(TELA).toContain('const chave = `${g.nome.trim().toLowerCase()}|${g.previa ?? \'\'}`');
  });

  /*
   * DOIS GRUPOS DE MESMO NOME COM ITENS DIFERENTES CONTINUAM SENDO DOIS. Juntar
   * por nome só esconderia a diferença que a prévia existe para mostrar — e o
   * lojista levaria o grupo errado sem ter como perceber.
   */
  it('o conteúdo entra na chave, não só o nome', () => {
    /* A chave DESTA lista: existe outra `const chave` na tela (a do combo), e
       procurar solto pegava a errada. */
    const i = TELA.indexOf('const chave = `${g.nome');
    expect(i).toBeGreaterThan(0);
    expect(TELA.slice(i, i + 120)).toContain('g.previa');
  });

  it('a contagem soma as cópias', () => {
    expect(TELA).toContain('usado em {Math.max(g.copias, g.usos)} produtos');
  });
});

describe('a ajuda não promete o que o sistema não faz mais', () => {
  /*
   * ATÉ 17/09/2026 A AJUDA ESTAVA CERTA: um grupo servia vários produtos, e
   * mudar nele mudava em todos. Quando a regra virou "cada produto tem o seu",
   * três textos ficaram descrevendo o sistema antigo — inclusive o cabeçalho da
   * própria aba, que dizia "Um grupo pode servir vários produtos" logo acima de
   * complementos que não servem mais.
   *
   * Ajuda que descreve o sistema antigo é pior que ajuda nenhuma: quem lê
   * confia e age errado com confiança.
   */
  const AJUDA = fs.readFileSync(
    path.join(raiz, 'frontend', 'src', 'components', 'ui', 'ajuda.tsx'), 'utf8');

  it('o cabeçalho da aba diz a regra de hoje', () => {
    expect(TELA).toContain('Os complementos são deste produto');
    expect(TELA).not.toContain('Um grupo pode servir vários produtos');
  });

  it('nenhum texto promete grupo compartilhado', () => {
    const semComentario = AJUDA.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(semComentario).not.toContain('pode servir vários produtos');
    expect(semComentario).not.toContain('AO MESMO TEMPO');
    expect(semComentario).not.toContain('duplicar liga ao mesmo grupo');
  });

  /* E diz o caminho que substituiu o compartilhamento. */
  it('aponta para a cópia pronta da biblioteca', () => {
    expect(AJUDA).toContain('"Da sua loja" traz uma CÓPIA pronta');
  });

  /*
   * O OUTRO LADO DA MOEDA TAMBÉM ESTÁ ESCRITO. Trinta pizzas iguais passaram a
   * ser trinta edições — quem lê a ajuda tem que saber disso antes de montar o
   * cardápio, não depois.
   */
  it('avisa do custo da separação', () => {
    expect(AJUDA).toContain('trinta pizzas é trinta edições');
  });
});
