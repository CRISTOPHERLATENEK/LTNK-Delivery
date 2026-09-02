import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  planejarImportacao, planoVazio, resumoDoPlano, PRECO_MARCADOR, peneirarPorCatalogo,
  type ItemDoCatalogo, type ProdutoNosso,
} from './maxxgestao-importar';
import { produtoDoErp, segundosEstimados, todasAsPaginas, categoriaDoProduto, LETRAS_VARREDURA } from './maxxgestao-catalogo';

const doErp = (variacao: number, descricao: string, extra: Partial<ItemDoCatalogo['produto']> = {}): ItemDoCatalogo => ({
  categoria: 'Lanches',
  produto: {
    variacao, mercadoria: variacao, descricao,
    descricaoAdicional: '', codigoBarras: '', ncm: '', cest: '', ativo: true, referencia: '',
    ...extra,
  },
});

const nosso = (id: number, nome: string, extra: Partial<ProdutoNosso> = {}): ProdutoNosso => ({
  id, nome, descricao: '', categoria: 'Lanches', variacaoErp: id, disponivel: true,
  /* Por padrão já precificado: o caso do marcador é escrito explicitamente nos
     testes que tratam dele, para não passar sem alguém ver. */
  precoCentavos: 1500, sku: '', ...extra,
});

describe('produto novo entra pausado e sem preço de verdade', () => {
  it('o que não existe aqui vai para criar', () => {
    const p = planejarImportacao([doErp(10, 'X-Bacon')], []);
    expect(p.criar).toEqual([{
      variacao: 10, nome: 'X-Bacon', descricao: '', categoria: 'Lanches',
      codigoBarras: '', precoCentavos: PRECO_MARCADOR, sku: '',
    }]);
  });

  it('o resumo avisa do preço junto do sucesso', () => {
    /*
     * O aviso vai na mesma frase, não numa tela de ajuda: o produto entra a
     * R$ 0,01 e pausado, e quem acabou de importar é exatamente quem precisa
     * saber disso. Um centavo é visivelmente errado de propósito — qualquer
     * valor plausível passaria batido e seria vendido por esse valor.
     */
    const resumo = resumoDoPlano(planejarImportacao([doErp(10, 'X-Bacon')], []));
    expect(resumo).toMatch(/R\$ 0,01/);
    expect(resumo).toMatch(/pausad/i);
  });
});

describe('nunca mexe no preço', () => {
  it('NÃO sobrescreve preço que gente definiu', () => {
    /*
     * A REGRA MAIS IMPORTANTE DO ARQUIVO. Preço de delivery costuma ser
     * diferente do balcão; se a reimportação pudesse escrever por cima, ela
     * desfaria o trabalho de quem precificou o cardápio inteiro — e ninguém
     * relacionaria as duas coisas.
     */
    const p = planejarImportacao(
      [{ ...doErp(11, 'Açaí'), precoCentavos: 900 }],
      [nosso(11, 'Açaí', { precoCentavos: 1500 })],
    );
    expect(p.atualizar).toEqual([]);
    expect(p.semMudanca).toBe(1);
  });

  it('preenche o preço quando o nosso ainda é o marcador', () => {
    /* É o que conserta os 1.116 produtos que já entraram a R$ 0,01 — sem fechar
       a porta para quem precificou. */
    const p = planejarImportacao(
      [{ ...doErp(11, 'Açaí'), precoCentavos: 900 }],
      [nosso(11, 'Açaí', { precoCentavos: PRECO_MARCADOR })],
    );
    expect(p.atualizar).toEqual([{ id: 11, precoCentavos: 900 }]);
  });

  it('marcador continuando marcador não gera update', () => {
    /* ERP sem preço para o produto: nada a escrever, e um UPDATE que grava 1 em
       cima de 1 é ruído no "o que mexeram ontem?". */
    const p = planejarImportacao(
      [doErp(11, 'Açaí')],
      [nosso(11, 'Açaí', { precoCentavos: PRECO_MARCADOR })],
    );
    expect(p.atualizar).toEqual([]);
  });

  it('preço zero ou negativo do ERP não vira preço', () => {
    /* Preço zero não é preço: fica no marcador, que grita "me preencha". */
    for (const bruto of [0, -100]) {
      const p = planejarImportacao(
        [{ ...doErp(11, 'Açaí'), precoCentavos: bruto }],
        [nosso(11, 'Açaí', { precoCentavos: PRECO_MARCADOR })],
      );
      expect(p.atualizar, String(bruto)).toEqual([]);
    }
    expect(planejarImportacao([{ ...doErp(10, 'Novo'), precoCentavos: 0 }], [])
      .criar[0].precoCentavos).toBe(PRECO_MARCADOR);
  });
});

describe('nunca apaga: o que saiu do catálogo é pausado', () => {
  it('vinculado que desapareceu do ERP entra em pausar', () => {
    /* Excluir levaria embora o histórico de pedidos que aponta para o produto. */
    const p = planejarImportacao([], [nosso(11, 'Açaí')]);
    expect(p.pausar).toEqual([11]);
    expect(JSON.stringify(p)).not.toMatch(/excluir|apagar|delete/i);
  });

  it('produto que nasceu no delivery NÃO é tocado', () => {
    /*
     * A regressão que apagaria o cardápio de uma loja: sem esta condição, a
     * primeira importação pausaria todo produto que o lojista montou à mão,
     * porque nenhum deles está no catálogo do ERP.
     */
    const p = planejarImportacao([], [nosso(50, 'Combo da casa', { variacaoErp: 0 })]);
    expect(p.pausar).toEqual([]);
    expect(planoVazio(p)).toBe(true);
  });

  it('já pausado não é pausado de novo', () => {
    /* UPDATE à toa por importação, em cardápio grande, é ruído no log e no
       "o que mexeram ontem?". */
    const p = planejarImportacao([], [nosso(11, 'Açaí', { disponivel: false })]);
    expect(p.pausar).toEqual([]);
  });

  it('inativo no ERP pausa o que já existia aqui', () => {
    /* Ignorar deixaria à venda no app um produto que a loja desativou no
       sistema dela — e o motivo seria procurado no lugar errado. */
    const p = planejarImportacao([doErp(11, 'Açaí', { ativo: false })], [nosso(11, 'Açaí')]);
    expect(p.pausar).toEqual([11]);
    expect(p.criar).toEqual([]);
  });

  it('inativo no ERP que nunca entrou aqui não cria nada', () => {
    const p = planejarImportacao([doErp(10, 'Fora de linha', { ativo: false })], []);
    expect(planoVazio(p)).toBe(true);
  });
});

describe('só o que mudou vai no update', () => {
  it('nome, descrição e categoria diferentes viram update', () => {
    const p = planejarImportacao(
      [{ categoria: 'Bebidas', produto: { ...doErp(11, 'Açaí 500ml').produto, descricaoAdicional: 'com granola' } }],
      [nosso(11, 'Açaí', { descricao: '', categoria: 'Lanches' })],
    );
    expect(p.atualizar).toEqual([{ id: 11, nome: 'Açaí 500ml', descricao: 'com granola', categoria: 'Bebidas' }]);
  });

  it('igual não gera update, e é contado', () => {
    /*
     * Mandar todos os campos sempre faria a data de alteração do cardápio
     * inteiro mudar a cada importação, e aí "o que mexeram ontem?" deixa de ter
     * resposta.
     */
    const p = planejarImportacao([doErp(11, 'Açaí')], [nosso(11, 'Açaí')]);
    expect(p.atualizar).toEqual([]);
    expect(p.semMudanca).toBe(1);
    expect(planoVazio(p)).toBe(true);
    expect(resumoDoPlano(p)).toMatch(/nada mudou/i);
  });

  it('categoria vazia do ERP não apaga a nossa', () => {
    /* Catálogo sem categoria não é ordem para desorganizar o cardápio. */
    const p = planejarImportacao(
      [{ categoria: '', produto: doErp(11, 'Açaí').produto }],
      [nosso(11, 'Açaí', { categoria: 'Bebidas' })],
    );
    expect(p.atualizar).toEqual([]);
  });
});

describe('a tradução do produto do ERP', () => {
  it('sem codigoMercadoriaVariacao não entra', () => {
    /*
     * O vínculo é o que o documento fiscal exige em `idMercadoriaVariacao`.
     * Importar produto sem ele criaria um item de cardápio que derruba a emissão
     * no dia da venda — longe daqui, e sem pista do motivo.
     */
    expect(produtoDoErp({ descricao: 'Sem vínculo' })).toBeNull();
    expect(produtoDoErp({ codigoMercadoriaVariacao: 0, descricao: 'Zero' })).toBeNull();
  });

  it('sem descrição não entra', () => {
    expect(produtoDoErp({ codigoMercadoriaVariacao: 10, descricao: '   ' })).toBeNull();
  });

  it('lê o que interessa e traduz o ativo S/N', () => {
    /* `ativo` deles é 'S'/'N', não booleano — tratar 'N' como verdadeiro (por
       ser string não vazia) publicaria produto desativado. */
    const p = produtoDoErp({
      codigoMercadoriaVariacao: 10, codigoMercadoria: 7, descricao: '  X-Bacon  ',
      descricaoAdicional: 'artesanal', codigoBarras: '789', ncm: '2106.90.90',
      cest: '17.001.00', ativo: 'N', referenciaVariacao: 'SKU-9',
    });
    expect(p).toEqual({
      variacao: 10, mercadoria: 7, descricao: 'X-Bacon', descricaoAdicional: 'artesanal',
      codigoBarras: '789', ncm: '2106.90.90', cest: '17.001.00', ativo: false,
      referencia: 'SKU-9',
    });
  });

  it('sem o campo ativo, assume ativo', () => {
    /* Ausência não é negação: assumir inativo esconderia o cardápio inteiro. */
    expect(produtoDoErp({ codigoMercadoriaVariacao: 10, descricao: 'X' })?.ativo).toBe(true);
  });
});

describe('a paginação e o tempo', () => {
  it('percorre até hasNext virar falso', async () => {
    const paginas = [
      { page: 1, limit: 2, total: 3, totalPages: 2, hasNext: true, items: [1, 2] },
      { page: 2, limit: 2, total: 3, totalPages: 2, hasNext: false, items: [3] },
    ];
    expect(await todasAsPaginas(async p => paginas[p - 1])).toEqual([1, 2, 3]);
  });

  it('página vazia encerra na PRIMEIRA, mesmo com hasNext verdadeiro', async () => {
    /*
     * `hasNext` sempre verdadeiro existe, e sem esta saída o laço vai até o teto
     * de páginas consumindo as 20 requisições do minuto à toa.
     *
     * A CONTAGEM É O TESTE. A primeira versão só verificava que o resultado era
     * lista vazia — e continuava passando com a saída removida, porque 200
     * páginas vazias também somam lista vazia. Teste que não falha quando o
     * código quebra não é teste.
     */
    let chamadas = 0;
    const vazio = await todasAsPaginas(async () => {
      chamadas++;
      return { page: 1, limit: 10, total: 99, totalPages: 9, hasNext: true, items: [] };
    });
    expect(vazio).toEqual([]);
    expect(chamadas).toBe(1);
  });

  it('o teto de páginas segura hasNext eternamente verdadeiro', async () => {
    let chamadas = 0;
    await todasAsPaginas(async () => {
      chamadas++;
      return { page: 1, limit: 1, total: 9e9, totalPages: 9e9, hasNext: true, items: [1] };
    }, 5);
    expect(chamadas).toBe(5);
  });

  it('estima o tempo por PÁGINA, não por produto', () => {
    /*
     * A conta mudou junto com o endpoint. A listagem devolve 50 produtos por
     * requisição, então 137 produtos são 3 requisições — não 137. A primeira
     * versão disto media o caminho errado (o do catálogo, que devolve só ids) e
     * prometia sete minutos para o que leva segundos.
     */
    expect(segundosEstimados(0)).toBe(0);
    expect(segundosEstimados(137)).toBe(0);
    /* Cem por página: só passa a esperar acima de 20 requisições, ou seja acima
       de dois mil produtos numa varredura. */
    expect(segundosEstimados(100 * 20)).toBe(0);
    expect(segundosEstimados(100 * 21)).toBe(3);
  });

  it('a categoria vem do subgrupo, e cai no grupo', () => {
    /* Nesta conta o grupo é "Restaurantes" para tudo, enquanto o subgrupo
       separa SALGADINHOS, DOCES, CONSERVAS — que é o que serve de categoria. */
    const mapas = { subgrupos: new Map([[2, 'SALGADINHOS']]), grupos: new Map([[6, 'Restaurantes']]) };
    expect(categoriaDoProduto({ idSubgrupo: 2, idGrupo: 6 }, mapas)).toBe('SALGADINHOS');
    expect(categoriaDoProduto({ idSubgrupo: 99, idGrupo: 6 }, mapas)).toBe('Restaurantes');
    expect(categoriaDoProduto({}, mapas)).toBe('');
  });
});

describe('a varredura por letra', () => {
  it('não pausa nada quando a lista está incompleta', () => {
    /*
     * A LEITURA VEM EM PEDAÇOS. Num pedaço, "não apareceu" significa "ainda não
     * chegou a vez" — pausar aí tiraria do ar metade do cardápio a cada
     * importação, e o lojista descobriria pelo cliente reclamando.
     */
    const p = planejarImportacao([], [nosso(11, 'Açaí')], { pausarAusentes: false });
    expect(p.pausar).toEqual([]);
  });

  it('com a lista completa, pausa como antes', () => {
    /* O padrão continua sendo pausar: quem chama em pedaços é que desliga. */
    expect(planejarImportacao([], [nosso(11, 'Açaí')]).pausar).toEqual([11]);
    expect(planejarImportacao([], [nosso(11, 'Açaí')], {}).pausar).toEqual([11]);
  });

  it('são poucas letras, e começam por a', () => {
    /*
     * O NÚMERO VEIO DE MEDIÇÃO, não de intuição. Na conta real (1.108
     * mercadorias): `a` traz 1.044, e `a` + `e` dão 1.111 únicos — o catálogo
     * inteiro. A terceira é folga.
     *
     * E cada letra a mais custa UM MINUTO, porque só cabem 20 requisições por
     * minuto e uma letra gasta 11. A versão anterior tinha quinze letras:
     * quinze minutos para não trazer nada além do que duas já trazem.
     */
    expect(LETRAS_VARREDURA[0]).toBe('a');
    expect(LETRAS_VARREDURA).toContain('e');
    expect(LETRAS_VARREDURA.length).toBeLessThanOrEqual(4);
  });

  it('a estimativa conta páginas de 100, não produtos', () => {
    /* A busca devolve até 100 por página — 500 é recusado e volta 100, então
       pedir mais só esconderia o número real de páginas. */
    expect(segundosEstimados(1108)).toBe(0);
    expect(segundosEstimados(100 * 21)).toBe(3);
  });
});

describe('o encanamento do preço até o banco', () => {
  /*
   * A camada de gravação não tem teste de unidade (precisa de MySQL), então a
   * ligação entre o plano e o SQL fica coberta por leitura da fonte. Não é
   * elegante, mas pega o caso real: sabotei o `deps` removendo a escrita do
   * preço e TODOS os testes continuaram passando — o plano estava certo e o
   * banco ignorava, que é a pior combinação, porque a tela diria "atualizado".
   */
  const fonte = fs.readFileSync(path.join(__dirname, 'maxxgestao-importar-deps.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('o INSERT grava o preço que veio no plano, não um literal', () => {
    /* `VALUES (?, ?, ?, ?, 1, ...)` era a versão antiga: todo produto nascia a
       um centavo, mesmo com preço no ERP. */
    expect(fonte).toContain('p.precoCentavos');
    expect(fonte).not.toMatch(/VALUES \(\?, \?, \?, \?, 1,/);
  });

  it('o UPDATE grava o preço quando o plano manda', () => {
    expect(fonte).toContain("sets.push('preco_centavos = ?')");
    expect(fonte).toContain('a.precoCentavos !== undefined');
  });

  it('o produto continua nascendo PAUSADO, mesmo com preço', () => {
    /*
     * Publicar 1.100 produtos na loja de alguém porque uma importação rodou
     * seria decidir pelo lojista o que ele vende — e ele descobriria pelo
     * cliente pedindo.
     */
    expect(fonte).toMatch(/disponivel, disponivel_pdv[\s\S]{0,120}0, 0,/);
  });

  it('o produto lido do banco traz o preço, senão a regra do marcador não funciona', () => {
    expect(fonte).toContain('preco_centavos');
    expect(fonte).toContain('precoCentavos: Number(l.preco_centavos');
  });
});

describe('a peneira do catálogo', () => {
  /*
   * A varredura por letra traz a empresa INTEIRA (1.108 mercadorias na conta
   * real); o catálogo diz quais entram. Peneirar aqui e não na leitura porque
   * ler por catálogo custaria uma requisição por produto — 820 itens a 20 por
   * minuto é quarenta minutos.
   */
  const tres = [doErp(1, 'Coca'), doErp(2, 'Gás P13'), doErp(3, 'X-Bacon')];

  it('deixa passar só quem está no catálogo', () => {
    const so = peneirarPorCatalogo(tres, new Set([1, 3]));
    expect(so.map(i => i.produto.descricao)).toEqual(['Coca', 'X-Bacon']);
  });

  it('conjunto vazio devolve tudo', () => {
    /* "Catálogo sem itens" e "não filtrar" são situações diferentes; quem chama
       só passa o conjunto quando escolheu um catálogo de verdade. */
    expect(peneirarPorCatalogo(tres, new Set()).length).toBe(3);
  });

  it('catálogo com id que não existe aqui não inventa produto', () => {
    expect(peneirarPorCatalogo(tres, new Set([99]))).toEqual([]);
  });

  it('a rota NÃO pausa quando um catálogo foi escolhido', () => {
    /*
     * Produto de outro catálogo, importado antes, apareceria como "ausente" e
     * seria pausado: importar um cardápio tiraria o outro do ar. Pausar só faz
     * sentido quando a referência é a empresa inteira.
     */
    const fonte = fs.readFileSync(path.join(__dirname, 'rotas', 'lojista.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(fonte).toContain('terminou && catalogoPedido === 0 && existentes.size > 0');
  });

  it('a meta de cobertura é o catálogo, não a empresa', () => {
    /* Esperar 1.118 numa importação de 820 varreria letra atrás de letra para
       sempre, cada uma custando um minuto. */
    const fonte = fs.readFileSync(path.join(__dirname, 'rotas', 'lojista.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(fonte).toContain('catalogoPedido > 0 ? idsCatalogo.size : existentes.size');
  });

  it('trocar de catálogo invalida o rascunho guardado', () => {
    /* Peneirar o lote 2 por outro catálogo misturaria dois cardápios. */
    const fonte = fs.readFileSync(path.join(__dirname, 'rotas', 'lojista.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(fonte).toContain('(guardado.catalogo ?? 0) !== catalogoPedido');
  });
});

describe('o código interno (SKU)', () => {
  /*
   * NÃO É O IDENTIFICADOR DA NOTA. O documento exige
   * `mercadoriaLista[].idMercadoriaVariacao`, que é a chave da mercadoria no
   * ERP — e é por ele que as tributações (NCM, CEST, CFOP, perfil tributário)
   * são resolvidas LÁ, sem viajarem no nosso pedido.
   *
   * A referência é para gente reconhecer o produto. No cadastro conferido ela
   * vem vazia em todos os itens; fica lida porque o dia em que for preenchida
   * ninguém vai lembrar de voltar aqui.
   */
  it('a referência da variação tem prioridade sobre a da mercadoria', () => {
    expect(produtoDoErp({
      codigoMercadoriaVariacao: 1, descricao: 'X',
      referenciaMercadoria: 'MERC', referenciaVariacao: 'VAR',
    })?.referencia).toBe('VAR');
    expect(produtoDoErp({
      codigoMercadoriaVariacao: 1, descricao: 'X', referenciaMercadoria: 'MERC',
    })?.referencia).toBe('MERC');
  });

  it('entra no produto novo', () => {
    const p = planejarImportacao([doErp(10, 'X', { referencia: 'SKU-1' })], []);
    expect(p.criar[0].sku).toBe('SKU-1');
  });

  it('atualiza quando muda', () => {
    const p = planejarImportacao(
      [doErp(11, 'X', { referencia: 'NOVO' })],
      [nosso(11, 'X', { sku: 'VELHO' })],
    );
    expect(p.atualizar).toEqual([{ id: 11, sku: 'NOVO' }]);
  });

  it('referência VAZIA no ERP não apaga a nossa', () => {
    /*
     * Campo em branco lá não é ordem para apagar aqui. Se alguém preencheu o
     * código interno no nosso cadastro, uma importação levaria embora — e o
     * cadastro do ERP está com esse campo vazio em TODOS os produtos, então
     * seria o caso comum, não a exceção.
     */
    const p = planejarImportacao(
      [doErp(11, 'X', { referencia: '' })],
      [nosso(11, 'X', { sku: 'MEU-SKU' })],
    );
    expect(p.atualizar).toEqual([]);
    expect(p.semMudanca).toBe(1);
  });

  it('igual não gera update', () => {
    const p = planejarImportacao(
      [doErp(11, 'X', { referencia: 'IGUAL' })],
      [nosso(11, 'X', { sku: 'IGUAL' })],
    );
    expect(p.atualizar).toEqual([]);
  });

  it('o banco grava o SKU nas duas operações', () => {
    const fonte = fs.readFileSync(path.join(__dirname, 'maxxgestao-importar-deps.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(fonte).toContain('p.sku');
    expect(fonte).toContain("sets.push('sku = ?')");
  });
});
