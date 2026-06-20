// edmini service worker (edmini-d8r).
// Caching strategy chosen to AVOID stale-app-shell bugs (the v1 SW served `cached ?? fresh` for the
// HTML document, pinning users to old HTML that referenced old /_next chunk hashes → ChunkLoadError
// after every deploy):
//   - HTML / navigations  → NETWORK-FIRST, so the document always points at the current build's
//     chunks; fall back to cache only when offline.
//   - /_next/static/*      → CACHE-FIRST, safe because those filenames are content-hashed and
//     immutable for a given build.
//   - /api/*               → never cached.
// Bumping the cache name purges the old stale `ed-v1` cache on activate.
const CACHE = 'ed-v2';
const STATIC_PREFIX = '/_next/static/';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // only same-origin
  if (url.pathname.startsWith('/api/')) return; // never cache API

  // Immutable hashed build assets → cache-first.
  if (url.pathname.startsWith(STATIC_PREFIX)) {
    e.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // HTML / navigations / everything else → network-first (cache only as offline fallback).
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && req.mode === 'navigate') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached ?? Response.error())),
  );
});
