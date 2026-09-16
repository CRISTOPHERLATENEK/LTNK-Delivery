/**
 * ACHAR UM PRODUTO PELO NOME, DO JEITO QUE AS PESSOAS DIGITAM.
 *
 * ──────────────────────── O QUE ESTAVA ERRADO ───────────────────────────────
 *
 * A busca do seletor de vínculo era `nome.toLowerCase().includes(texto)`. Numa
 * loja de bebidas com 1.211 produtos, isso falha em quase tudo que se digita:
 *
 *   "maca verde"        não achava BALY MAÇA VERDE      (acento)
 *   "monster tradicional" achava, mas atrás de outros 9 (ordem alfabética)
 *   "tradicional monster" não achava nada               (ordem das palavras)
 *   "77"                não achava MONSTER TRADICIONAL  (é o SKU dele)
 *   "  gelo  coco "     não achava                      (espaço a mais)
 *
 * Quem cadastra complemento tem o produto na mão ou o código na nota. As cinco
 * linhas acima são o que ele digita.
 *
 * ────────────────────────── COMO ISTO ORDENA ────────────────────────────────
 *
 * A pontuação é menor-é-melhor, e a ordem existe porque "monster" devolve 13
 * produtos: sem ranking, o que ele quer fica no meio da lista e ele rola até
 * desistir.
 *
 *   0  o código bate (SKU do ERP ou código de barras)
 *   1  o nome COMEÇA com o que foi digitado
 *   2  as palavras aparecem no nome, na ordem digitada
 *   3  as palavras aparecem no nome, em qualquer ordem
 *   4  casou pela categoria, não pelo nome
 *
 * Empate: primeiro quem tem SKU do Maxx Gestão (é o único que baixa estoque lá,
 * então é quase sempre o alvo), depois o nome mais curto — "MONSTER
 * TRADICIONAL 473ML" antes de "DIPLOKO SURPRISE PET MONSTER 11G" —, depois
 * alfabético, para a lista não mudar de ordem entre duas digitadas iguais.
 */

export interface ProdutoBuscavel {
  id: number;
  nome: string;
  categoria?: string | null;
  /** SKU no Maxx Gestão. 0 = não existe lá. */
  variacao_erp?: number;
  codigo_barras?: string | null;
}

/**
 * Minúsculas, sem acento, sem espaço sobrando.
 *
 * `normalize('NFD')` separa a letra do acento e o `replace` joga o acento fora
 * — é o que faz "maca" achar "MAÇÃ" sem precisar de tabela de equivalência.
 */
export function normalizar(texto: string): string {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Só dígitos — para comparar código de barras e SKU digitados com pontuação. */
function digitos(texto: string): string {
  return String(texto || '').replace(/\D/g, '');
}

/**
 * A pontuação de um produto para uma busca. `null` = não casa.
 *
 * Exportada por causa do teste: é aqui que a ordem da lista se decide, e uma
 * regra de ordenação que não se pode medir sozinha só se confere olhando a
 * tela e torcendo.
 */
export function pontuar(p: ProdutoBuscavel, consulta: string): number | null {
  const alvo = normalizar(consulta);
  if (!alvo) return 5;

  const nome = normalizar(p.nome);
  const categoria = normalizar(p.categoria || '');

  /*
   * CÓDIGO VENCE TUDO. Quem digita número está lendo uma etiqueta ou uma nota,
   * e nesse caso ele sabe exatamente qual produto quer — nenhum palpite por
   * nome deve passar na frente.
   *
   * O corte de 2 dígitos evita que "2" (que alguém digitou pensando em "2L")
   * case com o SKU 2 de um salgadinho qualquer.
   */
  const numeros = digitos(alvo);
  if (numeros.length >= 2 && numeros === alvo.replace(/\s/g, '')) {
    if (String(p.variacao_erp || '') === numeros) return 0;
    if (digitos(p.codigo_barras || '') === numeros) return 0;
    /* Código que não bate exato ainda pode ser começo de código de barras —
       etiqueta rasgada, leitura parcial. */
    if (numeros.length >= 6 && digitos(p.codigo_barras || '').startsWith(numeros)) return 0.5;
  }

  if (nome.startsWith(alvo)) return 1;

  const termos = alvo.split(' ').filter(Boolean);
  const todosNoNome = termos.every(t => nome.includes(t));
  if (todosNoNome) {
    /* Na ordem digitada vale mais: "monster tradicional" descreve o produto,
       "tradicional monster" é a mesma intenção com menos certeza. */
    let posicao = -1;
    let emOrdem = true;
    for (const t of termos) {
      const i = nome.indexOf(t, posicao + 1);
      if (i <= posicao) { emOrdem = false; break; }
      posicao = i;
    }
    return emOrdem ? 2 : 3;
  }

  if (categoria && termos.every(t => categoria.includes(t))) return 4;
  return null;
}

/**
 * A lista filtrada e ordenada, cortada em `limite`.
 *
 * O corte existe porque sem busca a lista é o cardápio inteiro — mil linhas num
 * painel de 14 rem não ajudam ninguém a achar o gelo.
 */
export function buscarProdutos<T extends ProdutoBuscavel>(
  produtos: T[], consulta: string, limite = 40,
): T[] {
  const comNota = produtos
    .map(p => ({ p, nota: pontuar(p, consulta) }))
    .filter((x): x is { p: T; nota: number } => x.nota !== null);

  comNota.sort((a, b) => {
    if (a.nota !== b.nota) return a.nota - b.nota;
    /* Quem tem SKU primeiro: é o único que baixa estoque no Maxx Gestão, e é
       por isso que alguém está nesta tela. */
    const skuA = (a.p.variacao_erp || 0) > 0 ? 0 : 1;
    const skuB = (b.p.variacao_erp || 0) > 0 ? 0 : 1;
    if (skuA !== skuB) return skuA - skuB;
    if (a.p.nome.length !== b.p.nome.length) return a.p.nome.length - b.p.nome.length;
    return a.p.nome.localeCompare(b.p.nome, 'pt-BR');
  });

  return comNota.slice(0, limite).map(x => x.p);
}
