// showWorkoutView() — the Workout page is three mutually exclusive panels (18 Aug 2026).
//
// The panels are the session grid, the logger, and the CV + Pump form, plus the pill that names the
// session you're in. Seven places used to set those four `style.display`s by hand — the same four
// lines, copied — and they had drifted apart without anyone noticing: saveWorkout() put the grid
// back and hid both forms but never hid the pill, so finishing a workout dropped you on the picker
// with the name of the session you'd just finished still stuck to the top of it.
//
// So the assertions here are not really "does display get set to block". They are: for each of the
// three views, is the state of ALL FOUR elements fully specified — and is there anywhere left in
// the app that can still set one of them behind this function's back. The second one is the test
// that matters; the bug above existed because nothing was watching for it.
//
// Run: node tests/workout-view.test.js

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

const PANELS = ['session-grid', 'session-pill', 'workout-logger', 'conditioning-form'];

function build() {
  const els = {};
  const get = id => (els[id] ||= { style: {}, textContent: '' });
  PANELS.concat('session-pill-name').forEach(get);
  const api = load({
    functions: ['showWorkoutView'],
    deps: { document: { getElementById: get } },
  });
  return { ...api, els };
}

console.log('showWorkoutView — one function owns all four panels');

// ── The three views ────────────────────────────────────────────────────────
{
  const h = build();
  h.showWorkoutView('grid');
  eq(h.els['session-grid'].style.display, 'grid', 'grid view: the picker is visible');
  eq(h.els['session-pill'].style.display, 'none', 'grid view: the pill is hidden — this is the bug that was shipped');
  eq(h.els['workout-logger'].style.display, 'none', 'grid view: the logger is hidden');
  eq(h.els['conditioning-form'].style.display, 'none', 'grid view: the CV + Pump form is hidden');
}

{
  const h = build();
  h.showWorkoutView('logger', 'Lower A');
  eq(h.els['session-grid'].style.display, 'none', 'logger view: the picker is hidden');
  eq(h.els['session-pill'].style.display, 'flex', 'logger view: the pill is shown');
  eq(h.els['session-pill-name'].textContent, 'Lower A', 'logger view: the pill names the session');
  eq(h.els['workout-logger'].style.display, 'block', 'logger view: the logger is visible');
  eq(h.els['conditioning-form'].style.display, 'none', 'logger view: the CV + Pump form is hidden');
}

{
  const h = build();
  h.showWorkoutView('conditioning', 'CV + Pump');
  eq(h.els['session-grid'].style.display, 'none', 'conditioning view: the picker is hidden');
  eq(h.els['session-pill'].style.display, 'flex', 'conditioning view: the pill is shown');
  eq(h.els['session-pill-name'].textContent, 'CV + Pump', 'conditioning view: the pill names it');
  eq(h.els['workout-logger'].style.display, 'none', 'conditioning view: the logger is hidden');
  eq(h.els['conditioning-form'].style.display, 'block', 'conditioning view: the form is visible');
}

// Going back to the grid must not leave the last session's name behind for the next view to inherit
// — the pill is hidden, but a stale name would flash on the way into the next session.
{
  const h = build();
  h.showWorkoutView('logger', 'Upper B');
  h.showWorkoutView('grid');
  h.showWorkoutView('logger', 'Lower B');
  eq(h.els['session-pill-name'].textContent, 'Lower B', 'the pill name is re-set on every entry, never inherited');
}

// An unknown mode must not half-render: everything closes rather than leaving whichever panel was
// open still on screen. A typo'd mode should look obviously broken, not subtly wrong.
{
  const h = build();
  h.showWorkoutView('logger', 'Lower A');
  h.showWorkoutView('nonsense');
  eq(h.els['workout-logger'].style.display, 'none', 'an unrecognised mode closes the logger');
  eq(h.els['conditioning-form'].style.display, 'none', 'an unrecognised mode closes the CV + Pump form');
}

// ── The guard that stops the drift coming back ─────────────────────────────
// The original bug was not a wrong value, it was a *missing line* in one of seven copies. Testing
// behaviour cannot catch that — the copy that's wrong is the one nobody wrote a test for. So assert
// on the source instead: showWorkoutView is the only place allowed to touch these four.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const fn = src.slice(src.indexOf('function showWorkoutView'));
  const bodyEnd = fn.indexOf('\n}\n');
  const inside = fn.slice(0, bodyEnd);
  const outside = src.replace(inside, '');

  PANELS.forEach(id => {
    const hits = (outside.match(new RegExp(`getElementById\('${id}'\)\.style\.display`, 'g')) || []).length;
    eq(hits, 0, `nothing outside showWorkoutView() sets ${id}'s display — that is how the seven copies drifted`);
  });

  const calls = (src.match(/showWorkoutView\(/g) || []).length - 1;   // minus the declaration
  ok(calls >= 7, `every former copy now calls the helper — found ${calls} call sites, expected at least 7`);
}

console.log(`  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
