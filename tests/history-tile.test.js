// C2 + C10 — the two things a History workout tile got wrong: what the delta on a timed lift is
// measured in, and what order the exercises are listed in.
//
// C2: `best` is WEIGHT, so the delta on an unloaded hold subtracted null from null and the cell
// printed "—" forever — beside a PR badge the same lift had just earned, because the PR rules have
// counted a longer hold since 14 Aug. Del: the badge works, the delta does not. DeadHang and Side
// Plank are the unloaded cases; Farmers Walk carries a real kg and keeps a kg delta.
//
// C10: the tile listed exercises in the order their ROWS were written. saveExerciseSets() replaces
// an exercise's rows wholesale on every Mark Done, so fixing a typo on the first lift restamped its
// created_at and dropped it to the bottom of the card. Del: "why on the history workout tile is the
// list different from the actual day layout of the training day (sequence)".
//
// Both are asserted on what the functions RETURN — the value the card prints and the order it
// prints them in. Nothing here checks that something was called.
//
// Run: node tests/history-tile.test.js

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
function deep(actual, expected, label) {
  ok(JSON.stringify(actual) === JSON.stringify(expected),
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const app = load({
  functions: ['computeExerciseProgress', 'deltaCell', 'historyExerciseOrder',
              'snapSupersetsIntoOrder', 'isTimed', 'timedTarget', 'catalogueKey'],
  decls: ['CATALOGUE_BY_KEY', 'TIMED_EXERCISES'],
});

// Two workouts a week apart, given as [{id, date}] + the sets logged in each.
function progress(workouts, setsByWorkout) {
  return app.computeExerciseProgress(workouts, setsByWorkout);
}
const W = [{ id: 'w1', date: '2026-08-12' }, { id: 'w2', date: '2026-08-19' }];
const set = (exercise, n, weight, reps) => ({ exercise, set_number: n, weight, reps, rest_seconds: 90 });

// ═══════════════════════════════════════════════════════════════════════════
console.log('C2 — the delta on a timed lift');
// ═══════════════════════════════════════════════════════════════════════════
{
  // DeadHang: unloaded, so `reps` MEANS SECONDS. 30s last week, 42s this week.
  const p = progress(W, {
    w1: [set('DeadHang', 1, null, 30)],
    w2: [set('DeadHang', 1, null, 42)],
  });
  const now = p['w2|DeadHang::'];
  eq(now.best, null, 'an unloaded hold still has no weight');
  eq(now.delta, 12, 'the hold is 12 longer than last week');
  eq(now.deltaUnit, 's', 'and the card is told those are seconds, not kilos');
  eq(app.deltaCell(now.delta, { suffix: 's', decimals: 0 }),
    '<span class="pf-d up">+12s</span>', 'so the cell reads +12s, where it used to read —');

  // The badge and the delta now agree, which was the whole complaint.
  eq(now.isPR, true, 'a longer hold is still a PR');

  // A shorter hold is a loss, and reads as one.
  const worse = progress(W, {
    w1: [set('Side Plank', 1, null, 45)],
    w2: [set('Side Plank', 1, null, 38)],
  })['w2|Side Plank::'];
  eq(worse.delta, -7, 'Side Plank held 7 seconds less');
  eq(app.deltaCell(worse.delta, { suffix: 's', decimals: 0 }),
    '<span class="pf-d down">−7s</span>', 'and prints as a drop');

  // The first ever entry has nothing to compare against and must stay blank.
  eq(p['w1|DeadHang::'].delta, null, 'the first hold ever logged has no delta');
  eq(app.deltaCell(null, { suffix: 's', decimals: 0 }), '<span class="pf-d same">—</span>',
    'and prints the dash it always did');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('C2 — what is deliberately NOT folded in');
// ═══════════════════════════════════════════════════════════════════════════
{
  // Farmers Walk is timed AND loaded. It has a real kg to progress, so the delta stays in kilos —
  // two units in one cell would say less than one.
  const fw = progress(W, {
    w1: [set('Farmers Walk', 1, '30', 40)],
    w2: [set('Farmers Walk', 1, '34', 40)],
  })['w2|Farmers Walk::'];
  eq(fw.delta, 4, 'a loaded carry compares the load');
  eq(fw.deltaUnit, 'kg', 'and says so');

  // Non-timed bodyweight work keeps its blank delta: its fallback would be reps, a third unit, and
  // it is not what was reported. Logged here so the next person can see it was a decision.
  const pu = progress(W, {
    w1: [set('Pull Ups', 1, null, 8)],
    w2: [set('Pull Ups', 1, null, 10)],
  })['w2|Pull Ups::'];
  eq(pu.delta, null, 'bodyweight reps still have no delta');
  eq(pu.isPR, true, 'though the rep PR badge still fires');

  // And an ordinary loaded lift is untouched.
  const lift = progress(W, {
    w1: [set('Incline Smith', 1, '54', 10)],
    w2: [set('Incline Smith', 1, '56', 10)],
  })['w2|Incline Smith::'];
  eq(lift.delta, 2, 'a normal lift compares weight, exactly as before');
  eq(lift.deltaUnit, 'kg', 'in kilos');
  eq(app.deltaCell(lift.delta, { decimals: 1 }), '<span class="pf-d up">+2</span>',
    'and prints the way it always has');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('C10 — the tile lists the training day, not the write order');
// ═══════════════════════════════════════════════════════════════════════════
const UPPER_1 = ['Incline Smith', 'Machine Chest Press', 'Smith Shoulder Press', 'Lat Pulldown',
  'Seated Row', 'Cable Flys', 'Tricep Pushdown'];
const entry = (name, group) => ({ key: `${name}::`, name, supersetGroup: group || null });
const keys = names => names.map(n => `${n}::`);

{
  // Del's case: he re-tapped Mark Done on Incline Smith to fix a typo after finishing, so its rows
  // were rewritten last and it arrived here at the BOTTOM of the logged order.
  const logged = ['Machine Chest Press', 'Smith Shoulder Press', 'Lat Pulldown', 'Seated Row',
    'Cable Flys', 'Tricep Pushdown', 'Incline Smith'].map(n => entry(n));
  deep(app.historyExerciseOrder(logged, UPPER_1), keys(UPPER_1),
    'the card lists Upper 1 the way Upper 1 is laid out');

  // Nothing to reorder — the common case must not move.
  deep(app.historyExerciseOrder(UPPER_1.map(n => entry(n)), UPPER_1), keys(UPPER_1),
    'a session logged in order stays in order');
}

{
  // A today-only Add Exercise is a name the template has never heard of. It must never be dropped,
  // and it goes after the template's own, in the order it was logged.
  const logged = [entry('Face Pull'), entry('Seated Row'), entry('Incline Smith'), entry('Chin Ups')];
  deep(app.historyExerciseOrder(logged, UPPER_1),
    keys(['Incline Smith', 'Seated Row', 'Face Pull', 'Chin Ups']),
    "today's extras keep their logged order on the end");
}

{
  // Open Workout has no template at all, so there is nothing to sort by and the logged order is the
  // only order it has. Same for a session whose template was deleted.
  const logged = [entry('Squat'), entry('Bench'), entry('Row')];
  deep(app.historyExerciseOrder(logged, []), keys(['Squat', 'Bench', 'Row']),
    'Open Workout keeps the order it was logged in');
  deep(app.historyExerciseOrder(logged, undefined), keys(['Squat', 'Bench', 'Row']),
    'and a missing template is not an error');
  deep(app.historyExerciseOrder([], UPPER_1), [], 'a workout with no sets lists nothing');
}

{
  // Supersets sit together on the card because they sat together on the day — the same snap rule
  // the logger uses, run off the tags on the saved sets. Cable Flys is paired with Incline Smith,
  // which is 1st in the template, so the pair sits at slot 1 and Machine Chest Press moves down.
  const logged = [entry('Incline Smith', 'A'), entry('Cable Flys', 'A'), entry('Machine Chest Press'),
    entry('Smith Shoulder Press')];
  deep(app.historyExerciseOrder(logged, UPPER_1),
    keys(['Incline Smith', 'Cable Flys', 'Machine Chest Press', 'Smith Shoulder Press']),
    'a pair sits together at the earliest slot either member holds');

  // A tag on one lift alone is not a pair and must not move anything.
  const solo = [entry('Machine Chest Press'), entry('Incline Smith', 'A')];
  deep(app.historyExerciseOrder(solo, UPPER_1), keys(['Incline Smith', 'Machine Chest Press']),
    'a group of one is not a superset');
}

{
  // Two variations of one lift are two rows on the card and must both survive the sort.
  const logged = [
    { key: 'Hammer Curl::Seated', name: 'Hammer Curl', supersetGroup: null },
    { key: 'Hammer Curl::Standing', name: 'Hammer Curl', supersetGroup: null },
  ];
  deep(app.historyExerciseOrder(logged, ['Hammer Curl']),
    ['Hammer Curl::Seated', 'Hammer Curl::Standing'],
    'both variations are kept, in the order they were logged');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
