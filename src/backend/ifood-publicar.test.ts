import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  montarPayloadItem, planejarPublicacao, centavosParaPreco, PRECO_NAO_DEFINIDO_CENTAVOS,
  type ProdutoDaqui,
} from './ifood-publicar';

/** Item REAL do sandbox, lido pelo /flat. Nunca um exemplo da documentação. */
const FLAT = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'ifood-item-flat.json'), 'utf8'),
) as Record<string, unknown>;

const CAT = '01e62082-c53f-42ec-83b8-0729ce27aa5f';

const nosso = (over: Partial<ProdutoDaqui> = {}): ProdutoDaqui => ({
  id: 45,
  nome: 'X-Bacon Artesanal',
  descricao: 'Pao brioche, hamburguer 180g, bacon e queijo',
  codigoBarras: 'XB-001',
  precoCentavos: 2990,
  disponivel: true,
  grupos: [{
    nome: 'Adicionais', codigoExterno: 'GRP-ADIC', obrigatorio: false, maxEscolhas: 2,
    opcoes: [
      { nome: 'Bacon extra', codigoExterno: 'OPT-BACON', precoAdicionalCentavos: 500, disponivel: true },
    ],
  }],
  ...over,
});

describe('o PUT não pode apagar o que não conhecemos', () => {
  it('preserva contextModifiers do item', () => {
    /*
     * A regra mais cara desta API: `PUT /items` SUBSTITUI o item completo, e
     * campo omitido é campo removido. `contextModifiers` carrega o preço do
     * Cardápio Digital — um payload "limpo" montado do nosso banco funciona no
     * teste e apaga o preço de outro canal em produção.
     */
    const p = montarPayloadItem(nosso(), CAT, FLAT);
    const item = p.item as Record<string, unknown>;
    expect(item.contextModifiers).toEqual((FLAT.item as Record<string, unknown>).contextModifiers);
  });

  it('preserva o productId do item', () => {
    /*
     * Obrigatório e NÃO documentado — descoberto depois de o POST responder
     * "PostProductDto is not valid" sem dizer o que faltava. Perdê-lo criaria
     * um produto novo a cada publicação, deixando órfãos no catálogo da loja.
     */
    const p = montarPayloadItem(nosso(), CAT, FLAT);
    expect((p.item as Record<string, unknown>).productId)
      .toBe((FLAT.item as Record<string, unknown>).productId);
  });

  it('preserva campo que este arquivo nem sabe que existe', () => {
    /*
     * O teste que importa de verdade: a proteção não é uma lista de campos
     * conhecidos, é copiar o que veio. Assim o que a API adicionar amanhã
     * sobrevive sem ninguém lembrar de vir aqui.
     */
    const comNovidade = {
      ...FLAT,
      item: { ...(FLAT.item as object), campoQueInventaramDepois: 'não perca isto' },
    };
    const p = montarPayloadItem(nosso(), CAT, comNovidade);
    expect((p.item as Record<string, unknown>).campoQueInventaramDepois).toBe('não perca isto');
  });

  it('preserva o id do grupo e das opções que já existem', () => {
    /* Id novo a cada publicação faria o iFood tratar como grupo diferente e o
       cliente veria o complemento duplicado. */
    const p = montarPayloadItem(nosso(), CAT, FLAT);
    const grupos = p.optionGroups as Array<Record<string, unknown>>;
    const originais = FLAT.optionGroups as Array<Record<string, unknown>>;
    expect(grupos[0].id).toBe(originais[0].id);
  });
});

describe('os nossos campos entram', () => {
  it('nome, descrição e código vão para o produto principal', () => {
    const p = montarPayloadItem(nosso({ nome: 'Novo Nome' }), CAT, FLAT);
    const produtos = p.products as Array<Record<string, unknown>>;
    expect(produtos[0]).toMatchObject({ name: 'Novo Nome', externalCode: 'XB-001' });
  });

  it('preço vai em decimal, não em centavos', () => {
    const p = montarPayloadItem(nosso({ precoCentavos: 1999 }), CAT, FLAT);
    expect((p.item as { price: { value: number } }).price.value).toBe(19.99);
  });

  it('pausado aqui vira UNAVAILABLE lá', () => {
    const p = montarPayloadItem(nosso({ disponivel: false }), CAT, FLAT);
    expect((p.item as Record<string, unknown>).status).toBe('UNAVAILABLE');
  });

  it('grupo obrigatório vira min 1', () => {
    /* Lá o obrigatório não é interruptor: é o mínimo ser maior que zero. */
    const g = nosso().grupos[0];
    const p = montarPayloadItem(nosso({ grupos: [{ ...g, obrigatorio: true }] }), CAT, FLAT);
    expect((p.optionGroups as Array<Record<string, unknown>>)[0].min).toBe(1);
  });

  it('o grupo carrega optionGroupType, que nenhum exemplo mostra', () => {
    /* Sem ele o grupo é recusado — descoberto criando o item de teste. */
    const p = montarPayloadItem(nosso(), CAT, FLAT);
    expect((p.optionGroups as Array<Record<string, unknown>>)[0].optionGroupType).toBe('DEFAULT');
  });

  it('os grupos ficam na RAIZ, e o produto os referencia por id', () => {
    /*
     * Não dentro do item, como a documentação e o assistente do iFood sugerem.
     * Foi o que fez o item de teste finalmente ser aceito.
     */
    const p = montarPayloadItem(nosso(), CAT, FLAT);
    expect(Array.isArray(p.optionGroups)).toBe(true);
    expect((p.item as Record<string, unknown>).optionGroups).toBeUndefined();
    const produtos = p.products as Array<Record<string, unknown>>;
    const grupos = p.optionGroups as Array<Record<string, unknown>>;
    /*
     * A referência é OBJETO, não id. Mandar `[id]` responde
     * `FullItemDto is not valid` — sem dizer o que está errado. O formato saiu
     * do item REAL lido pelo /flat, e é o que fez o item com complemento ser
     * finalmente aceito.
     */
    expect(produtos[0].optionGroups).toEqual([
      { id: grupos[0].id, min: 0, max: 2, index: 0 },
    ]);
  });
});

describe('item que ainda não existe lá', () => {
  it('monta sem explodir quando não há nada para preservar', () => {
    const p = montarPayloadItem(nosso(), CAT, null);
    expect((p.item as Record<string, unknown>).categoryId).toBe(CAT);
    expect((p.products as unknown[]).length).toBeGreaterThan(0);
  });

  it('produto sem complemento gera lista de grupos vazia, não ausente', () => {
    /* Ausente seria "não mexi nos grupos"; vazia é "não tem grupo". Num PUT que
       substitui, a diferença é o cardápio certo ou complementos fantasmas. */
    const p = montarPayloadItem(nosso({ grupos: [] }), CAT, null);
    expect(p.optionGroups).toEqual([]);
    expect(p.options).toEqual([]);
  });
});

describe('centavosParaPreco', () => {
  it('não devolve dízima', () => {
    /* 1999/100 dá 19.990000000000002 em ponto flutuante, e o iFood receberia um
       preço com doze casas. */
    expect(centavosParaPreco(1999)).toBe(19.99);
    expect(centavosParaPreco(2990)).toBe(29.9);
    expect(centavosParaPreco(0)).toBe(0);
  });
});

describe('planejarPublicacao', () => {
  const daqui = (nome: string, codigo: string) => nosso({ nome, codigoBarras: codigo });

  it('separa o que existe lá do que não existe', () => {
    const plano = planejarPublicacao(
      [daqui('A', 'A-1'), daqui('B', 'B-1')],
      new Map([['A-1', 'item-a']]),
    );
    expect(plano.atualizar).toHaveLength(1);
    expect(plano.atualizar[0].itemId).toBe('item-a');
    expect(plano.criar.map(p => p.nome)).toEqual(['B']);
  });

  it('produto sem código fica de fora e é reportado', () => {
    /*
     * Sem chave, a única alternativa seria casar por nome — e um nome parecido
     * publicaria por cima do item errado, do lado onde o cliente compra.
     */
    const plano = planejarPublicacao([daqui('Sem código', '  ')], new Map());
    expect([plano.criar.length, plano.atualizar.length]).toEqual([0, 0]);
    expect(plano.semCodigo).toEqual(['Sem código']);
  });

  it('o que só existe lá vira relatório, nunca exclusão', () => {
    /* Mesma decisão da sincronização e pelo mesmo motivo: isto roda sozinho, e
       cardápio apagado no domingo à noite não tem desfazer. */
    const plano = planejarPublicacao([], new Map([['ORFAO-1', 'item-x']]));
    expect(plano.soExistemNoIfood).toEqual(['ORFAO-1']);
    expect(JSON.stringify(plano)).not.toMatch(/excluir|apagar|remover/i);
  });
});

describe('não publicar produto sem preço', () => {
  it('produto com o preço-marcador da importação NÃO vai', () => {
    /*
     * Pego no primeiro ensaio contra a API real: o X-Bacon, importado do iFood
     * e ainda sem preço aqui, seria publicado de volta a R$ 0,01 — desta vez
     * para o lado onde o cliente compra de verdade.
     */
    const plano = planejarPublicacao(
      [nosso({ nome: 'X-Bacon', codigoBarras: 'XB-001', precoCentavos: PRECO_NAO_DEFINIDO_CENTAVOS })],
      new Map([['XB-001', 'item-a']]),
    );
    expect(plano.atualizar).toEqual([]);
    expect(plano.criar).toEqual([]);
    expect(plano.semPreco).toEqual(['X-Bacon']);
  });

  it('e não é reportado como órfão do iFood', () => {
    /* Ele existe lá e continua lá, intacto. Chamá-lo de órfão mandaria o
       lojista procurar um problema que não existe. */
    const plano = planejarPublicacao(
      [nosso({ codigoBarras: 'XB-001', precoCentavos: PRECO_NAO_DEFINIDO_CENTAVOS })],
      new Map([['XB-001', 'item-a']]),
    );
    expect(plano.soExistemNoIfood).toEqual([]);
  });

  it('preço de verdade passa normalmente', () => {
    const plano = planejarPublicacao(
      [nosso({ codigoBarras: 'XB-001', precoCentavos: 2 })],
      new Map([['XB-001', 'item-a']]),
    );
    expect(plano.atualizar).toHaveLength(1);
    expect(plano.semPreco).toEqual([]);
  });
});

describe('os ids são gerados por quem chama', () => {
  const idsFalsos = () => { let n = 0; return () => `id-${++n}`; };

  it('item NOVO recebe id e productId', () => {
    /*
     * Descoberto publicando de verdade: item novo sem id responde
     * `FullItemDto is not valid`, sem dizer o que falta. É o sétimo caso em que
     * esta API exige algo que a documentação não mostra.
     */
    const p = montarPayloadItem(nosso({ grupos: [] }), CAT, null, idsFalsos());
    const item = p.item as Record<string, unknown>;
    expect(item.id).toBe('id-1');
    expect(item.productId).toBe('id-2');
    expect((p.products as Array<Record<string, unknown>>)[0].id).toBe('id-2');
  });

  it('item que JÁ existe mantém os ids de lá', () => {
    /* Id novo a cada publicação criaria um item duplicado no cardápio da loja
       e deixaria o antigo órfão. */
    const p = montarPayloadItem(nosso(), CAT, FLAT, idsFalsos());
    const item = p.item as Record<string, unknown>;
    expect(item.id).toBe((FLAT.item as Record<string, unknown>).id);
    expect(item.productId).toBe((FLAT.item as Record<string, unknown>).productId);
  });

  it('cada complemento novo ganha o produto dele', () => {
    /* No iFood o complemento também é um produto, e a opção não pode apontar
       para o vazio. */
    const p = montarPayloadItem(nosso(), CAT, null, idsFalsos());
    const opcoes = p.options as Array<Record<string, unknown>>;
    const produtos = p.products as Array<Record<string, unknown>>;
    expect(opcoes[0].productId).toBeDefined();
    expect(produtos.some(x => x.id === opcoes[0].productId)).toBe(true);
  });

  it('nenhum id inventado fora do formato', () => {
    /* Antes disto os grupos novos recebiam `grupo-GRP-ADIC`, que não é UUID e
       a API recusa. */
    const p = montarPayloadItem(nosso(), CAT, null);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(String((p.item as Record<string, unknown>).id)).toMatch(uuid);
    expect(String((p.optionGroups as Array<Record<string, unknown>>)[0].id)).toMatch(uuid);
    expect(String((p.options as Array<Record<string, unknown>>)[0].id)).toMatch(uuid);
  });
});

describe('o formato que a API exige nos complementos', () => {
  it('a referência do grupo repete min, max e index do item real', () => {
    /* Copiado de fixtures/ifood-item-flat.json, não de exemplo da doc. */
    const real = (FLAT.products as Array<Record<string, unknown>>)[0].optionGroups;
    expect(real).toEqual([{ id: expect.any(String), min: 0, max: 2, index: 0 }]);
  });

  it('grupo obrigatório leva min 1 também na referência', () => {
    const g = nosso().grupos[0];
    const p = montarPayloadItem(nosso({ grupos: [{ ...g, obrigatorio: true, maxEscolhas: 1 }] }), CAT, null);
    const ref = (p.products as Array<Record<string, unknown>>)[0].optionGroups as Array<Record<string, unknown>>;
    expect(ref[0]).toMatchObject({ min: 1, max: 1, index: 0 });
  });

  it('a referência e o grupo dizem o MESMO min e max', () => {
    /* Divergir entre os dois é dizer duas coisas na mesma requisição — e a API
       aceita uma delas sem avisar qual. */
    const p = montarPayloadItem(nosso(), CAT, null);
    const ref = ((p.products as Array<Record<string, unknown>>)[0].optionGroups as Array<Record<string, unknown>>)[0];
    const grupo = (p.optionGroups as Array<Record<string, unknown>>)[0];
    expect([ref.min, ref.max]).toEqual([grupo.min, grupo.max]);
  });

  it('o produto do complemento leva optionGroups vazio, não ausente', () => {
    /* O campo existe no item real, vazio. Ausente, o item novo é recusado. */
    const p = montarPayloadItem(nosso(), CAT, null);
    const produtos = p.products as Array<Record<string, unknown>>;
    expect(produtos[1].optionGroups).toEqual([]);
  });
});
