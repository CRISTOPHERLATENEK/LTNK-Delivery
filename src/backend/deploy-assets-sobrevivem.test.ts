import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * O ASSET DA VERSÃO ANTERIOR PRECISA SOBREVIVER AO DEPLOY.
 *
 * Quem está com o app ABERTO continua pedindo os pedaços da versão que carregou
 * — os arquivos têm hash no nome. Se eles somem do servidor no meio do deploy,
 * a pessoa recebe 404 no que já estava usando.
 *
 * MEDIDO EM 09/09/2026, em produção: 37 pedidos de asset levaram 404 em 20
 * segundos durante um deploy, todos do mesmo IP (o dono da plataforma, que
 * estava com o painel aberto). Entre eles estavam o `index-<hash>.js` e o
 * `index-<hash>.css` — o bundle de ENTRADA. E no mesmo dia, dos 54 arquivos que
 * existiam antes de um deploy, 44 não existiam depois.
 *
 * A publicação é aditiva e um sandbox confirma que o `cp` não apaga nada; o
 * `find` de limpeza não pegaria nenhum deles (mtime +7 devolveu zero). Nem o
 * Vite, nem o `tsc`, nem o `npm install` reproduzem o apagamento fora dali.
 * Enquanto a causa não aparece, o deploy passou a MARCAR onde some (o vigia) e
 * a RESTAURAR no fim — a promessa vale mesmo sem o diagnóstico fechado.
 *
 * Estas asserções existem para que ninguém tire nenhuma das duas achando que é
 * andaime: elas são a única coisa que hoje garante a promessa.
 */

const RAIZ = path.join(__dirname, '..', '..');
const deploy = fs.readFileSync(path.join(RAIZ, 'deploy.sh'), 'utf8');
const indexHtml = fs.readFileSync(path.join(RAIZ, 'frontend', 'index.html'), 'utf8');

/** Só o que executa: comentário citando o erro evitado não conta como erro. */
function execSh(fonte: string): string {
  return fonte.split('\n').filter(l => !l.trimStart().startsWith('#')).join('\n');
}

describe('o vigia marca onde os assets somem', () => {
  it('conta os assets em cada passo do deploy', () => {
    const codigo = execSh(deploy);
    /* Os passos precisam cercar TODOS os candidatos: se o vigia pula um, é
       justamente ali que a causa vai se esconder. */
    for (const passo of ['00 inicio', '10 git reset', '20 npm install',
      '30 tsc backend', '40 rm public.novo/app-assets', '50 vite build',
      '60 pos-restauracao', '70 pos-limpeza']) {
      expect(codigo).toContain(`vigia "${passo}"`);
    }
  });

  /* Em arquivo, e não só no stdout: o deploy roda por SSH e por Action, e a
     saída se perde. O log é o que resta pra comparar dois deploys. */
  it('grava em arquivo, fora do que o git sobrescreve', () => {
    const codigo = execSh(deploy);
    expect(codigo).toContain('VIGIA_LOG="$APP_DIR/dados/deploy-assets.log"');
    expect(codigo).toContain('>> "$VIGIA_LOG"');
  });
});

describe('o que sumiu volta antes do reload', () => {
  /*
   * A ORDEM É O QUE IMPORTA. Restaurar depois do reload não adianta: o processo
   * novo já estaria no ar servindo 404 para quem tem a aba aberta.
   */
  it('a restauração vem antes do pm2 reload', () => {
    const codigo = execSh(deploy);
    const iRestaura = codigo.indexOf('RESTAURANDO');
    const iReload = codigo.indexOf('pm2 reload');
    expect(iRestaura).toBeGreaterThan(0);
    expect(iReload).toBeGreaterThan(iRestaura);
  });

  /* E antes da limpeza de 7 dias: quem decide o que é velho é a limpeza, não a
     restauração. Restaurar depois seria ressuscitar o que acabou de ser podado. */
  it('a restauração vem antes da limpeza de 7 dias', () => {
    const codigo = execSh(deploy);
    const iRestaura = codigo.indexOf('RESTAURANDO');
    const iLimpeza = codigo.indexOf('find public/app-assets -type f -mtime');
    expect(iLimpeza).toBeGreaterThan(iRestaura);
  });

  /*
   * `cp -n` E NÃO `cp -a` SOZINHO. Os arquivos do build novo já estão
   * publicados e são a verdade; sobrescrevê-los com a cópia velha publicaria a
   * versão anterior por cima da nova — um deploy que desfaz a si mesmo.
   */
  it('não sobrescreve o build novo', () => {
    expect(execSh(deploy)).toContain('cp -an public.anterior/app-assets/. public/app-assets/');
  });

  /* A fonte da verdade é a foto tirada no início DESTE deploy. */
  it('compara com a foto do início do deploy', () => {
    const codigo = execSh(deploy);
    expect(codigo).toContain('public.anterior/app-assets');
    expect(codigo).toContain('comm -23');
  });
});

describe('a tela branca tem saída', () => {
  /*
   * O `lazySeguro` recarrega quando um chunk de ROTA some — mas ele é código
   * nosso, e só roda se o bundle principal tiver carregado. Quando quem some é
   * o `index-<hash>.js`, nada nosso executa: a aba fica BRANCA, sem erro na
   * tela, e a única saída é um Ctrl+Shift+R que ninguém vai adivinhar.
   */
  it('o socorro é inline no HTML, não um arquivo externo', () => {
    /* Externo não resolveria nada: seria mais um arquivo que pode faltar. */
    const i = indexHtml.indexOf('entrada-recarregada');
    expect(i).toBeGreaterThan(-1);
    const antes = indexHtml.slice(0, i);
    /* Está dentro de um <script> sem src — inline. */
    const ultimoScript = antes.lastIndexOf('<script');
    expect(antes.slice(ultimoScript)).not.toContain('src=');
  });

  it('só reage a asset com hash, não a qualquer erro', () => {
    expect(indexHtml).toContain("url.indexOf('/app-assets/') !== -1");
  });

  /* Erro de carregamento de recurso NÃO borbulha: um listener normal no window
     nunca veria. Sem a fase de captura, este socorro não dispara nunca. */
  it('escuta na fase de captura', () => {
    const i = indexHtml.indexOf("window.addEventListener('error'");
    expect(i).toBeGreaterThan(-1);
    expect(indexHtml.slice(i, i + 700)).toContain('}, true);');
  });

  it('também escuta o aviso do próprio Vite', () => {
    expect(indexHtml).toContain("window.addEventListener('vite:preloadError'");
  });

  /*
   * UMA TENTATIVA. Se recarregar não resolver, o segundo erro passa direto e a
   * pessoa vê a falha de verdade — laço de reload é pior que tela branca.
   */
  it('recarrega no máximo uma vez', () => {
    const i = indexHtml.indexOf('function recarregarUmaVez');
    const corpo = indexHtml.slice(i, i + 900);
    expect(corpo).toContain("sessionStorage.getItem(CHAVE) === '1'");
    expect(corpo).toContain("sessionStorage.setItem(CHAVE, '1')");
    expect(corpo).toContain('location.reload()');
  });

  /*
   * E A TRAVA SÓ SAI SE O APP SUBIU DE VERDADE.
   *
   * O `load` da janela dispara mesmo com a tela branca — o documento terminou
   * de carregar, com script quebrado e tudo. Limpar a trava ali devolveria o
   * direito de recarregar a uma aba que acabou de falhar, e o resultado é um
   * pingue-pongue de reload contra um servidor que não tem o arquivo.
   */
  it('a trava só é liberada com o React montado', () => {
    const i = indexHtml.indexOf("window.addEventListener('load'");
    const corpo = indexHtml.slice(i, i + 600);
    expect(corpo).toContain('childElementCount > 0');
    expect(corpo).toContain('removeItem(CHAVE)');
    /* A prova negativa: não existe remoção da trava fora dessa condição. */
    const todas = (indexHtml.match(/removeItem\(CHAVE\)/g) ?? []).length;
    expect(todas).toBe(1);
  });
});
