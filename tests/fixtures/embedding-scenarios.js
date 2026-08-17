// The scenarios the embedding change has to survive, run against a source file of your choosing.
//
// Shared by `capture-embedding-baseline.js` (which points it at the pre-change js/app.js out of git)
// and `embedding.test.js` (which points it at the live one). Both sides run the *same* scenarios
// against the *same* fake database, which is the only reason the comparison means anything — if the
// scenario list lived in the test and the capture script had its own copy, they would drift.
//
// Each scenario returns `{ result, requests }`: what the function produced, and every path it asked
// the database for. Both halves matter — the change is only correct if the data is identical AND the
// round trips went down.

const { load } = require('../extract');
const { makeSb } = require('./fake-postgrest');

// One fresh extraction per scenario, so the recorded request list and the lifted `let`s
// (previousSets, allHistoryWorkouts) can't leak from one scenario into the next.
function loadApp(file, sb) {
  return load({
    file,
    functions: [
      'realWorkoutsBetween',
      'fetchOpenPreviousSets',
      'loadPreviousSetsForSession',
      'fetchLastSessionSnapshot',
      'loadHistory',
    ],
    decls: ['previousSets', 'currentWorkoutId', 'allHistoryLogs', 'allHistoryWorkouts'],
    deps: {
      sb,
      // loadHistory paints a loading state and then hands off to the renderer. Neither is what's
      // under test here; what matters is the three globals it leaves behind.
      document: { getElementById: () => ({ innerHTML: '' }) },
      window: {},
      computeExerciseProgress: () => null,
      restoreHistoryFilters: () => {},
      renderHistoryPage: () => {},
      SESSIONS: [{ id: 'lower-a' }, { id: 'upper-a' }, { id: 'open' }],
    },
    accessors: {
      prevSets: '() => previousSets',
      setCurrentWorkoutId: '(v) => { currentWorkoutId = v; }',
      historyState: '() => ({ logs: allHistoryLogs, workouts: allHistoryWorkouts, setsByWorkout: window._setsByWorkout, cardioByWorkout: window._cardioByWorkout })',
    },
  });
}

// name → async (app) => result. `app` is the freshly extracted module.
const SCENARIOS = {
  'realWorkoutsBetween: open-ended range': async app =>
    app.realWorkoutsBetween('2026-08-01'),

  // w3 has no sets and no cardio and is kept alive purely by its notes (CV + Pump); w4 has nothing
  // at all and must be dropped; w6's notes are whitespace, so it survives on its sets alone.
  'realWorkoutsBetween: bounded range': async app =>
    app.realWorkoutsBetween('2026-08-05', '2026-08-09'),

  'realWorkoutsBetween: nothing in range': async app =>
    app.realWorkoutsBetween('2026-09-01'),

  // Lat Pulldown was Narrow last time (w6) and Wide the time before (w2). Both have to come back,
  // or a variation you didn't use most recently silently loses its prev badges.
  'loadPreviousSetsForSession: fixed session, two variations': async app => {
    await app.loadPreviousSetsForSession({ id: 'upper-a', exercises: [{ name: 'Lat Pulldown' }] });
    return app.prevSets();
  },

  // The session in progress must never be its own "last time".
  'loadPreviousSetsForSession: excludes the workout in progress': async app => {
    app.setCurrentWorkoutId('w6');
    await app.loadPreviousSetsForSession({ id: 'upper-a', exercises: [{ name: 'Lat Pulldown' }] });
    return app.prevSets();
  },

  'loadPreviousSetsForSession: no history for this session type': async app => {
    await app.loadPreviousSetsForSession({ id: 'full-body-a', exercises: [{ name: 'Dips' }] });
    return app.prevSets();
  },

  // Routed through to fetchOpenPreviousSets. w8 is an uncompleted Open workout and must be ignored,
  // so Hammer Curl's prev comes from w5 at 14kg, not w8 at 16kg.
  'loadPreviousSetsForSession: open workout': async app => {
    await app.loadPreviousSetsForSession({
      id: 'open',
      exercises: [{ name: 'Hammer Curl' }, { name: 'Lat Pulldown' }, { name: 'Never Done This' }],
    });
    return app.prevSets();
  },

  'fetchOpenPreviousSets: directly': async app =>
    app.fetchOpenPreviousSets(['Hammer Curl', 'Lat Pulldown']),

  'fetchOpenPreviousSets: no exercises picked yet': async app =>
    app.fetchOpenPreviousSets([]),

  'fetchLastSessionSnapshot: sets only': async app =>
    app.fetchLastSessionSnapshot({ id: 'upper-a' }),

  // The most recent *completed* lower-a is w4, which is the abandoned one — so the card gets a real
  // date and no exercises. w7 is more recent but was never completed.
  'fetchLastSessionSnapshot: a session with nothing logged in it': async app =>
    app.fetchLastSessionSnapshot({ id: 'lower-a' }),

  'fetchLastSessionSnapshot: never trained': async app =>
    app.fetchLastSessionSnapshot({ id: 'full-body-a' }),

  'loadHistory': async app => {
    await app.loadHistory();
    return app.historyState();
  },
};

async function runScenarios(file) {
  const out = {};
  for (const [name, fn] of Object.entries(SCENARIOS)) {
    const { sb, requests } = makeSb();
    const app = loadApp(file, sb);
    const result = await fn(app);
    out[name] = { result: result === undefined ? null : result, requests };
  }
  return out;
}

module.exports = { runScenarios, SCENARIO_NAMES: Object.keys(SCENARIOS) };
