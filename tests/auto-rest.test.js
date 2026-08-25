// The rest timer starting itself on Mark Done — 14 Aug 2026.
//
// It's a one-line call, and every way it can go wrong is about *when* it fires rather than what it
// does: starting a rest after a save that failed, banking an interval that spans the set you just
// logged as though it were a rest, or leaving the previous exercise's timer running alongside the new
// one. So the assertions below are weighted at the guards, not at the happy path.
//
// Run: node tests/auto-rest.test.js

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

console.log('auto-start rest on Mark Done');

// The stopwatch's state lives in top-level `let`s carrying trailing comments, which the declaration
// slicer doesn't take, so they're supplied as bindings instead. Assignments inside the real swStart()
// land on these and the accessor reads the same bindings — a rename in the source would leave the
// state frozen here and fail every assertion below, which is the protection that matters.
const calls = { stop: 0, vibrate: [], render: [], cleared: [], locked: 0, scheduled: [] };
const store = {};
let nextInterval = 1;

const app = load({
  functions: ['startRestAfter', 'swStart', 'swParseRest'],
  deps: {
    swRunning: false,
    swActiveExercise: null,
    swStartTimestamp: null,
    swTargetSeconds: 60,
    swCompletionCued: false,
    swSaveOnStop: true,
    swInterval: null,
    selectedSession: null,
    swStop: () => { calls.stop++; },
    swAcquireWakeLock: () => { calls.locked++; },
    scheduleRestAlert: (name, secs) => calls.scheduled.push([name, secs]),
    swVibrate: v => calls.vibrate.push(v),
    swRenderWatch: n => calls.render.push(n),
    sessionStorage: {
      setItem: (k, v) => { store[k] = v; },
      removeItem: k => { delete store[k]; },
      getItem: k => (k in store ? store[k] : null),
    },
    setInterval: () => nextInterval++,
    clearInterval: id => calls.cleared.push(id),
  },
  accessors: {
    state: '() => ({ swRunning, swActiveExercise, swStartTimestamp, swTargetSeconds, swCompletionCued, swSaveOnStop, swInterval })',
    reset: `(session) => {
      swRunning = false; swActiveExercise = null; swStartTimestamp = null;
      swTargetSeconds = 60; swCompletionCued = false; swSaveOnStop = true; swInterval = null;
      selectedSession = session;
    }`,
  },
});

const SESSION = {
  id: 'upper-a',
  exercises: [
    { name: 'Bench Press', sets: 3, rest: '180s' },
    { name: 'Incline Curl', sets: 3, rest: '90s' },
    { name: 'Pallof Press', sets: 3 },   // no rest field — the template doesn't always carry one
  ],
};

function fresh() {
  app.reset(SESSION);
  calls.stop = 0; calls.vibrate = []; calls.render = []; calls.cleared = [];
  calls.locked = 0; calls.scheduled = [];
  Object.keys(store).forEach(k => delete store[k]);
}

// ── 1. the ordinary case: Mark Done leaves a rest running ──────────────────
{
  fresh();
  const before = Date.now();
  app.startRestAfter('Bench Press');
  const s = app.state();

  eq(s.swRunning, true, 'the timer is running after Mark Done');
  eq(s.swActiveExercise, 'Bench Press', 'and it is attached to the exercise that was just completed');
  ok(s.swStartTimestamp >= before, 'it starts from now, not from whenever the watch was last touched');
  eq(s.swTargetSeconds, 180, "the target comes from the exercise's own rest field");
  eq(s.swCompletionCued, false, 'and the end-of-rest cue is armed for this period');
  ok(JSON.parse(store.sw_state).exercise === 'Bench Press',
    'persisted to sessionStorage, so a trip to Stats and back does not lose the rest');
  eq(calls.render.length, 1, 'the watch is repainted immediately rather than waiting a second for the interval');
  // The screen has to stay awake or the render tick that finishes the ring stops before the rest
  // ends — the auto-started timer is the one most likely to run with the phone already face-down.
  eq(calls.locked, 1, 'the screen wake lock is taken when the rest starts');
  // The push has to be booked with the target the timer actually adopted, not the one the caller
  // guessed — a notification for 90s on a 180s rest is worse than no notification.
  eq(calls.scheduled.length, 1, 'the rest alert is booked once when the rest starts');
  eq(calls.scheduled[0][0], 'Bench Press', 'and it names the exercise being rested from');
  eq(calls.scheduled[0][1], 180, "and it is booked for the target the timer actually took");

  // The 14 Aug correction. Mark Done is tapped when the exercise is over, so this timer measures the
  // walk to the next machine — swStop() would have hung it on the last set as a "rest" (166s onto Leg
  // Curl set 3, 380s onto Abductor set 2, against genuine between-set rests of 90–110s) and dragged
  // every avg-rest figure in the app with it.
  eq(s.swSaveOnStop, false, 'an auto-started rest is display-only — it must never be written to a set');
  eq(JSON.parse(store.sw_state).save, false,
    'and the flag is persisted too, so resuming after a trip to Stats does not turn it back into a saved rest');
}

// ── 1b. a timer the user started by hand still records ────────────────────
// The distinction the whole fix rests on: tapping the watch is a deliberate "time this rest", and that
// one still writes. Only the automatic one is silent.
{
  fresh();
  app.swStart('Bench Press');
  eq(app.state().swSaveOnStop, true, 'swStart defaults to saving — a hand-tapped rest is still a rest');
  eq(JSON.parse(store.sw_state).save, true, 'and says so in the persisted state');
}

// ── 2. an exercise with no rest in the template still gets a countdown ─────
{
  fresh();
  app.startRestAfter('Pallof Press');
  eq(app.state().swTargetSeconds, 60, 'no rest field falls back to 60s rather than to no target at all');

  // The same default, straight from the parser, for the shapes the templates actually use.
  eq(app.swParseRest('90s'), 90, "'90s' reads as 90");
  eq(app.swParseRest(undefined), 60, 'and a missing value as the default');
}

// ── 3. nothing to start on ─────────────────────────────────────────────────
// completeExercise() returns before this on every failure path, so in practice the name is always
// real — but a rest timer running against an exercise that was never saved would be a lie on screen.
{
  fresh();
  app.startRestAfter(null);
  eq(app.state().swRunning, false, 'no exercise name starts no timer');
  app.startRestAfter(undefined);
  eq(app.state().swRunning, false, 'and neither does undefined');
  eq(store.sw_state, undefined, 'nothing is persisted either');
}

// ── 4. re-tapping Mark Done restarts the period, it does not bank it ───────
// Re-tapping is how a typo gets fixed, and by then the watch has been running since the *previous*
// Mark Done — an interval covering the set itself. swStop() would PATCH that onto the last typed set
// as a rest time, which is a wrong number written over a right one. Restarting is the correct read.
{
  fresh();
  app.startRestAfter('Bench Press');
  const first = app.state();

  app.startRestAfter('Bench Press');
  const second = app.state();

  eq(calls.stop, 0, 'a re-tap on the same exercise never goes through swStop, so no rest is written');
  ok(second.swStartTimestamp >= first.swStartTimestamp, 'the period restarts from the second tap');
  eq(second.swCompletionCued, false, 'and the completion cue is re-armed for it');
  eq(calls.cleared.length, 2, 'the old ring interval is cleared rather than left running alongside the new one');
}

// ── 5. moving on to the next exercise ──────────────────────────────────────
{
  fresh();
  app.startRestAfter('Bench Press');
  app.startRestAfter('Incline Curl');
  const s = app.state();

  eq(calls.stop, 1, "the previous exercise's timer is stopped rather than left running alongside the new one");
  eq(s.swActiveExercise, 'Incline Curl', 'the watch moves to the new exercise');
  eq(s.swTargetSeconds, 90, 'with the new target');
  eq(JSON.parse(store.sw_state).exercise, 'Incline Curl', 'and the persisted state follows it');
}

// ── 6. where it is called from ─────────────────────────────────────────────
// The behaviour that can't be reached through the extracted function, and the one that would be worst
// to get wrong: a Mark Done that failed to save must not start a rest.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const body = src.slice(src.indexOf('async function completeExercise('), src.indexOf('function startRestAfter('));

  const start = body.indexOf('startRestAfter(');
  ok(start > 0, 'completeExercise starts the rest timer');
  ok(body.indexOf('not saved (${failedStatus})') < start,
    'and only past the save-failure return, so a failed Mark Done leaves you mid-set, not resting');
  ok(body.indexOf('Fill in at least one set first') < start,
    'and past the nothing-typed return');
  ok(body.indexOf('lastCompletedExercise = saved[saved.length - 1]') < start,
    'and it times the last member of a superset — the block the single Mark Done button sits on');

  // Del killed the completion beep on 25 Aug 2026. This used to assert the AudioContext was
  // unlocked inside the tap; it now asserts there is no audio left to unlock. Sound is not a missing
  // feature to be helpfully restored — see the note above swElapsed() in app.js.
  ok(!/swBeep|swUnlockAudio|swAudioCtx|AudioContext|webkitAudioContext/.test(src),
    'no audio survives anywhere in app.js — the beep is gone on purpose');

  // One call site. A second one somewhere else would be a rest timer starting for reasons the user
  // can't see, which is exactly the class of bug the watch's manual tap never had.
  // Comment lines are dropped first: this is a claim about code, and the prose elsewhere in app.js
  // legitimately names startRestAfter() when explaining why the superset watch sits where it does.
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  eq(code.split('startRestAfter(').length - 1, 2,
    'startRestAfter appears twice in the code — its declaration and that one call');
}

process.on('exit', () => {
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});
