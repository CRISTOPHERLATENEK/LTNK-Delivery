import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { numerarOpcoes, resolverDigitado, grupoConcluido } from '../../frontend/src/lib/escolha-rapida';
import { agruparPorSecao } from '../../frontend/src/lib/opcoes-preco';

describe('numerarOpcoes', () => {
  it('numera contínuo entre grupos e slots', () => {
    const r = numerarOpcoes([
      { slot: 0, grupos: [{ id: 7, opcoes: [{ id: 71 }, { id: 72 }] }] },
      { slot: 1, grupos: [{ id: 9, opcoes: [{ id: 91 }] }, { id: 8, opcoes: [{ id: 81 }] }] },
    ]);
    expect(r.map(o => o.numero)).toEqual([1, 2, 3, 4]);
    /* O número tem que carregar o SLOT: com dois slots do mesmo grupo (combo de
       duas pizzas), o id do grupo sozinho não diz em qual pizza aplicar. */
    expect(r[2]).toEqual({ numero: 3, slot: 1, grupoId: 9, opcaoId: 91 });
  });

  it('lista vazia não numera nada', () => {
    expect(numerarOpcoes([])).toEqual([]);
    expect(numerarOpcoes([{ slot: 0, grupos: [] }])).toEqual([]);
  });
});

describe('resolverDigitado', () => {
  /*
   * O CASO QUE FAZ A LISTA COMPACTA VALER A PENA. Com 27 opções, "5" só pode
   * ser o 5 — aplica na hora, uma tecla por opção.
   */
  it('aplica na hora quando não há como crescer', () => {
    expect(resolverDigitado('5', 27)).toEqual({ aplicar: 5, buffer: '' });
    expect(resolverDigitado('9', 27)).toEqual({ aplicar: 9, buffer: '' });
  });

  it('espera o próximo dígito quando ainda pode crescer', () => {
    expect(resolverDigitado('1', 27)).toEqual({ aplicar: null, buffer: '1' });
    expect(resolverDigitado('2', 27)).toEqual({ aplicar: null, buffer: '2' });
    expect(resolverDigitado('12', 27)).toEqual({ aplicar: 12, buffer: '' });
    expect(resolverDigitado('27', 27)).toEqual({ aplicar: 27, buffer: '' });
  });

  /* Com poucas opções, todo dígito é imediato — inclusive o 1. */
  it('lista curta aplica sempre na hora', () => {
    expect(resolverDigitado('1', 4)).toEqual({ aplicar: 1, buffer: '' });
    expect(resolverDigitado('4', 4)).toEqual({ aplicar: 4, buffer: '' });
  });

  /*
   * Fora da lista LIMPA o buffer. Acumular faria o dígito seguinte herdar um
   * buffer inválido, e a próxima tecla também pareceria não funcionar — o
   * atendente conclui que o teclado travou.
   */
  it('fora da lista limpa em vez de acumular', () => {
    expect(resolverDigitado('9', 4)).toEqual({ aplicar: null, buffer: '' });
    expect(resolverDigitado('99', 27)).toEqual({ aplicar: null, buffer: '' });
  });

  it('zero e lixo não travam o buffer', () => {
    expect(resolverDigitado('0', 27)).toEqual({ aplicar: null, buffer: '' });
    expect(resolverDigitado('', 27)).toEqual({ aplicar: null, buffer: '' });
    expect(resolverDigitado('a', 27)).toEqual({ aplicar: null, buffer: '' });
  });

  /* 100 opções: "1" espera, "10" ainda espera (pode ser 100), "100" aplica. */
  it('funciona com três dígitos', () => {
    expect(resolverDigitado('1', 100)).toEqual({ aplicar: null, buffer: '1' });
    expect(resolverDigitado('10', 100)).toEqual({ aplicar: null, buffer: '10' });
    expect(resolverDigitado('100', 100)).toEqual({ aplicar: 100, buffer: '' });
    expect(resolverDigitado('11', 100)).toEqual({ aplicar: 11, buffer: '' });
  });
});

/*
 * A NUMERAÇÃO SEGUE A ORDEM EXIBIDA, NÃO A ORDEM CRUA.
 *
 * `agruparPorSecao` REORDENA: o bloco sem seção vai pra frente, pra uma opção
 * sem seção não cair sob o título "Doces" e ser lida como doce. Se a lista
 * compacta numerar por `g.opcoes` e exibir por seção, o número mostrado ao lado
 * de um sabor aciona OUTRO — e no balcão isso é a pizza errada saindo do forno,
 * sem ninguém perceber onde foi o erro.
 */
describe('numeração x seções', () => {
  const opcoes = [
    { id: 10, secao: 'Doces' },
    { id: 11, secao: '' },        // sem seção, mas depois de uma nomeada
    { id: 12, secao: 'Doces' },
  ];

  it('a ordem crua e a exibida DIFEREM neste caso', () => {
    const exibida = agruparPorSecao(opcoes).flatMap(s => s.opcoes).map(o => o.id);
    expect(exibida).toEqual([11, 10, 12]);
    expect(exibida).not.toEqual(opcoes.map(o => o.id));
  });

  it('numerar pela lista exibida faz o número casar com a tela', () => {
    const exibida = agruparPorSecao(opcoes).flatMap(s => s.opcoes);
    const n = numerarOpcoes([{ slot: 0, grupos: [{ id: 1, opcoes: exibida }] }]);
    /* 1 é o primeiro DA TELA (o sem seção), como o cabeçalho mostra. */
    expect(n.map(x => x.opcaoId)).toEqual([11, 10, 12]);
  });

  it('numerar pela lista crua apontaria pro sabor errado', () => {
    const crua = numerarOpcoes([{ slot: 0, grupos: [{ id: 1, opcoes }] }]);
    /* O "1" acionaria o id 10, que na tela aparece em segundo. É o defeito. */
    expect(crua[0].opcaoId).toBe(10);
  });
});

describe('a tela compacta numera pela lista exibida', () => {
  const comp = fs.readFileSync(path.resolve(
    __dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'escolha-rapida.tsx'), 'utf8');
  const codigo = comp.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('achata as seções ANTES de numerar', () => {
    expect(codigo).toMatch(/secoes\.flatMap\(x => x\.opcoes\)/);
    /* E renderiza por seção, senão o achatamento não teria motivo. */
    expect(codigo).toMatch(/g\.secoes\.map\(sec =>/);
    expect(codigo).toMatch(/sec\.opcoes\.map\(o =>/);
  });
});

/*
 * O COLAPSO EXISTE PRA LISTA CABER — com seis tamanhos, 33 sabores e a borda
 * abertos, a borda fica fora da tela e o rodapé anuncia que ela falta sem que
 * dê pra vê-la.
 */
describe('grupoConcluido', () => {
  it('escolha única fecha com uma', () => {
    expect(grupoConcluido('unico', 0, 1)).toBe(false);
    expect(grupoConcluido('unico', 1, 1)).toBe(true);
  });

  /*
   * O CASO QUE TRAVA O ATENDENTE SE ERRADO. "Até 4 sabores" com 1 escolhido não
   * está decidido — ele ainda pode querer o segundo. Fechar ali esconderia o
   * resto, e a única saída seria reabrir na mão: pior que não ter colapso.
   */
  it('múltipla NÃO fecha antes do teto', () => {
    expect(grupoConcluido('multiplo', 1, 4)).toBe(false);
    expect(grupoConcluido('multiplo', 3, 4)).toBe(false);
    expect(grupoConcluido('multiplo', 4, 4)).toBe(true);
  });

  /* Sem teto a lista nunca fecha sozinha: não há momento em que se possa
     afirmar que o atendente terminou. */
  it('sem teto, nunca fecha sozinha', () => {
    expect(grupoConcluido('multiplo', 9, 0)).toBe(false);
  });

  /* O teto pode CAIR quando o tamanho muda (de 4 sabores pra 1). Um grupo com 4
     escolhidos e teto novo de 1 continua "concluído" — a poda de excesso é
     outra responsabilidade, e travar aqui esconderia a lista no meio da
     correção. */
  it('escolhas acima do teto contam como concluído', () => {
    expect(grupoConcluido('multiplo', 4, 1)).toBe(true);
  });
});

/*
 * A NUMERAÇÃO NÃO PODE DEPENDER DO QUE ESTÁ VISÍVEL.
 *
 * O colapso esconde grupos decididos. Se a numeração passasse a contar só o
 * visível, "28 é Camarão" deixaria de valer no instante em que o Tamanho
 * fechasse — e decorar o número é a única vantagem da lista compacta sobre o
 * modal do cliente. O atendente digitaria 28 e sairia outro sabor.
 */
describe('o colapso não mexe na numeração', () => {
  const comp = fs.readFileSync(path.resolve(
    __dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'escolha-rapida.tsx'), 'utf8');
  const codigo = comp.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('numera sobre TODOS os grupos, sem consultar o estado de colapso', () => {
    const chamadas = codigo.match(/numerarOpcoes\([^)]*\)/g) || [];
    expect(chamadas).toEqual(['numerarOpcoes(slots)']);
    for (const c of chamadas) {
      expect(c).not.toMatch(/fechado|reaberto|visiv/);
    }
  });

  /*
   * O COLAPSO SAIU no redesenho de duas colunas: o painel da direita passou a
   * ser a fonte da verdade do que foi escolhido, e ele resolve melhor o que o
   * colapso resolvia — conferir sem rolar de volta —, além de permitir remover
   * um item específico, que o colapso não permitia.
   *
   * `grupoConcluido` continua valendo: agora é ela que decide o texto de estado
   * no cabeçalho do grupo ("2 de 4 escolhidos", com tom quando satisfeito).
   */
  it('a regra testada decide o estado do cabeçalho', () => {
    expect(codigo).toMatch(/grupoConcluido\(g\.tipo, ids\.length, max\)/);
  });

  /*
   * NO TETO, O CLIQUE É IGNORADO — antes o mais antigo era descartado.
   *
   * A troca silenciosa fazia sentido quando não havia onde ver o que estava
   * escolhido. Com o painel da direita mostrando tudo e o `x` pra remover,
   * ignorar é honesto; descartar às escondidas passaria a ser perda de escolha.
   */
  it('item no teto é bloqueado, não troca o mais antigo', () => {
    expect(codigo).toMatch(/if \(noTeto\([^)]*\)\) return atual;/);
    expect(codigo).toMatch(/cursor-not-allowed/);
    /* A eviction anterior não pode voltar por engano. */
    expect(codigo).not.toMatch(/atuais\.slice\(1\)/);
  });

  /* Número fora da lista precisa DIZER que não existe: antes sumia calado e o
     operador concluía que a tecla falhou. */
  it('número inexistente vira eco em vermelho', () => {
    expect(codigo).toMatch(/não existe/);
    expect(codigo).toMatch(/erro: true/);
  });
});

/*
 * O "FALTA" QUE LEVA, E O PULO PRO PRÓXIMO PENDENTE.
 *
 * São comportamentos de DOM, então o que dá pra prender aqui é a forma — mas as
 * três coisas abaixo são exatamente onde a implementação ingênua incomoda mais
 * que ajuda, e cada uma tem um sintoma próprio.
 */
describe('navegação da lista compacta', () => {
  const comp = fs.readFileSync(path.resolve(
    __dirname, '..', '..', 'frontend', 'src', 'pages', 'lojista', 'escolha-rapida.tsx'), 'utf8');
  const codigo = comp.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /* Nomear sem levar é o defeito original: "Falta: Borda" com a borda fora da
     tela deixa o atendente procurando o que ele já sabe que existe. */
  it('cada nome em falta é um botão que rola até o grupo', () => {
    expect(codigo).toMatch(/faltando\.map\(\(f, i\) =>/);
    expect(codigo).toMatch(/onClick=\{\(\) => irPara\(f\.chave\)\}/);
  });

  /*
   * O PULO DISPARA NA TRANSIÇÃO. Sem comparar com o estado anterior, cada tecla
   * dentro de um grupo JÁ completo puxaria a tela de novo — a cada sabor
   * trocado, um solavanco.
   */
  it('o pulo compara com o conjunto anterior de grupos completos', () => {
    expect(codigo).toMatch(/completosAntes = useRef<Set<string>>/);
    expect(codigo).toMatch(/if \(!completosAntes\.current\.has\(c\)\) novo = true/);
    expect(codigo).toMatch(/if \(novo && faltando\[0\]\) irPara\(faltando\[0\]\.chave\)/);
  });

  /*
   * NÃO ROLA SE JÁ ESTÁ VISÍVEL. Depois do colapso a lista é curta e o próximo
   * pendente costuma estar na tela; rolar de qualquer jeito arrancaria a vista
   * do lugar a cada escolha.
   */
  it('irPara desiste quando o grupo já está visível', () => {
    expect(codigo).toMatch(/if \(r\.top >= c\.top && r\.bottom <= c\.bottom\) return;/);
  });

  /* A ref é por `slot:grupo`: num combo dois slots têm o MESMO grupo, e o id
     sozinho guardaria uma ref só — o pulo levaria sempre à primeira pizza. */
  it('a ref do grupo é indexada por slot:grupo', () => {
    expect(codigo).toMatch(/refsGrupo\.current\[chave\] = el/);
  });
});
