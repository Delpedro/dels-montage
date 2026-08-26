// The variation toggle has to survive a refresh / resume.
//
// The bug this covers (found and fixed 13 Aug 2026): saveDraft() never stored
// `selectedVariations`, and the resume query in buildWorkoutLogger() left `variation` out of its
// select. So after a mid-session refresh the toggle snapped back to *last session's* variation —
// and every set logged after that point was written under the wrong one. That is worse than a
// display bug: `variation` is half the key History uses for per-exercise deltas and PR badges, so a
// Smith-machine press could be compared against a machine press and produce a nonsense delta. The
// 10 Aug redesign already had to fix exactly that class of mis-keying once.
//
// Run: node tests/variation-draft.test.js

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
  ok(actual === expected, `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── fake DOM ───────────────────────────────────────────────────────────────
// Just enough of an element for the code under test: a value, text, and a classList. The variation
// buttons live behind `#block-<name>`.querySelectorAll('.variation-toggle .var-btn'), matched by
// index, so the stub only has to return them in render order.
function makeEl(tagName) {
  const classes = new Set();
  return {
    tagName,
    value: '',
    textContent: '',
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
      toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : force; on ? classes.add(c) : classes.delete(c); return on; },
    },
  };
}

// Mirrors what renderExerciseBlock() actually emits: a block per exercise, one .var-btn per
// variation with the default already marked selected, a weight input (or a label for band work),
// a reps input and a prev badge per set.
function renderDom(session, defaults) {
  const els = {};
  session.exercises.forEach(ex => {
    const block = makeEl('DIV');
    const btns = (ex.variations || []).map(v => {
      const b = makeEl('BUTTON');
      b.textContent = v;
      if (v === defaults[ex.name]) b.classList.add('selected');
      return b;
    });
    block.querySelectorAll = sel => (sel === '.variation-toggle .var-btn' ? btns : []);
    block._btns = btns;
    els[`block-${ex.name}`] = block;
    for (let i = 1; i <= ex.sets; i++) {
      // Band exercises render the variation as a label in the weight column, not an input — the
      // same split renderSetRow() makes.
      els[`w-${ex.name}-${i}`] = makeEl(ex.band ? 'DIV' : 'INPUT');
      if (ex.band) els[`w-${ex.name}-${i}`].textContent = defaults[ex.name];
      els[`r-${ex.name}-${i}`] = makeEl('INPUT');
      els[`badge-${ex.name}-${i}`] = makeEl('DIV');
    }
  });
  els['workout-notes'] = makeEl('TEXTAREA');
  return els;
}

// ── fixture ────────────────────────────────────────────────────────────────
// Shoulder Press is the real three-way toggle from Upper A; Pallof Press is the real band exercise.
const SESSION = () => ({
  id: 'upper-a',
  name: 'Upper A',
  exercises: [
    { name: 'Shoulder Press', sets: 3, reps: '8-12', rest: '90s', variations: ['Machine', 'Smith', 'DB'] },
    { name: 'Pallof Press', sets: 3, reps: '15', rest: '60s', band: true, variations: ['Red', 'Black'] },
    { name: 'Lat Pulldown', sets: 3, reps: '10', rest: '90s' },
  ],
});

const PREVIOUS = {
  'Shoulder Press': [
    { weight: 40, reps: 10, variation: 'Machine' },
    { weight: 42, reps: 8, variation: 'Machine' },
    { weight: 20, reps: 10, variation: 'DB' },
  ],
};

function build({ session = SESSION(), defaults = { 'Shoulder Press': 'Machine', 'Pallof Press': 'Red' }, store = {} } = {}) {
  const els = renderDom(session, defaults);
  const painted = [];

  const deps = {
    document: {
      getElementById: id => els[id] || null,
      // bwSyncAll() sweeps every .bw-cell after a restore (see bwCellHtml in js/app.js). None of
      // this fixture is an optional-weight exercise, so the sweep finds nothing — but without the
      // method existing at all, restoreDraft throws halfway and every assertion below it fails
      // for a reason that has nothing to do with variations.
      querySelectorAll: () => [],
    },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    addCardioEntry: () => {},
    swPaintRestLine: (ex, set, secs) => painted.push({ ex, set, secs }),
    CARDIO_ACTIVITIES: {},
    setValueLabel: (ex, set) => (set ? `${set.weight}×${set.reps}` : ''),
  };

  const api = load({
    // bwSyncAll is extracted rather than stubbed: restoreDraft calls it, and a stub would hide a
    // real ReferenceError there — which is exactly what the first run of this change produced.
    functions: ['prevSetsForVariation', 'applyVariation', 'selectVariation', 'saveDraft', 'restoreDraft', 'bwSyncAll',
                'getSessionById'],
    decls: ['selectedSession', 'selectedVariations', 'previousSets', 'pendingRest',
            'removedSessionExercises', 'supersetGroups', 'supersetBaseOrder',
            // saveDraft now stamps the draft with the live template (C13/C14) and reads it from here.
            'SESSIONS'],
    deps,
    accessors: {
      // Live bindings, not a snapshot: restoreDraft() reassigns pendingRest outright.
      vars: '() => selectedVariations',
      // Stands in for renderExerciseBlock(), which sets selectedSession/previousSets and seeds
      // selectedVariations with last session's variation before the draft is ever read.
      render: '(s, prev, defaults) => { selectedSession = s; previousSets = prev; selectedVariations = { ...defaults }; }',
    },
  });

  api.render(session, PREVIOUS, defaults);
  return { ...api, els, store, painted, session, btnClasses: name => els[`block-${name}`]._btns.map(b => b.classList.contains('selected')) };
}

const draftOf = h => JSON.parse(h.store.workout_draft);

console.log('variation toggle survives a refresh');

// ── 1. the draft carries the variations at all ─────────────────────────────
{
  const h = build();
  h.saveDraft('upper-a');
  ok(draftOf(h).variations, 'the draft has a variations map');
  eq(draftOf(h).variations['Shoulder Press'], 'Machine', 'it records the current selection');
}
{
  // The whole failure: the draft must be a copy. Storing the live object would be fine through
  // JSON.stringify, but the toggle is also read back from `selectedVariations` on save.
  const h = build();
  h.saveDraft('upper-a');
  h.applyVariation('Shoulder Press', 'DB');
  eq(draftOf(h).variations['Shoulder Press'], 'Machine', 'an already-written draft is a snapshot, not a live reference');
}

// ── 2. toggling saves immediately ──────────────────────────────────────────
// Without this, changing the variation and refreshing *without typing a number* loses the change —
// and typing is exactly what you have not done yet at the moment you pick the machine.
{
  const h = build();
  h.selectVariation('Shoulder Press', 'Smith');
  ok(h.store.workout_draft, 'toggling a variation writes the draft with no other input');
  eq(draftOf(h).variations['Shoulder Press'], 'Smith', 'the draft carries the newly picked variation');
  eq(h.vars()['Shoulder Press'], 'Smith', 'and the in-memory selection follows');
}

// ── 3. the refresh itself ──────────────────────────────────────────────────
// Log under Smith, refresh: renderExerciseBlock re-seeds the toggle from *last session* (Machine),
// then restoreDraft has to put Smith back.
{
  const first = build();
  first.selectVariation('Shoulder Press', 'Smith');
  const store = { ...first.store };

  const after = build({ store });
  eq(after.vars()['Shoulder Press'], 'Machine', 'before restore, the toggle defaults to last session (the bug)');
  const restored = after.restoreDraft(after.session);
  eq(after.vars()['Shoulder Press'], 'Smith', 'after restore, the toggle is what was actually being logged');
  eq(restored['Shoulder Press'], 'Smith', 'restoreDraft reports which variations it recovered');
  ok(!restored['Lat Pulldown'], 'an exercise with no variations is not reported');
  eq(JSON.stringify(after.btnClasses('Shoulder Press')), '[false,true,false]', 'the Smith button is the highlighted one');
}
{
  // The consequence the bug actually had: collectExerciseSets() writes
  // `variation: selectedVariations[exName]`, so anything logged after the refresh was tagged wrong.
  const first = build();
  first.selectVariation('Shoulder Press', 'DB');
  const after = build({ store: { ...first.store } });
  after.restoreDraft(after.session);
  eq(after.vars()['Shoulder Press'], 'DB', 'sets saved after the refresh carry the logged variation, not the default');
}

// ── 4. band exercises ──────────────────────────────────────────────────────
// A band exercise has no weight input — the variation IS the weight column, so a lost toggle
// rewrites what the set reads as.
{
  const first = build();
  first.selectVariation('Pallof Press', 'Black');
  const after = build({ store: { ...first.store } });
  eq(after.els['w-Pallof Press-1'].textContent, 'Red', 'before restore the band label shows the default');
  after.restoreDraft(after.session);
  eq(after.els['w-Pallof Press-1'].textContent, 'Black', 'restore repaints the band label on set 1');
  eq(after.els['w-Pallof Press-3'].textContent, 'Black', 'and on every other set');
  eq(JSON.stringify(after.btnClasses('Pallof Press')), '[false,true]', 'the band toggle highlight follows too');
}

// ── 5. prev badges follow the variation ────────────────────────────────────
{
  const h = build();
  h.applyVariation('Shoulder Press', 'DB');
  eq(h.els['badge-Shoulder Press-1'].textContent, '20×10', 'the badge shows the DB history, not the machine history');
  h.applyVariation('Shoulder Press', 'Machine');
  eq(h.els['badge-Shoulder Press-1'].textContent, '40×10', 'switching back repaints from the machine history');
  eq(h.els['badge-Shoulder Press-2'].textContent, '42×8', 'set 2 gets the second machine set');
}

// ── 6. guards ──────────────────────────────────────────────────────────────
{
  const h = build();
  eq(h.applyVariation('Shoulder Press', 'Kettlebell'), false, 'a variation the exercise does not offer is rejected');
  eq(h.vars()['Shoulder Press'], 'Machine', 'and the selection is left alone (a renamed variation must not blank it)');
  eq(h.applyVariation('Lat Pulldown', 'Wide'), false, 'an exercise with no variations at all is rejected');
  eq(h.applyVariation('Bench Press', 'Smith'), false, 'an exercise not in the session is rejected');
}
{
  // Drafts written before this fix have no `variations` key at all.
  const h = build({ store: { workout_draft: JSON.stringify({ sessionId: 'upper-a', sets: {}, notes: '', timestamp: Date.now() }) } });
  const restored = h.restoreDraft(h.session);
  eq(JSON.stringify(restored), '{}', 'a pre-fix draft restores nothing and does not throw');
  eq(h.vars()['Shoulder Press'], 'Machine', 'the default survives a pre-fix draft');
}
{
  const h = build({ store: { workout_draft: JSON.stringify({ sessionId: 'lower-a', variations: { 'Shoulder Press': 'DB' }, sets: {}, timestamp: Date.now() }) } });
  eq(JSON.stringify(h.restoreDraft(h.session)), '{}', "another session's draft is ignored");
  eq(h.vars()['Shoulder Press'], 'Machine', "and cannot apply its variations to this session");
}
{
  const old = Date.now() - 25 * 60 * 60 * 1000;
  const h = build({ store: { workout_draft: JSON.stringify({ sessionId: 'upper-a', variations: { 'Shoulder Press': 'DB' }, sets: {}, timestamp: old }) } });
  eq(JSON.stringify(h.restoreDraft(h.session)), '{}', 'an expired draft restores nothing');
  eq(h.store.workout_draft, undefined, 'and is cleared');
}

// ── 7. the other half of the bug: the resume query ─────────────────────────
// buildWorkoutLogger() is a DOM-and-network function that cannot be lifted out, but the actual
// defect was one missing column in its select. Assert against the source so it cannot silently
// drop back out.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const m = src.match(/workout_sets\?workout_id=eq\.\$\{currentWorkoutId\}&select=([a-z_,]+)/);
  ok(m, 'the resume query is still where it was');
  ok(m && m[1].split(',').includes('variation'), 'the resume select asks for `variation` (the second half of the bug)');
  ok(m && m[1].split(',').includes('superset_group'), 'and still asks for superset_group');
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
