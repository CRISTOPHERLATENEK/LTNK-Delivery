import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * O PAINEL DO LOJISTA EM TELA DE CELULAR (375 px).
 *
 * O QUE ACONTECEU: o lojista abriu o painel no telefone e disse que não estava
 * responsivo. Ler o código não achou nada — a casca já era responsiva e as
 * telas eram mobile-first. O que achou foi DESENHAR as telas em 375 px e
 * perguntar ao navegador quem estourava a largura (`frontend/dev/
 * laboratorio-mobile.js`, ligado só no servidor de desenvolvimento).
 *
 * MEDIDO EM 12/09/2026, nas 15 telas do painel:
 *
 *                      antes          depois
 *   /lojista/produtos    766 px         375 px
 *   /lojista/categorias  409 px         375 px
 *   as outras 13         375 px         375 px
 *
 * As quatro causas estão travadas aqui embaixo. Nenhuma era "falta um
 * breakpoint": eram larguras que não tinham como encolher.
 */

const ler = (p: string) => fs.readFileSync(path.join(__dirname, '../../frontend/src', p), 'utf8');
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PRODUTOS = semComentarios(ler('pages/lojista/produtos.tsx'));
const CATEGORIAS = semComentarios(ler('pages/lojista/categorias.tsx'));
const RELATORIOS = semComentarios(ler('pages/lojista/relatorios.tsx'));
const CUPONS = semComentarios(ler('pages/lojista/cupons.tsx'));
const PAINEL = semComentarios(ler('pages/lojista/painel.tsx'));

describe('nada pode ter largura que não encolhe', () => {
  /*
   * A GRADE DE PRODUTOS ERA O PIOR CASO: `minmax(440px, 1fr)` promete "nenhuma
   * coluna menor que 440" e o celular tem 343 px de coluna útil — cada card
   * saía 97 px pela direita, levando o preço para fora da tela. `min(440px,
   * 100%)` mantém a largura desejada onde ela cabe e vira "o que couber" onde
   * não cabe, sem precisar de ponto de quebra nenhum.
   */
  it('toda grade de colunas mínimas usa min(..., 100%)', () => {
    const grades = PRODUTOS.match(/minmax\([^)]*\)/g) ?? [];
    expect(grades.length).toBeGreaterThan(0);
    for (const g of grades) {
      /* `minmax(0, 1fr)` é o idioma de "pode encolher até zero" e está certo. */
      if (/minmax\(\s*0/.test(g)) continue;
      expect(g).toContain('min(');
      expect(g).toContain('100%');
    }
  });

  /*
   * A BARRA DE AÇÕES DE PRODUTOS tinha cinco botões num `flex` sem quebra: um
   * bloco de ~700 px indivisível. Como o pai não consegue encolher um filho
   * que não parte, a PÁGINA inteira passava a 766 px — e aí todo card aparecia
   * cortado, o que fazia parecer defeito da lista.
   */
  it('a barra de ações do cadastro quebra linha', () => {
    const i = PRODUTOS.indexOf('{todos.length > 3 && (');
    const barra = PRODUTOS.slice(Math.max(0, i - 300), i);
    expect(barra).toContain('flex-wrap');
  });

  /* O rodapé do formulário: "Salvar alterações" saía pela direita justamente
     na tela em que ele é o botão que importa. */
  it('o rodapé do formulário de produto quebra linha', () => {
    const i = PRODUTOS.indexOf('Salvar e criar outro');
    const bloco = PRODUTOS.slice(Math.max(0, i - 700), i);
    expect(bloco).toMatch(/flex w-full flex-wrap[^"]*sm:w-auto/);
  });

  /*
   * FORMATO E TAMANHO DA CATEGORIA: três botões pedindo 360 px de conteúdo
   * numa coluna de 309. Era a única tela que ainda estourava depois da grade.
   */
  it('as fileiras de formato e tamanho quebram linha', () => {
    for (const rotulo of ['Formato', 'Tamanho']) {
      const i = CATEGORIAS.indexOf(`>${rotulo}</Label>`);
      expect(i).toBeGreaterThan(-1);
      expect(CATEGORIAS.slice(i, i + 120)).toContain('flex flex-wrap gap-2');
    }
  });
});

describe('texto que não quebra sozinho precisa de ajuda', () => {
  /*
   * CÓDIGO DE CUPOM É UMA PALAVRA SÓ, e palavra só não quebra: o código saía
   * por cima do cartão. Cortar com reticência seria pior — o código existe
   * para ser lido e digitado inteiro.
   */
  it('o código do cupom quebra em qualquer ponto', () => {
    /* A marcação inteira, e não uma janela de caracteres antes do `{c.codigo}`:
       a janela pegava outra ocorrência do mesmo texto no arquivo. */
    expect(CUPONS).toMatch(/className="[^"]*break-all[^"]*"[^>]*>\{c\.codigo\}/);
  });

  /* E-mail também é uma palavra só: a linha do cliente passava 109 px por cima
     da borda e levava junto o nome e a data. */
  it('o e-mail do cliente quebra em qualquer ponto', () => {
    expect(PAINEL).toMatch(/className="break-all">\{c\.email\}/);
  });
});

describe('número grande cabe no cartão', () => {
  /*
   * Em 375 px a grade de dois cartões dá 166 px por cartão, e "R$ 12.345,67"
   * em `text-2xl` pede 176: o valor passava por cima da borda — justamente o
   * dado que a tela existe para mostrar.
   */
  it('o valor do indicador encolhe no celular', () => {
    const i = RELATORIOS.indexOf('function Metric');
    const corpo = RELATORIOS.slice(i, i + 900);
    expect(corpo).toContain('text-xl');
    expect(corpo).toContain('sm:text-2xl');
  });
});

describe('o laboratório de tela estreita não vai para produção', () => {
  const vite = fs.readFileSync(path.join(__dirname, '../../frontend/vite.config.ts'), 'utf8');
  const raizFront = path.join(__dirname, '../../frontend');

  /*
   * ELE FABRICA SESSÃO E RESPOSTA DE API. Isso é exatamente o que precisa
   * existir para desenhar as telas do painel sem login — e exatamente o que
   * não pode ser publicado. Duas travas: o plugin só roda servindo
   * (`apply: 'serve'`), e o arquivo mora fora de `public/`, que o Vite copia
   * inteiro para o build.
   */
  it('o plugin só roda no servidor de desenvolvimento', () => {
    /* A partir da DECLARAÇÃO do plugin, não da primeira vez que o nome aparece
       — a primeira é o comentário que explica por que ele existe, e asserção
       que casa com a própria documentação não prova nada. */
    const i = vite.indexOf("name: 'laboratorio-mobile'");
    expect(i).toBeGreaterThan(-1);
    expect(vite.slice(i, i + 200)).toContain("apply: 'serve'");
  });

  it('o arquivo não mora em public/', () => {
    expect(fs.existsSync(path.join(raizFront, 'dev/laboratorio-mobile.js'))).toBe(true);
    expect(fs.existsSync(path.join(raizFront, 'public/laboratorio-mobile.js'))).toBe(false);
  });

  it('o index.html publicado não o referencia', () => {
    expect(fs.readFileSync(path.join(raizFront, 'index.html'), 'utf8')).not.toContain('laboratorio');
  });
});
