// Getting back INTO the app (24 August 2026).
//
// Until this build there was no password recovery of any kind: a forgotten password meant Del
// opening the Supabase dashboard and setting a new one by hand. That is not a recovery flow, it is
// Del being on call, and it stops working the moment somebody who is not Del has an account.
//
// The flow is a numeric code typed into D-LOG rather than a link in an email — no redirect URL to
// allow-list now, no universal link / app link to configure when this ships to the stores. What is
// asserted here is mostly the *security* half, because that is the half you cannot see by using it:
//
//   - a real address and an unknown one are indistinguishable from the login screen
//   - a verified code writes NOTHING to the device until the password has actually changed
//   - the password change signs every other session out
//   - the code cannot be brute-forced from the screen
//
// The usability half is asserted too, on the same rule login.test.js established: every failure
// path leaves the button tappable and says something. A dead button with no message is the bug.
//
// Run: node tests/password-reset.test.js

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
];

// A response the code under test can read. `body` is what .json() resolves to.
function res(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Routes by URL so one harness can serve the whole three-request happy path. Anything not listed
// 500s loudly rather than quietly succeeding.
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
  // The markup ships the two reset panels hidden (`style="display:none;"`), and `panel()` below
  // reads exactly that. Without this the harness starts with all three panels showing and a test
  // that asserts "did NOT move on to the code panel" passes for the wrong reason.
  els['reset-request'].style.display = 'none';
  els['reset-confirm'].style.display = 'none';
  const calls = { fetch: [], stored: [], entered: [], toasts: [], reshown: [] };

  const app = load({
    functions: [
      'showLoginPanel', 'loginFail', 'resetRecoveryState', 'showForgotPassword', 'backToSignIn',
      'startResendCooldown', 'sendRecoveryCode', 'resendRecoveryCode', 'completePasswordReset',
      'revokeOtherSessions', 'showLoginScreen', 'loginStep', 'renderLoginDiag', 'netFetch',
    ],
    decls: [
      'RECOVERY_MAX_ATTEMPTS', 'RECOVERY_RESEND_MS', 'RECOVERY_CODE_MIN', 'RECOVERY_CODE_MAX',
      'recoverySession', 'recoveryEmail',
      'recoveryAttempts', 'recoveryResendAt', 'recoveryTimer', 'NET_TIMEOUT_MS', 'APP_BUILD',
      'serverBuild', 'loginStatus',
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
      state: '() => ({ recoverySession, recoveryEmail, recoveryAttempts, recoveryResendAt, recoveryTimer })',
    },
  });

  return { app, els, calls };
}

// Every test starts from "he tapped Forgot your password? and asked for a code".
async function atCodeStep(fetchImpl, email = 'del@example.com') {
  const h = harness(fetchImpl);
  h.els['reset-email'].value = email;
  await h.app.sendRecoveryCode();
  return h;
}

const shown = h => h.els['login-error'].style.display === 'block' ? h.els['login-error'].textContent : null;
const panel = (h, id) => h.els[id].style.display !== 'none';
const post = (h, frag) => h.calls.fetch.filter(c => c.url.includes(frag));
const stop = h => h.app.resetRecoveryState();   // kills the resend interval so node can exit

(async () => {

  // ── The email is carried over, not asked for twice ──────────────────────────────────────────
  {
    const h = harness(router({}));
    h.els['login-email'].value = '  del@example.com  ';
    h.app.showForgotPassword();
    eq(h.els['reset-email'].value, 'del@example.com', 'the typed sign-in email is carried into the reset box, trimmed');
    ok(panel(h, 'reset-request') && !panel(h, 'login-form'), 'Forgot your password? swaps the card to the request panel');
    stop(h);
  }

  // ── Nothing is sent without an address, and it says so ──────────────────────────────────────
  {
    const h = harness(router({}));
    h.els['reset-email'].value = '  ';
    await h.app.sendRecoveryCode();
    eq(h.calls.fetch.length, 0, 'no request goes out with an empty email');
    ok(shown(h), 'an empty email says something rather than returning silently');
    eq(h.els['reset-send-btn'].disabled, false, 'the send button is left tappable');
    stop(h);
  }

  // ── ANTI-ENUMERATION: a real address and an unknown one look identical ──────────────────────
  {
    const real = await atCodeStep(router({ '/auth/v1/recover': res(200) }));
    const unknown = await atCodeStep(router({ '/auth/v1/recover': res(400, { msg: 'User not found' }) }));

    ok(panel(real, 'reset-confirm'), 'a known address moves on to the code panel');
    ok(panel(unknown, 'reset-confirm'), 'an UNKNOWN address moves on to the code panel too');
    eq(shown(unknown), null, 'an unknown address raises no error — the screen must not confirm who has an account');
    eq(shown(real), shown(unknown), 'both addresses leave the error line in the same state');
    eq(real.els['reset-sent-to'].value, unknown.els['reset-sent-to'].value, 'both echo back the address the same way');
    stop(real); stop(unknown);
  }

  // ── The send is a POST to /recover carrying the email ───────────────────────────────────────
  {
    const h = await atCodeStep(router({ '/auth/v1/recover': res(200) }));
    const sent = post(h, '/auth/v1/recover');
    eq(sent.length, 1, 'exactly one recover request');
    eq(sent[0].opts.method, 'POST', 'recover is a POST');
    eq(JSON.parse(sent[0].opts.body).email, 'del@example.com', 'recover carries the email');
    eq(sent[0].opts.headers.apikey, 'anon-key', 'recover carries the publishable key');
    eq(h.els['reset-send-btn'].textContent, 'Send me a code', 'the send button label is put back');
    stop(h);
  }

  // ── A rate limit is the one status worth naming ─────────────────────────────────────────────
  {
    const h = await atCodeStep(router({ '/auth/v1/recover': res(429) }));
    ok(/too many/i.test(shown(h) || ''), '429 says too many requests rather than pretending a code was sent');
    ok(!panel(h, 'reset-confirm'), '429 does not move on to the code panel — there is no code coming');
    stop(h);
  }

  // ── A dead connection is told apart from anything else ──────────────────────────────────────
  {
    const h = harness(async () => { throw Object.assign(new Error('down'), { name: 'TypeError' }); });
    h.els['reset-email'].value = 'del@example.com';
    await h.app.sendRecoveryCode();
    ok(/reach the server/i.test(shown(h) || ''), 'a network failure says so');
    eq(h.els['reset-send-btn'].disabled, false, 'the send button comes back after a network failure');
    ok(!panel(h, 'reset-confirm'), 'a failed send does not pretend a code is on its way');
    stop(h);
  }

  // ── One send a minute ───────────────────────────────────────────────────────────────────────
  {
    const h = await atCodeStep(router({ '/auth/v1/recover': res(200) }));
    eq(post(h, '/auth/v1/recover').length, 1, 'one send so far');
    ok(h.els['reset-resend'].disabled, 'the resend button is disabled while the cooldown runs');
    ok(/\(\d+s\)/.test(h.els['reset-resend'].textContent), 'the resend button counts its own cooldown down');
    await h.app.resendRecoveryCode();
    eq(post(h, '/auth/v1/recover').length, 1, 'a resend inside the cooldown sends nothing');
    ok(/wait/i.test(shown(h) || ''), 'and says how long to wait rather than doing nothing');
    stop(h);
  }

  // ── The code is checked before anything leaves the phone ────────────────────────────────────
  {
    const cases = [
      ['12345', 'goodpass99', 'goodpass99', /digits from the email/i, 'a five-digit code'],
      ['12345678901', 'goodpass99', 'goodpass99', /digits from the email/i, 'an eleven-digit code'],
      ['148209', '', '', /new password/i, 'no new password'],
      ['148209', 'short12', 'short12', /8 characters/i, 'a password under 8 characters'],
      ['148209', 'goodpass99', '', /again/i, 'no confirmation'],
      ['148209', 'goodpass99', 'goodpass98', /don't match/i, 'a mismatched confirmation'],
      ['148209', 'del@example.com', 'del@example.com', /email address/i, 'the email address as the password'],
    ];
    for (const [code, pw, again, re, label] of cases) {
      const h = await atCodeStep(router({ '/auth/v1/recover': res(200) }));
      h.els['reset-code'].value = code;
      h.els['reset-new'].value = pw;
      h.els['reset-confirm-pw'].value = again;
      await h.app.completePasswordReset();
      eq(post(h, '/auth/v1/verify').length, 0, `${label} sends no verify request`);
      ok(re.test(shown(h) || ''), `${label} is named in the message`);
      eq(h.els['reset-save-btn'].disabled, false, `${label} leaves the button tappable`);
      stop(h);
    }
  }

  // ── A code pasted with spaces or dashes is the same code ────────────────────────────────────
  {
    const h = await atCodeStep(router({ '/auth/v1/recover': res(200), '/auth/v1/verify': res(400) }));
    h.els['reset-code'].value = ' 148-2 09 ';
    h.els['reset-new'].value = 'goodpass99';
    h.els['reset-confirm-pw'].value = 'goodpass99';
    await h.app.completePasswordReset();
    const v = post(h, '/auth/v1/verify');
    eq(v.length, 1, 'a code pasted with punctuation still goes out');
    eq(JSON.parse(v[0].opts.body).token, '148209', 'the punctuation is stripped, the digits are not');
    eq(JSON.parse(v[0].opts.body).type, 'recovery', 'verify asks for a recovery token');
    eq(JSON.parse(v[0].opts.body).email, 'del@example.com', 'verify carries the address the code was sent to');
    stop(h);
  }

  // ── An 8-digit code works, because the length is a DASHBOARD setting and not ours ───────────
  {
    for (const code of ['148209', '14820912', '1482091234']) {
      const h = await atCodeStep(router({ '/auth/v1/recover': res(200), '/auth/v1/verify': res(400) }));
      h.els['reset-code'].value = code;
      h.els['reset-new'].value = 'goodpass99';
      h.els['reset-confirm-pw'].value = 'goodpass99';
      await h.app.completePasswordReset();
      const v = post(h, '/auth/v1/verify');
      eq(v.length, 1, `a ${code.length}-digit code is sent, not rejected on length`);
      eq(JSON.parse(v[0].opts.body).token, code, `the ${code.length}-digit code goes out intact`);
      stop(h);
    }
  }

  // ── A wrong code says the same thing an unknown account does, and is counted ────────────────
  {
    const h = await atCodeStep(router({ '/auth/v1/recover': res(200), '/auth/v1/verify': res(400, { msg: 'Token has expired or is invalid' }) }));
    h.els['reset-new'].value = 'goodpass99';
    h.els['reset-confirm-pw'].value = 'goodpass99';

    for (let i = 1; i <= 5; i++) {
      h.els['reset-code'].value = '000000';
      await h.app.completePasswordReset();
      eq(h.app.state().recoveryAttempts, i, `wrong code ${i} is counted`);
      eq(h.calls.stored.length, 0, `wrong code ${i} stores no session`);
      eq(h.app.state().recoverySession, null, `wrong code ${i} leaves no session in memory`);
    }
    eq(post(h, '/auth/v1/verify').length, 5, 'five codes, five requests');

    // The sixth never reaches the network.
    h.els['reset-code'].value = '000000';
    await h.app.completePasswordReset();
    eq(post(h, '/auth/v1/verify').length, 5, 'the sixth attempt is refused without a request — the code cannot be worked through');
    ok(/ask for a new one/i.test(shown(h) || ''), 'and it says to ask for a new code');
    stop(h);
  }

  // ── The countdown of tries is honest ────────────────────────────────────────────────────────
  {
    const h = await atCodeStep(router({ '/auth/v1/recover': res(200), '/auth/v1/verify': res(400) }));
    h.els['reset-code'].value = '000000';
    h.els['reset-new'].value = 'goodpass99';
    h.els['reset-confirm-pw'].value = 'goodpass99';
    await h.app.completePasswordReset();
    ok(/wrong or has expired/i.test(shown(h) || ''), 'a wrong code and an expired one get one sentence between them');
    ok(/4 tries left/.test(shown(h) || ''), 'the tries left are counted out');
    stop(h);
  }

  // ── THE ONE THAT MATTERS: a verified code alone writes nothing to the device ────────────────
  {
    const h = await atCodeStep(router({
      '/auth/v1/recover': res(200),
      '/auth/v1/verify': res(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
      '/auth/v1/user': res(422, { msg: 'New password should be different from the old password.' }),
    }));
    h.els['reset-code'].value = '148209';
    h.els['reset-new'].value = 'goodpass99';
    h.els['reset-confirm-pw'].value = 'goodpass99';
    await h.app.completePasswordReset();

    eq(h.calls.stored.length, 0, 'a good code whose password change FAILS stores no session — the code alone is not a way in');
    eq(h.calls.entered.length, 0, 'and does not open the app');
    eq(h.app.state().recoverySession, null, 'the in-memory session is dropped when the change fails');
    eq(post(h, 'scope=others').length, 0, 'nothing is revoked when nothing changed');
    ok(/different from the old password/.test(shown(h) || ''), "GoTrue's own reason is shown rather than a status code");
    eq(h.els['reset-save-btn'].disabled, false, 'the button comes back');
    stop(h);
  }

  // ── The whole way through ───────────────────────────────────────────────────────────────────
  {
    const session = { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, user: { email: 'del@example.com' } };
    const h = await atCodeStep(router({
      '/auth/v1/recover': res(200),
      '/auth/v1/verify': res(200, session),
      '/auth/v1/user': res(200, {}),
      '/auth/v1/logout': res(204),
    }));
    h.els['reset-code'].value = '148209';
    h.els['reset-new'].value = 'goodpass99';
    h.els['reset-confirm-pw'].value = 'goodpass99';
    await h.app.completePasswordReset();

    const put = post(h, '/auth/v1/user');
    eq(put.length, 1, 'the password is set once');
    eq(put[0].opts.method, 'PUT', 'the password change is a PUT');
    eq(put[0].opts.headers.Authorization, 'Bearer AT', 'it is authorised with the token the code bought');
    eq(JSON.parse(put[0].opts.body).password, 'goodpass99', 'it carries the new password');

    eq(h.calls.stored.length, 1, 'only now is a session written to the device');
    eq(h.calls.stored[0].access_token, 'AT', 'and it is the session the code bought');

    const out = post(h, '/auth/v1/logout');
    eq(out.length, 1, 'every other session on the account is revoked');
    ok(out[0].url.includes('scope=others'), 'scope=others — every device except this one, which is the point of a reset');
    ok(!out[0].url.includes('scope=global'), 'not scope=global, which would sign the phone out of the app it just opened');

    eq(h.calls.entered[0], 'home', 'and he lands on Home, signed in');
    eq(h.app.state().recoverySession, null, 'the recovery state is wiped behind him');
    eq(h.app.state().recoveryEmail, '', 'including the address');
    eq(h.els['reset-code'].value, '', 'the code box is emptied');
    eq(h.els['reset-new'].value, '', 'the new-password box is emptied');
    eq(h.els['reset-confirm-pw'].value, '', 'the confirmation box is emptied');
    ok(panel(h, 'login-form'), 'the card is left on the sign-in panel for next time');
    ok(h.calls.toasts.some(t => /password changed/i.test(t[0])), 'and it says the password changed');
    stop(h);
  }

  // ── An expiring token elsewhere in the app must not leave a half-finished reset on screen ───
  {
    const h = await atCodeStep(router({ '/auth/v1/recover': res(200) }));
    h.els['reset-code'].value = '148209';
    h.els['reset-new'].value = 'goodpass99';
    h.app.showLoginScreen('Session expired — log in again');
    ok(panel(h, 'login-form'), 'the login screen comes back on the sign-in panel');
    ok(!panel(h, 'reset-confirm'), 'not on the code panel');
    eq(h.els['reset-code'].value, '', 'the code is not left on screen');
    eq(h.els['reset-new'].value, '', 'nor is a typed-out new password');
    eq(shown(h), 'Session expired — log in again', 'and the reason still gets through — the panel swap must not eat it');
    stop(h);
  }

  // ── Backing out leaves nothing behind ───────────────────────────────────────────────────────
  {
    const h = await atCodeStep(router({ '/auth/v1/recover': res(200) }));
    h.els['reset-code'].value = '148209';
    h.app.backToSignIn();
    eq(h.els['reset-code'].value, '', 'Back to sign in clears the code');
    eq(h.app.state().recoveryEmail, '', 'and the address');
    eq(h.app.state().recoveryTimer, null, 'and stops the cooldown timer');
    ok(panel(h, 'login-form'), 'and puts the sign-in panel back');
    stop(h);
  }

  // ── The diag readout follows the reset too ──────────────────────────────────────────────────
  {
    const h = await atCodeStep(router({ '/auth/v1/recover': res(200) }));
    ok(/reset/.test(h.els['login-diag'].textContent), 'the login screen black box reports the reset steps as well as the sign-in ones');
    stop(h);
  }

  // ── What the password manager needs, asserted against index.html itself ─────────────────────
  // 1Password offered to save nothing after Del's first successful reset (24 Aug). A manager needs a
  // real submit event and a username field in the SAME form to know which login just changed; the
  // panels were bare divs and the email sat on the panel behind. All three are markup, so they are
  // checked here rather than through the extracted functions — a future tidy that unwraps the form
  // or drops the readonly field would silently take the behaviour with it.
  {
    const fsx = require('fs');
    const pathx = require('path');
    const root = pathx.join(__dirname, '..');
    const html = fsx.readFileSync(pathx.join(root, 'index.html'), 'utf8');
    const appSrc = fsx.readFileSync(pathx.join(root, 'js', 'app.js'), 'utf8');
    const confirmPanel = html.slice(html.indexOf('id="reset-confirm"'), html.indexOf('id="login-error"'));
    const requestPanel = html.slice(html.indexOf('id="reset-request"'), html.indexOf('id="reset-confirm"'));

    ok(confirmPanel.includes('<form onsubmit="completePasswordReset(); return false;">'),
       'the reset panel is a real form — a manager captures a change on the submit event');
    ok(confirmPanel.includes('<button type="submit" class="btn-primary" id="reset-save-btn">'),
       'Set password is that form\'s submit button');
    ok(!confirmPanel.includes('onclick="completePasswordReset()"'),
       'no onclick left alongside the submit — that would run the handler twice on one tap');
    ok(confirmPanel.includes('id="reset-sent-to" autocomplete="username" readonly'),
       'the address rides along as a readonly username field, so the manager knows WHICH login changed');
    ok((confirmPanel.match(/autocomplete="new-password"/g) || []).length === 2,
       'both new-password boxes are marked new-password');
    ok(requestPanel.includes('<form onsubmit="sendRecoveryCode(); return false;">'),
       'the request panel is a form too, so Enter submits it without a keydown handler');
    ok(!appSrc.includes("getElementById('reset-confirm-pw').addEventListener"),
       'and no keydown handler survives on the reset fields, which would double-fire on Enter');
  }

  console.log(`password-reset: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
