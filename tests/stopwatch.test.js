// The rest timer: tap starts, tap stops and writes, hold clears.
//
// Replaces auto-rest.test.js. §6 is a source census — it fails if anything is added that starts or
// stops the clock without a tap, or that tries to cue the end of a rest with a sound, a vibration or
// a notification. No behavioural test would notice either on its own.
//
// Run: node tests/stopwatch.test.js

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

console.log('the watch: tap starts, tap stops, hold clears');

const SESSION = {
  id: 'upper-a',
  exercises: [
    { name: 'Bench Press', sets: 3, rest: '180s' },
    { name: 'Incline Curl', sets: 3, rest: '90s' },
    { name: 'Pallof Press', sets: 3 },   // no rest field — the template doesn't always carry one
  ],
};

// The real swStop() runs here, with a recording swSaveRest, so every assertion is about what would
// reach a set ROW rather than which function was called. swSaveRest() is invoked before swStop()'s
// first await, so the write is visible synchronously.
const calls = { saved: [], render: [] };
const reps = {};
const store = {};

const app = load({
  functions: ['swTapWatch', 'swStart', 'swStop', 'swReset', 'swElapsed',
              'swFindLastTypedSetForExercise', 'swParseRest'],
  deps: {
    swRunning: false,
    swActiveExercise: null,
    swStartTimestamp: null,
    swTargetSeconds: 60,
    swInterval: null,
    swLongPressFired: false,
    selectedSession: SESSION,
    document: { getElementById: id => (id in reps ? { value: reps[id] } : null) },
    swRenderWatch: n => calls.render.push(n),
    swFlashWatch: () => {},
    swPaintRestLine: () => {},
    saveDraft: () => {},
    swSaveRest: (ex, n, secs) => { calls.saved.push(`${ex}/${n}/${secs}`); return Promise.resolve(); },
    sessionStorage: {
      setItem: (k, v) => { store[k] = v; },
      removeItem: k => { delete store[k]; },
      getItem: k => (k in store ? store[k] : null),
    },
    setInterval: () => 1,
    clearInterval: () => {},
  },
  accessors: {
    state: '() => ({ swRunning, swActiveExercise, swStartTimestamp, swTargetSeconds })',
    rewind: '(ms) => { swStartTimestamp -= ms; }',
    longPress: '() => { swLongPressFired = true; }',
    reset: `() => { swRunning = false; swActiveExercise = null; swStartTimestamp = null;
      swTargetSeconds = 60; swInterval = null; swLongPressFired = false; }`,
  },
});

function fresh() {
  app.reset();
  calls.saved = []; calls.render = [];
  Object.keys(store).forEach(k => delete store[k]);
  Object.keys(reps).forEach(k => delete reps[k]);
  reps['r-Bench Press-1'] = '10';
  reps['r-Bench Press-2'] = '9';
}

// ── 1. the tap starts a rest ───────────────────────────────────────────────
{
  fresh();
  const before = Date.now();
  app.swTapWatch('Bench Press');
  const s = app.state();

  eq(s.swRunning, true, 'a tap on an idle watch starts the rest');
  eq(s.swActiveExercise, 'Bench Press', 'attached to the exercise whose watch was tapped');
  ok(s.swStartTimestamp >= before, 'counting from this tap');
  eq(s.swTargetSeconds, 180, "with the target off the exercise's own rest field");
  eq(calls.render.length, 1, 'the watch is painted at once, not a second later on the interval');
  eq(JSON.parse(store.sw_state).exercise, 'Bench Press',
    'the rest is persisted, so a trip to Stats and back does not lose it');
  eq(Object.keys(JSON.parse(store.sw_state)).sort().join(','), 'exercise,start,target',
    'and the persisted state carries the clock and nothing else');

  // An exercise with no rest field still counts, against a 60s default.
  fresh();
  app.swTapWatch('Pallof Press');
  eq(app.state().swTargetSeconds, 60, 'no rest field falls back to 60s');
  eq(app.swParseRest('90s'), 90, "'90s' reads as 90");
  eq(app.swParseRest(undefined), 60, 'and a missing value as the default');
}

// ── 2. the second tap stops it and writes what elapsed ─────────────────────
{
  fresh();
  app.swTapWatch('Bench Press');
  app.rewind(95000);
  app.swTapWatch('Bench Press');

  eq(app.state().swRunning, false, 'the second tap stops the clock');
  eq(app.state().swActiveExercise, null, 'and lets the watch go');
  eq(calls.saved.length, 1, 'the rest is written once');
  eq(calls.saved[0], 'Bench Press/2/95', 'onto the highest set with reps in it — 95 seconds');
  eq(store.sw_state, undefined, 'and nothing is left persisted');

  // A stop with nothing typed for the exercise has no set to hang on, and writes nothing.
  fresh();
  Object.keys(reps).forEach(k => delete reps[k]);
  app.swTapWatch('Bench Press');
  app.rewind(60000);
  app.swTapWatch('Bench Press');
  eq(calls.saved.length, 0, 'a rest with no typed set to attach to is not written anywhere');
}

// ── 3. a tap once the ring is green STOPS — it does not restart ────────────
// The tap means the same thing at every point in a rest. Nothing about the clock's state changes it.
{
  fresh();
  app.swTapWatch('Bench Press');
  app.rewind(240000);                       // 240s into a 180s rest
  app.swTapWatch('Bench Press');

  eq(app.state().swRunning, false, 'a tap past the target stops the clock like any other tap');
  eq(calls.saved[0], 'Bench Press/2/240', 'and the long rest is written, not discarded');

  fresh();
  app.swTapWatch('Bench Press');            // start
  app.rewind(200000);
  app.swTapWatch('Bench Press');            // stop
  app.swTapWatch('Bench Press');            // start again — the watch was idle
  eq(app.state().swRunning, true, 'a third tap starts a new rest, because the watch was idle');
  eq(calls.saved.length, 1, 'and the only thing written is the one rest that ran');
}

// ── 4. moving to another exercise ──────────────────────────────────────────
{
  fresh();
  app.swTapWatch('Bench Press');
  app.rewind(120000);
  app.swTapWatch('Incline Curl');

  eq(app.state().swActiveExercise, 'Incline Curl', 'the watch moves to the exercise just tapped');
  eq(app.state().swTargetSeconds, 90, "with that exercise's target");
  eq(calls.saved[0], 'Bench Press/2/120', 'and the rest it was timing is written on the way past');
}

// ── 5. the long press clears without writing ───────────────────────────────
{
  fresh();
  app.swTapWatch('Bench Press');
  app.rewind(50000);
  app.swReset();
  eq(app.state().swRunning, false, 'a long press clears the clock');
  eq(calls.saved.length, 0, 'and writes nothing');
  eq(store.sw_state, undefined, 'and clears the persisted state');

  fresh();
  app.swTapWatch('Bench Press');
  const t = app.state().swStartTimestamp;
  app.longPress();
  app.swTapWatch('Bench Press');
  eq(app.state().swStartTimestamp, t, 'the tap that follows a long press changes nothing');
  eq(calls.saved.length, 0, 'and writes nothing');
}

// ── 6. the census ──────────────────────────────────────────────────────────
// Comment lines are dropped first, so this is a claim about code and not about prose.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const strip = s => s.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const code = strip(src);
  const swCode = strip(sw);

  // Nothing starts or stops the clock except a tap.
  for (const gone of ['startRestAfter', 'abandonRestAfterFailedSave', 'noteSetTyped',
                      'swRestAuto', 'swRestSetNum', 'swLastTyped', 'SET_TAP_WINDOW_MS']) {
    ok(!code.includes(gone), `${gone} is not in app.js`);
  }
  eq(code.split('swStart(').length - 1, 2, 'swStart is called from one place only — swTapWatch');
  eq(code.split('swTapWatch(').length - 1, 2, 'and swTapWatch from one place only — the watch button');
  ok(/async function swStop\(\)/.test(code), 'swStop takes no arguments — every stop writes');

  const done = code.slice(code.indexOf('async function completeExerciseInner('),
                          code.indexOf('function selectEditVariation('));
  ok(done.length > 200, 'completeExerciseInner was found in the source');
  ok(!/swStart\(|swStop\(|swReset\(/.test(done), 'Mark Done neither starts nor stops the rest timer');

  // No cue but the ring: no sound, no vibration, no notification, no push, no wake lock, and no
  // permission prompt in either file.
  for (const [re, label] of [
    [/AudioContext|webkitAudioContext|swBeep|new Audio\(/, 'audio'],
    [/navigator\.vibrate|swVibrate/, 'vibration'],
    [/showNotification|Notification\.|requestPermission/, 'notifications'],
    [/pushManager|PushManager|addEventListener\('push'|push_subscriptions|rest_alerts/, 'push'],
    [/wakeLock|swAcquireWakeLock|swReleaseWakeLock/, 'wake lock'],
  ]) {
    ok(!re.test(code), `no ${label} anywhere in app.js`);
    ok(!re.test(swCode), `no ${label} anywhere in sw.js`);
  }
}

process.on('exit', () => {
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});
