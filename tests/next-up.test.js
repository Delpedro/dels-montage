// Next up (18 Aug 2026) — which session the rolling cycle is on.
//
// Del runs Upper A → Lower A → Upper B → Lower B at ~5 sessions a week, so the cycle DRIFTS across
// weekdays: the same session lands on a Monday one week and a Saturday the next. That is why the
// answer cannot come from the calendar, and why the whole weight of this file is on which workout
// counts as "the last one".
//
// Three ways to get that wrong, all silent — the card still renders, it just names the wrong
// session at a man already changed and standing in the gym:
//   1. Counting an Open Workout or a saved one-off as a step round the cycle. It isn't one.
//   2. Counting a `workouts` row that has nothing logged in it. One exists from the moment a tile
//      is tapped, so backing out of Upper B would otherwise advance him to Lower B.
//   3. Guessing when there is no history. sb() returns [] on a FAILED GET as well as an empty one,
//      so a guess here is what gets printed on gym Wi-Fi that can't reach Supabase.
//
// Run: node tests/next-up.test.js

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

// His real rotation, in sort_order — which is what makes it a rotation.
const SESSIONS = [
  { id: 'upper-a', name: 'Upper A', focus: 'Chest, shoulders, arms', programme: 'upper-lower' },
  { id: 'lower-a', name: 'Lower A', focus: 'Quads, calves', programme: 'upper-lower' },
  { id: 'upper-b', name: 'Upper B', focus: 'Back, rear delts, arms', programme: 'upper-lower' },
  { id: 'lower-b', name: 'Lower B', focus: 'Hamstrings, glutes', programme: 'upper-lower' },
  { id: 'full-body-a', name: 'Full Body A', programme: 'full-body-cv' },
  { id: 'cv-pump', name: 'CV + Pump', programme: 'full-body-cv', cardio: true },
  { id: 'arms-blast', name: 'Arms Blast', programme: 'custom' },
];
const PROGRAMMES = [{ id: 'upper-lower' }, { id: 'full-body-cv' }];

const { nextInRotation } = load({ functions: ['nextInRotation'] });
const at = (type, date) => ({ session_type: type, date });

// ── The everyday case ────────────────────────────────────────────────────────────────────────
{
  const r = nextInRotation([at('lower-a', '2026-08-17'), at('upper-b', '2026-08-15')], SESSIONS, PROGRAMMES);
  eq(r.session.id, 'upper-b', 'Lower A was last, so Upper B is next');
  eq(r.after.name, 'Lower A', 'and the card names what it follows');
  eq(r.afterDate, '2026-08-17', 'with the date that session was actually trained');
  eq(r.position, 3, 'Upper B is third in the rotation');
  eq(r.total, 4, 'out of four');
}

// The wrap. Off-by-one here is the difference between "Upper A" and a crash on rotation[4].
{
  const r = nextInRotation([at('lower-b', '2026-08-14')], SESSIONS, PROGRAMMES);
  eq(r.session.id, 'upper-a', 'the last session in the rotation wraps back to the first');
  eq(r.position, 1, 'and is position 1, not position 5');
}

// ── What does NOT move you round the cycle ───────────────────────────────────────────────────
{
  // He logged an Open Workout yesterday. That is not a step in the rotation — the answer is still
  // whatever followed the last real rotation session.
  const r = nextInRotation([at('open', '2026-08-18'), at('lower-a', '2026-08-17')], SESSIONS, PROGRAMMES);
  eq(r.session.id, 'upper-b', 'an Open Workout is skipped, not treated as the last session');
  eq(r.afterDate, '2026-08-17', 'and the date shown is the rotation session, not the Open Workout');
}
{
  const r = nextInRotation([at('arms-blast', '2026-08-18'), at('upper-a', '2026-08-16')], SESSIONS, PROGRAMMES);
  eq(r.session.id, 'lower-a', 'a session saved out of an Open Workout is skipped too');
}
{
  // A session type that has been deleted from the templates since. History keeps the id forever.
  const r = nextInRotation([at('legacy-push', '2026-08-18'), at('upper-a', '2026-08-16')], SESSIONS, PROGRAMMES);
  eq(r.session.id, 'lower-a', 'an unknown session id is skipped rather than aborting the search');
}

// ── The other programme is its own rotation ──────────────────────────────────────────────────
{
  const r = nextInRotation([at('full-body-a', '2026-08-18')], SESSIONS, PROGRAMMES);
  eq(r.session.id, 'cv-pump', 'a Full Body + CV session advances within Full Body + CV');
  eq(r.total, 2, 'and counts that programme, not the four upper/lower sessions');
}

// ── Say nothing rather than guess ────────────────────────────────────────────────────────────
{
  ok(nextInRotation([], SESSIONS, PROGRAMMES) === null,
     'no history returns null — an empty array is also what a FAILED read looks like');
  ok(nextInRotation(null, SESSIONS, PROGRAMMES) === null, 'and so does no array at all');
  ok(nextInRotation([at('open', '2026-08-18')], SESSIONS, PROGRAMMES) === null,
     'history made only of Open Workouts says nothing rather than defaulting to Upper A');
  ok(nextInRotation([at('lower-a', '2026-08-17')], [], PROGRAMMES) === null,
     'no templates loaded yet returns null instead of throwing on an empty rotation');
}

// ── The caller's filter, asserted at the source ──────────────────────────────────────────────
// nextInRotation takes ALREADY-filtered rows, so the "row with nothing in it" case lives in
// renderNextUp's filter. Assert the filter expression is still there rather than trusting it: the
// empty-row bug has now been fixed three times in this app on three different screens.
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function renderNextUp'), src.indexOf('async function startNextSession'));
  ok(/workout_sets \|\| \[\]\)\.length > 0/.test(fn) && /cardio_logs \|\| \[\]\)\.length > 0/.test(fn) && /notes \|\| ''\)\.trim\(\) !== ''/.test(fn),
     'renderNextUp still filters out workouts rows with no sets, no cardio and no notes');
  ok(/order=date\.desc,completed_at\.desc/.test(fn),
     'and still asks for them newest-first, with an in-progress session ahead of a finished one');
  ok(/!live\.completed_at && live\.date === todayStr\(\)/.test(fn),
     'a session started today and not yet saved shows as Resume, not as the one after it');
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
