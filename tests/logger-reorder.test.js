// C12 — reordering a template from INSIDE a live session did nothing. Del, mid-workout on 26 Aug:
// he started Upper 1, logged Incline Smith, then used the logger's own ✎ link to move Smith Shoulder
// Press to second — "should that not reflect straight away, if so, this is not working".
//
// It should, and 6ada571 claimed it did: saving the ✎ editor re-clones the template and rebuilds the
// logger in place. That half worked. What it rebuilt from did not — buildWorkoutLogger took its base
// order from the DRAFT, and logging one set is enough to write a draft carrying the order the
// template had when the tile was tapped. So the rebuild faithfully restored the order Del had just
// changed. The same edit made on the laptop (B1) passed the same morning because a device that never
// entered the session has no draft.
//
// The 24 Aug test for this half stubbed buildWorkoutLogger, so it asserted that the rebuild was
// CALLED and could not see what the rebuild produced. These cases run the real order resolution.
//
// Run: node tests/logger-reorder.test.js

const { load } = require('./extract');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  FAIL: ${label}`);
}
function deep(actual, expected, label) {
  ok(JSON.stringify(actual) === JSON.stringify(expected),
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log('logger order after a mid-session template edit');

// Upper 1 as Del trains it, in session_exercises.sort_order — the session the bug was reported from.
const UPPER_1 = ['Incline Smith', 'Machine Chest Press', 'Smith Shoulder Press', 'Lat Pulldown',
  'Seated Row', 'Cable Flys', 'Tricep Pushdown'];

const app = load({
  functions: ['resolveBaseOrder', 'displayExerciseOrder', 'snapSupersetsIntoOrder', 'activeSupersetGroups'],
  decls: ['supersetBaseOrder', 'supersetGroups', 'selectedSession'],
  accessors: {
    setLive: '(session, groups = []) => { selectedSession = session; supersetGroups = groups; }',
    setBase: '(order) => { supersetBaseOrder = order; }',
    base: '() => supersetBaseOrder',
  },
});

const sess = (id, names) => ({ id, exercises: names.map(n => ({ name: n, sets: 3 })) });

// ═══════════════════════════════════════════════════════════════════════════
console.log('  the reported bug');
// ═══════════════════════════════════════════════════════════════════════════
{
  // Del's exact repro. The draft holds the order as it was when he tapped the tile; the template now
  // has Smith Shoulder Press second, because he just moved it there and saved.
  const draftOrder = [...UPPER_1];
  const reordered = ['Incline Smith', 'Smith Shoulder Press', 'Machine Chest Press', 'Lat Pulldown',
    'Seated Row', 'Cable Flys', 'Tricep Pushdown'];

  deep(app.resolveBaseOrder(sess('upper-1', reordered), draftOrder), reordered,
    'the template Del just saved wins over the draft taken before he saved it');

  // And that is what reaches the screen, supersets and all.
  app.setLive(sess('upper-1', reordered));
  app.setBase(app.resolveBaseOrder(sess('upper-1', reordered), draftOrder));
  deep(app.displayExerciseOrder().slice(0, 3),
    ['Incline Smith', 'Smith Shoulder Press', 'Machine Chest Press'],
    'Smith Shoulder Press is second on screen, which is what he moved it to');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('  what the draft is still for');
// ═══════════════════════════════════════════════════════════════════════════
{
  // A plain mid-session browser refresh: nobody edited anything, so the answer must not move.
  deep(app.resolveBaseOrder(sess('upper-1', UPPER_1), UPPER_1), UPPER_1,
    'an untouched template rebuilds in exactly the order it was in');

  // A today-only Add Exercise is appended by buildWorkoutLogger before this runs, and stays put.
  const withExtra = [...UPPER_1, 'Face Pull'];
  deep(app.resolveBaseOrder(sess('upper-1', withExtra), UPPER_1), withExtra,
    "today's one-off addition keeps its place on the end");

  // No draft at all — the first entry into a session.
  deep(app.resolveBaseOrder(sess('upper-1', UPPER_1), []), UPPER_1, 'no draft, template order');
  deep(app.resolveBaseOrder(sess('upper-1', UPPER_1)), UPPER_1, 'no draft argument at all');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('  Open Workout keeps reading the draft');
// ═══════════════════════════════════════════════════════════════════════════
{
  // Open Workout has no template to outrank, and reconstructSessionFromSets() hands its list back in
  // DISPLAY order — pairs already snapped together. Taking that as the base order would bake the
  // pairing in and leave unpairing with nowhere to put the exercise back: the 13 Aug Lower B bug.
  const trueBase = ['Squat', 'Bench', 'Row', 'Curl'];
  const snapped  = ['Squat', 'Curl', 'Bench', 'Row'];   // Squat+Curl paired, so Curl sits beside Squat

  deep(app.resolveBaseOrder(sess('open', snapped), trueBase), trueBase,
    'Open Workout resolves to the draft base order, not the snapped order on screen');

  // Unpairing then puts Curl back where it was, which is the whole point of keeping a base order.
  app.setLive(sess('open', snapped));
  app.setBase(app.resolveBaseOrder(sess('open', snapped), trueBase));
  deep(app.displayExerciseOrder(), trueBase, 'and unpaired, Curl is back at the end');

  app.setLive(sess('open', snapped), [['Squat', 'Curl']]);
  deep(app.displayExerciseOrder(), snapped, 'paired, Curl snaps up next to Squat');

  // An exercise removed today is gone from session.exercises, so the stale draft cannot resurrect it
  // through the base order.
  deep(app.resolveBaseOrder(sess('open', ['Squat', 'Row']), trueBase), ['Squat', 'Row'],
    'a name the session no longer has is dropped from the base order');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
