// WorkFlow's offline worker (no-signal mode, Fred 2026-10-02).
//
// Keeps the app itself on the phone so WorkFlow opens with no signal:
//   - WorkFlow's own files (/workflow/…): network first, so every update comes
//     through the moment there is signal; the saved copy is used only offline.
//   - Flutter's engine and fonts from Google's CDN (gstatic / fonts.googleapis):
//     saved the first time and reused, because those URLs never change.
// It never touches job data: the database (Supabase) and /api/ calls go
// straight to the network. Jobs and taps are kept by the app itself.
const CACHE = 'workflow-v1';
const CORE = [
  './', 'index.html', 'main.dart.js', 'flutter.js', 'flutter_bootstrap.js', 'manifest.json', 'favicon.png',
  'icons/Icon-192.png', 'assets/AssetManifest.bin.json', 'assets/FontManifest.json',
  'assets/fonts/MaterialIcons-Regular.otf', 'assets/assets/images/logo.png', 'assets/assets/images/hero.jpg',
];
const CDN = ['www.gstatic.com', 'fonts.gstatic.com', 'fonts.googleapis.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      // One missing file must never sink the whole install.
      Promise.allSettled(CORE.map((u) => cache.add(new Request(u, { cache: 'reload' })))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('workflow-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (!url.pathname.startsWith('/workflow')) return; // the office app and /api/ are not ours
    e.respondWith(networkFirst(req));
    return;
  }
  if (CDN.includes(url.hostname)) {
    e.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = (await cache.match('index.html')) || (await cache.match('./'));
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}
