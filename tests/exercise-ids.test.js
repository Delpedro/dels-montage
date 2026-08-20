// Exercise identity — stable ids under the names (20 August 2026).
//
// An exercise used to BE its name. workout_sets.exercise, session_exercises.name and the keys of
// EXERCISE_LIBRARY were all the same free-text string, joined by string equality, so respelling one
// orphaned every set logged under the old spelling. Del's live data already carried five of these
// splits — Seated Row / Seated Row (Mach) / Seated Row Mach, Pull Ups / PullUps, Farmer Walks /
// Farmers Walk, Incline DB Curl / DB Incline Curl, Sitting BB curl (restrict) / Sitting BB
// Restricted Curl — and nothing in the app could tell they were the same lift.
//
// Migration 20260820140000 gave every exercise a row in `exercises` with a uuid, and put an
// exercise_id FK on all three tables. Names stay as the in-memory and DOM key; this is only about
// what reaches the database.
//
// The two properties worth pinning, because both are easy to "tidy" away later:
//
//   1. A missing id is never sent as null and never blocks a save. The database's link trigger
//      resolves it from the name. That is what keeps a service-worker-cached old app.js writing
//      correct rows mid-session, and it is why exercise_id is nullable rather than NOT NULL.
//   2. A rename goes through rename_exercise(), which finds rows by id across all three tables.
//      Finding them by name is the bug.
//
// Run: node tests/exercise-ids.test.js

const fs = require('fs');
const path = require('path');
const { load } = require('./extract');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  FAIL: ${label}`);
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const SQUAT = '11111111-1111-4111-8111-111111111111';
const ROW = '22222222-2222-4222-8222-222222222222';

async function main() {
  console.log('Exercise identity');

  // ── The map ─────────────────────────────────────────────────────────────────────────────────
  {
    const app = load({
      functions: ['loadExerciseIds', 'exerciseIdFields'],
      decls: ['EXERCISE_IDS'],
      deps: { sb: async () => [{ id: SQUAT, name: 'Smith Squat' }, { id: ROW, name: 'Seated Row' }] },
      accessors: { ids: '() => EXERCISE_IDS' },
    });

    await app.loadExerciseIds();
    eq(app.ids()['Smith Squat'], SQUAT, 'loadExerciseIds keys the map by name');
    eq(Object.keys(app.ids()).length, 2, 'one entry per row, no extras');

    // Absent, not null. An explicit null and an absent key both leave the trigger to resolve the
    // row, but the absent key keeps the payload honest about what the client actually knew.
    eq(JSON.stringify(app.exerciseIdFields('Smith Squat')), JSON.stringify({ exercise_id: SQUAT }),
      'a known name contributes exercise_id');
    eq(JSON.stringify(app.exerciseIdFields('Something Del Just Typed')), '{}',
      'an unknown name contributes nothing — never exercise_id: null');
    eq(JSON.stringify(app.exerciseIdFields(undefined)), '{}', 'no name contributes nothing');
  }

  // ── The set rows that actually reach the database ───────────────────────────────────────────
  {
    const el = value => ({ value, tagName: 'INPUT' });
    const boxes = {
      'w-Seated Row-1': el('60'), 'r-Seated Row-1': el('10'),
      'w-Mystery Lift-1': el('40'), 'r-Mystery Lift-1': el('8'),
    };

    const app = load({
      functions: ['collectExerciseSets', 'exerciseIdFields', 'timedTarget', 'isTimed',
                  'isOptionalWeight', 'optionalWeightValue'],
      decls: ['EXERCISE_IDS', 'currentWorkoutId', 'selectedVariations', 'pendingRest',
              'TIMED_EXERCISES', 'OPTIONAL_WEIGHT_EXERCISES'],
      deps: {
        document: { getElementById: id => boxes[id] || null },
        swPaintRestLine: () => {},
      },
      accessors: { setIds: '(m) => { EXERCISE_IDS = m; }' },
    });
    app.setIds({ 'Seated Row': ROW });

    const known = app.collectExerciseSets({ name: 'Seated Row', sets: 1 }, null);
    eq(known.length, 1, 'one filled row collected');
    eq(known[0].exercise, 'Seated Row', 'the name still goes with it — every read path filters on it');
    eq(known[0].exercise_id, ROW, 'and so does the durable id');

    const unknown = app.collectExerciseSets({ name: 'Mystery Lift', sets: 1 }, null);
    eq(unknown.length, 1, 'an unmapped exercise still saves — this is the gym, not a validator');
    ok(!('exercise_id' in unknown[0]),
      'an unmapped exercise omits the key entirely, leaving the link trigger to resolve it');
  }

  // ── A newly typed exercise is usable on its very first set ──────────────────────────────────
  {
    const calls = [];
    const app = load({
      functions: ['registerNewExercise', 'exerciseIdFields'],
      decls: ['EXERCISE_IDS', 'EXERCISE_LIBRARY'],
      deps: {
        sb: async (url, method) => {
          calls.push([url.split('?')[0], method || 'GET']);
          if (url.startsWith('custom_exercises') && !method) return [];    // not there yet
          if (url.startsWith('exercises')) return [{ id: SQUAT }];         // created by the trigger
          return { ok: true };
        },
      },
      accessors: { ids: '() => EXERCISE_IDS', lib: '() => EXERCISE_LIBRARY' },
    });

    await app.registerNewExercise('Smith Squat');
    eq(JSON.stringify(calls), JSON.stringify([
      ['custom_exercises', 'GET'], ['custom_exercises', 'POST'], ['exercises', 'GET'],
    ]), 'checks, creates, then reads the new id back');
    // Without the read-back the first set of a brand new exercise would go in id-less and only
    // pick one up on the next app start.
    eq(app.ids()['Smith Squat'], SQUAT, 'the id is cached immediately');
    eq(app.lib()['Smith Squat'].sets, 3, 'and it lands in the library with the default shape');
  }

  // ── The migration keeps its two load-bearing properties ─────────────────────────────────────
  {
    const sql = fs.readFileSync(path.join(
      __dirname, '..', 'supabase', 'migrations', '20260820140000_exercise_identity.sql'), 'utf8');

    ok(!/exercise_id\s+set\s+not\s+null/i.test(sql),
      'exercise_id stays nullable — a stale cached client must never fail a save over it');
    ok(/create trigger link_exercise before insert or update on public\.workout_sets/.test(sql),
      'workout_sets resolves a missing exercise_id in the database');
    ok(/create trigger link_exercise before insert or update on public\.session_exercises/.test(sql),
      'so does session_exercises');
    ok(/create trigger link_exercise before insert or update on public\.custom_exercises/.test(sql),
      'so does custom_exercises');

    // A rename that missed one of these tables would leave exactly the orphan the migration exists
    // to prevent, so all three are pinned rather than assumed.
    const rename = sql.slice(sql.indexOf('function public.rename_exercise'));
    ok(/update public\.workout_sets\s+set exercise\s*= p_name where exercise_id = p_id/.test(rename),
      'rename_exercise moves workout_sets by id');
    ok(/update public\.session_exercises set name\s*= p_name where exercise_id = p_id/.test(rename),
      'rename_exercise moves session_exercises by id');
    ok(/update public\.custom_exercises\s+set name\s*= p_name where exercise_id = p_id/.test(rename),
      'rename_exercise moves custom_exercises by id');
    ok(!/where name = p_name|where exercise = /.test(rename),
      'and finds nothing by name — matching on the name is the bug being fixed');

    // "Seated Row (Mach)" and "Seated Row Mach" both slugify to seated-row-mach, and both are live.
    ok(/candidate := base \|\| '-' \|\| n/.test(sql),
      'the slug collision suffix survives — two live names slugify identically');
  }

  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main();
