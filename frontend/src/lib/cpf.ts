/**
 * Utilitários de CPF do cliente: máscara 000.000.000-00 e validação pelos
 * dígitos verificadores. O CPF é a chave de login do cliente (ver auth).
 */

/** Só os 11 dígitos do CPF (remove máscara). */
export function cpfDigitos(cpf: string): string {
  return (cpf || '').replace(/\D/g, '').slice(0, 11);
}

/** Formata como 000.000.000-00 enquanto digita. */
export function formatarCpf(cpf: string): string {
  const d = cpfDigitos(cpf);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

/** Valida o CPF pelos dígitos verificadores (rejeita sequências iguais). */
export function cpfValido(cpf: string): boolean {
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
