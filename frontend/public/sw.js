/**
 * Service worker do app (PWA). Torna o app instalável e resiliente:
 * - App shell e assets em cache (stale-while-revalidate).
 * - Navegação network-first com fallback ao cache (abre offline).
 * - Nunca cacheia /api (dados sempre frescos).
 */
/* v6: o SW passou a curar 404 envenenado de asset com hash (ver o fetch
   abaixo). O nome muda para o `activate` apagar o cache da versão anterior. */
const CACHE = 'delivery-app-v6';
const ESSENCIAIS = ['/'];

/**
 * Assets com hash no nome (vite: assetsDir 'app-assets') são IMUTÁVEIS: se o
 * conteúdo muda, o nome muda. Revalidar esses é desperdício — e pior, virava
 * 404 permanente: a cada build o arquivo antigo é apagado do servidor, mas a
 * entrada velha continuava no cache pedindo ele em toda visita (o `r.ok` abaixo
 * nunca limpava o que dava 404). Cache-first sem rede resolve os dois.
 */
const ehImutavel = (url) => url.pathname.startsWith('/app-assets/');

/**
 * BUSCA COM UMA SEGUNDA CHANCE.
 *
 * `fetch` rejeita por qualquer solucao de continuidade da rede: Wi-Fi trocando
 * de ponto, 4G mudando de antena, o servidor recarregando num deploy. Uma
 * unica falha dessas virava 504 definitivo e o recurso nao carregava — uma
 * piscada de rede virando erro permanente naquela carga.
 *
 * UMA tentativa a mais, e so. Nao e laco: servidor fora do ar continua fora na
 * segunda, e insistir mais atrasaria a mensagem de erro que a pessoa precisa
 * ver. A pausa existe porque falha de rede raramente se resolve no mesmo
 * milissegundo — repetir na hora costuma falhar pelo mesmo motivo.
 */
async function buscarComSegundaChance(req) {
  try {
    return await fetch(req);
  } catch (erro) {
    await new Promise((r) => setTimeout(r, 400));
    return fetch(req);
  }
}

/**
 * A resposta de desistencia.
 *
 * O TEXTO IMPORTA. Antes dizia "Sem rede e sem cache", e o console do
 * navegador escreve "the server responded with a status of 504" em volta
 * disso: parecia erro do SERVIDOR, que nunca chegou a ser consultado. Foi
 * exatamente o que aconteceu — o 504 apareceu no console e mandou procurar no
 * lugar errado. Agora o texto diz de quem e a falha.
 */
function semRede() {
  return new Response('', {
    status: 504,
    statusText: 'offline: o navegador nao alcancou o servidor',
  });
}

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ESSENCIAIS))
      .catch((err) => console.warn('[sw] falha ao cachear o app shell no install:', err))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // ignora terceiros (fontes, CDNs)
  if (url.pathname.startsWith('/api')) return;       // API sempre na rede

  // Navegação (HTML): rede primeiro, cai para o cache se offline. SEMPRE
  // resolve pra um Response de verdade — se o fetch falhar (offline/instável)
  // E a rota nunca tiver sido cacheada, devolve uma página mínima de "sem
  // conexão" em vez de deixar o respondWith() receber undefined (isso gerava
  // "Failed to convert value to Response" no console).
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => {
          // Só cacheia navegação BEM-SUCEDIDA — senão um 401/500/redirect vira
          // fallback offline e "prende" o usuário numa página de erro/login.
          if (r && r.ok) {
            const copia = r.clone();
            caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
          }
          return r;
        })
        .catch(async () => {
          const doRequest = await caches.match(req);
          if (doRequest) return doRequest;
          const shell = await caches.match('/');
          if (shell) return shell;
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>Sem conexão</title>' +
            '<body style="font-family:system-ui;text-align:center;padding:48px 20px;color:#333">' +
            '<h1>Você está offline</h1><p>Conecte-se à internet e tente novamente.</p></body>',
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          );
        })
    );
    return;
  }

  // Asset imutável já em cache: devolve e pronto, sem tocar na rede.
  if (ehImutavel(url)) {
    e.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return buscarComSegundaChance(req)
          .then(async (r) => {
            /*
             * 404 NUM ASSET COM HASH É MENTIRA DO CACHE ATÉ PROVA EM CONTRÁRIO.
             *
             * O nome tem hash: se o index.html está pedindo este arquivo, ele
             * existe no servidor. Um 404 aqui quase sempre vem do cache HTTP do
             * NAVEGADOR, não da rede — e ele é durável.
             *
             * De onde vinha: a publicação tinha uma janela em que a pasta
             * servida não existia, e o 404 dela saía sem `Cache-Control`. O
             * navegador guardava e passava a responder 404 sozinho, sem tocar no
             * servidor. Um chunk envenenado (o `utils`) deixa o app sem subir:
             * tela branca. Medido: `only-if-cached` devolvia 404 e `reload`
             * devolvia 200, no mesmo instante, para o mesmo arquivo.
             *
             * A janela foi fechada no deploy.sh e o 404 agora sai `no-store`.
             * Isto aqui é para os navegadores que JÁ estão envenenados: uma
             * tentativa com `cache: 'reload'` ignora a cópia local, substitui a
             * entrada podre e o app sobe. Sem isto, cada pessoa precisaria de um
             * Ctrl+Shift+R que ninguém vai pedir a ela.
             *
             * UMA tentativa só, e só em 404/410: repetir 5xx aqui seria insistir
             * contra um servidor que já está sofrendo.
             */
            if (r && (r.status === 404 || r.status === 410)) {
              try {
                const daRede = await fetch(req, { cache: 'reload' });
                if (daRede && daRede.ok) {
                  const copia = daRede.clone();
                  caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
                  return daRede;
                }
              } catch (_) { /* sem rede: devolve o 404 original abaixo */ }
            }
            if (r && r.ok) {
              const copia = r.clone();
              caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
            }
            return r;
          })
          .catch(() => semRede());
      })
    );
    return;
  }

  // Demais assets: responde do cache e atualiza em segundo plano. Mesma
  // garantia de sempre devolver um Response de verdade (nunca undefined).
  e.respondWith(
    caches.match(req).then((cached) => {
      const naRede = buscarComSegundaChance(req)
        .then((r) => {
          if (r && r.ok) {
            const copia = r.clone();
            caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
            return r;
          }
          // Sumiu do servidor (404/410): descarta a cópia velha em vez de
          // continuar servindo — e pedindo — um arquivo que não existe mais.
          if (r && (r.status === 404 || r.status === 410)) {
            caches.open(CACHE).then((c) => c.delete(req)).catch(() => {});
          }
          return r;
        })
        .catch(() => cached || semRede());
      return cached || naRede;
    })
  );
});
