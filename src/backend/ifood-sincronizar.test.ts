import { describe, it, expect } from 'vitest';
import {
  planejarSincronizacao, planoVazio, PRECO_NAO_DEFINIDO_CENTAVOS,
  type ProdutoNosso,
} from './ifood-sincronizar';
import type { ProdutoImportado, GrupoImportado } from './ifood-importar';

const opcao = (nome: string, preco = 500) =>
  ({ nome, codigoExterno: 'O-' + nome, precoCentavos: preco, disponivel: true });

const grupo = (nome: string, opcoes = [opcao('Bacon')]): GrupoImportado =>
  ({ nome, codigoExterno: 'G-' + nome, min: 0, max: 2, opcoes });

const la = (over: Partial<ProdutoImportado> = {}): ProdutoImportado => ({
  nome: 'X-Bacon', descricao: 'com bacon', codigoExterno: 'XB-001',
  precoIfoodCentavos: 2990, disponivel: true, fotoUrl: '', grupos: [], ...over,
});

const aqui = (over: Partial<ProdutoNosso> = {}): ProdutoNosso => ({
  id: 45, nome: 'X-Bacon', descricao: 'com bacon', codigoBarras: 'XB-001',
  precoCentavos: 2500, disponivel: true, grupos: [], ...over,
});

describe('preço NUNCA entra no plano', () => {
  it('preço diferente não gera alteração nenhuma', () => {
    /*
     * O preço do iFood embute a comissão que no link próprio do lojista não
     * existe. Num regime contínuo não adianta "o lojista corrige depois": a
     * cada ciclo voltaria.
     */
    const p = planejarSincronizacao([la({ precoIfoodCentavos: 9999 })], [aqui({ precoCentavos: 2500 })]);
    expect(p.atualizar).toEqual([]);
    expect(JSON.stringify(p)).not.toContain('preco');
  });

  it('preço de complemento também fica de fora', () => {
    const p = planejarSincronizacao(
      [la({ grupos: [grupo('Adicionais', [opcao('Bacon', 9999)])] })],
      [aqui({ grupos: [{ id: 1, nome: 'Adicionais', opcoes: [{ id: 9, nome: 'Bacon' }] }] })],
    );
    expect(p.opcoesNovas).toEqual([]);
    expect(planoVazio(p)).toBe(true);
  });
});

describe('disponibilidade', () => {
  it('pausado lá vira pausado aqui', () => {
    /* É o sinal de "acabou o estoque" — o que mais vale a pena sincronizar. */
    const p = planejarSincronizacao([la({ disponivel: false })], [aqui({ disponivel: true })]);
    expect(p.atualizar[0].campos).toEqual({ disponivel: false });
  });

  it('NÃO coloca à venda um produto que nunca foi precificado', () => {
    /*
     * A importação grava 1 centavo porque o CHECK da coluna exige > 0. Copiar o
     * "disponível" do iFood publicaria um lanche a R$ 0,01 no primeiro ciclo —
     * e ninguém percebe um preço errado tão rápido quanto o cliente que
     * aproveita.
     */
    const p = planejarSincronizacao(
      [la({ disponivel: true })],
      [aqui({ disponivel: false, precoCentavos: PRECO_NAO_DEFINIDO_CENTAVOS })],
    );
    expect(p.atualizar).toEqual([]);
    expect(p.travadosSemPreco).toEqual(['X-Bacon']);
  });

  it('com preço de verdade, despausa', () => {
    const p = planejarSincronizacao([la({ disponivel: true })], [aqui({ disponivel: false, precoCentavos: 2500 })]);
    expect(p.atualizar[0].campos).toEqual({ disponivel: true });
    expect(p.travadosSemPreco).toEqual([]);
  });

  it('pausar não depende de ter preço', () => {
    /* Pausar é sempre seguro; é despausar que vende. */
    const p = planejarSincronizacao(
      [la({ disponivel: false })],
      [aqui({ disponivel: true, precoCentavos: PRECO_NAO_DEFINIDO_CENTAVOS })],
    );
    expect(p.atualizar[0].campos).toEqual({ disponivel: false });
  });
});

describe('nome e descrição', () => {
  it('nome mudado lá é atualizado aqui', () => {
    const p = planejarSincronizacao([la({ nome: 'X-Bacon Artesanal' })], [aqui({ nome: 'X-Bacon' })]);
    expect(p.atualizar[0].campos.nome).toBe('X-Bacon Artesanal');
  });

  it('nome VAZIO lá não apaga o nome daqui', () => {
    /* Produto sem nome some da tela do cliente — e campo vazio vindo da API é
       mais comum do que parece. */
    const p = planejarSincronizacao([la({ nome: '' })], [aqui({ nome: 'X-Bacon' })]);
    expect(p.atualizar).toEqual([]);
  });

  it('descrição vazia lá LIMPA a daqui', () => {
    /* Diferente do nome: descrição em branco é um estado legítimo, e manter uma
       descrição que o lojista apagou lá seria ignorar a direção que ele
       escolheu. */
    const p = planejarSincronizacao([la({ descricao: '' })], [aqui({ descricao: 'antiga' })]);
    expect(p.atualizar[0].campos.descricao).toBe('');
  });

  it('sem diferença, não gera alteração', () => {
    expect(planoVazio(planejarSincronizacao([la()], [aqui()]))).toBe(true);
  });
});

describe('nunca apaga', () => {
  it('produto que sumiu do iFood vira relatório, não exclusão', () => {
    /*
     * Sincronização roda sozinha. Apagar sozinho o cardápio de uma loja por
     * causa de uma resposta estranha da API é um estrago que ninguém desfaz no
     * domingo à noite.
     */
    const p = planejarSincronizacao([], [aqui({ nome: 'Sumido' })]);
    expect(p.sumiramDoIfood).toEqual(['Sumido']);
    expect(JSON.stringify(p)).not.toMatch(/excluir|apagar|remover/i);
  });

  it('opção removida lá não é removida aqui', () => {
    const p = planejarSincronizacao(
      [la({ grupos: [grupo('Adicionais', [opcao('Bacon')])] })],
      [aqui({ grupos: [{ id: 1, nome: 'Adicionais', opcoes: [{ id: 9, nome: 'Bacon' }, { id: 10, nome: 'Cheddar' }] }] })],
    );
    expect(planoVazio(p)).toBe(true);
  });
});

describe('complementos só somam', () => {
  it('grupo novo lá entra aqui', () => {
    const p = planejarSincronizacao([la({ grupos: [grupo('Adicionais')] })], [aqui()]);
    expect(p.gruposNovos).toHaveLength(1);
    expect(p.gruposNovos[0].produtoId).toBe(45);
  });

  it('opção nova entra no grupo que já existe', () => {
    const p = planejarSincronizacao(
      [la({ grupos: [grupo('Adicionais', [opcao('Bacon'), opcao('Cheddar')])] })],
      [aqui({ grupos: [{ id: 7, nome: 'Adicionais', opcoes: [{ id: 9, nome: 'Bacon' }] }] })],
    );
    expect(p.gruposNovos).toEqual([]);
    expect(p.opcoesNovas).toHaveLength(1);
    expect(p.opcoesNovas[0]).toMatchObject({ grupoId: 7, opcao: { nome: 'Cheddar' } });
  });

  it('grupo casa por nome sem ligar para maiúscula e espaço', () => {
    /* Sem isto, "Adicionais" e "adicionais " viram dois grupos e o cliente vê o
       mesmo complemento duas vezes. */
    const p = planejarSincronizacao(
      [la({ grupos: [grupo(' ADICIONAIS ')] })],
      [aqui({ grupos: [{ id: 7, nome: 'Adicionais', opcoes: [{ id: 9, nome: 'Bacon' }] }] })],
    );
    expect(planoVazio(p)).toBe(true);
  });
});

describe('casamento por código', () => {
  it('produto novo no iFood entra para criação', () => {
    const p = planejarSincronizacao([la({ codigoExterno: 'NOVO-1' })], [aqui()]);
    expect(p.criar).toHaveLength(1);
    expect(p.sumiramDoIfood).toEqual(['X-Bacon']);
  });

  it('item sem código é IGNORADO, não casado por nome', () => {
    /*
     * Casar por nome renomearia o produto errado no primeiro nome parecido —
     * e num regime que roda sozinho isso se propaga sem ninguém ver.
     */
    const p = planejarSincronizacao([la({ codigoExterno: '  ' })], [aqui()]);
    expect(p.criar).toEqual([]);
    expect(p.atualizar).toEqual([]);
    expect(p.semCodigo).toBe(1);
  });

  it('produto nosso sem código não conta como sumido', () => {
    /* Produto criado à mão pelo lojista nunca esteve no iFood. */
    const p = planejarSincronizacao([], [aqui({ codigoBarras: '' })]);
    expect(p.sumiramDoIfood).toEqual([]);
  });
});

describe('plano vazio x aviso de preço', () => {
  it('travado sem preço NÃO conta como plano com trabalho', () => {
    /* `planoVazio` responde sobre GRAVAÇÃO. O aviso é outra coisa, e quem
       decide o que fazer com ele é o ciclo — ver ifood-sincronizar-ciclo. */
    const p = planejarSincronizacao(
      [la({ disponivel: true })],
      [aqui({ disponivel: false, precoCentavos: PRECO_NAO_DEFINIDO_CENTAVOS })],
    );
    expect(planoVazio(p)).toBe(true);
    expect(p.travadosSemPreco).toEqual(['X-Bacon']);
  });
});
