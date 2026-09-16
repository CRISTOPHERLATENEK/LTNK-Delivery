import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { normalizar, pontuar, buscarProdutos, type ProdutoBuscavel }
  from '../../frontend/src/lib/busca-produto';

/*
 * A BUSCA DE PRODUTO DO SELETOR DE COMPLEMENTO.
 *
 * Era `nome.toLowerCase().includes(texto)`. Numa loja de bebidas com 1.211
 * produtos, isso falha em quase tudo que uma pessoa digita — e os casos abaixo
 * são do cardápio real do Galdério, não inventados.
 *
 * Teste de verdade, e não de texto-fonte: aqui a regra é uma função pura, e a
 * ORDEM da lista é justamente o que não se confere olhando a tela e torcendo.
 */

const CARDAPIO: ProdutoBuscavel[] = [
  { id: 72, nome: 'MONSTER TRADICIONAL 473ML UNIDADE', categoria: 'Energéticos', variacao_erp: 77, codigo_barras: '7898942930003' },
  { id: 71, nome: 'MONSTER MANGO LOKO 473ML UNIDADE', categoria: 'Energéticos', variacao_erp: 76 },
  { id: 1089, nome: 'DIPLOKO SURPRISE PET MONSTER 11G', categoria: 'Doces', variacao_erp: 297 },
  { id: 1088, nome: 'DIPLOKO MONSTER NEON 10G', categoria: 'Doces', variacao_erp: 288 },
  { id: 808, nome: 'BALY MAÇA VERDE 473ML', categoria: 'Energéticos', variacao_erp: 937 },
  { id: 1262, nome: 'GELO MAÇÃ VERDE', categoria: 'Gelo', variacao_erp: 584 },
  { id: 511, nome: 'GELO DE COCO TRADICIONAL', categoria: 'Gelo', variacao_erp: 580 },
  { id: 81, nome: 'RED BULL TRADICIONAL 250ML UNIDADE', categoria: 'Energéticos', variacao_erp: 86 },
  { id: 9001, nome: 'COPO DESCARTAVEL', categoria: 'Descartáveis', variacao_erp: 0 },
];

const nomes = (r: ProdutoBuscavel[]) => r.map(p => p.nome);

describe('o que a busca antiga não achava', () => {
  /* ACENTO. "maca verde" é como se digita com pressa, e no teclado do celular
     é como se digita sempre. */
  it('acha sem acento', () => {
    expect(nomes(buscarProdutos(CARDAPIO, 'maca verde'))).toContain('GELO MAÇÃ VERDE');
    expect(nomes(buscarProdutos(CARDAPIO, 'maca verde'))).toContain('BALY MAÇA VERDE 473ML');
  });

  /* ORDEM DAS PALAVRAS. Quem pensa "o Monster tradicional" e quem pensa "o
     tradicional da Monster" querem o mesmo produto. */
  it('acha com as palavras ao contrário', () => {
    expect(nomes(buscarProdutos(CARDAPIO, 'tradicional monster'))[0])
      .toBe('MONSTER TRADICIONAL 473ML UNIDADE');
  });

  /* SKU. Quem está com a nota do Maxx Gestão na mão digita o número. */
  it('acha pelo SKU do ERP', () => {
    expect(nomes(buscarProdutos(CARDAPIO, '77'))[0]).toBe('MONSTER TRADICIONAL 473ML UNIDADE');
  });

  /* CÓDIGO DE BARRAS. Quem está com o produto na mão lê a etiqueta. */
  it('acha pelo código de barras', () => {
    expect(nomes(buscarProdutos(CARDAPIO, '7898942930003'))[0])
      .toBe('MONSTER TRADICIONAL 473ML UNIDADE');
  });

  /* Etiqueta rasgada, leitura parcial: o começo do código ainda serve. */
  it('acha pelo começo do código de barras', () => {
    expect(nomes(buscarProdutos(CARDAPIO, '789894293'))).toContain('MONSTER TRADICIONAL 473ML UNIDADE');
  });

  it('espaço sobrando não atrapalha', () => {
    expect(nomes(buscarProdutos(CARDAPIO, '  gelo   coco '))).toContain('GELO DE COCO TRADICIONAL');
  });
});

describe('a ordem — o que resolve a lista de 13 Monsters', () => {
  /*
   * ESTE É O PONTO DA MUDANÇA. "monster" devolve quatro produtos aqui (treze na
   * loja real). Sem ranking, a ordem é a do banco e o que a pessoa quer fica no
   * meio — ela rola, não acha, e digita mais.
   */
  it('quem COMEÇA com o digitado vem antes de quem só contém', () => {
    const r = nomes(buscarProdutos(CARDAPIO, 'monster'));
    /*
     * OS DOIS MONSTER DE VERDADE ANTES DOS DOIS DOCES "DIPLOKO ... MONSTER".
     *
     * Qual dos dois Monster vem primeiro NÃO é afirmado aqui de propósito: os
     * dois começam com a palavra digitada e são igualmente bons para quem
     * digitou só "monster". Fixar um deles seria transformar um desempate
     * arbitrário (nome mais curto) em promessa — e o teste quebraria no dia em
     * que o lojista renomeasse um produto, sem nada ter piorado.
     */
    expect(r.slice(0, 2).sort()).toEqual([
      'MONSTER MANGO LOKO 473ML UNIDADE',
      'MONSTER TRADICIONAL 473ML UNIDADE',
    ]);
    expect(r.indexOf('DIPLOKO MONSTER NEON 10G')).toBeGreaterThan(1);
  });

  /*
   * NA ORDEM DIGITADA VALE MAIS QUE FORA DELA. "monster tradicional" descreve o
   * produto; "tradicional monster" é a mesma intenção com menos certeza — e
   * quando as duas leituras existem no cardápio, a primeira tem que vir antes.
   *
   * Medido pela pontuação e não pela lista: com um cardápio pequeno as duas
   * caem no mesmo lugar por outros critérios, e o teste passaria com a regra
   * removida (foi o que a sabotagem mostrou).
   */
  it('as palavras na ordem digitada pontuam melhor', () => {
    const baly = CARDAPIO.find(p => p.nome === 'BALY MAÇA VERDE 473ML')!;
    expect(pontuar(baly, 'maca verde')).toBe(2);
    expect(pontuar(baly, 'verde maca')).toBe(3);
  });

  /*
   * CÓDIGO EXATO VENCE CÓDIGO QUE SÓ COMEÇA IGUAL. Importa quando um código
   * curto é começo de vários: quem digitou o código inteiro já decidiu.
   */
  it('código exato vem antes de código que só começa igual', () => {
    const lista: ProdutoBuscavel[] = [
      { id: 1, nome: 'OUTRO', codigo_barras: '7898942930003', variacao_erp: 1 },
      { id: 2, nome: 'ESSE', codigo_barras: '789894293', variacao_erp: 2 },
    ];
    expect(pontuar(lista[1], '789894293')).toBe(0);
    expect(pontuar(lista[0], '789894293')).toBe(0.5);
    expect(buscarProdutos(lista, '789894293')[0].nome).toBe('ESSE');
  });

  /* Digitando mais, o alvo aparece sozinho — é o que o ranking precisa
     garantir: cada letra a mais estreita, nunca embaralha. */
  it('digitar mais uma palavra resolve', () => {
    expect(nomes(buscarProdutos(CARDAPIO, 'monster trad'))[0])
      .toBe('MONSTER TRADICIONAL 473ML UNIDADE');
  });

  /* Entre dois que começam igual, o nome mais curto é o mais específico. */
  it('empate desempata pelo nome mais curto', () => {
    const r = nomes(buscarProdutos(CARDAPIO, 'diploko'));
    expect(r[0]).toBe('DIPLOKO MONSTER NEON 10G');
  });

  /*
   * QUEM TEM SKU VEM PRIMEIRO: é o único que baixa estoque no Maxx Gestão, e é
   * exatamente por isso que alguém abriu este seletor.
   */
  it('produto com SKU vem antes de produto sem', () => {
    const lista: ProdutoBuscavel[] = [
      { id: 1, nome: 'COPO TESTE', variacao_erp: 0 },
      { id: 2, nome: 'COPO TESTE', variacao_erp: 500 },
    ];
    expect(buscarProdutos(lista, 'copo')[0].id).toBe(2);
  });

  /* A categoria ainda acha, mas por último: "energéticos" é uma rede larga. */
  it('casar pela categoria vale menos que casar pelo nome', () => {
    const r = nomes(buscarProdutos(CARDAPIO, 'energeticos'));
    expect(r.length).toBeGreaterThan(0);
    expect(pontuar(CARDAPIO[0], 'energeticos')).toBe(4);
    expect(pontuar(CARDAPIO[0], 'monster')).toBe(1);
  });
});

describe('o que a busca NÃO pode fazer', () => {
  /* Número curto não pode virar busca por código: "2" (de "2L") casaria com o
     SKU 2 de um salgadinho qualquer. */
  it('um dígito não vira busca por código', () => {
    const lista: ProdutoBuscavel[] = [{ id: 1, nome: 'SALGADINHO', variacao_erp: 2 }];
    expect(buscarProdutos(lista, '2')).toEqual([]);
  });

  it('o que não casa fica de fora', () => {
    expect(buscarProdutos(CARDAPIO, 'xxxxx')).toEqual([]);
  });

  /* Busca vazia devolve a lista inteira (até o teto): é o estado em que o
     painel abre, e lista vazia ali pareceria loja sem produto. */
  it('sem busca, devolve tudo até o teto', () => {
    expect(buscarProdutos(CARDAPIO, '', 3)).toHaveLength(3);
    expect(buscarProdutos(CARDAPIO, '')).toHaveLength(CARDAPIO.length);
  });

  it('o teto é respeitado', () => {
    expect(buscarProdutos(CARDAPIO, 'monster', 2)).toHaveLength(2);
  });
});

describe('normalizar', () => {
  it('tira acento, caixa e espaço sobrando', () => {
    expect(normalizar('  MAÇÃ   Verde ')).toBe('maca verde');
    expect(normalizar('Energéticos')).toBe('energeticos');
  });
});

/* ───────────────────── a ligação com a tela ───────────────────── */

const TELA = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'produtos.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const LOJISTA = fs.readFileSync(path.join(__dirname, 'rotas', 'lojista.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('a tela usa a busca nova', () => {
  it('o seletor de vínculo e o campo de adicionar usam a mesma função', () => {
    expect(TELA).toContain("import { buscarProdutos } from '@/lib/busca-produto'");
    expect(TELA).toContain('buscarProdutos(vinculaveis, buscaVinculo, 40)');
    expect(TELA).toContain('buscarProdutos(vinculaveis ?? [], digitado, 6)');
  });

  /*
   * SUGESTÃO SÓ EM GRUPO QUE BAIXA ESTOQUE. Em grupo de borda de pizza, uma
   * lista de produtos caindo embaixo do campo seria ruído em cima de ruído.
   */
  it('a sugestão depende do grupo baixar estoque', () => {
    expect(TELA).toContain('const sugerir = !!grupo.baixa_estoque && digitado.trim().length >= 2');
  });

  /*
   * CRIAR JÁ VINCULADO. Sem isto era buscar o mesmo produto duas vezes: uma
   * para digitar o nome, outra no seletor depois — e no meio a opção existia
   * sem vínculo, que é o estado marcado como pendência.
   */
  it('escolher a sugestão cria a opção já vinculada', () => {
    expect(TELA).toContain('criarOpcao(grupo.id, achados[0])');
    expect(TELA).toContain('criarOpcao(grupo.id, pr)');
    expect(TELA).toContain('...(doProduto ? { produto_id: doProduto.id } : {})');
  });

  /* O nome vem do PRODUTO, não do que estava digitado: o campo pode estar com
     "mons" quando a pessoa clica na sugestão. */
  it('o nome da opção é o do produto escolhido', () => {
    expect(TELA).toContain('const nome = doProduto ? doProduto.nome : f.nome.trim()');
  });

  /* A conferência de loja na criação é a mesma do PUT: id de outra empresa
     gravado aqui faria o estoque DELA cair a cada pedido daqui. */
  it('a rota de criar confere a loja do produto', () => {
    const i = LOJISTA.indexOf("router.post('/grupos/:id/opcoes'");
    const corpo = LOJISTA.slice(i, LOJISTA.indexOf('\n});', i));
    expect(corpo).toContain('FROM produtos WHERE id = ? AND loja_id = ? AND excluido = 0');
    expect(corpo).toContain('produtoVinculado');
  });

  /* O código de barras precisa VIR do servidor, senão a busca por etiqueta não
     tem contra o que comparar. */
  it('o servidor manda o código de barras na lista', () => {
    const i = LOJISTA.indexOf("router.get('/produtos-vinculaveis'");
    const corpo = LOJISTA.slice(i, LOJISTA.indexOf('\n});', i));
    expect(corpo).toContain('codigo_barras');
  });
});
