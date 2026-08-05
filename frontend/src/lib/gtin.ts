/**
 * Validação de GTIN (EAN-8/12/13/14) para AVISAR o lojista no cadastro.
 *
 * CÓPIA CONSCIENTE de `src/backend/codigo-produto.ts` — não há módulo
 * compartilhado entre backend e frontend neste projeto, e a alternativa (pedir a
 * validação pra API a cada tecla) seria pior. O backend continua sendo a
 * autoridade: quem decide o que vai no `cEAN` da nota é ele, aqui é só o aviso.
 * Se mexer em um, mexa no outro.
 */
export function gtinValido(codigo: string | null | undefined): boolean {
  const s = String(codigo || '').trim();
  if (!/^\d+$/.test(s)) return false;
  if (![8, 12, 13, 14].includes(s.length)) return false;
  const corpo = s.slice(0, -1);
  let soma = 0;
  for (let i = 0; i < corpo.length; i++) {
    soma += Number(corpo[corpo.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (soma % 10)) % 10 === Number(s[s.length - 1]);
}
