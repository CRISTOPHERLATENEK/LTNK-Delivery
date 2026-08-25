import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * TODA TABELA FECHA COM O MESMO SUFIXO — E ISSO INCLUI A COLAÇÃO.
 *
 * Custou uma vitrine fora do ar. A tabela `subcategorias` foi criada fechando
 * em `)` e com `DEFAULT CHARSET=utf8mb4` próprio, em vez do `SUFIXO_TABELA` que
 * as outras ~36 usam. Declarar o charset sem COLLATE RESSETA a colação pro
 * padrão do charset (`utf8mb4_general_ci` no MariaDB) em vez de manter
 * `utf8mb4_unicode_ci`.
 *
 * O estrago só aparece no primeiro JOIN de VARCHAR com uma tabela antiga:
 * comparar colações diferentes é ER_CANT_AGGREGATE_2COLLATIONS — erro fatal,
 * não aviso. Todos os testes passavam, o `tsc` passava, e o 500 nasceu só em
 * produção contra um banco de verdade.
 */
describe('colação do schema', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'schema-mysql.ts'), 'utf-8');
  /* Sem comentários: já aconteceu três vezes nesta base de o texto que explica
     a regra disparar a varredura que ele documenta. */
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('o sufixo canônico fixa a colação', () => {
    expect(codigo).toMatch(
      /const SUFIXO_TABELA = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'/,
    );
  });

  it('todo CREATE TABLE fecha com o sufixo, nenhum declara charset por conta própria', () => {
    const criadas = (codigo.match(/CREATE TABLE IF NOT EXISTS (\w+)/g) || [])
      .map(m => m.replace('CREATE TABLE IF NOT EXISTS ', ''));
    expect(criadas.length).toBeGreaterThan(30);

    /* Cada DDL vai de um CREATE ao próximo; a última vai até o fim da lista.
       Fechar sem o sufixo é o defeito exato que derrubou o cardápio. */
    const semSufixo: string[] = [];
    const partes = codigo.split(/CREATE TABLE IF NOT EXISTS /).slice(1);
    partes.forEach((parte, i) => {
      const ddl = parte.slice(0, parte.indexOf('`,') + 2);
      if (!/\)\s*\$\{SUFIXO_TABELA\}`,\s*$/.test(ddl)) semSufixo.push(criadas[i]);
    });
    expect(semSufixo).toEqual([]);

    /* Charset literal só pode existir DENTRO da constante. */
    const literais = codigo
      .replace(/const SUFIXO_TABELA = '[^']*';/, '')
      .match(/CHARSET\s*=\s*\w+/gi) || [];
    expect(literais).toEqual([]);
  });

  it('o reparo alinha subcategorias com produtos', () => {
    expect(fonte).toMatch(/ALTER TABLE subcategorias CONVERT TO CHARACTER SET/);
    expect(fonte).toMatch(/s\.TABLE_COLLATION <> p\.TABLE_COLLATION/);
  });
});
