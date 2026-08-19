// Exercise-scoped history — "last time" follows the LIFT, not the session it was filed under.
//
// Reported by Del on 19 Aug 2026, standing at the seated calf raise machine on a Lower B morning:
// the app told him 51kg when he was nearly certain he had pressed 52.5kg on Lower A two days
// earlier. He was right. He had to stop mid-exercise and open History to prove it to himself.
//
// The cause was one filter. loadPreviousSetsForSession() scoped its lookup with
// `session_type=eq.<this session>`, so Lower B could only ever see previous Lower B sessions — and
// five exercises in the upper/lower programme sit in two sessions each:
//
//     Seated Calf Raise · Single Leg Curl · Lower AB leg raises · Side Plank   (Lower A + Lower B)
//     Lateral Raise                                                            (Upper A + Upper B)
//
// On top of that, Open Workouts were sealed off from every fixed session in both directions.
//
// The damage was not cosmetic, and the fixture below is Del's real Seated Calf Raise history to
// prove it. He ran one continuous progression across alternating sessions — 47.5 → 51 → 52.5 — and
// on 14 Aug the app showed him the last Lower *B* figure (51) when he had already pressed 52.5 four
// days earlier on Lower A. He did 51. That session sits in his history as a step backwards that
// never happened, and nothing flagged it for five days.
//
// What is asserted here: the badge follows the exercise across session types, Open Workouts are in
// scope both ways, variations still keep their own history, aliases still resolve, the session in
// progress is never its own "last time", and the whole thing is still one request.
//
// Run: node tests/exercise-scoped-history.test.js

const { load } = require('./extract');
const { makeSb } = require('./fixtures/fake-postgrest');

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

// ── Del's real history, 4–19 Aug 2026, straight out of the live database ─────────────────────
// Seated Calf Raise alternates Lower A / Lower B on one machine ("Old Mach"); Single Leg Curl had
// never been logged under Lower B before 19 Aug, which is why that box came up empty that morning.
// Lateral Raise carries the Upper A / Upper B pairing plus a real variation toggle.
function delsData() {
  return {
    workouts: [
      { id: 'w0804', date: '2026-08-04', session_type: 'lower-a', notes: '', completed_at: '2026-08-04T06:30:00' },
      { id: 'w0807', date: '2026-08-07', session_type: 'lower-b', notes: '', completed_at: '2026-08-07T06:30:00' },
      { id: 'w0810', date: '2026-08-10', session_type: 'lower-a', notes: '', completed_at: '2026-08-10T06:30:00' },
      { id: 'w0812', date: '2026-08-12', session_type: 'open', notes: '', completed_at: '2026-08-12T06:30:00' },
      { id: 'w0814', date: '2026-08-14', session_type: 'lower-b', notes: '', completed_at: '2026-08-14T06:30:00' },
      { id: 'w0815', date: '2026-08-15', session_type: 'upper-a', notes: '', completed_at: '2026-08-15T06:30:00' },
      { id: 'w0817', date: '2026-08-17', session_type: 'lower-a', notes: '', completed_at: '2026-08-17T06:30:00' },
      { id: 'w0819', date: '2026-08-19', session_type: 'lower-b', notes: '', completed_at: null },
    ],
    workout_sets: [
      // Seated Calf Raise — one progression, split across two session types
      { id: 'a1', workout_id: 'w0804', exercise: 'Seated Calf Raise', set_number: 1, weight: '47.5', reps: 12, variation: 'Old Mach', rest_seconds: 60, superset_group: null, created_at: '2026-08-04T06:40:00' },
      { id: 'a2', workout_id: 'w0804', exercise: 'Seated Calf Raise', set_number: 2, weight: '47.5', reps: 10, variation: 'Old Mach', rest_seconds: 60, superset_group: null, created_at: '2026-08-04T06:41:00' },
      { id: 'b1', workout_id: 'w0807', exercise: 'Seated Calf Raise', set_number: 1, weight: '51.0', reps: 9, variation: 'Old Mach', rest_seconds: 60, superset_group: null, created_at: '2026-08-07T06:40:00' },
      { id: 'c1', workout_id: 'w0810', exercise: 'Seated Calf Raise', set_number: 1, weight: '52.5', reps: 10, variation: 'Old Mach', rest_seconds: 60, superset_group: null, created_at: '2026-08-10T06:40:00' },
      { id: 'd1', workout_id: 'w0814', exercise: 'Seated Calf Raise', set_number: 1, weight: '51.0', reps: 11, variation: 'Old Mach', rest_seconds: 60, superset_group: null, created_at: '2026-08-14T06:40:00' },
      { id: 'e1', workout_id: 'w0817', exercise: 'Seated Calf Raise', set_number: 1, weight: '52.5', reps: 11, variation: 'Old Mach', rest_seconds: 60, superset_group: null, created_at: '2026-08-17T06:40:00' },
      { id: 'e2', workout_id: 'w0817', exercise: 'Seated Calf Raise', set_number: 2, weight: '52.5', reps: 10, variation: 'Old Mach', rest_seconds: 60, superset_group: null, created_at: '2026-08-17T06:41:00' },
      // Single Leg Curl — Lower A only, up to the morning it was wanted on Lower B
      { id: 'f1', workout_id: 'w0817', exercise: 'Single Leg Curl', set_number: 1, weight: '17.5', reps: 10, variation: null, rest_seconds: 75, superset_group: null, created_at: '2026-08-17T06:50:00' },
      { id: 'f2', workout_id: 'w0817', exercise: 'Single Leg Curl', set_number: 2, weight: '17.5', reps: 10, variation: null, rest_seconds: 75, superset_group: null, created_at: '2026-08-17T06:51:00' },
      // Lateral Raise — Upper A, and the Machine variation only ever done in an Open Workout
      { id: 'g1', workout_id: 'w0815', exercise: 'Lateral Raise', set_number: 1, weight: '10.0', reps: 15, variation: 'DB', rest_seconds: 60, superset_group: null, created_at: '2026-08-15T06:40:00' },
      { id: 'h1', workout_id: 'w0812', exercise: 'Lateral Raise', set_number: 1, weight: '30.0', reps: 12, variation: 'Machine', rest_seconds: 60, superset_group: null, created_at: '2026-08-12T06:40:00' },
      // An alias in the wild: Del's Upper A template calls this "Incline Chest Press"
      { id: 'i1', workout_id: 'w0815', exercise: 'Smith Machine Incline Press', set_number: 1, weight: '60.0', reps: 8, variation: 'Smith', rest_seconds: 180, superset_group: null, created_at: '2026-08-15T06:35:00' },
      // Today, in progress — must never be its own "last time"
      { id: 'z1', workout_id: 'w0819', exercise: 'Seated Calf Raise', set_number: 1, weight: '52.5', reps: 12, variation: 'Old Mach', rest_seconds: 60, superset_group: null, created_at: '2026-08-19T06:40:00' },
    ],
    cardio_logs: [],
    daily_logs: [],
  };
}

// PREV_SETS_LOOKBACK_DAYS is overridden rather than inherited: at its real 180 days this fixture
// would quietly fall out of the window some time in 2027, and every assertion below would start
// passing against an empty result — the worst way for a test to die.
function app(sb) {
  return load({
    functions: ['loadPreviousSetsForSession', 'fetchPreviousSetsFor', 'prevSetsForVariation'],
    decls: ['previousSets', 'currentWorkoutId'],
    deps: { sb, PREV_SETS_LOOKBACK_DAYS: 100000, dateStr: d => d.toISOString().slice(0, 10) },
    accessors: {
      prevSets: '() => previousSets',
      setCurrentWorkoutId: '(v) => { currentWorkoutId = v; }',
    },
  });
}

const LOWER_B = {
  id: 'lower-b',
  exercises: [
    { name: 'Seated Calf Raise', variations: ['Old Mach', 'New Mach'] },
    { name: 'Single Leg Curl' },
  ],
};

(async () => {
  console.log('Exercise-scoped history — "last time" follows the lift, not the session');

  // ── 1. the bug Del reported, on his own numbers ────────────────────────────────────────────
  {
    const { sb, requests } = makeSb(delsData());
    const a = app(sb);
    a.setCurrentWorkoutId('w0819');
    await a.loadPreviousSetsForSession(LOWER_B);
    const calf = a.prevSets()['Seated Calf Raise'];

    eq(calf.map(s => s.weight), ['52.5', '52.5'],
      'Lower B is shown 52.5kg from Monday Lower A — not 51kg from the last Lower B');
    ok(!calf.some(s => s.weight === '51.0'),
      'the stale 51kg that cost him the 14 Aug session is nowhere in the result');

    // The morning that started this. Single Leg Curl had never been logged under Lower B, so the
    // old code returned nothing at all and he typed into an empty box.
    eq(a.prevSets()['Single Leg Curl'].map(s => s.weight), ['17.5', '17.5'],
      'Single Leg Curl carries its Lower A history into Lower B instead of coming up blank');

    eq(requests.length, 1, 'and the whole lookup is still one request');
    ok(!requests[0].includes('session_type'),
      'no session_type filter survives anywhere in the query — that filter WAS the bug');
  }

  // ── 2. the session in progress is never its own "last time" ────────────────────────────────
  {
    const { sb } = makeSb(delsData());
    const a = app(sb);
    a.setCurrentWorkoutId('w0819');
    await a.loadPreviousSetsForSession(LOWER_B);
    eq(a.prevSets()['Seated Calf Raise'].map(s => s.reps), [11, 10],
      'today 52.5x12 is excluded — the badge shows Monday 11 and 10 reps, not what was typed ten minutes ago');
  }

  // Without the exclusion the in-progress row would win on date, so this proves the filter runs
  // rather than the fixture simply not containing anything newer.
  {
    const { sb } = makeSb(delsData());
    const a = app(sb);   // currentWorkoutId left null, as on a fresh load
    await a.loadPreviousSetsForSession(LOWER_B);
    eq(a.prevSets()['Seated Calf Raise'].map(s => s.reps), [12],
      'with nothing in progress the most recent row genuinely is the 19 Aug one');
  }

  // ── 3. Open Workouts are in scope, both directions ─────────────────────────────────────────
  {
    const { sb } = makeSb(delsData());
    const a = app(sb);
    await a.loadPreviousSetsForSession({
      id: 'upper-b',
      exercises: [{ name: 'Lateral Raise', variations: ['DB', 'Machine'] }],
    });
    const lat = a.prevSets()['Lateral Raise'];
    eq(a.prevSetsForVariation(lat, 'DB').map(s => s.weight), ['10.0'],
      'Upper B sees the Lateral Raise done on Upper A');
    eq(a.prevSetsForVariation(lat, 'Machine').map(s => s.weight), ['30.0'],
      'and the Machine variation logged in an Open Workout, which used to be invisible to both');
  }

  {
    const { sb } = makeSb(delsData());
    const a = app(sb);
    await a.loadPreviousSetsForSession({ id: 'open', exercises: [{ name: 'Seated Calf Raise' }] });
    eq(a.prevSets()['Seated Calf Raise'].map(s => s.weight), ['52.5'],
      'and an Open Workout sees the fixed sessions — the seal was airtight in both directions');
  }

  // ── 4. variation history survives the widening ─────────────────────────────────────────────
  // The whole reason a calf raise can safely borrow from another session is that variation still
  // filters at read time. Without it, a Hack Squat row would show Leg Press numbers.
  {
    const { sb } = makeSb(delsData());
    const a = app(sb);
    await a.loadPreviousSetsForSession({
      id: 'upper-b',
      exercises: [{ name: 'Lateral Raise', variations: ['DB', 'Machine'] }],
    });
    const lat = a.prevSets()['Lateral Raise'];
    eq(lat.length, 2, 'a variation not used most recently is backfilled from its own last outing');
    ok(JSON.stringify(a.prevSetsForVariation(lat, 'DB')) !== JSON.stringify(a.prevSetsForVariation(lat, 'Machine')),
      'and the two variations never resolve to the same rows');
  }

  // ── 5. aliases have to be asked for by name now ────────────────────────────────────────────
  // The old query pulled every set of the last ten workouts and let the renderer find aliases in
  // the leftovers. An `exercise=in.(…)` filter returns only the names it was given, so an alias
  // left out of the filter would silently stop resolving.
  {
    const { sb, requests } = makeSb(delsData());
    const a = app(sb);
    await a.loadPreviousSetsForSession({
      id: 'upper-a',
      exercises: [{ name: 'Incline Chest Press', aliases: ['Smith Machine Incline Press'] }],
    });
    ok(decodeURIComponent(requests[0]).includes('Smith Machine Incline Press'),
      'the alias goes into the query, not just into the renderer');
    eq(a.prevSets()['Smith Machine Incline Press'].map(s => s.weight), ['60.0'],
      'so history logged under the alias still comes back');
  }

  // ── 6. the empty cases ─────────────────────────────────────────────────────────────────────
  {
    const { sb, requests } = makeSb(delsData());
    const a = app(sb);
    await a.loadPreviousSetsForSession({ id: 'lower-a', exercises: [{ name: 'Never Done This' }] });
    eq(a.prevSets(), {}, 'an exercise with no history at all returns nothing, not a crash');
    eq(requests.length, 1, 'and still asks once');
  }

  {
    const { sb, requests } = makeSb(delsData());
    const a = app(sb);
    await a.loadPreviousSetsForSession({ id: 'open', exercises: [] });
    eq(a.prevSets(), {}, 'an Open Workout with nothing picked yet returns nothing');
    eq(requests.length, 0, 'and asks the database nothing at all');
  }

  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
