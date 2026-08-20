// Getting into the app (20 August 2026).
//
// Del has been locked out of the phone three times in three days, and every report is the same
// sentence: "1password populates the two fields and the get in button wont work". Nothing on screen
// changes. No error, no spinner, no wrong-password message. Force-quitting the app and reopening it
// clears it, which made it look like a session bug for a week — it was not. A tap on Get In had
// three separate ways of ending in nothing at all, and from the outside they are indistinguishable:
//
//   1. an empty field returned silently
//   2. the token fetch had no timeout, and an iOS PWA resumed after being backgrounded will hand a
//      stale socket to the next request and sit on it forever — the force-quit "fix" is a new
//      process getting a new network stack
//   3. enterApp() awaited two animation frames before hiding the login screen, and rAF does not
//      fire in a backgrounded webview
//
// What is asserted here is mostly that the button always comes back. Every failure path has to
// leave it tappable and say something, because a dead button with no message is the bug.
//
// Run: node tests/login.test.js

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

function el(value = '') {
  return { value, textContent: '', disabled: false, style: {} };
}

// `fetchImpl` is the whole variable in these tests: the same handler has to survive a 400, a dead
// connection, an abort, and a success, and leave the same button behind each time.
function harness(fetchImpl) {
  const els = {
    'login-email': el('delpeter@gmail.com'),
    'login-password': el('hunter2'),
    'login-error': el(),
    'login-btn': el(),
  };
  els['login-btn'].textContent = 'Get In';
  const calls = { fetch: 0, stored: [], entered: [], page: null };
  const app = load({
    functions: ['handleLogin'],
    decls: ['LOGIN_TIMEOUT_MS'],
    deps: {
      document: { getElementById: id => els[id] || null },
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_KEY: 'anon-key',
      fetch: (url, opts) => { calls.fetch++; calls.lastOpts = opts; return fetchImpl(url, opts); },
      storeSession: s => calls.stored.push(s),
      enterApp: p => { calls.entered.push(p); },
      sessionStorage: { setItem: (k, v) => { calls.page = v; } },
    },
  });
  return { app, els, calls };
}

console.log('Getting in');

// ── Nothing typed ─────────────────────────────────────────────────────────────────────────────
{
  const h = harness(() => Promise.reject(new Error('should not be called')));
  h.els['login-password'].value = '';
  h.app.handleLogin();
  eq(h.calls.fetch, 0, 'no password, no request');
  eq(h.els['login-error'].textContent, 'Enter your email and password',
     'and it says so instead of returning in silence');
  eq(h.els['login-error'].style.display, 'block', 'with the error line actually shown');
  eq(h.els['login-btn'].disabled, false, 'the button stays tappable');
}

(async () => {

// ── The hang ──────────────────────────────────────────────────────────────────────────────────
// The abort is what a 12-second silence turns into. It must not read as a wrong password.
{
  const h = harness(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  await h.app.handleLogin();
  eq(h.els['login-error'].textContent, 'The server did not answer — tap Get In again',
     'a timed-out login says the server went quiet, not that the password is wrong');
  eq(h.els['login-btn'].disabled, false, 'and the button comes back');
  eq(h.els['login-btn'].textContent, 'Get In', 'with its own label, not "Signing in…" forever');
  ok(h.calls.lastOpts && h.calls.lastOpts.signal, 'the request carried an abort signal at all');
  eq(h.calls.entered.length, 0, 'and nothing entered the app');
}

// ── A dead connection, which is a different sentence ──────────────────────────────────────────
{
  const h = harness(() => Promise.reject(new TypeError('Failed to fetch')));
  await h.app.handleLogin();
  eq(h.els['login-error'].textContent, "Can't reach the server — check your connection",
     'no network reads as no network');
  eq(h.els['login-btn'].disabled, false, 'button back');
}

// ── Wrong password still says wrong password ──────────────────────────────────────────────────
{
  const h = harness(() => Promise.resolve({ ok: false, status: 400 }));
  await h.app.handleLogin();
  eq(h.els['login-error'].textContent, 'Wrong email or password', '400 is the one case that is his fault');
  eq(h.els['login-btn'].disabled, false, 'button back');
  eq(h.els['login-btn'].textContent, 'Get In', 'label back');
}

// ── Anything else names its status, so it can be reported ─────────────────────────────────────
{
  const h = harness(() => Promise.resolve({ ok: false, status: 503 }));
  await h.app.handleLogin();
  eq(h.els['login-error'].textContent, 'Login failed (503)', 'a server fault is not a bad password');
}

// ── In ────────────────────────────────────────────────────────────────────────────────────────
{
  const session = { access_token: 'tok', refresh_token: 'ref' };
  const h = harness(() => Promise.resolve({ ok: true, json: () => Promise.resolve(session) }));
  await h.app.handleLogin();
  eq(h.calls.stored.length, 1, 'the session is stored');
  eq(h.calls.stored[0], session, 'exactly what the server sent');
  eq(h.calls.page, 'home', 'and the app opens on Home');
  eq(h.calls.entered[0], 'home', 'via enterApp');
  eq(h.els['login-password'].value, '', 'the password box is emptied behind him');
  eq(h.els['login-error'].style.display, 'none', 'no error left on screen');
  eq(h.els['login-btn'].disabled, false, 'and the button is not left disabled on the way out');
}

// ── Two taps, one token request ───────────────────────────────────────────────────────────────
// The button disables synchronously, before the first await, so an impatient second tap on a slow
// connection cannot start a second sign-in against a refresh token the first one is already using.
{
  let release;
  const held = new Promise(r => { release = r; });
  const h = harness(() => held);
  const first = h.app.handleLogin();
  eq(h.els['login-btn'].disabled, true, 'the button goes dead the instant the first tap lands');
  eq(h.els['login-btn'].textContent, 'Signing in…', 'and says what it is doing');
  h.app.handleLogin();
  eq(h.calls.fetch, 1, 'the second tap is ignored while the first is in flight');
  release({ ok: false, status: 400 });
  await first;
  eq(h.els['login-btn'].disabled, false, 'and once it settles the button is live again');
}

// ── The frame that never comes ────────────────────────────────────────────────────────────────
// requestAnimationFrame does not fire in a backgrounded webview. enterApp() awaited two of them
// before hiding the login screen, so a PWA resumed mid-login could sit behind a login card with a
// perfectly good session behind it. The wait is cosmetic — it stops the card flashing over the app
// as the scroll lock releases — so it must never be something the app can hang on.
{
  const app = load({
    functions: ['nextFrame'],
    deps: { requestAnimationFrame: () => {} },   // registered, never called back
  });
  const raced = await Promise.race([
    app.nextFrame().then(() => 'resolved'),
    new Promise(r => setTimeout(() => r('hung'), 500)),
  ]);
  eq(raced, 'resolved', 'a frame that never arrives still lets the login screen come down');
}

{
  let resolves = 0;
  const app = load({
    functions: ['nextFrame'],
    deps: { requestAnimationFrame: cb => cb() },   // fires immediately, then the timer fires too
  });
  await app.nextFrame().then(() => { resolves++; });
  await new Promise(r => setTimeout(r, 120));
  eq(resolves, 1, 'and when both the frame and the fallback fire, it settles once');
}

console.log(`  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
})();
