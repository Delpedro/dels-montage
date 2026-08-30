// C13 + C14 — the stale draft, one layer down from C12.
//
// C12 was the draft outranking the template on ORDER. These two are the same draft outranking the
// same template on MEMBERSHIP and on SET COUNT, and both show up the moment the ✎ link's other two
// promises — "add / remove exercises for this session" — are used from inside a live session:
//
//   C13  delete an exercise in the editor mid-session and it came straight back. `openExercises` is
//        a flat list of names, so a name in it that the fresh template no longer has could equally
//        be today's one-off Add Exercise (must come back) or a template exercise just removed (must
//        not). It was re-added either way.
//   C14  change a set count in the editor mid-session and the old number was pinned back over it,
//        because `openSetCounts` was applied over the fresh template unconditionally.
//
// The fix is one stamp: saveDraft records the template as it stood when the draft was written, so
// the read side can tell the draft's own doing from the template's. These cases run the real
// reconciliation and assert the exercise list and set counts it produces — not that it ran.
//
// Run: node tests/draft-template-stamp.test.js

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

const app = load({ functions: ['reconcileDraftAgainstTemplate'] });

// The template as buildWorkoutLogger receives it: a fresh clone, straight off SESSIONS.
const tpl = spec => spec.map(([name, sets]) => ({ name, sets }));
const stampOf = spec => Object.fromEntries(spec);

// What buildWorkoutLogger ends up with, given the reconciliation's two answers. Mirrors the four
// lines at the call site so a case can be read as "this is what is on screen".
function screen(exercises, merged) {
  const out = exercises.map(e => ({ ...e }));
  merged.add.forEach(name => out.push({ name, sets: 3 }));   // library default, as the caller does
  out.forEach(e => { if (merged.sets[e.name]) e.sets = merged.sets[e.name]; });
  return out.map(e => `${e.name}×${e.sets}`);
}

const UPPER_1 = [['Incline Smith', 4], ['Machine Chest Press', 3], ['Smith Shoulder Press', 3],
  ['Lat Pulldown', 3]];

// ═══════════════════════════════════════════════════════════════════════════
console.log('  C13 — an exercise deleted in the editor stays deleted');
// ═══════════════════════════════════════════════════════════════════════════
{
  // Mid-session: the draft was written while the template still had Lat Pulldown. Del then opened
  // the ✎ editor and removed it, so the fresh template is one shorter.
  const before = UPPER_1;
  const after = UPPER_1.filter(([n]) => n !== 'Lat Pulldown');
  const draftNames = before.map(([n]) => n);

  const merged = app.reconcileDraftAgainstTemplate(tpl(after), draftNames, {}, stampOf(before));
  deep(merged.add, [], 'the exercise Del just deleted is not resurrected');
  deep(screen(tpl(after), merged),
    ['Incline Smith×4', 'Machine Chest Press×3', 'Smith Shoulder Press×3'],
    'and the logger rebuilds without it');
}

{
  // The other half of the same list, and the reason it could not simply be ignored: a today-only
  // Add Exercise is also a name the template does not have, and it MUST come back after a refresh.
  const draftNames = [...UPPER_1.map(([n]) => n), 'Face Pull'];
  const merged = app.reconcileDraftAgainstTemplate(tpl(UPPER_1), draftNames, { 'Face Pull': 4 },
    stampOf(UPPER_1));
  deep(merged.add, ['Face Pull'], "today's one-off add is still today's, and comes back");
  deep(screen(tpl(UPPER_1), merged),
    ['Incline Smith×4', 'Machine Chest Press×3', 'Smith Shoulder Press×3', 'Lat Pulldown×3',
     'Face Pull×4'],
    'with the rows it had when it was added, not the library default');
}

{
  // Both at once — a delete in the editor and an add on the day — which is the case the flat list
  // could never answer.
  const after = UPPER_1.filter(([n]) => n !== 'Machine Chest Press');
  const draftNames = [...UPPER_1.map(([n]) => n), 'Face Pull'];
  const merged = app.reconcileDraftAgainstTemplate(tpl(after), draftNames, {}, stampOf(UPPER_1));
  deep(merged.add, ['Face Pull'], 'the added one comes back and the removed one does not');
}

{
  // An exercise ADDED to the template in the editor arrives in the fresh list and must not be
  // duplicated by the draft, and a duplicate inside the draft itself must not double it either.
  const after = [...UPPER_1, ['Face Pull', 3]];
  const merged = app.reconcileDraftAgainstTemplate(tpl(after),
    ['Face Pull', 'Face Pull', 'Rear Delt Fly', 'Rear Delt Fly'], {}, stampOf(UPPER_1));
  deep(merged.add, ['Rear Delt Fly'], 'nothing is added twice');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('  C14 — a set count changed in the editor stays changed');
// ═══════════════════════════════════════════════════════════════════════════
{
  // Del changes Incline Smith from 4 sets to 5 in the ✎ editor, mid-session. The draft still says 4.
  const after = [['Incline Smith', 5], ...UPPER_1.slice(1)];
  const counts = { 'Incline Smith': 4, 'Machine Chest Press': 3 };
  const merged = app.reconcileDraftAgainstTemplate(tpl(after), UPPER_1.map(([n]) => n), counts,
    stampOf(UPPER_1));
  eq(merged.sets['Incline Smith'], undefined, 'the draft does not get to pin the old count');
  deep(screen(tpl(after), merged),
    ['Incline Smith×5', 'Machine Chest Press×3', 'Smith Shoulder Press×3', 'Lat Pulldown×3'],
    'the five sets Del just asked for are the five sets on screen');
}

{
  // And the half that must survive: a today-only −/+ on the sets pill, with the editor never
  // opened. The draft is the only record of it, so it still wins.
  const counts = { 'Machine Chest Press': 5 };
  const merged = app.reconcileDraftAgainstTemplate(tpl(UPPER_1), UPPER_1.map(([n]) => n), counts,
    stampOf(UPPER_1));
  deep(screen(tpl(UPPER_1), merged),
    ['Incline Smith×4', 'Machine Chest Press×5', 'Smith Shoulder Press×3', 'Lat Pulldown×3'],
    "a row added on the day survives a refresh, which is what openSetCounts is for");
}

{
  // Both, on different exercises, in one rebuild.
  const after = [['Incline Smith', 6], ...UPPER_1.slice(1)];
  const counts = { 'Incline Smith': 4, 'Lat Pulldown': 5 };
  const merged = app.reconcileDraftAgainstTemplate(tpl(after), UPPER_1.map(([n]) => n), counts,
    stampOf(UPPER_1));
  deep(screen(tpl(after), merged),
    ['Incline Smith×6', 'Machine Chest Press×3', 'Smith Shoulder Press×3', 'Lat Pulldown×5'],
    'the editor wins where it was used, the draft wins where it was not');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('  the cases that must not change');
// ═══════════════════════════════════════════════════════════════════════════
{
  // A plain mid-session browser refresh, nobody having edited anything: the draft is the whole
  // truth and every part of it is restored.
  const counts = { 'Incline Smith': 4, 'Machine Chest Press': 4 };
  const merged = app.reconcileDraftAgainstTemplate(tpl(UPPER_1),
    [...UPPER_1.map(([n]) => n), 'Face Pull'], { ...counts, 'Face Pull': 2 }, stampOf(UPPER_1));
  deep(screen(tpl(UPPER_1), merged),
    ['Incline Smith×4', 'Machine Chest Press×4', 'Smith Shoulder Press×3', 'Lat Pulldown×3',
     'Face Pull×2'],
    'a refresh with no edits behind it restores exactly what was on screen');
}

{
  // A draft written by the build BEFORE this one is still inside its 24h life and has no stamp.
  // With nothing to compare against, the only safe answer is the behaviour that shipped — restore
  // everything — which is also what Open Workout gets, since it has no template to stamp.
  const after = UPPER_1.filter(([n]) => n !== 'Lat Pulldown');
  const merged = app.reconcileDraftAgainstTemplate(tpl(after), UPPER_1.map(([n]) => n),
    { 'Incline Smith': 5 }, null);
  deep(merged.add, ['Lat Pulldown'], 'an unstamped draft behaves exactly as it did before');
  eq(merged.sets['Incline Smith'], 5, 'and its set counts are applied unconditionally');

  const open = app.reconcileDraftAgainstTemplate([], ['Squat', 'Bench'], { Squat: 5 }, null);
  deep(open.add, ['Squat', 'Bench'], 'Open Workout still builds its whole list from the draft');
  eq(open.sets.Squat, 5, 'set counts and all');
}

{
  // No draft at all — the first entry into a session. The template is untouched.
  const merged = app.reconcileDraftAgainstTemplate(tpl(UPPER_1), [], {}, null);
  deep(merged.add, [], 'nothing to add');
  deep(screen(tpl(UPPER_1), merged),
    ['Incline Smith×4', 'Machine Chest Press×3', 'Smith Shoulder Press×3', 'Lat Pulldown×3'],
    'and the template arrives as written');

  // The input list is read, never mutated — the caller is holding the live clone.
  const exercises = tpl(UPPER_1);
  app.reconcileDraftAgainstTemplate(exercises, ['Face Pull'], { 'Incline Smith': 9 }, null);
  deep(exercises.map(e => `${e.name}×${e.sets}`),
    ['Incline Smith×4', 'Machine Chest Press×3', 'Smith Shoulder Press×3', 'Lat Pulldown×3'],
    'and nothing was written back into it');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('  what saveDraft actually writes');
// ═══════════════════════════════════════════════════════════════════════════
{
  // The half above is worthless if the stamp is taken from the wrong list. It has to be the LIVE
  // template — SESSIONS — and not selectedSession, which already carries today's add, today's
  // removal and today's −/+ adjustments: stamping that would mark a today-only add as a template
  // exercise, and the next rebuild would refuse to bring it back. This runs the real saveDraft and
  // reads the stamp back out of the store it wrote.
  const store = {};
  const draft = load({
    functions: ['saveDraft', 'getSessionById'],
    decls: ['selectedSession', 'selectedVariations', 'previousSets', 'pendingRest',
            'removedSessionExercises', 'supersetGroups', 'supersetBaseOrder', 'sessionOrderToday',
            'SESSIONS'],
    deps: {
      document: { getElementById: () => null, querySelectorAll: () => [] },
      localStorage: {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; },
      },
      CARDIO_ACTIVITIES: {},
    },
    accessors: {
      setUp: '(sessions, live) => { SESSIONS = sessions; selectedSession = live; }',
    },
  });

  // The template has four exercises at their template counts; the session on screen has lost one to
  // the ✕ button, gained a one-off Face Pull, and has a fifth row added to Incline Smith.
  draft.setUp(
    [{ id: 'upper-1', exercises: tpl(UPPER_1) }],
    { id: 'upper-1', exercises: tpl([['Incline Smith', 5], ['Machine Chest Press', 3],
      ['Smith Shoulder Press', 3], ['Face Pull', 3]]) });
  draft.saveDraft('upper-1');
  const written = JSON.parse(store.workout_draft);

  deep(written.templateStamp, { 'Incline Smith': 4, 'Machine Chest Press': 3,
    'Smith Shoulder Press': 3, 'Lat Pulldown': 3 },
    'the stamp is the template as it stands, not the session on screen');
  ok(!('Face Pull' in written.templateStamp), "today's add is absent from the stamp, so it comes back");
  ok('Lat Pulldown' in written.templateStamp, "today's X removal is still stamped — the template still has it");
  deep(written.openExercises, ['Incline Smith', 'Machine Chest Press', 'Smith Shoulder Press', 'Face Pull'],
    'while openExercises stays what it always was — the screen');
  eq(written.openSetCounts['Incline Smith'], 5, 'and openSetCounts still records the row added today');

  // Fed straight back in, the pair reproduce the screen they were taken from.
  const merged = app.reconcileDraftAgainstTemplate(tpl(UPPER_1), written.openExercises,
    written.openSetCounts, written.templateStamp);
  deep(merged.add, ['Face Pull'], 'a round trip through localStorage brings back exactly the add');
  eq(merged.sets['Incline Smith'], 5, 'and exactly the extra row');

  // Open Workout has no template row, so it is stamped with nothing at all.
  draft.setUp([], { id: 'open', exercises: tpl([['Squat', 3]]) });
  draft.saveDraft('open');
  eq(JSON.parse(store.workout_draft).templateStamp, undefined, 'Open Workout gets no stamp');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
