// FAJ Business Manager service worker.
// v2: cache name bump wipes caches left behind by the LEGACY portal app (this
// file once precached its '/contractor' route — a 404 here, which made
// cache.addAll reject and silently broke the install on every phone).
// v3: the tech portal opens with no signal (Fred, 2026-10-02) — offline
// navigation under /tech falls back to the saved /tech page, never the office's
// '/', and a redirected answer (signed out → login) is never saved as the page.
const CACHE_NAME = 'faj-v3';
const PRECACHE = ['/', '/login'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Tolerant precache: one failed URL must never sink the whole install
      Promise.allSettled(PRECACHE.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API traffic: it's authenticated, live business data
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && !res.redirected) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(e.request, e.request.mode === 'navigate' ? { ignoreSearch: true } : undefined);
        if (hit) return hit;
        // Offline navigation with no exact match: fall back to the right shell —
        // the tech portal for /tech, the office app for everything else.
        if (e.request.mode === 'navigate') {
          const shell = url.pathname.startsWith('/tech') ? await caches.match('/tech') : await caches.match('/');
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
