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
const offlineSrc = swSrc.slice(swSrc.indexOf('function offlineResponse'));
const offlineResponse = new Function('Response', `${offlineSrc.slice(0, offlineSrc.indexOf('\n}\n') + 2)}\nreturn offlineResponse;`)(
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
const cssSrc = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const bannerZ = Number((cssSrc.match(/\.update-banner \{[^}]*z-index: (\d+)/) || [])[1]);
const loginZ = Number((cssSrc.match(/#login-screen \{[^}]*z-index: (\d+)/) || [])[1]);
ok(bannerZ > loginZ, `the update banner (${bannerZ}) sits above the login screen (${loginZ})`);

console.log(`sw-update: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
