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
const CACHE_NAME = 'dlog-2026-08-24-1604';
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
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // `cache: 'reload'` here as well as in fetch. Without it the shell is precached through the
    // browser's HTTP cache, so the offline fallback for a brand new build can be a copy of the
    // build it just replaced — the exact staleness the ?v= stamp exists to stop.
    await cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' })));
    // Only once the shell is actually in the cache. skipWaiting() used to fire alongside this
    // rather than after it, so the new worker could activate, delete the old cache in `activate`,
    // and start answering fetches with NOTHING cached at all — no fallback during the one minute a
    // fallback is most likely to be needed. An addAll that fails now fails the install, which
    // leaves the old worker serving: the right outcome, and a visible one.
    await self.skipWaiting();
  })());
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
  //
  // `ignoreSearch` matters more than it looks. index.html asks for `css/style.css?v=2026-08-18-1702`
  // but APP_SHELL caches the bare `./css/style.css`, and a cache lookup is by full URL including the
  // query — so without this, the freshly-installed shell can never satisfy a stamped request and the
  // fallback misses every asset it was put there to cover. That is what turned one failed fetch into
  // a white page of unstyled text on 18 Aug.
  event.respondWith(
    fetch(request, { cache: 'reload' })
      .then((response) => {
        // A 404 or a 502 RESOLVES. It is not a rejected promise, so the old code handed GitHub
        // Pages' error page straight back to the browser as the stylesheet, and the cache was never
        // consulted. That is what Del saw on 23 Aug: he took the update, the reload landed in the
        // seconds while Pages was still swapping the tree, style.css came back as an error page,
        // and the app rendered as a column of unstyled text. A bad status is a failed fetch here.
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.pathname}`);
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => serveFromCache(request))
  );
});

// The fallback, for a dead network and for a deploy that is still half-published.
//
// respondWith(undefined) is a NETWORK ERROR rather than a miss — the browser drops the asset
// entirely and renders the page without it — so every path here has to end at a real Response.
function serveFromCache(request) {
  return caches.match(request, { ignoreSearch: true }).then((hit) => {
    if (hit) return hit;
    // index.html is the fallback for a NAVIGATION and for nothing else. Handing it back for a
    // stylesheet means offering the browser HTML where it asked for CSS: it refuses the file and
    // shows the page with no styling at all. One missing asset became an app that looks broken.
    if (!isNavigation(request)) return offlineResponse(request);
    return caches.match('./index.html', { ignoreSearch: true })
      .then((page) => page || offlineResponse(request));
  });
}

function isNavigation(request) {
  return request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
}

// ─── REST ALERTS (23 Aug 2026) ───────────────────────────────────────────────────────────────────
// The only cue that reaches a locked phone. The in-app beep needs a render tick, which a locked
// screen doesn't give, and the 21 Aug attempt to fix that with a long silent WAV was binned because
// holding the iOS audio session stopped Spotify for the whole rest. A notification chimes off the
// notification channel and gives the audio session straight back.
//
// The push is sent by the rest-alert Edge Function, which sleeps out the remaining rest and then
// posts here. Everything this handler needs is in the payload — it must never fetch, because the
// phone that most needs this notification is the one in a gym basement.
// A rest alert is worth showing for about as long as the rest was. Two limits enforce that, because
// neither one covers the other:
//
//   STALE_AFTER  — a push that arrives long after its deadline is not shown at all. The deadline
//                  travels in the payload, so this catches a delivery the push service sat on, or a
//                  phone that came back into signal with an hour-old alert queued behind it.
//   CLOSE_AFTER  — a push that WAS shown closes itself. The tag below is supposed to make each rest
//                  replace the last, and on iOS it does not: Del finished a two-hour session on
//                  24 Aug with 17 of them stacked down his lock screen. The app closes them too when
//                  it next opens (clearRestNotifications in app.js) — this is the half that works
//                  while the app is closed, which is exactly when they pile up.
const STALE_AFTER = 90 * 1000;
const CLOSE_AFTER = 60 * 1000;

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }

  if (data.dueAt && Date.now() > Number(data.dueAt) + STALE_AFTER) return;

  const tag = data.tag || 'rest-alert';

  event.waitUntil((async () => {
    // One tag for every rest alert, so a second rest REPLACES the first notification instead of
    // stacking a column of them down the lock screen. renotify makes the replacement still chime.
    // Honoured on Chrome, not on iOS — hence the close below.
    await self.registration.showNotification(data.title || 'Rest over', {
      body: data.body || 'Next set',
      tag,
      renotify: true,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
    });

    await new Promise((r) => setTimeout(r, CLOSE_AFTER));
    // Re-read rather than closing a handle: the user may have dismissed it, and a rest that started
    // in the meantime may have posted a newer one under the same tag that should be left alone.
    const open = await self.registration.getNotifications({ tag });
    open.filter((n) => Date.now() - (n.timestamp || 0) >= CLOSE_AFTER).forEach((n) => n.close());
  })());
});

// Tapping the notification should land on the workout that is already open, not a second copy of it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of open) {
      if ('focus' in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});

// Last resort when the network failed and nothing is cached. Navigations get a readable page rather
// than the browser's error screen; everything else gets an honest 503.
function offlineResponse(request) {
  if (!isNavigation(request)) return new Response('', { status: 503, statusText: 'Offline' });
  return new Response(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font:16px/1.5 system-ui,sans-serif;background:#f4efe6;color:#231f1a;padding:2rem;text-align:center}' +
    'button{font:inherit;padding:.75rem 1.5rem;margin-top:1rem;border:0;border-radius:8px;background:#4f7a3f;color:#fff}</style>' +
    "<h1>D-LOG can't reach the network</h1><p>Your logged sets are safe. Try again when you have signal.</p>" +
    '<button onclick="location.reload()">Retry</button>',
    { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
