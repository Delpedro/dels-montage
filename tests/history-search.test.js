// E15 — the History search reads the whole workout tile, not just the notes.
//
// Del, 26 Aug: "Ive noticed the search on history is only for notes, can this not be for the entire
// tile that includes exercises?". filterHistoryData() matched `notes` and the session name, so
// typing an exercise name emptied the feed even though every card on it listed that exercise.
//
// Asserted on what filterHistoryData() RETURNS — the workouts the feed would draw — and on the
// string workoutSearchText() builds. Nothing here checks that something was called.
//
// Run: node tests/history-search.test.js

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

const win = {};
const app = load({
  functions: ['filterHistoryData', 'getDateRangeFilter', 'workoutSearchText',
              'sessionDisplayName', 'cardioDisplayName', 'getWeekStart', 'weekIndex', 'dateStr'],
  decls: ['CARDIO_DISPLAY_NAMES', 'SESSIONS', 'historyTab', 'historyDateRange',
          'historyWorkoutFilter', 'historySearchTerm', 'allHistoryLogs', 'allHistoryWorkouts'],
  deps: { window: win },
  accessors: {
    seed: `(o) => {
      SESSIONS = o.sessions || [];
      allHistoryWorkouts = o.workouts || [];
      allHistoryLogs = o.logs || [];
      historySearchTerm = o.search || '';
      historyTab = o.tab || 'all';
      historyDateRange = 'all';
      historyWorkoutFilter = 'all';
    }`,
  },
});

const SESSIONS = [
  { id: 'push-a', name: 'Push A' },
  { id: 'pull-b', name: 'Pull B' },
];

// Three workouts. Only the middle one has a note; the search terms under test live in the sets and
// the cardio, which is exactly the case that used to return nothing.
const WORKOUTS = [
  { id: 'w1', date: '2026-08-24', session_type: 'push-a', notes: '' },
  { id: 'w2', date: '2026-08-22', session_type: 'pull-b', notes: 'shoulder felt tight' },
  { id: 'w3', date: '2026-08-20', session_type: 'open', notes: '' },
];
const SETS = {
  w1: [
    { exercise: 'Lateral Raise', variation: 'Machine', weight: 52, reps: 12 },
    { exercise: 'Incline Bench Press', variation: '', weight: 40, reps: 8 },
  ],
  w2: [
    { exercise: 'Lat Pulldown', variation: 'Wide Grip', weight: 60, reps: 10 },
  ],
  w3: [
    { exercise: 'DeadHang', variation: '', weight: null, reps: 42 },
  ],
};
const CARDIO = {
  w3: [{ activity: 'Stepper', duration_mins: 20 }],
};

function seed(search, tab) {
  win._setsByWorkout = SETS;
  win._cardioByWorkout = CARDIO;
  app.seed({ sessions: SESSIONS, workouts: WORKOUTS, logs: LOGS, search, tab });
}
const LOGS = [
  { date: '2026-08-24', weight_kg: 79.9, notes: 'slept badly' },
  { date: '2026-08-22', weight_kg: 80.1, notes: '' },
];
const ids = search => { seed(search); return app.filterHistoryData().workouts.map(w => w.id); };

// ═══════════════════════════════════════════════════════════════════════════
console.log('E15 — an exercise name finds the workouts that logged it');
// ═══════════════════════════════════════════════════════════════════════════
{
  deep(ids('lateral raise'), ['w1'], 'the lift Del named finds its workout — it used to find none');
  deep(ids('Lateral'), ['w1'], 'a partial name matches too');
  deep(ids('LATERAL RAISE'), ['w1'], 'and the match is case-insensitive both ways');
  deep(ids('deadhang'), ['w3'], 'a lift on an Open Workout, which has no template, still matches');
  deep(ids('press'), ['w1'], 'a word from the middle of a name matches');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('E15 — the rest of the tile');
// ═══════════════════════════════════════════════════════════════════════════
{
  deep(ids('wide grip'), ['w2'], 'the variation printed beside the lift matches');
  deep(ids('machine'), ['w1'], 'so does a variation on another card');
  deep(ids('stairmaster'), ['w3'], 'cardio matches on the name the card PRINTS (Stepper → Stairmaster)');
  deep(ids('stepper'), ['w3'], 'and on the raw activity Del might type instead');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('E15 — nothing that worked before stopped working');
// ═══════════════════════════════════════════════════════════════════════════
{
  deep(ids('shoulder felt tight'), ['w2'], 'the workout note still matches');
  deep(ids('Pull B'), ['w2'], 'the session name still matches');
  deep(ids('Open Workout'), ['w3'], 'including the one sessionDisplayName() invents');
  deep(ids('kettlebell'), [], 'a term on no card still returns nothing');

  seed('');
  deep(app.filterHistoryData().workouts.map(w => w.id), ['w1', 'w2', 'w3'],
    'an empty search is not a filter at all');

  // Daily logs are deliberately unchanged: a check-in tile is numbers plus a note.
  seed('slept badly');
  deep(app.filterHistoryData().logs.map(l => l.date), ['2026-08-24'],
    'a check-in still matches on its note');
  seed('lateral raise');
  deep(app.filterHistoryData().logs.map(l => l.date), [],
    'and an exercise name does not drag check-ins into the results');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('E15 — a workout with nothing loaded against it');
// ═══════════════════════════════════════════════════════════════════════════
{
  // loadHistory() only writes a key for a workout that HAS rows, so a lookup miss is normal, not an
  // error state. It must read as "no text to match", never throw on the undefined.
  win._setsByWorkout = {};
  win._cardioByWorkout = {};
  app.seed({ sessions: SESSIONS, workouts: WORKOUTS, logs: LOGS, search: 'lateral raise' });
  deep(app.filterHistoryData().workouts.map(w => w.id), [],
    'no sets in memory means no match, and no crash');

  app.seed({ sessions: SESSIONS, workouts: WORKOUTS, logs: LOGS, search: 'push a' });
  deep(app.filterHistoryData().workouts.map(w => w.id), ['w1'],
    'the session name still carries the card on its own');

  // A row can carry a null exercise or variation. Neither may become the string "null".
  win._setsByWorkout = { w1: [{ exercise: null, variation: null }] };
  ok(!app.workoutSearchText(WORKOUTS[0]).includes('null'),
    'a null exercise or variation contributes nothing — never the string "null"');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
