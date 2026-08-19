// The scenarios the embedding change has to survive, run against a source file of your choosing.
//
// Shared by `capture-embedding-baseline.js` (which points it at the pre-change js/app.js out of git)
// and `embedding.test.js` (which points it at the live one). Both sides run the *same* scenarios
// against the *same* fake database, which is the only reason the comparison means anything — if the
// scenario list lived in the test and the capture script had its own copy, they would drift.
//
// The previous-sets paths (loadPreviousSetsForSession / the old fetchOpenPreviousSets) left this
// file on 19 Aug 2026. They were rewritten that day to look up history BY EXERCISE rather than by
// session type, so they no longer return what this baseline froze, and holding them to it would be
// holding them to the bug. They are covered in full by tests/exercise-scoped-history.test.js,
// including the single-request budget this file used to guard.
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
      'fetchLastSessionSnapshot',
      'loadHistory',
    ],
    decls: ['currentWorkoutId', 'allHistoryLogs', 'allHistoryWorkouts'],
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
