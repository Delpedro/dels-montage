// The Home backup reminder — "Backup Half B", added 13 Aug 2026.
//
// tools/backup.js covers the weeks the PC is on. This covers the weeks it isn't, and the only way it
// can fail badly is by being *reassuring when it shouldn't be*: a reminder that stays quiet while the
// history goes un-backed-up for a month is worse than no reminder, because it's read as an all-clear.
// So the assertions below are weighted at the quiet branches — the threshold, the never-backed-up
// case, and the clock going wrong.
//
// Run: node tests/backup-prompt.test.js

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

console.log('backup reminder');

const { daysSince, backupPromptText } = load({
  functions: ['daysSince', 'backupPromptText'],
  decls: ['BACKUP_STALE_DAYS'],
});

// Local-time constructor throughout, deliberately: the app's dates are local (see the toISOString
// trap), and so is the question "how many days ago was that".
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

// ── 1. counting the days ───────────────────────────────────────────────────
{
  eq(daysSince(at(2026, 8, 13), at(2026, 8, 13, 18)), 0, 'a backup earlier today is 0 days ago');
  eq(daysSince(at(2026, 8, 12), at(2026, 8, 13)), 1, 'yesterday is 1');
  eq(daysSince(at(2026, 8, 1), at(2026, 8, 13)), 12, 'twelve days is twelve');

  // The reason this doesn't just divide the raw millisecond gap. 22:00 to 09:00 nine dates later is
  // 8.5 raw days, and floor()ing that would print "8 days ago" for something that happened on the
  // 9th preceding date.
  eq(daysSince(at(2026, 8, 4, 22, 0), at(2026, 8, 13, 9, 0)), 9,
    'late-night export, early-morning check: counted in dates, not in 24h blocks');

  // Late March in the UK: one of these days is 23 hours long. Raw division gives 7.04 → still 7 here,
  // but the October 25-hour day gives 6.96, which would floor to 6 and silence the reminder for an
  // extra day. Flattening to local midnight first makes both exact.
  eq(daysSince(at(2026, 10, 18, 12), at(2026, 10, 25, 12)), 7, 'a 25-hour DST day still counts as one day');
  eq(daysSince(at(2026, 3, 22, 12), at(2026, 3, 29, 12)), 7, 'and so does a 23-hour one');

  eq(daysSince(null), null, 'never backed up reads as null, not as 0 days ago');
  eq(daysSince(''), null, 'and so does an empty string');
  eq(daysSince('not a date'), null, 'a corrupted localStorage value is not silently treated as today');
  eq(daysSince(new Date(2026, 7, 6).toISOString(), at(2026, 8, 13)), 7,
    'the stored value is an ISO string — the real input shape, not a Date');
}

// ── 2. what it says, and when it says nothing ──────────────────────────────
{
  const iso = (y, m, d) => at(y, m, d).toISOString();

  eq(backupPromptText(iso(2026, 8, 13), at(2026, 8, 13)), null, 'a backup today says nothing');
  eq(backupPromptText(iso(2026, 8, 7), at(2026, 8, 13)), null, 'six days is still fresh');

  // The boundary, both sides of it. This is the whole behaviour of the feature.
  eq(backupPromptText(iso(2026, 8, 6), at(2026, 8, 13)), 'Last backup 7 days ago — back up now',
    'seven days is the point it starts asking');
  eq(backupPromptText(iso(2026, 8, 1), at(2026, 8, 13)), 'Last backup 12 days ago — back up now',
    'and it names the real number rather than saying "over a week"');

  eq(backupPromptText(null, at(2026, 8, 13)),
    'No backup yet — tap to save a copy of your training history',
    'never backed up gets its own wording, not "Last backup null days ago"');

  // A phone with a wrong clock — or a right clock now and a wrong one when the export ran — must not
  // produce "Last backup -3 days ago". Reading the future as fresh is the harmless direction: the
  // reminder returns on its own once the dates make sense again.
  eq(backupPromptText(iso(2026, 8, 20), at(2026, 8, 13)), null, 'a future timestamp reads as fresh, not as a negative nag');
}

// ── 3. the clock is only reset by a file that actually arrived ─────────────
// The nudge disappearing is the app's claim that a backup exists. A cancelled share sheet or a
// failed read must not make that claim — it would silence the reminder for a week over a backup
// that was never saved.
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const body = src.slice(src.indexOf('async function exportAllData('));
  const mark = body.indexOf('markBackupDone()');
  ok(mark > 0, 'exportAllData records the backup');
  ok(body.indexOf(`if (how === 'cancelled') return;`) < mark,
    'and does it only after the cancelled path has already returned');
  ok(body.indexOf('const problems = exportProblems(data)') < mark,
    'and only after the empty-export refusal, so a refused export never counts as a backup');
}

process.on('exit', () => {
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});
