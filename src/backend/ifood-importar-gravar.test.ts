import { describe, it, expect } from 'vitest';
import {
  importarCardapio, grupoParaNosso, PRECO_INICIAL_CENTAVOS,
  type DepsImportar, type ProdutoParaGravar,
} from './ifood-importar-gravar';
import type { ProdutoImportado, GrupoImportado } from './ifood-importar';

const prod = (nome: string, codigo = '', grupos: GrupoImportado[] = []): ProdutoImportado => ({
  nome, descricao: 'desc', codigoExterno: codigo, precoIfoodCentavos: 2990,
  disponivel: true, fotoUrl: '', grupos,
});

const grupo = (nome: string, min = 0, max = 2): GrupoImportado => ({
  nome, codigoExterno: 'G1', min, max,
  opcoes: [{ nome: 'Bacon', codigoExterno: 'O1', precoCentavos: 500, disponivel: true }],
});

function montar(over: Partial<DepsImportar> = {}) {
  const criados: ProdutoParaGravar[] = [];
  const grupos: Array<{ produtoId: number; nome: string }> = [];
  const opcoes: Array<{ grupoId: number; nome: string }> = [];
  let seq = 100;
  const deps: DepsImportar = {
    produtosPorCodigo: over.produtosPorCodigo ?? (async () => new Map()),
    criarProduto: over.criarProduto ?? (async (_l, p) => { criados.push(p); return ++seq; }),
    criarGrupo: over.criarGrupo ?? (async (pid, g) => { grupos.push({ produtoId: pid, nome: g.nome }); return ++seq; }),
    criarOpcao: over.criarOpcao ?? (async (gid, o) => { opcoes.push({ grupoId: gid, nome: o.nome }); }),
    registrar: over.registrar,
  };
  return { deps, criados, grupos, opcoes };
}

describe('importarCardapio — preço e disponibilidade', () => {
  it('cria com preço ZERO e PAUSADO', async () => {
    /*
     * As duas coisas juntas, e é deliberado: preço zero à venda é comida de
     * graça. Zerar sem pausar trocaria "margem errada" por "prejuízo direto".
     */
    const { deps, criados } = montar();
    await importarCardapio(1, [prod('X-Bacon', 'XB-001')], 'iFood', deps);
    expect(criados[0]).toMatchObject({ precoCentavos: 0, disponivel: false });
    expect(PRECO_INICIAL_CENTAVOS).toBe(0);
  });

  it('pausa mesmo quando está À VENDA no iFood', async () => {
    const { deps, criados } = montar();
    await importarCardapio(1, [{ ...prod('X', 'X1'), disponivel: true }], 'iFood', deps);
    expect(criados[0].disponivel).toBe(false);
  });

  it('devolve a lista de quem precisa de preço', async () => {
    /* A tela usa isto para dizer ao lojista o que falta antes de vender. */
    const { deps } = montar();
    const r = await importarCardapio(1, [prod('A', 'A1'), prod('B', 'B1')], 'iFood', deps);
    expect(r.semPreco).toEqual(['A', 'B']);
  });

  it('o código externo vai para o código de barras', async () => {
    /* É por ele que o PEDIDO do iFood vai casar com o produto — a lacuna que
       deixou os itens do pedido #85 com produto_id nulo. */
    const { deps, criados } = montar();
    await importarCardapio(1, [prod('X-Bacon', 'XB-001')], 'iFood', deps);
    expect(criados[0].codigoBarras).toBe('XB-001');
  });
});

describe('importarCardapio — não duplicar', () => {
  it('pula o que já existe pelo código', async () => {
    const { deps, criados } = montar({ produtosPorCodigo: async () => new Map([['XB-001', 42]]) });
    const r = await importarCardapio(1, [prod('X-Bacon', 'XB-001')], 'iFood', deps);
    expect(criados).toHaveLength(0);
    expect(r).toMatchObject({ criados: 0, pulados: 1 });
  });

  it('dois itens com o MESMO código viram um produto só', async () => {
    /* A checagem é refeita durante a gravação, não só no plano: entre a prévia
       e a confirmação o lojista pode ter clicado duas vezes. */
    const { deps, criados } = montar();
    const r = await importarCardapio(1, [prod('A', 'X1'), prod('B', 'X1')], 'iFood', deps);
    expect(criados).toHaveLength(1);
    expect(r.pulados).toBe(1);
  });

  it('produtos sem código NÃO se anulam entre si', async () => {
    /* Código vazio não é chave: dois produtos sem código são dois produtos. */
    const { deps, criados } = montar();
    await importarCardapio(1, [prod('A'), prod('B')], 'iFood', deps);
    expect(criados).toHaveLength(2);
  });

  it('produto sem nome é pulado', async () => {
    const { deps, criados } = montar();
    const r = await importarCardapio(1, [prod('')], 'iFood', deps);
    expect(criados).toHaveLength(0);
    expect(r.pulados).toBe(1);
  });
});

describe('importarCardapio — complementos', () => {
  it('cria grupo e opções ligados ao produto', async () => {
    const { deps, grupos, opcoes } = montar();
    await importarCardapio(1, [prod('X', 'X1', [grupo('Adicionais')])], 'iFood', deps);
    expect(grupos[0].nome).toBe('Adicionais');
    expect(opcoes[0].nome).toBe('Bacon');
  });

  it('grupo que falha NÃO desfaz o produto', async () => {
    /*
     * Produto sem um complemento é um produto incompleto que o lojista corrige
     * em dois cliques. Desfazer tudo obrigaria a reimportar e correr o risco de
     * duplicar.
     */
    const { deps, criados } = montar({ criarGrupo: async () => { throw new Error('grupo falhou'); } });
    const r = await importarCardapio(1, [prod('X', 'X1', [grupo('Adicionais')])], 'iFood', deps);
    expect(criados).toHaveLength(1);
    expect(r.criados).toBe(1);
    expect(r.falhas.join(' ')).toContain('grupo falhou');
  });

  it('produto que falha não impede os outros', async () => {
    let n = 0;
    const { deps } = montar({
      criarProduto: async () => { if (++n === 1) throw new Error('banco cheio'); return 200; },
    });
    const r = await importarCardapio(1, [prod('A', 'A1'), prod('B', 'B1')], 'iFood', deps);
    expect(r.criados).toBe(1);
    expect(r.falhas.join(' ')).toContain('banco cheio');
  });

  it('lista vazia não chama nada', async () => {
    const { deps, criados } = montar();
    const r = await importarCardapio(1, [], 'iFood', deps);
    expect(criados).toHaveLength(0);
    expect(r).toMatchObject({ criados: 0, pulados: 0 });
  });
});

describe('grupoParaNosso', () => {
  it('min > 0 vira OBRIGATÓRIO', () => {
    /* Lá o mínimo é número, aqui é interruptor. Perder isso faz um grupo
       obrigatório entrar como opcional, e o cliente fecha o pedido sem
       escolher o que a loja exige. */
    expect(grupoParaNosso(grupo('G', 1, 2)).obrigatorio).toBe(true);
    expect(grupoParaNosso(grupo('G', 0, 2)).obrigatorio).toBe(false);
  });

  it('max > 1 vira MÚLTIPLO', () => {
    /* Igualar tudo a 'unico' faria o cliente não conseguir pedir dois
       adicionais num grupo que aceita dois. */
    expect(grupoParaNosso(grupo('G', 0, 2)).tipo).toBe('multiplo');
    expect(grupoParaNosso(grupo('G', 0, 1)).tipo).toBe('unico');
  });

  it('maxEscolhas nunca é zero', () => {
    /* Zero significaria "não pode escolher nada" num grupo que existe para
       escolher. */
    expect(grupoParaNosso(grupo('G', 0, 0)).maxEscolhas).toBe(1);
  });
});
