// C8 — the Create Account screen broke 1Password (25 August 2026).
//
// Del's report: "whatever you did to get 1password to work, its now forcing del user, even though
// im chosing ctrlaltdelboy". The sign-in email box kept refilling his FIRST account, and then the
// saved 1Password item stopped working at all. He escaped it by deleting the test account and
// re-saving the item by hand.
//
// Nothing in the app writes to #login-email and there is no hardcoded address anywhere — the four
// references to it are all reads. The cause was the shape of the screen. `066d6fe` grew the login
// card from one email box and one password box to FOUR and FIVE, on one URL, in one DOM: sign in,
// ask for a code, type the code, create an account, confirm the account. A password manager reads
// the whole document rather than the visible part of it, so it had five candidate credential pairs
// and no way to tell which one was the sign-in — and #login-email was the only box marked
// `autocomplete="email"` (a CONTACT address) while every other email box was marked `username`
// (the login identity), so the one pair it should have keyed on was the one pair that did not
// present as a login at all.
//
// Two rules are asserted here, and between them they say "there is exactly one login on this page":
//
//   1. The sign-in panel is a real <form> whose email box is `username` and whose password box is
//      `current-password`. That is the pair a manager keys the site on.
//   2. At any moment, the fields of exactly ONE panel are enabled. A disabled field is the one
//      thing every manager skips — the same fact #reset-sent-to already leans on by being readonly
//      rather than disabled — so the other four panels are not offerable while they are not up.
//
// The failure direction matters more than the fix. The markup ships the SIGN-IN panel enabled and
// the other four disabled, so if showLoginPanel() never runs — a stale build, a throw further up —
// the one panel still usable is the one Del needs at 6am. That is asserted against index.html
// itself, because it is a property of the shipped file and not of any function.
//
// Run: node tests/login-autofill.test.js

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

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APPSRC = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

// The five panels and the fields each one owns, exactly as index.html lays them out.
const PANELS = {
  'login-form':     ['login-email', 'login-password'],
  'reset-request':  ['reset-email'],
  'reset-confirm':  ['reset-sent-to', 'reset-code', 'reset-new', 'reset-confirm-pw'],
  'signup-request': ['signup-email', 'signup-password', 'signup-confirm-pw'],
  'signup-verify':  ['signup-sent-to', 'signup-code'],
};
const PANEL_ARG = {
  'login-form': 'signin', 'reset-request': 'request', 'reset-confirm': 'confirm',
  'signup-request': 'signup', 'signup-verify': 'signup-code',
};

function field(value = '') {
  return { value, disabled: false, style: {}, focused: 0, focus() { this.focused++; } };
}

function harness() {
  const els = {};
  for (const [panelId, fieldIds] of Object.entries(PANELS)) {
    const inputs = [];
    for (const id of fieldIds) {
      els[id] = field();
      // Every panel but sign-in ships disabled, so the harness starts where the markup starts.
      els[id].disabled = panelId !== 'login-form';
      inputs.push(els[id]);
    }
    els[panelId] = { style: { display: panelId === 'login-form' ? '' : 'none' }, querySelectorAll: () => inputs };
  }
  for (const id of ['login-error', 'login-diag']) {
    els[id] = { value: '', textContent: '', style: {}, classList: { toggle() {} } };
  }

  const app = load({
    functions: [
      'showLoginPanel', 'resetRecoveryState', 'resetSignupState',
      'showForgotPassword', 'showSignUp', 'loginStep', 'renderLoginDiag',
    ],
    decls: [
      'recoverySession', 'recoveryEmail', 'recoveryAttempts', 'recoveryResendAt', 'recoveryTimer',
      'signupEmail', 'signupAttempts', 'signupResendAt', 'signupTimer',
      'serverBuild', 'loginStatus', 'APP_BUILD',
    ],
    deps: {
      document: { getElementById: id => els[id] || null },
      clearInterval: () => {},
    },
  });
  return { app, els };
}

// ── 1. One panel live at a time, whichever panel it is ────────────────────────────────────────
for (const [shownId, shownArg] of Object.entries(PANEL_ARG)) {
  const { app, els } = harness();
  app.showLoginPanel(shownArg);

  for (const [panelId, fieldIds] of Object.entries(PANELS)) {
    const shouldBeShown = panelId === shownId;
    eq(els[panelId].style.display, shouldBeShown ? '' : 'none',
       `showLoginPanel('${shownArg}'): #${panelId} display`);
    for (const id of fieldIds) {
      eq(els[id].disabled, !shouldBeShown,
         `showLoginPanel('${shownArg}'): #${id} is ${shouldBeShown ? 'live' : 'invisible to a password manager'}`);
    }
  }

  // The count is the property that actually stops C8: a manager looking at this page finds one
  // credential pair, not five.
  const live = Object.values(PANELS).flat().filter(id => !els[id].disabled);
  eq(live.length, PANELS[shownId].length, `showLoginPanel('${shownArg}'): nothing outside the live panel is offerable`);
}

// A field a panel switch disabled is still readable — resetRecoveryState() and every handler on
// this screen read .value off boxes that may be disabled at the time.
{
  const { app, els } = harness();
  els['reset-email'].value = 'del@example.com';
  app.showLoginPanel('signin');
  eq(els['reset-email'].disabled, true, 'the reset box goes dark when sign-in comes up');
  eq(els['reset-email'].value, 'del@example.com', 'and its value is still readable while disabled');
}

// ── 2. Enabling happens before focusing, or the panel opens on a dead field ────────────────────
// showForgotPassword() and showSignUp() both focus a box that ships disabled. focus() on a disabled
// input is a no-op, so if the enable ever moves after the focus, the panel opens with no keyboard
// and Del has to tap the box himself. Asserted on the field, not on the call order.
{
  const { app, els } = harness();
  els['login-email'].value = 'ctrlaltdelboy@example.com';
  app.showForgotPassword();
  eq(els['reset-email'].disabled, false, 'Forgot password leaves the email box usable');
  eq(els['reset-email'].focused, 1, 'and focused, which only works because it was enabled first');
  eq(els['reset-email'].value, 'ctrlaltdelboy@example.com', 'carrying over what was typed on the sign-in panel');
  eq(els['login-email'].disabled, true, 'while the sign-in pair goes dark behind it');
  eq(els['login-password'].disabled, true, 'both halves of it');
}
{
  const { app, els } = harness();
  els['login-email'].value = 'ctrlaltdelboy@example.com';
  app.showSignUp();
  eq(els['signup-email'].disabled, false, 'Create an account leaves the email box usable');
  eq(els['signup-email'].focused, 1, 'and focused');
  eq(els['signup-password'].disabled, false, 'and the password box with it');
  eq(els['login-email'].disabled, true, 'while the sign-in pair goes dark behind it');
}
// Back out of either one and the sign-in pair is the live one again — this is the path Del takes
// after a reset, and it is the one that has to leave him able to type.
{
  const { app, els } = harness();
  app.showSignUp();
  app.showLoginPanel('signin');
  eq(els['login-email'].disabled, false, 'coming back to sign in re-enables the email box');
  eq(els['login-password'].disabled, false, 'and the password box');
  eq(els['signup-password'].disabled, true, 'and the signup password box is not left offerable');
}

// ── 3. What ships, asserted against index.html itself ─────────────────────────────────────────
function inputTag(id) {
  const at = HTML.indexOf(`id="${id}"`);
  return HTML.slice(HTML.lastIndexOf('<input', at), HTML.indexOf('>', at) + 1);
}
const SHIPS_DISABLED = /\sdisabled[\s/>]/;

{
  const card = HTML.slice(HTML.indexOf('<div class="login-card">'), HTML.indexOf('id="login-error"'));
  const signIn = card.slice(card.indexOf('id="login-form"'), card.indexOf('id="reset-request"'));

  ok(card.includes('<form id="login-form" onsubmit="event.preventDefault(); handleLogin();">'),
     'the sign-in panel is a real <form> — a manager keys a login on a submit event, not on a div');
  ok(signIn.includes('<button type="submit" class="btn-primary" id="login-btn">Get In</button>'),
     "Get In is that form's submit button");
  ok(!signIn.includes('onclick="handleLogin()"'),
     'and carries no onclick alongside it, which would run handleLogin() twice on one tap');
  ok(!APPSRC.includes("getElementById('login-password').addEventListener"),
     'no keydown handler survives on the password box either — the form already submits on Enter');

  ok(signIn.includes('id="login-email" placeholder="your@email.com" autocomplete="username"'),
     'the sign-in email is autocomplete="username" — the login identity, not a contact address');
  ok(signIn.includes('id="login-password"') && /id="login-password"[^>]*autocomplete="current-password"/.test(signIn),
     'and the sign-in password is current-password');
  ok(!card.includes('autocomplete="email"'),
     'nothing in the card is autocomplete="email" any more — that token is what made the sign-in pair unrecognisable');

  // The safe-failure guarantee. If this ever inverts, a build where showLoginPanel() throws locks
  // Del out of his own app with a greyed-out box and no message.
  for (const id of PANELS['login-form']) {
    ok(!SHIPS_DISABLED.test(inputTag(id)),
       `#${id} ships ENABLED, so a dead showLoginPanel() still leaves sign-in usable`);
  }
  for (const [panelId, fieldIds] of Object.entries(PANELS)) {
    if (panelId === 'login-form') continue;
    for (const id of fieldIds) {
      ok(SHIPS_DISABLED.test(inputTag(id)),
         `#${id} ships disabled, so a manager never sees it on first paint`);
    }
  }

  // First paint is the moment 1Password decides what this page is. One pair, and it is the right one.
  const inputs = card.match(/<input\b[^>]*>/g) || [];
  const livePw = inputs.filter(t => t.includes('type="password"') && !SHIPS_DISABLED.test(t));
  const liveEmail = inputs.filter(t => t.includes('type="email"') && !SHIPS_DISABLED.test(t));
  eq(livePw.length, 1, 'exactly one password box is live on first paint');
  eq(liveEmail.length, 1, 'and exactly one email box');
  ok(livePw[0].includes('id="login-password"'), 'and it is the sign-in password box');
  ok(liveEmail[0].includes('id="login-email"'), 'and the sign-in email box');
}

console.log(`login-autofill: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
