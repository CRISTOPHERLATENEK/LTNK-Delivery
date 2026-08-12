/**
 * Quando mandar os XMLs pro contador, e pra quem.
 *
 * Módulo puro porque errar aqui é dos dois jeitos ruim: enviar duas vezes faz o
 * contador escriturar em dobro, e não enviar deixa o lojista achando que
 * mandou. As duas falhas só aparecem no fim do mês, quando já é tarde.
 */

/** Último dia de um mês (competência 'YYYY-MM'). */
export function ultimoDiaDoMes(competencia: string): number {
  const [ano, mes] = competencia.split('-').map(Number);
  if (!ano || !mes) return 28;
  // Dia 0 do mês seguinte = último dia deste. Vale pra fevereiro bissexto sem
  // tabela nenhuma.
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * Competência ANTERIOR à data ISO informada. É sempre o mês fechado que vai pro
 * contador — o mês corrente ainda vai receber notas.
 */
export function competenciaAEnviar(hojeIso: string): string {
  const [ano, mes] = hojeIso.slice(0, 7).split('-').map(Number);
  if (!ano || !mes) return hojeIso.slice(0, 7);
  return mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, '0')}`;
}

export interface EstadoEnvio {
  /** Data de hoje em ISO (só a parte da data importa). */
  hojeIso: string;
  /** Envio automático ligado pelo lojista. */
  auto: boolean;
  /** Tem ao menos um destinatário válido cadastrado. */
  temDestinatario: boolean;
  /** Dia do mês escolhido pelo lojista (1-31). */
  diaEnvio: number;
  /** Competência do último envio bem-sucedido ('' se nunca enviou). */
  ultimaCompetencia: string;
}

/**
 * Decide se hoje é dia de mandar, e de qual mês.
 *
 * O DIA ESCOLHIDO É CLAMPADO ao último dia do mês: quem escolhe 31 receberia
 * em janeiro e nunca mais em fevereiro. O envio dispara "no dia OU depois",
 * não "no dia exato", porque o servidor pode ter passado a data fora do ar — e
 * um envio que não acontece é pior que um envio atrasado.
 */
export function deveEnviar(e: EstadoEnvio): { enviar: boolean; competencia: string } {
  const competencia = competenciaAEnviar(e.hojeIso);
  if (!e.auto || !e.temDestinatario) return { enviar: false, competencia };

  // Já mandou este mês fechado: não manda de novo, nem que o job rode 10 vezes.
  if (e.ultimaCompetencia === competencia) return { enviar: false, competencia };
  /*
   * Última competência MAIOR que a alvo significa relógio pra trás ou dado
   * estranho. Não reenviar é o lado seguro: o contador já recebeu algo mais
   * recente.
   */
  if (e.ultimaCompetencia > competencia) return { enviar: false, competencia };

  const mesAtual = e.hojeIso.slice(0, 7);
  const diaHoje = Number(e.hojeIso.slice(8, 10));
  const dia = Math.min(Math.max(Math.trunc(e.diaEnvio) || 1, 1), ultimoDiaDoMes(mesAtual));
  return { enviar: diaHoje >= dia, competencia };
}

/**
 * Extrai os destinatários de um campo de texto livre.
 *
 * Aceita vírgula, ponto e vírgula e espaço porque é assim que a pessoa digita
 * quando o contador tem dois e-mails. Endereço sem cara de e-mail é DESCARTADO
 * em silêncio aqui — quem valida na hora de salvar é a rota, que consegue
 * avisar; no envio, derrubar a remessa inteira por causa de um endereço torto
 * seria pior que mandar pros que estão certos.
 */
export function destinatariosDe(texto: string | null | undefined): string[] {
  const partes = String(texto ?? '').split(/[,;\s]+/).map(p => p.trim().toLowerCase()).filter(Boolean);
  const validos = partes.filter(p => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(p));
  // Sem repetidos: o mesmo endereço duas vezes manda duas cópias.
  return [...new Set(validos)].slice(0, 5);
}
