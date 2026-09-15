import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * OS FILTROS "ESGOTADOS" E "PAUSADOS" NO PAINEL DE PRODUTOS.
 *
 * Pedido do lojista com 1.116 itens no cardápio. As duas perguntas — "quais
 * estão esgotados?" e "o que ainda não botei à venda?" — só se respondiam
 * rolando a lista inteira atrás de um selo cinza. E são de rotina: o esgotado é
 * dinheiro parado que o cliente não vê, e o pausado é o produto importado do
 * ERP esperando decisão (no Galderio, 581 deles).
 */

const PRODUTOS = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'produtos.tsx'), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CODIGO = semComentarios(PRODUTOS);

describe('o que conta como esgotado', () => {
  /*
   * A TERCEIRA CONDIÇÃO É A QUE NÃO PARECE ÓBVIA: produto PAUSADO com saldo
   * zero não está esgotado para ninguém — ele nem está no ar. No Galderio são
   * 273 assim, e sem este corte o filtro mostraria 473 onde a resposta útil é
   * 200. Pior: os dois filtros deixariam de ser excludentes e um produto
   * apareceria nos dois, que é o jeito mais rápido de um filtro perder a
   * confiança de quem usa.
   */
  it('exige estar à venda, controlar estoque e estar zerado', () => {
    const i = CODIGO.indexOf('function ehEsgotado');
    expect(i).toBeGreaterThan(0);
    /* O CORPO COMEÇA DEPOIS DO `): boolean {`, e não no primeiro `}`: o bloco de
       parâmetros do `ehEsgotado` é um objeto de tipo, e fatiar no primeiro `}`
       parava antes da primeira linha de código. */
    const inicio = CODIGO.indexOf('): boolean {', i);
    const corpo = CODIGO.slice(inicio, CODIGO.indexOf('\n}', inicio));
    expect(corpo).toContain('ehVendido(p)');
    expect(corpo).toContain('p.controla_estoque');
    expect(corpo).toMatch(/Number\(p\.estoque \?\? 0\) <= 0/);
  });

  /* Sem controle de estoque, `estoque = 0` é uma coluna que ninguém olha e o
     produto vende normalmente. */
  it('produto sem controle de estoque não entra', () => {
    const i = CODIGO.indexOf('function ehEsgotado');
    /* O CORPO COMEÇA DEPOIS DO `): boolean {`, e não no primeiro `}`: o bloco de
       parâmetros do `ehEsgotado` é um objeto de tipo, e fatiar no primeiro `}`
       parava antes da primeira linha de código. */
    const inicio = CODIGO.indexOf('): boolean {', i);
    const corpo = CODIGO.slice(inicio, CODIGO.indexOf('\n}', inicio));
    expect(corpo).toContain('!!p.controla_estoque');
  });
});

describe('os filtros na lista', () => {
  it('esgotado e pausado filtram a lista', () => {
    expect(CODIGO).toContain("filtroSituacao === 'esgotado' && !ehEsgotado(p)");
    expect(CODIGO).toContain("filtroSituacao === 'pausado' && ehVendido(p)");
  });

  /*
   * A CONTAGEM VEM DE `todos`, NÃO DOS FILTRADOS — mesma razão da contagem por
   * categoria, que já custou esse erro uma vez: com o filtrado, escolher
   * "Esgotados" faria "Pausados" marcar zero, e o lojista concluiria que não há
   * nenhum pausado.
   */
  it('a contagem dos chips olha o cardápio inteiro', () => {
    const i = CODIGO.indexOf('const contagemSituacao');
    expect(i).toBeGreaterThan(0);
    const corpo = CODIGO.slice(i, i + 300);
    expect(corpo).toContain('todos.filter(ehEsgotado)');
    expect(corpo).toContain('todos.filter(p => !ehVendido(p))');
    expect(corpo).not.toContain('filtrados');
  });

  /*
   * ARRASTAR SÓ COM A LISTA INTEIRA NA TELA. Reordenar usa o índice na lista;
   * com um filtro ativo o que está na tela é um subconjunto, e soltar na 2ª
   * linha visível mandaria "põe na 2ª" quando a 2ª de verdade é outra — o
   * lojista veria o cardápio embaralhar sozinho.
   */
  it('o filtro de situação também desliga o arrasto', () => {
    const linha = CODIGO.split('\n').find(l => l.includes('const podeOrdenar ='));
    expect(linha).toBeDefined();
    expect(linha).toContain('!filtroSituacao');
  });

  /* Com filtro ativo a lista NÃO nasce recolhida: quem filtrou quer ver o
     resultado. */
  it('filtrar abre as categorias em vez de recolher', () => {
    const i = CODIGO.indexOf('iniciarRecolhida=');
    expect(CODIGO.slice(i, i + 140)).toContain('!filtroSituacao');
  });
});

describe('os chips', () => {
  /*
   * O NÚMERO VEM JUNTO DO RÓTULO, e não depois do clique: quando marca zero, a
   * resposta já está dada sem filtrar nada. Sem ele, "não tem nenhum esgotado"
   * e "o filtro não funcionou" seriam a mesma tela vazia.
   */
  it('mostram a contagem ao lado do nome', () => {
    const i = CODIGO.indexOf('function FiltroSituacao');
    expect(i).toBeGreaterThan(0);
    const corpo = CODIGO.slice(i, i + 2200);
    expect(corpo).toContain("rotulo: 'Esgotados'");
    expect(corpo).toContain("rotulo: 'Pausados'");
    expect(corpo).toContain('{o.n}');
  });

  /* Filtro de duas opções sem "Todos" precisa de saída óbvia, e a saída óbvia é
     o mesmo botão. */
  it('clicar no chip ativo desliga o filtro', () => {
    const i = CODIGO.indexOf('function FiltroSituacao');
    const corpo = CODIGO.slice(i, i + 2200);
    expect(corpo).toMatch(/aoEscolher\(ativo \? '' : o\.id\)/);
  });

  /* Dois chips marcando zero ocupam a dobra para não dizer nada. */
  it('sem esgotado nem pausado, a linha some', () => {
    const i = CODIGO.indexOf('function FiltroSituacao');
    const corpo = CODIGO.slice(i, i + 2200);
    expect(corpo).toMatch(/if \(!esgotados && !pausados\) return null;/);
  });
});

describe('sincronizar o estoque de um produto só', () => {
  /*
   * PEDIDO DO LOJISTA: "um botão de sincronização forçado por produto, caso o
   * cliente queira que apareça na hora a alteração do estoque".
   *
   * O ciclo relê tudo a cada 2 minutos; isto é para quem acabou de mexer no
   * item no Maxx Gestão e quer ver agora — ou está conferindo POR QUE aquele
   * produto não mostra estoque.
   */
  const rotas = fs.readFileSync(path.join(__dirname, 'rotas', 'lojista.ts'), 'utf8');
  const ROTAS = semComentarios(rotas);

  /*
   * UMA CHAMADA, não treze. A consulta individual do ERP existe justamente para
   * isto; usar a listagem aqui gastaria 13 chamadas do mesmo balde que emite a
   * NFC-e, para atualizar um item.
   */
  it('usa a consulta individual, não a listagem', () => {
    const i = ROTAS.indexOf("router.post('/produtos/:id/sincronizar-estoque'");
    expect(i).toBeGreaterThan(0);
    const corpo = ROTAS.slice(i, i + 3000);
    expect(corpo).toContain('saldoDeUmProduto(');
    expect(corpo).not.toContain('saldosDoLocal(');
  });

  /*
   * "SEM REGISTRO" NÃO ZERA O PRODUTO — mesma regra do ciclo. "O ERP não tem
   * linha" e "o ERP diz que acabou" são coisas diferentes, e confundi-las
   * tiraria do ar produto que ninguém inventariou.
   */
  it('produto sem registro no ERP não é zerado', () => {
    const i = ROTAS.indexOf("router.post('/produtos/:id/sincronizar-estoque'");
    const corpo = ROTAS.slice(i, i + 3000);
    const iNulo = corpo.indexOf('if (bruto === null)');
    expect(iNulo).toBeGreaterThan(0);
    const bloco = corpo.slice(iNulo, iNulo + 500);
    expect(bloco).toContain('tem_registro: false');
    /* Devolve o estoque que JÁ ESTAVA, sem gravar nada. */
    expect(bloco).not.toContain('UPDATE produtos');
  });

  /* Negativo cai na mesma regra do ciclo: vira zero. */
  it('o saldo passa pela mesma regra do ciclo', () => {
    const i = ROTAS.indexOf("router.post('/produtos/:id/sincronizar-estoque'");
    const corpo = ROTAS.slice(i, i + 3000);
    expect(corpo).toContain('saldoParaEstoque(bruto)');
  });

  /*
   * O BOTÃO NÃO LIGA O BLOQUEIO POR CONTA PRÓPRIA: só se a loja já escolheu
   * "esgotar sozinho". Um botão de sincronizar que, de quebra, tira o produto
   * do ar seria uma armadilha.
   */
  it('só liga o bloqueio se a loja escolheu esgotar sozinho', () => {
    const i = ROTAS.indexOf("router.post('/produtos/:id/sincronizar-estoque'");
    const corpo = ROTAS.slice(i, i + 3000);
    expect(corpo).toMatch(/if \(esgota && !p\.controla_estoque\)/);
  });

  it('produto que não veio do ERP é recusado com motivo', () => {
    const i = ROTAS.indexOf("router.post('/produtos/:id/sincronizar-estoque'");
    const corpo = ROTAS.slice(i, i + 3000);
    expect(corpo).toContain('não veio do Maxx Gestão');
  });

  /* 404 do ERP é RESPOSTA ("não há registro"), não falha. Qualquer outro erro
     sobe, porque aí o lojista precisa saber que a consulta não aconteceu. */
  it('o 404 do ERP vira "sem registro", e o resto sobe', () => {
    const cat = semComentarios(
      fs.readFileSync(path.join(__dirname, 'maxxgestao-catalogo.ts'), 'utf8'));
    const i = cat.indexOf('export async function saldoDeUmProduto');
    expect(i).toBeGreaterThan(0);
    const corpo = cat.slice(i, cat.indexOf('\n}', cat.indexOf('catch', i)));
    expect(corpo).toMatch(/httpStatus === 404\) return null;/);
    expect(corpo).toContain('throw e;');
  });
});
