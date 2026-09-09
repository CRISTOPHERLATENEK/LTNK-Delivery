import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/*
 * RESPOSTA DE /api NÃO PODE FICAR GUARDADA NO NAVEGADOR.
 *
 * O sintoma que levou a isto: "Entrar como lojista" funcionava para um cliente
 * e não para outro, sem nada em comum entre os dois. O log do nginx mostrou o
 * que estava acontecendo — em seis tentativas seguidas, a chamada de validação
 * `/api/auth/eu` NÃO APARECIA no servidor. Não dava erro: ela nunca saía do
 * navegador.
 *
 * A causa, medida com `curl -D -` contra produção: as respostas de /api vinham
 * com `ETag` e SEM `Cache-Control`. Sem instrução explícita o navegador aplica
 * frescor heurístico e reaproveita a resposta por conta própria; e a Cloudflare,
 * com Browser Cache TTL fixo em 4h, estampa `max-age` no que ela considera
 * cacheável. A resposta de "quem sou eu" de uma sessão ficava guardada horas e
 * era servida para a próxima — com outro token, e possivelmente de outra loja.
 *
 * Num sistema multi-cliente a mesma URL devolve dados diferentes por sessão e
 * por tenant. Resposta autenticada guardada é resposta de um usuário entregue a
 * outro; o defeito de "não consigo entrar" era o sintoma simpático dele.
 */

const server = fs.readFileSync(path.join(__dirname, 'server.ts'), 'utf8');

/** Só o que executa: comentário citando o erro evitado não conta como erro. */
function exec(fonte: string): string {
  return fonte.split('\n')
    .filter(l => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

const codigo = exec(server);

describe('o cabeçalho de /api', () => {
  it('o teste está lendo o arquivo certo', () => {
    expect(codigo).toContain("app.use('/api/auth', autenticacaoRoutes)");
  });

  /*
   * VALE PARA /api INTEIRO, não para uma rota escolhida. Proteger só
   * `/api/auth/eu` deixaria `/api/lojista/loja`, `/api/lojista/pedidos` e as
   * outras com o mesmo problema — e o problema é o mesmo em todas.
   */
  it('o middleware cobre /api inteiro', () => {
    expect(codigo).toMatch(/app\.use\('\/api', \(_req, res, next\) => \{/);
  });

  /*
   * `no-store` e não `no-cache`. `no-cache` permite GUARDAR e revalidar — e
   * revalidação de resposta autenticada é exatamente o que não se quer.
   */
  it('manda no-store, não no-cache', () => {
    expect(codigo).toContain("'Cache-Control', 'private, no-store'");
    expect(codigo).not.toContain("'Cache-Control', 'private, no-cache');\n  res.removeHeader");
  });

  /*
   * O `private` é medido, não decorativo: sem ele a Cloudflare sobrescreve o
   * header da origem (é a mesma armadilha documentada no material de
   * treinamento, no `setHeaders` do express.static).
   */
  it('o private está lá, porque a Cloudflare sobrescreve sem ele', () => {
    const meio = codigo.slice(codigo.indexOf("app.use('/api', (_req, res, next)"));
    expect(meio.slice(0, 400)).toContain('private');
  });

  /*
   * E O ETAG SAI. Com `no-store` ele não tem função, e deixá-lo é convidar
   * revalidação condicional para uma resposta que não deveria ter cópia.
   *
   * Uma só chamada a `removeHeader` NÃO resolve: o Express calcula o ETag na
   * hora de enviar, depois do middleware. Por isso o `writeHead` é ganchado —
   * é o momento em que o cabeçalho já existe e ainda não foi para a rede.
   */
  it('o ETag é removido também na hora do envio', () => {
    const meio = codigo.slice(codigo.indexOf("app.use('/api', (_req, res, next)"));
    const bloco = meio.slice(0, meio.indexOf('next();'));
    expect((bloco.match(/removeHeader\('ETag'\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(bloco).toContain('res.writeHead = ');
  });

  /*
   * ORDEM: o middleware tem que vir ANTES das rotas, senão ele não roda para
   * nenhuma delas.
   */
  it('vem antes de montar as rotas de /api', () => {
    const iMw = codigo.indexOf("app.use('/api', (_req, res, next)");
    const iAuth = codigo.indexOf("app.use('/api/auth', autenticacaoRoutes)");
    expect(iMw).toBeGreaterThan(0);
    expect(iMw).toBeLessThan(iAuth);
  });

  /*
   * E O 404 DE ARQUIVO ESTÁTICO TAMBÉM NÃO PODE SER GUARDADO.
   *
   * Mesma família de defeito, descoberta na mesma tarde: o 404 vinha do Express
   * sem `Cache-Control`, e 404 sem instrução é heuristicamente cacheável. O
   * `deploy.sh` troca a pasta com dois `mv` e existe uma janela de
   * milissegundos em que todo arquivo dá 404 — quem carregar a página nessa
   * janela guarda o 404 do chunk novo e a loja fica EM BRANCO para essa pessoa
   * até o cache expirar, com o arquivo já no lugar no servidor.
   *
   * Medido: `index-Dmcv9H2K.js` dava 404 na aba e 200 no `curl`, existindo em
   * disco. Aba nova não resolvia, limpar o service worker não resolvia — o 404
   * morava no cache HTTP do navegador.
   */
  it('404 de arquivo estático manda no-store', () => {
    const i = codigo.indexOf("if (req.method !== 'GET' || req.path.startsWith('/api')) return next();");
    expect(i).toBeGreaterThan(0);
    const bloco = codigo.slice(i, i + 260);
    expect(bloco).toContain("'Cache-Control', 'private, no-store'");
    expect(bloco).toContain('res.status(404)');
  });

  /* E vem ANTES do 404 de /api, senão o de /api nunca responde JSON. */
  it('o 404 estático não engole o 404 de /api', () => {
    const iEstatico = codigo.indexOf("res.status(404).type('text/plain')");
    const iApi = codigo.indexOf("res.status(404).json({ erro: 'Rota não encontrada.' })");
    expect(iEstatico).toBeGreaterThan(0);
    expect(iApi).toBeGreaterThan(iEstatico);
    /* A guarda que garante isso: o handler estático devolve o controle para
       quem vem depois quando o caminho é de API. */
    expect(codigo).toContain("req.path.startsWith('/api')) return next();");
  });

  /*
   * E NÃO ENCOSTA NO QUE NÃO É /api. O `private, no-cache` do material de
   * treinamento (ajuda) é outra decisão, medida, e continua valendo: ali
   * guardar e revalidar é o que se quer.
   */
  it('o cache do material de ajuda continua como estava', () => {
    expect(codigo).toContain("res.setHeader('Cache-Control', 'private, no-cache')");
  });
});
