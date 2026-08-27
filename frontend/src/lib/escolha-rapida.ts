/**
 * A numeração da lista compacta do PDV — escolher por número, sem mouse.
 *
 * No balcão o atendente tem o cliente na frente e as duas mãos ocupadas. O
 * modal do cliente é bom pra quem escolhe com calma, e ruim pra quem repete a
 * operação cem vezes por noite: cada opção é um clique e um alvo pequeno.
 *
 * Aqui cada opção ganha UM número, contínuo entre grupos. Um espaço de números
 * só — o atendente não navega entre grupos, não muda de aba, não tira a mão do
 * teclado.
 */

/** Uma opção numerada, já sabendo de qual slot e grupo veio. */
export interface OpcaoNumerada {
  numero: number;
  slot: number;
  grupoId: number;
  opcaoId: number;
}

/**
 * Numera as opções na ordem em que aparecem — slot, grupo, opção.
 *
 * A ordem é a MESMA da tela, e é o que faz o número ser confiável: o atendente
 * decora "3 é gigante" e isso vale enquanto o cardápio não mudar.
 */
export function numerarOpcoes(
  slots: Array<{ slot: number; grupos: Array<{ id: number; opcoes: Array<{ id: number }> }> }>,
): OpcaoNumerada[] {
  const lista: OpcaoNumerada[] = [];
  let n = 0;
  for (const s of slots) {
    for (const g of s.grupos) {
      for (const o of g.opcoes) {
        n += 1;
        lista.push({ numero: n, slot: s.slot, grupoId: g.id, opcaoId: o.id });
      }
    }
  }
  return lista;
}

export interface Digitado {
  /** Número a aplicar agora, ou `null` se ainda não dá pra decidir. */
  aplicar: number | null;
  /** O que continua no buffer aparecendo na tela. */
  buffer: string;
}

/**
 * Decide o que fazer com os dígitos já digitados.
 *
 * A REGRA É A AMBIGUIDADE DE PREFIXO, e é ela que faz a lista compacta valer a
 * pena. Com 27 sabores, digitar "5" só pode ser o 5 — nenhum número começa com
 * 5 e continua (50..59 não existem), então aplica NA HORA. Digitar "1" pode ser
 * 1, 12 ou 19: aí espera o próximo dígito.
 *
 * Sem isso haveria duas saídas, as duas piores: exigir uma tecla de confirmação
 * por opção (dobra o esforço no caso comum) ou aplicar sempre o primeiro dígito
 * (torna as opções de 10 em diante inalcançáveis).
 */
export function resolverDigitado(buffer: string, total: number): Digitado {
  if (!/^\d+$/.test(buffer)) return { aplicar: null, buffer: '' };
  const n = Number(buffer);

  /* Passou do fim da lista: o dígito não serve pra nada, e limpar é melhor que
     acumular — senão o próximo dígito herda um buffer inválido e a tecla
     seguinte também parece não funcionar. */
  if (n > total) return { aplicar: null, buffer: '' };
  /* Zero à esquerda não identifica nada e trava o buffer. */
  if (n === 0) return { aplicar: null, buffer: '' };

  /* Existe algum número que COMEÇA com o que foi digitado e é maior? Se sim,
     ainda pode vir mais dígito. */
  const podeCrescer = Number(buffer + '0') <= total;
  return podeCrescer ? { aplicar: null, buffer } : { aplicar: n, buffer: '' };
}
