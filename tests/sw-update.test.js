// Service worker fallback + the update flow (18 Aug 2026).
//
// Written after the app went white mid-session. Del tapped "New version ready" moments after a push
// and got a page of unstyled raw text. Three things had to line up, and all three are now asserted:
//
//   1. applyUpdate() deleted EVERY cache, then reloaded — so the reload happened with no fallback at
//      all, immediately after a deploy, which is exactly when GitHub Pages is most likely to serve a
//      half-published tree.
//   2. The shell is cached unstamped ('./css/style.css') but index.html requests it stamped
//      ('css/style.css?v=…'). caches.match() keys on the FULL url including the query, so the shell
//      could never satisfy a real request. The fallback was decorative.
//   3. With both misses, the handler resolved to undefined. respondWith(undefined) is a network
//      error, not a cache miss — the browser drops the asset and renders the page without it.
//
// The third is the one that turns a bad minute into a broken app, and it is invisible in testing
// because everything works whenever the network works.
//
// Run: node tests/sw-update.test.js

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  FAIL: ${label}`);
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const root = path.join(__dirname, '..');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

// ── 1. applyUpdate() must not delete the caches ────────────────────────────
const applyBody = appSrc.slice(appSrc.indexOf('async function applyUpdate()'));
const applyEnd = applyBody.indexOf('\n}\n');
const apply = applyBody.slice(0, applyEnd);
ok(!/caches\.delete/.test(apply), 'applyUpdate() does not delete caches — the SW activate handler owns that');
ok(!/caches\.keys/.test(apply), 'applyUpdate() does not enumerate caches');
ok(/getRegistrations/.test(apply) && /r\.update\(\)/.test(apply), 'applyUpdate() still pulls the new service worker');
ok(/location\.reload\(\)/.test(apply), 'applyUpdate() still reloads');

// The cleanup has to live somewhere. It lives in activate, which runs only once a replacement is
// installed — the correct order, and the whole point of the fix.
const activate = swSrc.slice(swSrc.indexOf("addEventListener('activate'"), swSrc.indexOf("addEventListener('fetch'"));
ok(/caches\.delete/.test(activate), 'the SW activate handler still deletes stale caches');
ok(/k !== CACHE_NAME/.test(activate), 'activate keeps the current build and drops the rest');

// ── 2. Cache lookups must ignore the ?v= stamp ─────────────────────────────
const matches = swSrc.match(/caches\.match\([^)]*\)/g) || [];
ok(matches.length >= 2, 'the fallback still consults the cache');
matches.forEach(m => ok(/ignoreSearch: true/.test(m), `${m} ignores the query string`));

// This is the mismatch that made the fallback useless — assert it genuinely exists, so the test
// can't quietly stop being about anything.
ok(/'\.\/css\/style\.css'/.test(swSrc), 'APP_SHELL caches the stylesheet unstamped');
ok(/href="css\/style\.css\?v=/.test(htmlSrc), 'index.html requests the stylesheet stamped');
ok(/src="js\/app\.js\?v=/.test(htmlSrc), 'index.html requests the app script stamped');

// ── 3. The handler must never resolve to undefined ─────────────────────────
ok(/offlineResponse\(request\)/.test(swSrc), 'the fallback chain ends at a real Response');
ok(/function offlineResponse/.test(swSrc), 'offlineResponse is defined');

// Run the real function against both request shapes rather than trusting the source read.
const fnSrc = (name) => {
  const from = swSrc.slice(swSrc.indexOf(`function ${name}(`));
  return from.slice(0, from.indexOf('\n}\n') + 2);
};
const offlineResponse = new Function('Response', `${fnSrc('isNavigation')}\n${fnSrc('offlineResponse')}\nreturn offlineResponse;`)(
  class FakeResponse {
    constructor(body, init = {}) { this.body = body; this.status = init.status; this.headers = init.headers || {}; }
  }
);
const nav = offlineResponse({ mode: 'navigate', headers: { get: () => '' } });
ok(nav && nav.status === 503, 'a navigation gets a 503, not undefined');
ok(/D-LOG can/.test(nav.body), 'a navigation gets a readable page');
ok(/logged sets are safe/.test(nav.body), 'the offline page says his data is safe — the thing he will actually worry about');
const asset = offlineResponse({ mode: 'no-cors', headers: { get: () => 'text/css' } });
ok(asset && asset.status === 503, 'an asset gets a 503, not undefined');
eq(asset.body, '', 'an asset gets an empty body');
const htmlAccept = offlineResponse({ mode: 'no-cors', headers: { get: () => 'text/html,*/*' } });
ok(/D-LOG can/.test(htmlAccept.body), 'an html Accept header counts as a navigation');

// ── 4. A bad STATUS is a failed fetch (23 Aug 2026) ────────────────────────
//
// Del took the "new version ready" prompt and the app came back as a column of unstyled text —
// again, five days after the white page. Different cause, same look. fetch() only REJECTS on a dead
// network; a 404 or a 502 resolves, so GitHub Pages' error page — served in the seconds while a
// deploy is still swapping the tree — was handed to the browser AS style.css and the cache was
// never consulted. The reload after an update is the single most likely moment for that to happen.
const fetchBlock = swSrc.slice(swSrc.indexOf("addEventListener('fetch'"), swSrc.indexOf('function serveFromCache'));
ok(/if \(!response\.ok\) throw/.test(fetchBlock),
  'a non-ok response is thrown, so it falls through to the cache like a dead network does');
ok(!/if \(response\.ok\) \{/.test(fetchBlock),
  'the old "cache it if it is ok, return it either way" shape is gone');

// ── 5. Only a NAVIGATION may be answered with index.html ───────────────────
//
// This is what turned one missing file into an app that looks broken: the browser asked for CSS,
// was offered HTML, refused it, and rendered the page bare. An asset that cannot be served gets an
// honest 503 — a failure that looks like a failure.
ok(/function serveFromCache/.test(swSrc), 'the fallback chain is its own function');
const cacheBlock = swSrc.slice(swSrc.indexOf('function serveFromCache'), swSrc.indexOf('function isNavigation'));
ok(/if \(!isNavigation\(request\)\) return offlineResponse\(request\)/.test(cacheBlock),
  'a non-navigation never falls back to index.html');
ok(cacheBlock.indexOf('isNavigation(request)') < cacheBlock.indexOf("caches.match('./index.html'"),
  'the navigation check runs BEFORE index.html is offered, not after');
ok(/function isNavigation/.test(swSrc),
  'one definition of "is this a navigation" — offlineResponse and serveFromCache must not drift apart');
eq((swSrc.match(/includes\('text\/html'\)/g) || []).length, 1, 'and it really is only defined once');

// ── 6. The shell is cached BEFORE the worker takes over ────────────────────
//
// skipWaiting() used to fire beside addAll() rather than after it, so the new worker could activate,
// delete the old cache, and answer fetches with nothing cached at all.
const install = swSrc.slice(swSrc.indexOf("addEventListener('install'"), swSrc.indexOf("addEventListener('activate'"));
ok(install.indexOf('cache.addAll') < install.indexOf('skipWaiting'),
  'the shell is cached before skipWaiting() hands the new worker the clients');
ok(/await self\.skipWaiting\(\)/.test(install), 'skipWaiting is awaited inside the install work, not fired alongside it');
ok(/new Request\(u, \{ cache: 'reload' \}\)/.test(install),
  'the shell is precached past the HTTP cache, so the fallback is never older than the build');

// ── 7. THE APP MUST NOT RENDER UNSTYLED, AND MUST NOT RELOAD INTO A HALF-PUBLISHED TREE ────
//
// 28 Aug 2026, 15:29: Del opened D-LOG a minute after a push and got a page of raw serif text —
// the fourth time in ten days. Everything asserted above was already true and none of it helped,
// because the stylesheet was not there to be cached or fallen back to: GitHub Pages swaps a tree
// a piece at a time, index.html arrived, css/style.css?v=<new> did not.
//
// Two new guards, at the two ends of the problem. The shell checks the OUTCOME (did the stylesheet
// apply?) rather than any of the causes, and the update refuses to reload into a build whose files
// are not being served yet.
ok(/--dlog-css:\s*1/.test(cssSrc), 'style.css defines the sentinel the shell reads back');
eq((cssSrc.match(/--dlog-css:/g) || []).length, 1, 'and defines it exactly once, in :root');
ok(/--dlog-css/.test(htmlSrc), 'index.html reads the sentinel back');
ok(/css\/style\.css\?repair=/.test(htmlSrc), 'and re-requests the stylesheet on a fresh URL when it is missing');
ok(htmlSrc.indexOf('--dlog-css') > htmlSrc.indexOf('href="css/style.css?v='),
  'the check runs after the link it is checking');
ok(/attempt > 2/.test(htmlSrc), 'the repair is bounded — it must never loop on a site that is genuinely down');

// The repair has to be inline in the shell. A load where app.js is the missing file is exactly the
// load that cannot rely on app.js to fix itself.
const repairInHtml = htmlSrc.slice(htmlSrc.indexOf('<script>'), htmlSrc.indexOf('</script>'));
ok(/getComputedStyle/.test(repairInHtml), 'the repair is inline in index.html, not in app.js');

ok(/async function newBuildIsServable/.test(appSrc), 'the update preflights the build it is about to load');
const preflight = appSrc.slice(appSrc.indexOf('async function newBuildIsServable'));
ok(/css\/style\.css/.test(preflight.slice(0, 900)) && /js\/app\.js/.test(preflight.slice(0, 900)),
  'it asks for the two files the reload exists to load');
ok(/if \(!res\) return true/.test(preflight.slice(0, 900)),
  'offline is not half-published — a check it cannot run never blocks an update');
const applyGuard = appSrc.slice(appSrc.indexOf('async function applyUpdate()'));
ok(applyGuard.indexOf('newBuildIsServable') < applyGuard.indexOf('location.reload()'),
  'the preflight runs BEFORE the reload, which is the only place it is any use');

// ── And the shell must not ship a STATE it has not checked ─────────────────────────────────
// index.html shipped the literal words "Rest alerts: off" on the button, so every load of every
// account showed OFF until the app repainted it — which happened after an awaited network fetch.
// Del reported that flash three times before it was read as markup rather than as a bug in the
// flag it was drawn from.
ok(/id="rest-alerts-btn"[^>]*>Rest alerts</.test(htmlSrc),
  'the rest-alerts button ships no state in its markup — only the app knows the answer');
const homeFn = appSrc.slice(appSrc.indexOf('async function loadHomePage()'));
ok(homeFn.indexOf('paintRestAlertsButton()') < homeFn.indexOf('await '),
  'and Home paints it above every await in the function, so no network can delay the label');

// ── The build stamps must agree, or the update prompt fires forever ────────
const swBuild = (swSrc.match(/CACHE_NAME = 'dlog-([\d-]+)'/) || [])[1];
const appBuild = (appSrc.match(/APP_BUILD = '([\d-]+)'/) || [])[1];
const jsonBuild = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).build;
const htmlBuild = (htmlSrc.match(/\?v=([\d-]+)/) || [])[1];
eq(swBuild, appBuild, 'sw.js CACHE_NAME matches APP_BUILD');
eq(appBuild, jsonBuild, 'APP_BUILD matches version.json');
eq(htmlBuild, appBuild, 'the ?v= stamps match APP_BUILD');

// ── version.json is never served from cache ────────────────────────────────
ok(/version\.json/.test(swSrc) && /no-store/.test(swSrc), 'version.json is fetched no-store — a cached copy would defeat the whole mechanism');

// ── The app must notice a new build without an F5 (20 Aug 2026) ────────────
//
// Every trigger used to be a transition — load, pageshow(persisted), visibilitychange — so a tab
// left open and focused never checked again, and the load check almost always fired inside GitHub
// Pages' publish lag. Del: "i had to press f5 on pc to refresh it on pc too".
const pollMs = Number((appSrc.match(/UPDATE_POLL_MS = (\d+)/) || [])[1]);
const throttleMs = Number((appSrc.match(/UPDATE_THROTTLE_MS = (\d+)/) || [])[1]);
ok(pollMs > 0, 'there is a periodic update poll');
ok(/setInterval\(\(\) => \{\s*if \(document\.visibilityState === 'visible'\) checkForUpdate\(\);\s*\}, UPDATE_POLL_MS\)/.test(appSrc),
  'the poll runs on an interval and only while the page is visible');
ok(throttleMs < pollMs, 'the throttle is shorter than the poll — otherwise setInterval jitter swallows every other tick');
ok(!/Date\.now\(\) - lastUpdateCheck < 60000/.test(appSrc), 'the old 60s throttle literal is gone');

// A reload mid-tap wipes both fields and reads as "the button did nothing" — the exact symptom of
// the login bug. Offer the banner instead, but only once he has actually started typing.
const checkBody = appSrc.slice(appSrc.indexOf('async function checkForUpdate('));
const check = checkBody.slice(0, checkBody.indexOf('\n}\n'));
ok(/if \(loginInputBusy\(\)\) \{ showUpdateBanner\(\); return; \}/.test(check), 'a busy login screen gets the banner, not a reload');
ok(check.indexOf('loginInputBusy()') < check.indexOf("sessionStorage.setItem('dlog_update_tried'"),
  'the login guard runs before the one-automatic-reload flag is spent');

const busySrc = appSrc.slice(appSrc.indexOf('function loginInputBusy()'));
const loginInputBusy = new Function('document', `${busySrc.slice(0, busySrc.indexOf('\n}\n') + 2)}\nreturn loginInputBusy;`);
function fakeDoc(loginActive, email, pass) {
  return {
    documentElement: { classList: { contains: (c) => loginActive && c === 'login-active' } },
    getElementById: (id) => (id === 'login-email' ? { value: email } : id === 'login-password' ? { value: pass } : null),
  };
}
eq(loginInputBusy(fakeDoc(false, 'a@b.com', 'x'))(), false, 'inside the app, typed-in login fields are irrelevant');
eq(loginInputBusy(fakeDoc(true, '', ''))(), false, 'an untouched login screen is the best moment to take a new build');
eq(loginInputBusy(fakeDoc(true, 'a@b.com', ''))(), true, 'an email half-typed blocks the auto-reload');
eq(loginInputBusy(fakeDoc(true, '', 'hunter2'))(), true, 'a password half-typed blocks the auto-reload');

// The banner is the only way out of a stale build on the login screen — it has to be in front of it.
const bannerZ = Number((cssSrc.match(/\.update-banner \{[^}]*z-index: (\d+)/) || [])[1]);
const loginZ = Number((cssSrc.match(/#login-screen \{[^}]*z-index: (\d+)/) || [])[1]);
ok(bannerZ > loginZ, `the update banner (${bannerZ}) sits above the login screen (${loginZ})`);

// ── 8. "ALWAYS OFFER" (31 Aug 2026) ────────────────────────────────────────
//
// Del: "lets TRY always offer". A new build is an offer, never a surprise reload. Three things have
// to hold, and two of them are the traps the item was written around:
//
//   - applyUpdate() is never reached automatically while the flag is on;
//   - the offer SURVIVES BEING IGNORED, because it is now the only way into a new build — shown once
//     and forgotten is indistinguishable from silently staying stale;
//   - the silent path is still there to flip back to. "TRY" was the word he used.

ok(/const ALWAYS_OFFER_UPDATE = true;/.test(appSrc), 'the always-offer flag exists and is on');
ok(/if \(ALWAYS_OFFER_UPDATE\) \{ showUpdateBanner\(\); return; \}/.test(check),
  'a new build gets the banner and returns — the banner is the only route in');
ok(check.indexOf('ALWAYS_OFFER_UPDATE') < check.indexOf('await applyUpdate()'),
  'and it returns BEFORE the automatic reload, which is the whole feature');
ok(check.indexOf('ALWAYS_OFFER_UPDATE') < check.indexOf("sessionStorage.setItem('dlog_update_tried'"),
  'nothing on the silent path runs while the flag is on');

// Reversible in one line: every gate of the silent path is still present, in order, below the flag.
ok(/if \(currentWorkoutId\) \{ showUpdateBanner\(\); return; \}/.test(check), 'the mid-workout gate is kept for the flip back');
ok(/if \(sessionStorage\.getItem\('dlog_update_tried'\) === build\) \{ showUpdateBanner\(\); return; \}/.test(check),
  'the one-automatic-reload fuse is kept, not deleted');
ok(/await applyUpdate\(\);/.test(check), 'and the silent reload itself is still there to switch back on');
ok(/if \(!build \|\| build === APP_BUILD\) \{ hideUpdateBanner\(\); return; \}/.test(check),
  'an offer is withdrawn once the server agrees we are current');

// The stamp moved: it is written against the build being loaded, immediately before the reload.
ok(/sessionStorage\.setItem\('dlog_update_tried', serverBuild\)/.test(apply),
  "applyUpdate() records the attempt — a manual reload is the only kind there is now");
ok(apply.indexOf("setItem('dlog_update_tried'") > apply.indexOf('newBuildIsServable'),
  'a reload that never happens leaves no record saying it did');
ok(apply.indexOf("setItem('dlog_update_tried'") < apply.indexOf('location.reload()'),
  'and the record is written before the page goes');

// The banner, run for real. A fake DOM, because "it is still there on the next check" is behaviour,
// not a string in the source.
const bannerSrc = appSrc.slice(appSrc.indexOf('function updateReloadAlreadyTried'),
  appSrc.indexOf("document.addEventListener('visibilitychange'"));
function bannerHarness(serverBuild, tried) {
  const store = tried ? { dlog_update_tried: tried } : {};
  const state = { el: null, classes: new Set() };
  const document = {
    body: {
      classList: { add: (c) => state.classes.add(c), remove: (c) => state.classes.delete(c) },
      appendChild: (node) => { state.el = node; },
    },
    getElementById: (id) => (id === 'update-banner' ? state.el : null),
    createElement: () => {
      const node = { id: '', className: '', label: null };
      Object.defineProperty(node, 'innerHTML', {
        set(html) { node.label = /update-banner-msg/.test(html) ? { textContent: '' } : null; },
        get() { return ''; },
      });
      node.querySelector = (sel) => (sel === '.update-banner-msg' ? node.label : null);
      node.remove = () => { state.el = null; };
      return node;
    },
  };
  const sessionStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  const fns = new Function('document', 'sessionStorage', 'serverBuild',
    `${bannerSrc}\nreturn { showUpdateBanner, hideUpdateBanner, updateReloadAlreadyTried };`)(document, sessionStorage, serverBuild);
  return { ...fns, state, store, text: () => (state.el && state.el.label ? state.el.label.textContent : null) };
}

let h = bannerHarness('2026-09-01-0900', null);
h.showUpdateBanner();
eq(h.text(), 'New version ready', 'a fresh sighting reads as an offer');
eq(h.state.classes.has('has-update-banner'), true, 'and the screen is told the slot is taken');
const first = h.state.el;
h.showUpdateBanner();
h.showUpdateBanner();
ok(h.state.el === first, 're-asserting on the next check reuses the same bar — no stack of banners');
eq(h.text(), 'New version ready', 'an ignored offer is still an offer');

// The one that matters: something removed it, and the next foreground check puts it back. Under
// always-offer a bar that is gone is a user stranded on an old build with nothing to tap.
h.state.el = null;
h.showUpdateBanner();
ok(h.state.el !== null, 'a banner that disappears comes back on the next check');

h = bannerHarness('2026-09-01-0900', '2026-09-01-0900');
h.showUpdateBanner();
eq(h.text(), "Update didn't take — close and reopen the app",
  'a build we already reloaded for and are still not running says so, rather than offering the same tap again');

h = bannerHarness('2026-09-01-0900', null);
h.showUpdateBanner();
h.store.dlog_update_tried = '2026-09-01-0900';
h.showUpdateBanner();
eq(h.text(), "Update didn't take — close and reopen the app", 'and an existing bar changes its words rather than being stuck with them');

eq(h.updateReloadAlreadyTried(null), false, 'no build is not a match');
eq(h.updateReloadAlreadyTried('2026-08-31-1509'), false, 'a different build is not a match');

h.hideUpdateBanner();
eq(h.state.el, null, 'withdrawing the offer removes the bar');
eq(h.state.classes.has('has-update-banner'), false, 'and gives the slot back');

// The bar can now sit there for a whole session, and it wins on z-index against both things that
// share its slot. A toast the app hides behind a permanent banner is a bug report Del never sees.
const bannerBottom = Number((cssSrc.match(/\.update-banner \{[^}]*bottom: (\d+)px/) || [])[1]);
const toastShift = Number((cssSrc.match(/body\.has-update-banner \.toast \{[^}]*bottom: (\d+)px/) || [])[1]);
const findShift = Number((cssSrc.match(/body\.has-update-banner \.find-bar \{[^}]*bottom: (\d+)px/) || [])[1]);
ok(toastShift > bannerBottom, `the toast clears the banner (${toastShift}px vs ${bannerBottom}px)`);
ok(findShift > bannerBottom, `the find bar clears the banner (${findShift}px vs ${bannerBottom}px)`);

console.log(`sw-update: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
