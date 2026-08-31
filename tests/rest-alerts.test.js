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

  // An unstamped flag is nobody's, whoever happens to be signed in.
  delete store[app.ownerKey()];
  store[app.accountKey()] = 'del@example.com';
  eq(app.restAlertsOn(), false, 'a flag with no owner is not claimed by the account that happens to be here');

  // ⚠️ THIS ANSWER CHANGED ON 28 AUG AND THE CHANGE IS C19. It used to be `true`: an unstamped flag
  // with no account recorded on the device fell back to the flag alone. That is one key with two
  // answers — ON before a login, OFF after it — and it is exactly what Del watched happen while he
  // was checking E17. The claim is made at the account boundary now, in section 4, so this gate
  // never has to guess; a guess that changes meaning at login is the bug it caused.
  delete store[app.accountKey()];
  eq(app.restAlertsOn(), false,
    'a flag with no owner and no account on the device is still nobody\'s — the gate gives one ' +
    'answer, and does not change it the moment somebody signs in');
}

// ── 4. WHO CLAIMS AN UNSTAMPED FLAG (C19, 28 Aug 2026) ─────────────────────────────────────
// The stamp shipped on the morning of 28 Aug with nothing to write it for the flag ALREADY on disk,
// and every device that had alerts on before that build had exactly that: `dlog_rest_alerts = '1'`
// and no owner. Section 3 is the gate refusing to guess whose it is; this is the answer being
// supplied, at the one point in the app where both the outgoing and the incoming account are known.
//
// Two properties, and they pull in opposite directions, which is why they are asserted together:
// Del gets his own preference back without re-enabling anything by hand, and a second account on
// the same phone still inherits nothing.
{
  const session = {};
  const shared = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const boundary = load({
    functions: ['claimDeviceForAccount', 'perDeviceKeys', 'claimRestAlertsFlag'],
    decls: ['LAST_ACCOUNT_STORE', 'BACKUP_STORE', 'HISTORY_FILTER_STORE', 'STATS_RANGE_STORE',
            'REST_ALERTS_STORE', 'REST_ALERTS_OWNER_STORE', 'REST_TOKEN_STORE', 'REST_ARM_STORE'],
    deps: {
      localStorage: shared,
      sessionStorage: {
        getItem: (k) => (k in session ? session[k] : null),
        setItem: (k, v) => { session[k] = String(v); },
        removeItem: (k) => { delete session[k]; },
      },
    },
  });

  // A device as it stood the night before this fix: alerts on since July, and no stamp, because the
  // key that holds the stamp did not exist when the switch was flipped.
  const legacyDevice = (account) => {
    for (const k of Object.keys(store)) delete store[k];
    store[app.storeKey()] = '1';
    if (account) store[app.accountKey()] = account;
  };

  permission = 'granted';

  // ── His phone and his browser: the same account signing in again. ──
  legacyDevice('del@example.com');
  eq(app.restAlertsOn(), false, 'the unstamped flag reads OFF to start with — the bug exactly as reported');
  boundary.claimDeviceForAccount('del@example.com');
  eq(store[app.ownerKey()], 'del@example.com', 'signing in claims the flag for the account the device already belongs to');
  eq(app.restAlertsOn(), true, 'and the alerts are on again with nothing for him to re-enable by hand');

  // ── A genuine switch, which is the half that must NOT be generous. ──
  legacyDevice('del@example.com');
  boundary.claimDeviceForAccount('tester@example.com');
  eq(store[app.ownerKey()], 'del@example.com',
    'a switch stamps the account that is LEAVING — the preference is theirs and they are coming back for it');
  eq(app.restAlertsOn(), false,
    'so the arriving account inherits nothing: the leak the stamp exists to stop is still stopped');
  boundary.claimDeviceForAccount('del@example.com');
  eq(app.restAlertsOn(), true, 'and the trip back hands it straight back');

  // ── A stamp that already exists is the user's own answer and is never rewritten. ──
  legacyDevice('del@example.com');
  store[app.ownerKey()] = 'del@example.com';
  boundary.claimDeviceForAccount('tester@example.com');
  eq(store[app.ownerKey()], 'del@example.com', 'an existing stamp does not move when somebody else signs in');

  // ── OFF is a decision, not a gap. Claiming it back on would be the same silent override in
  //    reverse, and this time against what the person actually asked for. ──
  legacyDevice('del@example.com');
  store[app.storeKey()] = '0';
  boundary.claimDeviceForAccount('del@example.com');
  eq(store[app.ownerKey()], undefined, 'a deliberate switch-off is never claimed back on');
  eq(app.restAlertsOn(), false, 'and stays off');

  legacyDevice('del@example.com');
  delete store[app.storeKey()];
  boundary.claimDeviceForAccount('del@example.com');
  eq(store[app.ownerKey()], undefined, 'a device that never asked for alerts does not acquire a preference');

  // ── The first account this device has ever recorded. Nobody else can have set that flag: to set
  //    it you have to be signed in, and signing in is what writes the account. ──
  legacyDevice('');
  boundary.claimDeviceForAccount('del@example.com');
  eq(store[app.ownerKey()], 'del@example.com', 'the first account on the device claims the flag');
  eq(app.restAlertsOn(), true, 'and has alerts on, which is what the flag said all along');

  // ── enableRestAlerts() stamps with restAlertsDeviceAccount(), which is '' on a device that has
  //    never recorded one. An empty stamp is an unstamped flag, not somebody called ''. ──
  legacyDevice('del@example.com');
  store[app.ownerKey()] = '';
  boundary.claimDeviceForAccount('del@example.com');
  eq(store[app.ownerKey()], 'del@example.com', 'an empty stamp is treated as no stamp and gets claimed');
  eq(app.restAlertsOn(), true, 'rather than reading OFF forever against an account it can never match');
}

// ── 5. THE DEVICE THAT NEVER LOGS IN AGAIN (C19, 28 Aug 2026) ──────────────────────────────
// Section 4 runs at a login, and the phone carrying this bug may not see one for weeks — its
// session just refreshes. reconcileRestAlerts() already existed to put back what the old wipe took,
// but its rescue reads push_subscriptions, and Del's desktop browser has no row in that table at
// all: it returned at `if (!sub)` and left the flag orphaned. The claim is local, synchronous, and
// happens before any of that.
(async () => {
  const sbCalls = [];
  let painted = 0;
  const boot = load({
    functions: ['reconcileRestAlerts', 'restAlertsOn', 'pushSupported', 'restAlertsDeviceAccount',
                'claimRestAlertsFlag'],
    decls: ['REST_ALERTS_STORE', 'REST_ALERTS_OWNER_STORE', 'LAST_ACCOUNT_STORE'],
    deps: {
      window: { PushManager: function () {}, Notification: function () {} },
      get Notification() { return { get permission() { return permission; } }; },
      localStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      },
      // A registration with no subscription on it: the desktop browser, and any phone that has
      // never been installed to the Home Screen.
      navigator: { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => null } }) } },
      sb: async (path) => { sbCalls.push(path); return []; },
      paintRestAlertsButton: () => { painted++; },
    },
  });

  const bootDevice = (flag) => {
    for (const k of Object.keys(store)) delete store[k];
    if (flag !== null) store['dlog_rest_alerts'] = flag;
    store['dlog_last_account'] = 'del@example.com';
    sbCalls.length = 0;
    painted = 0;
  };

  permission = 'granted';

  bootDevice('1');
  await boot.reconcileRestAlerts();
  eq(boot.restAlertsOn(), true, 'opening Home is enough — the flag is claimed without a login');
  eq(sbCalls.length, 0, 'and without a single network call, which is the point on gym Wi-Fi');
  ok(painted > 0, 'the button repaints, so the label stops saying off while the alerts are on');

  // Switched off on purpose, by the account that is here. Nothing above may undo that.
  bootDevice('0');
  store['dlog_rest_alerts_owner'] = 'del@example.com';
  await boot.reconcileRestAlerts();
  eq(boot.restAlertsOn(), false, 'a deliberate off survives the boot claim');
  eq(sbCalls.length, 0, 'and is not queried against the server either');

  // Off with no stamp: the local claim must not touch it, and the push rescue underneath has no
  // subscription to find, so it stays off.
  bootDevice('0');
  await boot.reconcileRestAlerts();
  eq(boot.restAlertsOn(), false, 'an unstamped off is not read as an unclaimed on');

  // ── 6. A SECOND PERSON ON THE SAME PHONE CAN SWITCH ALERTS ON (C20, 28 Aug 2026) ─────────
  // Charlie tapped Rest alerts on Del's iPhone and got "Couldn't save the subscription (403)". The
  // endpoint belongs to the install, not the account, so the upsert on `?on_conflict=endpoint`
  // resolved to ON CONFLICT DO UPDATE against Del's row — and push_subscriptions_update_own refuses
  // it. There was no way round it from the app: the row in the way is one RLS also hides.
  //
  // The key is (user_id, endpoint) now and this is a delete-then-insert. What the test pins is the
  // shape of the two requests, because that is the whole fix: an upsert creeping back in here is the
  // 403 coming back with it.
  {
    const requests = [];
    // The real paintRestAlertsButton runs against this, rather than a counter stub: what the label
    // SAYS is the thing Del reads off the screen, and a stub that counts calls proves nothing
    // about it.
    const button = { textContent: '', disabled: false };
    let permission6 = 'granted';
    let postStatus = 200;
    const toasts = [];

    // `standalone` is the whole platform signal now. It was a user-agent sniff for an hour on
    // 28 Aug, and Del runs the PC copy inside DevTools device emulation — which spoofs the UA to
    // an iPhone, so the same browser gave two different answers depending on whether the toolbar
    // was open. navigator.standalone is Safari-only, true only in an installed iOS PWA, and
    // DevTools does not fake it.
    const mountEnable = (standalone) => load({
      functions: ['enableRestAlerts', 'pushSupported', 'urlB64ToUint8Array', 'b64FromBuffer',
                  'restAlertsDeviceAccount', 'paintRestAlertsButton', 'restAlertsOn'],
      decls: ['VAPID_PUBLIC_KEY', 'REST_ALERTS_STORE', 'REST_ALERTS_OWNER_STORE', 'LAST_ACCOUNT_STORE'],
      deps: {
        atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
        btoa: (bin) => Buffer.from(bin, 'binary').toString('base64'),
        window: { PushManager: function () {}, Notification: function () {} },
        get Notification() {
          return { get permission() { return permission6; }, requestPermission: async () => permission6 };
        },
        localStorage: {
          getItem: (k) => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); },
          removeItem: (k) => { delete store[k]; },
        },
        document: { getElementById: () => button },
        navigator: {
          standalone,
          // The row carries a user agent; the app never reads it back for a decision.
          userAgent: 'test-agent',
          serviceWorker: {
            ready: Promise.resolve({
              pushManager: {
                getSubscription: async () => ({
                  endpoint: 'https://web.push.apple.com/abc',
                  getKey: () => new Uint8Array([1, 2, 3]).buffer,
                }),
              },
            }),
          },
        },
        sb: async (path, method, body, opts) => {
          requests.push({ path, method, opts });
          return { ok: method === 'POST' ? postStatus === 200 : true, status: method === 'POST' ? postStatus : 204 };
        },
        showToast: (msg, type) => toasts.push({ msg, type }),
      },
    });

    const iphone = mountEnable(true);    // D-LOG installed to the Home Screen, which is the only
                                         // shape of iOS that can reach any of this

    for (const k of Object.keys(store)) delete store[k];
    store['dlog_last_account'] = 'ctrlaltdelboy25@gmail.com';   // Charlie, on Del's phone
    requests.length = 0;

    const okd = await iphone.enableRestAlerts();
    eq(okd, true, 'the second account on the phone can switch rest alerts on');
    eq(requests.length, 2, 'two requests: clear my own row for this device, then insert it');
    eq(requests[0].method, 'DELETE', 'the delete goes first');
    ok(/^push_subscriptions\?endpoint=eq\./.test(requests[0].path),
      'and is scoped to this device\'s endpoint — RLS scopes it to this account, so it cannot reach Del\'s row');
    eq(requests[1].method, 'POST', 'then a plain insert');
    eq(requests[1].path, 'push_subscriptions',
      'with NO on_conflict target — the conflict against another account\'s row IS the 403');
    ok(!requests[1].opts || !requests[1].opts.upsert,
      'and no merge-duplicates header, for the same reason');
    eq(store['dlog_rest_alerts'], '1', 'the flag goes on');
    eq(store['dlog_rest_alerts_owner'], 'ctrlaltdelboy25@gmail.com', 'stamped to the account that asked for it');
    eq(button.textContent, 'Rest alerts: on', 'and the button says so without waiting for a reload');

    // A failed insert must not leave the app claiming alerts are on — that is the July cardio bug,
    // where a write 400'd and the toast said success.
    for (const k of Object.keys(store)) delete store[k];
    store['dlog_last_account'] = 'del@example.com';
    requests.length = 0;
    toasts.length = 0;
    postStatus = 403;
    eq(await iphone.enableRestAlerts(), false, 'a refused insert reports failure');
    eq(store['dlog_rest_alerts'], undefined, 'and does not switch the flag on behind a failure');
    ok(/403/.test(toasts[toasts.length - 1].msg), 'the toast carries the status, which is what named this bug');
    postStatus = 200;

    // ── The copy on a refused permission. Del tapped this on the PC and was told to go to iPhone
    //    Settings, which reads as the app being broken rather than the browser having said no. ──
    permission6 = 'denied';
    toasts.length = 0;
    await iphone.enableRestAlerts();
    ok(/iPhone Settings/.test(toasts[0].msg), 'on an iPhone it names iPhone Settings — iOS asks once, ever');

    const desktop = mountEnable(undefined);   // any browser that is not an installed iOS PWA
    toasts.length = 0;
    await desktop.enableRestAlerts();
    ok(!/iPhone/.test(toasts[0].msg), 'on a PC it does not send him to iPhone Settings');
    ok(/browser/.test(toasts[0].msg), 'it says the browser is blocking it, which is what actually happened');

    // ── And the button must not call a blocked permission "off". ──
    // "Rest alerts: off" reads as a switch that is down. Del tapped it on a PC where Chrome had
    // notifications blocked for the site, got sent to iPhone Settings, and concluded the app was
    // broken. Nothing the app does can turn that on, so the label has to say so.
    button.textContent = '';
    desktop.paintRestAlertsButton();
    eq(button.textContent, 'Rest alerts: blocked', 'a blocked permission says blocked, not off');

    permission6 = 'granted';
    for (const k of Object.keys(store)) delete store[k];
    desktop.paintRestAlertsButton();
    eq(button.textContent, 'Rest alerts: off', 'and a switch that really is down still says off');
  }

  console.log(`  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
