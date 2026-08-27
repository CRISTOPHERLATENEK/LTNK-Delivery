/**
 * A VALIDAÇÃO DE OPÇÕES DO ITEM — a mesma para o delivery e para o balcão.
 *
 * Morava dentro de `rotas/cliente.ts`, e por isso só o delivery a usava. Mesa e
 * balcão lançavam o item pelo preço BASE, sem escolha nenhuma: uma pizza que no
 * delivery sai a R$ 77 (sabor + borda) era registrada a R$ 45, a cozinha
 * recebia "Pizza Artesanal" sem tamanho nem sabor, e grupo obrigatório — que no
 * delivery impede fechar o pedido — passava direto.
 *
 * Compartilhar é o ponto: duas implementações da mesma regra de preço acabam
 * discordando, e a discordância aparece como diferença de caixa no fim do dia,
 * sem ninguém saber de onde veio.
 *
 * O PREÇO É SEMPRE RECALCULADO AQUI. Nada do que o cliente (ou o PDV) manda
 * sobre valor é aceito — só as escolhas.
 */
import db from './db-mysql';
import { erroHttp } from './util';
import { precoVigente } from './preco-produto';
import { dataBrasilia } from './util';
import { saboresLiberados, maxEscolhasEfetivo, precoDoGrupo, contarFracoes,
         lerEscolhas, idsPorSlot, serializarEscolhas, type EscolhaSlot } from './opcoes-preco';
import { SQL_GRUPOS_DO_PRODUTO } from './grupos-sql';
import { GrupoOpcao, OpcaoItem, Produto } from '../tipos/modelos';

/** Resultado da validação de opções (recalculado no servidor). */
export interface ResultadoOpcoes {
  precoUnit: number;
  opcoesTexto: string;
  /*
   * O que vai pra `itens_pedido.opcoes_ids`. Lista de ids quando tudo está no
   * slot 0 — que é TODO produto que não é combo —, e só aí muda de formato.
   * Ver `serializarEscolhas`.
   */
  opcoesIds: Array<number | { s: number; o: number }>;
}

/**
 * O QUE COMPÕE O ITEM: os "slots" que o cliente configura.
 *
 * `slot 0` é sempre o próprio produto. Se ele for um combo, vêm depois os
 * componentes, na ordem de `combo_itens.slot` — cada um com os grupos DELE.
 *
 * Produto comum devolve um slot só, e é por isso que nada muda pra ele.
 */
async function slotsDoProduto(produto: Produto): Promise<Array<{ slot: number; produtoId: number; rotulo: string }>> {
  const componentes = await db.prepare(
    'SELECT ci.slot, ci.produto_id, ci.rotulo FROM combo_itens ci WHERE ci.combo_id = ? ORDER BY ci.slot'
  ).all(produto.id) as Array<{ slot: number; produto_id: number; rotulo: string }>;
  return [
    { slot: 0, produtoId: produto.id, rotulo: '' },
    ...componentes.map(c => ({ slot: c.slot, produtoId: c.produto_id, rotulo: c.rotulo })),
  ];
}

/** Como a validação trata grupo obrigatório sem escolha. */
export interface OpcoesDeValidacao {
  /*
   * EXIGIR OS OBRIGATÓRIOS — verdadeiro no delivery, e por enquanto FALSO no
   * balcão.
   *
   * Não é preguiça de fase: ligar a exigência antes de o PDV ter a tela de
   * escolha deixaria o balcão INCAPAZ de vender os 9 produtos que têm grupo
   * obrigatório. Hoje ele vende errado (preço base); com a exigência ligada e
   * sem tela, não venderia nada — pior pra quem está atendendo.
   *
   * A fase 3 traz a tela e liga isto. Enquanto está desligado, o balcão que
   * MANDA escolhas tem preço e texto corretos; o que não manda continua exato
   * como antes.
   */
  exigirObrigatorios?: boolean;
}

export async function validarOpcoesDoItem(
  produto: Produto,
  opcoesEscolhidas: unknown,
  { exigirObrigatorios = true }: OpcoesDeValidacao = {},
): Promise<ResultadoOpcoes> {
  /*
   * LÊ OS DOIS FORMATOS. Lista de ids (todo pedido já gravado, e o carrinho de
   * quem estiver com a aba aberta no deploy) vira tudo no slot 0.
   */
  const escolhas = lerEscolhas(opcoesEscolhidas);
  const porSlot = idsPorSlot(escolhas);
  const slots = await slotsDoProduto(produto);
  const slotsValidos = new Set(slots.map(s => s.slot));

  /* Escolha apontando pra slot que não existe é pedido de versão diferente ou
     corpo forjado — recusar é mais seguro que ignorar em silêncio, porque o
     silêncio cobraria a menos. */
  for (const s of porSlot.keys()) {
    if (!slotsValidos.has(s)) {
      throw erroHttp(400, `Há opções inválidas no item "${produto.nome}". Atualize a página e tente de novo.`);
    }
  }

  // O preço que o cliente PAGA. Promoção vencida não vale aqui — ver
  // preco-produto.ts, que é onde a regra mora pros nove lugares que a usam.
  let precoUnit = precoVigente(produto, dataBrasilia());
  const partesTexto: string[] = [];
  const reconhecidas: EscolhaSlot[] = [];

  for (const alvo of slots) {
    const ids = porSlot.get(alvo.slot) ?? [];
    const grupos = await db.prepare(SQL_GRUPOS_DO_PRODUTO).all(alvo.produtoId) as GrupoOpcao[];

    /*
     * DUAS PASSADAS DENTRO DO SLOT, e a primeira existe por causa da pizza: o
     * limite do grupo de sabores vem do TAMANHO escolhido, e o grupo de tamanho
     * pode estar depois na ordem.
     *
     * E o `saboresLiberados` é POR SLOT: num combo "1 Grande + 1 Broto", o
     * Grande libera 2 sabores e o Broto libera 1 — a mesma função, dois
     * resultados, no mesmo item do pedido.
     */
    const carregados: Array<{ grupo: GrupoOpcao; escolhidas: OpcaoItem[] }> = [];
    for (const grupo of grupos) {
      const opcoesDoGrupo = await db.prepare(
        'SELECT * FROM opcoes_itens WHERE grupo_id = ? AND disponivel = 1'
      ).all(grupo.id) as OpcaoItem[];
      if (opcoesDoGrupo.length === 0) continue;
      /*
       * PRESERVA A REPETIÇÃO: mapeia a partir de `ids` (a ordem e a repetição
       * vêm do cliente) e não da lista do grupo. Um `filter` devolveria cada
       * opção uma vez, e três frações chegariam como dois sabores.
       */
      const escolhidas = ids
        .map(id => opcoesDoGrupo.find(o => o.id === id))
        .filter((o): o is OpcaoItem => !!o);
      for (const o of escolhidas) reconhecidas.push({ slot: alvo.slot, opcao_id: o.id });
      carregados.push({ grupo, escolhidas });
    }

    const saboresPermitidos = saboresLiberados(carregados);

    for (const { grupo, escolhidas } of carregados) {
      /* O rótulo do slot entra na mensagem: "Escolha a borda" num combo de duas
         pizzas é um beco sem saída — o cliente não sabe qual falta. */
      const onde = alvo.rotulo ? `${alvo.rotulo} — ` : '';
      if (grupo.tipo === 'unico') {
        if (exigirObrigatorios && grupo.obrigatorio && escolhidas.length !== 1) {
          throw erroHttp(400, `${onde}Escolha uma opção em "${grupo.nome}" para o item "${produto.nome}".`);
        }
        if (escolhidas.length > 1) {
          throw erroHttp(400, `${onde}"${grupo.nome}" permite apenas uma escolha no item "${produto.nome}".`);
        }
      } else {
        if (exigirObrigatorios && grupo.obrigatorio && escolhidas.length === 0) {
          throw erroHttp(400, `${onde}Escolha ao menos uma opção em "${grupo.nome}" para o item "${produto.nome}".`);
        }
        const max = maxEscolhasEfetivo(grupo, saboresPermitidos);
        if (max > 0 && escolhidas.length > max) {
          throw erroHttp(400, `${onde}"${grupo.nome}" permite no máximo ${max} escolha(s) no item "${produto.nome}".`);
        }
      }

      /*
       * O PREÇO É POR SLOT, e é o ponto mais caro desta fase.
       *
       * `precoDoGrupo` é chamado uma vez por grupo DE CADA SLOT. Juntar as
       * escolhas dos dois slots e chamar uma vez só — que é a coisa natural a
       * fazer, porque o grupo é o mesmo objeto — cobraria, com `modo_preco =
       * 'maior'`, o maior acréscimo de TODAS as pizzas em vez do maior de CADA
       * uma: cobra uma pizza e entrega duas. Ver `precoDosSlots` em
       * opcoes-preco.ts, onde isso está travado por teste.
       */
      precoUnit += precoDoGrupo(grupo, escolhidas);

      /*
       * O TEXTO GUARDA A FRAÇÃO ("2/4 Calabresa") E O SLOT.
       *
       * É este texto que vai pro carrinho, pro cupom da cozinha e pro histórico.
       * Sem a fração, a tela promete uma divisão que quem produz não recebe. Sem
       * o rótulo do slot, a cozinha recebe quatro sabores sem saber como dividir
       * em duas pizzas — que é o mesmo defeito, um nível acima.
       */
      const totalFracoes = escolhidas.length;
      for (const p of contarFracoes(escolhidas)) {
        const nome = (p.opcao as OpcaoItem).nome;
      /*
         * O SEPARADOR DO SLOT NÃO PODE SER O MESMO QUE JUNTA AS PARTES.
         *
         * Estava ` · ` nos dois lugares, e ` · ` é o que separa uma escolha da
         * outra em `opcoes_texto`. "Pizza 1 · Sabores: Calabresa" se partia em
         * DOIS pedaços — "Pizza 1" virava texto solto, repetido a cada sabor, e o
         * cupom saía com o rótulo intercalado em vez de agrupando.
         *
         * ` | ` é ASCII (imprime em qualquer code page da térmica) e não aparece
         * em nome de grupo na prática.
         */
        const rotulo = alvo.rotulo ? `${alvo.rotulo} | ` : '';
        partesTexto.push(p.fracoes > 1 && totalFracoes > 1
          ? `${rotulo}${grupo.nome}: ${p.fracoes}/${totalFracoes} ${nome}`
          : `${rotulo}${grupo.nome}: ${nome}`);
      }
    }
  }

  /*
   * Opção que o cliente mandou e nenhum slot reconheceu: recusa. Silenciar
   * cobraria a menos — o cliente veria o acréscimo na tela e não no total.
   */
  const chaveDe = (e: EscolhaSlot) => `${e.slot}:${e.opcao_id}`;
  const vistas = new Set(reconhecidas.map(chaveDe));
  if (escolhas.some(e => !vistas.has(chaveDe(e)))) {
    throw erroHttp(400, `Há opções inválidas no item "${produto.nome}". Atualize a página e tente de novo.`);
  }

  return {
    precoUnit,
    opcoesTexto: partesTexto.join(' · '),
    opcoesIds: serializarEscolhas(reconhecidas),
  };
}
