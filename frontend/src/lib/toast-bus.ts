/**
 * Ponte para disparar toast de FORA do React.
 *
 * POR QUE EXISTE: o toast só é alcançável por `useToast()`, dentro da árvore de
 * componentes. Quem precisa avisar de falha aqui é o cache do React Query, criado
 * em main.tsx antes de qualquer componente existir — sem esta ponte, a única
 * alternativa seria repetir tratamento de erro nas 61 consultas do projeto e
 * confiar em nunca esquecer nenhuma.
 *
 * Deliberadamente minúsculo: um assinante (o ToastProvider) e uma função de
 * emissão. Não é um event bus de propósito geral — nada mais deveria usar isto
 * para se comunicar entre telas, porque estado que atravessa a árvore por fora
 * do React é exatamente o que fica impossível de depurar depois.
 */
export interface ToastPedido {
  titulo: string;
  descricao?: string;
  tipo: 'sucesso' | 'erro' | 'info';
}

let assinante: ((t: ToastPedido) => void) | null = null;

/** Chamado pelo ToastProvider ao montar. Devolve a função de cancelamento. */
export function assinarToast(fn: (t: ToastPedido) => void): () => void {
  assinante = fn;
  return () => { if (assinante === fn) assinante = null; };
}

/** Antes do provider montar não há ninguém pra mostrar — perde-se em silêncio. */
export function emitirToast(t: ToastPedido): void {
  assinante?.(t);
}
