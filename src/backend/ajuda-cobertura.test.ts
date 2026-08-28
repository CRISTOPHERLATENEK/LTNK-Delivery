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

/*
 * OS TUTORIAIS SÃO OUTRA COISA QUE A REFERÊNCIA, e o teste separa os dois.
 *
 * Referência responde "o que é esta tela"; tutorial responde "como eu faço".
 * Quem chega ao Treinamento quase sempre quer o segundo — e um tutorial sem
 * passos é uma referência com nome trocado, que decepciona justamente quem mais
 * precisava de ajuda.
 */
describe('tutoriais passo a passo', () => {
  const chavesTut = chaves.filter(c => c.startsWith('tut-'));

  it('cobre as tarefas do dia a dia', () => {
    for (const t of [
      'tut-produto', 'tut-combo', 'tut-pdv', 'tut-mesa',
      'tut-pedido', 'tut-entregador', 'tut-rotas', 'tut-caixa', 'tut-pagamento',
    ]) {
      expect(chavesTut).toContain(t);
    }
  });

  /* Todo `tut-` tem passos numerados, e passo nenhum é vago: "configure a tela"
     não ensina ninguém a fazer nada. */
  it('todo tutorial tem passos de verdade', () => {
    const corpo = corpoCatalogo;
    const semPassos: string[] = [];
    for (const t of chavesTut) {
      const i = corpo.indexOf(`'${t}': {`);
      const j = corpo.indexOf("\n  '", i + 5);
      const bloco = corpo.slice(i, j > 0 ? j : undefined);
      const passos = (bloco.match(/^ {6}'/gm) || []).length;
      if (!bloco.includes('passos: [') || passos < 5) semPassos.push(t);
    }
    expect(semPassos).toEqual([]);
  });

  /* E os tutoriais vêm ANTES da referência na tela: a ordem é a resposta pra
     "por onde começo". */
  it('a seção de passo a passo é a primeira da tela', () => {
    const secoes = tela.slice(tela.indexOf('const SECOES'), tela.indexOf('function Cartao'));
    expect(secoes.indexOf("'Passo a passo'")).toBeLessThan(secoes.indexOf("'1. Começar'"));
  });
});

/**
 * A QUARTA FORMA DE APODRECER: a imagem certa presa no cache do navegador.
 *
 * Observado em produção. Corrigi alcas-ordenacao.svg três vezes e continuei
 * vendo a versão antiga — os arquivos de /ajuda não têm hash no nome, então
 * sem `Cache-Control` explícito a Cloudflare aplicava o padrão dela de 4 horas.
 * Nesse intervalo o lojista lê uma imagem que ensina a procurar o botão onde
 * ele não está mais, e com toda a confiança de quem consultou a ajuda oficial.
 *
 * O teste guarda a REGRA, não o texto: alguém reorganizando o setHeaders não
 * tem como saber que aquela linha existe por causa de um comportamento da CDN.
 */
describe('cache do material de treinamento', () => {
  /* Comentários fora antes de varrer: o bloco acima do código cita as mesmas
     palavras, e um teste que passa por causa do próprio comentário não testa
     nada. Mesmo cuidado dos outros source-scans do projeto. */
  const semComentarios = fs
    .readFileSync(path.resolve(__dirname, 'server.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  it('os arquivos de /ajuda revalidam em vez de ficarem presos na CDN', () => {
    const trecho = semComentarios.slice(
      semComentarios.indexOf('setHeaders'),
      semComentarios.indexOf('SPA fallback'),
    );
    expect(trecho).toMatch(/ajuda/);
    expect(trecho).toMatch(/Cache-Control['"],\s*['"]no-cache/);
  });

  it('index.html e sw.js continuam sem cache nenhum', () => {
    /* Estes são o ponteiro para o bundle com hash. `no-cache` sozinho não
       basta aqui: precisa de no-store, senão um PWA instalado pode prender o
       usuário numa versão antiga do app. */
    expect(semComentarios).toMatch(/no-cache,\s*no-store,\s*must-revalidate/);
  });
});
