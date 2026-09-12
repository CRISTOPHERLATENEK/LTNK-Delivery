import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * CRIAR E APAGAR CATEGORIA.
 *
 * ATÉ AQUI NÃO EXISTIA APAGAR. Categoria nascia de escrever o nome no cadastro
 * de um produto e só existia enquanto algum produto a usasse; para se livrar de
 * uma, o lojista abria produto por produto e trocava o nome na mão. Com 22
 * categorias e 1.218 produtos isso não é tarefa, é motivo para conviver com o
 * cardápio errado.
 *
 * O QUE ESTE ARQUIVO PROTEGE é a única parte perigosa: o DESTINO DOS PRODUTOS.
 * Apagar uma categoria com 60 itens dentro não pode deixar 60 produtos sem
 * categoria — na vitrine eles cairiam numa faixa sem nome e no painel sumiriam
 * da navegação. A regra é: com produto dentro, o servidor RECUSA apagar sem
 * destino, e a tela pergunta.
 */

const ler = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROTAS = semComentarios(ler('rotas/lojista.ts'));
const APAGAR = ROTAS.slice(
  ROTAS.indexOf("router.delete('/categorias/:nome'"),
  ROTAS.indexOf("router.put('/ordem-cardapio'"),
);
const CRIAR = ROTAS.slice(
  ROTAS.indexOf("router.post('/categorias'"),
  ROTAS.indexOf("router.delete('/categorias/:nome'"),
);

describe('apagar categoria não deixa produto órfão', () => {
  it('as duas rotas existem e exigem loja autenticada', () => {
    expect(ROTAS).toContain("router.post('/categorias'");
    expect(ROTAS).toContain("router.delete('/categorias/:nome'");
    expect(CRIAR).toContain('minhaLoja(req)');
    expect(APAGAR).toContain('minhaLoja(req)');
  });

  /*
   * O 409 É O CORAÇÃO DISSO. Ele não é "erro": é a pergunta que falta ser
   * respondida, e leva a CONTAGEM junto porque é isso que a tela precisa dizer
   * ("60 produtos estão nela — para onde vão?").
   */
  it('com produto dentro e sem destino, recusa com a contagem', () => {
    expect(APAGAR).toMatch(/quantos > 0 && !destino/);
    expect(APAGAR).toContain('status(409)');
    expect(APAGAR).toMatch(/produtos:\s*quantos/);
  });

  it('com destino, move os produtos antes de apagar', () => {
    const mover = APAGAR.indexOf('UPDATE produtos SET categoria = ?');
    const apagar = APAGAR.indexOf('DELETE FROM categorias');
    expect(mover).toBeGreaterThan(-1);
    expect(apagar).toBeGreaterThan(mover);
  });

  /* Tudo numa transação: mover 60 produtos e apagar a categoria são o mesmo
     ato, e metade feito é pior que nada feito. */
  it('mover e apagar acontecem juntos ou não acontecem', () => {
    expect(APAGAR).toContain('comTransacao');
    const i = APAGAR.indexOf('comTransacao');
    const corpo = APAGAR.slice(i, i + 900);
    expect(corpo).toContain('UPDATE produtos');
    expect(corpo).toContain('DELETE FROM categorias');
  });

  /*
   * A SUBCATEGORIA NÃO VIAJA JUNTO. Ela pertence ao PAR categoria +
   * subcategoria: "Lata" dentro de "Cervejas" não é a mesma coisa que "Lata"
   * dentro de "Refrigerantes". Carregar o nome criaria no destino uma faixa que
   * ninguém cadastrou.
   */
  it('a subcategoria é limpa na mudança', () => {
    expect(APAGAR).toMatch(/UPDATE produtos SET categoria = \?, subcategoria = ''/);
  });

  /* E as subcategorias da categoria apagada somem com ela: deixá-las é lixo
     que reaparece em filtro e em relatório. */
  it('as subcategorias da categoria apagada também somem', () => {
    expect(APAGAR).toContain('DELETE FROM subcategorias');
  });

  it('não aceita mover para ela mesma', () => {
    expect(APAGAR).toMatch(/destino === nome/);
  });
});

describe('criar categoria', () => {
  /*
   * NOME REPETIDO É RECUSADO OLHANDO OS DOIS LADOS: a tabela de categorias e o
   * uso em produto. Categoria que existe só porque um produto a usa não está na
   * tabela — sem essa segunda conferência, "criar" devolveria sucesso e a lista
   * continuaria com uma linha só.
   */
  it('recusa nome que já existe, por registro ou por uso', () => {
    expect(CRIAR).toContain('FROM categorias WHERE loja_id = ? AND nome = ?');
    expect(CRIAR).toContain('FROM produtos WHERE loja_id = ? AND excluido = 0 AND categoria = ?');
    /* AS DUAS CONSULTAS PRECISAM BARRAR, nao so existir: a primeira versao
       deste caso conferia que as consultas estavam la e passou verde com o
       `if` inteiro removido (verificado sabotando). */
    expect(CRIAR).toMatch(/if \(registrada \|\| emProduto\)[\s\S]{0,80}409/);
  });

  /* Nasce no fim da fileira: entrar na frente mudaria a ordem do cardápio de
     quem está comprando agora por causa de um cadastro. */
  it('nasce no fim da ordem', () => {
    expect(CRIAR).toContain('MAX(ordem)');
  });
});

describe('o campo de categoria do cadastro', () => {
  const CAMPO = semComentarios(fs.readFileSync(
    path.join(__dirname, '../../frontend/src/pages/lojista/seletor-categoria.tsx'), 'utf8'));
  const FORM = semComentarios(fs.readFileSync(
    path.join(__dirname, '../../frontend/src/pages/lojista/produtos.tsx'), 'utf8'));

  /*
   * O PAINEL É EM FLUXO, e isso não é gosto: o corpo do modal é o scroller
   * (`overflow-y: auto`), e um painel `absolute` fica recortado por ele — a
   * busca e o fim da lista viram inalcançáveis.
   */
  it('o painel não é flutuante', () => {
    expect(CAMPO).not.toContain('absolute');
    expect(CAMPO).not.toContain('fixed');
  });

  it('tem busca, e a busca filtra', () => {
    expect(CAMPO).toContain('placeholderBusca');
    expect(CAMPO).toMatch(/opcoes\.filter\([^)]*nome\.toLowerCase\(\)\.includes/);
  });

  /* A contagem por categoria é o que separa "SALGADOS 12" de "SALGADINHOS 7". */
  it('cada linha mostra quantos produtos tem', () => {
    /* DENTRO DA LISTA, e nao em qualquer lugar do arquivo: a tela de confirmar
       o apagar tambem imprime `{o.itens}`, entao procurar solto deixava passar
       a remocao da contagem das linhas (verificado sabotando). */
    const i = CAMPO.indexOf('filtradas.map(');
    const lista = CAMPO.slice(i, CAMPO.indexOf('!filtradas.length'));
    expect(i).toBeGreaterThan(-1);
    expect(lista).toMatch(/\{o\.itens\}/);
    expect(FORM).toContain('opcoesCategoria');
  });

  /* Criar vira a ação do que foi digitado: quem procurou "sorv" e não achou
     quer criar "sorv", não abrir outro campo. */
  it('o rodapé vira "Criar" com o texto buscado', () => {
    expect(CAMPO).toMatch(/Criar [^<]*busca\.trim\(\)/);
  });

  /*
   * A LIXEIRA PRECISA EXISTIR NO CELULAR. Escondê-la atrás de `hover` deixaria
   * a ação inalcançável no toque — não existe hover no dedo.
   */
  it('o apagar não depende de hover no celular', () => {
    const i = CAMPO.indexOf('aria-label={`Apagar');
    const corpo = CAMPO.slice(i, i + 400);
    expect(corpo).toContain('sm:opacity-0');
    expect(corpo).toContain('sm:group-hover:opacity-100');
    /* `opacity-0` SEM PREFIXO seria o defeito: com `sm:` na frente ele so vale
       do tablet para cima, que e onde existe mouse. O `\b` sozinho casava com
       o `sm:opacity-0` e reprovava a versao correta. */
    expect(corpo).not.toMatch(/(?<![\w:-])opacity-0(?![\w-])/);
  });

  /* Trocar a categoria limpa a subcategoria: "Lata" da categoria antiga não
     quer dizer nada na nova. */
  it('trocar a categoria limpa a subcategoria', () => {
    expect(FORM).toMatch(/categoria: v, subcategoria: ''/);
  });

  it('a lista de categorias vem do servidor, não só dos produtos', () => {
    expect(FORM).toContain("queryKey: ['lojista-categorias']");
    expect(FORM).toContain('categoriasDoServidor');
  });

  /* Apagar mexe nos DOIS lados: a lista perdeu uma categoria e os produtos
     dela mudaram de faixa. Sem os dois refetch, a tela mente até o F5. */
  it('apagar recarrega categorias e produtos', () => {
    const i = FORM.indexOf('async function apagarCategoria');
    const corpo = FORM.slice(i, i + 700);
    expect(corpo).toContain("['lojista-categorias']");
    expect(corpo).toContain("['lojista-produtos']");
  });
});
