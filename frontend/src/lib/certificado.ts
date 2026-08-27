/**
 * O aviso de certificado vencendo.
 *
 * A tela Fiscal já mostra a data e explica que "vencido, a emissão para no
 * mesmo dia". O problema é que só aparece PARA QUEM ABRE AQUELA TELA — e o
 * certificado vale um ano. Ninguém visita a tela Fiscal por meses; o jeito
 * normal de descobrir é numa segunda de manhã, com a nota falhando e o cliente
 * esperando no balcão.
 *
 * A regra mora aqui, pura, porque é aritmética de data com dois limiares e um
 * caso de borda que decide se o aviso serve pra alguma coisa: o dia do
 * vencimento ainda é válido, e tratá-lo como vencido faria a loja parar de
 * emitir um dia antes por conta do aviso.
 */

export type NivelAviso = 'atencao' | 'urgente' | 'vencido';

export interface AvisoCertificado {
  nivel: NivelAviso;
  /** Dias inteiros até vencer. Negativo quando já venceu. */
  dias: number;
}

/** Faltando isto ou menos, o aviso aparece. */
const DIAS_ATENCAO = 30;
/** Daqui pra baixo o tom muda: já não dá pra deixar pra semana que vem. */
const DIAS_URGENTE = 7;

/**
 * Devolve o aviso, ou `null` quando não há o que avisar.
 *
 * `null` também quando a NFC-e está desligada: loja que não emite nota não tem
 * nada a resolver, e alarme sem ação possível é ruído que ensina a ignorar
 * todos os outros.
 */
export function avisoCertificado(
  validadeISO: string | null | undefined,
  nfceAtivo: boolean,
  agora: Date = new Date(),
): AvisoCertificado | null {
  if (!nfceAtivo || !validadeISO) return null;
  const fim = new Date(validadeISO);
  if (Number.isNaN(fim.getTime())) return null;

  /*
   * Conta por DIA DE CALENDÁRIO, não por intervalo de 24h.
   *
   * Com diferença bruta em horas, um certificado que vence hoje às 23h daria
   * "0 dias" de manhã e "-1" à tarde — o aviso mudaria de tom no meio do
   * expediente sem nada ter mudado. Zerando as horas dos dois lados, "vence
   * hoje" vale o dia inteiro, que é como a pessoa pensa no assunto.
   */
  const dia = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const dias = Math.round((dia(fim) - dia(agora)) / 86400000);

  /* Vencido é dia SEGUINTE em diante: no dia do vencimento o certificado ainda
     assina, e antecipar o alarme faria a loja parar um dia antes à toa. */
  if (dias < 0) return { nivel: 'vencido', dias };
  if (dias <= DIAS_URGENTE) return { nivel: 'urgente', dias };
  if (dias <= DIAS_ATENCAO) return { nivel: 'atencao', dias };
  return null;
}

/** Texto pronto do aviso — mesma frase na tela e em qualquer outro canal. */
export function textoAvisoCertificado(aviso: AvisoCertificado): string {
  if (aviso.nivel === 'vencido') {
    const d = Math.abs(aviso.dias);
    return `O certificado digital venceu há ${d} ${d === 1 ? 'dia' : 'dias'}. A emissão de NFC-e está parada até instalar um novo.`;
  }
  if (aviso.dias === 0) return 'O certificado digital vence HOJE. Amanhã a emissão de NFC-e para.';
  return `O certificado digital vence em ${aviso.dias} ${aviso.dias === 1 ? 'dia' : 'dias'}. Vencido, a emissão de NFC-e para no mesmo dia.`;
}
