/**
 * Service worker do app (PWA). Torna o app instalável e resiliente:
 * - App shell e assets em cache (stale-while-revalidate).
 * - Navegação network-first com fallback ao cache (abre offline).
 * - Nunca cacheia /api (dados sempre frescos).
 */
const CACHE = 'delivery-app-v4';
const ESSENCIAIS = ['/'];

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

  // Demais assets: responde do cache e atualiza em segundo plano. Mesma
  // garantia de sempre devolver um Response de verdade (nunca undefined).
  e.respondWith(
    caches.match(req).then((cached) => {
      const naRede = fetch(req)
        .then((r) => {
          if (r && r.ok) {
            const copia = r.clone();
            caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
          }
          return r;
        })
        .catch(() => cached || new Response('', { status: 504, statusText: 'Sem rede e sem cache' }));
      return cached || naRede;
    })
  );
});
