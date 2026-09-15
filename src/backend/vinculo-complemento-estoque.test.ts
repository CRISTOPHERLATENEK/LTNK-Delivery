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
    const trecho = LOJISTA.slice(i, i + 600);
    expect(trecho).toContain('produto_id)');
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
    expect(TELA).toContain('salvarOpcao(o, { produto_id: p.id })');
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
     * O TETO É MEDIDO DENTRO DO SELETOR, e não no arquivo inteiro. Existe outro
     * `.slice(0, 40)` nesta tela (o corte do nome de seção), e procurar solto
     * fazia o teste passar com o teto REMOVIDO — foi o que a sabotagem mostrou.
     */
    const i = TELA.indexOf('const achados = vinculaveis');
    expect(i).toBeGreaterThan(0);
    const bloco = TELA.slice(i, i + 300);
    expect(bloco).toContain('.filter(');
    expect(bloco).toContain('.slice(0, 40)');
  });

  /* Carregar o cardápio inteiro junto com a tela seria pagar por todos o que um
     usa: a consulta só sai quando o seletor abre. */
  it('o cardápio do seletor só carrega quando abre', () => {
    const i = TELA.indexOf("queryKey: ['lojista-produtos-vinculaveis']");
    expect(i).toBeGreaterThan(0);
    expect(TELA.slice(i, i + 400)).toContain('enabled: vinculando !== null');
  });
});
