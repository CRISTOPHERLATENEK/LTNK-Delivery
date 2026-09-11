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
 * A CAUSA FOI ENCONTRADA pelo vigia que este arquivo protege: era o próprio
 * `vite build`. O deploy passava `--outDir ../public.novo` para construir numa
 * cópia, mas o Vite continuava usando o `outDir` do vite.config (`../public`)
 * para a LIMPEZA — escrevia na cópia e apagava a pasta publicada. O vigia
 * contou, em 10/09/2026: 56 assets antes do build, 0 depois, 56 de novo após a
 * restauração.
 *
 * Hoje existem TRÊS camadas, e nenhuma é andaime:
 *   1. a saída do build vem de `SAIDA_BUILD`, então o Vite resolve escrita E
 *      limpeza para a cópia — a pasta publicada não é tocada (a correção);
 *   2. o vigia continua contando, porque a próxima causa não vai avisar;
 *   3. a restauração continua, porque descobrir de novo custa caro e recolocar
 *      custa nada.
 */

const RAIZ = path.join(__dirname, '..', '..');
const deploy = fs.readFileSync(path.join(RAIZ, 'deploy.sh'), 'utf8');
const indexHtml = fs.readFileSync(path.join(RAIZ, 'frontend', 'index.html'), 'utf8');
const vite = fs.readFileSync(path.join(RAIZ, 'frontend', 'vite.config.ts'), 'utf8');

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

describe('o build não apaga o que está no ar', () => {
  /*
   * A CAUSA, ENFIM MEDIDA. O deploy construía com `--outDir ../public.novo`
   * para não encostar no que está publicado. Só que o Vite continuava usando o
   * `outDir` do vite.config (`../public`) para a LIMPEZA: escrevia na cópia e
   * apagava a pasta publicada. O vigia contou, em 10/09/2026:
   *
   *   40 rm public.novo/app-assets .... 56 assets
   *   50 vite build ................... 0 assets
   *   60 pos-restauracao .............. 56 assets
   *
   * Entre o build e a restauração a pasta fica VAZIA — e é essa janela que
   * gerou 37 pedidos de asset com 404 em 20 segundos, incluindo o bundle de
   * entrada. Pela variável, o próprio config resolve escrita e limpeza para a
   * cópia, e a pasta publicada não é tocada.
   */
  it('o deploy passa a saída por variável, não por --outDir', () => {
    const codigo = execSh(deploy);
    expect(codigo).toContain('SAIDA_BUILD=../public.novo npx vite build');
    /* A prova negativa: a flag some. Ela é o que causava o apagamento. */
    expect(codigo).not.toContain('--outDir');
  });

  it('o config lê a variável, com o padrão de sempre', () => {
    expect(vite).toContain("outDir: process.env.SAIDA_BUILD || '../public'");
    /* `emptyOutDir` continua false: a publicação é aditiva por fora. */
    expect(vite).toContain('emptyOutDir: false');
  });

  /*
   * SEM O PREFIXO `VITE_`: variável com esse prefixo entra no bundle entregue
   * ao cliente, e isto é caminho de disco da máquina de build.
   */
  it('a variável não vaza para o bundle do cliente', () => {
    expect(vite).not.toContain('VITE_SAIDA');
    expect(vite).not.toContain('VITE_OUT');
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


/*
 * E EXISTE UM SO CAMINHO DE DEPLOY.
 *
 * Tudo acima protege o `deploy.sh`. Nao servia de nada enquanto a Action do
 * GitHub tinha a PROPRIA copia dos passos: `npm run build` (que apaga
 * `public/app-assets` antes de reconstruir) e `pm2 restart all` (que derruba os
 * tres processos juntos). Empurrar um commit disparava esse caminho sem
 * nenhuma das tres camadas — e rodando junto com um deploy manual, os dois
 * mexiam no mesmo diretorio.
 *
 * MEDIDO no deploy da lupa, em 10/09/2026: o vigia avisou "RESTAURANDO 30
 * assets que sumiram durante o deploy" com o `deploy.sh` rodando limpo. Os 30
 * eram da Action, apagando por baixo dele.
 */
describe('a Action nao tem um deploy proprio', () => {
  const action = fs.readFileSync(
    path.join(__dirname, '../../.github/workflows/deploy.yml'), 'utf8');
  /* O comentario do arquivo EXPLICA os passos antigos citando o nome deles.
     Sem tirar comentario, toda asercao negativa aqui casaria com a propria
     documentacao e o teste passaria de graca. */
  const semComentarios = action.replace(/^\s*#.*$/gm, '');

  it('chama o deploy.sh', () => {
    expect(semComentarios).toContain('bash /opt/delivery/deploy.sh');
  });

  it('nao constroi nem reinicia por conta propria', () => {
    expect(semComentarios).not.toContain('npm run build');
    expect(semComentarios).not.toContain('pm2 restart');
    expect(semComentarios).not.toContain('git reset');
  });

  /*
   * Dois pushes seguidos nao podem virar dois deploys ao mesmo tempo — e a
   * corrida entre deploys e exatamente o que esta sendo consertado aqui.
   *
   * SEM COMENTARIO: este caso exigia `cancel-in-progress: true` no texto CRU e
   * continuou verde depois de eu trocar o valor para `false`, porque o novo
   * comentario do arquivo CITA o valor antigo explicando por que ele saiu. A
   * asercao estava casando com a minha propria documentacao.
   */
  it('um deploy por vez', () => {
    expect(semComentarios).toContain('concurrency:');
    expect(semComentarios).toContain('group: deploy-vps');
  });
});


/*
 * O PORTEIRO DA REGRA DOS GANCHOS.
 *
 * Em 10/09/2026 eu publiquei a vitrine da Galderio com um `useState` declarado
 * depois do `return` de carregamento. Na primeira renderizacao o gancho nao
 * rodava, na segunda rodava; o React conta ganchos e derrubou a pagina — quem
 * abria a loja via "Ops, algo deu errado". O `tsc` compila isso sem reclamar,
 * porque nao e erro de tipo.
 *
 * O eslint do projeto PEGAVA. Ninguem rodava, e com razao: `npm run lint` leva
 * 78 segundos e reporta 250 problemas antigos (101 variaveis nao usadas, 73
 * `any`), entao o aviso que era um site fora do ar ficava enterrado no meio.
 *
 * A correcao estrutural e este passo no deploy: UMA regra, sem carregar tipos,
 * 22 segundos, antes de qualquer coisa ser publicada. Conferido reintroduzindo
 * o bug — o porteiro acusa e sai com codigo 1.
 */
describe('o deploy confere a regra dos ganchos do React', () => {
  const config = fs.readFileSync(
    path.join(__dirname, '../../frontend/eslint.ganchos.config.js'), 'utf8');

  /*
   * O CODIGO, SEM OS COMENTARIOS — e esta linha e o teste do teste.
   *
   * A primeira versao destes dois casos lia o `deploy.sh` cru, e o comentario
   * que eu escrevi ali em cima cita o nome do arquivo de configuracao. Medido
   * por sabotagem: comentando a linha que chama o eslint, os dois continuavam
   * verdes — o porteiro podia ser desligado num commit e nada acusava. O
   * arquivo ja tinha `execSh` para exatamente isso; eu nao usei.
   */
  it('o deploy roda a conferencia', () => {
    expect(execSh(deploy)).toContain('eslint src --config eslint.ganchos.config.js');
  });

  /*
   * E RODA ANTES DE PUBLICAR. Depois do build nao serve de nada: o objetivo e
   * o deploy morrer com o que esta no ar intocado.
   */
  it('a conferencia vem antes do build do frontend', () => {
    const codigo = execSh(deploy);
    const porteiro = codigo.indexOf('eslint.ganchos.config.js');
    const build = codigo.indexOf('vite build');
    expect(porteiro).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(-1);
    expect(porteiro).toBeLessThan(build);
  });

  it('a regra que quebra a tela esta ligada', () => {
    expect(config).toContain("'react-hooks/rules-of-hooks': 'error'");
  });

  /*
   * UM DEPLOY POR VEZ, E A TRAVA E NO VPS.
   *
   * O `concurrency` da Action cancela o JOB; cancelar o job nao mata o script
   * que ja esta rodando la — o ssh cai e o `deploy.sh` segue sozinho ate o fim.
   * Com dois no mesmo diretorio, o segundo grava o ponto de retorno do rollback
   * a partir do estado meio publicado do primeiro, e o rollback passa a apontar
   * para um ponto que nunca esteve no ar. O padrao aconteceu em 10/09/2026: um
   * push quebrou a vitrine e o push de correcao veio minutos depois.
   */
  it('o deploy se tranca antes de mexer em qualquer coisa', () => {
    const codigo = execSh(deploy);
    expect(codigo).toContain('flock');
    const trava = codigo.indexOf('flock');
    /* Antes do primeiro passo que escreve: o ponto de retorno. */
    const retorno = codigo.indexOf('ANTES=$(git rev-parse HEAD)');
    expect(trava).toBeGreaterThan(-1);
    expect(retorno).toBeGreaterThan(-1);
    expect(trava).toBeLessThan(retorno);
  });

  /* Quem chega depois espera; nao atropela e nao desiste calado. */
  it('quem nao consegue a trava para, e diz que nao mexeu em nada', () => {
    const codigo = execSh(deploy);
    expect(codigo).toMatch(/flock -w \d+ 9/);
    expect(codigo).toMatch(/exit 1/);
  });

  /* E a Action nao pode mais cancelar o run anterior: cancelar o job deixa o
     script rodando no VPS, que e exatamente o cenario que a trava previne. */
  it('a Action espera em vez de cancelar', () => {
    const action = fs.readFileSync(path.join(RAIZ, '.github/workflows/deploy.yml'), 'utf8')
      .replace(/^\s*#.*$/gm, '');
    expect(action).toContain('cancel-in-progress: false');
    expect(action).not.toContain('cancel-in-progress: true');
  });

  /*
   * UMA REGRA SO, e isso e a razao de existir uma configuracao separada.
   * `exhaustive-deps` tem 28 violacoes antigas e e conselho; ligar tudo aqui
   * transformaria o porteiro no mesmo `npm run lint` que ninguem roda.
   */
  it('nao liga as regras de conselho junto', () => {
    const semComentario = config.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(semComentario).not.toContain('exhaustive-deps');
    expect(semComentario).not.toContain('no-explicit-any');
    expect(semComentario).not.toContain('configs.flat.recommended');
  });
});
