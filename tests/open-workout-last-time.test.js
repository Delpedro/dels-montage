// Open Workout's empty screen, 23 Aug 2026.
//
// Del, on a screenshot of it: "this screen needs improving, its missing something, too much space,
// or maybe i just dont like the text — Tap add exercise below to get started as the first thing you
// see". Three things were wrong and only one of them was the text:
//
//  · the session picker's caption, "Choose your training programme", stayed on screen above an open
//    logger (covered in workout-view.test.js, where showWorkoutView lives),
//  · "Tap Add Exercise below to get started" captioned a box already labelled Add Exercise,
//  · and Open Workout — the one session type with NO template, so the one where you have to
//    remember what you did — was the only one excluded from the Last time card.
//
// The fix leans on something that was already true and untested: renderLastTimeCard() walks
// session.exercises first and then appends everything in the snapshot the template didn't contain.
// An Open Workout has an empty template, so every logged exercise falls through the second path.
// That is the whole reason this cost no new rendering code, and §1 below is what stops a future
// tidy-up of that "not in the template" loop quietly emptying the card.
//
// Run: node tests/open-workout-last-time.test.js

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
  ok(actual === expected, `${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const SNAPSHOT = {
  date: '2026-08-18',
  exercises: {
    'Cable Fly':   [{ weight: 12.5, reps: 12 }, { weight: 12.5, reps: 10 }],
    'Lat Raise':   [{ weight: 7.5, reps: 15, variation: 'Seated' }],
    'Face Pull':   [{ weight: 20, reps: 15 }],
  },
  cardio: [{ activity: 'bike', duration_mins: 12 }],
};

function card(opts = {}, snapshot = SNAPSHOT, session = { id: 'open', exercises: [] }) {
  const api = load({
    functions: ['renderLastTimeCard'],
    decls: ['lastOpenSnapshot'],
    deps: {
      esc: s => String(s),
      setValueLabel: (ex, s) => `${s.weight}kg × ${s.reps}`,
      lastTimeRestLabel: () => '',
      cardioDetailParts: c => [`${c.duration_mins} mins`],
      cardioDisplayName: a => a,
    },
  });
  return api.renderLastTimeCard(snapshot, session, opts);
}

console.log('Open Workout — last session, and one tap to repeat it');

// ── 1. a session with no template still lists everything ───────────────────
{
  const html = card({ open: true, repeatable: true });
  ok(html.includes('Cable Fly'), 'the card lists an exercise no template contains');
  ok(html.includes('Lat Raise'), 'and the second');
  ok(html.includes('Face Pull'), 'and the third — an empty template must not mean an empty card');
  ok(html.includes('(Seated)'), 'variations come through, as they do on a fixed session');
  ok(html.includes('bike'), 'and the cardio, which is half of some open sessions');
  ok(html.includes('12.5kg × 12'), 'with the sets themselves, not just the names');
}

// ── 2. the repeat offer is the point, and it counts honestly ───────────────
{
  const html = card({ open: true, repeatable: true });
  ok(html.includes('Load these 3 exercises'),
    'the button offers exactly what the snapshot holds — three lifts, and the bike is not one of them');
  ok(html.includes('loadLastOpenExercises()'), 'and it is wired to the loader');
  ok(/class="card last-time-card expanded"/.test(html),
    'the card opens by default on Open Workout — collapsed, it is one more grey line in the space Del called empty');
  ok(html.includes('Last open workout — '), 'and it says which kind of session it is quoting');

  const one = card({ open: true, repeatable: true }, {
    date: '2026-08-18', exercises: { 'Cable Fly': [{ weight: 12.5, reps: 12 }] }, cardio: [],
  });
  ok(one.includes('Load this exercise'), 'one exercise is not "these 1 exercises"');
}

// ── 3. every other case is the card exactly as it was ──────────────────────
{
  // A resumed Open Workout: the blocks are already on screen, so an open card offering to load them
  // again on top of themselves is noise.
  const resumed = card({ open: true, repeatable: false });
  ok(!resumed.includes('last-time-load'), 'a session already under way gets no repeat button');
  ok(!/last-time-card expanded/.test(resumed), 'and the card is collapsed, like everywhere else');
  ok(resumed.includes('Last open workout — '), 'but it is still named for what it is');

  // A fixed session — Upper 1, say — must be untouched by all of this.
  const fixed = card({}, SNAPSHOT, { id: 'upper-1', exercises: [{ name: 'Cable Fly' }] });
  ok(fixed.includes('Last time — '), 'a fixed session still says "Last time"');
  ok(!fixed.includes('last-time-load'), 'and never offers to load its own template back in');
  ok(!/last-time-card expanded/.test(fixed), 'and still opens collapsed');

  eq(card({ open: true, repeatable: true }, null), '', 'no previous open session renders nothing at all');
  eq(card({ open: true, repeatable: true }, { date: '2026-08-18', exercises: {}, cardio: [] }), '',
    'and neither does an empty one — an "empty" card is worse than the prompt it replaced');
}

// ── 4. loading adds each exercise once, and clears the offer ───────────────
// ── 5. the prompt only speaks when nothing else is on screen ───────────────
(async () => {
  const added = [];
  const btn = { disabled: false, textContent: 'Load these 3 exercises', removed: false, remove() { this.removed = true; } };
  const cardEl = { classList: { list: ['expanded'], remove(c) { this.list = this.list.filter(x => x !== c); } } };
  const toasts = [];

  const api = load({
    functions: ['loadLastOpenExercises'],
    decls: ['lastOpenSnapshot'],
    deps: {
      document: { querySelector: () => btn, getElementById: () => cardEl },
      addOpenExercise: async name => { added.push(name); },
      showToast: m => toasts.push(m),
    },
    accessors: { seed: '(s) => { lastOpenSnapshot = s; }' },
  });

  api.seed(SNAPSHOT);
  await api.loadLastOpenExercises();
  eq(added.join(','), 'Cable Fly,Lat Raise,Face Pull', 'every exercise is added, in the order it was logged');
  eq(added.length, 3, 'and none of them twice');
  ok(btn.removed, 'the offer is taken off the screen once taken up');
  eq(cardEl.classList.list.length, 0, 'and the card collapses, now that it is reference rather than the screen');
  eq(toasts[0], '3 exercises loaded', 'with a count you can check against what appeared');

  // Nothing to repeat must be a no-op, not a crash: a first-ever Open Workout has no snapshot.
  added.length = 0;
  api.seed(null);
  await api.loadLastOpenExercises();
  eq(added.length, 0, 'a first-ever open session loads nothing and throws nothing');

  // ── 4b. the card must land on a session that happened ─────────────────────
  // The bug Del found within the hour: the card shipped, and Open Workout looked exactly as before.
  // Not a cache and not the card — fetchLastSessionSnapshot() took the single most recent completed
  // row, and his five most recent Open Workout rows are empties left by opening the session and
  // backing out. A blank snapshot renders as no card at all, which is indistinguishable from the
  // feature never having shipped.
  {
    const rows = [
      { id: 'ghost-1', date: '2026-08-23', workout_sets: [], cardio_logs: [] },
      { id: 'ghost-2', date: '2026-08-18', workout_sets: [], cardio_logs: [] },
      { id: 'real-1',  date: '2026-08-13', workout_sets: [{ exercise: 'Cable Fly', set_number: 1, weight: 12.5, reps: 12 }], cardio_logs: [] },
      { id: 'real-0',  date: '2026-08-11', workout_sets: [{ exercise: 'Lat Raise', set_number: 1, weight: 7.5, reps: 15 }], cardio_logs: [] },
    ];
    let asked = '';
    const snap = load({
      functions: ['fetchLastSessionSnapshot'],
      decls: ['currentWorkoutId'],
      deps: { sb: async path => { asked = path; return rows; } },
      accessors: { setCurrent: '(id) => { currentWorkoutId = id; }' },
    });

    const got = await snap.fetchLastSessionSnapshot({ id: 'open' });
    eq(got && got.date, '2026-08-13', 'the card skips the empty rows and lands on the last session that happened');
    eq(Object.keys(got.exercises).join(','), 'Cable Fly', 'and carries that session\'s exercises');
    ok(asked.includes('limit=8'), 'which needs more than one row fetched — limit=1 could only ever see the ghost');

    // A cardio-only open session is a real session: half of them are the bike and nothing else.
    const cardioOnly = load({
      functions: ['fetchLastSessionSnapshot'],
      decls: ['currentWorkoutId'],
      deps: { sb: async () => [{ id: 'c1', date: '2026-08-20', workout_sets: [], cardio_logs: [{ activity: 'bike', duration_mins: 20 }] }] },
    });
    const cardioSnap = await cardioOnly.fetchLastSessionSnapshot({ id: 'open' });
    ok(cardioSnap && cardioSnap.cardio.length === 1, 'a session that was only cardio still counts as last time');

    // The session you are standing in is never its own "last time", empty or not.
    snap.setCurrent('real-1');
    const skipped = await snap.fetchLastSessionSnapshot({ id: 'open' });
    eq(skipped && skipped.date, '2026-08-11', 'the workout in progress is skipped even when it has sets');

    const nothing = load({
      functions: ['fetchLastSessionSnapshot'],
      decls: ['currentWorkoutId'],
      deps: { sb: async () => [{ id: 'g', date: '2026-08-23', workout_sets: [], cardio_logs: [] }] },
    });
    eq(await nothing.fetchLastSessionSnapshot({ id: 'open' }), null,
      'nothing but ghosts is null — the prompt comes back, rather than an empty card');
  }

  // ── 5 ──
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const logger = src.slice(src.indexOf('async function buildWorkoutLogger'), src.indexOf('function renderAddToSessionRow'));

  ok(logger.includes('session.exercises.length === 0 && !lastTimeHtml'),
    'the "Tap Add Exercise" prompt is gated on there being no card above it');
  ok(logger.includes("lastOpenSnapshot = session.id === 'open'"),
    'the snapshot the repeat button reads is set where the card is built, not fetched again');
  ok(!logger.includes("session.id !== 'open' && !session.cardio"),
    'Open Workout is no longer excluded from the card wholesale');
  ok(logger.includes("if (session.id !== 'open') {"),
    'only the ✎ template link is — an Open Workout has no template to reorder');

  // ── §4 C3: a superset has to survive into the card (28 Aug 2026) ─────────────────────────────
  //
  // The card is a full snapshot of the session, and a pair run back-to-back printed as two unrelated
  // rows. The tag is the History card's own `.pf-ss`, not a new mark — see the comment on ssTag().
  {
    const paired = {
      date: '2026-08-26',
      exercises: {
        // set 1 deliberately carries no tag: superset_group is written per set, and a pairing
        // toggled on after the first set leaves exactly this shape. Reading sets[0] blind loses it.
        'Bench Press': [{ weight: 60, reps: 8 }, { weight: 60, reps: 8, superset_group: '1' }],
        'Cable Row':   [{ weight: 45, reps: 10, superset_group: '1' }],
        'Leg Curl':    [{ weight: 30, reps: 12 }],
      },
      cardio: [],
    };
    const html = card({}, paired);
    eq((html.match(/class="pf-ss"/g) || []).length, 2,
      'both halves of the pair are tagged, and only them — the solo lift is left plain');
    ok(html.includes('s/s 1'), 'and it reads the way History and the template editor already say it');
    ok(html.includes('Leg Curl'), 'a lift outside any superset still appears');
    ok(!/Leg Curl<[^>]*><span class="pf-ss"/.test(html), 'with nothing beside its name');
    ok(!card({}, SNAPSHOT).includes('pf-ss'),
      'a session with no supersets in it gains no marks at all');
  }

  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
