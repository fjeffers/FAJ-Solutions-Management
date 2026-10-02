// Retires the separate WorkFlow app (Fred, 2026-10-02: "all one app with a
// tech portal"). WorkFlow's features now live in the FAJ app itself.
//
// A phone that opened app.fajsolutions.com/workflow kept WorkFlow's offline
// worker, which would otherwise keep serving the old app from its saved copy.
// Browsers re-check this file whenever /workflow is opened, find this version,
// and run it once: it deletes WorkFlow's saved files, removes itself, and moves
// any open WorkFlow window to the tech portal.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('workflow-')).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    for (const w of windows) {
      try { await w.navigate('/tech'); } catch { /* the window closed meanwhile */ }
    }
  })());
});
