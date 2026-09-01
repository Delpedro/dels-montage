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
const calls = { stop: 0, stopArgs: [], vibrate: [], render: [], cleared: [], locked: 0, scheduled: [] };
const store = {};
let nextInterval = 1;

const app = load({
  functions: ['startRestAfter', 'abandonRestAfterFailedSave', 'swStart', 'swParseRest'],
  deps: {
    swRunning: false,
    swActiveExercise: null,
    swStartTimestamp: null,
    swTargetSeconds: 60,
    swCompletionCued: false,
    swRestAuto: false,
    swRestSetNum: null,
    swLastTyped: null,
    SET_TAP_WINDOW_MS: 60000,
    swInterval: null,
    selectedSession: null,
    swStop: (opts) => { calls.stop++; calls.stopArgs.push(opts || {}); },
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
    state: '() => ({ swRunning, swActiveExercise, swStartTimestamp, swTargetSeconds, swCompletionCued, swRestAuto, swRestSetNum, swInterval })',
    reset: `(session) => {
      swRunning = false; swActiveExercise = null; swStartTimestamp = null;
      swTargetSeconds = 60; swCompletionCued = false; swRestAuto = false; swInterval = null;
      swRestSetNum = null; swLastTyped = null;
      selectedSession = session;
    }`,
    typed: '(exercise, setNum, agoMs) => { swLastTyped = { exercise, setNum, at: Date.now() - (agoMs || 0) }; }',
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
  calls.stop = 0; calls.stopArgs = []; calls.vibrate = []; calls.render = []; calls.cleared = [];
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

  // ⚠️ REVERSED ON 1 SEPT 2026 AND THE FLAG CHANGED MEANING WITH IT. From 14 Aug this rest wrote
  // nothing, because it hangs on the last set and what it measures is the walk to the next machine
  // (166s onto Leg Curl set 3, 380s onto Abductor set 2, against genuine between-set rests of
  // 90–110s). Del asked for that gap back — "we have been missing out on last set rest period" — so
  // it records now, and betweenSetRests() keeps it out of every AVERAGE instead. What the flag still
  // marks is WHOSE rest it is: this one is the app's, so a failed save may take it back.
  eq(s.swRestAuto, true, 'a rest started by Mark Done is marked as the app\'s, not his');
  eq(JSON.parse(store.sw_state).auto, true,
    'and the flag is persisted, so a trip to Stats does not turn it into a hand-started rest');
}

// ── 1b. a timer the user started by hand is his ───────────────────────────
// The distinction the whole thing rests on: a hand tap is a rest he chose to start, and nothing in
// the app may end it on his behalf.
{
  fresh();
  app.swStart('Bench Press');
  eq(app.state().swRestAuto, false, 'swStart defaults to a hand-started rest');
  eq(JSON.parse(store.sw_state).auto, false, 'and says so in the persisted state');
}

// ── 1c. which set the rest belongs to is decided at the tap (C28) ─────────
// Resolved at the STOP until 1 Sept 2026, by asking the DOM for the highest set with reps in it —
// which answers correctly only if the reps were typed after the tap. Del, asked outright: "its
// mixed…depends on whats happening in the gym, chatting etc…someone may want the machine im on
// next, so i rush". So the set is captured when the rest starts instead.
{
  fresh();
  app.typed('Bench Press', 2, 3000);        // typed the reps, then reached for the watch
  app.swStart('Bench Press');
  eq(app.state().swRestSetNum, 2, 'a set typed moments before the tap is the set this rest follows');
  eq(JSON.parse(store.sw_state).set, 2, 'and it is persisted with the rest');

  // Tapped first. Nothing is claimed yet — noteSetTyped() fills it in when the reps arrive.
  fresh();
  app.swStart('Bench Press');
  eq(app.state().swRestSetNum, null, 'a tap with nothing typed yet starts unanchored');

  // Typed a long time ago: that was the set before this one, and guessing it here would be worse
  // than the fallback swStop() already has.
  fresh();
  app.typed('Bench Press', 1, 5 * 60 * 1000);
  app.swStart('Bench Press');
  eq(app.state().swRestSetNum, null, 'a set typed five minutes ago is not what this rest follows');

  // Another exercise's row. The watch is per-exercise and so is the anchor.
  fresh();
  app.typed('Incline Curl', 3, 2000);
  app.swStart('Bench Press');
  eq(app.state().swRestSetNum, null, "a set typed on a different exercise never anchors this one");
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
// ⚠️ THIS SECTION WAS INVERTED ON 31 AUG 2026, AND THE INVERSION IS THE FIX.
// It used to assert that startRestAfter() came AFTER the save-failure return — the timer started
// only once every set had been written. Del's Monday session is the bill for that: "Marked done
// didn't start last watch until I returned to the app". saveExerciseSets() is three round trips per
// exercise, and a phone that goes in a pocket mid-save is frozen by iOS with the whole chain in
// flight, so nothing starts — not the watch and not the alert booking either.
//
// The rest begins when the set ends, which is when the button is tapped. So the call moved ABOVE the
// saves, and the property the old ordering was protecting — a failed Mark Done leaves you mid-set,
// not resting — is now enforced by abandonRestAfterFailedSave() instead, which is asserted for
// behaviourally in section 7 rather than by where a line happens to sit.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const body = src.slice(src.indexOf('async function completeExercise('), src.indexOf('function startRestAfter('));

  const start = body.indexOf('startRestAfter(');
  ok(start > 0, 'completeExercise starts the rest timer');
  ok(start < body.indexOf('await saveExerciseSets('),
    'and starts it BEFORE the first network write — a pocketed phone must not owe the rest to a save');
  ok(body.indexOf('Fill in at least one set first') < start,
    'and past the nothing-typed return, so a Mark Done with nothing filled in still starts nothing');
  ok(body.indexOf('abandonRestAfterFailedSave(restFor)') > start,
    'a save that fails takes the rest back rather than leaving one running over a retry');
  ok(/const restFor = pending\[pending\.length - 1\]\.name/.test(body),
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

// ── 7. taking the rest back when the save failed (31 Aug 2026) ─────────────
// The rest now starts at the tap, so the guarantee that used to come free from the call's POSITION
// has to be paid for here instead. Three cases, and the two that must NOT stop the timer are the
// interesting ones: this runs a second or more after the tap, and by then the person may have moved.
{
  // The ordinary failure: the save 503'd, the rest this Mark Done started is taken back.
  fresh();
  app.startRestAfter('Bench Press');
  eq(app.state().swRestAuto, true, 'the auto-started rest is marked as the app\'s');
  app.abandonRestAfterFailedSave('Bench Press');
  eq(calls.stop, 1, 'a failed save stops the rest it started — the retry is the job, not the rest');
  // Every rest records since 1 Sept, so this one has to say explicitly that it does not: otherwise
  // the three seconds the failed save took would be stamped onto the last set as a rest.
  eq(calls.stopArgs[0] && calls.stopArgs[0].bank, false,
    'and it is stopped WITHOUT banking — a rest that never happened writes nothing');

  // He tapped another exercise's watch while the save was in flight. That timer is his.
  fresh();
  app.startRestAfter('Bench Press');
  app.swStart('Incline Curl');            // a manual tap: swStart's own swStop fires, hence stop === 1
  const beforeAbandon = calls.stop;
  app.abandonRestAfterFailedSave('Bench Press');
  eq(calls.stop, beforeAbandon, 'a rest that has since moved to another exercise is left alone');

  // He tapped the watch on the SAME exercise. A rest started by hand is one he chose to measure, and
  // stopping it here would write the walk-to-the-machine onto a set — the 14 Aug bug, from a new door.
  fresh();
  app.swStart('Bench Press');
  eq(app.state().swRestAuto, false, 'a hand-started rest is his');
  app.abandonRestAfterFailedSave('Bench Press');
  eq(calls.stop, 0, 'a rest he started by hand is never stopped by a failed save');
}

// ── 8. THE TAP ON THE WATCH (1 Sept 2026) ─────────────────────────────────
// Del, off Tuesday's UPPER 1: "Incline DB Fly (2/3rd set) clock didn't work". The tap used to be a
// plain start/stop toggle, and nobody stops a rest in a gym — so the timer from set 1 was still
// running when set 2 ended, and the tap he meant as "start my rest" stopped the clock and started
// nothing. He pocketed the phone with no rest running, for every set after the first.
//
// These run the REAL swStop() with a recording swSaveRest, so they assert what would reach a set row
// rather than that a function was called. swSaveRest() is invoked before swStop()'s first await, so
// the write is visible synchronously.
{
  const tapCalls = { saved: [], scheduled: [], cancelled: 0 };
  const reps = {};

  const tap = load({
    functions: ['swTapWatch', 'swStart', 'swStop', 'swElapsed', 'swFindLastTypedSetForExercise',
                'swParseRest', 'startRestAfter', 'noteSetTyped'],
    deps: {
      swRunning: false,
      swActiveExercise: null,
      swStartTimestamp: null,
      swTargetSeconds: 60,
      swCompletionCued: false,
      swRestAuto: false,
      swRestSetNum: null,
      swLastTyped: null,
      SET_TAP_WINDOW_MS: 60000,
      swInterval: null,
      swLongPressFired: false,
      selectedSession: SESSION,
      document: { getElementById: id => (id in reps ? { value: reps[id] } : null) },
      swAcquireWakeLock: () => {},
      swReleaseWakeLock: () => {},
      scheduleRestAlert: (n, s) => tapCalls.scheduled.push([n, s]),
      cancelRestAlert: () => { tapCalls.cancelled++; },
      swVibrate: () => {},
      swRenderWatch: () => {},
      swFlashWatch: () => {},
      swPaintRestLine: () => {},
      saveDraft: () => {},
      swSaveRest: (ex, n, secs) => { tapCalls.saved.push(`${ex}/${n}/${secs}`); return Promise.resolve(); },
      sessionStorage: { setItem: () => {}, removeItem: () => {}, getItem: () => null },
      setInterval: () => 1,
      clearInterval: () => {},
    },
    accessors: {
      state: '() => ({ swRunning, swActiveExercise, swRestAuto, swRestSetNum, swStartTimestamp })',
      rewind: '(ms) => { swStartTimestamp -= ms; }',
      longPress: '() => { swLongPressFired = true; }',
      reset: `() => { swRunning = false; swActiveExercise = null; swStartTimestamp = null;
        swTargetSeconds = 60; swCompletionCued = false; swRestAuto = false; swInterval = null;
        swRestSetNum = null; swLastTyped = null; }`,
    },
  });

  function freshTap() {
    tap.reset();
    tapCalls.saved = []; tapCalls.scheduled = []; tapCalls.cancelled = 0;
    Object.keys(reps).forEach(k => delete reps[k]);
    reps['r-Bench Press-1'] = '10';
    reps['r-Bench Press-2'] = '9';
  }

  // The reported bug. Rest target is 180s; the watch has been running 190s because he lifted again
  // instead of stopping it. The tap means "set 2 is done" — it must leave a rest running.
  freshTap();
  tap.swTapWatch('Bench Press');
  tap.rewind(190000);
  tap.swTapWatch('Bench Press');
  eq(tap.state().swRunning, true,
    'a tap once the ring has gone green starts the next rest — it does not kill the clock');
  eq(tap.state().swActiveExercise, 'Bench Press', 'on the same exercise');
  ok(tap.state().swStartTimestamp >= Date.now() - 1000, 'and the new period counts from this tap, not from the old start');
  eq(tapCalls.saved.length, 1, 'the period that just ended is still banked');
  eq(tapCalls.saved[0], 'Bench Press/2/190', 'onto the last set he typed — the one he has just finished');
  eq(tapCalls.scheduled.length, 2, 'and the alert is booked for the new rest as well as the old one');

  // The other half of the tap, and the reason it cannot simply always restart: ending a rest EARLY is
  // how the push gets called off before it buzzes mid-set (C11). While the ring is still counting
  // down, the tap keeps meaning stop.
  freshTap();
  tap.swTapWatch('Bench Press');
  tap.rewind(45000);                       // 45s into a 180s rest — he is ready early
  tap.swTapWatch('Bench Press');
  eq(tap.state().swRunning, false, 'a tap while the rest is still owed stops it, as it always did');
  eq(tapCalls.saved[0], 'Bench Press/2/45', 'and banks the short rest he actually took');
  ok(tapCalls.cancelled > 0, 'the push is called off — a rest ended early must not buzz during the next set');

  // Two rests never run together — Del's own answer to the design question, 1 Sept: "two rests should
  // never run together imho". Starting one on another exercise banks the first and replaces it.
  freshTap();
  tap.swTapWatch('Bench Press');
  tap.rewind(190000);
  tap.swTapWatch('Incline Curl');
  eq(tap.state().swActiveExercise, 'Incline Curl', 'the watch moves to the exercise just tapped');
  eq(tapCalls.saved[0], 'Bench Press/2/190', "and the rest it was timing is banked on the way past, not binned");
  eq(tapCalls.scheduled.length, 2, 'one alert for each rest, never two rests at once');

  // A rest Mark Done started still has to leave a clock running when it is tapped, which before
  // 1 Sept it did not — and since that morning it banks as well, onto the last set.
  freshTap();
  reps['r-Bench Press-3'] = '8';
  tap.startRestAfter('Bench Press');
  tap.rewind(190000);
  tap.swTapWatch('Bench Press');
  eq(tap.state().swRunning, true, 'the tap after a Mark Done rest has run out starts a fresh one');
  eq(tap.state().swRestAuto, false, 'and that one is his, not the app\'s');
  eq(tapCalls.saved[0], 'Bench Press/3/190', "the gap after the last set is recorded now, on the last set");

  // ── C28: THE SET THE REST LANDS ON, THROUGH THE REAL swStop() ──────────────────────────────────
  // The discriminating case, and the reason this could not be fixed by reading the DOM harder: the
  // reps for the NEXT set can already be in the boxes by the time a rest ends. Del rushes when
  // someone wants his machine.
  freshTap();
  Object.keys(reps).forEach(k => delete reps[k]);
  reps['r-Bench Press-1'] = '10';
  reps['r-Bench Press-2'] = '9';
  tap.noteSetTyped('Bench Press', 2);        // he typed set 2 …
  tap.swTapWatch('Bench Press');             // … then tapped the watch
  eq(tap.state().swRestSetNum, 2, 'the rest is anchored to set 2 at the tap');
  reps['r-Bench Press-3'] = '8';             // set 3 done and typed while the rest was still running
  tap.noteSetTyped('Bench Press', 3);
  eq(tap.state().swRestSetNum, 2, 'and a later row being typed does not move it');
  tap.rewind(100000);
  tap.swTapWatch('Incline Curl');
  eq(tapCalls.saved[0], 'Bench Press/2/100',
    'the rest lands on set 2 — the DOM read it replaced would have banked it onto set 3');

  // The other order, which the old code got right by luck: tap first, type during the rest.
  freshTap();
  Object.keys(reps).forEach(k => delete reps[k]);
  tap.swTapWatch('Bench Press');
  eq(tap.state().swRestSetNum, null, 'nothing typed yet, so nothing is claimed at the tap');
  reps['r-Bench Press-1'] = '10';
  tap.noteSetTyped('Bench Press', 1);
  eq(tap.state().swRestSetNum, 1, 'the first set typed after the tap claims the rest');
  tap.rewind(100000);
  tap.swTapWatch('Incline Curl');
  eq(tapCalls.saved[0], 'Bench Press/1/100', 'and that is the set it is banked on');

  // Neither: the set was never logged. The old DOM read is still the best guess available, so it is
  // kept as the fallback rather than dropping the rest on the floor.
  freshTap();
  Object.keys(reps).forEach(k => delete reps[k]);
  reps['r-Bench Press-1'] = '10';
  reps['r-Bench Press-2'] = '9';
  tap.swTapWatch('Bench Press');
  tap.rewind(100000);
  tap.swTapWatch('Incline Curl');
  eq(tapCalls.saved[0], 'Bench Press/2/100', 'an unanchored rest still falls back to the last typed set');

  // A rest already anchored must not be re-anchored by a keystroke on another exercise's row —
  // supersets put two blocks' inputs a thumb apart.
  freshTap();
  Object.keys(reps).forEach(k => delete reps[k]);
  tap.swTapWatch('Bench Press');
  tap.noteSetTyped('Incline Curl', 1);
  eq(tap.state().swRestSetNum, null, "typing on the other half of a superset does not claim this rest");

  // The long-press is the mis-tap escape and fires its own reset — the tap that follows it is the
  // finger coming off the button and must do nothing at all.
  freshTap();
  tap.swTapWatch('Bench Press');
  const beforeLongPress = tap.state().swStartTimestamp;
  tap.longPress();
  tap.swTapWatch('Bench Press');
  eq(tap.state().swStartTimestamp, beforeLongPress, 'a tap swallowed by a long-press changes nothing');
  eq(tapCalls.saved.length, 0, 'and banks nothing');
}

process.on('exit', () => {
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});
