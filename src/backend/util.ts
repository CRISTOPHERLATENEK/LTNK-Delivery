/**
 * Utilitários compartilhados: datas em UTC, validação e saneamento de entradas.
 */

/**
 * DATA do calendário no Brasil (YYYY-MM-DD).
 *
 * O servidor roda em UTC, e quem decide "que dia é hoje" com `agoraUTC()` erra
 * das 21h à meia-noite: nesse intervalo o UTC já virou o dia seguinte. Para
 * horário de funcionamento isso já era tratado (ver agoraBrasilia); para
 * qualquer regra ligada ao DIA do mês — fechamento de competência, envio
 * mensal — o erro é de um dia inteiro.
 *
 * Offset fixo de -3h porque o Brasil não tem mais horário de verão desde 2019.
 * Se voltar, esta função é o único lugar a mudar.
 *
 * `agoraMs` é parâmetro para dar teste: sem ele a função só seria testável
 * mexendo no relógio da máquina.
 */
export function dataBrasilia(agoraMs: number = Date.now()): string {
  return new Date(agoraMs - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Instante UTC da MEIA-NOITE de hoje no Brasil, em ISO.
 *
 * É o corte para "hoje" em consulta: `criado_em` é gravado em UTC, então o dia
 * do lojista começa às 03:00Z. Comparar com `<data>T00:00:00.000Z` cru zera o
 * "vendas de hoje" às 21h — no meio do movimento, e justo quando o caixa vai
 * fechar.
 */
export function inicioDoDiaBR(agoraMs: number = Date.now()): string {
  return `${dataBrasilia(agoraMs)}T03:00:00.000Z`;
}

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

/**
 * Normaliza nome de bairro pra comparação tolerante: remove acentos, baixa
 * caixa, expande abreviações comuns de endereço BR e junta espaços. Evita que
 * "Jd. Sofia" (digitado pelo lojista) e "Jardim Sofia" (devolvido pelo ViaCEP,
 * ou vice-versa) sejam tratados como bairros diferentes e o cliente caia
 * silenciosamente na taxa de entrega padrão em vez da taxa da zona certa.
 */
export function normalizarBairro(valor: string): string {
  return (valor || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .replace(/\bjd\.?\b/g, 'jardim')
    .replace(/\bvl\.?\b/g, 'vila')
    .replace(/\bpq\.?\b/g, 'parque')
    .replace(/\bres\.?\b/g, 'residencial')
    .replace(/\bconj\.?\b/g, 'conjunto')
    .replace(/\bcj\.?\b/g, 'conjunto')
    .replace(/[^a-z0-9\s]/g, '') // remove pontuação restante
    .replace(/\s+/g, ' ')
    .trim();
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

/** Telefone só com dígitos (DDD + número, sem máscara) — usado como chave de login do cliente. */
export function telefoneDigitos(telefone: unknown): string {
  return typeof telefone === 'string' ? telefone.replace(/\D/g, '').slice(0, 11) : '';
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

/**
 * Traduz violação de índice ÚNICO do MySQL na mensagem do campo que colidiu.
 * Devolve null quando o erro é outra coisa (o chamador segue tratando como 500).
 *
 * POR QUE PELO NOME DO ÍNDICE: a mensagem do MySQL para uma coluna GERADA não
 * cita a coluna original. Telefone e CPF em `usuarios` são índices únicos sobre
 * `telefone_unico`/`cpf_unico` (NULLIF da coluna real, pra permitir vários
 * vazios), então a única pista confiável é o nome do índice.
 *
 * Sem isto, cadastrar entregador com telefone já usado por OUTRO usuário
 * devolvia "Erro interno do servidor" — o lojista não tinha como saber que o
 * problema era o telefone, e nem que o telefone precisa ser único.
 */
const MENSAGENS_INDICE: Array<[RegExp, string]> = [
  [/idx_usuarios_telefone_unico/i, 'Este telefone já está cadastrado em outra conta. Use outro número.'],
  [/idx_usuarios_cpf/i,            'Este CPF já está cadastrado em outra conta.'],
  [/usuarios\.email|for key 'email'/i, 'Já existe uma conta com este e-mail.'],
  [/idx_pedidos_idempotencia/i,    'Esta venda já foi registrada.'],
  [/uq_mesa_numero/i,              'Já existe uma mesa com esse número.'],
  [/uq_produto_ean/i,              'Outro produto desta loja já usa este código de barras. Bipar no PDV com o código repetido entraria no produto errado.'],
  [/uq_pag_competencia/i,          'O pagamento deste mês já foi registrado para esta assinatura.'],
  [/uq_avaliacao_pedido/i,         'Você já avaliou este pedido.'],
  [/uq_avaliacao_entregador_pedido/i, 'Você já avaliou o entregador deste pedido.'],
  [/dominio_personalizado/i,       'Este domínio já está sendo usado por outra loja.'],
  [/lojas\.slug|for key 'slug'/i,  'Este endereço (slug) já está em uso por outra loja.'],
];

export function mensagemDeDuplicidade(erro: unknown): string | null {
  const e = erro as { code?: string; sqlMessage?: string; message?: string } | null;
  if (!e || (e.code !== 'ER_DUP_ENTRY' && e.code !== 'ER_DUP_KEY')) return null;
  const texto = `${e.sqlMessage || ''} ${e.message || ''}`;
  for (const [padrao, mensagem] of MENSAGENS_INDICE) {
    if (padrao.test(texto)) return mensagem;
  }
  // Índice único que ainda não mapeamos: 409 genérico continua muito melhor que
  // 500 — diz que é dado repetido, não falha do servidor.
  return 'Já existe um registro com esses dados.';
}
