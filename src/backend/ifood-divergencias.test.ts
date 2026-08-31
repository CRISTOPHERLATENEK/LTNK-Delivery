import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * O DOCUMENTO DAS DIVERGÊNCIAS TEM QUE ACOMPANHAR O CÓDIGO.
 *
 * Nove pontos em que a API do iFood não bate com a documentação dela, cada um
 * descoberto chamando e lendo a recusa. Documento que descreve caminho diferente
 * do que o código usa é pior que documento nenhum: manda a próxima pessoa
 * "corrigir" o código para o que já não funciona.
 */
const DOC = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'ifood-api-divergencias.md'), 'utf8');

function fonte(arquivo: string): string {
  return fs.readFileSync(path.join(__dirname, arquivo), 'utf8');
}

describe('divergências documentadas x código', () => {
  it('o caminho de itens por categoria é o que o código usa', () => {
    expect(DOC).toContain('GET /categories/{categoryId}/items');
    expect(fonte('ifood-catalogo.ts')).toContain('/categories/${encodeURIComponent(categoryId)}/items');
  });

  it('o caminho de status por item é o que o código usa', () => {
    expect(DOC).toContain('items/{itemId}/status');
    expect(fonte('ifood-publicar-cliente.ts')).toContain('/items/${encodeURIComponent(itemId)}/status');
  });

  it('a referência de grupo documentada como objeto é a que o código monta', () => {
    expect(DOC).toContain('"min": 0, "max": 2, "index": 0');
    expect(fonte('ifood-publicar.ts')).toContain('refsDosGrupos.push({ id: idGrupo, min, max, index: i })');
  });

  it('o optionGroupType documentado como obrigatório está no payload', () => {
    expect(DOC).toContain('optionGroupType');
    expect(fonte('ifood-publicar.ts')).toContain('optionGroupType');
  });

  it('lista as nove divergências, nem mais nem menos', () => {
    /* Se aparecer uma décima, ela entra na tabela — e este teste é o que
       lembra. Contar os títulos numerados é o jeito mais simples de travar. */
    const secoes = DOC.match(/^## \d+\./gm) ?? [];
    expect(secoes).toHaveLength(9);
  });

  it('o mapeamento aponta para o documento', () => {
    /* Quem chega pelo mapeamento tem que ser avisado antes de escrever a
       primeira chamada. */
    const mapa = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'mapeamento-ifood-cardapio.md'), 'utf8');
    expect(mapa).toContain('ifood-api-divergencias.md');
  });
});
