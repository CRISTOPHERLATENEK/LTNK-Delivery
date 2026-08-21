import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { saboresLiberados, maxEscolhasEfetivo, precoDoGrupo , precoMinimoItem, precoVariavel, agruparPorSecao, contarFracoes } from './opcoes-preco';

const tamanho = { papel: 'tamanho', modo_preco: 'somar', max_escolhas: 1 };
const sabores = { papel: 'sabores', modo_preco: 'maior', max_escolhas: 1 };
const adicionais = { papel: '', modo_preco: 'somar', max_escolhas: 0 };

describe('saboresLiberados', () => {
  it('pega o número da opção de tamanho escolhida', () => {
    expect(saboresLiberados([
      { grupo: tamanho, escolhidas: [{ preco_adicional_centavos: 2000, sabores: 3 }] },
      { grupo: sabores, escolhidas: [] },
    ])).toBe(3);
  });

  it('devolve 0 quando o tamanho não define nada', () => {
    expect(saboresLiberados([
      { grupo: tamanho, escolhidas: [{ preco_adicional_centavos: 0, sabores: 0 }] },
    ])).toBe(0);
  });

  it('ignora grupos que não são de tamanho', () => {
    // Um adicional com `sabores` preenchido por engano não pode mandar no limite.
    expect(saboresLiberados([
      { grupo: adicionais, escolhidas: [{ preco_adicional_centavos: 400, sabores: 9 }] },
    ])).toBe(0);
  });
});

describe('maxEscolhasEfetivo', () => {
  it('o grupo de sabores obedece ao tamanho', () => {
    expect(maxEscolhasEfetivo(sabores, 3)).toBe(3);
  });

  it('sem tamanho definido, cai no max do grupo — nunca em ilimitado', () => {
    expect(maxEscolhasEfetivo({ ...sabores, max_escolhas: 2 }, 0)).toBe(2);
  });

  it('grupos comuns não são afetados pelo tamanho', () => {
    expect(maxEscolhasEfetivo({ ...adicionais, max_escolhas: 5 }, 3)).toBe(5);
  });
});

describe('precoDoGrupo', () => {
  it('sabores: cobra o MAIOR acréscimo, não a soma', () => {
    // O caso que motivou tudo: 10 + 12 + 14 dava R$ 36 em vez de R$ 14.
    expect(precoDoGrupo(sabores, [
      { preco_adicional_centavos: 1000 },
      { preco_adicional_centavos: 1200 },
      { preco_adicional_centavos: 1400 },
    ])).toBe(1400);
  });

  it('sabores comuns (todos zerados) não acrescentam nada', () => {
    expect(precoDoGrupo(sabores, [
      { preco_adicional_centavos: 0 },
      { preco_adicional_centavos: 0 },
    ])).toBe(0);
  });

  it('um sabor especial no meio de comuns cobra só o especial', () => {
    expect(precoDoGrupo(sabores, [
      { preco_adicional_centavos: 0 },
      { preco_adicional_centavos: 1200 },
      { preco_adicional_centavos: 0 },
    ])).toBe(1200);
  });

  it('adicionais somam — dois bacons custam dois bacons', () => {
    expect(precoDoGrupo(adicionais, [
      { preco_adicional_centavos: 400 },
      { preco_adicional_centavos: 400 },
    ])).toBe(800);
  });

  it('nada escolhido não acrescenta nada', () => {
    expect(precoDoGrupo(sabores, [])).toBe(0);
    expect(precoDoGrupo(adicionais, [])).toBe(0);
  });
});

/**
 * O PREÇO DO CARD.
 *
 * O card mostrava o preço base seco. Num produto com grupo obrigatório em que
 * toda opção tem acréscimo — a pizza onde todo tamanho soma — isso era um preço
 * que ninguém conseguia pagar: o cliente via R$ 39,90 e o mínimo real era outro.
 */
const opc = (...precos: number[]) => precos.map(p => ({ preco_adicional_centavos: p }));

describe('precoMinimoItem', () => {
  it('sem grupos, é o preço base', () => {
    expect(precoMinimoItem(3990, [])).toBe(3990);
    expect(precoMinimoItem(3990)).toBe(3990);
  });

  /* O caso que era o bug: obrigatório cujo mínimo é maior que zero. */
  it('grupo OBRIGATÓRIO soma o menor acréscimo dele', () => {
    const g = { obrigatorio: 1 as const, max_escolhas: 1, opcoes: opc(1500, 2500, 3500) };
    expect(precoMinimoItem(3990, [g])).toBe(3990 + 1500);
  });

  it('grupo OPCIONAL não soma nada — dá pra não escolher', () => {
    const g = { obrigatorio: 0 as const, max_escolhas: 3, opcoes: opc(500, 800) };
    expect(precoMinimoItem(3990, [g])).toBe(3990);
  });

  it('vários obrigatórios somam os mínimos de cada um', () => {
    const tamanho = { obrigatorio: 1 as const, max_escolhas: 1, opcoes: opc(1000, 2000) };
    const borda = { obrigatorio: 1 as const, max_escolhas: 1, opcoes: opc(0, 700) };
    expect(precoMinimoItem(3990, [tamanho, borda])).toBe(3990 + 1000 + 0);
  });

  /* Cardápio pela metade é estado real: grupo criado, opções ainda não. */
  it('grupo obrigatório SEM opções não quebra nem soma', () => {
    const g = { obrigatorio: 1 as const, max_escolhas: 1, opcoes: [] };
    expect(precoMinimoItem(3990, [g])).toBe(3990);
  });
});

describe('precoVariavel', () => {
  it('sem grupos, preço é fixo', () => {
    expect(precoVariavel([])).toBe(false);
  });

  it('obrigatório com acréscimos diferentes varia', () => {
    expect(precoVariavel([{ obrigatorio: 1, max_escolhas: 1, opcoes: opc(1500, 2500) }])).toBe(true);
  });

  /*
   * Este é o teste que evita "a partir de" em item de preço único: todas as
   * opções do obrigatório custam o mesmo, então existe UM total possível — mais
   * alto que o preço base, mas único.
   */
  it('obrigatório com acréscimos IGUAIS não varia', () => {
    expect(precoVariavel([{ obrigatorio: 1, max_escolhas: 1, opcoes: opc(1500, 1500) }])).toBe(false);
  });

  it('opcional com acréscimo varia (pode escolher ou não)', () => {
    expect(precoVariavel([{ obrigatorio: 0, max_escolhas: 2, opcoes: opc(500) }])).toBe(true);
  });

  it('opcional sem acréscimo nenhum não varia', () => {
    expect(precoVariavel([{ obrigatorio: 0, max_escolhas: 2, opcoes: opc(0, 0) }])).toBe(false);
  });
});

/**
 * AS COLUNAS DE QUE ESTA REGRA DEPENDE PRECISAM CHEGAR NA TELA.
 *
 * Toda a lógica acima é inútil se o cardápio do cliente não trouxer os campos.
 * Foi o que aconteceu: ao corrigir um N+1, alguém listou as colunas à mão em
 * rotas/publico.ts e deixou de fora justamente as três da pizza. O resultado
 * não era erro nenhum — era pizza quebrada em silêncio:
 *
 *   - sem `papel`, `saboresLiberados` devolve 0 e a Grande que libera 3 sabores
 *     só deixava escolher 1;
 *   - sem `modo_preco`, `precoDoGrupo` cai em 'somar' e a TELA soma os
 *     acréscimos enquanto o SERVIDOR cobra só o maior — prévia diferente da
 *     cobrança, que é o pior jeito de errar preço;
 *   - sem `sabores`, não há de onde tirar o limite.
 *
 * O teste olha o SQL porque é ali que a informação se perde. Se alguém reescrever
 * a consulta e esquecer um campo, isto falha antes de o cliente ver.
 */
describe('a consulta pública tem que trazer os campos da pizza', () => {
  const publico = fs.readFileSync(path.resolve(__dirname, 'rotas', 'publico.ts'), 'utf8');

  it('a consulta de grupos traz papel e modo_preco', () => {
    const sel = publico.match(/SELECT[^`]*FROM grupos_opcoes/);
    expect(sel).not.toBeNull();
    expect(sel![0]).toMatch(/papel/);
    expect(sel![0]).toMatch(/modo_preco/);
  });

  it('a consulta de opções traz sabores e secao', () => {
    const sel = publico.match(/SELECT[^`]*FROM opcoes_itens/);
    expect(sel).not.toBeNull();
    expect(sel![0]).toMatch(/sabores/);
    expect(sel![0]).toMatch(/secao/);
    expect(sel![0]).toMatch(/descricao/);
  });
});

/**
 * Agrupamento por seção. A ordem importa: 'Tradicionais' antes de 'Especiais' é
 * escolha do lojista (ele ordena as opções), e alfabético inverteria isso.
 */
describe('agruparPorSecao', () => {
  it('sem seção nenhuma, devolve um bloco só sem rótulo', () => {
    const r = agruparPorSecao([{ secao: '' }, { secao: null }, {}]);
    expect(r).toHaveLength(1);
    expect(r[0].secao).toBe('');
    expect(r[0].opcoes).toHaveLength(3);
  });

  it('separa por seção na ordem de primeira aparição', () => {
    const r = agruparPorSecao([
      { secao: 'Tradicionais' }, { secao: 'Especiais' }, { secao: 'Tradicionais' },
    ]);
    expect(r.map(x => x.secao)).toEqual(['Tradicionais', 'Especiais']);
    expect(r[0].opcoes).toHaveLength(2);
  });

  /* Opção antiga (sem seção) não pode ir pro fim: mudaria a ordem de um
     cardápio que já está no ar. */
  it('as SEM seção ficam no começo', () => {
    const r = agruparPorSecao([{ secao: 'Doces' }, { secao: '' }]);
    expect(r.map(x => x.secao)).toEqual(['Doces', '']);
    const r2 = agruparPorSecao([{ secao: '' }, { secao: 'Doces' }]);
    expect(r2.map(x => x.secao)).toEqual(['', 'Doces']);
  });

  it('ignora espaço em volta do nome da seção', () => {
    const r = agruparPorSecao([{ secao: ' Doces ' }, { secao: 'Doces' }]);
    expect(r).toHaveLength(1);
    expect(r[0].secao).toBe('Doces');
  });
});

/**
 * FRAÇÕES E POLÍTICA DE PREÇO — o caminho do dinheiro.
 *
 * O que a análise do mercado revelou: a pizzaria cobra 100% do acréscimo de cada
 * sabor especial, mesmo ocupando meia pizza (R$ 94,90 + R$ 16,00 = R$ 110,90).
 * Este app usava 'maior' por padrão nas pizzas — cobrando MENOS que o mercado.
 * As duas políticas existem; a escolha é do lojista.
 */
const sab = (id: number, acr: number) => ({ id, preco_adicional_centavos: acr });

describe('contarFracoes', () => {
  it('conta repetição como fração, na ordem de primeira escolha', () => {
    const r = contarFracoes([sab(1, 1600), sab(1, 1600), sab(2, 0), sab(3, 500)]);
    expect(r.map(x => [x.opcao.id, x.fracoes])).toEqual([[1, 2], [2, 1], [3, 1]]);
  });

  it('sem id, cada entrada é uma opção distinta (chamada antiga)', () => {
    const r = contarFracoes([{ preco_adicional_centavos: 100 }, { preco_adicional_centavos: 100 }]);
    expect(r).toHaveLength(2);
  });
});

describe('precoDoGrupo com frações', () => {
  const tres = [sab(1, 1600), sab(1, 1600), sab(2, 0)]; // 2/3 de um sabor + 1/3 de outro

  /*
   * O CASO QUE MAIS IMPORTA: 2/4 do mesmo sabor custa o acréscimo UMA vez.
   * Cobrar por fração dobraria o preço por causa do tamanho do pedaço.
   */
  it('somar: 100% de cada sabor DISTINTO, não por fração', () => {
    expect(precoDoGrupo({ modo_preco: 'somar', max_escolhas: 3 }, tres)).toBe(1600);
  });

  it('somar: sabores diferentes somam', () => {
    expect(precoDoGrupo({ modo_preco: 'somar', max_escolhas: 3 }, [sab(1, 1600), sab(2, 500)]))
      .toBe(2100);
  });

  it('maior: só o acréscimo mais caro', () => {
    expect(precoDoGrupo({ modo_preco: 'maior', max_escolhas: 3 }, [sab(1, 1000), sab(2, 1400)]))
      .toBe(1400);
  });

  it('proporcional: metade de +R$16 custa +R$8', () => {
    expect(precoDoGrupo({ modo_preco: 'proporcional', max_escolhas: 2 }, [sab(1, 1600), sab(2, 0)]))
      .toBe(800);
  });

  it('proporcional: 2/3 de +R$16 custa 2/3 do acréscimo', () => {
    expect(precoDoGrupo({ modo_preco: 'proporcional', max_escolhas: 3 }, tres))
      .toBe(Math.round(1600 * 2 / 3));
  });

  /* Arredondar por parcela faria três terços de +R$10 dar R$10,02. */
  it('proporcional: arredonda no fim, não por sabor', () => {
    const r = precoDoGrupo({ modo_preco: 'proporcional', max_escolhas: 3 },
      [sab(1, 1000), sab(1, 1000), sab(1, 1000)]);
    expect(r).toBe(1000);
  });

  /* Adicionais e borda não repetem: o resultado tem que ser igual ao de antes. */
  it('grupo sem repetição continua somando como antes', () => {
    expect(precoDoGrupo({ max_escolhas: 0 }, [sab(1, 300), sab(2, 500), sab(3, 200)]))
      .toBe(1000);
  });

  it('nada escolhido não acrescenta nada', () => {
    expect(precoDoGrupo({ modo_preco: 'proporcional', max_escolhas: 3 }, [])).toBe(0);
  });
});

/**
 * NINGUÉM SOMA ACRÉSCIMO DE OPÇÃO À MÃO.
 *
 * Hoje esta mesma regra apareceu copiada em TRÊS lugares — o modal do cliente
 * (que importava `precoDoGrupo` e nunca chamava), o "repetir pedido" e o card do
 * produto. Cada cópia ignorava o `modo_preco` do grupo: a tela somava três
 * acréscimos e a cobrança era de um. Prévia diferente do que se paga.
 *
 * O que se procura é AGREGAÇÃO (reduce/+=), não exibição: mostrar
 * "+R$ 5,00" ao lado do nome do adicional é legítimo e não entra aqui.
 *
 * Se este teste falhar, use `precoDoGrupo` no lugar novo.
 */
describe('a soma de acréscimo não pode ser copiada', () => {
  const raizes = [
    path.resolve(__dirname, '..', '..', 'src'),
    path.resolve(__dirname, '..', '..', 'frontend', 'src'),
  ];
  const permitidos = ['opcoes-preco.ts', 'opcoes-preco.test.ts'];

  function arquivos(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : arquivos(p);
      return /\.(ts|tsx)$/.test(e.name) && !permitidos.includes(e.name) ? [p] : [];
    });
  }

  it('nenhum arquivo agrega preco_adicional_centavos por conta própria', () => {
    const culpados: string[] = [];
    for (const raiz of raizes) {
      for (const arq of arquivos(raiz)) {
        const t = fs.readFileSync(arq, 'utf8');
        const agrega = /reduce\([^)]*preco_adicional_centavos/s.test(t)
          || /\+=\s*[^;\n]*preco_adicional_centavos/.test(t);
        if (agrega) culpados.push(path.relative(path.resolve(__dirname, '..', '..'), arq));
      }
    }
    expect(culpados).toEqual([]);
  });
});
