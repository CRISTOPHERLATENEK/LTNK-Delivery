import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * PUBLICAR NÃO PODE TER UM INSTANTE EM QUE O ARQUIVO NÃO EXISTE.
 *
 * A história, medida no mesmo dia:
 *
 * A troca era `mv public public.trocando; mv public.novo public`. Parece
 * instantânea e não é — entre os dois `mv` a pasta servida NÃO EXISTE, e todo
 * pedido nessa fração de segundo leva 404. O rollback era pior: `mv` seguido de
 * `cp -a` de pasta inteira, com a pasta ausente durante SEGUNDOS.
 *
 * E 404 deixa marca. Ele saía sem `Cache-Control`, então o navegador guardava e
 * passava a responder 404 sozinho, sem tocar no servidor. Um único chunk
 * envenenado — o `utils`, onde mora o código compartilhado — deixa o app sem
 * subir: tela branca, `#root` vazio, e nada no servidor para acusar, porque lá o
 * arquivo está no lugar.
 *
 * O sintoma que apareceu, e que levou dois diagnósticos errados meus antes de
 * chegar aqui: "Entrar como lojista" parava de funcionar depois de cada deploy.
 * Não era a impersonação — era o app não subindo na aba nova. Provado com
 * `fetch(url, {cache:'only-if-cached'})` devolvendo 404 e `{cache:'reload'}`
 * devolvendo 200, no mesmo instante, para o mesmo arquivo.
 *
 * A segunda janela era mais longa e mais fácil de esquecer: a pasta nova não
 * tem os hashes ANTIGOS, então quem estava com o app aberto perdia os chunks
 * que ainda ia carregar — e isso dura até a pessoa recarregar.
 */

const RAIZ = path.join(__dirname, '..', '..');
const deploy = fs.readFileSync(path.join(RAIZ, 'deploy.sh'), 'utf8');
const rollback = fs.readFileSync(path.join(RAIZ, 'rollback.sh'), 'utf8');

/** Só o que executa: comentário citando o erro evitado não conta como erro. */
function exec(script: string): string {
  return script.split('\n').filter(l => !l.trimStart().startsWith('#')).join('\n');
}

for (const [nome, script] of [['deploy.sh', deploy], ['rollback.sh', rollback]] as const) {
  describe(nome, () => {
    const codigo = exec(script);

    it('o teste está lendo o script certo', () => {
      expect(codigo).toContain('public');
      expect(codigo.length).toBeGreaterThan(300);
    });

    /*
     * A ASSERÇÃO CENTRAL: a pasta servida nunca é movida nem removida.
     *
     * `mv public ...` e `rm -rf public` são as duas formas de fazer o diretório
     * deixar de existir. Qualquer uma volta a abrir a janela.
     */
    it('nunca move nem apaga a pasta que está sendo servida', () => {
      expect(codigo).not.toMatch(/\bmv\s+public\s/);
      expect(codigo).not.toMatch(/\brm\s+-rf\s+public\b(?!\.)/);
    });

    /*
     * ORDEM: os assets entram ANTES do index.html. É ele que aponta para os
     * hashes novos — publicá-lo primeiro é publicar referência para arquivo que
     * ainda não existe, que é a janela outra vez, só que com outro nome.
     */
    it('os assets entram antes do index.html', () => {
      const iAssets = codigo.indexOf('app-assets/.');
      const iIndex = codigo.indexOf('index.html public/.index.html');
      expect(iAssets).toBeGreaterThan(0);
      expect(iIndex).toBeGreaterThan(iAssets);
    });

    /*
     * O index.html troca com RENAME, não com cópia. `cp` escreve em pedaços, e
     * um index.html lido pela metade é uma página quebrada — janela de novo,
     * agora do tamanho de um write.
     */
    it('o index.html troca com rename atômico', () => {
      expect(codigo).toMatch(/mv -T public\/\.index\.html\.\w+ public\/index\.html/);
    });

    /*
     * ADITIVO: os assets novos entram JUNTO dos que já estão lá. Quem tem o app
     * aberto continua achando os chunks da versão dele.
     */
    it('a cópia dos assets é aditiva, sem limpar o destino antes', () => {
      const i = codigo.indexOf('cp -a public');
      const antes = codigo.slice(Math.max(0, i - 200), i);
      expect(antes).not.toMatch(/rm -rf public\/app-assets/);
      /* A forma `origem/.` copia o CONTEÚDO para dentro do destino — sem ela,
         `cp -a origem destino` aninharia `public/app-assets/app-assets`. */
      expect(codigo).toMatch(/app-assets\/\. public\/app-assets\//);
    });
  });
}

describe('a limpeza do lixo antigo', () => {
  const codigo = exec(deploy);

  /*
   * NÃO APAGA O DA VERSÃO ANTERIOR. Quem está com o app aberto ainda pede os
   * chunks dela; apagá-los no deploy recria exatamente o problema que a
   * publicação aditiva resolve.
   */
  it('só apaga asset com mais de alguns dias', () => {
    expect(codigo).toMatch(/find public\/app-assets -type f -mtime \+\d+ -delete/);
    const m = codigo.match(/-mtime \+(\d+)/);
    expect(Number(m?.[1] ?? 0)).toBeGreaterThanOrEqual(2);
  });

  /* E a limpeza não derruba o deploy se falhar: ela é higiene, não requisito. */
  it('falha na limpeza não interrompe o deploy', () => {
    const i = codigo.indexOf('find public/app-assets');
    expect(codigo.slice(i, i + 120)).toContain('|| true');
  });
});

describe('o service worker cura 404 envenenado', () => {
  const sw = fs.readFileSync(path.join(RAIZ, 'public', 'sw.js'), 'utf8');
  const swFonte = fs.readFileSync(path.join(RAIZ, 'frontend', 'public', 'sw.js'), 'utf8');
  /*
   * SÓ O QUE EXECUTA, para contar ocorrência.
   *
   * A primeira versão contava `cache: 'reload'` no arquivo inteiro e achava
   * DUAS: uma no código e uma no comentário que explica o conserto. É a quinta
   * vez nesta sessão que uma asserção minha acusa a minha própria documentação —
   * contar precisa olhar o código, não o texto sobre ele.
   */
  const swExec = sw.split('\n')
    .filter(l => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');

  /*
   * FECHAR A JANELA NÃO LIMPA QUEM JÁ FOI ENVENENADO.
   *
   * A publicação sem janela impede novos 404, e o `no-store` impede que um 404
   * deixe marca. Nenhum dos dois alcança o navegador que JÁ guardou um — e
   * enquanto essa entrada existir, o app não sobe naquele aparelho. Sem esta
   * cura, cada pessoa precisaria de um Ctrl+Shift+R que ninguém vai pedir a ela.
   */
  it('tenta a rede ignorando o cache quando o asset dá 404', () => {
    expect(sw).toContain("fetch(req, { cache: 'reload' })");
    const i = sw.indexOf("r.status === 404 || r.status === 410");
    expect(i).toBeGreaterThan(0);
    /* Dentro do ramo de asset imutável — é lá que vive o chunk com hash. */
    const iImutavel = sw.indexOf('if (ehImutavel(url))');
    expect(iImutavel).toBeGreaterThan(0);
    expect(iImutavel).toBeLessThan(i);
  });

  /* UMA tentativa, e só em 404/410: repetir 5xx seria insistir contra um
     servidor que já está sofrendo. */
  it('só repete em 404/410, e uma vez', () => {
    const i = swExec.indexOf("cache: 'reload'");
    const bloco = swExec.slice(Math.max(0, i - 400), i + 400);
    expect(bloco).not.toContain('status >= 500');
    expect((swExec.match(/cache: 'reload'/g) ?? []).length).toBe(1);
  });

  /* E o resultado bom é guardado, para a próxima visita não pagar de novo. */
  it('guarda o que veio da rede', () => {
    const i = swExec.indexOf("cache: 'reload'");
    expect(swExec.slice(i, i + 300)).toContain('c.put(req, copia)');
  });

  /*
   * O NOME DO CACHE MUDOU. O `activate` apaga todo cache com nome diferente do
   * atual — sem o bump, o SW novo conviveria com o conteúdo guardado pelo
   * antigo.
   */
  it('o nome do cache foi bumpado', () => {
    expect(sw).toMatch(/const CACHE = 'delivery-app-v([6-9]|\d{2,})'/);
  });

  /*
   * AS DUAS CÓPIAS ANDAM JUNTAS. `frontend/public/sw.js` é a fonte que o vite
   * copia; `public/sw.js` é o que está servido. Consertar uma e esquecer a outra
   * faz o conserto sobreviver até o próximo build — e depois desaparecer.
   */
  it('as duas cópias do sw.js são idênticas', () => {
    expect(swFonte).toBe(sw);
  });
});

describe('o que já valia e não pode regredir', () => {
  const codigo = exec(deploy);

  /* Build numa cópia: build que falha não encosta no que está no ar. */
  it('o frontend continua sendo construído em public.novo', () => {
    expect(codigo).toContain('--outDir ../public.novo');
  });

  /* E a conferência antes de publicar: build que "termina" sem index.html ou
     sem asset existe, e publicar assim seria publicar o problema. */
  it('confere o build antes de publicar', () => {
    expect(codigo).toContain('[ -s public.novo/index.html ]');
    expect(codigo).toContain('public.novo/app-assets');
    const iConfere = codigo.indexOf('[ -s public.novo/index.html ]');
    const iPublica = codigo.indexOf('cp -a public.novo/app-assets/.');
    expect(iConfere).toBeLessThan(iPublica);
  });

  /* O ponto de retorno continua sendo guardado antes de tudo. */
  it('guarda o ponto de retorno antes de mexer em qualquer coisa', () => {
    const iRetorno = codigo.indexOf('.deploy-anterior');
    const iReset = codigo.indexOf('git reset --hard');
    expect(iRetorno).toBeGreaterThan(0);
    expect(iRetorno).toBeLessThan(iReset);
  });

  /* `reload` e não `restart`: em cluster, restart derruba as três instâncias de
     uma vez — origem dos 502 a cada deploy. */
  it('recarrega sem derrubar tudo de uma vez', () => {
    expect(codigo).toContain('pm2 reload ecosystem.config.js');
    expect(codigo).not.toMatch(/pm2 restart/);
  });
});
