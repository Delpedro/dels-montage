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
  // 19 Aug 2026: this used to grep for the inlined filter. The rule now lives in one place —
  // workoutRowHasContent() — because the third copy of it, in beginWorkoutSession(), was MISSING,
  // which is how an empty row came to warn about a session that never happened while this card
  // correctly ignored it. Asserting on the call rather than the expression is the point: an inlined
  // copy here would pass a text match and still be free to drift.
  ok(/\.filter\(workoutRowHasContent\)/.test(fn),
     'renderNextUp filters through the shared workoutRowHasContent(), not a private copy of it');
  const helper = src.slice(src.indexOf('function workoutRowHasContent'), src.indexOf('function draftHasContentFor'));
  ok(/workout_sets \|\| \[\]\)\.length > 0/.test(helper) && /cardio_logs \|\| \[\]\)\.length > 0/.test(helper) && /notes \|\| ''\)\.trim\(\) !== ''/.test(helper),
     'and that helper is still sets-or-cardio-or-notes');
  // The query moved into fetchNextUpRows() on 28 Aug (E19 follow-up) so the boot prefetch and the
  // card ask for exactly the same thing — a `select` that drifted between the two would hand the
  // card a row shape it reads as empty. So the ordering is asserted where it now lives, and the
  // card is asserted to go through that one function rather than carrying a second copy of it.
  const rowsFn = src.slice(src.indexOf('function fetchNextUpRows'), src.indexOf('let bootNextUpRows'));
  ok(/order=date\.desc,completed_at\.desc/.test(rowsFn),
     'and still asks for them newest-first, with an in-progress session ahead of a finished one');
  ok(/takeBootNextUpRows\(\) \|\| fetchNextUpRows\(\)/.test(fn),
     'the card takes the boot rows if they are there and fetches its own if they are not');
  ok(!/workouts\?select=/.test(fn),
     'and holds no second copy of the query to drift from the first');
  ok(/liveWorkoutRow\(rows, todayStr\(\)\)/.test(fn),
     'and asks liveWorkoutRow() which session is live rather than reading it off recent[0]');
}

// ── Start must not stop off at the picker on the way ─────────────────────────────────────────
// 20 Aug 2026. This is an ordering bug, and ordering is invisible to a behavioural test that awaits
// the whole thing and then looks at the result — by then the picker has already been shown and
// hidden again. What Del saw was a *frame*. So assert the order at the source: the placeholder must
// be up before the first await, or the browser gets a chance to paint the grid.
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const start = src.indexOf('async function startNextSession');
  const fn = src.slice(start, src.indexOf('\n}\n', start));

  const opening = fn.indexOf("showWorkoutView('opening'");
  const firstAwait = fn.indexOf('await ');
  ok(opening > -1, 'startNextSession puts the opening placeholder up at all');
  ok(opening < firstAwait,
     'and does it BEFORE the first await — after it, the picker gets a frame to paint in, which is the bug');
  ok(fn.indexOf('showPage(') < opening,
     'navigation still happens first: a tap that does nothing for two round trips is its own bug');
  ok(!/\.click\(\)/.test(fn),
     'it awaits the tile handler rather than firing a synthetic click, whose promise cannot be awaited');
  ok(!/selectSession\(/.test(fn),
     'but still does not call selectSession() itself — that is the second copy the comment warns about');
  ok(/showWorkoutView\('grid'\)/.test(fn),
     'and a cancelled confirm lands on the picker rather than stranding him on the placeholder');
}

// ── Which session is LIVE, 21 Aug 2026 ───────────────────────────────────────────────────────
// Del, three sets into the first exercise of Upper A: "home page - in progress (not sure) when i
// started the first exercise (smith incline) on 3rd set - it wasnt working". The card offered him
// Upper A as *Next up* — the session he was standing in — and only corrected itself an hour later.
//
// The database says why, and the timing is the proof: his screenshot is 10:51, and the first
// Mark Done of that session wrote its rows at 10:53. Sets go to the DB on Mark Done, not on typing,
// so the whole of the first exercise is a window in which a live session has NOTHING in the
// database. renderNextUp() was reading the live session off the newest row that had DB content, so
// for that window it could not see the session at all.
//
// Both halves of the rule below matter, and the second is why the old code was written that way:
// a `workouts` row exists from the instant a tile is tapped, so "there is an open row" on its own
// reports a session that never happened (the ghost bug, 19 Aug). The draft is what tells a session
// being typed into apart from one that was tapped and abandoned.
{
  const { liveWorkoutRow } = load({ functions: ['workoutRowHasContent', 'liveWorkoutRow'] });
  const TODAY = '2026-08-21';
  const row = (type, date, extra = {}) => ({ session_type: type, date, notes: '', workout_sets: [], cardio_logs: [], ...extra });
  const noDraft = () => false;
  const draftFor = id => type => type === id;

  // The bug itself.
  {
    const rows = [row('upper-a', TODAY), row('lower-b', '2026-08-19', { workout_sets: [{ id: 1 }], completed_at: '2026-08-19T10:00:00Z' })];
    const live = liveWorkoutRow(rows, TODAY, draftFor('upper-a'));
    eq(live && live.session_type, 'upper-a', 'three sets typed and nothing saved yet is still an in-progress Upper A');
    eq(liveWorkoutRow(rows, TODAY, noDraft), null, 'but the same row with no draft behind it is a ghost, not a session');
  }

  // The half that already worked — part-saved, which is all the card could see before.
  {
    const rows = [row('upper-a', TODAY, { workout_sets: [{ id: 1 }] })];
    eq(liveWorkoutRow(rows, TODAY, noDraft).session_type, 'upper-a', 'a session with rows in the DB is live whether or not a draft survives');
  }

  // Finished, and yesterday's.
  {
    eq(liveWorkoutRow([row('upper-a', TODAY, { workout_sets: [{ id: 1 }], completed_at: '2026-08-21T11:49:45Z' })], TODAY, draftFor('upper-a')), null,
       'a saved workout is finished, not in progress — even if its draft has not been cleared yet');
    eq(liveWorkoutRow([row('upper-a', '2026-08-20')], TODAY, draftFor('upper-a')), null,
       "yesterday's abandoned row is not today's session, however live its draft looks");
  }

  // A draft for one session must not light up a different session's row.
  {
    const rows = [row('lower-a', TODAY)];
    eq(liveWorkoutRow(rows, TODAY, draftFor('upper-a')), null, 'the draft has to belong to the row it is vouching for');
  }

  // Today's open one wins over today's finished one — PostgREST hands them over nullsfirst, and the
  // find() must take the first match rather than the last.
  {
    const rows = [row('lower-a', TODAY), row('upper-a', TODAY, { workout_sets: [{ id: 1 }], completed_at: '2026-08-21T11:49:45Z' })];
    eq(liveWorkoutRow(rows, TODAY, draftFor('lower-a')).session_type, 'lower-a', 'a second session started after the first was saved is the live one');
  }

  eq(liveWorkoutRow([], TODAY, noDraft), null, 'no rows, no live session');
  eq(liveWorkoutRow(null, TODAY, noDraft), null, 'and a failed GET (sb returns []) never crashes the card');
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
