import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  precoParaCentavos, precoParaImportar, traduzirItem, planejarImportacao,
  type ProdutoImportado,
} from './ifood-importar';

/*
 * ITEM REAL, não exemplo da documentação.
 *
 * Criado no catálogo de sandbox e lido de volta pelo `/flat`. A documentação
 * desta API já errou cinco vezes seguidas — caminho de escrita, campo
 * obrigatório ausente, posição dos grupos, referência do grupo e o
 * `optionGroupType`. Escrever contra ela seria repetir o erro da etapa 3.
 */
const REAL = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'ifood-item-flat.json'), 'utf8'),
);

describe('precoParaCentavos', () => {
  it('lê o objeto {value} que o iFood usa', () => {
    expect(precoParaCentavos({ value: 29.9 })).toBe(2990);
    expect(precoParaCentavos({ value: 5 })).toBe(500);
  });

  it('aceita número direto também', () => {
    expect(precoParaCentavos(4)).toBe(400);
  });

  it('arredonda, não trunca', () => {
    expect(precoParaCentavos({ value: 5.1 })).toBe(510);
  });

  it('ausente ou negativo é zero, não NaN', () => {
    for (const v of [undefined, null, {}, 'x', { value: -3 }]) {
      expect(precoParaCentavos(v)).toBe(0);
    }
  });
});

describe('precoParaImportar', () => {
  it('é sempre null — o preço do iFood NÃO entra no cardápio próprio', () => {
    /*
     * O lojista sobe o preço no iFood para absorver a comissão. Trazer esse
     * valor faz o cliente que compra no link da loja pagar uma comissão que
     * ali não existe — e ninguém percebe, porque o número parece certo.
     *
     * Função e não constante para quem for mudar isso esbarrar no motivo.
     */
    expect(precoParaImportar()).toBeNull();
  });
});

describe('traduzirItem — contra o item real', () => {
  const p = traduzirItem(REAL)!;

  it('lê o produto principal, não o das opções', () => {
    /* O payload tem TRÊS produtos: o item e os dois complementos. O principal
       é o apontado por `item.productId`. */
    expect(p.nome).toBe('X-Bacon Artesanal');
    expect(p.descricao).toContain('brioche');
  });

  it('guarda o código externo, que é como o PEDIDO casa depois', () => {
    /* É a lacuna que motivou tudo isto: os itens do pedido #85 entraram com
       produto_id nulo porque o externalCode não batia com nada aqui. */
    expect(p.codigoExterno).toBe('XB-001');
  });

  it('lê o preço do iFood como referência', () => {
    expect(p.precoIfoodCentavos).toBe(2990);
  });

  it('monta o grupo de complementos', () => {
    expect(p.grupos).toHaveLength(1);
    expect(p.grupos[0]).toMatchObject({ nome: 'Adicionais', min: 0, max: 2 });
  });

  it('resolve o nome da opção pelo PRODUTO dela', () => {
    /* A opção sozinha só tem id, preço e status — o nome está no produto que
       ela aponta. Sem essa segunda busca, o complemento entraria sem nome. */
    expect(p.grupos[0].opcoes.map(o => o.nome)).toEqual(['Bacon extra', 'Cheddar']);
    expect(p.grupos[0].opcoes.map(o => o.precoCentavos)).toEqual([500, 400]);
  });

  it('respeita a ORDEM de optionIds', () => {
    expect(p.grupos[0].opcoes[0].codigoExterno).toBe('OPT-BACON');
  });
});

describe('traduzirItem — min/max vêm do PRODUTO', () => {
  it('usa o limite da referência dentro do produto, não o do grupo', () => {
    /*
     * O mesmo grupo pode servir a vários produtos com limites diferentes:
     * "Adicionais" até 2 num lanche e até 5 noutro. Ler do grupo faria o
     * limite de um produto vazar para o outro.
     */
    const flat = {
      item: { productId: 'p1', price: { value: 10 }, status: 'AVAILABLE' },
      products: [{ id: 'p1', name: 'Lanche', externalCode: 'L1',
                   optionGroups: [{ id: 'g1', min: 1, max: 5 }] },
                 { id: 'po', name: 'Queijo' }],
      optionGroups: [{ id: 'g1', name: 'Add', min: 0, max: 2, optionIds: ['o1'] }],
      options: [{ id: 'o1', productId: 'po', price: { value: 2 }, status: 'AVAILABLE' }],
    };
    expect(traduzirItem(flat)!.grupos[0]).toMatchObject({ min: 1, max: 5 });
  });

  it('grupo que o produto NÃO referencia fica de fora', () => {
    /* O payload pode trazer grupos usados por outros itens. Importar todos
       encheria o produto de complementos que ele não tem. */
    const flat = {
      item: { productId: 'p1', price: { value: 10 } },
      products: [{ id: 'p1', name: 'Lanche', optionGroups: [] }, { id: 'po', name: 'Queijo' }],
      optionGroups: [{ id: 'g1', name: 'De outro item', optionIds: ['o1'] }],
      options: [{ id: 'o1', productId: 'po', price: { value: 2 } }],
    };
    expect(traduzirItem(flat)!.grupos).toEqual([]);
  });

  it('grupo sem opção legível não vira grupo', () => {
    /* No nosso cadastro apareceria como pergunta sem resposta possível. */
    const flat = {
      item: { productId: 'p1', price: { value: 10 } },
      products: [{ id: 'p1', name: 'Lanche', optionGroups: [{ id: 'g1', min: 0, max: 1 }] }],
      optionGroups: [{ id: 'g1', name: 'Add', optionIds: ['fantasma'] }],
      options: [],
    };
    expect(traduzirItem(flat)!.grupos).toEqual([]);
  });

  it('sem produto principal, devolve null em vez de linha em branco', () => {
    /* Criar produto sem nome é pior que pular: entra no cardápio como uma
       linha que ninguém sabe de onde veio. */
    expect(traduzirItem({ item: { productId: 'sumiu' }, products: [] })).toBeNull();
    expect(traduzirItem({})).toBeNull();
  });

  it('item pausado no iFood vem marcado como indisponível', () => {
    const flat = {
      item: { productId: 'p1', price: { value: 10 }, status: 'UNAVAILABLE' },
      products: [{ id: 'p1', name: 'Lanche' }],
    };
    expect(traduzirItem(flat)!.disponivel).toBe(false);
  });
});

describe('planejarImportacao', () => {
  const prod = (nome: string, codigo: string): ProdutoImportado => ({
    nome, descricao: '', codigoExterno: codigo, precoIfoodCentavos: 1000,
    disponivel: true, fotoUrl: '', grupos: [],
  });

  it('separa o que é novo do que já existe', () => {
    const plano = planejarImportacao(
      [prod('X-Bacon', 'XB-001'), prod('Coca', 'CC-001')],
      new Map([['XB-001', 42]]),
    );
    expect(plano.novos.map(p => p.nome)).toEqual(['Coca']);
    expect(plano.jaExistem[0]).toMatchObject({ produtoId: 42 });
  });

  it('casa pelo CÓDIGO, nunca pelo nome', () => {
    /*
     * "X-Bacon" e "X Bacon" são o mesmo produto para uma pessoa e produtos
     * diferentes para uma comparação de texto. Errar duplicando é reversível
     * na mão; errar mesclando sobrescreve o cadastro que o lojista já tinha.
     */
    const plano = planejarImportacao([prod('X-Bacon', 'NOVO')], new Map([['XB-001', 42]]));
    expect(plano.novos).toHaveLength(1);
  });

  it('item SEM código externo fica numa lista própria', () => {
    /* Ele PODE já existir aqui e não temos como saber. Tratar como novo
       duplicaria em silêncio; quem decide é o lojista, olhando. */
    const plano = planejarImportacao([prod('Sem código', '')], new Map());
    expect(plano.semCodigo).toHaveLength(1);
    expect(plano.novos).toHaveLength(0);
  });

  it('código repetido DENTRO do iFood não vira dois produtos', () => {
    const plano = planejarImportacao([prod('A', 'X1'), prod('B', 'X1')], new Map());
    expect(plano.novos).toHaveLength(1);
    expect(plano.jaExistem).toHaveLength(1);
  });

  it('item sem nome é ignorado', () => {
    const plano = planejarImportacao([prod('', 'X1')], new Map());
    expect(plano.novos).toHaveLength(0);
  });

  it('lista vazia não quebra', () => {
    expect(planejarImportacao([], new Map())).toEqual({ novos: [], jaExistem: [], semCodigo: [] });
  });
});
