// Del's 15 Aug UAT — two of the three findings, the ones that are code:
//
//   "Two stop watches for super set?!"  → one watch per superset, on the same member as Mark Done
//   "Home should have what workout was done under Mon / Tue etc" → shortSessionLabel() on the strip
//
// The third (a missing PR on Friday's Hip Thrusts) turned out to be data, not code — see
// CURRENT_STATUS.md. Nothing to assert here.
//
// The watch half is weighted at the hand-over rather than at the hiding: hiding a button is one line
// and obviously right, whereas a RUNNING timer left on a hidden button keeps counting and cueing
// with its own stop control off screen. That's the failure worth a test.
//
// Run: node tests/uat-15aug.test.js

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

console.log('15 Aug UAT — one watch per superset, session names on the week strip');

// ── FAKE DOM ────────────────────────────────────────────────────────────────────────────────────
// Only what refreshSupersetUi() actually touches: a style.display, a dataset, a textContent and a
// classList. getElementById returns null for anything not created, which is itself under test —
// the real page has no `ss-` button on a cardio block.
function el() {
  const classes = new Set();
  return {
    style: {},
    dataset: {},
    textContent: '',
    classList: {
      toggle: (c, on) => { on ? classes.add(c) : classes.delete(c); },
      contains: c => classes.has(c),
    },
  };
}

const NOW = Date.now();
const calls = { rendered: [], cleared: [], closedPickers: 0 };
const store = {};
let nextInterval = 10;
let dom = {};

const app = load({
  functions: [
    'refreshSupersetUi', 'swHandOverWatch', 'swElapsed', 'swParseRest',
    'activeSupersetGroups', 'supersetGroupMap', 'supersetGroupOf',
  ],
  decls: ['supersetGroups'],
  deps: {
    selectedSession: null,
    swRunning: false,
    swActiveExercise: null,
    swStartTimestamp: null,
    swTargetSeconds: 60,
    swInterval: null,
    swRenderWatch: n => calls.rendered.push(n),
    closeSupersetPickers: () => { calls.closedPickers++; },
    document: { getElementById: id => dom[id] || null },
    sessionStorage: {
      setItem: (k, v) => { store[k] = v; },
      getItem: k => (k in store ? store[k] : null),
      removeItem: k => { delete store[k]; },
    },
    setInterval: () => nextInterval++,
    clearInterval: id => calls.cleared.push(id),
  },
  accessors: {
    state: '() => ({ swRunning, swActiveExercise, swStartTimestamp, swTargetSeconds, swInterval })',
    setup: `(session, groups, watch) => {
      selectedSession = session;
      supersetGroups = groups;
      swRunning = !!watch;
      swActiveExercise = watch ? watch.exercise : null;
      swStartTimestamp = watch ? watch.start : null;
      swTargetSeconds = watch ? watch.target : 60;
      swInterval = watch ? 7 : null;
    }`,
  },
});

// Del's 15 Aug Upper A, in the order the screenshot shows it.
const SESSION = {
  id: 'upper-a',
  exercises: [
    { name: 'Incline Chest Press', sets: 3, rest: '90s' },
    { name: 'Cable Flys', sets: 2, rest: '90s' },
    { name: 'Rear Delts', sets: 2, rest: '60s' },
  ],
};

function render(groups, watch = null) {
  dom = {};
  SESSION.exercises.forEach(ex => {
    dom[`block-${ex.name}`] = el();
    dom[`done-btn-${ex.name}`] = el();
    dom[`watch-${ex.name}`] = el();
    dom[`ss-${ex.name}`] = el();
  });
  calls.rendered = []; calls.cleared = []; calls.closedPickers = 0;
  Object.keys(store).forEach(k => delete store[k]);
  app.setup(SESSION, groups, watch);
  app.refreshSupersetUi();
}

// ── 1 · ONE WATCH PER SUPERSET ──────────────────────────────────────────────────────────────────
console.log('  one watch per superset');

render([]);
SESSION.exercises.forEach(ex => {
  eq(dom[`watch-${ex.name}`].style.display, '', `unpaired: ${ex.name} keeps its watch`);
  eq(dom[`done-btn-${ex.name}`].textContent, 'Mark Done', `unpaired: ${ex.name} says Mark Done`);
});

render([['Cable Flys', 'Rear Delts']]);
eq(dom['watch-Cable Flys'].style.display, 'none', 'paired: the first member loses its watch');
eq(dom['watch-Rear Delts'].style.display, '', 'paired: the last member keeps its watch');
eq(dom['watch-Incline Chest Press'].style.display, '', 'paired: an unrelated block is untouched');

// The watch and the Mark Done must live on the SAME member — that is where you are standing when the
// round ends, and a split would put the ring on one block and the button that ends it on another.
eq(dom['done-btn-Cable Flys'].style.display, 'none', 'the hidden watch and the hidden Mark Done are the same block');
eq(dom['done-btn-Rear Delts'].style.display, '', 'the visible watch and the visible Mark Done are the same block');
eq(dom['done-btn-Rear Delts'].textContent, 'Mark Superset Done', 'the surviving button names the superset');

// Order within the group decides, not the order of the session — you pair in the order you lift.
render([['Rear Delts', 'Cable Flys']]);
eq(dom['watch-Cable Flys'].style.display, '', 'reversed pairing: the watch follows the group order');
eq(dom['watch-Rear Delts'].style.display, 'none', 'reversed pairing: the first-listed member loses it');

// A giant set: only the last of three keeps a watch.
render([['Incline Chest Press', 'Cable Flys', 'Rear Delts']]);
eq(dom['watch-Incline Chest Press'].style.display, 'none', 'giant set: first member has no watch');
eq(dom['watch-Cable Flys'].style.display, 'none', 'giant set: middle member has no watch');
eq(dom['watch-Rear Delts'].style.display, '', 'giant set: last member keeps the watch');

// Unpairing puts it back. This is the assertion that catches a fix written as "hide" with no "show".
render([]);
eq(dom['watch-Cable Flys'].style.display, '', 'unpaired again: the watch comes back');
eq(dom['done-btn-Cable Flys'].style.display, '', 'unpaired again: so does Mark Done');

// A group left with one member (partner removed for today) is dormant, not a superset.
render([['Cable Flys', 'Bent Over Row']]);
eq(dom['watch-Cable Flys'].style.display, '', 'dormant group: the lone member keeps its watch');

// ── 2 · A RUNNING TIMER IS HANDED OVER, NOT ORPHANED ────────────────────────────────────────────
console.log('  a running timer moves to the watch that stays on screen');

render([['Cable Flys', 'Rear Delts']], { exercise: 'Cable Flys', start: NOW - 30000, target: 90 });
let s = app.state();
eq(s.swActiveExercise, 'Rear Delts', 'the timer moved to the member that still has a watch');
eq(s.swRunning, true, 'and it is still running');
eq(s.swStartTimestamp, NOW - 30000, 'the start time is untouched — no elapsed rest is lost');
eq(s.swTargetSeconds, 60, "the ring re-targets to the new block's own rest");
ok(calls.rendered.includes('Cable Flys'), 'the abandoned watch is repainted back to idle');
ok(calls.rendered.includes('Rear Delts'), 'the receiving watch is repainted running');
eq(calls.cleared.length, 1, 'the old 1s re-render interval is cleared, not left duplicating');
eq(JSON.parse(store.sw_state).exercise, 'Rear Delts', 'sw_state follows, so a trip to Stats and back restores the right block');
eq(JSON.parse(store.sw_state).start, NOW - 30000, 'sw_state keeps the original start');

// The state that crosses is the clock and nothing else.
eq(Object.keys(JSON.parse(store.sw_state)).sort().join(','), 'exercise,start,target',
  'the handed-over state carries the clock and nothing else');

// A timer already on the surviving member is left completely alone.
render([['Cable Flys', 'Rear Delts']], { exercise: 'Rear Delts', start: NOW - 5000, target: 60 });
eq(app.state().swActiveExercise, 'Rear Delts', 'a timer on the surviving watch is not moved');
eq(app.state().swInterval, 7, 'and its interval is not churned');

// Nothing running: pairing must not start a timer out of nowhere.
render([['Cable Flys', 'Rear Delts']]);
eq(app.state().swRunning, false, 'pairing with no timer running starts nothing');
eq(store.sw_state, undefined, 'and writes no sw_state');

// A timer on an unrelated exercise keeps its watch and is untouched.
render([['Cable Flys', 'Rear Delts']], { exercise: 'Incline Chest Press', start: NOW - 5000, target: 90 });
eq(app.state().swActiveExercise, 'Incline Chest Press', 'a timer on an unpaired block is untouched');

// ── 3 · WEEK STRIP LABELS — DELETED 1 SEPT 2026 (C18) ───────────────────────────────────────────
console.log('  the week strip carries no session name');

// ⚠️ THIS SECTION USED TO ASSERT shortSessionLabel(): Upper 1 → U1, CV + Pump → CVP, and twenty more.
// Del asked for the name on the strip on 15 Aug and asked for it off again on 1 Sept, having seen
// what it does to a name a user types: `CTRL 1st Workout` came out `CTRL1` on the one real second
// account (C18). His reason is the durable half — "the home screen tells you whats next anyhow… this
// will get too messy bringing other users into the app".
//
// So the assertions are replaced by a guard rather than deleted quietly. No behavioural test can
// notice an abbreviation being helpfully reinstated next month; this one fails the moment the
// function or the element comes back.
{
  const fs = require('fs'), path = require('path');
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  const code = appSrc.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

  ok(!/function shortSessionLabel\(/.test(code), 'shortSessionLabel() is gone from app.js');
  ok(!/wd-session/.test(code), 'and nothing renders a wd-session element any more');
  ok(!/\.wd-session\s*\{/.test(cssSrc), 'its stylesheet rule went with it rather than lingering');

  // What the strip says instead: a dot on every day, and the tile's own colour for whether it was
  // trained. The dot must survive — dropping it as well would leave a trained day indistinguishable
  // from an untrained one on a phone with the tile borders barely visible.
  const stripFn = appSrc.slice(appSrc.indexOf('async function buildWeekStrip'),
                              appSrc.indexOf('// ⛔ shortSessionLabel()'));
  ok(/wd-dot/.test(stripFn), 'every day still paints its dot');
  ok(/classList\.add\('done'\)/.test(stripFn), "and a trained day still gets 'done', which colours it");
}

// ── SOURCE-ORDER CHECK ──────────────────────────────────────────────────────────────────────────
// The hand-over has to happen while the watch is being hidden, not on the next repaint: by then the
// button is already gone and nothing would trigger it.
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
const uiFn = src.slice(src.indexOf('function refreshSupersetUi'), src.indexOf('function persistSupersetGroups'));
ok(/watchBtn\.style\.display[\s\S]{0,200}swHandOverWatch/.test(uiFn),
  'refreshSupersetUi hands the timer over in the same pass that hides the watch');

console.log(`  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
