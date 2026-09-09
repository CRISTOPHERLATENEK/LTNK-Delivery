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

/** O id do `<datalist>` compartilhado pelas duas telas. */
export const ID_LISTA_SEGMENTOS = 'segmentos-loja-sugestoes';
