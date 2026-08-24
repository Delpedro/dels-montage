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
function mount(shared) {
  const closed = [];
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
      'clearRestNotifications', 'cancelRestAlert', 'scheduleRestAlert',
    ],
    decls: ['REST_ALERTS_STORE', 'REST_TOKEN_STORE'],
    deps: {
      Date: FakeDate,
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_KEY: 'anon',
      window: { PushManager: function () {}, Notification: function () {} },
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
        return { ok: true };
      },
      validAccessToken: async () => { clock += shared.latency; return 'jwt'; },
      netFetch: async (url, opts) => {
        calls.push.push({ url, body: JSON.parse(opts.body) });
        return { ok: true };
      },
    },
    accessors: { now: '() => Date.now()' },
  });

  notifications.push({ tag: 'rest-alert', close() { closed.push(this); } });
  return { ...mod, calls, closed };
}

function freshShared(latency = 0) {
  const shared = { store: {}, clock: 1756000000000, latency };
  shared.store['dlog_rest_alerts'] = '1';   // REST_ALERTS_STORE — alerts switched on
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
