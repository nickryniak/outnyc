// =============================================================================
// OutNYC: service worker (public/sw.js)
// =============================================================================
// Makes the home-screen app work offline and load instantly. Strategy:
//   - Navigations: network-first, falling back to the cached shell. New
//     deploys arrive on the next online launch; offline launches still work.
//   - Hashed build assets (/_expo/, /assets/): cache-first. Filenames embed a
//     content hash, so a cached copy can never be stale.
// All URLs are relative to the worker's own location, so the same file works
// at the domain root (local dist serving) and under /outnyc (GitHub Pages).
// =============================================================================

const CACHE = 'outnyc-v1';
const SHELL = './';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Any in-app navigation (including deep links like /plan/2026-07-10) is
  // served by the single shell page; expo-router routes on the client.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(CACHE)
              .then((cache) => cache.put(SHELL, copy))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(SHELL))
    );
    return;
  }

  if (url.pathname.includes('/_expo/') || url.pathname.includes('/assets/') || url.pathname.includes('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches
                .open(CACHE)
                .then((cache) => cache.put(request, copy))
                .catch(() => {});
            }
            return response;
          })
      )
    );
  }
});
