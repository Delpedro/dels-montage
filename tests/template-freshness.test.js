// Templates going stale on a second device — Del's 24 Aug question: "how long does an edit with the
// pencil take to reflect in a workout I'm doing today? It's not happening straight away."
//
// The answer was: never, on that device. SESSIONS was read once by initApp() and nothing re-read it
// except the device that did the editing — the ✎ editor calls loadSessionTemplates() on its way out,
// so locally it looked instant. Edit on the laptop, train off a phone whose PWA has been sitting
// resumed since yesterday, and the phone logs yesterday's template with nothing on screen to say so.
// checkForUpdate() doesn't cover it: that reloads on a new BUILD, not on new DATA.
//
// Two phones on one account is the normal case once this is on the stores, so this stops being Del's
// quirk and becomes a refund. Fixed by re-reading on foreground and on every visit to the Workout tab.
//
// Run: node tests/template-freshness.test.js

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
function deep(actual, expected, label) {
  ok(JSON.stringify(actual) === JSON.stringify(expected),
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log('template freshness');

const tmpl = (id, name) => ({ id, name, focus: 'f', programme: 'upper-lower', sort_order: 0 });
const ex = (session_id, name, sort_order, sets = 3) =>
  ({ session_id, name, sets, reps: '8-12', rest: '90s', sort_order });

// What the server currently holds. Cases rewrite these two.
let serverTemplates = [tmpl('lower-b', 'Lower B')];
let serverExercises = [ex('lower-b', 'RDL', 0), ex('lower-b', 'Leg Curl', 1)];
let readsFail = false;

const calls = { gets: [], grids: 0, libraries: 0 };
let gridDisplay = 'grid';
let loginActive = false;

const app = load({
  functions: ['loadSessionTemplates', 'refreshSessionTemplates', 'templateFingerprint'],
  decls: ['SESSIONS', 'EXERCISE_LIBRARY', 'selectedProgramme',
    'TEMPLATE_REFRESH_THROTTLE_MS', 'templateRefreshRunning', 'lastTemplateRefresh'],
  deps: {
    // Mirrors the real sb(): a failed GET comes back as [], it does not throw. That is the whole
    // reason loadSessionTemplates() had to stop assigning its result unconditionally.
    sb: async (path) => {
      calls.gets.push(path);
      if (readsFail) return [];
      return path.startsWith('session_templates') ? serverTemplates : serverExercises;
    },
    buildExerciseLibrary: () => { calls.libraries++; return {}; },
    buildSessionGrid: async () => { calls.grids++; },
    document: {
      documentElement: { classList: { contains: () => loginActive } },
      getElementById: () => ({ style: { display: gridDisplay } }),
    },
  },
  accessors: {
    sessions: '() => SESSIONS',
    setSessions: '(s) => { SESSIONS = s; }',
    setClock: '(t) => { lastTemplateRefresh = t; }',
    throttle: '() => TEMPLATE_REFRESH_THROTTLE_MS',
  },
});

function reset() {
  calls.gets = []; calls.grids = 0; calls.libraries = 0;
  gridDisplay = 'grid';
  loginActive = false;
  readsFail = false;
  serverTemplates = [tmpl('lower-b', 'Lower B')];
  serverExercises = [ex('lower-b', 'RDL', 0), ex('lower-b', 'Leg Curl', 1)];
  app.setClock(0);
}

async function cases() {
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('  a failed read never blanks the session grid');
  // ═══════════════════════════════════════════════════════════════════════════
  // This is what makes running the refresh on every foreground safe. A gym-basement connection
  // returns [] from both selects; before the guard that [] went straight onto SESSIONS and the
  // picker rendered empty — the app looking broken because the phone lost signal for a second.
  {
    reset();
    await app.loadSessionTemplates();
    eq(app.sessions().length, 1, 'a good read loads the template');

    readsFail = true;
    const stillLoaded = await app.loadSessionTemplates();
    eq(stillLoaded, false, 'the failed read reports itself as a failure');
    eq(app.sessions().length, 1, 'and the sessions already in hand survive it');

    readsFail = false;
    // The one time an empty read is real: a brand-new account with nothing set up yet.
    app.setSessions([]);
    serverTemplates = [];
    serverExercises = [];
    eq(await app.loadSessionTemplates(), true, 'an empty read on an empty app is a legitimate load');
    deep(app.sessions(), [], 'and leaves it empty rather than refusing');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('  a foreground picks up an edit made on another device');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    reset();
    await app.loadSessionTemplates();
    app.setClock(0);
    calls.grids = 0; calls.libraries = 0;

    // The laptop adds Hack Squat to Lower B while this device sits resumed on the Workout tab.
    serverExercises = [...serverExercises, ex('lower-b', 'Hack Squat', 2)];
    await app.refreshSessionTemplates();

    deep(app.sessions()[0].exercises.map(e => e.name), ['RDL', 'Leg Curl', 'Hack Squat'],
      'the foreground read brings the new exercise down');
    eq(calls.grids, 1, 'and the picker is repainted so the tile is right before it is tapped');
    eq(calls.libraries, 1, 'EXERCISE_LIBRARY is rebuilt with it — Open Workout offers the new lift too');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('  a refresh that changed nothing changes nothing');
  // ═══════════════════════════════════════════════════════════════════════════
  // Every foreground calls this, and most of them find the templates exactly as they were. Tearing
  // the grid down and rebuilding it each time would be a flicker under his thumb for no reason.
  {
    reset();
    await app.loadSessionTemplates();
    app.setClock(0);
    calls.grids = 0; calls.libraries = 0;

    await app.refreshSessionTemplates();
    eq(calls.grids, 0, 'an unchanged template does not repaint the grid');
    eq(calls.libraries, 0, 'nor rebuild the library');

    // The fingerprint has to notice more than membership — set counts, reps, rest and supersets are
    // all editable in the ✎ editor and all change what the logger draws.
    app.setClock(0);
    serverExercises = [ex('lower-b', 'RDL', 0, 4), ex('lower-b', 'Leg Curl', 1)];
    await app.refreshSessionTemplates();
    eq(calls.grids, 1, 'a changed set count counts as a change');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('  it cannot disturb a session in progress');
  // ═══════════════════════════════════════════════════════════════════════════
  // The logger works off its own clone (selectSession clones before mutating), so a refresh mid-
  // workout is invisible by design — today's session picks the edit up next time the tile is tapped.
  // What must NOT happen is buildSessionGrid() running behind the logger: it re-reads the week's
  // workouts to redo the done states, which is a round trip spent on a panel nobody can see.
  {
    reset();
    await app.loadSessionTemplates();
    app.setClock(0);
    calls.grids = 0;

    gridDisplay = 'none';
    serverExercises = [...serverExercises, ex('lower-b', 'Hack Squat', 2)];
    await app.refreshSessionTemplates();

    eq(calls.grids, 0, 'no grid rebuild while the logger is on screen');
    eq(app.sessions()[0].exercises.length, 3, 'but SESSIONS is still brought up to date underneath it');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('  throttled, and never fired where it would do harm');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    reset();
    await app.loadSessionTemplates();
    calls.gets = [];

    // visibilitychange, pageshow and a tap on the Workout tab can all land within a second of each
    // other. One read is the right number.
    await app.refreshSessionTemplates();
    const afterFirst = calls.gets.length;
    await app.refreshSessionTemplates();
    eq(calls.gets.length, afterFirst, 'a second call inside the throttle window is a no-op');
    await app.refreshSessionTemplates(true);
    ok(calls.gets.length > afterFirst, 'force skips the throttle');
    eq(app.throttle(), 30000, 'the window is 30s');

    // sb() with no session calls forceLogout(). A background refresh on the login screen would
    // therefore boot him out of an app he is trying to get into.
    reset();
    await app.loadSessionTemplates();
    calls.gets = [];
    loginActive = true;
    await app.refreshSessionTemplates(true);
    eq(calls.gets.length, 0, 'nothing is fetched behind the login overlay');

    // Before initApp() finishes there is nothing to go stale, and a second read would only race it.
    reset();
    app.setSessions([]);
    calls.gets = [];
    await app.refreshSessionTemplates(true);
    eq(calls.gets.length, 0, 'nothing is fetched before the first load has happened');
  }
}

cases().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
});
