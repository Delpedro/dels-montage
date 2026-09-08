// Warm-up sets — the rows above set 1 that count for nothing.
//
// Del, 8 Sept 2026: "Add warmup sets, not working sets". The design was picked over four rounds of
// contact sheets: the control is a second segmented stepper (round one, cut C), it displaced the
// rep-target and rest pills into a caption (round two, cut 9), the overload panel moved into a
// `.work-rows` wrapper (round three), and the rows wear the selected-variation highlight in the
// session colour (round four, cut C).
//
// ⭐ WHAT THIS FILE IS REALLY PROTECTING IS THE NUMBERING, and it is worth saying why.
// Warm-ups and working sets both start at 1. They are told apart by `set_type`, never by position
// and never by number, and the unique key is (workout_id, exercise, set_type, set_number). Get that
// wrong in either direction and the damage is silent: a warm-up folded into the working sequence
// renumbers every comparison the app has ever made, and a 40kg×12 warm-up reaching the overload
// panel offers Del a rep target at a weight he was warming up with.
//
// Run: node tests/warmup-sets.test.js

const fs = require('fs');
const path = require('path');
const { load } = require('./extract');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  console.error('  FAIL: ' + label);
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; return; }
  fail++;
  console.error(`  FAIL: ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');

// ── the renderer ───────────────────────────────────────────────────────────
function renderHarness({ sets = 3, warmups = 2 } = {}) {
  const ex = { name: 'Incline Chest Press', sets, warmups, reps: '8–12', rest: '90s' };
  const session = { id: 'upper-a', exercises: [ex] };
  const api = load({
    functions: ['esc', 'jsAttr', 'prevSetsForVariation', 'renderSetRow', 'setsStepperHtml',
                'warmupStepperHtml', 'warmupLabel', 'targetRestLineHtml', 'repTargetLabel',
                'renderExerciseBlock'],
    decls: ['selectedSession', 'selectedVariations', 'previousSets'],
    deps: {
      document: { getElementById: () => null },
      isTimed: () => false,
      looksLikeSeconds: () => false,
      timedTarget: () => '',
      swParseRest: () => 90,
      renderSupersetControl: () => '',
      sessionColourClass: () => 'sc-upper',
      setValueLabel: () => '',
      isOptionalWeight: () => false,
      bwCellHtml: () => '',
    },
    accessors: { begin: '(s) => { selectedSession = s; selectedVariations = {}; previousSets = {}; }' },
  });
  api.begin(session);
  return { ...api, ex, session, html: api.renderExerciseBlock(ex, session) };
}

console.log('Warm-up sets');

// ── 1. the rows, and where they sit ────────────────────────────────────────
{
  const h = renderHarness();

  // ⚠️ THE ORDER IS THE FEATURE. Warm-ups come before .work-rows, which is what keeps them out of
  // the overload panel's containing block — the panel prints LAST and BEAT for working sets only
  // and has to be exactly as tall as the rows it describes.
  const bandAt = h.html.indexOf('class="rows-band"');
  const workAt = h.html.indexOf('class="work-rows"');
  const firstWarmAt = h.html.indexOf('set-row warm-row');
  const panelAt = h.html.indexOf('class="overload-panel"');
  const tabAt = h.html.indexOf('class="overload-tab"');
  ok(bandAt > -1 && workAt > bandAt, '.work-rows is nested inside .rows-band');
  ok(firstWarmAt > bandAt && firstWarmAt < workAt,
     'the warm-up rows sit inside the band but BEFORE .work-rows — the panel must not cover them');
  ok(panelAt > workAt && tabAt > workAt,
     'the overload panel AND its tab are inside .work-rows, so the panel is as tall as the sets it describes');

  eq((h.html.match(/set-row warm-row/g) || []).length, 2, 'two warm-up rows for warmups: 2');
  eq((h.html.match(/class="set-row"/g) || []).length, 3, 'and three plain working rows');

  // The ids are the whole reason a warm-up can be "set 1" without touching working set 1.
  ok(h.html.includes('id="w-Incline Chest Press-W1"') && h.html.includes('id="r-Incline Chest Press-W2"'),
     'warm-up inputs are keyed W1, W2');
  ok(h.html.includes('id="w-Incline Chest Press-1"') && h.html.includes('id="r-Incline Chest Press-3"'),
     'working inputs keep their bare numbers, unchanged by anything above them');
  eq((h.html.match(/id="w-Incline Chest Press-1"/g) || []).length, 1,
     'and no id is emitted twice — a collision here would have two boxes writing to one row');

  // A warm-up banks no rest, so it has no line to paint one on.
  eq((h.html.match(/class="rest-line"/g) || []).length, 3, 'rest lines belong to working sets only');
}

// ── 2. the resting state, which is on every tile of every session ──────────
{
  const h = renderHarness({ warmups: 0 });
  ok(!h.html.includes('warm-row'), 'no warm-up rows when the count is zero');
  ok(h.html.includes('>warm-up<'), 'the stepper reads "warm-up", not "0 warm-up"');
  ok(!h.html.includes('>0 warm-up<'), 'a column of zeros would be the loudest thing on the logger');
  ok(/id="warm-step-Incline Chest Press"[^>]*/.test(h.html) && h.html.includes('seg-warm at-min'),
     'and the − is dimmed, because removeWarmupRow is a no-op at zero');
  eq(h.warmupLabel(2), '2 warm-up', 'the count appears once there is one');
}

// ── 3. what the second stepper displaced (round two, cut 9) ────────────────
{
  const h = renderHarness();
  ok(h.html.includes('ex-target-line'), 'the target and rest are a caption line now');
  ok(/TARGET <b>8–12 reps<\/b> · REST <b>90s<\/b>/.test(h.html),
     'reading TARGET 8–12 reps · REST 90s — units on the number, and "Target", not "goal"');
  // Two steppers and two pills is 416px of content in a 330px row. The pills are what gave way.
  ok(!h.html.includes('ex-tag'),
     'and NOT as two .ex-tag pills — that pair is what would not fit beside a second stepper');
  eq((h.html.match(/class="sets-seg/g) || []).length, 2, 'exactly two segmented controls on the row');
}

// ── 4. collectExerciseSets — the two sequences, stamped ────────────────────
function collectHarness({ typed, pendingRest = {}, sets = 2, warmups = 2 }) {
  const els = {};
  Object.entries(typed).forEach(([id, value]) => { els[id] = { tagName: 'INPUT', value }; });
  const api = load({
    functions: ['collectExerciseSets'],
    decls: ['currentWorkoutId', 'selectedVariations', 'pendingRest'],
    deps: {
      document: { getElementById: id => els[id] || null },
      exerciseIdFields: () => ({}),
      isTimed: () => false,
      isOptionalWeight: () => false,
      optionalWeightValue: (_ex, v) => v,
      swPaintRestLine: () => {},
    },
    accessors: { seed: '(w, r) => { currentWorkoutId = w; selectedVariations = {}; pendingRest = r; }' },
  });
  api.seed('w-today', pendingRest);
  return api.collectExerciseSets({ name: 'Leg Press', sets, warmups }, null);
}

{
  const rows = collectHarness({
    typed: {
      'w-Leg Press-W1': '60', 'r-Leg Press-W1': '15',
      'w-Leg Press-W2': '100', 'r-Leg Press-W2': '10',
      'w-Leg Press-1': '200', 'r-Leg Press-1': '8',
      'w-Leg Press-2': '200', 'r-Leg Press-2': '7',
    },
  });

  eq(rows.map(r => `${r.set_type}${r.set_number}`), ['warmup1', 'warmup2', 'working1', 'working2'],
     'both sequences start at 1 and are told apart by set_type, never by number');
  eq(rows.map(r => r.weight), ['60', '100', '200', '200'],
     'each row carries its own load — the warm-up ramp is the point of the feature');
  ok(rows.every(r => r.workout_id === 'w-today'),
     'and they are all one exercise in one workout, written by one Mark Done');
}

{
  // ⚠️ pendingRest is keyed by working set number. Warm-up 1 and working 1 share that number, so a
  // warm-up reading the bank would be handed a rest it never took.
  const rows = collectHarness({
    typed: { 'w-Leg Press-W1': '60', 'r-Leg Press-W1': '15', 'w-Leg Press-1': '200', 'r-Leg Press-1': '8' },
    pendingRest: { 'Leg Press': { 1: 143 } },
    sets: 1, warmups: 1,
  });
  eq(rows.map(r => [r.set_type, r.rest_seconds]), [['warmup', 0], ['working', 143]],
     'the banked rest lands on working set 1 and never on warm-up 1');
}

{
  const rows = collectHarness({
    typed: { 'w-Leg Press-1': '200', 'r-Leg Press-1': '8' }, sets: 1, warmups: 2,
  });
  eq(rows.length, 1, 'an empty warm-up row writes nothing, the same as an empty working row');
  eq(rows[0].set_type, 'working', 'and what is written is stamped');
}

// ── 5. the re-save, where a bare set_number key would cross the streams ────
{
  const { mergeExistingRests } = load({ functions: ['mergeExistingRests'] });
  const sets = [
    { set_type: 'warmup', set_number: 1, rest_seconds: 0 },
    { set_type: 'working', set_number: 1, rest_seconds: 0 },
  ];
  const existing = [
    { set_type: 'working', set_number: 1, rest_seconds: 143 },
  ];
  eq(mergeExistingRests(sets, existing).map(s => s.rest_seconds), [0, 143],
     're-saving hands working 1 its own rest back and leaves warm-up 1 at zero');

  // Every row written before 8 Sept has no set_type at all and is a working set.
  eq(mergeExistingRests([{ set_number: 2, rest_seconds: 0 }], [{ set_number: 2, rest_seconds: 95 }])
       .map(s => s.rest_seconds), [95],
     'a row with no set_type is a working set, so four months of history still matches');
}

// ── 6. resuming a workout off its own rows ─────────────────────────────────
{
  const { reconstructSessionFromSets } = load({
    functions: ['reconstructSessionFromSets'], decls: ['EXERCISE_LIBRARY'],
  });
  const out = reconstructSessionFromSets([
    { exercise: 'Leg Press', set_number: 1, set_type: 'warmup' },
    { exercise: 'Leg Press', set_number: 2, set_type: 'warmup' },
    { exercise: 'Leg Press', set_number: 1, set_type: 'working' },
    { exercise: 'Leg Press', set_number: 2, set_type: 'working' },
    { exercise: 'Dips', set_number: 1 },
  ], { 'Leg Press': { name: 'Leg Press' }, Dips: { name: 'Dips' } });

  const legs = out.exercises.find(e => e.name === 'Leg Press');
  eq([legs.sets, legs.warmups], [2, 2],
     'the two sequences are counted separately — taking the highest number in the pile said 2 sets and lost the warm-ups');
  const dips = out.exercises.find(e => e.name === 'Dips');
  eq([dips.sets, dips.warmups], [1, 0], 'and a row with no set_type resumes as a working set');
}

// ── 7. the handlers ────────────────────────────────────────────────────────
{
  let appended = '', removed = 0, patched = null, drafted = 0, atMin = null;
  const ex = { name: 'Leg Press', sets: 3, warmups: 1, reps: '8–12', rest: '90s' };
  const els = {
    'work-Leg Press': { parentNode: { insertBefore: () => {} } },
    'warm-pill-Leg Press': { textContent: '' },
    'warm-step-Leg Press': { classList: { toggle: (_c, on) => { atMin = on; } } },
  };
  // Any warm-up weight box hands back a removable row — removeWarmupRow always goes for the last.
  const removableRow = { closest: () => ({ remove: () => { removed++; } }) };
  const api = load({
    functions: ['esc', 'jsAttr', 'renderSetRow', 'warmupLabel', 'syncWarmupStepper',
                'addWarmupRow', 'removeWarmupRow', 'persistWarmupCount'],
    decls: ['selectedSession', 'selectedVariations'],
    deps: {
      document: {
        getElementById: id => els[id] || (/^w-.+-W\d+$/.test(id) ? removableRow : null),
        createElement: () => {
          const w = { firstChild: null };
          Object.defineProperty(w, 'innerHTML', { set: v => { appended = v; }, get: () => appended });
          return w;
        },
      },
      saveDraft: () => { drafted++; },
      sb: (url, method, body) => { patched = { url, method, body }; return Promise.resolve({ ok: true }); },
      getSessionById: () => ({ exercises: [{ name: 'Leg Press', warmups: 1 }] }),
      isTimed: () => false,
      isOptionalWeight: () => false,
      bwCellHtml: () => '',
    },
    accessors: {
      begin: '(s) => { selectedSession = s; selectedVariations = {}; }',
      countOf: '() => selectedSession.exercises[0].warmups',
      setsOf: '() => selectedSession.exercises[0].sets',
    },
  });
  api.begin({ id: 'lower-a', exercises: [ex] });

  api.addWarmupRow('Leg Press');
  eq(api.countOf(), 2, '+ adds one warm-up');
  eq(api.setsOf(), 3, 'and NEVER touches the working set count — that is the whole contract');
  ok(appended.includes('warm-row') && appended.includes('-W2"'),
     'the appended row is a warm-up row numbered W2');
  eq(drafted, 1, 'the draft is written, so a mid-session refresh keeps it');

  // ⚠️ This is the one stepper that writes the template. A warm-up count is a property of how you
  // train the lift, not of this morning — today-only would mean tapping + on every big lift forever.
  eq(patched.method, 'PATCH', 'and the count is persisted');
  eq(patched.body, { warmups: 2 }, 'as the template row for that exercise');
  ok(patched.url.startsWith('session_exercises?session_id=eq.lower-a'),
     'scoped to this session and this exercise, never to the exercise name alone');

  api.removeWarmupRow('Leg Press');
  eq(api.countOf(), 1, '− takes one off');
  eq(removed, 1, 'and removes the row it was showing');

  api.removeWarmupRow('Leg Press');
  api.removeWarmupRow('Leg Press');
  eq(api.countOf(), 0, 'stopping at zero rather than going negative');
  eq(atMin, true, 'with the − dimmed to say so');
}

// ── 8. Open Workout has no template row to write to ────────────────────────
{
  let patched = false;
  const api = load({
    functions: ['persistWarmupCount'],
    decls: ['selectedSession'],
    deps: {
      sb: () => { patched = true; return Promise.resolve({ ok: true }); },
      getSessionById: () => null,
      document: { getElementById: () => null },
    },
    accessors: { begin: '(s) => { selectedSession = s; }' },
  });
  api.begin({ id: 'open', exercises: [] });
  api.persistWarmupCount('Leg Press', 2);
  ok(!patched, 'Open Workout writes no template row — the draft is its only record, as it always was');
}

// ── 9. source guards ───────────────────────────────────────────────────────
// None of the below can be caught by a behavioural test: they are the places a future tidy-up would
// silently fold warm-ups back into figures they must never reach.
{
  ok(SRC.includes('workout_sets?exercise=${exFilter}&set_type=eq.working'),
     'the one query behind LAST and BEAT asks for working sets only — a 40kg warm-up as "last time" on a 70kg lift is the bug this stops');
  ok(/const sets = \(w\.workout_sets \|\| \[\]\)\.filter\(s => s\.set_type !== 'warmup'\)/.test(SRC),
     'History strips warm-ups once, at the door, so no consumer downstream has to remember to');
  ok(SRC.includes('&set_type=eq.working&set_number=eq.${setNum}&select=id'),
     'the stopwatch PATCHes the rest onto the WORKING set of that number, not whichever row came back first');
  ok(/editingWorkoutId}&set_type=eq\.working/.test(SRC),
     'and the History edit modal shows one row per set number, not a warm-up and a working set both calling themselves 1');

  // The ✎ editor is a DELETE-then-POST over the whole session.
  ok(/warmups: ex\.warmups \|\| 0/.test(SRC),
     'the template row builders carry warmups through, or any ✎ save would reset every count in the session to zero');

  // The colour rule, which is a project rule and not a preference.
  ok(/\.set-row\.warm-row \.set-num \{ color: var\(--sc\)/.test(CSS),
     'the warm-up row wears the SESSION colour');
  // Comments stripped first — the block above these rules explains at length why --accent is not
  // used here, and a naive grep would read its own reasoning as a violation of itself.
  const warmCss = CSS.slice(CSS.indexOf('.set-row.warm-row'), CSS.indexOf('.set-row.warm-row') + 700)
    .replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/--accent/.test(warmCss.slice(0, warmCss.indexOf(':focus'))),
     'and NOT --accent, which on this screen means "you can tap this" and nothing else');
  ok(/\.set-row\.warm-row \.set-input:focus \{ border-color: var\(--accent\)/.test(CSS),
     'except the focus ring, which is the one thing --accent has always meant');

  // The 7 Sept trap: `right: 0` resolves against the container's own padding box.
  ok(/\.work-rows \{ position: relative; margin-right: -18px; padding-right: 18px; \}/.test(CSS),
     '.work-rows re-spans the tab lane, or the overload tab lands back in the middle of the reps box');
}

console.log('  ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
