/**
 * A porta de entrada da agenda semanal: valida e normaliza o que o cliente
 * manda antes de virar `horario_json` no banco.
 *
 * Mora fora das rotas pra poder ser testada sem subir o servidor — e ela merece
 * teste: é o que decide o horário em que a loja abre, e um par inválido virando
 * "00:00" silenciosamente fecha a loja num horário que ninguém digitou.
 */
import { erroHttp } from './util';

/** Valida o JSON da agenda semanal e devolve uma versão normalizada. */
export function validarHorarioJson(bruto: unknown): string {
  let arr: any;
  if (typeof bruto === 'string') {
    try { arr = JSON.parse(bruto); } catch { throw erroHttp(400, 'Agenda de horários inválida.'); }
  } else {
    arr = bruto;
  }
  if (!Array.isArray(arr)) throw erroHttp(400, 'Agenda de horários inválida.');
  const hhmm = /^(\d{1,2}):(\d{2})$/;
  const norm = arr
    .filter(d => d && typeof d.dia === 'number' && d.dia >= 0 && d.dia <= 6)
    .map(d => {
      const aberto = !!d.aberto;
      /*
       * VALIDA O VALOR, NÃO SÓ A FORMA.
       *
       * O regex `^(\d{1,2}):(\d{2})$` aceita "99:99" — e isso ia pro banco. Não
       * quebrava nada porque `hhmmParaMinutos`, na leitura, recusa hora > 23 e
       * descarta o turno; ou seja, o lojista digitava um horário, a tela
       * gravava, e o turno simplesmente não valia. Falha silenciosa: o pior
       * lugar pra ter uma é o horário que decide se a loja abre.
       */
      const hora = (v: unknown) => {
        if (typeof v !== 'string') return null;
        const m = hhmm.exec(v);
        if (!m) return null;
        return Number(m[1]) <= 23 && Number(m[2]) <= 59 ? v : null;
      };
      /*
       * TURNOS: quem fecha entre o almoço e a janta.
       *
       * `abre`/`fecha` continuam sendo gravados com o PRIMEIRO turno. Não é
       * redundância: toda agenda já no banco tem esse formato, e é por ele que
       * um leitor antigo (ou um backup restaurado) continua enxergando horário
       * em vez de dia vazio.
       *
       * Turno com hora inválida é DESCARTADO em vez de virar 00:00 — um par
       * 00:00–00:00 no meio da lista fecharia a loja num horário que o lojista
       * nunca digitou.
       */
      const brutos: unknown[] = Array.isArray(d.turnos) && d.turnos.length > 0
        ? d.turnos
        : [{ abre: d.abre, fecha: d.fecha }];
      const turnos = brutos
        .map(t => {
          const o = t as { abre?: unknown; fecha?: unknown };
          const a = hora(o?.abre), f = hora(o?.fecha);
          return a && f ? { abre: a, fecha: f } : null;
        })
        .filter((t): t is { abre: string; fecha: string } => t !== null)
        .sort((a, b) => a.abre.localeCompare(b.abre))
        /* Dois turnos bastam pra almoço e janta; o limite existe pra uma lista
           enorme vinda do cliente não virar JSON gigante gravado a cada save. */
        .slice(0, 4);
      const primeiro = turnos[0] || { abre: '00:00', fecha: '00:00' };
      return { dia: d.dia, aberto, abre: primeiro.abre, fecha: primeiro.fecha, turnos };
    });
  return JSON.stringify(norm);
}
