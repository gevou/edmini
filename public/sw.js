// Kill-switch service worker (edmini-…): edmini is online-only (OpenAI Realtime, Supabase, Discord),
// so a service worker buys nothing and its HTML caching repeatedly caused stale-app-shell bugs
// (old HTML referencing replaced /_next chunk hashes → ChunkLoadError, surviving close-and-reopen).
//
// This worker REMOVES the service worker entirely. Browsers that still have the old caching SW
// registered will fetch this on their next update check; it purges all caches, unregisters itself,
// and reloads open tabs to a clean network load. New visitors never register a worker at all
// (see src/components/SwCleanup.tsx). There is no fetch handler — every request goes to the network.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        /* ignore */
      }
      try {
        await self.registration.unregister();
      } catch {
        /* ignore */
      }
      // Reload any open tabs so they re-fetch fresh from the network (no SW in the way).
      const windows = await self.clients.matchAll({ type: 'window' });
      for (const c of windows) {
        try {
          c.navigate(c.url);
        } catch {
          /* ignore */
        }
      }
    })(),
  );
});
