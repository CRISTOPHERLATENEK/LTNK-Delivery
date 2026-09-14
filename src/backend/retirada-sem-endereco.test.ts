import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * PEDIR PARA RETIRAR NO LOCAL NÃO PEDE ENDEREÇO.
 *
 * O DEFEITO, como ele aparecia (14/09/2026): o cliente escolhia "Retirar no
 * local", clicava em "Finalizar pedido" e NÃO ACONTECIA NADA. Sem mensagem,
 * sem erro. O único jeito de destravar era voltar em "Entrega", abrir "Novo
 * endereço" e preencher o CEP de um endereço que ninguém ia usar — daí a
 * pergunta que abriu isto: "por que tenho que colocar o CEP se eu quero
 * retirar no local?".
 *
 * A CORRENTE, medida na loja de demonstração:
 *
 *   convidado (nome + WhatsApp, sem conta) não tem agenda de endereços
 *   → GET /api/cliente/enderecos responde 403
 *   → `enderecos.data` fica indefinido
 *   → o efeito que escolhe um endereço sai na primeira linha
 *   → `enderecoId` fica `null`
 *   → o botão, desabilitado por `enderecoId === null`, morre.
 *
 * Na entrega ainda havia saída (o cartão de endereço aparece). Na retirada
 * esse cartão nem é desenhado: não existia controle nenhum capaz de tirar o
 * `enderecoId` do nulo. E quem pede como convidado é a maior parte dos
 * clientes de verdade.
 *
 * O SERVIDOR JÁ ESTAVA CERTO — era só a tela que cobrava. Por isso os dois
 * lados são verificados aqui: a correção vive no encontro dos dois.
 */

const RAIZ = path.join(__dirname, '../..');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CARRINHO = semComentarios(
  fs.readFileSync(path.join(RAIZ, 'frontend/src/pages/cliente/carrinho.tsx'), 'utf8'));
const CLIENTE = semComentarios(
  fs.readFileSync(path.join(RAIZ, 'src/backend/rotas/cliente.ts'), 'utf8'));

describe('a tela não cobra endereço na retirada', () => {
  /*
   * A LINHA EXATA DO `disabled`, e não "o arquivo menciona tipoEntrega": o
   * arquivo menciona `tipoEntrega` dezenas de vezes, então qualquer busca mais
   * larga passaria verde com o defeito de volta no lugar.
   */
  const linhaDisabled = CARRINHO.split('\n')
    .find(l => l.includes('disabled={enviando') && l.includes('enderecoId'));

  it('o botão de finalizar existe com a trava de endereço', () => {
    expect(linhaDisabled).toBeDefined();
  });

  it('a trava vale SÓ na entrega', () => {
    expect(linhaDisabled).toContain("tipoEntrega === 'entrega'");
  });

  it('nada mais na tela exige endereço fora da entrega', () => {
    /*
     * A trava podia voltar por outro caminho — um `if (!enderecoId) return` no
     * `finalizar`, por exemplo. Aqui a conferência é no corpo da função que
     * manda o pedido: o único uso do endereço lá dentro tem que estar debaixo
     * de "é entrega".
     */
    const i = CARRINHO.indexOf('async function finalizar()');
    expect(i).toBeGreaterThan(0);
    const corpo = CARRINHO.slice(i, CARRINHO.indexOf("await api<{", i));
    expect(corpo).toContain("tipoEntrega === 'entrega' && idFinal === 'novo'");
    expect(corpo).not.toMatch(/if\s*\(\s*!?\s*enderecoId\s*(===\s*null\s*)?\)\s*(return|throw)/);
  });
});

describe('o servidor também não cobra', () => {
  it('na retirada o endereço nem é consultado', () => {
    expect(CLIENTE).toContain("const endereco = tipoEntrega === 'retirada'");
  });

  it('e o 400 de "selecione um endereço" só alcança a entrega', () => {
    const linha = CLIENTE.split('\n').find(l => l.includes('Selecione um endereço de entrega'));
    expect(linha).toBeDefined();
    expect(linha).toContain("tipoEntrega === 'entrega'");
  });

  it('a retirada zera o frete, e não herda a taxa da loja', () => {
    /* Cobrar entrega de quem vai buscar é o mesmo defeito visto pelo bolso. */
    const linha = CLIENTE.split('\n').find(l => l.includes('const frete ='));
    expect(linha).toContain("tipoEntrega === 'retirada'");
  });
});
