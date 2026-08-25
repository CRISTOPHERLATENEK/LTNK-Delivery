/**
 * A PROMESSA DA FASE 3: produto que não é combo não muda em NADA.
 *
 * O modal é a tela mais complexa do app, e o combo mexe na estrutura dela. O que
 * protege os 25 produtos que não são combo é este módulo: o modal pede os slots
 * e desenha, e pra produto comum vem um slot só, sem rótulo — que é exatamente o
 * que a tela sempre desenhou.
 *
 * Espalhado pelo JSX isso não seria testável. Aqui é.
 */
import { describe, it, expect } from 'vitest';
import {
  chaveEscolha, montarSlots, ehCombo, escolhasParaEnvio, faltandoPorSlot,
} from './slots-produto';
import type { Produto, GrupoOpcoes } from '@/types';

const grupo = (id: number, over: Partial<GrupoOpcoes> = {}): GrupoOpcoes => ({
  id, nome: `G${id}`, tipo: 'multiplo', obrigatorio: 0, max_escolhas: 0,
  opcoes: [{ id: id * 10, nome: 'op', preco_adicional_centavos: 0, disponivel: 1 }],
  ...over,
} as GrupoOpcoes);

const prod = (over: Record<string, unknown> = {}): Produto => ({
  id: 1, nome: 'Produto', preco_centavos: 1000, ...over,
} as unknown as Produto);

describe('chaveEscolha', () => {
  /*
   * O ID DO GRUPO SOZINHO COLIDE. Dois slots do mesmo produto — "2× Pizza
   * Artesanal", o combo mais comum de pizzaria — usam o MESMO grupo de sabores.
   * Indexar só por id faria escolher calabresa na pizza 1 aparecer marcado na 2.
   */
  it('separa o mesmo grupo em slots diferentes', () => {
    expect(chaveEscolha(1, 19)).not.toBe(chaveEscolha(2, 19));
  });

  /* String e não número composto: aritmética de chave é um limite escondido
     esperando o id passar de um milhão. */
  it('não depende de aritmética', () => {
    expect(chaveEscolha(0, 1000000)).not.toBe(chaveEscolha(1, 0));
  });
});

describe('montarSlots — produto comum', () => {
  it('um slot, sem rótulo', () => {
    const slots = montarSlots(prod({ grupos: [grupo(1), grupo(2)] }));
    expect(slots).toHaveLength(1);
    expect(slots[0].slot).toBe(0);
    expect(slots[0].rotulo).toBe('');
    expect(slots[0].grupos).toHaveLength(2);
  });

  /* Sem complemento nenhum, lista vazia — é o que faz o modal mostrar só foto,
     preço e quantidade, como sempre. */
  it('sem grupos, nenhum slot', () => {
    expect(montarSlots(prod({}))).toEqual([]);
    expect(montarSlots(prod({ grupos: [] }))).toEqual([]);
  });

  it('não é combo', () => {
    expect(ehCombo(prod({ grupos: [grupo(1)] }))).toBe(false);
    expect(ehCombo(prod({}))).toBe(false);
  });
});

describe('montarSlots — combo', () => {
  const combo = prod({
    grupos: [grupo(9, { nome: 'Refrigerante' })],
    composicao: [
      { slot: 2, rotulo: 'Pizza 2', produto_id: 32, produto_nome: 'Pizza Artesanal', grupos: [grupo(19)] },
      { slot: 1, rotulo: 'Pizza 1', produto_id: 32, produto_nome: 'Pizza Artesanal', grupos: [grupo(19)] },
    ],
  });

  /* A ordem é a do cadastro, não a que o SQL devolveu. */
  it('slot 0 primeiro, componentes por slot', () => {
    expect(montarSlots(combo).map(s => s.slot)).toEqual([0, 1, 2]);
  });

  it('é combo', () => {
    expect(ehCombo(combo)).toBe(true);
  });

  /* Combo sem grupo próprio não ganha seção vazia no topo. */
  it('sem grupo próprio, o slot 0 não aparece', () => {
    const semProprios = prod({
      composicao: [{ slot: 1, rotulo: 'Pizza 1', produto_id: 32, produto_nome: 'X', grupos: [grupo(19)] }],
    });
    expect(montarSlots(semProprios).map(s => s.slot)).toEqual([1]);
  });

  /* Dois slots sem rótulo cadastrado e sem nome de produto seriam duas seções
     indistinguíveis na tela. */
  it('sem rótulo cai no nome do produto, e depois no número do slot', () => {
    const semRotulo = prod({
      composicao: [
        { slot: 1, rotulo: '', produto_id: 32, produto_nome: 'Pizza Artesanal', grupos: [] },
        { slot: 2, rotulo: '', produto_id: 33, produto_nome: '', grupos: [] },
      ],
    });
    const slots = montarSlots(semRotulo);
    expect(slots[0].rotulo).toBe('Pizza Artesanal');
    expect(slots[1].rotulo).toBe('Item 2');
  });
});

describe('escolhasParaEnvio', () => {
  /*
   * ESTE É O TESTE DA COMPATIBILIDADE. Produto comum tem que mandar exatamente o
   * que sempre mandou — uma lista de ids. Se virar objeto, todo pedido de todo
   * produto passa pelo caminho novo no dia do deploy.
   */
  it('produto comum manda lista de ids, como antes', () => {
    const slots = montarSlots(prod({ grupos: [grupo(1), grupo(2)] }));
    const escolhas = { [chaveEscolha(0, 1)]: [10, 10], [chaveEscolha(0, 2)]: [20] };
    expect(escolhasParaEnvio(slots, escolhas)).toEqual([10, 10, 20]);
  });

  /* Repetição preservada: `[10,10]` são duas frações do mesmo sabor. */
  it('não deduplica', () => {
    const slots = montarSlots(prod({ grupos: [grupo(1)] }));
    expect(escolhasParaEnvio(slots, { [chaveEscolha(0, 1)]: [10, 10, 10] })).toHaveLength(3);
  });

  it('combo manda slot em cada escolha', () => {
    const combo = prod({
      composicao: [
        { slot: 1, rotulo: 'P1', produto_id: 32, produto_nome: 'X', grupos: [grupo(19)] },
        { slot: 2, rotulo: 'P2', produto_id: 32, produto_nome: 'X', grupos: [grupo(19)] },
      ],
    });
    const slots = montarSlots(combo);
    const escolhas = { [chaveEscolha(1, 19)]: [190, 190], [chaveEscolha(2, 19)]: [191] };
    expect(escolhasParaEnvio(slots, escolhas)).toEqual([
      { s: 1, o: 190 }, { s: 1, o: 190 }, { s: 2, o: 191 },
    ]);
  });

  /* O MESMO id em slots diferentes tem que sair duas vezes, com slots
     diferentes — é o que distingue "calabresa nas duas pizzas" de "calabresa
     numa só". */
  it('mesmo sabor em dois slots sai duas vezes', () => {
    const combo = prod({
      composicao: [
        { slot: 1, rotulo: 'P1', produto_id: 32, produto_nome: 'X', grupos: [grupo(19)] },
        { slot: 2, rotulo: 'P2', produto_id: 32, produto_nome: 'X', grupos: [grupo(19)] },
      ],
    });
    const slots = montarSlots(combo);
    const envio = escolhasParaEnvio(slots, {
      [chaveEscolha(1, 19)]: [190], [chaveEscolha(2, 19)]: [190],
    });
    expect(envio).toEqual([{ s: 1, o: 190 }, { s: 2, o: 190 }]);
  });

  it('nada escolhido, nada enviado', () => {
    expect(escolhasParaEnvio(montarSlots(prod({ grupos: [grupo(1)] })), {})).toEqual([]);
  });
});

describe('faltandoPorSlot', () => {
  it('produto comum: só o nome do grupo', () => {
    const slots = montarSlots(prod({ grupos: [grupo(1, { obrigatorio: 1, nome: 'Tamanho' })] }));
    expect(faltandoPorSlot(slots, {})).toEqual([
      { chave: chaveEscolha(0, 1), rotulo: 'Tamanho' },
    ]);
  });

  /*
   * "falta escolher Sabores" com duas pizzas na tela não diz QUAL. É a mensagem
   * que o cliente lê quando o botão recusa — sem o rótulo, ele fica sem saída.
   */
  it('combo: o rótulo do slot vem na frente', () => {
    const combo = prod({
      composicao: [
        { slot: 1, rotulo: 'Pizza 1', produto_id: 32, produto_nome: 'X', grupos: [grupo(19, { obrigatorio: 1, nome: 'Sabores' })] },
        { slot: 2, rotulo: 'Pizza 2', produto_id: 32, produto_nome: 'X', grupos: [grupo(19, { obrigatorio: 1, nome: 'Sabores' })] },
      ],
    });
    expect(faltandoPorSlot(montarSlots(combo), {}).map(f => f.rotulo))
      .toEqual(['Pizza 1 · Sabores', 'Pizza 2 · Sabores']);
  });

  it('grupo já atendido sai da lista', () => {
    const slots = montarSlots(prod({ grupos: [grupo(1, { obrigatorio: 1 })] }));
    expect(faltandoPorSlot(slots, { [chaveEscolha(0, 1)]: [10] })).toEqual([]);
  });

  it('grupo opcional nunca falta', () => {
    const slots = montarSlots(prod({ grupos: [grupo(1, { obrigatorio: 0 })] }));
    expect(faltandoPorSlot(slots, {})).toEqual([]);
  });

  /*
   * GRUPO OBRIGATÓRIO SEM OPÇÃO NÃO PODE EXIGIR ESCOLHA. Cardápio pela metade é
   * estado real — o grupo foi criado, os itens não — e um obrigatório vazio
   * travaria o botão pra sempre, sem nada pra clicar. O servidor pula esse grupo
   * também; se a tela não pulasse, o cliente ficaria preso numa tela que o
   * servidor aceitaria.
   */
  it('obrigatório SEM opção não trava o botão', () => {
    const slots = montarSlots(prod({ grupos: [grupo(1, { obrigatorio: 1, opcoes: [] })] }));
    expect(faltandoPorSlot(slots, {})).toEqual([]);
  });

  /* Um slot atendido e o outro não: só o que falta aparece. */
  it('lista só o slot pendente', () => {
    const combo = prod({
      composicao: [
        { slot: 1, rotulo: 'Pizza 1', produto_id: 32, produto_nome: 'X', grupos: [grupo(19, { obrigatorio: 1, nome: 'Sabores' })] },
        { slot: 2, rotulo: 'Pizza 2', produto_id: 32, produto_nome: 'X', grupos: [grupo(19, { obrigatorio: 1, nome: 'Sabores' })] },
      ],
    });
    const faltas = faltandoPorSlot(montarSlots(combo), { [chaveEscolha(1, 19)]: [190] });
    expect(faltas.map(f => f.rotulo)).toEqual(['Pizza 2 · Sabores']);
  });
});
