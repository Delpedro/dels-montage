// Rest alerts (Web Push) — 23 Aug 2026.
//
// Two things in here fail SILENTLY on a phone, which is why they are worth a test each. A wrong
// applicationServerKey doesn't throw: the browser subscribes, the row saves, the button says "on",
// and the push simply never arrives. And a gate that checks only half of its condition leaves the
// app claiming alerts are on after permission was revoked in iPhone Settings.
//
// Run: node tests/rest-alerts.test.js

const { load } = require('./extract');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  FAIL: ${label}`);
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log('rest alerts — key decoding and the on/off gate');

let permission = 'default';
const store = {};

const app = load({
  functions: ['urlB64ToUint8Array', 'restAlertsOn', 'pushSupported'],
  decls: ['VAPID_PUBLIC_KEY', 'REST_ALERTS_STORE', 'REST_ALERTS_OWNER_STORE', 'LAST_ACCOUNT_STORE'],
  deps: {
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    navigator: { serviceWorker: {} },
    // pushSupported() tests all three by name against `window`, so the stub has to carry all three —
    // Safari on an iPhone genuinely lacks PushManager outside an installed PWA, which is the case
    // this guard exists for.
    window: { PushManager: function () {}, Notification: function () {} },
    get Notification() { return { get permission() { return permission; } }; },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
  },
  accessors: {
    vapid: '() => VAPID_PUBLIC_KEY',
    storeKey: '() => REST_ALERTS_STORE',
    ownerKey: '() => REST_ALERTS_OWNER_STORE',
    accountKey: '() => LAST_ACCOUNT_STORE',
  },
});

// ── 1. the VAPID key decodes to a real P-256 point ─────────────────────────
{
  const bytes = app.urlB64ToUint8Array(app.vapid());
  eq(bytes.length, 65, 'the VAPID public key decodes to 65 bytes');
  eq(bytes[0], 0x04, 'and starts with 0x04 — an uncompressed P-256 point, which is what the push service demands');
}

// The base64url alphabet is the whole point: a key run through plain atob() without swapping -/_
// either throws or silently decodes to different bytes, and the push then goes nowhere.
{
  const withDashes = app.urlB64ToUint8Array('-_-_');
  eq(withDashes.length, 3, 'base64url padding and alphabet are handled');
  eq(withDashes[0], 0xfb, 'the - and _ characters map to the same bytes as + and /');
}

// ── 2. the gate needs BOTH halves ──────────────────────────────────────────
{
  permission = 'granted';
  store[app.storeKey()] = '1';
  store[app.accountKey()] = 'del@example.com';
  store[app.ownerKey()] = 'del@example.com';
  eq(app.restAlertsOn(), true, 'on when permission is granted and the switch is on');

  permission = 'denied';
  eq(app.restAlertsOn(), false, 'off when permission was revoked in Settings, even with the switch still on');

  permission = 'default';
  eq(app.restAlertsOn(), false, 'off when permission has never been asked for');

  // The half that matters for the app not lying to itself: someone who deliberately turned alerts
  // off in the footer must stay off, however granted the permission is.
  permission = 'granted';
  store[app.storeKey()] = '0';
  eq(app.restAlertsOn(), false, 'off when the user switched it off in the app');

  delete store[app.storeKey()];
  eq(app.restAlertsOn(), false, 'off by default — nothing is booked until it is asked for');
}

// ── 3. the third half, added 28 Aug 2026: WHOSE switch it is ───────────────────────────
// The flag used to be wiped whenever the account on the device changed, and that wipe is what cost
// Del his 28 August session — a test account signed in and out the evening before, and every rest
// the next morning returned on scheduleRestAlert()'s first line. The flag survives the switch now,
// so the gate has to carry the isolation the wipe used to: the preference is only on for the
// account that asked for it.
{
  permission = 'granted';
  store[app.storeKey()] = '1';
  store[app.ownerKey()] = 'del@example.com';

  store[app.accountKey()] = 'del@example.com';
  eq(app.restAlertsOn(), true, 'the account that switched alerts on still has them on');

  // The 28 Aug trip, in one line: away to the test account and back again.
  store[app.accountKey()] = 'tester@example.com';
  eq(app.restAlertsOn(), false, "a second account on the same phone does NOT inherit the first's alerts");

  store[app.accountKey()] = 'del@example.com';
  eq(app.restAlertsOn(), true,
    'and signing back in gets them back — the whole point: no wipe, so nothing to re-enable by hand');

  // An owner stamp with nobody to match it against is not a reason to go silent.
  delete store[app.ownerKey()];
  store[app.accountKey()] = 'del@example.com';
  eq(app.restAlertsOn(), false, 'a flag with no owner is not claimed by the account that happens to be here');

  delete store[app.accountKey()];
  eq(app.restAlertsOn(), true,
    'but with no account recorded on the device at all, the flag alone stands — the failure being ' +
    'fixed here is alerts silently OFF, so the fallback leans that way');
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
