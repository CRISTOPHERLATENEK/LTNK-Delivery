import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * O RELATÓRIO EM SEIS ABAS, E A REGRA QUE VALE MAIS QUE O DESENHO.
 *
 * A tela era uma coluna: quatro números, um bloco financeiro e uma lista de
 * estoque que só dizia "sem estoque" — sem quantidade, sem mínimo, sem giro,
 * sem valor. Dava para saber O QUE acabou; nunca O QUE COMPRAR.
 *
 * ────────────── O DEFEITO MAIS CARO QUE ESTE ARQUIVO PRENDE ─────────────────
 *
 * A tabela de estoque é UMA PÁGINA do catálogo, não o catálogo. Numa loja com
 * 1.116 produtos, contar as linhas da tela responde "10 sem estoque" onde a
 * resposta é 463. O número que o lojista clica no cartão tem que ser o mesmo
 * que ele encontra no chip e no rodapé — dois valores sob o mesmo rótulo
 * invalidam o relatório inteiro, e quem confere uma vez e vê que não fecha não
 * confia de novo.
 *
 * Por isso: toda contagem e todo valor saem de consulta agregada no servidor, e
 * `itens.length` não decide número nenhum na tela.
 */

const raiz = path.join(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const TELA = semComentarios(ler('frontend', 'src', 'pages', 'lojista', 'relatorios.tsx'));
const PARTES = semComentarios(ler('frontend', 'src', 'pages', 'lojista', 'relatorios-partes.tsx'));
const LOJISTA = semComentarios(ler('src', 'backend', 'rotas', 'lojista.ts'));
const SCHEMA = semComentarios(ler('src', 'backend', 'schema-mysql.ts'));

/** O corpo da rota de estoque — as buscas não podem pegar outra rota. */
const ROTA_ESTOQUE = (() => {
  const i = LOJISTA.indexOf("router.get('/relatorios/estoque'");
  expect(i).toBeGreaterThan(0);
  return LOJISTA.slice(i, LOJISTA.indexOf("router.get('/relatorios/detalhes'", i));
})();

describe('a integridade dos números do estoque', () => {
  /*
   * OS TOTAIS VÊM DE CONSULTA AGREGADA. Sem isso o cartão "Sem estoque 463"
   * viraria "10" assim que a tabela paginasse — e o relatório passaria a mentir
   * exatamente onde é usado para comprar.
   */
  it('os quatro números saem de uma consulta de contagem, não das linhas', () => {
    expect(ROTA_ESTOQUE).toContain('SUM(p.estoque <= 0) AS zerados');
    expect(ROTA_ESTOQUE).toContain('AS repor');
    expect(ROTA_ESTOQUE).toContain('AS parados');
    expect(ROTA_ESTOQUE).toContain('COUNT(*) AS todos');
  });

  it('o total e o valor do filtro também', () => {
    expect(ROTA_ESTOQUE).toContain('COUNT(*) AS n, COALESCE(SUM(p.estoque * p.preco_centavos), 0) AS valor');
    expect(ROTA_ESTOQUE).toContain('total_do_filtro');
    expect(ROTA_ESTOQUE).toContain('valor_do_filtro_centavos');
  });

  /*
   * A TELA NÃO PODE CONTAR LINHA. É a mesma regra do outro lado: qualquer
   * `itens.length` alimentando um número do relatório reintroduz o defeito.
   * A exceção é o rodapé do bloco por categoria, que DIZ que soma só as linhas
   * carregadas — por isso a busca é por `est.itens.length`, e ele aparece lá
   * junto da frase que o explica.
   */
  it('a tela não usa contagem de linha como total', () => {
    const rodape = TELA.indexOf('Mostrando');
    expect(rodape).toBeGreaterThan(0);
    const bloco = TELA.slice(rodape, rodape + 500);
    expect(bloco).toContain('est.total_do_filtro');
    expect(bloco).not.toContain('est.itens.length');
  });

  /* Os baldes são exclusivos: um produto cai num só. Sem isso o mesmo item
     aparece em dois chips e a soma não fecha com "Todos". */
  it('os baldes não se sobrepõem', () => {
    expect(ROTA_ESTOQUE).toContain("zerados: 'AND p.estoque <= 0'");
    expect(ROTA_ESTOQUE).toMatch(/repor: `AND p\.estoque > 0 AND p\.estoque <= \$\{MIN\}`/);
    expect(ROTA_ESTOQUE).toMatch(/parados: `AND p\.estoque > \$\{MIN\}/);
  });

  /* O corte tem que ser dito na tela, senão "parado" é opinião. */
  it('a régua do mínimo e do parado viaja com a resposta', () => {
    expect(ROTA_ESTOQUE).toContain('regras: { minimo_padrao: MINIMO_PADRAO, parado_dias: PARADO_DIAS }');
    expect(TELA).toContain('est.regras.minimo_padrao');
    expect(TELA).toContain('est.regras.parado_dias');
  });
});

describe('o que a tabela de estoque passou a responder', () => {
  it('quantidade, mínimo, giro e valor', () => {
    expect(ROTA_ESTOQUE).toContain('AS minimo');
    expect(ROTA_ESTOQUE).toContain('AS valor_centavos');
    expect(ROTA_ESTOQUE).toContain('AS giro_semana');
    expect(ROTA_ESTOQUE).toContain('AS ultima_venda');
  });

  /*
   * O MÍNIMO É POR PRODUTO. Cinco caixas de cerveja é estoque curto; cinco
   * garrafas de whisky importado é estoque normal. Com uma régua só, o
   * relatório chamava os dois de "baixo".
   */
  it('o mínimo por produto existe e cai no padrão quando é zero', () => {
    const i = SCHEMA.indexOf("'produtos', 'estoque_minimo'");
    expect(i).toBeGreaterThan(0);
    expect(SCHEMA.slice(i, i + 120)).toContain('DEFAULT 0');
    expect(ROTA_ESTOQUE).toContain('IF(p.estoque_minimo > 0, p.estoque_minimo,');
  });

  /* Quem está com o produto na mão lê o código; quem olha a prateleira lembra
     do nome. */
  it('a busca aceita nome e código de barras', () => {
    expect(ROTA_ESTOQUE).toContain('p.nome LIKE ? OR p.codigo_barras LIKE ?');
  });
});

describe('a visão geral leva para onde se resolve', () => {
  /* Aviso que não leva a lugar nenhum vira decoração na segunda semana. */
  it('cada pendência navega para a aba já filtrada', () => {
    expect(TELA).toContain("irPara('estoque', 'zerados')");
    expect(TELA).toContain("irPara('estoque', 'repor')");
    expect(TELA).toContain("irPara('operacao')");
  });

  it('o KPI mostra a variação contra o período anterior', () => {
    expect(TELA).toContain('d.comparacao.variacao.pedidos_percent');
    expect(TELA).toContain('d.comparacao.variacao.faturamento_percent');
    expect(TELA).toContain('d.comparacao.variacao.ticket_percent');
  });

  /*
   * "+100%" NA PRIMEIRA VENDA é tecnicamente correto e inútil. Sem base de
   * comparação, a tela diz isso em texto.
   */
  it('sem base de comparação, não inventa percentual', () => {
    expect(PARTES).toContain('sem base de comparação');
    const i = PARTES.indexOf('export function Variacao');
    const corpo = PARTES.slice(i, PARTES.indexOf('export function', i + 10));
    expect(corpo).toContain('percent === null');
  });

  it('o faturamento por dia mostra a forma do período', () => {
    expect(LOJISTA).toContain('AS dia,');
    expect(TELA).toContain('d.por_dia');
  });
});

describe('as abas pesadas só consultam quando abrem', () => {
  /* A primeira tela tem que abrir rápido, e ninguém abre um relatório pelo
     fechamento de caixa. */
  it('detalhes e estoque são sob demanda', () => {
    const i = TELA.indexOf("queryKey: ['lojista-relatorios-detalhes'");
    expect(i).toBeGreaterThan(0);
    expect(TELA.slice(i, i + 400)).toContain('enabled:');
    const j = TELA.indexOf("queryKey: ['lojista-relatorios-estoque'");
    expect(TELA.slice(j, j + 500)).toContain("enabled: aba === 'estoque'");
  });
});

describe('o financeiro não inventa dedução', () => {
  /*
   * O CANCELADO NUNCA ENTROU NO BRUTO. Subtraí-lo faria o líquido sair menor do
   * que a loja de fato recebe — erro que só aparece no fim do mês, comparando
   * com o extrato.
   */
  it('cancelado é informação, não dedução', () => {
    const i = TELA.indexOf('Líquido a receber');
    expect(i).toBeGreaterThan(0);
    expect(TELA).toContain('det.financeiro.liquido_centavos');
    expect(TELA).toContain('Fora da conta');
    /* A rota inteira, e não uma janela de N caracteres: a consulta cresceu e a
       janela passou a terminar antes da resposta — teste que envelhece sozinho
       é teste que um dia falha sem defeito nenhum. */
    const rota = LOJISTA.indexOf("router.get('/relatorios/detalhes'");
    const corpo = LOJISTA.slice(rota, LOJISTA.indexOf("router.get('/banners'", rota));
    expect(corpo).toContain('liquido_centavos: (Number(fin.bruto_centavos) || 0) - (Number(fin.comissao_centavos) || 0)');
    /* O cancelado é consultado à parte e devolvido como bloco próprio — nunca
       subtraído do bruto. */
    expect(corpo).toContain('cancelado: {');
    expect(corpo).not.toContain('bruto_centavos) - (Number(cancel');
  });

  /* Taxa de cartão e prazo são do contrato com a adquirente. Estimar por
     percentual de mercado seria inventar dedução em relatório financeiro. */
  it('a tela diz por que taxa de cartão não aparece', () => {
    expect(TELA).toContain('Taxa de cartão e prazo de recebimento não entram aqui');
  });

  /* Sem custo cadastrado não há margem — e uma coluna "Margem" com o preço
     dentro seria o preço com outro nome. */
  it('a tela diz por que margem não aparece', () => {
    expect(TELA).toContain('o sistema não tem custo de produto cadastrado');
    expect(TELA).toContain('a preço de venda');
  });

  /* Nada registra entrada, perda ou contagem: o estoque é um número que a venda
     diminui e a sincronização sobrescreve. */
  it('a tela diz por que não há histórico de movimentação', () => {
    expect(TELA).toContain('Não há histórico de movimentação');
  });
});

describe('a regra visual dos números', () => {
  /* Número em fonte proporcional não alinha coluna, e relatório que não alinha
     coluna não se confere — que é a única coisa que se faz com relatório. */
  it('existe uma definição só de "número"', () => {
    expect(PARTES).toContain("export const NUM = 'font-mono tabular-nums'");
    expect(TELA).toContain('NUM');
  });
});
