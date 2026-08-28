// Rest alerts — the three bugs Del brought out of the gym on 24 Aug 2026.
//
// Three of his six notes from a two-hour session were this one feature, and all three were SILENT:
// nothing threw, nothing logged, and the only symptom was a phone that buzzed when it shouldn't and
// stayed quiet when it should. That is the whole argument for this file. `rest-alerts.test.js` owns
// the key decoding and the on/off gate; this owns the booking and the cancelling.
//
//   "Notification fired when stop clock was not running … fires out of nowhere"
//   "Notification didn't fire on lateral raise first set … first time failing"
//   "Notification is around 4-6 seconds delayed"
//
// Run: node tests/rest-alert-cancel.test.js

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

console.log('rest alerts — booking, cancelling, and the 24 Aug gym session');

// A scope that can be rebuilt from scratch against the SAME storage — which is exactly what a page
// navigation, or iOS evicting the webview, does to the app while a rest is counting.
//
// `latency` is the point of the stub: both network calls advance a fake clock, because a stub that
// resolves instantly cannot tell a deadline apart from a duration, and a gym connection is the case
// the whole change is for.
function mount(shared, { upsertOk = true, push = true } = {}) {
  const closed = [];
  const logged = [];
  const toasts = [];
  const notifications = [];
  const calls = { sb: [], push: [] };
  let clock = shared.clock;

  class FakeDate extends Date {
    constructor(...args) { if (args.length === 0) super(clock); else super(...args); }
    static now() { return clock; }
  }

  const mod = load({
    functions: [
      'restAlertsOn', 'pushSupported', 'restAlertToken', 'setRestAlertToken',
      'clearRestNotifications', 'cancelRestAlert', 'scheduleRestAlert', 'warnRestAlertsOff',
    ],
    decls: ['REST_ALERTS_STORE', 'REST_ALERTS_OWNER_STORE', 'LAST_ACCOUNT_STORE', 'REST_TOKEN_STORE',
            'restAlertsOffWarned'],
    deps: {
      Date: FakeDate,
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_KEY: 'anon',
      window: push ? { PushManager: function () {}, Notification: function () {} } : { Notification: function () {} },
      get Notification() { return { permission: 'granted' }; },
      localStorage: {
        getItem: (k) => (k in shared.store ? shared.store[k] : null),
        setItem: (k, v) => { shared.store[k] = String(v); },
        removeItem: (k) => { delete shared.store[k]; },
      },
      navigator: {
        serviceWorker: {
          getRegistration: async () => ({
            getNotifications: async ({ tag }) => notifications.filter((n) => n.tag === tag),
          }),
        },
      },
      sb: async (path, method) => {
        calls.sb.push({ path, method });
        clock += shared.latency;
        return { ok: path.startsWith('rest_alerts') ? upsertOk : true, status: upsertOk ? 200 : 503 };
      },
      // The 25 Aug readout. Stubbed rather than extracted: it is temporary instrumentation, and what
      // these tests care about is that the silent paths now say something, not how it is written.
      logRestPhase: (phase, token, exercise, detail) => logged.push({ phase, token, exercise, detail }),
      showToast: (msg, type) => toasts.push({ msg, type }),
      validAccessToken: async () => { clock += shared.latency; return 'jwt'; },
      netFetch: async (url, opts) => {
        calls.push.push({ url, body: JSON.parse(opts.body) });
        return { ok: true };
      },
    },
    accessors: { now: '() => Date.now()' },
  });

  notifications.push({ tag: 'rest-alert', close() { closed.push(this); } });
  return { ...mod, calls, closed, logged, toasts };
}

function freshShared(latency = 0) {
  const shared = { store: {}, clock: 1756000000000, latency };
  shared.store['dlog_rest_alerts'] = '1';   // REST_ALERTS_STORE — alerts switched on
  // Whose switch it is. Since 28 Aug 2026 the flag alone is not enough: it survives an account
  // switch rather than being wiped by one, so restAlertsOn() checks the stamp against the account
  // this device belongs to. A rest booked in this file is booked by the person who asked for it.
  shared.store['dlog_rest_alerts_owner'] = 'del@example.com';
  shared.store['dlog_last_account'] = 'del@example.com';
  return shared;
}

async function main() {
  // ── 1. "fires out of nowhere" ────────────────────────────────────────────
  // The token was a module-level `let`. swRestoreFromStorage() rebuilds a running timer from storage
  // on every navigation but cannot rebuild a variable, so after Stats-and-back the token read null,
  // cancelRestAlert() returned on its first line, and the booking on the server was never deleted.
  // The function then slept out the rest it had been given and buzzed mid-set.
  {
    const shared = freshShared();
    mount(shared).setRestAlertToken('tok-a');

    // Navigate away and back: a brand-new scope over the same storage.
    const afterNav = mount(shared);
    eq(afterNav.restAlertToken(), 'tok-a', 'the token survives a navigation — it lives in storage, not in a variable');

    await afterNav.cancelRestAlert();
    const del = afterNav.calls.sb.find((c) => c.method === 'DELETE');
    ok(!!del, 'stopping the watch after a navigation still deletes the booking');
    ok(del && del.path.includes('token=eq.tok-a'), 'and deletes the row it actually booked');
    eq(afterNav.restAlertToken(), null, 'and leaves nothing behind to cancel twice');
  }

  // ── 1b. A BOOKING THAT NEVER HAPPENED SAYS SO (25 Aug 2026) ──────────────
  // Del lost a Seated Leg Curl alert on 25 Aug with the phone locked, and there was no way to tell
  // afterwards whether the booking failed, the push failed, or the rest was cancelled early — every
  // one of those leaves the same evidence, which is none. The two client-side give-up points now
  // write a row, so the next miss is a lookup rather than a theory.
  {
    const shared = freshShared();
    const m = mount(shared);
    await m.scheduleRestAlert('Seated Leg Curl', 60);
    ok(m.logged.some((l) => l.phase === 'booked'), 'a booking that got through says so');
    eq(m.calls.push.length, 1, 'and the Edge Function was actually called');
  }
  {
    const shared = freshShared();
    const m = mount(shared, { upsertOk: false });
    await m.scheduleRestAlert('Seated Leg Curl', 60);
    ok(m.logged.some((l) => l.phase === 'upsert-failed'), 'a booking killed by a dead gym connection says so too');
    eq(m.calls.push.length, 0, 'and nothing is dispatched for a rest the server has no row for');
  }

  // ── 2. "didn't fire on lateral raise first set" ──────────────────────────
  // swStart() stops the running timer and books the next rest in the SAME TICK. The cancel used to be
  // an unfiltered `DELETE rest_alerts`, which deletes whatever row is there — so whichever of the two
  // requests landed second won, and when that was the delete it removed the booking that had just
  // been made. Filtered by token, the ordering stops mattering.
  {
    const shared = freshShared();
    const m = mount(shared);
    m.setRestAlertToken('tok-old');

    // Exactly the ordering in swStart(): neither call is awaited before the next one starts.
    const cancelling = m.cancelRestAlert();
    const booking = m.scheduleRestAlert('Lateral Raise', 60);
    await Promise.all([cancelling, booking]);

    const del = m.calls.sb.find((c) => c.method === 'DELETE');
    ok(del && del.path.includes('token=eq.tok-old'), 'the cancel is scoped to the rest it was cancelling');

    const live = m.restAlertToken();
    ok(live && live !== 'tok-old', 'the rest that just started holds the token when the dust settles');
    ok(del && !del.path.includes(live), 'and the cancel could not have deleted the booking that just started');
    eq(m.calls.push.length, 1, 'the new rest was booked with the Edge Function');
  }

  // A cancel with nothing booked must not fire a blind DELETE — that unfiltered request is the bug
  // above, and it would take out a rest booked by any other path.
  {
    const shared = freshShared();
    const m = mount(shared);
    await m.cancelRestAlert();
    eq(m.calls.sb.length, 0, 'cancelling when nothing is booked touches nothing');
  }

  // ── 3. "around 4-6 seconds delayed" ─────────────────────────────────────
  // The deadline is stamped at the tap. The upsert, the token check, the dispatch and the function's
  // own cold start used to be added onto the FRONT of the rest, because the function was handed a
  // duration and started counting it out when it began running.
  {
    const shared = freshShared(2000);
    const m = mount(shared);
    const tapped = shared.clock;

    await m.scheduleRestAlert('Cable Flys', 90);

    const sent = m.calls.push[0].body;
    eq(sent.dueAt, tapped + 90000, 'dueAt is 90s from the TAP, not 90s from whenever the network finished');
    ok(m.now() >= tapped + 4000, 'and the stubbed round trip really did burn 4s that would otherwise have been added on');
    eq(sent.seconds, 90, 'the duration still travels, so a function deployed before this build keeps working');
    eq(sent.exercise, 'Cable Flys', 'and the alert still names the exercise');
  }

  // Nothing is booked at all when alerts are switched off — the watch, the beep and the rest that
  // gets written to the set are all untouched by that switch, which is what makes it safe to hand a
  // beta user an app whose default is off.
  {
    const shared = freshShared();
    delete shared.store['dlog_rest_alerts'];
    const m = mount(shared);
    await m.scheduleRestAlert('Cable Flys', 90);
    eq(m.calls.push.length, 0, 'alerts off books nothing');
    eq(m.restAlertToken(), null, 'and leaves no token behind');
    // ── BUT IT HAS TO SAY SO (28 Aug 2026) ───────────────────────────────────────
    // Booking nothing, quietly, is exactly what happened to Del for 24 sets. Silence here is only
    // safe for the WATCH; for the person it reads identically to a rest that has not ended yet.
    eq(m.toasts.length, 1, 'a rest that cannot alert says so');
    ok(/Settings/.test(m.toasts[0].msg), 'and names where the switch is, not what went wrong');
  }

  // Once per app run, not once per rest — 24 of these in a session is its own bug.
  {
    const shared = freshShared();
    delete shared.store['dlog_rest_alerts'];
    const m = mount(shared);
    await m.scheduleRestAlert('Cable Flys', 90);
    await m.scheduleRestAlert('Cable Flys', 90);
    await m.scheduleRestAlert('Lat Pulldown', 120);
    eq(m.toasts.length, 1, 'three rests with alerts off, one toast');
  }

  // The switch being OFF is a state to report. A browser that cannot do push at all is not —
  // there is nothing to turn on, so nagging about it every session would be noise.
  {
    const shared = freshShared();
    delete shared.store['dlog_rest_alerts'];
    const m = mount(shared, { push: false });
    await m.scheduleRestAlert('Cable Flys', 90);
    eq(m.toasts.length, 0, 'a browser with no push support is not nagged about a switch it lacks');
  }

  // ── THE 28 AUGUST SESSION, END TO END ────────────────────────────────────────
  // Del signed into the test account at 18:34:16 on the 27th and back into his own 13 seconds later.
  // Both switches ran claimDeviceForAccount(), which wiped dlog_rest_alerts, and the next morning
  // every one of 24 rests returned on scheduleRestAlert()'s first line: no booking, no push, and no
  // row in rest_alert_log either, because the early return is above the first log write. This is
  // that trip — the flag has to still be there, and still be his, at the end of it.
  {
    const shared = freshShared();
    shared.store['dlog_last_account'] = 'ctrlaltdelboy25@gmail.com';   // the test account signs in
    shared.store['dlog_rest_alerts_owner'] = 'del@example.com';
    const away = mount(shared);
    await away.scheduleRestAlert('Hack Squat', 180);
    eq(away.calls.push.length, 0, 'the test account books nothing off the preference it did not set');

    shared.store['dlog_last_account'] = 'del@example.com';            // and 13 seconds later, back
    const home = mount(shared);
    await home.scheduleRestAlert('Hack Squat', 180);
    eq(home.calls.push.length, 1,
      'and the morning after, the first rest of the session books — this is the whole bug');
    eq(home.toasts.length, 0, 'with nothing to warn him about');
  }

  // ── 4. "17+ notifications from my app — ha ha" ──────────────────────────
  // sw.js tags every alert 'rest-alert' so each one replaces the last. iOS does not honour the tag,
  // so a two-hour session stacked one per rest down the lock screen, none of which had meant
  // anything since the set after it. The app now closes them itself.
  {
    const shared = freshShared();
    const m = mount(shared);

    await m.clearRestNotifications();
    eq(m.closed.length, 1, 'an alert left on the lock screen gets closed');

    await m.scheduleRestAlert('Lat Pulldown', 90);
    eq(m.closed.length, 2, 'starting the next rest closes the last one too');

    m.setRestAlertToken('tok-z');
    await m.cancelRestAlert();
    eq(m.closed.length, 3, 'and so does stopping a rest early');
  }
}

main().then(() => {
  console.log(`  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(1); });
