import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { saboresLiberados, maxEscolhasEfetivo, precoDoGrupo , precoMinimoItem, precoVariavel, agruparPorSecao } from './opcoes-preco';

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
