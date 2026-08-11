/**
 * Aparência da faixa de categorias — formato e tamanho da bolha.
 *
 * FONTE ÚNICA das classes, usada pela vitrine do cliente E pela pré-visualização
 * do lojista. Duplicar isso significaria o lojista escolher "quadrado grande",
 * ver um jeito no editor e outro na loja — e ninguém descobre até um cliente
 * reclamar.
 */

export type FormatoCategoria = 'circulo' | 'arredondado' | 'quadrado';
export type TamanhoCategoria = 'pequeno' | 'medio' | 'grande';

export const FORMATOS: Array<{ valor: FormatoCategoria; rotulo: string }> = [
  { valor: 'circulo',     rotulo: 'Círculo' },
  { valor: 'arredondado', rotulo: 'Arredondado' },
  { valor: 'quadrado',    rotulo: 'Quadrado' },
];

export const TAMANHOS: Array<{ valor: TamanhoCategoria; rotulo: string }> = [
  { valor: 'pequeno', rotulo: 'Pequeno' },
  { valor: 'medio',   rotulo: 'Médio' },
  { valor: 'grande',  rotulo: 'Grande' },
];

const RAIO: Record<FormatoCategoria, string> = {
  circulo: 'rounded-full',
  arredondado: 'rounded-2xl',
  quadrado: 'rounded-md',
};

/*
 * A LARGURA DO BOTÃO acompanha a da bolha, mas com folga pro rótulo.
 *
 * Amarrar a largura ao tamanho da imagem faz "Bebidas geladas" quebrar em três
 * linhas no tamanho pequeno e desalinhar a faixa inteira — por isso a folga
 * cresce menos que a bolha.
 */
const MEDIDA: Record<TamanhoCategoria, { bolha: string; botao: string; icone: string; texto: string }> = {
  pequeno: { bolha: 'size-11', botao: 'w-[60px]', icone: 'size-5',   texto: 'text-[10px]' },
  medio:   { bolha: 'size-14', botao: 'w-[68px]', icone: 'size-6',   texto: 'text-[11px]' },
  grande:  { bolha: 'size-20', botao: 'w-[88px]', icone: 'size-8',   texto: 'text-[12px]' },
};

export function normalizarFormato(v: unknown): FormatoCategoria {
  return v === 'arredondado' || v === 'quadrado' ? v : 'circulo';
}

export function normalizarTamanho(v: unknown): TamanhoCategoria {
  return v === 'pequeno' || v === 'grande' ? v : 'medio';
}

/** Classes da bolha, do botão, do ícone e do rótulo para a combinação escolhida. */
export function classesCategoria(formato: unknown, tamanho: unknown) {
  const m = MEDIDA[normalizarTamanho(tamanho)];
  return { ...m, raio: RAIO[normalizarFormato(formato)] };
}
