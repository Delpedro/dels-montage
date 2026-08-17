// The 14 Aug 2026 gym UAT — four findings off one session, plus the one nobody reported.
//
// Every case below is built from Del's real rows rather than invented numbers, because three of these
// bugs were invisible in the abstract and obvious the moment the actual data was put through them.
//
// Run: node tests/uat-14aug.test.js

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
function deep(actual, expected, label) {
  ok(JSON.stringify(actual) === JSON.stringify(expected),
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

// ═══════════════════════════════════════════════════════════════════════════
console.log('prev badges never borrow another variation');
// ═══════════════════════════════════════════════════════════════════════════
// "Leg Curl (single / machine) past reps are the same?! Have we fucked up on all exercises for this?"
//
// He was right. previousSets[name] is a CONCATENATION — the most recent workout's sets, then other
// variations backfilled from their own most recent occurrence — and the old rule was
// `filter(variation)`, falling back to the WHOLE list when the filter matched nothing. Leg Curl has
// never been logged as "Machine", so Machine matched nothing, fell back, and printed the Single Leg
// numbers. Both toggles showed identical badges, which is what gave it away.
{
  const app = load({ functions: ['prevSetsForVariation'] });

  // Del's real Leg Curl history, in the order loadPreviousSetsForSession() assembles it:
  // 7 Aug as "Single Leg", then the pre-variations rows from 23 May carrying variation null.
  const prev = [
    { weight: '52.0', reps: 13, variation: 'Single Leg' },
    { weight: '54.0', reps: 10, variation: 'Single Leg' },
    { weight: '54.0', reps: 10, variation: 'Single Leg' },
    { weight: '42.0', reps: 12, variation: null },
    { weight: '45.0', reps: 12, variation: null },
    { weight: '52.0', reps: 12, variation: null },
  ];

  deep(app.prevSetsForVariation(prev, 'Single Leg').map(s => s.weight), ['52.0', '54.0', '54.0'],
    'a variation with its own history gets exactly that history');

  const machine = app.prevSetsForVariation(prev, 'Machine');
  ok(!machine.some(s => s.variation === 'Single Leg'),
    'a variation with NO history never shows another named variation\'s numbers — the whole bug');
  deep(machine.map(s => s.weight), ['42.0', '45.0', '52.0'],
    'it falls back to the untagged rows, which are that exercise before variations existed, not a different exercise');

  // The two toggles must not agree. That equality WAS the reported symptom.
  ok(JSON.stringify(app.prevSetsForVariation(prev, 'Single Leg'))
     !== JSON.stringify(app.prevSetsForVariation(prev, 'Machine')),
    'toggling between two variations changes the badges');

  // A variation added to an exercise that has only ever been logged under named variations.
  const named = [
    { weight: '20.0', reps: 12, variation: 'Rope' },
    { weight: '25.0', reps: 10, variation: 'Bar' },
  ];
  deep(app.prevSetsForVariation(named, 'V-Bar'), [],
    'no history and no untagged rows returns nothing — the badge reads "—", which is the truth');
  deep(app.prevSetsForVariation(named, 'Rope').map(s => s.weight), ['20.0'],
    'and a named variation still resolves to its own row rather than to the whole list');

  deep(app.prevSetsForVariation([], 'Machine'), [], 'an exercise with no history at all is not a crash');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('PRs cover reps, not just weight');
// ═══════════════════════════════════════════════════════════════════════════
// "PRs are not covering more reps only weight?" — correct. `best` was the heaviest weight and the
// only thing compared, so sitting at 56kg and going 8→10→12 earned nothing, and a bodyweight
// exercise could never earn a badge in its entire history because it has no weight to beat.
{
  const app = load({ functions: ['computeExerciseProgress'] });

  const run = sessions => {
    const workouts = sessions.map((s, i) => ({ id: `w${i}`, date: s.date }));
    const setsByWorkout = {};
    sessions.forEach((s, i) => { setsByWorkout[`w${i}`] = s.sets; });
    return app.computeExerciseProgress(workouts, setsByWorkout);
  };
  const set = (exercise, weight, reps, extra = {}) =>
    ({ exercise, weight, reps, variation: null, rest_seconds: 0, ...extra });

  // ── same weight, more reps ──────────────────────────────────────────────
  {
    const out = run([
      { date: '2026-07-01', sets: [set('Leg Curl', '56.0', 8)] },
      { date: '2026-07-08', sets: [set('Leg Curl', '56.0', 10)] },
      { date: '2026-07-15', sets: [set('Leg Curl', '56.0', 12)] },
      { date: '2026-07-22', sets: [set('Leg Curl', '56.0', 9)] },
    ]);
    eq(out['w0|Leg Curl::'].isPR, false, 'the first ever session is never a PR — otherwise every old row wears a badge');
    eq(out['w1|Leg Curl::'].isPR, true, '56×10 after 56×8 is a PR');
    eq(out['w1|Leg Curl::'].prKind, 'reps', 'and it is flagged as a rep PR, so the badge can say REP PR');
    eq(out['w2|Leg Curl::'].isPR, true, '56×12 after 56×10 is a PR too');
    eq(out['w3|Leg Curl::'].isPR, false, 'dropping back to 56×9 is not');
  }

  // ── a heavier top set still outranks everything ─────────────────────────
  {
    const out = run([
      { date: '2026-07-01', sets: [set('Leg Curl', '54.0', 12)] },
      { date: '2026-07-08', sets: [set('Leg Curl', '56.0', 8)] },
      { date: '2026-07-15', sets: [set('Leg Curl', '56.0', 10)] },
    ]);
    eq(out['w1|Leg Curl::'].prKind, 'weight', 'going up in weight is a weight PR even on fewer reps');
    eq(out['w2|Leg Curl::'].isPR, true, 'and the rep record then restarts at the new weight');
    eq(out['w2|Leg Curl::'].prKind, 'reps', 'as a rep PR');
  }

  // ── reps at a LIGHTER weight are deliberately not a PR ──────────────────
  // Otherwise every deload week wears a badge and the badge stops meaning anything.
  {
    const out = run([
      { date: '2026-07-01', sets: [set('Leg Curl', '56.0', 10)] },
      { date: '2026-07-08', sets: [set('Leg Curl', '40.0', 20)] },
    ]);
    eq(out['w1|Leg Curl::'].isPR, false, '40×20 does not beat 56×10');
  }

  // ── bodyweight work can finally earn one ────────────────────────────────
  // Pull Ups, Dead Bug and the leg raises have no weight at all, so under the old rule they were
  // structurally incapable of a PR no matter how much better they got.
  {
    const out = run([
      { date: '2026-07-01', sets: [set('Lower AB leg raises', null, 15)] },
      { date: '2026-07-08', sets: [set('Lower AB leg raises', null, 18)] },
      { date: '2026-07-15', sets: [set('Lower AB leg raises', null, 15)] },
    ]);
    eq(out['w0|Lower AB leg raises::'].isPR, false, 'first time out, still no badge');
    eq(out['w1|Lower AB leg raises::'].isPR, true, '18 reps after 15 is a PR on a bodyweight exercise');
    eq(out['w1|Lower AB leg raises::'].prKind, 'reps', 'flagged as reps — there is no weight to have beaten');
    eq(out['w2|Lower AB leg raises::'].isPR, false, 'and dropping back is not');
  }

  // ── bestReps is the best reps AT the best weight ────────────────────────
  // Read first-heaviest-set-wins before, so a session that went 56×10 then 56×12 reported 56×10 —
  // which made the rep PR un-winnable on the very session that won it.
  {
    const out = run([
      { date: '2026-07-01', sets: [set('Leg Curl', '56.0', 8)] },
      { date: '2026-07-08', sets: [set('Leg Curl', '56.0', 10), set('Leg Curl', '56.0', 12)] },
    ]);
    eq(out['w1|Leg Curl::'].bestReps, 12, 'the best set of the session is reported, not whichever came first');
    eq(out['w1|Leg Curl::'].isPR, true, 'so the PR it earned actually lands');
  }

  // ── variations stay separate ────────────────────────────────────────────
  {
    const out = run([
      { date: '2026-07-01', sets: [set('Leg Curl', '56.0', 12, { variation: 'Single Leg' })] },
      { date: '2026-07-08', sets: [set('Leg Curl', '30.0', 8, { variation: 'Machine' })] },
    ]);
    eq(out['w1|Leg Curl::Machine'].isPR, false,
      'a first-ever Machine session is not judged against Single Leg — different loads entirely');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('Last Time card carries rest');
// ═══════════════════════════════════════════════════════════════════════════
// "Last time history needs to have rest period in some form."
{
  const app = load({ functions: ['lastTimeRestLabel', 'fmtRest'] });

  // Del's real 14 Aug RDL: 151s, 156s, 156s.
  eq(app.lastTimeRestLabel([
    { rest_seconds: 151 }, { rest_seconds: 156 }, { rest_seconds: 156 },
  ]), 'rest 2:35 avg', 'averages the rests and rounds to the nearest 5s');

  // The last set has no rest after it and (since 14 Aug) never records one. Averaging over the set
  // COUNT rather than over the timed sets would drag a 3-set lift down by a third.
  eq(app.lastTimeRestLabel([
    { rest_seconds: 90 }, { rest_seconds: 90 }, { rest_seconds: 0 },
  ]), 'rest 1:30 avg', 'a zero-rest final set is excluded rather than averaged in as a zero');

  eq(app.lastTimeRestLabel([{ rest_seconds: 0 }, { rest_seconds: 0 }]), '',
    'an exercise where the watch was never used shows no rest line at all, rather than "0:00"');
  eq(app.lastTimeRestLabel([{ rest_seconds: null }]), '', 'nulls are not zeros');
  eq(app.lastTimeRestLabel([]), '', 'and no sets is not a crash');

  // PostgREST hands numerics back as strings often enough that this has bitten twice before.
  eq(app.lastTimeRestLabel([{ rest_seconds: '120' }]), 'rest 2:00 avg', 'a string rest still counts');

  // Rewritten 15 Aug 2026 for PostgREST embedding — the column list moved from a standalone
  // `workout_sets?select=…` into `workout_sets(…)` nested in the workouts query. The claim is
  // unchanged and still the one worth pinning: the snapshot has to ask for rest_seconds.
  ok(SRC.includes('workout_sets(exercise,set_number,weight,reps,variation,rest_seconds)'),
    'fetchLastSessionSnapshot actually asks the database for rest_seconds — the card cannot show what it never fetched');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('Mark Done cannot run twice at once');
// ═══════════════════════════════════════════════════════════════════════════
// The one that was NOT reported, and the worst of the lot. saveExerciseSets() is GET → DELETE → POST;
// the button stayed enabled and labelled "Mark Done" for that whole second-plus, so a second tap
// started a second run whose DELETE landed before the first run's POST. Both POSTs inserted.
// Live damage found on 14 Aug: 35 groups across 12 sessions since 1 May, up to 5 copies of one set.
{
  const decl = SRC.slice(SRC.indexOf('async function completeExercise('),
                         SRC.indexOf('async function completeExerciseInner('));

  const guard = decl.indexOf('if (completeInFlight) return;');
  ok(guard > 0, 'completeExercise returns early when a save is already in flight');
  ok(decl.indexOf('completeInFlight = true') > guard,
    'and claims the flag immediately after the check, with no await between the two — otherwise the second tap slips through the gap');
  ok(guard < decl.indexOf('await completeExerciseInner('),
    'the guard sits before the work, not inside it');
  ok(decl.includes('finally'),
    'the flag is released in a finally, so a thrown save does not wedge the button for the rest of the session');
  ok(decl.indexOf('completeInFlight = false') > decl.indexOf('finally'),
    'and released there specifically');

  // The reason he tapped twice: nothing on screen acknowledged the first tap.
  ok(decl.includes("'Saving…'"), 'the button says Saving… so a slow save looks busy rather than dead');
  ok(decl.includes('!tappedBtn.dataset.done'),
    'and the restore is skipped once the save painted it green, so "Mark Done" is never written back over "✓ Done"');

  ok(/^let completeInFlight = false;$/m.test(SRC),
    'the flag is module-level — a per-call variable would guard nothing');

  // The database backstop, applied live the same day. The app guard is the fix; this is the thing
  // that survives a future refactor forgetting about any of the above.
  const mig = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
    '20260814110000_dedupe_workout_sets_and_unique_key.sql'), 'utf8');
  ok(/unique\s*\(workout_id,\s*exercise,\s*set_number\)/.test(mig),
    'and the migration adds the unique key that makes a duplicate set impossible at the database');
  ok(/order by coalesce\(rest_seconds, 0\) desc/.test(mig),
    'the dedupe keeps the copy carrying the real rest time rather than an arbitrary one');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('Home and Stats average over the same window');
// ═══════════════════════════════════════════════════════════════════════════
// "Home and stats don't match — what's different regarding data." Steps were averaged over the
// rolling last 7 days while weight and calories used Mon–today, so the two screens printed different
// average calories on the same morning with nothing on either to say why.
{
  const home = SRC.slice(SRC.indexOf('async function loadHomePage('), SRC.indexOf('async function realWorkoutsBetween('));
  const stats = SRC.slice(SRC.indexOf('async function loadStats('), SRC.indexOf('function renderWeightHero('));

  ok(!home.includes('getWeekStart()}&select=weight_kg,calories'),
    'Home no longer fetches its averages over a Monday-anchored window');
  ok(home.includes('select=steps,weight_kg,calories'),
    'steps, weight and calories now come from one request over one window');
  eq(home.split('daily_logs?date=gte.').length - 1, 1,
    'ONE ranged daily_logs read on Home, not two — a second window is how the two numbers drifted apart in the first place');

  // The sessions tiles are genuinely week-anchored on both screens and always agreed — they must stay
  // that way. "Sessions this week" meaning "the last 7 days" would be a different, worse bug.
  ok(home.includes('realWorkoutsBetween(getWeekStart())'), 'Home still counts sessions from Monday');
  ok(stats.includes('realWorkoutsBetween(getWeekStart())'), 'and so does Stats — those two always matched');
}

process.on('exit', () => {
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});
