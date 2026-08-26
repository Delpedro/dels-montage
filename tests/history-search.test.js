// E15 — find-in-history. The search reads the whole tile AND goes to the hit.
//
// Del asked for the first half — "Ive noticed the search on history is only for notes, can this not
// be for the entire tile that includes exercises?" — then rejected the result: "na, this needs to be
// better, like when you do ctrl+f on a pc, it needs to go to the finding". Filtering the feed to the
// cards that match is not finding: a Push A card lists eight lifts and he still had to read all
// eight. So every hit is now wrapped in a <mark> where it sits and the page scrolls to one of them.
//
// The two halves have to agree, and that is what most of this file guards: the haystack a card is
// FILTERED on must be exactly the text the card PRINTS, or a card comes back with nothing marked on
// it and the counter disagrees with the screen. Both sides go through formatCardioEntry() and
// historyCardDate() for that reason.
//
// Everything here asserts what a function RETURNS — the workouts the feed would draw, the markup a
// cell would print. Nothing checks that something was called. (The DOM half — which mark carries
// .on, the scroll, the bar — is Del's UAT; there is no DOM in these tests.)
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
  functions: ['filterHistoryData', 'getDateRangeFilter', 'workoutSearchText', 'logSearchText',
              'hlSearch', 'historyCardDate', 'esc', 'formatCardioEntry', 'cardioDetailParts',
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
    setTerm: `(t) => { historySearchTerm = t; }`,
  },
});

const SESSION_LIST = [
  { id: 'push-a', name: 'Push A' },
  { id: 'pull-b', name: 'Pull B' },
];

// Three workouts. Only the middle one has a note; the terms under test live in the sets, the cardio
// and the dates — exactly the text the old notes-only search could not see.
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
  w2: [{ exercise: 'Lat Pulldown', variation: 'Wide Grip', weight: 60, reps: 10 }],
  w3: [{ exercise: 'DeadHang', variation: '', weight: null, reps: 42 }],
};
const CARDIO = { w3: [{ activity: 'Stepper', duration_mins: 20, floors: 90 }] };
const LOGS = [
  { date: '2026-08-24', weight_kg: 79.9, notes: 'slept badly' },
  { date: '2026-08-22', weight_kg: 80.1, notes: '' },
];

function seed(search, tab) {
  win._setsByWorkout = SETS;
  win._cardioByWorkout = CARDIO;
  app.seed({ sessions: SESSION_LIST, workouts: WORKOUTS, logs: LOGS, search, tab });
}
const ids = search => { seed(search); return app.filterHistoryData().workouts.map(w => w.id); };
const logDates = search => { seed(search); return app.filterHistoryData().logs.map(l => l.date); };

// ═══════════════════════════════════════════════════════════════════════════
console.log('E15 — an exercise name finds the workouts that logged it');
// ═══════════════════════════════════════════════════════════════════════════
{
  deep(ids('lateral raise'), ['w1'], 'the lift Del named finds its workout — it used to find none');
  deep(ids('Lateral'), ['w1'], 'a partial name matches too');
  deep(ids('LATERAL RAISE'), ['w1'], 'and the match is case-insensitive both ways');
  deep(ids('deadhang'), ['w3'], 'a lift on an Open Workout, which has no template, still matches');
  deep(ids('press'), ['w1'], 'a word from the middle of a name matches');
  deep(ids('wide grip'), ['w2'], 'the variation printed beside the lift matches');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('E15 — the haystack is exactly what the card prints');
// ═══════════════════════════════════════════════════════════════════════════
{
  // The rule that stops the filter and the highlight disagreeing. A card that matched on text it
  // does not display would arrive with nothing marked on it, and the counter would be wrong.
  const printed = app.formatCardioEntry(CARDIO.w3[0]);
  eq(printed, 'Stairmaster 20min, 90 floors', 'the cardio line as the card prints it');
  ok(app.workoutSearchText(WORKOUTS[2]).includes(printed.toLowerCase()),
    'and the haystack contains that exact line, not the raw row');

  deep(ids('stairmaster'), ['w3'], 'so the printed cardio name matches');
  deep(ids('90 floors'), ['w3'], 'and so does a detail printed on the same line');
  deep(ids('stepper'), [], 'the RAW activity does not — the card says Stairmaster, and you find what you can see');

  const cardDate = app.historyCardDate('2026-08-24');
  eq(cardDate, 'Mon 24 Aug', 'the date as the card prints it');
  ok(app.workoutSearchText(WORKOUTS[0]).includes(cardDate.toLowerCase()),
    'the haystack carries the printed date, through the same function');
  deep(ids('24 aug'), ['w1'], 'so a date finds its workout');
  deep(logDates('24 aug'), ['2026-08-24'], 'and its check-in');
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

  deep(logDates('slept badly'), ['2026-08-24'], 'a check-in still matches on its note');
  deep(logDates('lateral raise'), [],
    'and an exercise name does not drag check-ins into the results');
  deep(logDates('79.9'), [],
    'nor does a number off the check-in — the tile is numbers and matching them would bury him');
  deep(logDates('check-in'), ['2026-08-24', '2026-08-22'],
    'the header the card actually prints does match, both of them');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('E15 — a workout with nothing loaded against it');
// ═══════════════════════════════════════════════════════════════════════════
{
  // loadHistory() only writes a key for a workout that HAS rows, so a lookup miss is normal, not an
  // error state. It must read as "no text to match", never throw on the undefined.
  win._setsByWorkout = {};
  win._cardioByWorkout = {};
  app.seed({ sessions: SESSION_LIST, workouts: WORKOUTS, logs: LOGS, search: 'lateral raise' });
  deep(app.filterHistoryData().workouts.map(w => w.id), [],
    'no sets in memory means no match, and no crash');

  app.seed({ sessions: SESSION_LIST, workouts: WORKOUTS, logs: LOGS, search: 'push a' });
  deep(app.filterHistoryData().workouts.map(w => w.id), ['w1'],
    'the session name still carries the card on its own');

  // A row can carry a null exercise or variation. Neither may become the string "null".
  win._setsByWorkout = { w1: [{ exercise: null, variation: null }] };
  ok(!app.workoutSearchText(WORKOUTS[0]).includes('null'),
    'a null exercise or variation contributes nothing — never the string "null"');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('Ctrl+F — hlSearch marks the hit in place');
// ═══════════════════════════════════════════════════════════════════════════
{
  const hl = (text, term) => { app.setTerm(term); return app.hlSearch(text); };

  eq(hl('Lateral Raise', ''), 'Lateral Raise', 'no search term: plain escaped text, no markup');
  eq(hl('Lateral Raise', 'lateral'), '<mark class="hl">Lateral</mark> Raise',
    'the hit is wrapped where it sits, and keeps the ORIGINAL casing, not the typed casing');
  eq(hl('Lateral Raise', 'RAISE'), 'Lateral <mark class="hl">Raise</mark>',
    'a shouted term still matches the cased text');
  eq(hl('press up press down', 'press'),
    '<mark class="hl">press</mark> up <mark class="hl">press</mark> down',
    'every occurrence is marked, not just the first — that is what makes a counter possible');
  eq(hl('Lateral Raise', 'squat'), 'Lateral Raise', 'a term that is not there changes nothing');

  // The reason hlSearch searches the RAW text and escapes each slice, rather than escaping first.
  eq(hl(`Del's press`, `del's`), `<mark class="hl">Del&#39;s</mark> press`,
    "an apostrophe in the term matches, and comes back escaped — escaping first would hunt for &#39;");
  eq(hl('Squat & Press', '&'), 'Squat <mark class="hl">&amp;</mark> Press',
    'and so does an ampersand');
  eq(hl('<script>alert(1)</script>', 'script'),
    '&lt;<mark class="hl">script</mark>&gt;alert(1)&lt;/<mark class="hl">script</mark>&gt;',
    'markup in the data is still escaped — the only tags in the output are the ones hlSearch put there');
  eq(hl('a<b>c', 'b'), 'a&lt;<mark class="hl">b</mark>&gt;c',
    'a term that only matches inside escaped markup does not break the escaping');

  eq(hl(null, 'x'), '', 'a null cell is empty, not "null"');
  eq(hl(undefined, 'x'), '', 'and so is an undefined one');
  eq(hl(0, '0'), '<mark class="hl">0</mark>', 'a number is text, and 0 is not treated as absent');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('Ctrl+F — a filtered card always has something to mark');
// ═══════════════════════════════════════════════════════════════════════════
{
  // The whole reason for the printed-text rule: if a card survives the filter, at least one of the
  // strings the card renders must contain the term, or the feed shows a card with no visible hit.
  const renderedStrings = w => {
    const sets = (win._setsByWorkout || {})[w.id] || [];
    const cardio = (win._cardioByWorkout || {})[w.id] || [];
    const out = [app.sessionDisplayName(w.session_type), app.historyCardDate(w.date), w.notes || ''];
    sets.forEach(s => out.push(s.exercise || '', s.variation || ''));
    if (cardio.length) out.push(cardio.map(app.formatCardioEntry).join(' / '));
    return out;
  };

  for (const term of ['lateral raise', 'stairmaster', '24 aug', 'pull b', 'shoulder', 'open workout',
                      'deadhang', 'wide grip', '90 floors', 'incline']) {
    seed(term);
    const hits = app.filterHistoryData().workouts;
    ok(hits.length > 0, `"${term}" finds at least one card`);
    for (const w of hits) {
      app.setTerm(term);
      const marked = renderedStrings(w).some(t => app.hlSearch(t).includes('<mark'));
      ok(marked, `"${term}" leaves a visible mark on ${w.id} — a filtered card is never blank`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
