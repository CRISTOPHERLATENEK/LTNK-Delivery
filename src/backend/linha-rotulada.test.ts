import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * A MOLDURA DAS LINHAS ROTULADAS (`Quadro`/`Secao` em marca/campos.tsx) não tem
 * padding nem `space-y`: quem traz espaçamento e divisória é cada linha.
 *
 * Isso quebra de um jeito silencioso. Basta alguém pendurar um controle
 * qualquer — um upload, uma grade de fontes, um aviso — direto dentro da
 * moldura, e ele fica colado na borda, sem respiro nenhum. Foi exatamente o que
 * aconteceu ao converter Marca: os rótulos viraram linha, a moldura perdeu o
 * padding, e sobraram sete controles crus grudados na borda. Nada disso falha
 * no typecheck nem no build — só aparece na tela.
 *
 * Então a regra é: filho direto de moldura é linha rotulada OU tem padding
 * próprio.
 */

const RAIZ = path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'admin', 'marca');

/** Componentes que JÁ são linha rotulada (ou embrulham uma). */
const LINHAS = /^<(Linha|CampoCor|ListaTextoEditavel|ListaIconeTituloDescEditavel)\b/;

/** Abertura de moldura e seu fechamento. */
const MOLDURAS: Array<[RegExp, string]> = [
  [/^<Secao[\s>]/, '</Secao>'],
  [/^<Quadro>$/, '</Quadro>'],
];

function indentacao(linha: string): number {
  return linha.length - linha.trimStart().length;
}

/** Filhos diretos de cada moldura do arquivo que não são linha rotulada. */
function filhosCrus(fonte: string): string[] {
  const linhas = fonte.split('\n');
  const crus: string[] = [];

  for (let i = 0; i < linhas.length; i++) {
    const alvo = linhas[i].trim();
    const moldura = MOLDURAS.find(([abre]) => abre.test(alvo));
    if (!moldura) continue;

    const nivel = indentacao(linhas[i]);
    let fim = i + 1;
    while (fim < linhas.length &&
      !(linhas[fim].trim() === moldura[1] && indentacao(linhas[fim]) === nivel)) fim++;

    for (let k = i + 1; k < fim; k++) {
      const l = linhas[k];
      const t = l.trim();
      if (!t) continue;
      // Só o primeiro nível: o que está mais fundo é problema de quem embrulha.
      if (indentacao(l) !== nivel + 2) continue;
      // Continuações, fechamentos e comentários não são filhos.
      if (/^(<\/|\{\/\*|\*|\/\*|\)\}|\/>|>$|\}\))/.test(t)) continue;
      if (LINHAS.test(t)) continue;
      // `{cond && (` abre um filho condicional: o que vem dentro é que conta,
      // e no DOM ele entra como filho direto — `:first-child` acerta sozinho.
      if (/^\{[\w.!== ]+ && \($/.test(t)) continue;
      crus.push(`${t.slice(0, 90)}`);
    }
  }
  return crus;
}

/** Padding explícito: `p-3`, `px-3`, `pt-2.5`… */
const TEM_PADDING = /\bp[xytblr]?-\d/;

describe('moldura de linhas rotuladas', () => {
  const arquivos = fs.readdirSync(RAIZ)
    .filter(f => f.endsWith('.tsx') && f !== 'campos.tsx');

  it('há telas para conferir', () => {
    // Sem isso, o teste abaixo passa lendo uma pasta vazia.
    expect(arquivos.length).toBeGreaterThanOrEqual(2);
    expect(arquivos).toContain('index.tsx');
    expect(arquivos).toContain('landing.tsx');
  });

  for (const arq of arquivos) {
    it(`${arq}: filho direto de moldura é linha rotulada ou tem padding`, () => {
      const fonte = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
      const semPadding = filhosCrus(fonte).filter(t => !TEM_PADDING.test(t));
      expect(semPadding).toEqual([]);
    });
  }

  /*
   * A divisória mora no CSS da moldura, não num prop `primeira` da linha.
   * O prop obriga quem escreve a saber a ordem — e erra na primeira vez que
   * alguém move um campo de lugar (foi o que aconteceu com o campo de
   * WhatsApp da landing, que mudou de moldura e ficou sem divisória).
   */
  it('a divisória é do CSS da moldura, não de um prop da linha', () => {
    const campos = fs.readFileSync(path.join(RAIZ, 'campos.tsx'), 'utf8');
    const corpoLinha = campos.slice(campos.indexOf('export function Linha('));
    const fim = corpoLinha.indexOf('\n}\n');
    expect(corpoLinha.slice(0, fim)).not.toMatch(/borderTop/);
    expect(corpoLinha.slice(0, fim)).not.toMatch(/primeira/);

    const css = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'index.css'), 'utf8');
    expect(css).toMatch(/\.adm-quadro > \*\s*\{[^}]*border-top:\s*1px/);
    expect(css).toMatch(/\.adm-quadro > :first-child\s*\{[^}]*border-top:\s*0/);
  });

  /* A moldura precisa carregar a classe, senão o CSS acima não pega nada. */
  it('Quadro carrega a classe .adm-quadro', () => {
    const campos = fs.readFileSync(path.join(RAIZ, 'campos.tsx'), 'utf8');
    const quadro = campos.slice(campos.indexOf('export function Quadro('));
    expect(quadro.slice(0, quadro.indexOf('\n}\n'))).toMatch(/className="adm-quadro"/);
  });
});
