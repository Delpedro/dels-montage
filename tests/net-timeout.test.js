// Every request has a deadline (20 August 2026).
//
// This is the bug seven attempts at "the login bug" were standing next to without seeing.
//
// Del, on the phone, on a build that worked fine an hour earlier: "i cant do anything, the only
// thing that will work is closing down and opening the app - and thats fucking wrecking my head".
// Then, in the same breath, the two facts that name the cause between them: "it worked on the
// browser btw", and — after 1814 had been pushed and confirmed live — "i was on 1805".
//
// An iOS PWA is not relaunched when you tap its icon; the suspended web view is resumed, and it
// hands the next request a socket belonging to a network stack that died while the phone slept.
// That fetch never resolves AND never rejects. A browser tab cannot reproduce it because opening
// one is a fresh navigation — which is exactly the asymmetry he reported.
//
// Attempt #6 put a timeout on ONE fetch, handleLogin's, and left nine unbounded. Two of those nine
// are the entire failure:
//
//   1. On load, a stored session goes validAccessToken() → refreshSession() → fetch(). It hangs, so
//      enterApp() is never reached, so the login screen sits over a perfectly good session looking
//      like a login screen with a dead button.
//   2. checkForUpdate() → fetch('version.json'). It hangs *inside the try*, so the finally never
//      runs, so updateCheckRunning stays true for the life of the web view and the app can never
//      check for an update again. That is why he was stranded on 1805 while 1814 was live.
//
// Force-quitting was the only cure because a new process gets a new network stack.
//
// The behavioural assertions below matter. The SOURCE assertion at the bottom matters more: the bug
// was never that a timeout was wrong, it was that eight call sites did not have one, and the ninth
// that gets added next month will not have one either unless something is watching.
//
// Run: node tests/net-timeout.test.js

const fs = require('fs');
const path = require('path');
const { load } = require('./extract');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  FAIL: ${label}`);
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// A fetch that behaves like the dead socket: it takes the signal, and it never settles on its own.
function harness(fetchImpl) {
  const calls = [];
  return {
    calls,
    ...load({
      functions: ['netFetch'],
      decls: ['NET_TIMEOUT_MS'],
      deps: {
        fetch: (url, opts) => { calls.push({ url, opts }); return fetchImpl(url, opts); },
        AbortController,
        setTimeout,
        clearTimeout,
      },
    }),
  };
}

console.log('Every request has a deadline');

(async () => {

// ── The dead socket ───────────────────────────────────────────────────────────────────────────
// The one that wrecked his head. Nothing comes back, ever — so the deadline has to be what ends it.
{
  const h = harness((url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));

  let err = null;
  await h.netFetch('https://example.test/hang', {}, 40).catch(e => { err = e; });

  ok(err, 'a request that never settles is ended by the deadline rather than waiting forever');
  eq(err && err.name, 'AbortError', 'and it ends as an abort, which every caller in the app already handles as offline');
}

// ── It aborts, it does not merely stop waiting ────────────────────────────────────────────────
// A bare timer that rejected the promise would leave the dead connection open, and the next request
// would queue behind the corpse — which is the version of this bug where tapping Get In a second
// time also does nothing.
{
  const h = harness((url, opts) => new Promise(() => {}));   // never settles, never listens
  h.netFetch('https://example.test/hang', {}, 20);
  const signal = h.calls[0].opts.signal;
  ok(signal, 'the request carries an abort signal at all');
  eq(signal.aborted, false, 'not aborted while it is still within its deadline');
  await new Promise(r => setTimeout(r, 60));
  eq(signal.aborted, true, 'and the connection is actually torn down when the deadline passes, not just abandoned');
}

// ── A caller with its own deadline is left alone ──────────────────────────────────────────────
// handleLogin owns its own AbortController because it has a specific sentence to show when it
// expires. netFetch must not wrap a second controller around it and abort it early.
{
  const own = new AbortController();
  const h = harness(() => Promise.resolve({ ok: true, status: 200 }));
  await h.netFetch('https://example.test/login', { method: 'POST', signal: own.signal }, 20);
  eq(h.calls[0].opts.signal, own.signal, "a caller's own signal is passed through untouched");
  await new Promise(r => setTimeout(r, 60));
  eq(own.signal.aborted, false, "and netFetch's deadline never fires against it");
}

// ── A request that answers is not punished for it ─────────────────────────────────────────────
{
  const h = harness(() => Promise.resolve({ ok: true, status: 200 }));
  const res = await h.netFetch('https://example.test/ok');
  eq(res.status, 200, 'a normal response comes back untouched');
  eq(h.calls[0].opts.method, undefined, 'and the options are passed through as given');
}

// A rejection has to survive the wrapper too — netFetch clears its timer in a .finally(), and a
// .finally() that swallowed the rejection would turn every offline failure into a silent success.
{
  const h = harness(() => Promise.reject(new TypeError('Failed to fetch')));
  let err = null;
  await h.netFetch('https://example.test/dead').catch(e => { err = e; });
  eq(err && err.name, 'TypeError', 'a real network failure still reaches the caller as itself');
}

// ── The deadline is short enough to be a deadline ─────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const m = src.match(/^const NET_TIMEOUT_MS = (\d+);$/m);
  ok(m, 'NET_TIMEOUT_MS is declared as a plain constant');
  const ms = m ? Number(m[1]) : 0;
  ok(ms >= 4000 && ms <= 15000,
     `the deadline is in the range where it catches a dead socket without cutting off a slow gym connection — got ${ms}ms`);
}

// ── The guard that stops the ninth call site ──────────────────────────────────────────────────
// The original bug was not a wrong value, it was eight missing ones. Testing behaviour cannot catch
// that: the call site that is wrong is the one nobody wrote a test for. So assert on the source —
// netFetch is the only place in the app allowed to call fetch() directly.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

  // Strip comments first, or the explanation of this very bug counts as eight violations.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');

  const start = code.indexOf('function netFetch');
  ok(start > -1, 'netFetch exists');
  const inside = code.slice(start, code.indexOf('\n}\n', start));
  const outside = code.replace(inside, '');

  // `fetch(` not preceded by a word character — so netFetch( and window.fetch( don't count as bare.
  const strays = (outside.match(/(?<![\w.])fetch\(/g) || []).length;
  eq(strays, 0,
     'nothing outside netFetch() calls fetch() directly — a request without a deadline is how the app froze on Del\'s phone');

  // And the wrapper is actually used, rather than being defined and quietly bypassed.
  const uses = (code.match(/netFetch\(/g) || []).length - 1;   // minus the declaration
  ok(uses >= 9, `every former bare call now goes through the wrapper — found ${uses} call sites, expected at least 9`);
}

// ── The update check cannot wedge itself shut again ───────────────────────────────────────────
// updateCheckRunning is released before applyUpdate(), not in the finally. If applyUpdate ever
// fails to settle, a flag left true retires the app's ability to update itself for the rest of the
// web view's life — which is the precise mechanism that left Del on 1805 while 1814 was live.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function checkForUpdate'), src.indexOf('async function applyUpdate'));
  const release = fn.indexOf('updateCheckRunning = false');
  const apply = fn.indexOf('await applyUpdate()');
  ok(release > -1 && apply > -1, 'checkForUpdate still releases the flag and still calls applyUpdate');
  ok(release < apply,
     'the in-flight flag is released BEFORE applyUpdate — a hang after it must not retire the updater permanently');

  const upd = src.slice(src.indexOf('async function applyUpdate'), src.indexOf('function showUpdateBanner'));
  ok(/Promise\.race\(\[refreshInFlight/.test(upd),
     'and applyUpdate races the in-flight refresh rather than awaiting it unconditionally');
  ok(/location\.reload\(\)/.test(upd), 'and still ends in a reload');
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
