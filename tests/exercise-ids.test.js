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

  // ── Variations that belong to the lift, not to a session ────────────────────────────────────
  // Del's four Seated Row options (Pully / Machine / High Row / Low Row) have nowhere to live in
  // session_exercises, because Seated Row is in no fixed template. exercises.variations is that
  // home, and buildExerciseLibrary() is where the two sources meet.
  {
    const app = load({
      functions: ['buildExerciseLibrary'],
      decls: ['SESSIONS', 'EXERCISE_VARIATIONS'],
      accessors: {
        seed: `(sessions, variations) => { SESSIONS = sessions; EXERCISE_VARIATIONS = variations; }`,
      },
    });

    app.seed(
      [{ id: 'upper-b', exercises: [{ name: 'Seated Cable Row', sets: 3, variations: ['Cable', 'Machine'] }] }],
      { 'Seated Row': ['Pully', 'Machine', 'High Row', 'Low Row'], 'Seated Cable Row': ['Wrong'] });

    const lib = app.buildExerciseLibrary();
    eq(JSON.stringify(lib['Seated Row'].variations),
      JSON.stringify(['Pully', 'Machine', 'High Row', 'Low Row']),
      'an exercise in no template still gets its picker');
    eq(lib['Seated Row'].sets, 3, 'and a default shape to hang it on');
    // Session-scoped on purpose: Upper A and Full Body A want Smith/BB on the Incline Press while
    // the DB variant stays a separate exercise.
    eq(JSON.stringify(lib['Seated Cable Row'].variations), JSON.stringify(['Cable', 'Machine']),
      'a template that already has a list keeps it — the session-scoped one wins');
  }

  // ── The merge did what Del asked, and nothing more ──────────────────────────────────────────
  {
    const sql = fs.readFileSync(path.join(
      __dirname, '..', 'supabase', 'migrations', '20260820150000_merge_duplicate_exercises.sql'), 'utf8');

    for (const [src, dst] of [
      ['Seated Row (Mach)', 'Seated Row'], ['Seated Row Mach', 'Seated Row'],
      ['PullUps', 'Pull Ups'], ['Sitting BB curl (restrict)', 'Sitting BB Restricted Curl'],
      ['Farmer Walks', 'Farmers Walk'],
    ]) {
      ok(sql.includes(`('${src}',`) && sql.includes(`'${dst}')`), `${src} merges into ${dst}`);
    }
    // Del asked for "Pull-Ups", a third spelling neither row used, so the merge lands on the
    // existing name and the rename follows it.
    ok(sql.indexOf("rename_exercise(v_id, 'Pull-Ups')") > sql.indexOf("('PullUps',"),
      'Pull-Ups is a rename after the merge, not a merge target that does not exist yet');

    // The three Del had not ruled on at that point stayed out of this file. He ruled on them
    // straight afterwards, and they are handled in 20260820160000 instead — this pins that the
    // first migration didn't help itself to a decision that hadn't been made yet.
    for (const name of ['High Row', 'Seated Cable Row', 'Incline DB Curl']) {
      ok(!new RegExp(`\\('${name}',`).test(sql), `${name} is not merged here — it was not yet Del's call`);
    }

    ok(/raise exception 'merge_exercises: % and % both hold a set/.test(sql),
      'a merge that would breach UNIQUE(workout_id, exercise, set_number) stops rather than losing a set');
  }

  // ── Folding the row variants: a merged set keeps what made it different ─────────────────────
  // High Row and Seated Cable Row became variations of Seated Row rather than disappearing into it.
  // Two sessions had logged more than one variant, which is a straight breach of
  // UNIQUE(workout_id, exercise, set_number) — hence the renumber, and hence the order it uses.
  {
    const sql = fs.readFileSync(path.join(
      __dirname, '..', 'supabase', 'migrations', '20260820160000_fold_row_variants.sql'), 'utf8');

    ok(/set variation = 'High Row'\s+where exercise_id = v_high and variation is null/.test(sql),
      "High Row's sets are stamped with the variation that replaces the name");
    ok(/set variation = 'Pully'\s+where exercise_id = v_cable and variation is null/.test(sql),
      "Seated Cable Row's sets become the Pully variation");
    ok(/variation is null/.test(sql) && (sql.match(/variation is null/g) || []).length === 2,
      'and only ever fills a blank — a variation Del recorded himself is never overwritten');

    // The order matters more than it looks: rows are written per exercise as Mark Done is tapped,
    // so created_at is the order of the session. set_number alone would interleave the variants.
    ok(/row_number\(\) over \(partition by workout_id order by created_at, set_number\)/.test(sql),
      'the renumber follows the order Del actually trained, not the old set numbers');
    ok(sql.indexOf('set_number = set_number + 10000') < sql.indexOf('row_number() over'),
      'and parks the rows out of the unique key first, because by then they all share one name');

    // Seated Cable Row carried a Cable/Machine list into Seated Row. Left in place it would beat
    // the exercise-level list, giving a different picker inside full-body-c than outside it.
    ok(/update public\.session_exercises set variations = null where exercise_id = v_seated/.test(sql),
      'the absorbed template loses its own variation list so one list applies everywhere');

    ok(/merge_exercises\(v_curl_from, v_curl_into\)/.test(sql), 'and the incline curl pair is merged');
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
