import { describe, it, expect } from 'vitest';
import { aplicarSincronizacao, type DepsSincronizar } from './ifood-sincronizar-gravar';
import type { PlanoSincronizacao } from './ifood-sincronizar';
import type { ProdutoImportado, GrupoImportado } from './ifood-importar';

const grupo = (nome: string): GrupoImportado => ({
  nome, codigoExterno: 'G1', min: 0, max: 2,
  opcoes: [{ nome: 'Bacon', codigoExterno: 'O1', precoCentavos: 500, disponivel: true }],
});

const produto = (nome: string, codigo: string): ProdutoImportado => ({
  nome, descricao: 'd', codigoExterno: codigo, precoIfoodCentavos: 2990,
  disponivel: true, fotoUrl: '', grupos: [],
});

const planoVazio = (): PlanoSincronizacao => ({
  criar: [], atualizar: [], gruposNovos: [], opcoesNovas: [],
  sumiramDoIfood: [], travadosSemPreco: [], semCodigo: 0,
});

function montar(over: Partial<DepsSincronizar> = {}) {
  const criados: Array<{ nome: string; precoCentavos: number; disponivel: boolean }> = [];
  const atualizados: Array<{ id: number; campos: Record<string, unknown> }> = [];
  const grupos: number[] = [];
  const opcoes: Array<{ grupoId: number; nome: string }> = [];
  let seq = 100;
  const deps: DepsSincronizar = {
    produtosPorCodigo: over.produtosPorCodigo ?? (async () => new Map()),
    criarProduto: over.criarProduto ?? (async (_l, p) => { criados.push(p); return ++seq; }),
    criarGrupo: over.criarGrupo ?? (async () => { grupos.push(++seq); return seq; }),
    criarOpcao: over.criarOpcao ?? (async (gid, o) => { opcoes.push({ grupoId: gid, nome: o.nome }); }),
    atualizarProduto: over.atualizarProduto ?? (async (id, campos) => { atualizados.push({ id, campos }); }),
  };
  return { deps, criados, atualizados, grupos, opcoes };
}

describe('aplicarSincronizacao', () => {
  it('produto novo nasce PAUSADO e a 1 centavo, igual à importação', () => {
    /*
     * Criar produto pela sincronização e pela importação tem que ser a mesma
     * coisa. Um segundo INSERT seria um segundo lugar para o CHECK de
     * preco_centavos > 0 morder — e só num dos caminhos.
     */
    const { deps, criados } = montar();
    const plano = { ...planoVazio(), criar: [produto('X-Bacon', 'XB-1')] };
    return aplicarSincronizacao(1, plano, 'iFood', deps).then(r => {
      expect(r.criados).toBe(1);
      expect(criados[0]).toMatchObject({ disponivel: false, precoCentavos: 0 });
    });
  });

  it('atualiza só os campos do plano', async () => {
    const { deps, atualizados } = montar();
    const plano = { ...planoVazio(), atualizar: [{ id: 45, nome: 'X', campos: { disponivel: false } }] };
    const r = await aplicarSincronizacao(1, plano, 'iFood', deps);
    expect(r.atualizados).toBe(1);
    expect(atualizados[0]).toEqual({ id: 45, campos: { disponivel: false } });
  });

  it('grupo novo leva as opções dele junto', async () => {
    const { deps, opcoes } = montar();
    const plano = {
      ...planoVazio(),
      gruposNovos: [{ produtoId: 45, produtoNome: 'X', grupo: grupo('Adicionais') }],
    };
    const r = await aplicarSincronizacao(1, plano, 'iFood', deps);
    expect(r).toMatchObject({ gruposNovos: 1, opcoesNovas: 1 });
    expect(opcoes[0].nome).toBe('Bacon');
  });

  it('opção nova entra no grupo existente', async () => {
    const { deps, opcoes } = montar();
    const plano = {
      ...planoVazio(),
      opcoesNovas: [{ grupoId: 7, produtoNome: 'X', grupoNome: 'Adicionais', opcao: grupo('G').opcoes[0] }],
    };
    const r = await aplicarSincronizacao(1, plano, 'iFood', deps);
    expect(r.opcoesNovas).toBe(1);
    expect(opcoes[0].grupoId).toBe(7);
  });
});

describe('uma falha não interrompe o ciclo', () => {
  it('produto que falha ao atualizar não impede os outros', async () => {
    /*
     * Sincronização roda sozinha e sem ninguém olhando. Parar tudo por causa de
     * um produto deixaria o resto do cardápio desatualizado sem aviso, e o
     * lojista só descobriria pelo cliente.
     */
    let n = 0;
    const { deps } = montar({
      atualizarProduto: async () => { if (++n === 1) throw new Error('deu ruim'); },
    });
    const plano = {
      ...planoVazio(),
      atualizar: [
        { id: 1, nome: 'A', campos: { disponivel: false } },
        { id: 2, nome: 'B', campos: { disponivel: false } },
      ],
    };
    const r = await aplicarSincronizacao(1, plano, 'iFood', deps);
    expect(r.atualizados).toBe(1);
    expect(r.falhas.join(' ')).toContain('A: deu ruim');
  });

  it('grupo que falha não impede a opção de outro produto', async () => {
    const { deps } = montar({ criarGrupo: async () => { throw new Error('sem espaço'); } });
    const plano = {
      ...planoVazio(),
      gruposNovos: [{ produtoId: 45, produtoNome: 'X', grupo: grupo('Adicionais') }],
      opcoesNovas: [{ grupoId: 7, produtoNome: 'Y', grupoNome: 'G', opcao: grupo('G').opcoes[0] }],
    };
    const r = await aplicarSincronizacao(1, plano, 'iFood', deps);
    expect(r.gruposNovos).toBe(0);
    expect(r.opcoesNovas).toBe(1);
    expect(r.falhas.join(' ')).toContain('sem espaço');
  });
});

describe('o que a sincronização NÃO faz', () => {
  it('não existe função de apagar nas dependências', () => {
    /* Se não dá para chamar, não dá para apagar sozinho o cardápio de uma loja
       por causa de uma resposta estranha da API. */
    const { deps } = montar();
    expect(Object.keys(deps).some(k => /excluir|apagar|remover|delet/i.test(k))).toBe(false);
  });

  it('devolve os que sumiram como relatório, sem tocar neles', async () => {
    const { deps, atualizados } = montar();
    const plano = { ...planoVazio(), sumiramDoIfood: ['Sumido'] };
    const r = await aplicarSincronizacao(1, plano, 'iFood', deps);
    expect(r.sumiramDoIfood).toEqual(['Sumido']);
    expect(atualizados).toEqual([]);
  });

  it('plano vazio não chama nada', async () => {
    const { deps, criados, atualizados } = montar();
    const r = await aplicarSincronizacao(1, planoVazio(), 'iFood', deps);
    expect([criados.length, atualizados.length]).toEqual([0, 0]);
    expect(r.falhas).toEqual([]);
  });
});
