import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * O APP NÃO PODE BAIXAR 980 KB PRA MOSTRAR UMA TELA.
 *
 * Reclamação do lojista em 09/09/2026: "demora dois anos pra carregar". Medido
 * na origem, o servidor respondia em 10-28 ms — não era o servidor. Era o que
 * ele mandava:
 *
 *   1. SEM COMPRESSÃO. O nginx do Ubuntu vem com `gzip on;` e `gzip_types`
 *      COMENTADO, e sem gzip_types ele comprime só text/html. A linha `gzip on`
 *      estava lá e parecia ligada. O primeiro acesso baixava 9 arquivos,
 *      980.438 bytes crus, quando comprimidos são 292.808 — 70% de desperdício,
 *      em toda visita.
 *
 *   2. REVALIDAÇÃO DE ARQUIVO IMUTÁVEL. O `express.static` responde
 *      `public, max-age=0` por padrão: o navegador guarda mas PERGUNTA antes de
 *      usar cada arquivo, toda vez. Nove idas ao servidor por carga, para
 *      arquivos que têm hash no nome e por definição não mudam.
 *
 * Os dois são invisíveis em código: nada quebra, nada aparece no log, o site só
 * fica lento — e a lentidão é atribuída a "internet ruim".
 */

const BACKEND = __dirname;
const RAIZ = path.join(BACKEND, '..', '..');
const server = fs.readFileSync(path.join(BACKEND, 'server.ts'), 'utf8');
const nginx = fs.readFileSync(path.join(RAIZ, 'infra', 'nginx-gzip.conf'), 'utf8');

/** Só o que executa: comentário citando o erro evitado não conta como erro. */
function exec(fonte: string): string {
  return fonte.split('\n')
    .filter(l => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

describe('arquivo com hash não revalida', () => {
  /*
   * `immutable` é a peça que importa. Sem ele o navegador revalida assim que a
   * pessoa aperta F5, mesmo dentro do max-age — e F5 é exatamente o que se faz
   * quando o site parece lento.
   */
  it('app-assets sai como imutável, por um ano', () => {
    const codigo = exec(server);
    const i = codigo.indexOf("app-assets[\\\\/]");
    expect(i).toBeGreaterThan(-1);
    expect(codigo.slice(i, i + 200)).toContain("'public, max-age=31536000, immutable'");
  });

  /*
   * A ORDEM DOS RAMOS. `index.html` e `sw.js` precisam continuar `no-store` — é
   * o index.html que decide qual versão a pessoa recebe, e um index.html
   * cacheado por um ano congelaria o app na versão de hoje para sempre.
   */
  it('index.html e sw.js continuam sem cache, e vêm antes', () => {
    const codigo = exec(server);
    const iHtml = codigo.indexOf("filePath.endsWith('index.html')");
    const iAssets = codigo.indexOf("app-assets[\\\\/]");
    expect(iHtml).toBeGreaterThan(-1);
    expect(iHtml).toBeLessThan(iAssets);
    expect(codigo.slice(iHtml, iHtml + 220)).toContain("'no-cache, no-store, must-revalidate'");
  });

  /*
   * E O MATERIAL DE AJUDA CONTINUA REVALIDANDO. Esses arquivos NÃO têm hash:
   * /ajuda/alcas-ordenacao.svg é sempre o mesmo caminho com conteúdo novo.
   * Cair na regra de imutável congelaria a ajuda por um ano — ela passaria a
   * ensinar a procurar no lugar errado, com confiança.
   */
  it('a ajuda não cai na regra de imutável', () => {
    const codigo = exec(server);
    const iAjuda = codigo.indexOf('(ajuda)');
    const iAssets = codigo.indexOf("app-assets[\\\\/]");
    expect(iAjuda).toBeLessThan(iAssets);
    /* O `return` é o que impede a ajuda de continuar e receber o header novo. */
    expect(codigo.slice(iAjuda, iAssets)).toContain('return;');
  });
});

describe('a compressão do nginx viaja com o código', () => {
  /*
   * Config que só existe na máquina volta ao padrão numa reinstalação, numa
   * máquina nova ou num apt upgrade que substitua o arquivo. O sintoma de volta
   * é "o site está lento" — que ninguém liga ao nginx.
   */
  it('gzip_types cobre JS, CSS, JSON e SVG', () => {
    const linha = nginx.split('\n').find(l => l.trimStart().startsWith('gzip_types')) ?? '';
    for (const tipo of ['application/javascript', 'text/css', 'application/json', 'image/svg+xml']) {
      expect(linha).toContain(tipo);
    }
  });

  /*
   * `gzip_types` NÃO PODE ESTAR COMENTADO — que era exatamente o estado
   * anterior. `gzip on` sozinho comprime só text/html, então a config parecia
   * ligada e não era.
   */
  it('nenhuma diretiva essencial está comentada', () => {
    const ativas = nginx.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
    for (const d of ['gzip on;', 'gzip_types', 'gzip_proxied any;', 'gzip_vary on;']) {
      expect(ativas.some(l => l.startsWith(d.split(' ')[0]) && l.includes(d.replace(';', '')))).toBe(true);
    }
  });

  /*
   * `gzip_proxied any` é obrigatório aqui: o tráfego chega pela Cloudflare, e
   * sem essa diretiva o nginx não comprime resposta para requisição de proxy —
   * ou seja, não comprimiria para ninguém em produção.
   */
  it('comprime também o que vem de proxy', () => {
    expect(nginx).toContain('gzip_proxied any;');
  });

  /*
   * Imagem já comprimida (png/jpg/webp) fica FORA: passar gzip nelas gasta CPU
   * para às vezes aumentar o arquivo. SVG entra porque é texto.
   */
  it('não tenta comprimir imagem já comprimida', () => {
    const linha = nginx.split('\n').find(l => l.trimStart().startsWith('gzip_types')) ?? '';
    for (const tipo of ['image/png', 'image/jpeg', 'image/webp', 'video/']) {
      expect(linha).not.toContain(tipo);
    }
  });
});
