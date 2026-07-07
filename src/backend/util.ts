/**
 * Utilitários compartilhados: datas em UTC, validação e saneamento de entradas.
 */

/** Data/hora atual em UTC, formato ISO 8601 (ex.: 2026-06-12T14:30:00.000Z). */
export function agoraUTC(): string {
  return new Date().toISOString();
}

/**
 * Saneia uma string vinda do cliente: garante o tipo, apara espaços e limita
 * o tamanho. O escape de HTML (proteção XSS) é feito na EXIBIÇÃO, no frontend;
 * aqui evitamos payloads gigantes e tipos inesperados.
 */
export function textoLimpo(valor: unknown, max = 500): string {
  if (typeof valor !== 'string') return '';
  return valor.trim().slice(0, max);
}

/** Converte para inteiro positivo ou retorna null se inválido. */
export function inteiroPositivo(valor: unknown): number | null {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/** Converte um valor em reais (ex.: "12,50" ou 12.5) para centavos (inteiro). */
export function reaisParaCentavos(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor).replace(/\./g, '').replace(',', '.');
  const n = typeof valor === 'number' ? valor : Number(texto);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Valida formato básico de e-mail. */
export function emailValido(email: unknown): email is string {
  return typeof email === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && email.length <= 200;
}

/** Só os 11 dígitos do CPF (remove máscara). */
export function cpfDigitos(cpf: unknown): string {
  return typeof cpf === 'string' ? cpf.replace(/\D/g, '').slice(0, 11) : '';
}

/** Valida CPF pelos dígitos verificadores (rejeita sequências iguais). */
export function cpfValido(cpf: unknown): boolean {
  const d = cpfDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dig = (base: number) => {
    let soma = 0;
    for (let i = 0; i < base; i++) soma += parseInt(d[i], 10) * (base + 1 - i);
    const r = 11 - (soma % 11);
    return r >= 10 ? 0 : r;
  };
  return dig(9) === parseInt(d[9], 10) && dig(10) === parseInt(d[10], 10);
}

/** Erro de negócio com status HTTP. */
export class ErroHttp extends Error {
  public readonly statusHttp: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.statusHttp = status;
  }
}

/** Fábrica conveniente, mantém a API antiga `erroHttp(400, ...)`. */
export function erroHttp(status: number, mensagem: string): ErroHttp {
  return new ErroHttp(status, mensagem);
}

/* ─────────────── Horário de funcionamento automático ─────────────── */

/** Um dia da agenda semanal. dia: 0=domingo … 6=sábado. */
export interface DiaHorario {
  dia: number;
  aberto: boolean;
  abre: string;   // "HH:MM"
  fecha: string;  // "HH:MM"
}

/** Fuso de Brasília (UTC-3). O app é voltado ao Brasil. */
const OFFSET_BR_MINUTOS = -3 * 60;

/** Retorna { diaSemana, minutos } no horário de Brasília, independente do TZ do servidor. */
function agoraBrasilia(): { dia: number; minutos: number } {
  const agora = new Date();
  // Converte para minutos UTC e aplica offset do Brasil.
  const utcMin = agora.getUTCHours() * 60 + agora.getUTCMinutes();
  let totalMin = utcMin + OFFSET_BR_MINUTOS;
  let dia = agora.getUTCDay();
  if (totalMin < 0) { totalMin += 1440; dia = (dia + 6) % 7; }
  else if (totalMin >= 1440) { totalMin -= 1440; dia = (dia + 1) % 7; }
  return { dia, minutos: totalMin };
}

function hhmmParaMinutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Decide se a loja deve estar ABERTA agora conforme a agenda semanal.
 * Suporta turnos que cruzam a meia-noite (ex.: abre 18:00, fecha 02:00).
 * Retorna null quando não há agenda válida (não deve sobrescrever o manual).
 */
export function lojaAbertaPorAgenda(horarioJson: string): boolean | null {
  let agenda: DiaHorario[];
  try { agenda = JSON.parse(horarioJson || '[]'); }
  catch { return null; }
  if (!Array.isArray(agenda) || agenda.length === 0) return null;

  const { dia, minutos } = agoraBrasilia();

  // Checa o dia de hoje e o de ontem (para turnos que viram a noite).
  for (const offset of [0, -1]) {
    const d = (dia + offset + 7) % 7;
    const regra = agenda.find(r => r.dia === d);
    if (!regra || !regra.aberto) continue;
    const ini = hhmmParaMinutos(regra.abre);
    const fim = hhmmParaMinutos(regra.fecha);
    if (ini === null || fim === null) continue;
    if (fim > ini) {
      // Turno normal no mesmo dia.
      if (offset === 0 && minutos >= ini && minutos < fim) return true;
    } else {
      // Turno cruza a meia-noite.
      if (offset === 0 && minutos >= ini) return true;        // antes da meia-noite
      if (offset === -1 && minutos < fim) return true;        // depois da meia-noite (madrugada de hoje)
    }
  }
  return false;
}

/** Próxima abertura legível, ex.: "abre seg 18:00". Retorna '' se sempre fechada. */
export function proximaAbertura(horarioJson: string): string {
  let agenda: DiaHorario[];
  try { agenda = JSON.parse(horarioJson || '[]'); }
  catch { return ''; }
  if (!Array.isArray(agenda)) return '';
  const nomes = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const { dia, minutos } = agoraBrasilia();
  for (let i = 0; i < 7; i++) {
    const d = (dia + i) % 7;
    const regra = agenda.find(r => r.dia === d && r.aberto);
    if (!regra) continue;
    const ini = hhmmParaMinutos(regra.abre);
    if (ini === null) continue;
    if (i === 0 && minutos >= ini) continue; // já passou hoje
    return `abre ${nomes[d]} ${regra.abre}`;
  }
  return '';
}
