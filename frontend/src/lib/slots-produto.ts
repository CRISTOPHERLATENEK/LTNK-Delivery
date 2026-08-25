/**
 * OS SLOTS DE UM ITEM — o que o cliente configura, e em que ordem.
 *
 * Um produto comum tem UM slot: ele mesmo. Um combo tem o slot 0 (os grupos que
 * o próprio combo tem, como "Refrigerante 2L") mais um slot por componente.
 *
 * ESTE MÓDULO EXISTE PRA QUE O MODAL NÃO PRECISE SABER A DIFERENÇA. Ele pede os
 * slots e desenha; se houver um só, a tela sai exatamente como sempre saiu. É
 * aqui que mora a promessa de "produto que não é combo não muda em nada" — e é
 * uma promessa testável, o que ela não seria espalhada pelo JSX.
 */
import type { GrupoOpcoes, Produto } from '@/types';

/** Um componente do combo, como o cardápio público manda. */
export interface ComponenteCombo {
  slot: number;
  rotulo: string;
  produto_id: number;
  produto_nome: string;
  grupos: GrupoOpcoes[];
}

export interface SlotMontagem {
  slot: number;
  /** Vazio no slot 0 de produto comum — é o que faz a tela não ganhar cabeçalho. */
  rotulo: string;
  grupos: GrupoOpcoes[];
}

/**
 * A chave de uma escolha na tela.
 *
 * `escolhidas` era indexada só pelo id do grupo. Com dois slots usando O MESMO
 * grupo — que é o caso de "2× Pizza Artesanal", o combo mais comum de pizzaria —
 * o id sozinho colide: escolher calabresa na pizza 1 apareceria marcado na 2.
 *
 * String e não número composto (`slot * 1e6 + id`) porque aritmética de chave é
 * um limite escondido esperando o id passar de um milhão.
 */
export function chaveEscolha(slot: number, grupoId: number): string {
  return `${slot}:${grupoId}`;
}

/**
 * Monta os slots de um produto.
 *
 * O SLOT 0 SÓ APARECE SE TIVER GRUPO. Um combo cujos grupos estão todos nos
 * componentes não deve ganhar uma seção vazia no topo — e um produto comum sem
 * complemento nenhum devolve lista vazia, que é o que faz o modal mostrar só
 * foto, preço e quantidade, como hoje.
 *
 * A ORDEM É A DO CADASTRO: slot 0 primeiro (o que é do combo em si, tipo a
 * bebida inclusa), depois os componentes por `slot`. Ordenar aqui e não confiar
 * na resposta é o que garante que a tela não dependa da ordem que o SQL devolveu.
 */
export function montarSlots(produto: Produto): SlotMontagem[] {
  const proprios = produto.grupos ?? [];
  const composicao = ((produto as unknown as { composicao?: ComponenteCombo[] }).composicao ?? [])
    .slice()
    .sort((a, b) => a.slot - b.slot);

  const slots: SlotMontagem[] = [];
  if (proprios.length > 0) slots.push({ slot: 0, rotulo: '', grupos: proprios });
  for (const c of composicao) {
    slots.push({
      slot: c.slot,
      /* Sem rótulo cadastrado cai no nome do produto: dois slots sem nenhum dos
         dois seriam duas seções indistinguíveis. */
      rotulo: (c.rotulo || c.produto_nome || `Item ${c.slot}`).trim(),
      grupos: c.grupos ?? [],
    });
  }
  return slots;
}

/** É um combo? Só pra tela decidir se desenha cabeçalho de seção. */
export function ehCombo(produto: Produto): boolean {
  return montarSlots(produto).some(s => s.slot > 0);
}

/**
 * Serializa as escolhas da tela pro formato que o servidor lê.
 *
 * Devolve lista de ids quando tudo está no slot 0, e objetos `{s,o}` quando há
 * slot — o mesmo contrato de `serializarEscolhas` em `opcoes-preco.ts`, que é
 * quem o servidor usa pra reler. Produto comum continua mandando exatamente o
 * que sempre mandou.
 */
export function escolhasParaEnvio(
  slots: SlotMontagem[],
  escolhidas: Record<string, number[]>,
): Array<number | { s: number; o: number }> {
  const temSlot = slots.some(s => s.slot > 0);
  const saida: Array<number | { s: number; o: number }> = [];
  for (const s of slots) {
    for (const g of s.grupos) {
      for (const id of escolhidas[chaveEscolha(s.slot, g.id)] ?? []) {
        saida.push(temSlot ? { s: s.slot, o: id } : id);
      }
    }
  }
  return saida;
}

/**
 * Os grupos obrigatórios que ainda não foram atendidos, com o rótulo do slot.
 *
 * O nome do grupo SOZINHO não serve num combo: "falta escolher Sabores" com duas
 * pizzas na tela não diz qual. E é a mensagem que o cliente lê quando o botão
 * recusa — sem o rótulo, ele fica sem saída.
 */
export function faltandoPorSlot(
  slots: SlotMontagem[],
  escolhidas: Record<string, number[]>,
): Array<{ chave: string; rotulo: string }> {
  const faltas: Array<{ chave: string; rotulo: string }> = [];
  for (const s of slots) {
    for (const g of s.grupos) {
      if (!g.obrigatorio) continue;
      /*
       * GRUPO SEM OPÇÃO NÃO PODE EXIGIR ESCOLHA. Cardápio pela metade é estado
       * real (o grupo foi criado, os itens não), e um obrigatório vazio travaria
       * o botão para sempre. O servidor pula esse grupo também.
       */
      if ((g.opcoes ?? []).length === 0) continue;
      const escolhas = escolhidas[chaveEscolha(s.slot, g.id)] ?? [];
      if (escolhas.length === 0) {
        faltas.push({
          chave: chaveEscolha(s.slot, g.id),
          rotulo: s.rotulo ? `${s.rotulo} · ${g.nome}` : g.nome,
        });
      }
    }
  }
  return faltas;
}
