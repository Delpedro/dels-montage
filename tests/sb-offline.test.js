// sb() / createWorkoutRow() — offline and failed-read behaviour.
//
// The bug this covers (found and fixed 13 Aug 2026): neither function had a try/catch around
// fetch(). The 11 Aug write-failure work only ever handled a *returned* failure (400/500) — but a
// dead connection makes fetch **throw**, so the exception escaped before any .ok check existed.
// In the gym that meant Mark Done did nothing at all: no toast, no green tick, no error. History
// and Stats threw mid-render and sat on "Loading…" forever.
//
// Second half: a failed GET returned [] in silence, which renders as "you have no data" — the
// read-side twin of the July cardio loss. The [] return is deliberate and must stay (every caller
// does `(rows || []).forEach`), but it now toasts.
//
// Run: node tests/sb-offline.test.js

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

// ── harness ────────────────────────────────────────────────────────────────
// Builds a fresh copy of the extracted functions per test so the toast throttle
// (module-level `lastNetToastAt`) starts clean each time.
function build({ fetchImpl, token = 'jwt-abc', refreshTo = null, now = () => Date.now() }) {
  const toasts = [];
  const logouts = [];
  const calls = [];

  const deps = {
    fetch: (url, opts) => { calls.push({ url, opts }); return fetchImpl(url, opts, calls.length); },
    showToast: (msg, type) => toasts.push({ msg, type }),
    forceLogout: (msg) => logouts.push(msg),
    validAccessToken: async () => token,
    refreshSession: async () => refreshTo,
    sbHeaders: (t, method) => ({ Authorization: `Bearer ${t}`, _method: method }),
    todayStr: () => '2026-08-14',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_KEY: 'publishable-key',
    Response,
    console: { error: () => {} },
    // Only Date.now() is used by the code under test; a stub clock lets the throttle be tested
    // without sleeping.
    Date: { now },
  };

  const api = load({
    // netFetch is lifted rather than stubbed: these tests shadow the global fetch, and every
    // request in the app now goes through the wrapper to get its deadline. Exercising the real one
    // keeps this harness honest about what sb() actually calls.
    functions: ['sbWhat', 'netFail', 'sb', 'createWorkoutRow', 'netFetch'],
    decls: ['lastNetToastAt', 'NET_TIMEOUT_MS', 'SB_LABELS'],
    deps,
    // A lifted const is a closed-over binding, not a returned value — reach it through an accessor.
    accessors: { labels: '() => SB_LABELS' },
  });
  return { ...api, toasts, logouts, calls };
}

const netError = () => { throw new TypeError('Failed to fetch'); };
const okJson = (payload) => async () => new Response(JSON.stringify(payload), { status: 200 });
const status = (code) => async () => new Response(code === 204 ? null : '{}', { status: code });

// ── 1. offline: reads ──────────────────────────────────────────────────────
(async () => {
console.log('sb() offline + failed-read');

{
  const h = build({ fetchImpl: netError });
  const rows = await h.sb('workouts?select=*');
  ok(Array.isArray(rows), 'offline GET returns an array, not a rejected promise');
  eq(rows.length, 0, 'offline GET returns an empty array');
  eq(h.toasts.length, 1, 'offline GET toasts exactly once');
  eq(h.toasts[0].msg, "No signal — couldn't load", 'offline GET toast names the real cause');
  eq(h.toasts[0].type, 'error', 'offline GET toast is styled as an error');
  eq(h.logouts.length, 0, 'offline does NOT log the user out (that would lose the draft)');
}

// The regression proof: without the catch, this rejects. `(rows || []).forEach` is what every
// caller does, so the return shape matters as much as the toast.
{
  const h = build({ fetchImpl: netError });
  let threw = false;
  try { (await h.sb('workout_sets?select=*')).forEach(() => {}); } catch (e) { threw = true; }
  ok(!threw, 'callers can .forEach the offline result without throwing');
}

// ── 2. offline: writes ─────────────────────────────────────────────────────
{
  const h = build({ fetchImpl: netError });
  const res = await h.sb('workout_sets', 'POST', [{ reps: 10 }]);
  ok(res && typeof res.ok === 'boolean', 'offline write returns a Response-shaped object');
  eq(res.ok, false, 'offline write is not ok — callers checking res.ok see the failure');
  eq(res.status, 503, 'offline write reports 503 (0 is not a legal Response status)');
  eq(h.toasts.length, 1, 'offline write toasts');
  eq(h.toasts[0].msg, 'No signal — sets NOT saved', 'offline write toast names the write AND says NOT saved (D4)');
}

// ── 3. quiet suppresses the offline toast too ──────────────────────────────
{
  const h = build({ fetchImpl: netError });
  const res = await h.sb('cardio_logs', 'POST', [{}], { quiet: true });
  eq(res.status, 503, 'quiet offline write still reports the failure to its caller');
  eq(h.toasts.length, 0, 'quiet offline write does not toast — the caller reports it');
}
{
  const h = build({ fetchImpl: status(400) });
  const rows = await h.sb('goals?select=*', 'GET', null, { quiet: true });
  eq(rows.length, 0, 'quiet failed GET still returns []');
  eq(h.toasts.length, 0, 'quiet failed GET does not toast');
}

// ── 4. the toast throttle ──────────────────────────────────────────────────
// One screen fires several requests. Without the throttle an offline History load would re-fire
// the same toast four times over.
{
  let clock = 1_000_000;
  const h = build({ fetchImpl: netError, now: () => clock });
  await h.sb('workouts?select=*');
  await h.sb('workout_sets?select=*');
  await h.sb('cardio_logs?select=*');
  await h.sb('daily_logs?select=*');
  eq(h.toasts.length, 1, 'four offline reads in one screen load produce ONE toast');

  clock += 5000;
  await h.sb('workouts?select=*');
  eq(h.toasts.length, 2, 'a later offline read past the 4s window toasts again');
}

// ── 5. failed reads are no longer silent ───────────────────────────────────
{
  const h = build({ fetchImpl: status(500) });
  const rows = await h.sb('session_templates?select=*');
  eq(rows.length, 0, 'a 500 on GET still returns [] so callers do not throw');
  eq(h.toasts.length, 1, 'a 500 on GET toasts instead of rendering as "no data"');
  eq(h.toasts[0].msg, "Couldn't load session (500)", 'the failed-read toast carries the status code and names the read');
}
{
  // The URL-length time bomb in loadHistory() lands here one day. It must not look like an empty DB.
  const h = build({ fetchImpl: status(414) });
  await h.sb('workout_sets?workout_id=in.(...)');
  eq(h.toasts[0].msg, "Couldn't load sets (414)", 'a 414 surfaces as an error, not as an empty history');
}

// ── 6. the happy path and the 401 retry still work ─────────────────────────
{
  const h = build({ fetchImpl: okJson([{ id: 1 }]) });
  const rows = await h.sb('workouts?select=*');
  eq(rows.length, 1, 'a successful GET still returns its rows');
  eq(h.toasts.length, 0, 'a successful GET says nothing');
}
{
  const h = build({ fetchImpl: status(204) });
  const res = await h.sb('workouts?id=eq.1', 'PATCH', { notes: 'x' });
  eq(res.ok, true, 'a successful write returns an ok Response');
  eq(h.toasts.length, 0, 'a successful write says nothing');
}
{
  // Token expired mid-request: refresh once, retry, and the caller never sees a failure.
  const h = build({
    refreshTo: 'jwt-fresh',
    fetchImpl: async (url, opts, n) => n === 1
      ? new Response('{}', { status: 401 })
      : new Response(JSON.stringify([{ id: 7 }]), { status: 200 }),
  });
  const rows = await h.sb('workouts?select=*');
  eq(h.calls.length, 2, '401 triggers exactly one retry');
  eq(rows[0].id, 7, 'the retry result is what the caller gets');
  eq(h.calls[1].opts.headers.Authorization, 'Bearer jwt-fresh', 'the retry carries the refreshed token');
  eq(h.toasts.length, 0, 'a recovered 401 is invisible to the user');
}
{
  // Offline *during* the 401 retry — the second fetch throws. Same handling, no unhandled rejection.
  const h = build({
    refreshTo: 'jwt-fresh',
    fetchImpl: async (url, opts, n) => { if (n === 1) return new Response('{}', { status: 401 }); throw new TypeError('Failed to fetch'); },
  });
  const res = await h.sb('workout_sets', 'POST', [{}]);
  eq(res.status, 503, 'a connection dying during the 401 retry is caught too');
}

// ── 7. no session at all ───────────────────────────────────────────────────
{
  const h = build({ fetchImpl: netError, token: null });
  const rows = await h.sb('workouts?select=*');
  eq(rows.length, 0, 'no token: GET returns [] without firing a request');
  eq(h.calls.length, 0, 'no token: no request is fired at all');
  eq(h.logouts.length, 1, 'no token: the user is signed out cleanly');
}

// ── 8. createWorkoutRow — tapping a session tile ───────────────────────────
{
  const h = build({ fetchImpl: netError });
  const id = await h.createWorkoutRow('upper-a');
  eq(id, null, 'offline, tapping a session tile returns null instead of throwing');
  eq(h.toasts.length, 0, 'createWorkoutRow stays silent — beginWorkoutSession() owns that message');
}
{
  const h = build({ fetchImpl: okJson([{ id: 'w-1' }]) });
  eq(await h.createWorkoutRow('upper-a'), 'w-1', 'online, it still returns the new workout id');
}
{
  const h = build({ fetchImpl: status(400) });
  eq(await h.createWorkoutRow('upper-a'), null, 'a 400 still returns null');
}
{
  const h = build({
    refreshTo: 'jwt-fresh',
    fetchImpl: async (url, opts, n) => n === 1
      ? new Response('{}', { status: 401 })
      : new Response(JSON.stringify([{ id: 'w-2' }]), { status: 200 }),
  });
  eq(await h.createWorkoutRow('upper-a'), 'w-2', 'createWorkoutRow still refreshes and retries on 401');
}
{
  const h = build({
    refreshTo: 'jwt-fresh',
    fetchImpl: async (url, opts, n) => { if (n === 1) return new Response('{}', { status: 401 }); throw new TypeError('Failed to fetch'); },
  });
  eq(await h.createWorkoutRow('upper-a'), null, 'connection dying during its 401 retry returns null');
}

// ── 9. D4: the toast names WHICH write failed ──────────────────────────────
// Del hit a "Save failed" on 25 Aug 2026 and could only say "it happened yesterday" — the message
// named the status code and not the thing. These assert the TOAST TEXT a user would read, never
// that sbWhat() was called: the whole item is what appears on the screen.
{
  const h = build({ fetchImpl: status(400) });
  await h.sb('daily_logs', 'POST', [{ weight: 80 }]);
  eq(h.toasts[0].msg, 'Check-in not saved (400)', 'a failed check-in write names the check-in');
}
{
  const h = build({ fetchImpl: status(500) });
  await h.sb('workouts?id=eq.1', 'PATCH', { notes: 'x' });
  eq(h.toasts[0].msg, 'Workout not saved (500)', 'a failed workout write names the workout');
}
{
  const h = build({ fetchImpl: status(400) });
  await h.sb('cardio_logs', 'POST', [{}]);
  eq(h.toasts[0].msg, 'Cardio not saved (400)', 'cardio is named — the write that was silently lost in July');
}
{
  // "not saved" is a lie about a delete: he was removing something, not saving it.
  const h = build({ fetchImpl: status(409) });
  await h.sb('workout_sets?id=eq.1', 'DELETE');
  eq(h.toasts[0].msg, "Couldn't remove sets (409)", 'a failed DELETE says remove, not save');
}
{
  // An unmapped table must never make the message worse than it was before D4 existed.
  const h = build({ fetchImpl: status(400) });
  await h.sb('some_new_table', 'POST', [{}]);
  eq(h.toasts[0].msg, 'Save failed (400) — not saved', 'an unlabelled table falls back to the old wording');
}
{
  const h = build({ fetchImpl: status(500) });
  await h.sb('some_new_table?select=*');
  eq(h.toasts[0].msg, "Couldn't load (500)", 'an unlabelled read falls back to the old wording too');
}
{
  const h = build({ fetchImpl: status(400) });
  await h.sb('daily_logs', 'POST', [{}], { quiet: true });
  eq(h.toasts.length, 0, 'quiet still suppresses the named toast — the caller owns the message');
}

// sbWhat() itself: the path is PostgREST's, so the table is everything before the query string.
{
  const h = build({ fetchImpl: status(200) });
  eq(h.sbWhat('workout_sets?workout_id=eq.7&select=*'), 'Sets', 'the query string is stripped');
  eq(h.sbWhat('daily_logs'), 'Check-in', 'a bare table resolves');
  eq(h.sbWhat('nope'), null, 'an unknown table resolves to null, not to a guess');
  eq(h.sbWhat(''), null, 'an empty path does not throw');
  eq(h.sbWhat(undefined), null, 'an undefined path does not throw');
}

// The user must never be shown a table name. Every label is a word off a screen he has seen.
{
  const h = build({ fetchImpl: status(200) });
  const bad = Object.entries(h.labels()).filter(([, v]) => /_/.test(v) || v[0] !== v[0].toUpperCase());
  eq(bad.length, 0, `every label is a capitalised user-facing noun, not a table name — offenders: ${JSON.stringify(bad)}`);
}

// The guard that keeps this from decaying: a table added next month gets a label, or this fails.
// Same idea as the native-confirm() grep in confirm-dialog.test.js — no behavioural test can notice
// a seventeenth table being introduced, and the fallback silently reinstates the original bug.
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const h = build({ fetchImpl: status(200) });
  const labels = h.labels();
  const tables = new Set([...src.matchAll(/\bsb\(\s*[`'"]([a-z_]+)/g)].map(m => m[1]));
  const unlabelled = [...tables].filter(t => !(t in labels));
  eq(unlabelled.length, 0, `every table sb() is called with has a label — missing: ${unlabelled.join(', ')}`);
  ok(tables.size >= 14, `the table scrape still finds the call sites (found ${tables.size})`);
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
})();
