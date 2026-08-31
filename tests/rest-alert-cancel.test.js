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
function mount(shared, { upsertOk = true, push = true, dispatchOk = true, visible = false } = {}) {
  const closed = [];
  const logged = [];
  const toasts = [];
  const notifications = [];
  const shown = [];
  const timers = [];
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
      'readRestArm', 'writeRestArm', 'clearRestArm', 'dispatchRestAlert', 'ensureRestAlertArmed',
      'scheduleLocalRestCue', 'showLocalRestCue',
    ],
    decls: ['REST_ALERTS_STORE', 'REST_ALERTS_OWNER_STORE', 'LAST_ACCOUNT_STORE', 'REST_TOKEN_STORE',
            'restAlertsOffWarned', 'REST_ARM_STORE', 'ARM_RETRY_MS', 'ARM_MAX_TRIES', 'ARM_FLOOR_MS',
            'LOCAL_CUE_STALE_MS', 'swLocalCueTimer'],
    deps: {
      Date: FakeDate,
      document: { get visibilityState() { return visible ? 'visible' : 'hidden'; } },
      // The local cue's timer is never let run for real — the tests fire it by hand at a clock they
      // control, which is the only way to test "the page thawed twenty minutes late".
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      clearTimeout: (id) => { if (id) timers[id - 1] = null; },
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
            showNotification: async (title, opts) => { shown.push({ title, ...opts }); },
          }),
        },
      },
      sb: async (path, method, body, opts) => {
        calls.sb.push({ path, method, keepalive: !!(opts && opts.keepalive) });
        clock += shared.latency;
        return { ok: path.startsWith('rest_alerts') ? upsertOk : true, status: upsertOk ? 200 : 503 };
      },
      // The 25 Aug readout. Stubbed rather than extracted: it is temporary instrumentation, and what
      // these tests care about is that the silent paths now say something, not how it is written.
      logRestPhase: (phase, token, exercise, detail) => logged.push({ phase, token, exercise, detail }),
      showToast: (msg, type) => toasts.push({ msg, type }),
      validAccessToken: async () => { clock += shared.latency; return 'jwt'; },
      netFetch: async (url, opts) => {
        calls.push.push({ url, body: JSON.parse(opts.body), keepalive: !!opts.keepalive });
        if (!dispatchOk) return { ok: false, status: 503 };
        return { ok: true };
      },
    },
    accessors: {
      now: '() => Date.now()',
      arm: '() => readRestArm()',
      localTimer: '() => swLocalCueTimer',
    },
  });

  notifications.push({ tag: 'rest-alert', close() { closed.push(this); } });
  // Fires the pending local-cue timer at whatever the fake clock now says. Nothing in the app awaits
  // it, so the tests do.
  const fireLocalCue = () => {
    const t = timers.filter(Boolean).pop();
    return t ? t.fn() : Promise.resolve();
  };
  return { ...mod, calls, closed, logged, toasts, shown, timers, notifications, fireLocalCue, tick: (ms) => { clock += ms; } };
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

  // ── 5. THE ARM RECORD — DEL'S MONDAY SESSION, 31 AUG 2026 ────────────────
  // "2nd set RDLs notification didn't fire, and stopped altogether then". rest_alert_log for that
  // rest holds ONE row: a `cancelled` two minutes later. No booked, no upsert-failed, no no-jwt, no
  // throw. The page was frozen by iOS mid-await, the await never resumed, and the alert was never
  // armed — silently, with nothing anywhere that could ever have noticed.
  {
    const shared = freshShared();
    const m = mount(shared);
    await m.scheduleRestAlert('RDL', 120);

    const arm = m.arm();
    ok(!!arm, 'a rest writes an arm record');
    eq(arm.armed, 1, 'and it is armed once the Edge Function has actually answered');
    eq(arm.token, m.restAlertToken(), 'keyed by the same token the cancel is scoped to');
    eq(arm.dueAt, shared.clock + 120000, 'carrying the deadline stamped at the tap, not a duration');
    ok(m.calls.sb.every((c) => c.keepalive), 'the booking goes out keepalive — it must outlive a frozen page');
    ok(m.calls.push[0].keepalive, 'and so does the dispatch');
  }

  // The freeze itself: the tap wrote the intention, and then nothing finished. What must be true
  // afterwards is that the app can still tell, which is the whole difference from 31 Aug.
  {
    const shared = freshShared();
    const m = mount(shared, { dispatchOk: false });
    await m.scheduleRestAlert('RDL', 120);
    eq(m.arm().armed, 0, 'a dispatch that did not land leaves the rest booked in intention, not in fact');
    ok(m.logged.some((l) => l.phase === 'dispatch-failed'), 'and says so in the readout');

    // The watchdog, off the next watch tick. Same token, same deadline — the retry is the repair.
    const n = mount(shared, { dispatchOk: true });
    n.tick(5000);
    n.ensureRestAlertArmed();
    await new Promise((r) => setImmediate(r));
    eq(n.calls.push.length, 1, 'the next tick re-fires the booking rather than losing the cue');
    eq(n.calls.push[0].body.token, m.arm().token, 'with the token the rest already had');
    eq(n.calls.push[0].body.dueAt, shared.clock + 120000,
      'and the ORIGINAL deadline — a repair must not push the rest out by however long the freeze was');
    eq(n.arm().armed, 1, 'and the rest is armed for real this time');
    ok(n.logged.some((l) => l.phase === 'rebooked'), 'a repair is distinguishable from a first booking in the readout');
  }

  // Nothing to repair is the common case, and it must cost one storage read.
  {
    const shared = freshShared();
    const m = mount(shared);
    await m.scheduleRestAlert('RDL', 120);
    const before = m.calls.push.length;
    m.ensureRestAlertArmed();
    m.ensureRestAlertArmed();
    await new Promise((r) => setImmediate(r));
    eq(m.calls.push.length, before, 'an armed rest is never re-dispatched by the watchdog');
  }

  // A repair can never resurrect a rest that is over — the token is the authority, not the record.
  {
    const shared = freshShared();
    const m = mount(shared, { dispatchOk: false });
    await m.scheduleRestAlert('RDL', 120);
    m.setRestAlertToken('someone-elses-rest');
    m.ensureRestAlertArmed();
    await new Promise((r) => setImmediate(r));
    eq(m.calls.push.length, 1, 'a stale arm record is not re-booked');
    eq(m.arm(), null, 'it is thrown away instead');
  }

  // And it gives up rather than hammering a dead gym connection, or booking an alert so late that
  // the function has no prep window left to send it in.
  {
    const shared = freshShared();
    const m = mount(shared, { dispatchOk: false });
    await m.scheduleRestAlert('RDL', 120);
    for (let i = 0; i < 20; i++) { m.tick(5000); m.ensureRestAlertArmed(); await new Promise((r) => setImmediate(r)); }
    eq(m.calls.push.length, 6, 'six attempts and no more — ARM_MAX_TRIES');
  }
  {
    const shared = freshShared();
    const m = mount(shared, { dispatchOk: false });
    await m.scheduleRestAlert('RDL', 120);
    m.tick(118000);                       // 2s of rest left
    m.ensureRestAlertArmed();
    await new Promise((r) => setImmediate(r));
    eq(m.calls.push.length, 1, 'a rest with less left than the send needs is not re-booked');
  }

  // Cancelling clears the record too, or the watchdog would re-book a rest that is over.
  {
    const shared = freshShared();
    const m = mount(shared);
    await m.scheduleRestAlert('RDL', 120);
    await m.cancelRestAlert();
    eq(m.arm(), null, 'stopping a rest clears its arm record');
    eq(m.localTimer(), null, 'and its local cue');
  }

  // ── 6. THE CUE THAT NEEDS NO SIGNAL (31 Aug 2026) ────────────────────────
  // Del trains in a basement and the push needs a server. This is the app showing the same
  // notification itself, off a plain timer, for a rest the network could not book at all.
  {
    const shared = freshShared();
    const m = mount(shared, { dispatchOk: false });
    await m.scheduleRestAlert('RDL', 120);
    ok(m.localTimer(), 'a local cue is scheduled at the tap, before anything can go wrong');

    // mount() seeds a leftover alert on the lock screen for section 4; an empty lock screen is the
    // state this cue is for, and the guard against it is asserted on its own two blocks down.
    m.notifications.length = 0;
    m.tick(120000);
    await m.fireLocalCue();
    eq(m.shown.length, 1, 'a rest whose push never armed still gets a cue');
    eq(m.shown[0].body, 'RDL — next set', 'naming the lift, exactly as the push does');
    eq(m.shown[0].tag, 'rest-alert', 'on the one tag, so it replaces rather than stacks');
  }

  // Second guard, independent of the first: if anything is already on the lock screen under this
  // tag, a push got through after all and the app has nothing to add.
  {
    const shared = freshShared();
    const m = mount(shared, { dispatchOk: false });
    await m.scheduleRestAlert('RDL', 120);
    m.tick(120000);
    await m.fireLocalCue();
    eq(m.shown.length, 0, 'an alert already showing means something buzzed — the app does not buzz again');
  }

  // It is the FALLBACK. A booking that worked owns the cue, or Del gets buzzed twice — which is its
  // own bug report, and the arm record is what finally lets the two cases be told apart.
  {
    const shared = freshShared();
    const m = mount(shared);
    await m.scheduleRestAlert('RDL', 120);
    m.tick(120000);
    await m.fireLocalCue();
    eq(m.shown.length, 0, 'a rest whose push IS armed is left to the push — never two buzzes for one rest');
  }

  // A frozen page runs no timers, and iOS fires the overdue ones on resume. A cue half a session
  // late is worse than none — sw.js refuses a stale push for the same reason.
  {
    const shared = freshShared();
    const m = mount(shared, { dispatchOk: false });
    await m.scheduleRestAlert('RDL', 120);
    m.tick(120000 + 60000);
    await m.fireLocalCue();
    eq(m.shown.length, 0, 'a timer that thawed a minute late shows nothing');
  }

  // On screen, the ring going green is the cue. This exists for a phone in a pocket.
  {
    const shared = freshShared();
    const m = mount(shared, { dispatchOk: false, visible: true });
    await m.scheduleRestAlert('RDL', 120);
    m.tick(120000);
    await m.fireLocalCue();
    eq(m.shown.length, 0, 'nothing is pushed at a screen the app is already on');
  }

  // And a rest that was stopped early is over, whatever the timer still holds.
  {
    const shared = freshShared();
    const m = mount(shared, { dispatchOk: false });
    await m.scheduleRestAlert('RDL', 120);
    const fire = m.timers[m.timers.length - 1].fn;
    await m.cancelRestAlert();
    m.tick(120000);
    await fire();
    eq(m.shown.length, 0, 'a cancelled rest cues nothing, even if its timer still fires');
  }
}

main().then(() => {
  console.log(`  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(1); });
