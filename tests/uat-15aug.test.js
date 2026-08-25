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
    'activeSupersetGroups', 'supersetGroupMap', 'supersetGroupOf', 'shortSessionLabel',
  ],
  decls: ['supersetGroups'],
  deps: {
    selectedSession: null,
    swRunning: false,
    swActiveExercise: null,
    swStartTimestamp: null,
    swTargetSeconds: 60,
    swCompletionCued: false,
    swSaveOnStop: true,
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
    state: '() => ({ swRunning, swActiveExercise, swStartTimestamp, swTargetSeconds, swCompletionCued, swSaveOnStop, swInterval })',
    setup: `(session, groups, watch) => {
      selectedSession = session;
      supersetGroups = groups;
      swRunning = !!watch;
      swActiveExercise = watch ? watch.exercise : null;
      swStartTimestamp = watch ? watch.start : null;
      swTargetSeconds = watch ? watch.target : 60;
      swCompletionCued = watch ? !!watch.cued : false;
      swSaveOnStop = watch ? watch.save !== false : true;
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

// The watch and the Mark Done must live on the SAME member — startRestAfter() hands the auto-started
// rest to whoever finished the group, so a split would leave the ring counting on a hidden button.
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

// 30s elapsed against a 60s target: the end-of-rest cue is still to come.
eq(app.state().swCompletionCued, false, 'not yet past the new target — the cue is still owed');

// Same hand-over, but the new target is SHORTER than the time already elapsed. Carrying the old
// flag over would fire a second cue for one rest.
render([['Cable Flys', 'Rear Delts']], { exercise: 'Cable Flys', start: NOW - 120000, target: 180, cued: false });
eq(app.state().swCompletionCued, true, 'already past the new target — no second cue for one rest');

// save:false (a Mark Done rest) must survive the move, or the walk to the next machine gets written
// onto a set as though it were a real rest — the exact bug fixed on 14 Aug.
render([['Cable Flys', 'Rear Delts']], { exercise: 'Cable Flys', start: NOW - 5000, target: 90, save: false });
eq(app.state().swSaveOnStop, false, 'a non-recording timer stays non-recording across the hand-over');
eq(JSON.parse(store.sw_state).save, false, 'and sw_state says so too');

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

// ── 3 · WEEK STRIP LABELS ───────────────────────────────────────────────────────────────────────
console.log('  shortSessionLabel');

// Del's real session names, straight out of session_templates. Letters became numbers on
// 21 Aug 2026 — a digit is equal to its own uppercase, so it takes the acronym branch and is kept
// whole rather than being read as an initial. That is the only reason U1 isn't just U.
eq(app.shortSessionLabel('Upper 1'), 'U1', 'Upper 1 → U1');
eq(app.shortSessionLabel('Lower 1'), 'L1', 'Lower 1 → L1');
eq(app.shortSessionLabel('Upper 2'), 'U2', 'Upper 2 → U2');
eq(app.shortSessionLabel('Lower 2'), 'L2', 'Lower 2 → L2');
eq(app.shortSessionLabel('Full Body A'), 'FBA', 'Full Body A → FBA');
eq(app.shortSessionLabel('CV + Pump'), 'CVP', 'CV + Pump → CVP, the + dropped and the acronym kept whole');
eq(app.shortSessionLabel('Open Workout'), 'OW', 'Open Workout → OW');

// The four Upper/Lower sessions are the ones that sit next to each other on the strip, so they are
// the ones that must not collide.
const strip = ['Upper 1', 'Lower 1', 'Upper 2', 'Lower 2'].map(app.shortSessionLabel);
eq(new Set(strip).size, 4, 'the four programme sessions abbreviate to four different labels');

// A word already in capitals is an acronym — reducing CV to C would throw away the identifying half.
eq(app.shortSessionLabel('CV Only'), 'CVO', 'a leading acronym survives whole');

// One word has no initials worth taking, so it keeps its first five letters.
eq(app.shortSessionLabel('Legs'), 'LEGS', 'a one-word name is kept, not reduced to L');
eq(app.shortSessionLabel('Conditioning'), 'CONDI', 'a long one-word name is cut to five');

// Names Del could type into "save this Open Workout as a session".
eq(app.shortSessionLabel('Dels Session 1'), 'DS1', 'a trailing number is kept as-is');
eq(app.shortSessionLabel('arms-blast'), 'AB', 'a hyphen separates words like a space does');
eq(app.shortSessionLabel('Push / Pull / Legs'), 'PPL', 'slashes too');

// Five characters is the cap — the tile is a seventh of a phone wide.
ok(app.shortSessionLabel('A B C D E F G').length <= 5, 'never longer than five characters');

// Junk in, nothing out — the caller falls back to the plain dot on an empty label.
eq(app.shortSessionLabel(''), '', 'empty name → empty label');
eq(app.shortSessionLabel(null), '', 'null name → empty label');
eq(app.shortSessionLabel('   '), '', 'whitespace-only name → empty label');
eq(app.shortSessionLabel('---'), '', 'punctuation-only name → empty label');

// ── SOURCE-ORDER CHECK ──────────────────────────────────────────────────────────────────────────
// The hand-over has to happen while the watch is being hidden, not on the next repaint: by then the
// button is already gone and nothing would trigger it.
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
const uiFn = src.slice(src.indexOf('function refreshSupersetUi'), src.indexOf('function persistSupersetGroups'));
ok(/watchBtn\.style\.display[\s\S]{0,200}swHandOverWatch/.test(uiFn),
  'refreshSupersetUi hands the timer over in the same pass that hides the watch');

console.log(`  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
