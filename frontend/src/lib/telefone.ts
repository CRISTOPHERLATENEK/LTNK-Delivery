/**
 * Telefone do cliente — agora é também usado como chave de LOGIN (além do
 * e-mail), então o backend guarda só os dígitos (sem máscara) pra garantir
 * que "(11) 99999-9999" e "11999999999" batam com a mesma conta.
 */

/** Só os dígitos do telefone (remove máscara), DDD + número, até 11 dígitos. */
export function telefoneDigitos(telefone: string): string {
  return (telefone || '').replace(/\D/g, '').slice(0, 11);
}

/** Formata como (00) 00000-0000 (ou (00) 0000-0000 pra fixo) enquanto digita. */
export function formatarTelefone(telefone: string): string {
  const d = telefoneDigitos(telefone);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * TELEFONE VÁLIDO: 10 dígitos (fixo) ou 11 (celular), com DDD.
 *
 * Espelha `telefoneValido` do servidor (src/backend/util.ts) de propósito — a
 * regra é a MESMA, e a duplicação existe para a pessoa saber antes de enviar.
 * Quem manda é o servidor; esta cópia é conveniência, não cadeado. Se as duas
 * discordarem, o servidor recusa e a tela mostra o erro dele.
 *
 * Passou a existir quando o telefone virou o único campo obrigatório do
 * cadastro: campo opcional pode aceitar qualquer coisa, campo que é IDENTIDADE
 * não — telefone errado é conta que ninguém recupera.
 */
export function telefoneValido(telefone: string): boolean {
  /* Os dígitos CRUS: `telefoneDigitos` corta em 11, e um dígito a mais viraria
     um número válido diferente do digitado. Mesma razão do servidor. */
  const d = (telefone || '').replace(/\D/g, '');
  if (d.length !== 10 && d.length !== 11) return false;
  if (d[0] === '0') return false;
  if (d.length === 11 && d[2] !== '9') return false;
  if (/^(\d)\1+$/.test(d)) return false;
  return true;
}
