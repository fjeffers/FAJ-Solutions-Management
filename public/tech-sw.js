// FAJ Tech Portal service worker.
// Scoped to /tech only, separate from the owner app's service worker.
const CACHE_NAME = 'faj-tech-v1';
const PRECACHE = ['/tech'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
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
        // Offline navigation with no exact match: fall back to /tech
        if (e.request.mode === 'navigate') {
          const shell = await caches.match('/tech');
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});

// Push notifications for techs
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'FAJ Tech', {
    body: d.body || '',
    icon: '/icons/tech-icon-192.png',
    badge: '/icons/tech-icon-192.png',
    tag: d.tag || undefined,
    data: { url: d.url || '/tech' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/tech';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && 'focus' in c) {
          if ('navigate' in c) c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
