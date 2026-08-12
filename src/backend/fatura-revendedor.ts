/**
 * A conta do revendedor QUEBRADA POR CLIENTE, e a aritmética de competência.
 *
 * `conta-revendedor.ts` responde "quanto dá no total". Aqui responde "de onde
 * veio cada real" — que é o que o revendedor pergunta quando o valor sobe e ele
 * não sabe se foi cliente novo ou módulo ligado.
 *
 * Módulo puro pelo mesmo motivo do outro: é dinheiro. E o total daqui TEM que
 * bater com o de lá — há um teste só pra isso, porque duas somas independentes
 * do mesmo dinheiro divergem cedo ou tarde, e aí a discussão vira sobre qual
 * tela está certa.
 */
import { contaDoMes, type ContaDoMes } from './conta-revendedor';

export interface ModuloNaLinha {
  nome: string;
  preco_centavos: number;
}

export interface ClienteNaFatura {
  id: number;
  nome: string;
  ativo: boolean;
  modulos: ModuloNaLinha[];
}

export interface LinhaDaFatura {
  tenant_id: number;
  nome: string;
  ativo: boolean;
  mensalidade_centavos: number;
  modulos: ModuloNaLinha[];
  modulos_centavos: number;
  total_centavos: number;
}

export interface FaturaDetalhada extends ContaDoMes {
  linhas: LinhaDaFatura[];
}

/** Competência (YYYY-MM) de uma data ISO. */
export function competenciaDe(iso: string): string {
  return String(iso).slice(0, 7);
}

/** Competência anterior a `YYYY-MM`. Vira o ano em janeiro. */
export function mesAnterior(competencia: string): string {
  const [ano, mes] = competencia.split('-').map(Number);
  if (!ano || !mes) return competencia;
  return mes === 1
    ? `${ano - 1}-12`
    : `${ano}-${String(mes - 1).padStart(2, '0')}`;
}

/**
 * Uma linha por cliente, mais os totais.
 *
 * CLIENTE SUSPENSO CONTINUA NA LISTA, zerado. Sumir com ele esconderia
 * justamente a resposta pra "por que caiu?" — e o revendedor abriria um chamado
 * pra descobrir o que a própria tela podia ter mostrado.
 */
export function faturaDetalhada(custoPorCliente: number, clientes: ClienteNaFatura[]): FaturaDetalhada {
  const mensalidade = Math.max(0, Number(custoPorCliente) || 0);

  const linhas: LinhaDaFatura[] = clientes.map((c) => {
    const modulosCentavos = c.modulos.reduce((s, m) => s + (Number(m.preco_centavos) || 0), 0);
    // Suspenso não paga nada — nem mensalidade, nem módulo. Mesma regra de
    // contaDoMes; a linha mostra os módulos que ele TEM, cobrando zero.
    const cobra = c.ativo;
    return {
      tenant_id: c.id,
      nome: c.nome,
      ativo: c.ativo,
      mensalidade_centavos: cobra ? mensalidade : 0,
      modulos: c.modulos,
      modulos_centavos: cobra ? modulosCentavos : 0,
      total_centavos: cobra ? mensalidade + modulosCentavos : 0,
    };
  });

  const conta = contaDoMes(custoPorCliente, clientes.map(c => ({
    ativo: c.ativo,
    modulos: c.modulos.map(m => m.preco_centavos),
  })));

  return { ...conta, linhas };
}
