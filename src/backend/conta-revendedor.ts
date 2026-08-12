/**
 * Quanto o revendedor paga no mês.
 *
 * Duas parcelas: a MENSALIDADE por cliente ativo e os MÓDULOS ligados nesses
 * clientes. O que ele cobra do cliente final não entra — a plataforma não sabe
 * e não precisa saber.
 *
 * Módulo puro porque isto é dinheiro: um engano aqui vira cobrança errada, e
 * cobrança errada só aparece quando alguém reclama.
 */

export interface ClienteNaConta {
  /** Cliente suspenso não gera cobrança — nem mensalidade, nem módulo. */
  ativo: boolean;
  /** Preço de cada módulo ligado NESTE cliente, em centavos. */
  modulos: number[];
}

export interface ContaDoMes {
  clientes_ativos: number;
  mensalidades_centavos: number;
  modulos_centavos: number;
  total_centavos: number;
}

/**
 * `custoPorCliente` é a mensalidade fixa que o revendedor paga por cliente
 * ativo.
 *
 * CLIENTE SUSPENSO ZERA TUDO DELE, inclusive os módulos: o módulo é um extra
 * sobre um serviço que, suspenso, não está sendo prestado. Cobrar módulo de
 * loja fora do ar é o tipo de linha que ninguém consegue justificar quando o
 * revendedor pergunta.
 */
export function contaDoMes(custoPorCliente: number, clientes: ClienteNaConta[]): ContaDoMes {
  const ativos = clientes.filter(c => c.ativo);
  const mensalidades = Math.max(0, custoPorCliente) * ativos.length;
  const modulos = ativos.reduce(
    (soma, c) => soma + c.modulos.reduce((s, p) => s + (Number(p) || 0), 0),
    0,
  );
  return {
    clientes_ativos: ativos.length,
    mensalidades_centavos: mensalidades,
    modulos_centavos: modulos,
    total_centavos: mensalidades + modulos,
  };
}
