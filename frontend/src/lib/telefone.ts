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
