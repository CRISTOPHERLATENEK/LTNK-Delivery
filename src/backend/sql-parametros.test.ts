import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Confere que todo `INSERT ... VALUES` tem a MESMA quantidade de colunas e de
 * valores.
 *
 * ESTE TESTE EXISTE POR UM ACIDENTE REAL: ao adicionar `chave_idem` ao INSERT de
 * pedidos, a coluna entrou na lista de parâmetros mas não na de colunas. Ficaram
 * 19 colunas para 20 valores, o MySQL recusou com ER_WRONG_ARGUMENTS, e a loja
 * passou horas sem conseguir criar UM pedido sequer.
 *
 * O `tsc` não pega: a query é uma string, e a contagem de `?` não é verificada
 * por tipo. Testes e build passaram todos. Só apareceu quando um cliente tentou
 * comprar.
 *
 * Varre o código-fonte de propósito, em vez de testar uma função: o erro não
 * mora numa função, mora em qualquer INSERT que alguém escreva daqui pra frente.
 */

/** Divide por vírgula ignorando as que estão dentro de parênteses/aspas. */
function separarTopo(texto: string): string[] {
  const partes: string[] = [];
  let atual = '';
  let profundidade = 0;
  let aspas = '';
  for (const c of texto) {
    if (aspas) {
      atual += c;
      if (c === aspas) aspas = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { aspas = c; atual += c; continue; }
    if (c === '(') profundidade++;
    if (c === ')') profundidade--;
    if (c === ',' && profundidade === 0) { partes.push(atual); atual = ''; continue; }
    atual += c;
  }
  if (atual.trim()) partes.push(atual);
  return partes.map(p => p.trim()).filter(Boolean);
}

/**
 * Conteúdo entre o parêntese aberto em `inicio` e o que o fecha, ciente de
 * aspas. `null` se não fechar.
 */
function blocoDeParenteses(texto: string, inicio: number): string | null {
  let profundidade = 0;
  let aspas = '';
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) { if (c === aspas) aspas = ''; continue; }
    if (c === "'" || c === '"') { aspas = c; continue; }
    if (c === '`') return null; // saiu do template literal: query truncada
    if (c === '(') profundidade++;
    else if (c === ')') {
      profundidade--;
      if (profundidade === 0) return texto.slice(inicio + 1, i);
    }
  }
  return null;
}

function arquivosTs(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of fs.readdirSync(dir)) {
    const completo = path.join(dir, nome);
    if (fs.statSync(completo).isDirectory()) { saida.push(...arquivosTs(completo)); continue; }
    if (nome.endsWith('.ts') && !nome.endsWith('.test.ts')) saida.push(completo);
  }
  return saida;
}

describe('INSERT ... VALUES', () => {
  it('tem o mesmo número de colunas e de valores em todo o backend', () => {
    const problemas: string[] = [];
    // Só localiza o começo; o conteúdo de cada parêntese sai de `blocoDeParenteses`,
    // que respeita aspas — `VALUES ('Consumidor (Balcão)', ?)` tem parêntese
    // DENTRO de uma string, e uma regex ingênua fecha no lugar errado.
    const re = /INSERT\s+INTO\s+(\w+)\s*\(/gis;

    for (const arquivo of arquivosTs(path.join(__dirname))) {
      const codigo = fs.readFileSync(arquivo, 'utf8');
      for (const m of codigo.matchAll(re)) {
        const tabela = m[1];
        const abreColunas = m.index! + m[0].length - 1;
        const colunasBruto = blocoDeParenteses(codigo, abreColunas);
        if (colunasBruto === null) continue;

        const depois = codigo.slice(abreColunas + colunasBruto.length + 2);
        const mv = depois.match(/^\s*(?:--[^\n]*\n\s*)?VALUES\s*\(/i);
        if (!mv) continue; // INSERT ... SELECT, ou ON DUPLICATE sem VALUES
        const abreValores = abreColunas + colunasBruto.length + 2 + mv[0].length - 1;
        const valoresBruto = blocoDeParenteses(codigo, abreValores);
        if (valoresBruto === null) continue;
        // Linhas de comentário no meio da lista atrapalham a contagem: fora.
        const limpar = (t: string) => t.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
        const colunas = separarTopo(limpar(colunasBruto));
        const valores = separarTopo(limpar(valoresBruto));
        // INSERT ... SELECT não tem lista de valores entre parênteses.
        if (valores.length === 0) continue;
        if (colunas.length !== valores.length) {
          problemas.push(
            `${path.basename(arquivo)} → INSERT INTO ${tabela}: `
            + `${colunas.length} colunas x ${valores.length} valores`,
          );
        }
      }
    }

    expect(problemas).toEqual([]);
  });
});
