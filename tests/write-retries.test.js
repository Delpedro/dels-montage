// Retrying a failed save must not write the same thing twice, and must not destroy what the first
// attempt already recorded. Three fixes from 13 Aug 2026 (late), all from the Fable 5 post-auth
// review, all of the same family: the write paths were only ever exercised on the happy path.
//
//  1. saveWorkout() POSTed cardio and nothing else deleted it. A failure in a *later* step told you
//     to "tap Save Workout again" — and the retry wrote every cardio row a second time. Sets have
//     been delete-then-insert since the start; cardio never was.
//  2. saveExerciseSets() is delete-then-insert, so re-tapping Mark Done (how you fix a typo) binned
//     the rows holding that exercise's rest times and re-inserted them as 0. History's "avg rest"
//     silently went blank. Rest arrives two ways — buffered in pendingRest before the first Mark
//     Done, PATCHed onto the row after it — so only the DB has the full picture at re-save time.
//  3. saveConditioning() checked the conditioning_logs POST and nothing else, then overwrote any
//     error with "CV + Pump logged!". Nothing ever *reads* conditioning_logs, so a failed workouts
//     row meant the session vanished from History while the screen said it had saved.
//
// Run: node tests/write-retries.test.js

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
  eq(JSON.stringify(actual), JSON.stringify(expected), label);
}

const okRes = { ok: true, status: 200 };
const errRes = (status) => ({ ok: false, status });

// A no-op DOM: every element answers with empty values, so the functions under test walk their
// whole body without a browser. Individual tests override the ids they care about.
function fakeDoc(overrides = {}) {
  return {
    getElementById: (id) => overrides[id] ?? { value: '', style: {}, dataset: {}, tagName: 'INPUT' },
    querySelectorAll: () => [],
  };
}

// ── 1. mergeExistingRests — the pure half of the Mark Done fix ──────────────
{
  console.log('rest times survive a re-save');
  const { mergeExistingRests } = load({ functions: ['mergeExistingRests'] });

  const sets = [
    { set_number: 1, reps: 10, rest_seconds: 0 },
    { set_number: 2, reps: 9, rest_seconds: 0 },
    { set_number: 3, reps: 8, rest_seconds: 0 },
  ];
  const existing = [
    { set_number: 1, rest_seconds: 90 },
    { set_number: 2, rest_seconds: 120 },
    // set 3 was never rested — no row value to carry over
    { set_number: 3, rest_seconds: 0 },
  ];

  const merged = mergeExistingRests(sets, existing);
  deep(merged.map(s => s.rest_seconds), [90, 120, 0], 'recorded rests are carried onto the re-inserted rows');
  deep(sets.map(s => s.rest_seconds), [0, 0, 0], 'the input rows are not mutated');
  eq(merged[0].reps, 10, 'everything else on the row is preserved');

  // A rest recorded *this* attempt (still in pendingRest) is the newer number and must win.
  const withPending = mergeExistingRests(
    [{ set_number: 1, rest_seconds: 45 }],
    [{ set_number: 1, rest_seconds: 90 }]
  );
  eq(withPending[0].rest_seconds, 45, 'a rest collected this time beats the stored one');

  // PostgREST hands numerics back as strings often enough that this has bitten elsewhere.
  const stringy = mergeExistingRests([{ set_number: 1, rest_seconds: 0 }], [{ set_number: 1, rest_seconds: '75' }]);
  eq(stringy[0].rest_seconds, 75, 'a string rest_seconds from PostgREST is parsed, not concatenated');

  deep(mergeExistingRests([{ set_number: 1, rest_seconds: 0 }], []).map(s => s.rest_seconds), [0],
    'no existing rows — nothing to merge, sets pass through');
  deep(mergeExistingRests([{ set_number: 1, rest_seconds: 0 }], null).map(s => s.rest_seconds), [0],
    'a failed GET returns [] / null and must not throw');
  deep(mergeExistingRests([{ set_number: 1, rest_seconds: 0 }], [{ set_number: 1, rest_seconds: null }])
    .map(s => s.rest_seconds), [0], 'a null rest_seconds is not treated as a value');

  // Set numbers don't have to line up: a re-save with fewer sets keeps the rests of the ones it kept.
  const fewer = mergeExistingRests(
    [{ set_number: 2, rest_seconds: 0 }],
    [{ set_number: 1, rest_seconds: 60 }, { set_number: 2, rest_seconds: 95 }]
  );
  deep(fewer.map(s => s.rest_seconds), [95], 'rests are matched by set number, not by position');
}

// ── 2. saveExerciseSets — reads before it deletes ───────────────────────────
(async () => {
  console.log('saveExerciseSets order of operations');

  function build(responses) {
    const calls = [];
    const api = load({
      functions: ['mergeExistingRests', 'saveExerciseSets'],
      decls: ['currentWorkoutId'],
      deps: {
        sb: async (path, method = 'GET', body = null) => {
          calls.push({ path, method, body });
          return responses(path, method, calls.length);
        },
      },
      accessors: { setWorkoutId: '(v) => { currentWorkoutId = v; }' },
    });
    api.setWorkoutId('w-1');
    return { ...api, calls };
  }

  {
    const h = build((path, method) => {
      if (method === 'GET') return [{ set_number: 1, rest_seconds: 90 }];
      return okRes;
    });
    const failed = await h.saveExerciseSets('Leg Press', [{ set_number: 1, reps: 10, rest_seconds: 0 }]);
    eq(failed, null, 'a clean save reports no failure');
    eq(h.calls.length, 3, 'three calls: read, delete, insert');
    eq(h.calls[0].method, 'GET', 'the existing rows are read FIRST — after the DELETE they are gone');
    eq(h.calls[1].method, 'DELETE', 'then the delete');
    eq(h.calls[2].method, 'POST', 'then the insert');
    ok(h.calls[0].path.includes('select=set_number,rest_seconds'), 'the read asks only for what the merge needs');
    ok(h.calls[0].path.includes('workout_id=eq.w-1'), 'scoped to this workout');
    ok(h.calls[0].path.includes('exercise=eq.Leg%20Press'), 'and to this exercise, URL-encoded');
    eq(h.calls[2].body[0].rest_seconds, 90, 'the row that gets inserted carries the recovered rest');
  }

  {
    // The whole point of the guard: a lost rest must never stop the sets themselves being written.
    const h = build((path, method) => (method === 'GET' ? [] : okRes));
    const failed = await h.saveExerciseSets('Dips', [{ set_number: 1, reps: 12, rest_seconds: 0 }]);
    eq(failed, null, 'a failed read (which returns []) still saves the sets');
    eq(h.calls[2].body[0].rest_seconds, 0, 'with no rest to recover');
  }

  {
    const h = build((path, method) => (method === 'GET' ? [] : method === 'DELETE' ? errRes(503) : okRes));
    eq(await h.saveExerciseSets('Dips', [{ set_number: 1 }]), 503, 'a failed delete reports its status and stops');
    eq(h.calls.length, 2, 'and never reaches the insert');
  }

  {
    const h = build((path, method) => (method === 'GET' ? [] : method === 'POST' ? errRes(400) : okRes));
    eq(await h.saveExerciseSets('Dips', [{ set_number: 1 }]), 400, 'a failed insert reports its status');
  }
})();

// ── 3. saveWorkout — the cardio retry ───────────────────────────────────────
(async () => {
  console.log('Save Workout retry does not duplicate cardio');

  function build({ cardioRows, sbImpl }) {
    const calls = [];
    const toasts = [];
    const api = load({
      functions: ['saveWorkout'],
      decls: ['selectedSession', 'selectedProgramme', 'currentWorkoutId', 'currentWorkoutHasSets',
              'supersetGroups', 'supersetBaseOrder', 'supersetsTouched'],
      deps: {
        document: fakeDoc(),
        confirm: () => true,
        collectCardioRows: () => cardioRows,
        sb: async (path, method = 'GET', body = null) => {
          calls.push({ path, method, body });
          return sbImpl(path, method, calls.length);
        },
        showToast: (msg, type) => toasts.push({ msg, type }),
        persistSupersetGroups: async () => {},
        supersetGroupMap: () => ({}),
        offerSaveOpenAsTemplate: async () => {},
        buildSessionGrid: () => {},
        showWorkoutView: () => {},
        localStorage: { removeItem: () => {} },
      },
      accessors: {
        start: `() => { selectedSession = { id: 'lower-a', exercises: [], cardioEntries: [{ id: 1 }] }; currentWorkoutId = 'w-9'; }`,
        session: '() => selectedSession',
      },
    });
    api.start();
    return { ...api, calls, toasts };
  }

  const cardio = [{ workout_id: 'w-9', activity: 'Treadmill', duration_mins: 20 }];

  {
    const h = build({ cardioRows: cardio, sbImpl: () => okRes });
    await h.saveWorkout();
    const cardioCalls = h.calls.filter(c => c.path.startsWith('cardio_logs'));
    eq(cardioCalls.length, 2, 'cardio is written as a delete then an insert');
    eq(cardioCalls[0].method, 'DELETE', 'the delete comes first');
    ok(cardioCalls[0].path.includes('workout_id=eq.w-9'), 'and clears only this workout\'s rows');
    eq(cardioCalls[1].method, 'POST', 'then the rows go in');
    eq(h.toasts[0].type, 'success', 'and the workout saves');
    eq(h.session(), null, 'the session is closed out');
  }

  {
    // The exact reported bug: the completion PATCH fails, the user taps Save Workout again.
    // Before the fix the second attempt POSTed the same cardio rows on top of the first attempt's.
    let attempt = 1;
    const h = build({
      cardioRows: cardio,
      sbImpl: (path, method) => (method === 'PATCH' && attempt === 1 ? errRes(500) : okRes),
    });
    await h.saveWorkout();
    ok(h.toasts[0].msg.includes('tap Save Workout again'), 'the first attempt fails and asks for a retry');
    eq(h.session() !== null, true, 'the session stays open so the retry is possible');

    attempt = 2;
    h.calls.length = 0;
    await h.saveWorkout();
    const posts = h.calls.filter(c => c.path === 'cardio_logs' && c.method === 'POST');
    const deletes = h.calls.filter(c => c.method === 'DELETE' && c.path.startsWith('cardio_logs'));
    eq(deletes.length, 1, 'the retry deletes the previous attempt\'s cardio rows first');
    eq(posts.length, 1, 'and writes exactly one copy — this is the duplicate that used to survive');
    eq(h.toasts[1].type, 'success', 'the retry completes the workout');
  }

  {
    const h = build({ cardioRows: cardio, sbImpl: (path, method) => (method === 'DELETE' ? errRes(503) : okRes) });
    await h.saveWorkout();
    ok(h.toasts[0].msg.includes('Cardio save failed (503)'), 'a failed cardio wipe is reported, not swallowed');
    eq(h.calls.filter(c => c.method === 'POST').length, 0, 'and nothing is inserted on top of rows that may still be there');
    eq(h.calls.filter(c => c.method === 'PATCH').length, 0, 'and the workout is not marked complete');
  }

  {
    // No cardio to write: the wipe must not run at all. On a resume the entries come from the draft,
    // so an unconditional delete could bin rows the UI has no way to re-post.
    const h = build({ cardioRows: [], sbImpl: () => okRes });
    await h.saveWorkout();
    eq(h.calls.filter(c => c.path.startsWith('cardio_logs')).length, 0, 'no cardio typed in — cardio_logs is left alone entirely');
  }
})();

// ── 4. saveConditioning — CV + Pump can no longer lie ───────────────────────
(async () => {
  console.log('CV + Pump reports partial failures');

  function build({ sbImpl, workoutId = 'cv-1' }) {
    const calls = [];
    const toasts = [];
    const created = [];
    const fields = {
      'cond-pump-focus': { value: 'Arms' },
      'cond-pump-method': { value: 'Drop sets' },
      'cond-activity': { value: 'Bike' },
      'cond-duration': { value: '25' },
      'cond-intensity': { value: 'Steady' },
      'cond-notes': { value: '' },
    };
    const api = load({
      functions: ['saveConditioning'],
      decls: ['conditioningWorkoutId', 'selectedSession', 'selectedProgramme'],
      deps: {
        document: fakeDoc(fields),
        sb: async (path, method = 'GET', body = null) => {
          calls.push({ path, method, body });
          return sbImpl(path, method, calls.length);
        },
        createWorkoutRow: async (type) => { created.push(type); return workoutId; },
        showToast: (msg, type) => toasts.push({ msg, type }),
        todayStr: () => '2026-08-13',
        buildSessionGrid: () => {},
        showWorkoutView: () => {},
      },
      accessors: { pendingId: '() => conditioningWorkoutId' },
    });
    return { ...api, calls, toasts, created };
  }

  {
    const h = build({ sbImpl: () => okRes });
    await h.saveConditioning();
    eq(h.calls[0].method, 'PATCH', 'the workouts row is completed first — the row History actually reads');
    ok(h.calls[0].path.includes('cv-1'), 'against the row that was just created');
    ok(h.calls[0].body.notes.includes('Pump: Arms'), 'carrying the summary, which is what makes it count as a real session');
    eq(h.calls[1].path, 'conditioning_logs', 'the conditioning record goes last, so every earlier step is retry-safe');
    eq(h.toasts[0].msg, 'CV + Pump logged!', 'and only then does it say it saved');
    eq(h.pendingId(), null, 'the reused workout id is cleared on success');
  }

  {
    // The bug: createWorkoutRow returning null was skipped in silence and the success toast fired
    // anyway, so the session vanished from History and every counter while looking saved.
    const h = build({ sbImpl: () => okRes, workoutId: null });
    await h.saveConditioning();
    eq(h.toasts.length, 1, 'exactly one toast');
    eq(h.toasts[0].type, 'error', 'no session row means NOT saved — it must not claim otherwise');
    eq(h.calls.length, 0, 'and nothing else is written');
  }

  {
    const h = build({ sbImpl: (path, method) => (method === 'PATCH' ? errRes(500) : okRes) });
    await h.saveConditioning();
    eq(h.toasts.length, 1, 'a failed completion PATCH is the last word');
    ok(h.toasts[0].msg.includes('NOT saved (500)'), 'and it says so with the status');
    eq(h.pendingId(), 'cv-1', 'the workout row is held for the retry rather than orphaned');
  }

  {
    const h = build({ sbImpl: (path) => (path === 'conditioning_logs' ? errRes(400) : okRes) });
    await h.saveConditioning();
    ok(h.toasts[0].msg.includes('Saved to History'), 'a failed conditioning_logs write says what DID land');
    eq(h.toasts[0].type, 'error', 'but is still an error, because a write failed');
  }

  {
    // Retrying must not leave a trail of empty in-progress workouts rows behind it.
    let attempt = 1;
    const h = build({ sbImpl: (path, method) => (method === 'PATCH' && attempt === 1 ? errRes(500) : okRes) });
    await h.saveConditioning();
    attempt = 2;
    await h.saveConditioning();
    eq(h.created.length, 1, 'the retry reuses the same workouts row — only one was ever created');
    eq(h.toasts[1].msg, 'CV + Pump logged!', 'and the retry succeeds');
  }
})();

// ── done ───────────────────────────────────────────────────────────────────
process.on('exit', () => {
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});
