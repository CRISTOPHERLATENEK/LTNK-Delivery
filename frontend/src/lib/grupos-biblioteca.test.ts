/**
 * A REGRA QUE DECIDE SE DOIS GRUPOS PODEM VIRAR UM.
 *
 * Juntar dois grupos que só PARECEM iguais muda preço de cardápio, e preço
 * mudado por engano não tem desfazer — o pedido já saiu. Então a assinatura tem
 * que ser exata nos dois sentidos: não pode deixar passar diferença que importa,
 * e não pode barrar por diferença que não importa (senão a ferramenta nunca
 * serve e o lojista faz na mão, que é onde o erro mora).
 */
import { describe, it, expect } from 'vitest';
import {
  chaveDeNome, assinaturaDoGrupo, saoIdenticos, melhorSobrevivente,
  diferencasEntre, familiasDuplicadas, type GrupoComparavel,
} from './grupos-biblioteca';

const g = (over: Partial<GrupoComparavel> = {}): GrupoComparavel => ({
  id: 1, nome: 'Borda', tipo: 'unico', papel: '', modo_preco: 'somar',
  opcoes: [{ nome: 'Catupiry', preco_adicional_centavos: 500 }],
  ...over,
});

describe('chaveDeNome', () => {
  it('ignora caixa, espaço sobrando e acento', () => {
    expect(chaveDeNome('  Requeijão ')).toBe(chaveDeNome('requeijao'));
    expect(chaveDeNome('Alho  e   Óleo')).toBe('alho e oleo');
  });
});

describe('saoIdenticos', () => {
  it('mesmo cabeçalho e mesmos itens', () => {
    expect(saoIdenticos(g({ id: 1 }), g({ id: 2 }))).toBe(true);
  });

  /*
   * A ORDEM DOS ITENS NÃO CONTA. A ordem em que o cliente vê os sabores é
   * escolha do lojista, mas dois grupos com os mesmos sabores em ordens
   * diferentes são o mesmo grupo — recusar por causa disso seria recusar pelo
   * motivo errado.
   */
  it('ordem diferente dos mesmos itens ainda é idêntico', () => {
    const a = g({ opcoes: [
      { nome: 'Catupiry', preco_adicional_centavos: 500 },
      { nome: 'Cheddar', preco_adicional_centavos: 300 },
    ] });
    const b = g({ id: 2, opcoes: [
      { nome: 'Cheddar', preco_adicional_centavos: 300 },
      { nome: 'Catupiry', preco_adicional_centavos: 500 },
    ] });
    expect(saoIdenticos(a, b)).toBe(true);
  });

  /* ESTE É O QUE PROTEGE O DINHEIRO. */
  it('preço diferente NÃO é idêntico', () => {
    expect(saoIdenticos(g(), g({ id: 2, opcoes: [{ nome: 'Catupiry', preco_adicional_centavos: 700 }] })))
      .toBe(false);
  });

  it('item a mais NÃO é idêntico', () => {
    const b = g({ id: 2, opcoes: [
      { nome: 'Catupiry', preco_adicional_centavos: 500 },
      { nome: 'Cheddar', preco_adicional_centavos: 300 },
    ] });
    expect(saoIdenticos(g(), b)).toBe(false);
  });

  it('seção diferente NÃO é idêntico — muda o que o cliente vê', () => {
    expect(saoIdenticos(
      g({ opcoes: [{ nome: 'Calabresa', preco_adicional_centavos: 0, secao: 'Tradicional' }] }),
      g({ id: 2, opcoes: [{ nome: 'Calabresa', preco_adicional_centavos: 0, secao: 'Especiais' }] }),
    )).toBe(false);
  });

  /* `sabores` decide quantos sabores a pizza aceita — dois tamanhos "Gigante"
     com números diferentes são regras diferentes. */
  it('sabores diferente NÃO é idêntico', () => {
    expect(saoIdenticos(
      g({ opcoes: [{ nome: 'Gigante', preco_adicional_centavos: 0, sabores: 4 }] }),
      g({ id: 2, opcoes: [{ nome: 'Gigante', preco_adicional_centavos: 0, sabores: 2 }] }),
    )).toBe(false);
  });

  it('papel ou política de preço diferente NÃO é idêntico', () => {
    expect(saoIdenticos(g(), g({ id: 2, papel: 'sabores' }))).toBe(false);
    expect(saoIdenticos(g(), g({ id: 2, modo_preco: 'maior' }))).toBe(false);
  });

  /*
   * FOTO E INGREDIENTE NÃO BARRAM. São enriquecimento: dois "Catupiry" a R$ 5,
   * um com foto e outro sem, são o mesmo item. Barrar por isso faria a
   * ferramenta nunca servir pra nada — e a foto não se perde, porque quem tem
   * mais sobrevive.
   */
  it('foto e ingredientes não impedem a mesclagem', () => {
    const comFoto = g({ opcoes: [{
      nome: 'Catupiry', preco_adicional_centavos: 500,
      imagem: '/u/1.jpg', descricao: 'requeijão cremoso',
    }] });
    expect(saoIdenticos(g(), comFoto)).toBe(true);
  });

  it('acento e caixa no nome do item não impedem', () => {
    expect(saoIdenticos(
      g({ opcoes: [{ nome: 'Alho e Óleo', preco_adicional_centavos: 0 }] }),
      g({ id: 2, opcoes: [{ nome: 'alho e oleo', preco_adicional_centavos: 0 }] }),
    )).toBe(true);
  });

  /* Sem itens dos dois lados é idêntico — e é o caso dos três "Tamanho" vazios
     da base real, que dá pra juntar (ou apagar) sem pensar. */
  it('dois grupos vazios de mesmo nome são idênticos', () => {
    expect(saoIdenticos(g({ opcoes: [] }), g({ id: 2, opcoes: [] }))).toBe(true);
  });
});

describe('melhorSobrevivente', () => {
  /* Perder foto de sabor é perder trabalho que alguém fez. */
  it('o mais rico em foto e ingredientes vence', () => {
    const magro = g({ id: 1 });
    const gordo = g({ id: 2, opcoes: [{
      nome: 'Catupiry', preco_adicional_centavos: 500, imagem: '/u/1.jpg', descricao: 'x',
    }] });
    expect(melhorSobrevivente([magro, gordo]).id).toBe(2);
  });

  /* Empate vai pro mais antigo: é o com mais chance de estar referenciado em
     pedido antigo. */
  it('empate vai pro id menor', () => {
    expect(melhorSobrevivente([g({ id: 7 }), g({ id: 3 })]).id).toBe(3);
  });

  it('foto pesa mais que ingrediente', () => {
    const soDescricao = g({ id: 1, opcoes: [
      { nome: 'A', preco_adicional_centavos: 0, descricao: 'x' },
      { nome: 'B', preco_adicional_centavos: 0, descricao: 'y' },
    ] });
    const comFoto = g({ id: 2, opcoes: [
      { nome: 'A', preco_adicional_centavos: 0, imagem: '/1.jpg' },
      { nome: 'B', preco_adicional_centavos: 0, imagem: '/2.jpg' },
    ] });
    expect(melhorSobrevivente([soDescricao, comFoto]).id).toBe(2);
  });
});

/**
 * A diferença existe pro caso que a mesclagem RECUSA — que, numa loja real, é a
 * maioria. Sem ela a tela diria só "não são iguais", e o lojista abriria os dois
 * pra comparar item a item na mão.
 */
describe('diferencasEntre', () => {
  it('lista o que só existe em cada lado', () => {
    const a = g({ opcoes: [
      { nome: 'Catupiry', preco_adicional_centavos: 500 },
      { nome: 'Requeijao', preco_adicional_centavos: 0 },
    ] });
    const b = g({ id: 2, opcoes: [
      { nome: 'Catupiry', preco_adicional_centavos: 500 },
      { nome: 'Cream cheese', preco_adicional_centavos: 0 },
    ] });
    const d = diferencasEntre(a, b);
    expect(d.some(x => x.includes('só no primeiro') && x.includes('Requeijao'))).toBe(true);
    expect(d.some(x => x.includes('só no segundo') && x.includes('Cream cheese'))).toBe(true);
  });

  /* É a diferença que muda o que o cliente paga, e a que ninguém percebe
     olhando só a lista de nomes. */
  it('aponta preço divergente do mesmo item', () => {
    const d = diferencasEntre(g(), g({ id: 2, opcoes: [{ nome: 'Catupiry', preco_adicional_centavos: 700 }] }));
    expect(d.some(x => x.includes('Catupiry') && x.includes('5.00') && x.includes('7.00'))).toBe(true);
  });

  it('aponta papel e cobrança', () => {
    const d = diferencasEntre(g(), g({ id: 2, papel: 'sabores', modo_preco: 'maior' }));
    expect(d.some(x => x.includes('papel'))).toBe(true);
    expect(d.some(x => x.includes('cobrança'))).toBe(true);
  });

  it('idênticos não têm diferença nenhuma', () => {
    expect(diferencasEntre(g({ id: 1 }), g({ id: 2 }))).toEqual([]);
  });
});

/**
 * O caso REAL da base do mostruário: cinco "Tamanho", nenhum par mesclável.
 * A tela precisa listar os cinco mesmo assim — é essa lista que o lojista usa
 * pra escolher qual manter.
 */
describe('familiasDuplicadas', () => {
  it('agrupa por nome e separa os idênticos dentro', () => {
    const grupos = [
      g({ id: 1, nome: 'Tamanho', opcoes: [] }),
      g({ id: 2, nome: 'Tamanho', opcoes: [] }),
      g({ id: 3, nome: 'Tamanho', opcoes: [{ nome: 'P', preco_adicional_centavos: 3000 }] }),
      g({ id: 4, nome: 'Bebida', opcoes: [] }),
    ];
    const fam = familiasDuplicadas(grupos);
    expect(fam).toHaveLength(1);              // 'Bebida' aparece uma vez só
    expect(fam[0].grupos.map(x => x.id)).toEqual([1, 2, 3]);
    expect(fam[0].identicos).toHaveLength(1); // os dois vazios
    expect(fam[0].identicos[0].map(x => x.id)).toEqual([1, 2]);
  });

  it('nome único nunca vira família', () => {
    expect(familiasDuplicadas([g({ id: 1, nome: 'Borda' })])).toEqual([]);
  });

  it('nome igual mas com acento/caixa diferente cai na mesma família', () => {
    const fam = familiasDuplicadas([
      g({ id: 1, nome: 'Adicionais' }),
      g({ id: 2, nome: 'ADICIONAIS' }),
    ]);
    expect(fam).toHaveLength(1);
    expect(fam[0].grupos).toHaveLength(2);
  });

  /* A família maior primeiro: é a que mais suja o cardápio. */
  it('ordena pela quantidade de duplicados', () => {
    const fam = familiasDuplicadas([
      g({ id: 1, nome: 'Borda' }), g({ id: 2, nome: 'Borda' }),
      g({ id: 3, nome: 'Tamanho' }), g({ id: 4, nome: 'Tamanho' }), g({ id: 5, nome: 'Tamanho' }),
    ]);
    expect(fam.map(f => f.nome)).toEqual(['Tamanho', 'Borda']);
  });
});
