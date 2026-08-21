/**
 * TANTOS `?` NA SQL, TANTOS ARGUMENTOS NO `.run()`.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Adicionar uma coluna a um INSERT é três edições
 * no mesmo lugar: a lista de colunas, a lista de `?` e a lista de argumentos.
 * Esquecer uma das três compila, passa no lint, passa em todo teste de
 * comportamento — e explode só em tempo de execução, com uma mensagem que não
 * diz o arquivo nem a coluna:
 *
 *     ER_WRONG_ARGUMENTS: Incorrect arguments to mysqld_stmt_execute
 *
 * Aconteceu de verdade: `imagem` entrou na lista de argumentos e ficou fora da
 * lista de colunas. Resultado: CRIAR QUALQUER COMPLEMENTO passou a devolver 500
 * — o botão "Adicionar" e todos os chips de sugestão do editor. Não havia teste
 * pra pegar, porque o defeito não está em nenhuma regra: está na aritmética
 * entre duas listas que ninguém conta.
 *
 * O que este teste faz é contar. É burro de propósito: nada de banco, nada de
 * mock, só ler o código e comparar dois números.
 *
 * COMO ELE SE COMPORTA QUANDO NÃO TEM CERTEZA: pula. SQL com `${...}` tem `?`
 * que só existem em tempo de execução (ver `sqlPromocaoVigente`), e argumento
 * com spread tem contagem variável. Nesses casos contar daria alarme falso, e
 * teste que grita errado é teste que se desliga. Prefere-se cobrir menos e ser
 * confiável.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const RAIZ = path.resolve(__dirname);

function arquivos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : arquivos(p);
    return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
  });
}

/** Fim do trecho iniciado em `abre` (índice do parêntese/crase de abertura). */
function fechamento(texto: string, abre: number, ab: string, fe: string): number {
  let nivel = 0;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === ab) nivel++;
    else if (texto[i] === fe) { nivel--; if (nivel === 0) return i; }
  }
  return -1;
}

/**
 * Quantos argumentos a lista tem, contando as vírgulas de PROFUNDIDADE ZERO.
 *
 * Conta SEGMENTOS COM CONTEÚDO, não vírgulas. A vírgula final (`agoraUTC(),`) é
 * estilo comum aqui e daria um argumento fantasma — foi o primeiro falso
 * positivo que este scanner produziu. Comentário também sai antes: `// nome,
 * email` tem vírgula e não é separador de argumento.
 */
function argumentos(lista: string): number {
  const segmentos: string[] = [];
  let atual = '';
  let nivel = 0;
  let emTexto: string | null = null;
  for (let i = 0; i < lista.length; i++) {
    const ch = lista[i];
    if (emTexto) {
      atual += ch;
      if (ch === '\\') { atual += lista[++i] ?? ''; }
      else if (ch === emTexto) emTexto = null;
      continue;
    }
    if (ch === '/' && lista[i + 1] === '/') { i = lista.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && lista[i + 1] === '*') { const f = lista.indexOf('*/', i); if (f < 0) break; i = f + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { emTexto = ch; atual += ch; continue; }
    if ('([{'.includes(ch)) { nivel++; atual += ch; continue; }
    if (')]}'.includes(ch)) { nivel--; atual += ch; continue; }
    if (ch === ',' && nivel === 0) { segmentos.push(atual); atual = ''; continue; }
    atual += ch;
  }
  segmentos.push(atual);
  return segmentos.filter(s => s.trim() !== '').length;
}

interface Chamada { arquivo: string; linha: number; sql: string; placeholders: number; args: number }

function chamadas(): Chamada[] {
  const achadas: Chamada[] = [];
  for (const arq of arquivos(RAIZ)) {
    const texto = fs.readFileSync(arq, 'utf8');
    let de = 0;
    for (;;) {
      const p = texto.indexOf('.prepare(', de);
      if (p < 0) break;
      de = p + 9;

      // A SQL tem que ser uma template literal que começa logo após o '('.
      const craseAbre = texto.indexOf('`', p);
      const parenFim = fechamento(texto, texto.indexOf('(', p), '(', ')');
      if (craseAbre < 0 || parenFim < 0 || craseAbre > parenFim) continue;
      const craseFim = texto.indexOf('`', craseAbre + 1);
      if (craseFim < 0 || craseFim > parenFim) continue;
      const sql = texto.slice(craseAbre + 1, craseFim);

      // Só INSERT com VALUES: é onde a aritmética das colunas mora.
      if (!/^\s*INSERT\s/i.test(sql) || !/VALUES/i.test(sql)) continue;
      // `${...}` gera `?` em tempo de execução — não dá pra contar aqui.
      if (sql.includes('${')) continue;

      const depois = texto.slice(parenFim + 1);
      const m = /^\s*\.\s*(run|get|all)\s*\(/.exec(depois);
      if (!m) continue;
      const abreArgs = parenFim + 1 + depois.indexOf('(', m[0].length - 1);
      const fimArgs = fechamento(texto, abreArgs, '(', ')');
      if (fimArgs < 0) continue;
      const lista = texto.slice(abreArgs + 1, fimArgs);
      if (lista.includes('...')) continue;   // spread: contagem variável

      achadas.push({
        arquivo: path.relative(path.resolve(__dirname, '..', '..'), arq),
        linha: texto.slice(0, craseAbre).split('\n').length,
        sql: sql.replace(/\s+/g, ' ').trim().slice(0, 90),
        placeholders: (sql.match(/\?/g) || []).length,
        args: argumentos(lista),
      });
    }
  }
  return achadas;
}

describe('todo INSERT tem tantos argumentos quanto ?', () => {
  const lista = chamadas();

  /* Se o scanner parar de achar nada (uma refatoração troca `db.prepare` por
     outra coisa), ele passaria vazio e ninguém notaria — o teste ficaria verde
     protegendo nada. */
  it('o scanner está encontrando INSERTs de verdade', () => {
    expect(lista.length).toBeGreaterThan(10);
  });

  it('nenhum INSERT tem contagem trocada', () => {
    const errados = lista
      .filter(c => c.placeholders !== c.args)
      .map(c => `${c.arquivo}:${c.linha} — ${c.placeholders} '?' vs ${c.args} args | ${c.sql}`);
    expect(errados).toEqual([]);
  });
});
