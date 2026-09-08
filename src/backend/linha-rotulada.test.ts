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

const ADMIN = path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'admin');
const RAIZ = path.join(ADMIN, 'marca');

/**
 * A moldura chapada não é privilégio da pasta `marca/`.
 *
 * `configuracoes.tsx` importa a mesma `Secao` de `marca/campos` e ficou com
 * TODOS os campos colados na borda desde o dia em que a `Secao` perdeu o
 * padding — e este teste não pegou, porque olhava a pasta em vez de olhar quem
 * usa. Agora ele segue o import: qualquer tela do admin que puxe `Secao` ou
 * `Quadro` de `marca/campos` entra na conferência.
 */
function telasQueUsamAMolduraChapada(): Array<{ nome: string; caminho: string }> {
  const fora = fs.readdirSync(ADMIN)
    .filter(f => f.endsWith('.tsx'))
    .map(f => ({ nome: f, caminho: path.join(ADMIN, f) }))
    .filter(({ caminho }) => /from '\.\/marca\/campos'/.test(fs.readFileSync(caminho, 'utf8')));

  const dentro = fs.readdirSync(RAIZ)
    .filter(f => f.endsWith('.tsx') && f !== 'campos.tsx')
    .map(f => ({ nome: `marca/${f}`, caminho: path.join(RAIZ, f) }));

  return [...dentro, ...fora];
}

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
      if (/^(<\/|\{\/\*|\*|\/\*|\)\}|\/>|>$|\}\)|\) : \(|\))/.test(t)) continue;
      if (LINHAS.test(t)) continue;

      /*
       * CONDICIONAL NÃO É FILHO — o filho é o que está DENTRO dele.
       *
       * `{cond && (` e `{cond ? (` não desenham nada: no DOM, quem entra como
       * filho direto da moldura é o elemento de dentro. Este teste antes só
       * pulava a linha do condicional, e com isso deixava de olhar o conteúdo —
       * foi assim que um `<ul>` sem padding ficou colado na borda da moldura
       * dos canais sem ninguém notar. Agora desce um nível de propósito.
       */
      if (/^\{.+ (&&|\?) \($/.test(t)) {
        for (let d = k + 1; d < fim; d++) {
          const ld = linhas[d];
          const td = ld.trim();
          if (!td) continue;
          const indD = indentacao(ld);
          if (indD <= nivel + 2) break;          // saiu do condicional
          if (indD !== nivel + 4) continue;      // mais fundo é de quem embrulha
          if (/^(<\/|\{\/\*|\*|\/\*|\)\}|\/>|>$|\}\)|\) : \(|\))/.test(td)) continue;
          if (LINHAS.test(td)) continue;
          crus.push(td.slice(0, 90));
        }
        continue;
      }
      crus.push(`${t.slice(0, 90)}`);
    }
  }
  return crus;
}

/**
 * ESPAÇAMENTO PRÓPRIO: `p-3`, `px-3`, `pt-2.5`, e também `mx-3`/`mt-2.5` —
 * margem afasta da borda igual, e exigir só padding reprovava bloco correto.
 *
 * O que NÃO conta é margem NEGATIVA: `-mt-1` e `-mt-2` eram compensação do gap
 * que a moldura tinha antes de ficar chapada. Hoje elas puxam o conteúdo PARA
 * FORA da borda — são o defeito, não a solução. Daí exigir início, espaço ou
 * aspa antes da letra: em `"-mt-1 …"` o `m` vem depois de um `-` e não casa.
 */
const TEM_PADDING = /(?:^|[\s"'{])[pm][xytblr]?-\d/;

describe('moldura de linhas rotuladas', () => {
  const telas = telasQueUsamAMolduraChapada();

  it('há telas para conferir, e a lista inclui quem importa a moldura', () => {
    // Sem isso, o teste abaixo passa lendo uma pasta vazia.
    const nomes = telas.map(t => t.nome);
    expect(nomes).toContain('marca/index.tsx');
    expect(nomes).toContain('marca/landing.tsx');
    // A tela que o teste antigo não olhava.
    expect(nomes).toContain('configuracoes.tsx');
  });

  for (const { nome, caminho } of telas) {
    it(`${nome}: filho direto de moldura é linha rotulada ou tem padding`, () => {
      const fonte = fs.readFileSync(caminho, 'utf8');
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
