// PostgREST embedding — the same data, in a fraction of the requests.
//
// Five read paths used to fetch the parent rows and then fetch their children with a
// `workout_id=in.(id,id,id,…)` filter: realWorkoutsBetween, loadHistory, loadPreviousSetsForSession,
// fetchOpenPreviousSets and fetchLastSessionSnapshot. On 15 Aug 2026 they became single requests
// with the children embedded (`workouts?select=*,workout_sets(…),cardio_logs(…)`).
//
// Two of those five — the previous-sets pair — were rewritten again on 19 Aug 2026 to look history
// up BY EXERCISE rather than by session type, which deliberately changes what they return. They
// moved out to tests/exercise-scoped-history.test.js rather than being re-captured here: this file
// is specifically the "nothing visible changed" guard for the embedding work, and a baseline that
// gets re-captured whenever behaviour moves is not a guard at all.
//
// Two things have to be true, and neither can be established by reading the new code:
//
//   1. **The data is identical.** `fixtures/embedding-baseline.json` holds what the OLD functions
//      returned, captured out of git before the change (see capture-embedding-baseline.js), for
//      thirteen scenarios covering the awkward corners — an abandoned workout, a session carried
//      only by its notes, a lift whose two variations were logged in different weeks, an Open
//      workout that was never completed. The new code has to reproduce all of it exactly.
//   2. **The requests actually went down.** Otherwise the change is pure risk for nothing. The
//      counts are asserted per scenario, not just in total, so one path quietly regressing to two
//      round trips can't hide behind another path's saving.
//
// Both versions run against the same fake PostgREST (fixtures/fake-postgrest.js), which was checked
// against the live database first for the behaviours the change leans on: embedded ordering,
// embedded filters keeping their parent rows, and empty arrays rather than nulls for childless
// parents.
//
// If you deliberately change what one of these functions returns, this test SHOULD fail. Re-capture
// the baseline in the same commit so the diff shows exactly what moved.
//
// Run: node tests/embedding.test.js

const fs = require('fs');
const path = require('path');
const { runScenarios } = require('./fixtures/embedding-scenarios');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  FAIL: ${label}`);
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; return; }
  fail++;
  console.error(`  FAIL: ${label}`);
  console.error(`    expected: ${b}`);
  console.error(`    actual:   ${a}`);
}

// `_setsByWorkout` / `_cardioByWorkout` are keyed by workout id and are only ever read by lookup —
// `computeExerciseProgress`, the abandoned-session filter and both History renderers index them by
// `w.id` and never iterate their keys. Their insertion order did change: the old code built them by
// walking one flat, globally created_at-ordered list of sets (so w1 first), the new code builds them
// workout by workout in date.desc order (so the newest first). That is not a behaviour difference,
// but JSON.stringify is key-order-sensitive, so those two maps are compared key-sorted.
//
// Only those two, and only one level deep. **Array order is left strictly alone everywhere** — the
// order of sets within a workout is what puts exercises on the card in the order they were done,
// and fetchLastSessionSnapshot's `exercises` object is genuinely iterated in insertion order by the
// Last Time card. Blanket-sorting every key would throw away the ability to catch a regression in
// either, which is most of what this test is for.
function sortKeys(o) {
  return Object.fromEntries(Object.keys(o || {}).sort().map(k => [k, o[k]]));
}
const NORMALISE = {
  loadHistory: r => ({ ...r, setsByWorkout: sortKeys(r.setsByWorkout), cardioByWorkout: sortKeys(r.cardioByWorkout) }),
};
const normalise = (name, r) => (NORMALISE[name] && r ? NORMALISE[name](r) : r);

const APP = path.join(__dirname, '..', 'js', 'app.js');
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'embedding-baseline.json'), 'utf8'));
const SRC = fs.readFileSync(APP, 'utf8');

// The request budget each scenario is allowed after the change. Written out one by one rather than
// derived, so tightening or loosening one is a visible edit to this table.
const BUDGET = {
  'realWorkoutsBetween: open-ended range': 1,
  'realWorkoutsBetween: bounded range': 1,
  'realWorkoutsBetween: nothing in range': 1,
  'fetchLastSessionSnapshot: sets only': 1,
  'fetchLastSessionSnapshot: a session with nothing logged in it': 1,
  'fetchLastSessionSnapshot: never trained': 1,
  'loadHistory': 2,                                      // daily_logs is a separate table, not a child
};

runScenarios(APP).then(actual => {
  console.log('PostgREST embedding — same data, fewer requests');

  // ── 1. every scenario returns exactly what it did before the change ────────
  for (const [name, before] of Object.entries(baseline)) {
    ok(actual[name] !== undefined, `${name} — still covered (re-capture the baseline if you renamed a scenario)`);
    if (!actual[name]) continue;
    eq(normalise(name, actual[name].result), normalise(name, before.result),
      `${name} — returns exactly what it did before embedding`);
  }

  // The baseline is read from disk, not derived from the scenario list, so without this a scenario
  // added and never captured would sit in the suite passing nothing.
  for (const name of Object.keys(actual)) {
    ok(baseline[name] !== undefined, `${name} — has a captured baseline`);
  }

  // ── 2. the round trips actually went down ─────────────────────────────────
  let before = 0, after = 0;
  for (const [name, budget] of Object.entries(BUDGET)) {
    const got = actual[name]?.requests.length;
    const was = baseline[name]?.requests.length;
    before += was || 0;
    after += got || 0;
    eq(got, budget, `${name} — ${budget} request${budget === 1 ? '' : 's'}, down from ${was}`);
  }
  ok(after < before, `${after} requests in total, down from ${before}`);
  console.log(`  ${before} requests → ${after} across ${Object.keys(BUDGET).length} scenarios`);

  // ── 3. the URL-length time bomb is gone, not just quieter ─────────────────
  // `workout_id=in.(id,id,…)` grew one uuid per workout forever. loadHistory passed every workout
  // ever logged into a query string; the backlog had it as a ~2-year fuse. Embedding deletes it
  // rather than chunking around it — there is no id list in the URL at all now.
  ok(!/workout_id=in\.\(/.test(SRC),
    'no read path builds a workout_id=in.(…) filter any more — that list grew forever');
  // The `in.(…)` filters that remain are bounded by the exercises in one session, not by all of
  // history: persistSupersetGroups' name list, and fetchPreviousSetsFor's exercise filter — which
  // since 19 Aug queries workout_sets directly and embeds the parent workout to get each set's date.
  ok(SRC.includes("workout_sets?exercise="),
    'fetchPreviousSetsFor filters sets by exercise name, not by the session they were logged under');

  // ── 4. the embeds still ask for the columns the screens render ────────────
  // A dropped column in an embed select is silent: the row still comes back, the field is just
  // undefined, and the screen renders a blank where a number should be.
  ok(SRC.includes('workout_sets(workout_id,exercise,weight,reps,rest_seconds,set_number,variation,superset_group,created_at)'),
    'the History embed still selects rest_seconds, variation and superset_group');
  ok(SRC.includes('cardio_logs(workout_id,activity,duration_mins,distance,floors,incline,speed_kmh)'),
    'the History cardio embed still selects every field formatCardioEntry prints');
  ok(SRC.includes('&workout_sets.order=created_at.asc,set_number.asc'),
    'History orders the embedded sets — without it exercises list in arbitrary order');

  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
});
