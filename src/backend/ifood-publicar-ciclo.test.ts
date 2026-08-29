import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function semComentarios(arquivo: string): string {
  return fs.readFileSync(path.join(__dirname, arquivo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('publicar é opt-in, nunca padrão', () => {
  it('só envia quando alguém pediu explicitamente', () => {
    /*
     * A sincronização podia ser testada rodando: o pior caso era um nome errado
     * no nosso banco, que o ciclo seguinte consertava. Aqui o pior caso é o
     * cardápio da loja no iFood, com o cliente comprando do outro lado, e o
     * `PUT` substitui o item — o que ele omitiu já foi.
     */
    const fonte = semComentarios('ifood-publicar-ciclo.ts');
    expect(fonte).toContain('opcoes.publicar === true');
    expect(fonte).not.toMatch(/publicar\s*=\s*true/);
  });

  it('o ensaio passa pelo MESMO caminho, só não faz a última chamada', () => {
    /* Um ensaio por caminho paralelo não prova nada sobre o que a publicação
       de verdade faria. */
    const fonte = semComentarios('ifood-publicar-ciclo.ts');
    const i = fonte.indexOf('montarPayloadItem(');
    const j = fonte.indexOf('if (!publicar) continue;');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });

  it('lê o item atual ANTES de montar o payload', () => {
    /*
     * É o que preserva contextModifiers e tudo que a API tem e nós não
     * modelamos. Montar do nosso banco funciona no teste e apaga o preço do
     * Cardápio Digital em produção.
     */
    const fonte = semComentarios('ifood-publicar-ciclo.ts');
    expect(fonte.indexOf('buscarItemCompleto(')).toBeLessThan(fonte.indexOf('montarPayloadItem('));
  });

  it('o ciclo de publicação não apaga nada', () => {
    const fonte = semComentarios('ifood-publicar-ciclo.ts');
    expect(fonte).not.toMatch(/method:\s*'DELETE'/);
  });
});
