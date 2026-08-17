// D-LOG service worker.
//
// History of this file is a history of stale builds reaching the phone. Two things had to be true
// before a deploy could actually show up, and only the first was ever fixed:
//   1. The service worker must not serve its own cached copy first  → fixed 10 Aug (network-first).
//   2. The *browser's HTTP cache* must not serve a stale copy either → GitHub Pages sends
//      `Cache-Control: max-age=600` on every file, and a plain fetch() inside a service worker
//      honours that cache. So for up to 10 minutes after a push, "network-first" still returned
//      the old file — and an installed iOS PWA that gets resumed rather than relaunched could sit
//      on that old copy indefinitely, which is why deleting and re-adding the icon "fixed" it.
// Every same-origin GET below is now fetched with `cache: 'reload'`, which bypasses the HTTP cache
// on the way out and refreshes it on the way back. Combined with the ?v= build stamp on the asset
// URLs in index.html and the version.json check in app.js, there is no longer any layer that can
// hold a stale build.
const CACHE_NAME = 'dlog-2026-08-17-1619';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let Supabase/CDN calls pass through untouched

  // The build stamp itself is never cached or served from cache — it's the thing that tells the app
  // its own code is out of date, so a cached copy of it would defeat the entire mechanism.
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // Network-first, bypassing the HTTP cache (see the note at the top of this file). The cached copy
  // is only ever the offline fallback.
  event.respondWith(
    fetch(request, { cache: 'reload' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
  );
});
