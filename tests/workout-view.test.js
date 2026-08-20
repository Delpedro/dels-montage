// showWorkoutView() — the Workout page is four mutually exclusive panels (18 Aug 2026).
//
// The panels are the session grid, the logger, the CV + Pump form and the 'opening' placeholder,
// plus the pill that names the session you're in. Seven places used to set those four `style.display`s by hand — the same four
// lines, copied — and they had drifted apart without anyone noticing: saveWorkout() put the grid
// back and hid both forms but never hid the pill, so finishing a workout dropped you on the picker
// with the name of the session you'd just finished still stuck to the top of it.
//
// So the assertions here are not really "does display get set to block". They are: for each of the
// three views, is the state of ALL FOUR elements fully specified — and is there anywhere left in
// the app that can still set one of them behind this function's back. The second one is the test
// that matters; the bug above existed because nothing was watching for it.
//
// 20 Aug 2026 added the fourth: 'opening'. It is the odd one out because it is not a destination —
// it is what is on screen during the two round trips between tapping Start on the Next up card and
// the logger existing. Before it, the session PICKER filled that gap, so Start landed on a choice
// Del had not asked to make and then jumped off it again: "it goes to workout page first for a
// second then diverts to the next planned workout....not cool". It is in here rather than managed
// privately by startNextSession() for exactly the reason the other four are — a fifth panel set
// behind this function's back is the drift this whole file exists to prevent.
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

const PANELS = ['session-grid', 'session-pill', 'workout-logger', 'conditioning-form', 'workout-opening', 'workout-subtitle'];

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
  eq(h.els['workout-opening'].style.display, 'none', 'grid view: the opening placeholder is hidden');
  eq(h.els['workout-subtitle'].style.display, 'block', 'grid view: the picker caption is back');
}

// ── The gap, which is the panel that did not used to exist ─────────────────
// The assertion that matters is the first one. Everything else here is bookkeeping; the picker
// being hidden while a session is opening IS the bug Del reported.
{
  const h = build();
  h.showWorkoutView('opening', 'Upper B');
  eq(h.els['session-grid'].style.display, 'none',
     'opening view: the picker is hidden — showing it is the whole bug, a choice offered then taken away');
  eq(h.els['workout-opening'].style.display, 'block', 'opening view: the placeholder is what fills the gap');
  eq(h.els['session-pill'].style.display, 'flex', 'opening view: the pill is shown');
  eq(h.els['session-pill-name'].textContent, 'Upper B',
     'opening view: and it names the session being opened, which is the only question worth asking while you wait');
  eq(h.els['workout-logger'].style.display, 'none', 'opening view: the logger is not up yet');
  eq(h.els['conditioning-form'].style.display, 'none', 'opening view: nor the CV + Pump form');
  eq(h.els['workout-subtitle'].style.display, 'none',
     'opening view: and the picker caption goes with it — "Choose your session" over "Opening your session…" is the bug again, in words');
}

// The placeholder is a state you pass through, never one you are left in. Every real view closes it.
{
  const h = build();
  h.showWorkoutView('opening', 'Upper B');
  h.showWorkoutView('logger', 'Upper B');
  eq(h.els['workout-opening'].style.display, 'none', 'entering the logger closes the placeholder');

  h.showWorkoutView('opening', 'CV + Pump');
  h.showWorkoutView('conditioning', 'CV + Pump');
  eq(h.els['workout-opening'].style.display, 'none', 'so does entering the CV + Pump form');

  h.showWorkoutView('opening', 'Upper B');
  h.showWorkoutView('grid');
  eq(h.els['workout-opening'].style.display, 'none', 'and so does backing out to the picker');
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
  eq(h.els['workout-opening'].style.display, 'none', 'an unrecognised mode closes the placeholder');
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
