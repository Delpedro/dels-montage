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
// 20 August 2026, attempt #7. All of the above shipped and Del still could not get in, and still
// saw nothing: "i got no popup error modal". That answer is itself the finding — if none of the
// four messages above appeared, then either handleLogin() never ran, or it ran in a build that
// predates them. Neither can be told apart from a chat window, so the login screen now keeps its
// own readout: the build it is running, whether the server has a newer one, and the last step the
// handler reached. The assertions below are what make that readout trustworthy, because it is the
// only instrument pointed at this bug.
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
  const cls = new Set();
  return {
    value, textContent: '', disabled: false, style: {},
    classList: { toggle: (name, on) => { on ? cls.add(name) : cls.delete(name); }, has: name => cls.has(name) },
  };
}

// `fetchImpl` is the whole variable in these tests: the same handler has to survive a 400, a dead
// connection, an abort, and a success, and leave the same button behind each time.
function harness(fetchImpl, enterImpl) {
  const els = {
    'login-email': el('delpeter@gmail.com'),
    'login-password': el('hunter2'),
    'login-error': el(),
    'login-btn': el(),
    'login-diag': el(),
  };
  els['login-btn'].textContent = 'Get In';
  const calls = { fetch: 0, stored: [], entered: [], page: null, reshown: [] };
  const app = load({
    functions: ['handleLogin', 'renderLoginDiag', 'loginStep', 'netFetch'],
    decls: ['LOGIN_TIMEOUT_MS', 'APP_BUILD', 'serverBuild', 'loginStatus', 'NET_TIMEOUT_MS'],
    deps: {
      document: { getElementById: id => els[id] || null },
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_KEY: 'anon-key',
      fetch: (url, opts) => { calls.fetch++; calls.lastOpts = opts; return fetchImpl(url, opts); },
      storeSession: s => calls.stored.push(s),
      enterApp: p => { calls.entered.push(p); if (enterImpl) return enterImpl(p); },
      sessionStorage: { setItem: (k, v) => { calls.page = v; } },
      showLoginScreen: m => { calls.reshown.push(m); },
    },
    accessors: { setServerBuild: '(b) => { serverBuild = b; }' },
  });
  return { app, els, calls };
}

// The readout is one string, so every assertion about it asks the same question: did this substring
// make it on screen.
function diagText(h) { return h.els['login-diag'].textContent; }
function diagHas(h, part) { return diagText(h).includes(part); }

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
  ok(diagHas(h, 'empty · email 18 · pw 0'),
     'and the readout names which box the manager left unreadable — got ' + JSON.stringify(diagText(h)));
  ok(h.els['login-diag'].classList.has('warn'), 'flagged as a fault, not a status');
}

// ── The readout is the instrument, so it has to be right ──────────────────────────────────────
// It carries the running build unconditionally. That single line answers the question six attempts
// could not: is the phone even executing the code that was pushed.
{
  const h = harness(() => Promise.reject(new Error('should not be called')));
  h.app.renderLoginDiag();
  ok(diagHas(h, 'build '), 'the login screen always states the build it is running');
  ok(!h.els['login-diag'].classList.has('warn'), 'and a matching build is not an alarm');

  h.app.setServerBuild('9999-99-99-9999');
  h.app.renderLoginDiag();
  ok(diagHas(h, 'STALE'), 'a server build that disagrees is called stale in as many words');
  ok(diagHas(h, '9999-99-99-9999'), 'with the build the server actually has, to compare against');
  ok(h.els['login-diag'].classList.has('warn'), 'and that is a fault');
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
  ok(diagHas(h, 'aborted after 12s'), 'the readout says how long it waited — got ' + JSON.stringify(diagText(h)));
}

// ── A dead connection, which is a different sentence ──────────────────────────────────────────
{
  const h = harness(() => Promise.reject(new TypeError('Failed to fetch')));
  await h.app.handleLogin();
  eq(h.els['login-error'].textContent, "Can't reach the server — check your connection",
     'no network reads as no network');
  eq(h.els['login-btn'].disabled, false, 'button back');
  ok(diagHas(h, 'network: TypeError'), 'and the readout keeps the exception name — got ' + JSON.stringify(diagText(h)));
}

// ── Wrong password still says wrong password ──────────────────────────────────────────────────
{
  const h = harness(() => Promise.resolve({ ok: false, status: 400 }));
  await h.app.handleLogin();
  eq(h.els['login-error'].textContent, 'Wrong email or password', '400 is the one case that is his fault');
  ok(diagHas(h, 'http 400'), 'the readout carries the raw status, so 400-vs-422 is not a guess');
  eq(h.els['login-btn'].disabled, false, 'button back');
  eq(h.els['login-btn'].textContent, 'Get In', 'label back');
}

// ── Anything else names its status, so it can be reported ─────────────────────────────────────
{
  const h = harness(() => Promise.resolve({ ok: false, status: 503 }));
  await h.app.handleLogin();
  eq(h.els['login-error'].textContent, 'Login failed (503)', 'a server fault is not a bad password');
  ok(diagHas(h, 'http 503'), 'reported as a status either way');
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
  ok(diagHas(h, 'token ok'), 'and the readout got as far as saying the token was good');
}

// ── Signed in, and then the app failed to build itself ────────────────────────────────────────
// enterApp() hides the login screen before initApp() runs, so anything thrown in there used to
// leave a torn-down login screen over a half-built app: no card, no message, no way back. From the
// outside that is the same report as every other one — "the get in button wont work". The login
// screen comes back and says so now.
{
  const session = { access_token: 'tok', refresh_token: 'ref' };
  const h = harness(
    () => Promise.resolve({ ok: true, json: () => Promise.resolve(session) }),
    () => { throw new TypeError('sessionTemplates is not iterable'); },
  );
  await h.app.handleLogin();
  eq(h.calls.stored.length, 1, 'the session is still stored — the token was good, the app was not');
  eq(h.calls.reshown.length, 1, 'the login screen is put back rather than left torn down');
  eq(h.calls.reshown[0], 'Signed in, but the app failed to open', 'with a sentence that is not about the password');
  ok(diagHas(h, 'sessionTemplates is not iterable'),
     'and the readout carries the actual thrown message — got ' + JSON.stringify(diagText(h)));
  ok(h.els['login-diag'].classList.has('warn'), 'flagged as a fault');
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
  ok(diagHas(h, 'already signing in'),
     'and the ignored tap says why it was ignored, instead of being the last silent return');
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
