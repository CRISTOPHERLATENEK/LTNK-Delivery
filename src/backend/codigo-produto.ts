/**
 * CÓDIGO DO PRODUTO NA NFC-e — `cProd` e `cEAN`.
 *
 * O QUE ESTAVA ERRADO: `cProd` era `String(idx + 1)`, o índice do item na venda.
 * O mesmo produto saía com código diferente em cada nota — uma Coca-Cola era
 * `cProd 1` numa e `cProd 4` na seguinte. A SEFAZ aceita (o campo é livre), mas o
 * `cProd` existe justamente pra identificar o produto de forma ESTÁVEL: é o que
 * liga a nota ao cadastro em qualquer conferência, auditoria ou cruzamento de
 * estoque. Com o índice, esse elo simplesmente não existia.
 *
 * E `cEAN` estava fixo em "SEM GTIN" mesmo para produto com código de barras
 * cadastrado — jogando fora a informação que o lojista já tinha digitado.
 */

/**
 * Valida um GTIN (EAN-8/12/13/14) INCLUINDO o dígito verificador.
 *
 * A CONFERÊNCIA DO DÍGITO NÃO É ZELO — É O QUE EVITA NOTA REJEITADA. A SEFAZ
 * valida o dígito do `cEAN` e devolve rejeição quando ele não fecha. Mandar o que
 * o lojista digitou sem checar trocaria "SEM GTIN" (que sempre passa) por venda
 * travada no balcão por causa de um dígito errado no cadastro — o pior lugar
 * possível pra descobrir o problema.
 */
export function gtinValido(codigo: string | null | undefined): boolean {
  const s = String(codigo || '').trim();
  if (!/^\d+$/.test(s)) return false;
  if (![8, 12, 13, 14].includes(s.length)) return false;

  // Mod-10 com pesos 3 e 1 alternados, da direita pra esquerda, sem o dígito
  // verificador — é o mesmo cálculo para todos os tamanhos de GTIN.
  const corpo = s.slice(0, -1);
  let soma = 0;
  for (let i = 0; i < corpo.length; i++) {
    const digito = Number(corpo[corpo.length - 1 - i]);
    soma += digito * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (soma % 10)) % 10 === Number(s[s.length - 1]);
}

/** `cEAN`/`cEANTrib`: o GTIN quando ele é válido, senão o literal exigido. */
export function eanDaNfce(codigoBarras: string | null | undefined): string {
  return gtinValido(codigoBarras) ? String(codigoBarras).trim() : 'SEM GTIN';
}

/**
 * `cProd`: código estável do produto.
 *
 * GTIN válido quando existe — é o código que o cliente confere na embalagem e o
 * que o contador reconhece. Sem GTIN, `P` + id do produto: nunca vazio, nunca
 * repetido dentro da loja, e o mesmo em todas as notas daquele produto.
 *
 * O PREFIXO "P" TEM FUNÇÃO: o id puro sairia como "2" no cupom, na linha de cima
 * do "2 UN" da quantidade — de volta exatamente ao número solto que confundia o
 * cliente. Com "P2" ninguém lê aquilo como quantidade.
 */
export function codigoProdutoNfce(produtoId: number | null | undefined, codigoBarras?: string | null): string {
  if (gtinValido(codigoBarras)) return String(codigoBarras).trim();
  const id = Number(produtoId);
  // Item sem produto no cadastro (produto excluído depois da venda, item manual
  // do balcão): `cProd` é obrigatório, então precisa sair ALGO — e precisa ser
  // visivelmente diferente de um código de produto, não um id inventado.
  return Number.isInteger(id) && id > 0 ? `P${id}` : 'DIVERSOS';
}
