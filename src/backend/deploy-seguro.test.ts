import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * O DEPLOY NÃO PODE ENCOSTAR NO QUE ESTÁ NO AR ATÉ O BUILD TERMINAR.
 *
 * O jeito antigo rodava `npm run build`, que começa apagando
 * `public/app-assets` — os arquivos que o navegador está pedindo naquele
 * instante. Entre esse `rm` e o fim do build havia ~20s de site sem CSS nem
 * JS, e um build que morresse no meio (rede, memória, erro de tipo) deixava
 * assim até alguém perceber.
 *
 * Nada disto é pegável por teste de comportamento: é ORDEM de operações num
 * script de shell. Então o teste lê o script e confere a ordem — que é a única
 * coisa que faz ele funcionar.
 */

const RAIZ = path.join(__dirname, '..', '..');
const deploy = fs.readFileSync(path.join(RAIZ, 'deploy.sh'), 'utf8');
const rollback = fs.readFileSync(path.join(RAIZ, 'rollback.sh'), 'utf8');

/**
 * O script SEM os comentários.
 *
 * Asserção negativa contra o arquivo inteiro é uma armadilha conhecida: o
 * comentário que EXPLICA o erro evitado contém o próprio erro, e o teste acusa
 * a explicação. Foi o que aconteceu na primeira execução deste arquivo — o
 * comentário citando o script de limpeza derrubou o teste que o proíbe.
 */
function semComentarios(fonte: string): string {
  return fonte.split('\n').filter(l => !l.trimStart().startsWith('#')).join('\n');
}

/** Posição da primeira linha que casa, ignorando comentários. */
function onde(fonte: string, padrao: RegExp): number {
  const linhas = fonte.split('\n');
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (l.trimStart().startsWith('#')) continue;   // comentário não executa
    if (padrao.test(l)) return i;
  }
  return -1;
}

describe('deploy.sh: build fora do ar, troca no fim', () => {
  it('o teste está lendo o script certo', () => {
    // Sem isto, uma regex que parou de casar faz tudo abaixo passar por vácuo.
    expect(onde(deploy, /pm2 reload/)).toBeGreaterThan(0);
    expect(onde(deploy, /git reset --hard/)).toBeGreaterThan(0);
  });

  /*
   * O QUE CAUSAVA O ESTRAGO. `npm run build` encadeia o `limpar:assets`, que
   * apaga public/app-assets. Chamar isso aqui traz a janela de volta inteira.
   */
  it('não roda o build que apaga os assets do ar', () => {
    const exec = semComentarios(deploy);
    expect(exec).not.toMatch(/npm run build\b/);
    expect(exec).not.toMatch(/limpar:assets/);
    expect(exec).not.toMatch(/rm -rf public\/app-assets/);
  });

  it('o frontend é construído numa cópia, não em cima do que está servindo', () => {
    expect(deploy).toMatch(/--outDir \.\.\/public\.novo/);
    expect(deploy).toMatch(/cp -a public public\.novo/);
  });

  /*
   * A ORDEM É O CONSERTO, não os comandos. Snapshot antes do `git reset`,
   * porque depois dele o commit anterior não está mais em HEAD e é justamente
   * ele que o rollback precisa. E troca depois do build, senão a cópia não
   * serviu para nada.
   */
  it('guarda o ponto de retorno ANTES de mexer no código', () => {
    const revParse = onde(deploy, /ANTES=\$\(git rev-parse HEAD\)/);
    const copia = onde(deploy, /cp -a public public\.anterior/);
    const reset = onde(deploy, /git reset --hard/);
    expect(revParse).toBeGreaterThan(-1);
    expect(revParse).toBeLessThan(reset);
    expect(copia).toBeLessThan(reset);
  });

  it('troca o public DEPOIS do build e ANTES do reload', () => {
    const build = onde(deploy, /vite build --outDir/);
    const troca = onde(deploy, /mv public\.novo public/);
    const reload = onde(deploy, /pm2 reload/);
    expect(build).toBeGreaterThan(-1);
    expect(build).toBeLessThan(troca);
    expect(troca).toBeLessThan(reload);
  });

  /*
   * Build pode "terminar bem" e não produzir nada — já vi rollup sair 0 com a
   * pasta vazia. Trocar nesse caso publica o problema em vez de segurá-lo.
   */
  it('confere que o build produziu algo antes de trocar', () => {
    const checagem = onde(deploy, /public\.novo\/index\.html/);
    const troca = onde(deploy, /mv public\.novo public/);
    expect(checagem).toBeGreaterThan(-1);
    expect(checagem).toBeLessThan(troca);
    expect(deploy).toMatch(/app-assets/);
  });

  it('aborta no primeiro erro', () => {
    // Sem `-e`, um build que falha segue para a troca e para o reload.
    expect(deploy).toMatch(/set -euo pipefail/);
  });
});

describe('rollback.sh: voltar não pode depender de build', () => {
  it('o teste está lendo o script certo', () => {
    expect(onde(rollback, /pm2 reload/)).toBeGreaterThan(0);
  });

  /*
   * O PONTO DO SCRIPT. Se o rollback reconstruísse, ele levaria minutos e
   * poderia falhar pelo mesmo motivo que derrubou o deploy — e o site ficaria
   * fora esse tempo todo. Ele restaura diretório e recarrega.
   */
  it('não constrói nada', () => {
    const exec = semComentarios(rollback);
    expect(exec).not.toMatch(/npm run build/);
    expect(exec).not.toMatch(/vite build/);
    expect(exec).not.toMatch(/tsc -p/);
    expect(exec).not.toMatch(/npm install/);
  });

  it('restaura os arquivos servidos e o backend compilado', () => {
    expect(rollback).toMatch(/cp -a public\.anterior public/);
    expect(rollback).toMatch(/cp -a dist\.anterior dist/);
  });

  /* Guarda o que estava no ar antes de sobrescrever: se voltar foi a decisão
     errada, dá para vir de novo para cá sem reconstruir. */
  it('guarda o estado retirado', () => {
    const guarda = onde(rollback, /cp -a public public\.ruim/);
    const restaura = onde(rollback, /cp -a public\.anterior public/);
    expect(guarda).toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(restaura);
  });

  it('tem modo de conferir sem alterar nada', () => {
    expect(rollback).toMatch(/--ver/);
  });

  /*
   * O QUE O ROLLBACK NÃO FAZ tem que estar escrito nele. Migração de banco não
   * volta: coluna criada pelo deploy ruim continua lá. Isso é seguro porque o
   * schema é aditivo — código antigo convive com coluna nova. Quem lê o script
   * na madrugada precisa saber disso antes de contar com o contrário.
   */
  it('avisa que não desfaz migração de banco', () => {
    expect(rollback).toMatch(/NÃO desfaz migração de banco/);
  });
});
