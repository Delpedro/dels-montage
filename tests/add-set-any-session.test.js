// + Add Set / − Remove Set belong to every session, not just Open Workout.
//
// The gap this covers (18 Aug 2026 ruling, built 21 Aug): Del already does an untracked 3.5kg
// to-failure set after his machine lateral raises, and on 21 Aug he cut Tricep Pushdown from three
// sets to two because the session ran long. Neither could be recorded — a fixed session rendered
// exactly `ex.sets` rows and offered no way to change that, so extra volume vanished and a cut set
// could only show up as a blank row. That matters beyond tidiness: the volume question hanging over
// Upper 1 is decided off logged sets, and sets the app refuses to hold are sets the decision cannot
// see.
//
// The half-fix that would have broken things quietly: renderSetRow bakes the session id into every
// input's oninput="saveDraft(<id>)", and both handlers hardcoded 'open'. Un-gating the buttons
// without threading the real id through means typing into an added row on Upper 1 writes the draft
// under sessionId 'open' — and peekDraft*/restoreDraft reject a mismatched id, so a mid-session
// refresh silently bins every set typed so far. Assertions 2/3/5 below are that bug, not polish.
//
// Run: node tests/add-set-any-session.test.js

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

// ── harness ────────────────────────────────────────────────────────────────
// Only the DOM the two handlers actually touch: the controls div they insert before, the sets pill
// they retitle, and (for remove) the row + rest line they delete. `createElement('div')` hands back
// a wrapper whose innerHTML is captured so the appended row's HTML can be asserted; firstChild
// stays null so the transfer loop is a no-op.
function harness({ sessionId, exercise = 'Lateral Raise', sets = 4 }) {
  const savedWith = [];
  const removedIds = [];
  let lastAppended = '';

  const els = {};
  els[`set-controls-${exercise}`] = { parentNode: { insertBefore: () => {} } };
  els[`sets-pill-${exercise}`] = { textContent: `${sets} sets` };
  const rowEl = i => ({ closest: () => ({ remove: () => removedIds.push(`row-${i}`) }) });

  const deps = {
    document: {
      createElement: () => {
        const w = { firstChild: null };
        Object.defineProperty(w, 'innerHTML', { set: v => { lastAppended = v; }, get: () => lastAppended });
        return w;
      },
      getElementById: id => {
        if (els[id]) return els[id];
        const m = /^w-(.+)-(\d+)$/.exec(id);
        if (m) return rowEl(m[2]);
        if (/^rest-/.test(id)) return { remove: () => removedIds.push(id) };
        return null;
      },
    },
    saveDraft: id => savedWith.push(id),
    // Everything renderExerciseBlock leans on that this test is not about.
    isTimed: () => false,
    looksLikeSeconds: () => false,
    timedTarget: () => '',
    swParseRest: () => 90,
    renderSupersetControl: () => '',
    setValueLabel: () => '',
    isOptionalWeight: () => false,
    bwCellHtml: () => '',
  };

  const api = load({
    functions: ['esc', 'jsAttr', 'prevSetsForVariation', 'renderSetRow', 'renderExerciseBlock',
                'addOpenSetRow', 'removeOpenSetRow'],
    decls: ['selectedSession', 'selectedVariations', 'previousSets'],
    deps,
    accessors: {
      // Stands in for buildWorkoutLogger, which sets these before any row is rendered.
      begin: '(s) => { selectedSession = s; selectedVariations = {}; previousSets = {}; }',
      sets: '(name) => selectedSession.exercises.find(e => e.name === name).sets',
    },
  });

  const session = { id: sessionId, name: sessionId, exercises: [{ name: exercise, sets, reps: '10–15', rest: '60s' }] };
  api.begin(session);
  return { ...api, session, exercise, savedWith, removedIds, pill: els[`sets-pill-${exercise}`],
           appended: () => lastAppended };
}

console.log('+ Add Set / − Remove Set on any session');

// 1. The controls render on a fixed session, not only on Open Workout.
{
  const h = harness({ sessionId: 'upper1' });
  const html = h.renderExerciseBlock(h.session.exercises[0], h.session);
  ok(html.includes('addOpenSetRow('), 'fixed session renders + Add Set');
  ok(html.includes('removeOpenSetRow('), 'fixed session renders − Remove Set');

  const open = harness({ sessionId: 'open' });
  const openHtml = open.renderExerciseBlock(open.session.exercises[0], open.session);
  ok(openHtml.includes('addOpenSetRow('), 'Open Workout still renders + Add Set');
}

// 2. A fixed session's rows save the draft under that session's id — never 'open'.
{
  const h = harness({ sessionId: 'upper1' });
  const html = h.renderExerciseBlock(h.session.exercises[0], h.session);
  ok(html.includes("saveDraft('upper1')"), 'rendered rows save under the fixed session id');
  ok(!html.includes("saveDraft('open')"), "a fixed session never writes the draft under 'open'");
}

// 3. Adding a row: the count moves, the appended row carries the right id, the draft is saved once.
{
  const h = harness({ sessionId: 'upper1', sets: 4 });
  h.renderExerciseBlock(h.session.exercises[0], h.session);
  h.addOpenSetRow(h.exercise);

  eq(h.sets(h.exercise), 5, 'a fifth row is added');
  eq(h.pill.textContent, '5 sets', 'the sets pill follows');
  ok(h.appended().includes('id="w-Lateral Raise-5"'), 'the appended row is numbered 5');
  ok(h.appended().includes("saveDraft('upper1')"),
     "the appended row's inputs save under the fixed session id, not 'open'");
  eq(h.savedWith.length, 1, 'one draft save per added row');
  eq(h.savedWith[0], 'upper1', 'the draft is saved under the fixed session id');
}

// 4. Removing a row: the count moves back, the row and its rest line go, and one row is the floor.
{
  const h = harness({ sessionId: 'upper1', sets: 3 });
  h.renderExerciseBlock(h.session.exercises[0], h.session);
  h.removeOpenSetRow(h.exercise);

  eq(h.sets(h.exercise), 2, 'the third row is removed');
  eq(h.pill.textContent, '2 sets', 'the sets pill follows the removal');
  ok(h.removedIds.includes('row-3'), 'the set row itself is removed');
  ok(h.removedIds.includes('rest-Lateral Raise-3'), "the row's rest line goes with it");
  eq(h.savedWith[0], 'upper1', 'removal saves the draft under the fixed session id');

  h.removeOpenSetRow(h.exercise);
  h.removeOpenSetRow(h.exercise);
  eq(h.sets(h.exercise), 1, 'never drops below one row — use the ✕ to drop the exercise');
  eq(h.savedWith.length, 2, 'the refused removal does not touch the draft');
}

// 5. Open Workout is unchanged: its id is 'open', so that is what it still saves under.
{
  const h = harness({ sessionId: 'open', sets: 3 });
  h.renderExerciseBlock(h.session.exercises[0], h.session);
  h.addOpenSetRow(h.exercise);
  eq(h.savedWith[0], 'open', 'Open Workout still saves its draft under open');
  ok(h.appended().includes("saveDraft('open')"), "Open Workout's appended row still carries open");
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
