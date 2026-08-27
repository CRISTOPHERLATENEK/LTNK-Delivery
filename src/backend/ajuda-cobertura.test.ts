import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * O MATERIAL DE TREINAMENTO APODRECE EM SILÊNCIO — este teste é o que impede.
 *
 * Três formas de apodrecer, e nenhuma delas dá erro em tempo de execução:
 *
 * 1. Um assunto entra no catálogo e ninguém o lista na tela de Treinamento. Ele
 *    existe, funciona no `?`, e é invisível para quem procura pelo começo.
 * 2. Um diagrama é referenciado e o arquivo não existe. O painel mostra imagem
 *    quebrada, e só quem abrir aquele assunto específico descobre.
 * 3. Uma entrada fica sem explicação, com título e nada mais.
 */
const raiz = (...p: string[]) => path.resolve(__dirname, '..', '..', 'frontend', ...p);
const catalogo = fs.readFileSync(raiz('src', 'components', 'ui', 'ajuda.tsx'), 'utf8');
const tela = fs.readFileSync(raiz('src', 'pages', 'lojista', 'ajuda.tsx'), 'utf8');

/* Lê as chaves do objeto AJUDA pelo texto. Um `import` do .tsx aqui arrastaria
   React e JSX para o teste do backend; a varredura basta e não acopla nada. */
const corpoCatalogo = catalogo.slice(catalogo.indexOf('export const AJUDA'));
const chaves = [...corpoCatalogo.matchAll(/^ {2}'([a-z-]+)': \{/gm)].map(m => m[1]);

describe('cobertura do treinamento', () => {
  it('o catálogo tem assunto para todas as áreas do painel', () => {
    expect(chaves.length).toBeGreaterThanOrEqual(25);
    /* Amostra do que NÃO pode faltar: são as telas onde o erro custa dinheiro. */
    for (const obrigatoria of [
      'complementos-grupo', 'complementos-preco', 'composicao-combo',
      'balcao-atalhos', 'mesa-fluxo', 'caixa-turno', 'pedidos-fluxo',
      'entrega-taxa', 'pagamentos', 'fiscal', 'horario-fechar', 'usuarios',
    ]) {
      expect(chaves).toContain(obrigatoria);
    }
  });

  /*
   * TODA chave listada na tela. Assunto órfão no catálogo é material que existe
   * e ninguém acha — pior que material que não existe, porque consumiu trabalho.
   */
  it('nenhum assunto fica de fora da tela de Treinamento', () => {
    const orfaos = chaves.filter(c => !tela.includes(`'${c}'`));
    expect(orfaos).toEqual([]);
  });

  /* E o contrário: a tela não pode listar chave que não existe no catálogo —
     ela renderiza `AJUDA[c] && ...`, então o cartão simplesmente não aparece e
     a seção fica menor sem ninguém notar. */
  it('a tela não lista assunto inexistente', () => {
    const secoes = tela.slice(tela.indexOf('const SECOES'), tela.indexOf('function Cartao'));
    const listadas = [...secoes.matchAll(/'([a-z-]+)'/g)].map(m => m[1])
      .filter(x => x.includes('-') || chaves.includes(x));
    const fantasmas = listadas.filter(c => !chaves.includes(c));
    expect(fantasmas).toEqual([]);
  });

  it('todo diagrama referenciado existe em public/ajuda', () => {
    const refs = [...catalogo.matchAll(/'(\/ajuda\/[^']+)'/g)].map(m => m[1]);
    expect(refs.length).toBeGreaterThan(10);
    const ausentes = refs.filter(r => !fs.existsSync(raiz('public', r.replace(/^\//, ''))));
    expect(ausentes).toEqual([]);
  });

  /*
   * O RESUMO É A RESPOSTA, não um rótulo. Entrada com resumo curto é entrada que
   * não explica — e a promessa desta tela é explicar.
   */
  it('toda entrada tem explicação de verdade', () => {
    const blocos = corpoCatalogo.split(/^ {2}'[a-z-]+': \{/gm).slice(1);
    expect(blocos.length).toBe(chaves.length);
    const magras: string[] = [];
    blocos.forEach((b, i) => {
      const resumo = b.slice(b.indexOf('resumo:'), b.indexOf('cuidado:') > 0 ? b.indexOf('cuidado:') : undefined);
      if (resumo.length < 180) magras.push(chaves[i]);
    });
    expect(magras).toEqual([]);
  });

  /* Sem vídeo, de propósito: vídeo envelhece calado quando a tela muda, e
     ninguém regrava. Se voltar, que seja uma decisão e não um resquício. */
  it('não sobrou referência a vídeo', () => {
    expect(catalogo).not.toMatch(/video\?:|duracao\?:/);
    expect(catalogo).not.toMatch(/\.gif'/);
    expect(tela).not.toMatch(/item\.video|item\.gif/);
  });
});
