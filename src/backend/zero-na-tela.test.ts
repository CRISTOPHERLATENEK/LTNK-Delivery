/**
 * O "0" QUE APARECE NA TELA SOZINHO.
 *
 * Em React, `{0 && <algo/>}` não renderiza nada — renderiza O PRÓPRIO ZERO. E os
 * campos TINYINT do MySQL chegam ao navegador como número: `destaque`,
 * `controla_estoque`, `disponivel`, `obrigatorio`. Escrever
 *
 *     {p.destaque && <span>Destaque</span>}
 *
 * desenha um "0" solto em todo produto que NÃO é destaque.
 *
 * Aconteceu e ficou no ar: o painel de produtos mostrava um "0" antes das
 * etiquetas de promoção em todos os cards. Ninguém viu em revisão porque:
 *
 *   - o TypeScript NÃO PEGA. `destaque?: 0 | 1` e o `0` é um ReactNode válido,
 *     então a expressão tipa perfeitamente;
 *   - o lint não pega — é código correto, com efeito visual errado;
 *   - e num cardápio de teste, onde quase tudo era destaque, o zero raramente
 *     aparecia.
 *
 * Este teste lê os campos numéricos DO PRÓPRIO `types.ts` e recusa o uso bare
 * deles como guarda de JSX. Deriva a lista do arquivo em vez de repeti-la aqui
 * porque campo novo `0 | 1` é exatamente o que vai reintroduzir o defeito.
 *
 * A correção é `!!campo &&` — e é só isso.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * O teste vive no lado do BACKEND, como os outros scanners (`preco-produto`,
 * `opcoes-preco`, `sql-parametros`): o `tsconfig` do frontend não inclui os
 * tipos do Node, então um teste que lê arquivo não compila lá — e `tsc -b`
 * quebraria mesmo com o vitest passando.
 */
const RAIZ = path.resolve(__dirname, '..', '..', 'frontend', 'src');

/** Campos declarados como número em types.ts: `x?: 0 | 1` ou `x?: number`. */
function camposNumericos(): string[] {
  const texto = fs.readFileSync(path.join(RAIZ, 'types.ts'), 'utf8');
  const nomes = new Set<string>();
  for (const m of texto.matchAll(/^\s{2}(\w+)\??:\s*(?:0 \| 1|number)(?:\s*\|\s*null)?;/gm)) {
    nomes.add(m[1]);
  }
  return [...nomes];
}

function arquivosTsx(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: fs.Dirent) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : arquivosTsx(p);
    return e.name.endsWith('.tsx') ? [p] : [];
  });
}

describe('nenhum campo numérico é usado bare como guarda de JSX', () => {
  const campos = camposNumericos();

  /* Se a extração parar de achar campo (types.ts reformatado, por exemplo), o
     teste passaria vazio e protegeria nada. */
  it('achou os campos numéricos em types.ts', () => {
    expect(campos.length).toBeGreaterThan(5);
    expect(campos).toContain('destaque');
    expect(campos).toContain('controla_estoque');
  });

  it('nenhum `{obj.campo && (` sem !!', () => {
    /*
     * Só a forma `{algo.campo && (` — abrindo elemento. `{x.campo && 'texto'}`
     * também renderiza 0, mas é raro e a busca por `(` é a que não dá alarme
     * falso em condição composta.
     */
    const culpados: string[] = [];
    for (const arq of arquivosTsx(RAIZ)) {
      const linhas = fs.readFileSync(arq, 'utf8').split('\n');
      linhas.forEach((linha: string, i: number) => {
        for (const campo of campos) {
          const re = new RegExp(`\\{\\s*[\\w.]+\\.${campo}\\s*&&\\s*\\(`);
          if (re.test(linha)) {
            culpados.push(`${path.relative(RAIZ, arq)}:${i + 1} — ${campo}`);
          }
        }
      });
    }
    expect(culpados).toEqual([]);
  });
});
