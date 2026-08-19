// An empty workouts row is not an in-progress session (19 Aug 2026).
//
// A `workouts` row is created the instant a session tile is tapped. `backToSessions()` deletes it
// again when you leave through the back control — but nothing deletes it if you leave through the
// bottom nav, so the row sits there with `completed_at IS NULL` until autoCloseStaleWorkouts()
// reaches it 24 hours later.
//
// `beginWorkoutSession()` used to treat any such row as a live session, so on 19 Aug one stray tap
// on Open Workout at 15:10 made every session start for the rest of the day pop a native confirm —
// "You have an in-progress Open Workout session" — about a workout with nothing whatsoever in it.
// Del had trained Lower B that morning and finished it; the database agreed (22 sets, completed at
// 10:58) and the app argued anyway.
//
// The rule is now the counters' rule (`workoutRowHasContent` — sets, cardio or notes) plus the
// draft, because numbers typed and not yet Mark Done'd live only in localStorage and a session you
// are standing in the middle of can legitimately have no rows yet. A row failing both is a ghost:
// deleted on sight, no dialog.
//
// What makes this worth a test rather than a diff: the failure was invisible from the code. The old
// and the new version both read as "find today's unfinished workout", and only a row with its
// counts attached tells them apart. So every scenario below is about what is IN the row.
//
// Run: node tests/ghost-workout-row.test.js

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

const TODAY = '2026-08-19';

// `rows` is what the in-progress GET returns. `draft` is localStorage's workout_draft, or null.
function harness({ rows, draft = null }) {
  const requests = [];
  let confirms = 0;
  let confirmAnswer = true;
  let created = 0;

  const sb = async (pathStr, method = 'GET') => {
    requests.push(method + ' ' + pathStr);
    if (method === 'GET') return rows;
    return { ok: true, status: 204 };
  };

  const app = load({
    functions: ['workoutRowHasContent', 'draftHasContentFor', 'beginWorkoutSession'],
    decls: [
      'selectedSession', 'selectedVariations', 'removedSessionExercises',
      'supersetGroups', 'supersetBaseOrder', 'supersetsTouched',
      'currentWorkoutId', 'currentWorkoutHasSets',
    ],
    deps: {
      sb,
      todayStr: () => TODAY,
      sessionDisplayName: (id) => id,
      showToast: () => {},
      createWorkoutRow: async () => { created++; return 'new-' + created; },
      // askConfirm() replaced the native confirm() on 19 Aug and returns a promise. What this
      // test cares about is unchanged: how many times the app stopped to ask.
      askConfirm: async () => { confirms++; return confirmAnswer; },
      localStorage: { getItem: () => (draft ? JSON.stringify(draft) : null) },
    },
    accessors: {
      state: '() => ({ currentWorkoutId, currentWorkoutHasSets })',
    },
  });

  return {
    app,
    requests,
    deletes: () => requests.filter(r => r.startsWith('DELETE')),
    confirms: () => confirms,
    created: () => created,
    answerConfirm: (v) => { confirmAnswer = v; },
  };
}

const ghostOpen  = { id: 'ghost-1', session_type: 'open',    notes: '',          workout_sets: [],           cardio_logs: [] };
const realUpperA = { id: 'real-1',  session_type: 'upper-a', notes: '',          workout_sets: [{ id: 's1' }], cardio_logs: [] };
const notesOnly  = { id: 'cv-1',    session_type: 'open',    notes: 'CV + Pump', workout_sets: [],           cardio_logs: [] };
const cardioOnly = { id: 'cv-2',    session_type: 'open',    notes: '',          workout_sets: [],           cardio_logs: [{ id: 'c1' }] };
const lowerA = { id: 'lower-a', name: 'Lower A' };

const checks = [];

console.log('the ghost row that started this');

// ── 1. The actual 19 Aug bug ─────────────────────────────────────────────────
{
  const h = harness({ rows: [ghostOpen] });
  checks.push(h.app.beginWorkoutSession(lowerA).then(() => {
    eq(h.confirms(), 0, 'an empty Open Workout row raises no dialog');
    eq(h.deletes().length, 1, 'the ghost row is deleted');
    ok(h.deletes()[0].includes('ghost-1'), 'it deletes the right row');
    eq(h.created(), 1, 'a fresh row is created for the session actually tapped');
    eq(h.app.state().currentWorkoutId, 'new-1', 'the logger points at the new row');
    eq(h.app.state().currentWorkoutHasSets, false, 'the new row starts empty');
  }));
}

// ── 2. A genuinely in-progress OTHER session still warns ─────────────────────
{
  const h = harness({ rows: [realUpperA] });
  checks.push(h.app.beginWorkoutSession(lowerA).then(() => {
    eq(h.confirms(), 1, 'a session with sets in it still warns before being abandoned');
    eq(h.deletes().length, 0, 'and is never deleted');
  }));
}

// ── 3. Saying no to that warning starts nothing ──────────────────────────────
{
  const h = harness({ rows: [realUpperA] });
  h.answerConfirm(false);
  checks.push(h.app.beginWorkoutSession(lowerA).then(result => {
    eq(result, false, 'declining the warning returns false');
    eq(h.created(), 0, 'and creates no row');
  }));
}

// ── 4. Notes and cardio are content — CV + Pump has neither sets nor cardio ──
{
  const h = harness({ rows: [notesOnly] });
  checks.push(h.app.beginWorkoutSession(lowerA).then(() => {
    eq(h.confirms(), 1, 'a row carried only by its notes is real (CV + Pump)');
    eq(h.deletes().length, 0, 'and survives');
  }));
}
{
  const h = harness({ rows: [cardioOnly] });
  checks.push(h.app.beginWorkoutSession(lowerA).then(() => {
    eq(h.confirms(), 1, 'a row carried only by cardio is real');
    eq(h.deletes().length, 0, 'and survives');
  }));
}

// ── 5. The draft is the fourth kind of evidence ──────────────────────────────
// Numbers typed but not yet Mark Done'd exist only in localStorage. Deleting that row would be
// deleting the session the user is standing in.
{
  const h = harness({
    rows: [ghostOpen],
    draft: { sessionId: 'open', sets: { 'Bench-1': { w: '60', r: '10' } }, timestamp: Date.now() },
  });
  checks.push(h.app.beginWorkoutSession(lowerA).then(() => {
    eq(h.confirms(), 1, 'a row with no saved rows but a live draft still warns');
    eq(h.deletes().length, 0, 'and is not deleted');
  }));
}
{
  const h = harness({
    rows: [ghostOpen],
    draft: { sessionId: 'open', sets: {}, notes: '', cardio: [], timestamp: Date.now() },
  });
  checks.push(h.app.beginWorkoutSession(lowerA).then(() => {
    eq(h.confirms(), 0, 'an EMPTY draft is not evidence of a session');
    eq(h.deletes().length, 1, 'so the row is still a ghost');
  }));
}
{
  const stale = Date.now() - 25 * 60 * 60 * 1000;
  const h = harness({
    rows: [ghostOpen],
    draft: { sessionId: 'open', sets: { 'Bench-1': { w: '60' } }, timestamp: stale },
  });
  checks.push(h.app.beginWorkoutSession(lowerA).then(() => {
    eq(h.confirms(), 0, 'a draft past the 24h expiry restoreDraft() uses does not count');
    eq(h.deletes().length, 1, 'the row is a ghost again');
  }));
}
{
  const h = harness({
    rows: [ghostOpen],
    draft: { sessionId: 'lower-b', sets: { 'RDL-1': { w: '80' } }, timestamp: Date.now() },
  });
  checks.push(h.app.beginWorkoutSession(lowerA).then(() => {
    eq(h.confirms(), 0, 'a draft for a DIFFERENT session does not vouch for this row');
    eq(h.deletes().length, 1, 'the row is a ghost');
  }));
}

// ── 6. Resuming the same session — the case that must not regress ────────────
{
  const sameWithSets = { id: 'resume-1', session_type: 'lower-a', notes: '', workout_sets: [{ id: 's1' }], cardio_logs: [] };
  const h = harness({ rows: [sameWithSets] });
  checks.push(h.app.beginWorkoutSession(lowerA).then(() => {
    eq(h.confirms(), 0, 'tapping the session you are already in never asks');
    eq(h.app.state().currentWorkoutId, 'resume-1', 'it adopts the existing row');
    eq(h.app.state().currentWorkoutHasSets, true, 'and knows the row has sets, so backing out keeps it');
    eq(h.created(), 0, 'no second row is created');
    eq(h.deletes().length, 0, 'and nothing is deleted');
  }));
}
{
  // Tapped the tile, walked away, came back to the SAME session. Adopt it rather than churn a row —
  // but record that it is empty, so leaving again bins it instead of stranding another ghost.
  const sameEmpty = { id: 'resume-2', session_type: 'lower-a', notes: '', workout_sets: [], cardio_logs: [] };
  const h = harness({ rows: [sameEmpty] });
  checks.push(h.app.beginWorkoutSession(lowerA).then(() => {
    eq(h.confirms(), 0, 'an empty row for the same session is adopted silently');
    eq(h.app.state().currentWorkoutId, 'resume-2', 'reusing the row rather than posting another');
    eq(h.app.state().currentWorkoutHasSets, false, 'flagged empty, so backToSessions() will clean it up');
    eq(h.deletes().length, 0, 'it is not deleted out from under the session about to use it');
  }));
}

// ── 7. The row being resumed wins over an unrelated ghost ────────────────────
{
  const sameWithSets = { id: 'resume-3', session_type: 'lower-a', notes: '', workout_sets: [{ id: 's1' }], cardio_logs: [] };
  const h = harness({ rows: [ghostOpen, sameWithSets] });
  checks.push(h.app.beginWorkoutSession(lowerA).then(() => {
    eq(h.confirms(), 0, 'a ghost alongside the session being resumed does not trigger a dialog');
    eq(h.app.state().currentWorkoutId, 'resume-3', 'the right row is adopted regardless of GET order');
    eq(h.deletes().length, 1, 'and the ghost is swept up on the way past');
  }));
}

// ── 8. The GET has to carry the counts, or none of the above can work ────────
{
  const h = harness({ rows: [] });
  checks.push(h.app.beginWorkoutSession(lowerA).then(() => {
    const get = h.requests.find(r => r.startsWith('GET'));
    ok(get.includes('workout_sets(id)'), 'the in-progress GET embeds workout_sets');
    ok(get.includes('cardio_logs(id)'), 'the in-progress GET embeds cardio_logs');
    ok(get.includes('notes'), 'the in-progress GET selects notes');
    ok(get.includes('completed_at=is.null'), 'it still only looks at unfinished rows');
    eq(h.created(), 1, 'nothing open today means a straightforward new row');
  }));
}

Promise.all(checks).then(() => {
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
});
