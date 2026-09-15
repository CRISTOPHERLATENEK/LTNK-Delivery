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
/*
 * ─────────── O TAMANHO ESCOLHIDO É O DO CELULAR; O DESKTOP SOBE UM DEGRAU ───
 *
 * Antes eram três medidas FIXAS, iguais num telefone de 375px e num monitor de
 * 1500px. Medido na loja de demonstração, com a faixa ocupando 702px de largura
 * no desktop:
 *
 *   médio  → bolha de 56px, rótulo de 11px  → 8% da faixa por categoria
 *   grande → bolha de 80px, rótulo de 12px
 *
 * Um rótulo de 11px a meio metro do monitor é a mesma altura aparente de 6px no
 * celular a 30cm. O lojista olhou a própria loja no computador e disse "acredito
 * que a visualização esteja pequena" — e estava mesmo.
 *
 * A ESCOLHA DELE VIRA A BASE, não o teto: quem escolheu "pequeno" continua com
 * a faixa discreta no telefone, e ganha legibilidade no desktop. Mexer só no
 * desktop é o que permite corrigir isso sem estragar o celular, que é onde a
 * maioria dos pedidos entra e onde as medidas atuais já estavam boas.
 *
 * O RÓTULO CRESCE MAIS QUE A BOLHA (11 → 13px no médio, +18%; a bolha vai de 56
 * a 80, +43% — mas ela já era legível). Ler o nome da categoria é o que a faixa
 * existe para permitir; a bolha é enfeite com ícone dentro.
 */
const MEDIDA: Record<TamanhoCategoria, { bolha: string; botao: string; icone: string; texto: string }> = {
  pequeno: {
    bolha: 'size-11 sm:size-14',
    botao: 'w-[60px] sm:w-[72px]',
    icone: 'size-5 sm:size-6',
    texto: 'text-[10px] sm:text-[11.5px]',
  },
  medio: {
    bolha: 'size-14 sm:size-16 lg:size-20',
    botao: 'w-[68px] sm:w-[80px] lg:w-[92px]',
    icone: 'size-6 sm:size-7 lg:size-8',
    texto: 'text-[11px] sm:text-[12px] lg:text-[13px]',
  },
  grande: {
    bolha: 'size-20 sm:size-24',
    botao: 'w-[88px] sm:w-[104px]',
    icone: 'size-8 sm:size-10',
    texto: 'text-[12px] sm:text-[13px] lg:text-[14px]',
  },
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
