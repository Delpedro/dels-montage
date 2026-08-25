// Getting INTO the app for the first time (25 August 2026).
//
// D-LOG had no signup screen for four months. It has one now because Del closed both of the routes
// that avoided it on the same day — an account made in the Supabase dashboard ("im not adding a user
// via Supa, never"), and a password sent in a message ("i will not be sending them a fucking email
// address and a password"). He sends a link and nothing else; the tester makes their own account.
//
// The flow is the recovery flow's twin: a code typed into the app rather than a link in an email, so
// there is no redirect URL to allow-list now and no universal link to configure when this ships to
// the stores. What is asserted here is mostly the half you cannot see by using it:
//
//   - a fresh address and one that already has an account are indistinguishable from this screen
//   - the code cannot be worked through from the login screen
//   - "sign-ups are switched off at the dashboard" is a sentence, not a 422 the user has to read
//   - nothing is written to the device until the code has actually been accepted
//   - a half-finished signup is wiped when the login screen is put back up
//
// Plus the usability rule login.test.js established and password-reset.test.js kept: every failure
// path leaves the button tappable and says something. A dead button with no message is the bug.
//
// Run: node tests/signup.test.js

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

function el(value = '') {
  const cls = new Set();
  return {
    value, textContent: '', disabled: false, style: {}, focused: 0,
    focus() { this.focused++; },
    classList: { add: n => cls.add(n), remove: n => cls.delete(n), toggle: (n, on) => { on ? cls.add(n) : cls.delete(n); }, has: n => cls.has(n) },
  };
}

const IDS = [
  'login-email', 'login-password', 'login-error', 'login-btn', 'login-diag', 'login-screen',
  'login-form', 'reset-request', 'reset-confirm', 'reset-email', 'reset-code', 'reset-new',
  'reset-confirm-pw', 'reset-send-btn', 'reset-save-btn', 'reset-resend', 'reset-sent-to',
  'signup-request', 'signup-verify', 'signup-email', 'signup-password', 'signup-confirm-pw',
  'signup-btn', 'signup-code', 'signup-sent-to', 'signup-verify-btn', 'signup-resend',
];

// A response the code under test can read. `body` is what .json() resolves to.
function res(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Routes by URL so one harness can serve a whole multi-request path. Anything not listed 500s
// loudly rather than quietly succeeding.
function router(map) {
  return async (url) => {
    for (const [frag, r] of Object.entries(map)) {
      if (url.includes(frag)) return typeof r === 'function' ? r(url) : r;
    }
    return res(500);
  };
}

function harness(fetchImpl) {
  const els = {};
  for (const id of IDS) els[id] = el();
  // The markup ships every panel but the sign-in one hidden, and `panel()` reads exactly that.
  // Without it the harness starts with all five showing and "it did NOT move on" passes for the
  // wrong reason.
  for (const id of ['reset-request', 'reset-confirm', 'signup-request', 'signup-verify']) {
    els[id].style.display = 'none';
  }
  const calls = { fetch: [], stored: [], entered: [], toasts: [] };

  const app = load({
    functions: [
      'showLoginPanel', 'loginFail', 'resetRecoveryState', 'resetSignupState', 'backToSignIn',
      'newPasswordProblem', 'showSignUp', 'startSignupCooldown', 'submitSignUp', 'signupSent',
      'resendSignupCode', 'confirmSignUp', 'showLoginScreen', 'loginStep', 'renderLoginDiag',
      'netFetch',
    ],
    decls: [
      'SIGNUP_MAX_ATTEMPTS', 'SIGNUP_RESEND_MS', 'RECOVERY_CODE_MIN', 'RECOVERY_CODE_MAX',
      'signupEmail', 'signupAttempts', 'signupResendAt', 'signupTimer',
      'recoverySession', 'recoveryEmail', 'recoveryAttempts', 'recoveryResendAt', 'recoveryTimer',
      'NET_TIMEOUT_MS', 'APP_BUILD', 'serverBuild', 'loginStatus',
    ],
    deps: {
      document: {
        getElementById: id => els[id] || null,
        documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
      },
      window: { scrollTo() {} },
      sessionStorage: { setItem() {}, getItem: () => null, clear() {} },
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_KEY: 'anon-key',
      fetch: (url, opts) => { calls.fetch.push({ url, opts }); return fetchImpl(url, opts); },
      storeSession: s => { calls.stored.push(s); return s; },
      enterApp: p => { calls.entered.push(p); },
      showToast: (m, t) => { calls.toasts.push([m, t]); },
      closeOnboarding: () => {},
    },
    accessors: {
      state: '() => ({ signupEmail, signupAttempts, signupResendAt, signupTimer })',
      // Winds the resend cooldown off so the past-cooldown branch is reachable without a fake clock.
      expireCooldown: '() => { signupResendAt = 0; }',
    },
  });

  return { app, els, calls };
}

const SESSION = { access_token: 'jwt-abc', refresh_token: 'r1', expires_in: 3600, user: { email: 'jo@example.com' } };

const shown = h => h.els['login-error'].style.display === 'block' ? h.els['login-error'].textContent : null;
const panel = (h, id) => h.els[id].style.display !== 'none';
const post = (h, frag) => h.calls.fetch.filter(c => c.url.includes(frag));
const stop = h => h.app.resetSignupState();   // kills the resend interval so node can exit

// Fills the form and taps Create account.
async function signUp(fetchImpl, { email = 'jo@example.com', pw = 'correcthorse', again = null } = {}) {
  const h = harness(fetchImpl);
  h.els['signup-email'].value = email;
  h.els['signup-password'].value = pw;
  h.els['signup-confirm-pw'].value = again === null ? pw : again;
  await h.app.submitSignUp();
  return h;
}

const HAPPY = { '/auth/v1/signup': res(200, { id: 'u1' }), '/auth/v1/verify': res(200, SESSION) };

(async () => {

  // ── The whole path: form → code panel → signed in ───────────────────────────────────────────
  {
    const h = await signUp(router(HAPPY));

    eq(post(h, '/auth/v1/signup').length, 1, 'exactly one signup request');
    const body = JSON.parse(post(h, '/auth/v1/signup')[0].opts.body);
    eq(body.email, 'jo@example.com', 'it sends the address that was typed');
    eq(body.password, 'correcthorse', 'and the password, which is the only time it leaves the device');
    eq(post(h, '/auth/v1/signup')[0].opts.headers.apikey, 'anon-key', 'with the publishable key');
    ok(panel(h, 'signup-verify'), 'it moves on to the code panel');
    ok(!panel(h, 'signup-request'), 'and leaves the form behind');
    eq(h.els['signup-sent-to'].value, 'jo@example.com',
      'the account is named on the panel — a password manager needs it to know which login to save');
    eq(h.calls.stored.length, 0, 'NOTHING is on the device yet — the code has not been typed');
    eq(h.els['signup-btn'].textContent, 'Create account', 'the button label is put back');

    h.els['signup-code'].value = '123456';
    await h.app.confirmSignUp();

    const verify = post(h, '/auth/v1/verify');
    eq(verify.length, 1, 'one verify request');
    const vb = JSON.parse(verify[0].opts.body);
    eq(vb.type, 'signup', 'verified as a signup, not a recovery — the wrong type is a 400 nobody could diagnose');
    eq(vb.email, 'jo@example.com', 'for the address the code was sent to');
    eq(vb.token, '123456', 'with the code that was typed');
    eq(h.calls.stored.length, 1, 'the session is stored only once the code is accepted');
    eq(h.calls.entered[0], 'home', 'and the app opens on Home');
    eq(h.app.state().signupEmail, '', 'the flow forgets the address on the way in');
    stop(h);
  }

  // ── A code pasted with a space in it is the same code ───────────────────────────────────────
  {
    const h = await signUp(router(HAPPY));
    h.els['signup-code'].value = '148 209';
    await h.app.confirmSignUp();
    eq(JSON.parse(post(h, '/auth/v1/verify')[0].opts.body).token, '148209',
      'the digits are taken and the space dropped — a code pasted out of the email works');
    stop(h);
  }

  // ── ANTI-ENUMERATION: an address that already has an account looks identical ────────────────
  // GoTrue obfuscates a repeat signup while email confirmation is on, but not on every path. The
  // one that answers with an error is folded into the same outcome, because this screen is not a
  // way to find out who has an account here.
  {
    const fresh = await signUp(router(HAPPY));
    const taken = await signUp(router({
      '/auth/v1/signup': res(422, { error_code: 'user_already_exists', msg: 'User already registered' }),
    }));
    ok(panel(fresh, 'signup-verify'), 'a fresh address moves on to the code panel');
    ok(panel(taken, 'signup-verify'), 'an address that is ALREADY TAKEN moves on to the code panel too');
    eq(shown(taken), null, 'and raises no error that would confirm the address is taken');
    eq(shown(fresh), shown(taken), 'both leave the error line in the same state');
    eq(fresh.els['signup-sent-to'].value, taken.els['signup-sent-to'].value, 'both echo the address back the same way');
    stop(fresh); stop(taken);
  }

  // ── Sign-ups switched off at the dashboard is a sentence, not a status code ─────────────────
  {
    const h = await signUp(router({
      '/auth/v1/signup': res(422, { error_code: 'signup_disabled', msg: 'Signups not allowed for this instance' }),
    }));
    eq(shown(h), "New accounts aren't open yet — try again shortly",
      'the one setting this screen cannot switch on for itself is explained in English');
    ok(!panel(h, 'signup-verify'), 'and it does not pretend a code is on its way');
    eq(h.els['signup-btn'].disabled, false, 'the button comes back — every failure path leaves it tappable');
    stop(h);
  }

  // ── The password rules, checked before anything leaves the device ───────────────────────────
  {
    const never = router({});
    const cases = [
      [{ pw: '' }, 'Enter a password'],
      [{ pw: 'short1' }, 'Your password needs at least 8 characters'],
      [{ pw: 'longenough1', again: '' }, 'Type your password again to confirm it'],
      [{ pw: 'longenough1', again: 'longenough2' }, "Those don't match"],
      [{ pw: 'jo@example.com', again: 'jo@example.com' }, "Don't use your email address as your password"],
    ];
    for (const [opts, message] of cases) {
      const h = await signUp(never, opts);
      eq(shown(h), message, 'a bad password is named exactly: ' + message);
      eq(h.calls.fetch.length, 0, 'and nothing reaches the server: ' + message);
      eq(h.els['signup-btn'].disabled, false, 'with the button left tappable: ' + message);
      stop(h);
    }

    const h = await signUp(never, { email: 'nope' });
    eq(shown(h), 'Enter the email address you want to sign in with', 'a missing @ is caught here too');
    eq(h.calls.fetch.length, 0, 'and sends nothing');
    stop(h);
  }

  // ── One set of password rules, not two ─────────────────────────────────────────────────────
  // The reset panel and the signup panel both choose a password. They share newPasswordProblem()
  // so the two can never drift, and the reset panel's wording is unchanged by the sharing.
  {
    const h = harness(router({}));
    eq(h.app.newPasswordProblem('', '', 'a@b.c'), 'Enter a new password', 'the reset panel still says "new password"');
    eq(h.app.newPasswordProblem('', '', 'a@b.c', 'password'), 'Enter a password', 'and the signup panel says "password"');
    eq(h.app.newPasswordProblem('abcdefgh', 'abcdefgh', 'a@b.c'), null, 'a good password is no problem');
    eq(h.app.newPasswordProblem('abcdefgh', 'abcdefgh', ''), null, 'and an unknown address does not block one');
    stop(h);
  }

  // ── The code cannot be worked through from the screen ──────────────────────────────────────
  {
    const h = await signUp(router({
      '/auth/v1/signup': res(200, { id: 'u1' }),
      '/auth/v1/verify': res(403, { msg: 'Token has expired or is invalid' }),
    }));
    for (let i = 1; i <= 5; i++) {
      h.els['signup-code'].value = '000000';
      await h.app.confirmSignUp();
    }
    eq(h.app.state().signupAttempts, 5, 'five wrong codes are counted');
    eq(shown(h), 'Too many wrong codes — ask for a new one', 'and the fifth says so');

    h.els['signup-code'].value = '000000';
    await h.app.confirmSignUp();
    eq(post(h, '/auth/v1/verify').length, 5, 'the sixth attempt never reaches the server');
    eq(h.els['signup-verify-btn'].disabled, false, 'and the button is still tappable, saying why');
    stop(h);
  }

  // ── A wrong code says how many tries are left, and never who is a member ───────────────────
  {
    const h = await signUp(router({
      '/auth/v1/signup': res(200, { id: 'u1' }),
      '/auth/v1/verify': res(403, { msg: 'Token has expired or is invalid' }),
    }));
    h.els['signup-code'].value = '000000';
    await h.app.confirmSignUp();
    eq(shown(h), 'That code is wrong or has expired — 4 tries left', 'the count is shown');
    for (const code of ['000001', '000002', '000003']) {
      h.els['signup-code'].value = code;
      await h.app.confirmSignUp();
    }
    eq(shown(h), 'That code is wrong or has expired — 1 try left', 'and it is singular at one');
    stop(h);
  }

  // ── Too short a code is caught here, not by burning an attempt ─────────────────────────────
  {
    const h = await signUp(router(HAPPY));
    h.els['signup-code'].value = '12';
    await h.app.confirmSignUp();
    eq(shown(h), 'The code is the digits from the email', 'a half-typed code says what the field wants');
    eq(post(h, '/auth/v1/verify').length, 0, 'and does not spend one of the five tries on the server');
    eq(h.app.state().signupAttempts, 0, 'or locally');
    stop(h);
  }

  // ── A code that verifies but hands back no session ─────────────────────────────────────────
  // The account exists and the password is the one they chose, so the honest instruction is to sign
  // in — not to try the code again, which is spent.
  {
    const h = await signUp(router({
      '/auth/v1/signup': res(200, { id: 'u1' }),
      '/auth/v1/verify': res(200, { id: 'u1' }),
    }));
    h.els['signup-code'].value = '123456';
    await h.app.confirmSignUp();
    eq(shown(h), 'Account confirmed — sign in with the password you just chose', 'it says what to do next');
    ok(panel(h, 'login-form'), 'and puts the sign-in panel back');
    eq(h.calls.stored.length, 0, 'nothing was stored');
    stop(h);
  }

  // ── A dead connection is told apart from a wrong code, at both steps ───────────────────────
  {
    const boom = async () => { throw Object.assign(new Error('down'), { name: 'TypeError' }); };
    const h = await signUp(boom);
    eq(shown(h), "Can't reach the server — check your connection", 'a dead connection at signup is named');
    eq(h.els['signup-btn'].disabled, false, 'and the button comes back');
    ok(!panel(h, 'signup-verify'), 'and it does not move on to a code that was never sent');
    stop(h);

    const h2 = await signUp(router({ '/auth/v1/signup': res(200, { id: 'u1' }), '/auth/v1/verify': boom }));
    h2.els['signup-code'].value = '123456';
    await h2.app.confirmSignUp();
    eq(shown(h2), "Can't reach the server — check your connection", 'and again at the code step');
    eq(h2.els['signup-verify-btn'].disabled, false, 'with a tappable button');
    eq(h2.app.state().signupAttempts, 0, 'a network failure is not a wrong code — it costs no attempt');
    stop(h2);
  }

  // ── A rate limit is the one status worth naming ────────────────────────────────────────────
  {
    const h = await signUp(router({ '/auth/v1/signup': res(429) }));
    ok(/too many/i.test(shown(h) || ''), '429 says too many requests rather than pretending a code was sent');
    ok(!panel(h, 'signup-verify'), 'and does not move on — there is no code coming');
    stop(h);
  }

  // ── Resend asks for a NEW code, and never re-posts the signup ──────────────────────────────
  {
    const h = await signUp(router({ ...HAPPY, '/auth/v1/resend': res(200, {}) }));

    await h.app.resendSignupCode();
    ok(/^Wait \d+s before asking for another code$/.test(shown(h) || ''),
      'inside the cooldown it says how long is left rather than doing nothing');
    eq(post(h, '/auth/v1/resend').length, 0, 'and sends nothing');

    h.app.expireCooldown();
    await h.app.resendSignupCode();
    const resend = post(h, '/auth/v1/resend');
    eq(resend.length, 1, 'past the cooldown it asks for a new code');
    const rb = JSON.parse(resend[0].opts.body);
    eq(rb.type, 'signup', 'off the resend endpoint, typed as a signup');
    eq(rb.email, 'jo@example.com', 'for the same address');
    eq(post(h, '/auth/v1/signup').length, 1,
      'and the signup is NOT posted again — the password is not held past the first request');
    stop(h);
  }

  // ── A half-finished signup does not survive the login screen ───────────────────────────────
  // A session expiring elsewhere in the app puts this screen back up. Leaving a typed password and
  // a code box on it hands the next person to pick the phone up somebody else's half-made account.
  {
    const h = await signUp(router(HAPPY));
    h.els['signup-code'].value = '123456';
    h.app.showLoginScreen('Session expired');
    eq(h.els['signup-code'].value, '', 'the code box is cleared');
    eq(h.els['signup-password'].value, '', 'the password is cleared');
    eq(h.els['signup-email'].value, '', 'the address is cleared');
    eq(h.app.state().signupEmail, '', 'and the flow forgets which account it was making');
    eq(h.app.state().signupTimer, null, 'the resend interval is stopped, not left ticking');
    ok(panel(h, 'login-form'), 'the sign-in panel is what is showing');
    stop(h);
  }

  // ── Back to sign in clears it too ──────────────────────────────────────────────────────────
  {
    const h = await signUp(router(HAPPY));
    h.app.backToSignIn();
    eq(h.app.state().signupEmail, '', 'backing out forgets the address');
    eq(h.app.state().signupTimer, null, 'and stops the countdown');
    ok(panel(h, 'login-form') && !panel(h, 'signup-verify'), 'and the sign-in panel is up');
    stop(h);
  }

  // ── The address carries over from the sign-in box ──────────────────────────────────────────
  {
    const h = harness(router({}));
    h.els['login-email'].value = '  jo@example.com  ';
    h.app.showSignUp();
    eq(h.els['signup-email'].value, 'jo@example.com', 'typed once, trimmed, not asked for twice');
    ok(panel(h, 'signup-request'), 'and the create panel is up');
    eq(h.els['signup-email'].focused, 1, 'with the cursor in it');
    stop(h);
  }

  // ── The markup the password managers need ──────────────────────────────────────────────────
  // Same lesson the reset panel learned on 24 Aug: bare divs fire no submit event, so 1Password
  // offers to save nothing. Both signup panels are real forms with the address on them.
  {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const requestPanel = html.slice(html.indexOf('id="signup-request"'), html.indexOf('id="signup-verify"'));
    const verifyPanel = html.slice(html.indexOf('id="signup-verify"'), html.indexOf('id="login-error"'));

    ok(requestPanel.includes('<form onsubmit="submitSignUp(); return false;">'),
      'the create panel is a real form — a manager captures the new login on the submit event');
    ok(!requestPanel.includes('onclick="submitSignUp()"'),
      'no onclick alongside the submit, which would run the handler twice on one tap');
    ok((requestPanel.match(/autocomplete="new-password"/g) || []).length === 2,
      'both password boxes are marked new-password, so a manager offers to generate one');
    ok(requestPanel.includes('autocomplete="username"'), 'and the address is the username field');
    ok(verifyPanel.includes('<form onsubmit="confirmSignUp(); return false;">'), 'the code panel is a form too');
    ok(verifyPanel.includes('id="signup-sent-to" autocomplete="username" readonly'),
      'with the address riding along readonly, so the manager knows WHICH login was created');
    ok(verifyPanel.includes('autocomplete="one-time-code"'), 'and the code box takes the OTP autofill');
    ok(html.includes('onclick="showSignUp()"'),
      'the sign-in panel offers a way to create an account — the whole beta walks through that button');
  }

  // ── The two dashboard settings this screen cannot do for itself ────────────────────────────
  // Both silently break signup and neither is in code. The repo is the only place they are written
  // down, so a missing template here is a beta that cannot start.
  {
    const tpl = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'templates', 'confirmation.html'), 'utf8');
    // Past the paste-me-here comment, which legitimately names the link this must not be.
    const tplBody = tpl.slice(tpl.indexOf('-->'));
    ok(tplBody.includes('{{ .Token }}'), 'the confirm-signup template sends a code');
    ok(!tplBody.includes('{{ .ConfirmationURL }}'),
      'and not a link — a link cannot be typed into an installed PWA, which is the whole flow');
    ok(/Allow new users to sign up/i.test(tpl),
      'and it names the dashboard toggle that has to be on, beside the template that has to be pasted');
  }

  // ── Deleting the account is server-side and cannot name anybody else ───────────────────────
  // Ships in the same build as signup, because an app that lets you create an account has to let
  // you delete it from inside the app or Apple rejects it.
  {
    const fn = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'delete-account', 'index.ts'), 'utf8');
    ok(/admin\/users\/\$\{user\.id\}/.test(fn), "the delete targets the id resolved from the caller's own token");
    ok(!/req\.json\(\)/.test(fn),
      'and the request body is never read — there is no user id in it to spell another account with');
    ok(/bearer === SERVICE_KEY/.test(fn), 'a project key is not a way in');
    ok(!/should_soft_delete['"\s]*:/.test(fn),
      'it is a real deletion, not a soft one that keeps the address on file (the comment explaining that is fine)');

    const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
    const del = app.slice(app.indexOf('async function deleteAccount('), app.indexOf('// ─── DATA EXPORT'));
    ok(del.length > 200, 'deleteAccount() exists in the app');
    ok(/await askConfirm\(/.test(del) && /await askPrompt\(/.test(del),
      "two gates in front of it, both the app's own dialogs");
    ok(!/[^k]\bconfirm\(|[^k]\bprompt\(/.test(del),
      'and no native dialog on the most destructive screen in the app');
    ok(del.includes("!== 'DELETE'"), 'the second gate is the literal word DELETE');
    ok(del.indexOf('clearSession()') > del.indexOf('/functions/v1/delete-account'),
      'the device is only wiped after the server says the account is gone');
    ok(app.includes('onclick="deleteAccount()"') || fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').includes('onclick="deleteAccount()"'),
      'and it is reachable from the app, not just defined');
  }

  // ── ONE PAGE, ONE ACCOUNT ──────────────────────────────────────────────────────────────────
  // A second account signing in without a page load inherited the first one's app: a brand-new
  // account was greeted "Good afternoon, Del", shown his 80kg, and offered his Upper/Lower
  // programme — PROFILE and SESSIONS are module globals and the DOM keeps what it last painted.
  // enterApp() refuses to serve a second session on a page that has already served one; it reloads
  // and lets the cold-start path rebuild everything from the new account's own data.
  {
    const reloads = [], inits = [];
    const screen = el(); screen.style.display = 'flex';
    const app = load({
      functions: ['enterApp', 'nextFrame'],
      decls: ['pageHasServedASession'],
      deps: {
        document: {
          getElementById: () => screen,
          documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
        },
        window: { scrollTo() {}, location: { reload: () => reloads.push(1) } },
        requestAnimationFrame: cb => cb(),
        setTimeout: cb => cb(),
        initApp: p => inits.push(p),
      },
    });

    await app.enterApp('home');
    eq(inits.length, 1, 'the first session builds the app');
    eq(reloads.length, 0, 'and does not reload — a cold start must not bounce');
    eq(screen.style.display, 'none', 'the login screen comes down');

    await app.enterApp('home');
    eq(inits.length, 1, 'a SECOND session does not get built on top of the first');
    eq(reloads.length, 1, 'it reloads instead, so no global and no painted value survives the switch');
  }

  console.log(`signup: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
