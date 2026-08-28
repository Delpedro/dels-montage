// C4 · A workout with no sets had nothing to backfill (27 August 2026).
//
// The History edit modal builds its form from `workout_sets` and nothing else. That rule is
// deliberate and load-bearing: a fixed session's template can be reordered, added to and resized in
// the Session Template Editor long after the fact, so building an old workout's form from the LIVE
// template made it appear — and, on save, actually become — whatever the template looks like now
// instead of what was really done.
//
// But a workout with ZERO sets has nothing that can be rewritten. Del's own Week 1 is four of them:
// sessions backfilled retrospectively on 13 Jul with no set data at all (they survive the ghost
// filter because they carry notes). Opening the modal that exists to backfill them showed him an
// empty panel.
//
// So: the template fallback is allowed for a zero-set workout and ONLY for a zero-set workout, and
// this file pins BOTH halves. The second half is the important one — a test that only proved the
// fallback works would let someone widen it to "the reconstruction came back short" and quietly
// reintroduce the bug the original rule was written for.
//
// Run: node tests/edit-zero-set-workout.test.js

const { load } = require('./extract');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  console.error('  FAIL: ' + label);
}
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return; }
  fail++;
  console.error('  FAIL: ' + label);
  console.error('    expected: ' + JSON.stringify(expected));
  console.error('    actual:   ' + JSON.stringify(actual));
}

const UPPER_A = {
  id: 'upper-a',
  name: 'Upper A',
  exercises: [
    { name: 'Smith Incline Press', sets: 4, reps: '8–12', rest: '90s' },
    { name: 'Lat Pulldown',        sets: 3, reps: '10–12', rest: '75s' },
  ],
};

// The DOM the modal touches. Only innerHTML on #edit-workout-sets is read back — everything else
// exists so the function can run.
function harness({ row }) {
  const els = {};
  const el = id => (els[id] ||= {
    id, innerHTML: '', textContent: '', value: '', style: {},
    appendChild() {}, remove() {},
  });
  ['edit-workout-title', 'edit-workout-notes', 'edit-cardio-list',
   'edit-cardio-activity-select', 'edit-workout-sets', 'edit-workout-modal'].forEach(el);

  const app = load({
    functions: ['openEditWorkout', 'editFormSession', 'reconstructSessionFromSets', 'esc', 'jsAttr',
                'isTimed', 'isOptionalWeight', 'timedTarget', 'catalogueKey'],
    decls: ['SESSIONS', 'EXERCISE_LIBRARY', 'editingWorkoutId', 'editingSessionType',
            'editSelectedVariations', 'editCardioEntries', 'editCardioCounter',
            'editRemovedCardioIds', 'TIMED_EXERCISES', 'OPTIONAL_WEIGHT_EXERCISES',
            'CARDIO_ACTIVITIES', 'CATALOGUE_BY_KEY'],
    deps: {
      sb: async () => [row],
      sessionDisplayName: id => id,
      cardioDisplayName: a => a,
      renderCardioBlock: () => '<div></div>',
      setValueLabel: () => '—',
      bwCellHtml: id => `<div id="${id}">BW</div>`,
      document: { getElementById: id => els[id] || null, createElement: () => el('scratch') },
    },
    accessors: { setSessions: '(s) => { SESSIONS = s; }' },
  });

  return { app, form: () => els['edit-workout-sets'].innerHTML, els };
}

async function main() {
  console.log('C4 — the zero-set workout');

  // ── A backfilled session with no sets gets the template's exercises ─────────────────────────
  {
    const h = harness({
      row: { id: 'w1', cardio_logs: [], workout_sets: [] },
    });
    h.app.setSessions([UPPER_A]);

    await h.app.openEditWorkout('w1', 'upper-a', 'backfilled from the notebook');
    const html = h.form();

    ok(html.includes('Smith Incline Press'), 'the template s exercises appear');
    ok(html.includes('Lat Pulldown'), 'all of them, not just the first');
    eq((html.match(/class="set-row"/g) || []).length, 7,
      'and one row per programmed set — 4 + 3, so there is somewhere to type every set of the session');
    ok(html.includes('id="er-Smith Incline Press-4"'), 'the fourth set of a 4-set lift is reachable');
    ok(!html.includes('No sets were logged'), 'the empty-state line is not shown when there is a template');
  }

  // ── C3 (28 Aug 2026): the modal shows which lifts were run as a pair ────────────────────────
  //
  // Not part of C4, but it is this modal and this function. Two sources, and which one is right
  // depends on whether there are sets — see the comment on ssGroup in openEditWorkout().
  {
    const h = harness({
      row: {
        id: 'w5',
        cardio_logs: [],
        workout_sets: [
          { exercise: 'Smith Incline Press', set_number: 1, weight: '60', reps: '10' },
          { exercise: 'Smith Incline Press', set_number: 2, weight: '60', reps: '9', superset_group: '2' },
          { exercise: 'Lat Pulldown', set_number: 1, weight: '50', reps: '12', superset_group: '2' },
        ],
      },
    });
    h.app.setSessions([UPPER_A]);

    await h.app.openEditWorkout('w5', 'upper-a', '');
    const html = h.form();

    eq((html.match(/class="pf-ss"/g) || []).length, 2, 'both lifts of the pair are marked');
    ok(html.includes('s/s 2'), 'with the tag the workout actually recorded, not a re-numbered one');
    eq((html.match(/exercise-block in-superset/g) || []).length, 2,
      'and each block takes the logger own blue edge, so the pairing reads without being read');
  }

  // A workout with NO sets is drawn from the template by design, so the template pairing is the
  // only record of it there is — and the only honest thing to show.
  {
    const h = harness({ row: { id: 'w6', cardio_logs: [], workout_sets: [] } });
    h.app.setSessions([{
      ...UPPER_A,
      exercises: [
        { ...UPPER_A.exercises[0], supersetGroup: '1' },
        { ...UPPER_A.exercises[1], supersetGroup: '1' },
      ],
    }]);

    await h.app.openEditWorkout('w6', 'upper-a', 'backfilled');
    eq((h.form().match(/class="pf-ss"/g) || []).length, 2,
      'a backfill form shows the template pairing');
  }

  // ⚠️ And the direction that must NOT reverse: a workout WITH sets is described by its own rows.
  // The template can be re-paired after the fact, exactly as it can be reordered and resized.
  {
    const h = harness({
      row: { id: 'w7', cardio_logs: [],
             workout_sets: [{ exercise: 'Smith Incline Press', set_number: 1, weight: '60', reps: '10' }] },
    });
    h.app.setSessions([{
      ...UPPER_A,
      exercises: [{ ...UPPER_A.exercises[0], supersetGroup: '9' },
                  { ...UPPER_A.exercises[1], supersetGroup: '9' }],
    }]);

    await h.app.openEditWorkout('w7', 'upper-a', '');
    ok(!h.form().includes('pf-ss'),
      'a pairing added to the template SINCE cannot appear on a session that was logged solo');
  }

  // ── The rule it must NOT relax: a workout that logged sets ignores the template ──────────────
  {
    const h = harness({
      row: {
        id: 'w2',
        cardio_logs: [],
        // What was ACTUALLY done that day: one lift, two sets — and a lift the current template no
        // longer contains, which is exactly the case the original rule was written for.
        workout_sets: [
          { exercise: 'Machine Chest Press', set_number: 1, weight: '40', reps: '10' },
          { exercise: 'Machine Chest Press', set_number: 2, weight: '40', reps: '9' },
        ],
      },
    });
    h.app.setSessions([UPPER_A]);

    await h.app.openEditWorkout('w2', 'upper-a', '');
    const html = h.form();

    ok(html.includes('Machine Chest Press'), 'the form is built from what was logged');
    ok(!html.includes('Smith Incline Press'), 'the live template does NOT get to add exercises to a workout that has sets');
    ok(!html.includes('Lat Pulldown'), 'not one of them');
    eq((html.match(/class="set-row"/g) || []).length, 2,
      'and the set count is what was done, not what the template now says');
  }

  // ── Open Workout has no template, so say so rather than showing a blank panel ────────────────
  {
    const h = harness({ row: { id: 'w3', cardio_logs: [], workout_sets: [] } });
    h.app.setSessions([UPPER_A]);

    await h.app.openEditWorkout('w3', 'open', 'walked 5k');
    const html = h.form();

    ok(html.includes('No sets were logged'), 'an explanation, not an empty panel that reads as a failed load');
    ok(html.includes('notes and cardio above are still editable'), 'and it points at what CAN still be edited');
  }

  // ── A session type the template list has never heard of behaves the same way ─────────────────
  {
    const h = harness({ row: { id: 'w4', cardio_logs: [], workout_sets: [] } });
    h.app.setSessions([]);   // templates not loaded yet, or a session since deleted

    await h.app.openEditWorkout('w4', 'upper-a', 'note');
    ok(h.form().includes('No sets were logged'), 'no template found is not a crash and not a blank');
  }

  // ── And the half that actually matters: what Del types into it has to SAVE ──────────────────
  //
  // saveEditWorkout() walks exercises and set numbers looking for the boxes the form rendered. It
  // rebuilt that list from the sets in the database — which for a zero-set workout is empty — so
  // before this change every box in the new backfill form was written into and then dropped on the
  // floor, with "Workout updated!" on top. The form and the save now share editFormSession().
  {
    const writes = [];
    const boxes = {
      'ew-Smith Incline Press-1': { tagName: 'INPUT', value: '60' },
      'er-Smith Incline Press-1': { tagName: 'INPUT', value: '10' },
      'ew-Lat Pulldown-1':        { tagName: 'INPUT', value: '50' },
      'er-Lat Pulldown-1':        { tagName: 'INPUT', value: '12' },
      'edit-workout-notes':       { tagName: 'TEXTAREA', value: 'backfilled from the notebook' },
    };
    const app = load({
      functions: ['saveEditWorkout', 'editFormSession', 'reconstructSessionFromSets',
                  'isTimed', 'isOptionalWeight', 'optionalWeightValue', 'timedTarget', 'catalogueKey'],
      decls: ['SESSIONS', 'EXERCISE_LIBRARY', 'editingWorkoutId', 'editingSessionType',
              'editSelectedVariations', 'editCardioEntries', 'editRemovedCardioIds',
              'TIMED_EXERCISES', 'OPTIONAL_WEIGHT_EXERCISES', 'CARDIO_ACTIVITIES',
              'CARDIO_ALL_COLUMNS', 'CATALOGUE_BY_KEY'],
      deps: {
        sb: async (pathStr, method = 'GET', body = null) => {
          writes.push({ method, path: pathStr, body });
          if (method === 'GET') return [];            // the workout has no sets yet
          return { ok: true, status: 204 };
        },
        showToast: () => {},
        closeEditWorkout: () => {},
        loadHistory: () => {},
        document: { getElementById: id => boxes[id] || null },
      },
      accessors: { setup: '(s, id, type) => { SESSIONS = s; editingWorkoutId = id; editingSessionType = type; }' },
    });
    app.setup([UPPER_A], 'w5', 'upper-a');

    await app.saveEditWorkout();

    const posts = writes.filter(w => w.method === 'POST' && w.path === 'workout_sets');
    eq(posts.length, 2, 'both filled-in sets are written — this is the whole point of the backfill');
    eq(posts[0].body.exercise, 'Smith Incline Press', 'under the exercise the box belonged to');
    eq(posts[0].body.reps, 10, 'with the reps typed');
    eq(posts[0].body.weight, 60, 'and the weight typed, as a number — optionalWeightValue() parses it');
    eq(posts[0].body.workout_id, 'w5', 'against the workout being edited');
    eq(posts[1].body.exercise, 'Lat Pulldown', 'and the second lift too');

    // Empty boxes are still skipped — a backfill form is 7 boxes and Del may fill in three.
    ok(!posts.some(w => w.body.reps == null && w.body.weight == null), 'blank sets are not written as empty rows');
  }

  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
