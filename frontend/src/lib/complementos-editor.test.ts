import { describe, it, expect } from 'vitest';
import {
  ingredientesDeTexto, textoDeIngredientes, comIngredientes,
  fraseDaRegra, linhasColadas, limiteDeSabores, rotuloTeto,
} from './complementos-editor';

describe('ingredientes: ida e volta entre chip e campo', () => {
  it('quebra por vírgula, sem sobra de espaço nem item vazio', () => {
    expect(ingredientesDeTexto(' molho , mussarela ,, presunto , ')).toEqual(['molho', 'mussarela', 'presunto']);
  });

  it('campo vazio ou ausente não gera chip nenhum', () => {
    expect(ingredientesDeTexto('')).toEqual([]);
    expect(ingredientesDeTexto(null)).toEqual([]);
    expect(ingredientesDeTexto('  ,  ')).toEqual([]);
  });

  /* É o texto que o CLIENTE lê no app: sem o espaço, "molho,mussarela,ovo" se lê
     como uma palavra só num telefone estreito. */
  it('junta com vírgula E espaço', () => {
    expect(textoDeIngredientes(['molho', 'mussarela'])).toBe('molho, mussarela');
  });

  it('o par não perde nem inventa nada', () => {
    const original = 'molho, mussarela, presunto, ovo';
    expect(textoDeIngredientes(ingredientesDeTexto(original))).toBe(original);
  });
});

describe('comIngredientes', () => {
  it('colar vários de uma vez cria um chip por vírgula', () => {
    expect(comIngredientes([], 'molho, mussarela, presunto'))
      .toEqual(['molho', 'mussarela', 'presunto']);
  });

  /* Chip repetido só polui a linha que o cliente lê. */
  it('não duplica, e ignora a caixa', () => {
    expect(comIngredientes(['Mussarela'], 'mussarela, ovo')).toEqual(['Mussarela', 'ovo']);
  });

  it('rascunho vazio não muda nada', () => {
    expect(comIngredientes(['molho'], '  ,  ')).toEqual(['molho']);
  });

  /*
   * O TETO É O DA COLUNA (160). Cortar aqui é o que evita o caso pior: o MySQL
   * truncando no meio de uma palavra sem ninguém avisar. Para no chip que
   * estouraria, e mantém os que couberam.
   */
  it('para antes de estourar o limite da coluna', () => {
    // Nomes DIFERENTES: iguais cairiam na regra de duplicata e o teste passaria
    // por outro motivo, sem provar nada sobre o limite.
    const g = (letra: string) => letra.repeat(50);
    const r = comIngredientes([], `${g('a')}, ${g('b')}, ${g('c')}, ${g('d')}`);
    expect(r).toHaveLength(3);                                  // 3×50 + 2×", " = 154
    expect(textoDeIngredientes(r).length).toBeLessThanOrEqual(160);
  });
});

/**
 * A frase existe pro lojista ler o que o CLIENTE vai viver. "Obrigatório · até
 * 3" é o nome dos campos; "Precisa escolher de 1 a 3" é o que acontece na tela
 * dele — e é assim que um grupo de tamanho marcado como opcional salta aos
 * olhos, coisa que `obrigatorio: 0` nunca fez.
 */
describe('fraseDaRegra', () => {
  it('obrigatório de escolha única: escolher 1', () => {
    expect(fraseDaRegra({ obrigatorio: 1, tipo: 'unico', max_escolhas: 1 })).toBe('Precisa escolher 1');
  });

  /* `max_escolhas: 1` num grupo múltiplo é escolha única na prática — dizer
     "de 1 a 1" seria correto e ilegível. */
  it('múltiplo com teto 1 fala como escolha única', () => {
    expect(fraseDaRegra({ obrigatorio: 1, tipo: 'multiplo', max_escolhas: 1 })).toBe('Precisa escolher 1');
  });

  it('obrigatório múltiplo com teto: a faixa', () => {
    expect(fraseDaRegra({ obrigatorio: 1, tipo: 'multiplo', max_escolhas: 3 })).toBe('Precisa escolher de 1 a 3');
  });

  it('obrigatório múltiplo SEM teto: ao menos 1', () => {
    expect(fraseDaRegra({ obrigatorio: 1, tipo: 'multiplo', max_escolhas: 0 })).toBe('Precisa escolher ao menos 1');
  });

  it('opcional diz que pode pular, sempre', () => {
    expect(fraseDaRegra({ obrigatorio: 0, tipo: 'unico', max_escolhas: 1 })).toBe('Pode pular · escolhe 1');
    expect(fraseDaRegra({ obrigatorio: 0, tipo: 'multiplo', max_escolhas: 3 })).toBe('Pode pular · até 3 opções');
    expect(fraseDaRegra({ obrigatorio: 0, tipo: 'multiplo', max_escolhas: 0 })).toBe('Pode pular · quantas quiser');
  });

  it('singular e plural batem', () => {
    expect(fraseDaRegra({ obrigatorio: false, tipo: 'multiplo', max_escolhas: 1 })).toContain('escolhe 1');
    expect(fraseDaRegra({ obrigatorio: false, tipo: 'multiplo', max_escolhas: 2 })).toContain('2 opções');
  });

  it('booleano e 0/1 dão o mesmo resultado', () => {
    expect(fraseDaRegra({ obrigatorio: true, tipo: 'unico', max_escolhas: 1 }))
      .toBe(fraseDaRegra({ obrigatorio: 1, tipo: 'unico', max_escolhas: 1 }));
  });
});

describe('linhasColadas', () => {
  it('uma linha por item, preço opcional', () => {
    expect(linhasColadas('Calabresa\nPortuguesa / 5')).toEqual([
      { nome: 'Calabresa', preco: '', secao: '' },
      { nome: 'Portuguesa', preco: '5', secao: '' },
    ]);
  });

  it('[Seção] vale pras linhas seguintes, e troca no meio', () => {
    expect(linhasColadas('[Tradicionais]\nCalabresa\n[Especiais]\nCamarão / 18,50')).toEqual([
      { nome: 'Calabresa', preco: '', secao: 'Tradicionais' },
      { nome: 'Camarão', preco: '18.50', secao: 'Especiais' },
    ]);
  });

  it('vírgula decimal vira ponto — é o que o campo de preço espera', () => {
    expect(linhasColadas('Bacon / 4,90')[0].preco).toBe('4.90');
  });

  it('aceita R$ na frente do valor', () => {
    expect(linhasColadas('Bacon / R$ 4,90')[0].preco).toBe('4.90');
  });

  /*
   * A ÚLTIMA barra manda. "Meia a meia / doce / 8" tem barra no nome; sem isto o
   * nome seria cortado em "Meia a meia" e o preço viria "doce / 8" — inválido, e
   * o item entraria de graça.
   */
  it('barra no nome não engole o preço', () => {
    expect(linhasColadas('Meia a meia / doce / 8')).toEqual([
      { nome: 'Meia a meia / doce', preco: '8', secao: '' },
    ]);
  });

  /* Barra sem número depois é parte do nome, não preço vazio. */
  it('barra sem valor fica no nome', () => {
    expect(linhasColadas('Frango / catupiry')).toEqual([
      { nome: 'Frango / catupiry', preco: '', secao: '' },
    ]);
  });

  it('linha vazia e espaço em branco são ignorados', () => {
    expect(linhasColadas('\n  \nCalabresa\n\n')).toHaveLength(1);
  });

  it('a seção inicial vem de fora (a seção onde o lojista está)', () => {
    expect(linhasColadas('Calabresa', 'Tradicionais')[0].secao).toBe('Tradicionais');
  });

  it('[] vazio zera a seção em vez de criar uma sem nome', () => {
    expect(linhasColadas('[Doces]\nMorango\n[]\nCalabresa').map(i => i.secao))
      .toEqual(['Doces', '']);
  });

  it('texto vazio não gera item', () => {
    expect(linhasColadas('')).toEqual([]);
  });
});

/**
 * O CABEÇALHO NÃO PODE MOSTRAR UM LIMITE QUE NÃO VALE.
 *
 * `maxEscolhasEfetivo` ignora o `max_escolhas` do grupo de sabores sempre que
 * algum tamanho define quantos sabores libera. O cabeçalho mostrava o número do
 * grupo do mesmo jeito: um grupo com 3 dizia "até 3 · Precisa escolher de 1 a 3"
 * numa pizza cujo Gigante libera 4. O cliente escolhe 4, o servidor aceita os 4
 * (é a mesma função), e só a tela do lojista estava errada — o defeito que não
 * dá erro, dá desconfiança.
 */
describe('limiteDeSabores', () => {
  it('a faixa vem dos tamanhos que definem', () => {
    expect(limiteDeSabores([
      { nome: 'Pequena', sabores: 1 },
      { nome: 'Gigante', sabores: 4 },
    ])).toEqual({ min: 1, max: 4, detalhe: 'Pequena 1 · Gigante 4' });
  });

  it('um tamanho só dá min igual a max', () => {
    expect(limiteDeSabores([{ nome: 'Gigante', sabores: 4 }]))
      .toEqual({ min: 4, max: 4, detalhe: 'Gigante 4' });
  });

  /* Só aqui o max_escolhas do grupo volta a valer — e é por isso que o stepper
     continua existindo nesse caso em vez de desaparecer de vez. */
  it('nenhum tamanho definindo devolve null', () => {
    expect(limiteDeSabores([{ nome: 'Único', sabores: 0 }, { nome: 'Outro' }])).toBeNull();
    expect(limiteDeSabores([])).toBeNull();
  });

  /* Em branco NÃO conta como 0: o tamanho não define limite, e um 0 no mínimo
     diria "pode escolher zero sabores", que é o oposto. */
  it('tamanho em branco não entra na faixa', () => {
    expect(limiteDeSabores([
      { nome: 'Broto' },
      { nome: 'Média', sabores: 2 },
      { nome: 'Gigante', sabores: 4 },
    ])).toEqual({ min: 2, max: 4, detalhe: 'Média 2 · Gigante 4' });
  });
});

describe('rotuloTeto', () => {
  /* "até 1" num grupo obrigatório abre a porta pro zero, e obrigatório é
     exatamente um — a frase da regra já dizia certo e o stepper ao lado dizia
     outra coisa. */
  it('obrigatório com teto 1 é exatamente 1, não "até 1"', () => {
    expect(rotuloTeto({ obrigatorio: 1, tipo: 'unico', max_escolhas: 1 })).toBe('exatamente 1');
  });

  it('opcional com teto 1 continua "até 1" — zero é uma saída legítima', () => {
    expect(rotuloTeto({ obrigatorio: 0, tipo: 'unico', max_escolhas: 1 })).toBe('até 1');
  });

  it('teto maior que 1 é "até N", obrigatório ou não', () => {
    expect(rotuloTeto({ obrigatorio: 1, tipo: 'multiplo', max_escolhas: 3 })).toBe('até 3');
    expect(rotuloTeto({ obrigatorio: 0, tipo: 'multiplo', max_escolhas: 3 })).toBe('até 3');
  });

  it('zero é sem limite', () => {
    expect(rotuloTeto({ obrigatorio: 0, tipo: 'multiplo', max_escolhas: 0 })).toBe('sem limite');
  });
});

describe('fraseDaRegra no grupo de sabores', () => {
  const sabores = { obrigatorio: 1 as const, tipo: 'multiplo', max_escolhas: 3, papel: 'sabores' };

  /* O caso exato da base: grupo com max 3, Gigante liberando 4. */
  it('com tamanho definindo, a faixa é do TAMANHO e o max do grupo não aparece', () => {
    const frase = fraseDaRegra(sabores, { min: 4, max: 4 });
    expect(frase).toBe('Precisa escolher · o tamanho define quantos (4)');
    expect(frase).not.toContain('3');
  });

  it('faixa com tamanhos diferentes', () => {
    expect(fraseDaRegra(sabores, { min: 1, max: 4 }))
      .toBe('Precisa escolher · o tamanho define quantos (1 a 4)');
  });

  it('opcional também diz que o tamanho manda', () => {
    expect(fraseDaRegra({ ...sabores, obrigatorio: 0 }, { min: 2, max: 2 }))
      .toBe('Pode pular · o tamanho define quantos (2)');
  });

  /* Sem tamanho definindo, o max do grupo VOLTA a valer — e a frase volta a
     ser a normal, porque aí ela é verdade. */
  it('sem tamanho definindo, cai na regra normal do grupo', () => {
    expect(fraseDaRegra(sabores, null)).toBe('Precisa escolher de 1 a 3');
    expect(fraseDaRegra(sabores)).toBe('Precisa escolher de 1 a 3');
  });

  /* Grupo comum não é afetado nem se alguém passar a faixa por engano. */
  it('grupo sem papel ignora a faixa de sabores', () => {
    expect(fraseDaRegra({ obrigatorio: 1, tipo: 'multiplo', max_escolhas: 2 }, { min: 1, max: 4 }))
      .toBe('Precisa escolher de 1 a 2');
  });
});
