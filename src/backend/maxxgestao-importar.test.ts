import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  planejarImportacao, planoVazio, resumoDoPlano,
  type ItemDoCatalogo, type ProdutoNosso,
} from './maxxgestao-importar';
import { produtoDoErp, segundosEstimados, todasAsPaginas, categoriaDoProduto, LETRAS_VARREDURA } from './maxxgestao-catalogo';

const doErp = (variacao: number, descricao: string, extra: Partial<ItemDoCatalogo['produto']> = {}): ItemDoCatalogo => ({
  categoria: 'Lanches',
  produto: {
    variacao, mercadoria: variacao, descricao,
    descricaoAdicional: '', codigoBarras: '', ncm: '', cest: '', ativo: true,
    ...extra,
  },
});

const nosso = (id: number, nome: string, extra: Partial<ProdutoNosso> = {}): ProdutoNosso => ({
  id, nome, descricao: '', categoria: 'Lanches', variacaoErp: id, disponivel: true, ...extra,
});

describe('produto novo entra pausado e sem preço de verdade', () => {
  it('o que não existe aqui vai para criar', () => {
    const p = planejarImportacao([doErp(10, 'X-Bacon')], []);
    expect(p.criar).toEqual([{ variacao: 10, nome: 'X-Bacon', descricao: '', categoria: 'Lanches', codigoBarras: '' }]);
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
  it('o plano não tem campo de preço em lugar nenhum', () => {
    /*
     * A REGRA MAIS IMPORTANTE DO ARQUIVO. O preço mora no delivery; o ERP nem
     * devolve preço de venda. Se uma reimportação pudesse escrever preço, ela
     * desfaria o trabalho de quem precificou o cardápio inteiro — e ninguém
     * relacionaria as duas coisas.
     */
    const p = planejarImportacao(
      [doErp(10, 'X-Bacon'), doErp(11, 'Açaí')],
      [nosso(11, 'Açaí velho')],
    );
    const tudo = JSON.stringify(p);
    expect(tudo).not.toMatch(/preco|price|valor/i);
    for (const c of [...p.criar, ...p.atualizar]) {
      expect(Object.keys(c)).not.toContain('preco_centavos');
    }
  });

  it('a fonte não menciona preço fora dos comentários', () => {
    const fonte = fs.readFileSync(path.join(__dirname, 'maxxgestao-importar.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(fonte).not.toMatch(/preco_centavos/);
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
      descricaoAdicional: 'artesanal', codigoBarras: '789', ncm: '2106.90.90', cest: '17.001.00', ativo: 'N',
    });
    expect(p).toEqual({
      variacao: 10, mercadoria: 7, descricao: 'X-Bacon', descricaoAdicional: 'artesanal',
      codigoBarras: '789', ncm: '2106.90.90', cest: '17.001.00', ativo: false,
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

  it('as letras começam pelas vogais', () => {
    /*
     * Descrição de produto sem vogal praticamente não existe, e a primeira letra
     * já traz a maior parte: na conta conferida, `filtro=a` devolveu 1.034 dos
     * 1.108. Assim uma importação interrompida no meio deixa o cardápio quase
     * completo em vez de aleatório.
     */
    expect(LETRAS_VARREDURA.slice(0, 5)).toEqual(['a', 'e', 'o', 'i', 'u']);
    /* Dígitos existem para nomes numéricos ("3 CORACOES"). */
    expect(LETRAS_VARREDURA).toContain('3');
  });

  it('a estimativa conta páginas de 100, não produtos', () => {
    /* A busca devolve até 100 por página — 500 é recusado e volta 100, então
       pedir mais só esconderia o número real de páginas. */
    expect(segundosEstimados(1108)).toBe(0);
    expect(segundosEstimados(100 * 21)).toBe(3);
  });
});
