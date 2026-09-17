/**
 * SEGMENTOS SUGERIDOS PARA UMA LOJA (`lojas.categoria`).
 *
 * Sugestão, não lista fechada: o campo é texto livre com `datalist`, então
 * segmento que ninguém previu se digita. A lista existe para o caso comum não
 * exigir digitação e para os nomes saírem padronizados — "Pizzaria" e
 * "pizzaria" viram dois filtros diferentes na vitrine.
 *
 * DEIXOU DE SER SÓ COMIDA. Tinha dez opções e todas eram restaurante,
 * lanchonete ou doce — o primeiro cliente que não vende comida (uma
 * conveniência com foco em bebidas) ficou em "Outros", que é o balde de quem
 * não foi previsto. Cadastro sem a opção certa não fica vazio: fica errado, e o
 * filtro da vitrine erra junto.
 *
 * MORA AQUI, e não na tela, porque são DUAS telas: o admin escolhe no cadastro
 * do cliente e o lojista pode trocar depois, no painel dele. Antes só o admin
 * tinha sugestão, e a do lojista era um `placeholder` com três exemplos de
 * comida — as duas telas discordando sobre o que a plataforma atende.
 */
export const SEGMENTOS_SUGERIDOS = [
  /* Comida preparada — o caso mais comum, e por isso primeiro. */
  'Pizzaria', 'Hamburgueria', 'Açaiteria', 'Padaria', 'Sorveteria', 'Sushiteria',
  'Restaurante', 'Lanchonete', 'Marmitaria', 'Doceria', 'Cafeteria',
  /*
   * Revenda: bebida, conveniência e mercado.
   *
   * Quem vende produto de prateleira tem operação diferente de quem cozinha —
   * estoque grande, cardápio importado de ERP, e às vezes nenhum pagamento
   * online (ver o interruptor `pagamento_online`).
   */
  'Conveniência', 'Adega', 'Distribuidora de bebidas', 'Mercado', 'Tabacaria',
];

/**
 * O SEGMENTO PREPARA COMIDA?
 *
 * Decide se a loja vê os modelos prontos de complemento — Borda, Ponto da
 * carne, Sabores, Adicionais. Numa conveniência eles são seis cliques errados
 * esperando acontecer: o lojista do Galdério olhou a tela e disse "pra que
 * isso? na conveniência não vou precisar".
 *
 * A LISTA É DE QUEM *NÃO* PREPARA, e não de quem prepara, de propósito. O campo
 * é texto livre: "Pizzaria do Zé", "Hamburgueria artesanal" e "Restaurante
 * japonês" são segmentos que ninguém previu, e todos preparam comida. Listar os
 * revendedores (que são poucos e nomeados) e assumir comida no resto erra do
 * lado seguro — mostrar um modelo a mais é ruído; esconder de quem precisa é
 * recurso que some.
 */
const REVENDA = /conveni[êe]ncia|adega|distribuidora|mercado|tabacaria|bebida|empório|emporio/i;

export function preparaComida(segmento: string | null | undefined): boolean {
  const s = (segmento || '').trim();
  /* Sem segmento cadastrado, mostra tudo: esconder por palpite é pior que
     mostrar demais. */
  if (!s) return true;
  return !REVENDA.test(s);
}

/** O id do `<datalist>` compartilhado pelas duas telas. */
export const ID_LISTA_SEGMENTOS = 'segmentos-loja-sugestoes';
