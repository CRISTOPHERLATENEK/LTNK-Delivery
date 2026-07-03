/**
 * Service worker do app (PWA). Torna o app instalável e resiliente:
 * - App shell e assets em cache (stale-while-revalidate).
 * - Navegação network-first com fallback ao cache (abre offline).
 * - Nunca cacheia /api (dados sempre frescos).
 */
const CACHE = 'delivery-app-v2';
const ESSENCIAIS = ['/'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ESSENCIAIS)).catch(() => {}));
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

  // Navegação (HTML): rede primeiro, cai para o cache se offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
          return r;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match('/')))
    );
    return;
  }

  // Demais assets: responde do cache e atualiza em segundo plano
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
        .catch(() => cached);
      return cached || naRede;
    })
  );
});
