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

// ── 4. picking the later of two timestamps ─────────────────────────────────
{
  const { laterIso } = load({ functions: ['laterIso'] });

  const A = '2026-08-01T10:00:00.000Z';
  const B = '2026-08-13T10:00:00.000Z';

  eq(laterIso(A, B), B, 'the later of the two wins');
  eq(laterIso(B, A), B, 'and the order of the arguments does not matter');
  eq(laterIso(null, B), B, 'a missing local value falls through to the remote one');
  eq(laterIso(A, null), A, 'and a missing remote value falls through to the local one');
  eq(laterIso(null, null), null, 'neither means neither, not a bare null string');
  eq(laterIso(A, A), A, 'identical timestamps return that timestamp');

  // A garbage value must lose to a real one rather than beat it. If unparseable input won, one
  // corrupted localStorage entry would silence the reminder permanently — the exact failure mode
  // this feature exists to prevent.
  eq(laterIso('not a date', B), B, 'a corrupted stored value loses to a real one');
  eq(laterIso(B, 'not a date'), B, 'in either position');
  eq(laterIso('not a date', ''), null, 'two unusable values collapse to null, not to whichever garbage came first');
}

// ── 5. reconciling the device and the account ──────────────────────────────
// The bug this whole change exists for: Del exported on his phone on 13 Aug, opened a PC browser on
// the 14th, and Home said "No backup yet". localStorage is per-device; the database is not.
(async () => {
  const PHONE = '2026-08-13T18:00:00.000Z';
  const OLD   = '2026-08-01T09:00:00.000Z';

  // Builds a fresh extraction with its own fake storage and a scripted sb(). Returns the calls made
  // so the test can assert on what went over the wire, not just on what ended up in storage.
  function harness({ stored = null, get = [], writeOk = true, admin = true }) {
    const store = new Map();
    if (stored) store.set('dlog_last_backup', stored);
    const calls = [];
    const deps = {
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, v),
      },
      renderBackupPrompt: () => {},
      sb: async (path, method = 'GET', body = null, opts = {}) => {
        calls.push({ path, method, body, opts });
        if (method === 'GET') return get;
        return { ok: writeOk, status: writeOk ? 201 : 409 };
      },
    };
    const api = load({
      functions: ['laterIso', 'readLocalBackup', 'writeLocalBackup', 'lastBackupAt',
                  'markBackupDone', 'pushBackupTimestamp', 'syncBackupState', 'isAdmin'],
      decls: ['BACKUP_STORE', 'remoteLastBackup', 'PROFILE'],
      deps,
      accessors: {
        remote: '() => remoteLastBackup',
        setAdmin: '(v) => { PROFILE = { ...PROFILE, is_admin: v }; }',
      },
    });
    // Every case below is about Del's own device — the account the reminder is FOR. E17 gates the
    // whole reconcile on that, so without this line the suite would pass by never reaching a single
    // line of the code it is meant to be testing.
    api.setAdmin(admin);
    return { ...api, calls, local: () => store.get('dlog_last_backup') ?? null };
  }

  // The reported bug, end to end.
  {
    const h = harness({ stored: null, get: [{ last_backup_at: PHONE }] });
    await h.syncBackupState();
    eq(h.lastBackupAt(), PHONE, 'a PC browser that has never exported learns about the phone backup');
    eq(h.local(), PHONE, 'and caches it locally, so it survives the next offline open');
    eq(h.calls.filter(c => c.method === 'POST').length, 0, 'nothing is written back — there is nothing to teach the server');
  }

  // The other direction: this device is ahead because a previous push failed.
  {
    const h = harness({ stored: PHONE, get: [{ last_backup_at: OLD }] });
    await h.syncBackupState();
    eq(h.lastBackupAt(), PHONE, 'a local value newer than the server wins');
    const posts = h.calls.filter(c => c.method === 'POST');
    eq(posts.length, 1, 'and is pushed up, healing the write that never landed');
    eq(posts[0].body.last_backup_at, PHONE, 'with the newer timestamp');
    ok(/on_conflict=user_id/.test(posts[0].path), 'as an upsert, because the row is known to exist');
    eq(posts[0].opts.upsert, true, 'and the header half of the upsert is asked for too');
  }

  // No row on the server yet, something stored locally: publish it, but as a plain INSERT.
  {
    const h = harness({ stored: PHONE, get: [] });
    await h.syncBackupState();
    const posts = h.calls.filter(c => c.method === 'POST');
    eq(posts.length, 1, 'a first-ever sync publishes the local timestamp');
    ok(!/on_conflict/.test(posts[0].path), 'as a plain insert, NOT an upsert');
    eq(h.remote(), PHONE, 'and remembers it succeeded');
  }

  // THE ONE THAT MATTERS. sb() returns [] for a failed GET *and* for no-rows, so the empty branch
  // cannot tell them apart. Guessing "no row" when the read actually failed would overwrite a newer
  // server value with this device's older one — re-creating the bug in the opposite direction and
  // silencing the reminder on the device that was right. The UNIQUE on user_id is what stops it: the
  // insert 409s and nothing is clobbered.
  {
    const h = harness({ stored: OLD, get: [], writeOk: false });
    await h.syncBackupState();
    const posts = h.calls.filter(c => c.method === 'POST');
    eq(posts.length, 1, 'it still tries, because most of the time there genuinely is no row');
    ok(!/on_conflict/.test(posts[0].path),
      'but never as an upsert — an upsert here WOULD overwrite the newer server value');
    eq(h.remote(), null, 'a rejected insert is not recorded as a successful publish');
    eq(h.local(), OLD, 'and the local value is left exactly as it was');
  }

  // Nothing anywhere: don't write a row just to say "no backup".
  {
    const h = harness({ stored: null, get: [] });
    await h.syncBackupState();
    eq(h.calls.filter(c => c.method === 'POST').length, 0, 'a device with no backup writes nothing');
    eq(h.lastBackupAt(), null, 'and still reports no backup, which is the truth');
  }

  // E17. Somebody else's account: not only is the nudge not drawn, the two reads that feed it are
  // never made. That is a round trip each, on every app open, in front of Home — and app_meta is
  // Del's backup clock, which is nothing to do with them.
  {
    const h = harness({ stored: null, get: [{ last_backup_at: PHONE }], admin: false });
    await h.syncBackupState();
    eq(h.calls.length, 0, 'a non-admin account makes no backup reads at all on app open');
    eq(h.lastBackupAt(), null, 'and never learns anything about Del backup date');
  }

  // Offline: the GET returns [] and the POST fails, and the reminder must survive on local alone.
  {
    const h = harness({ stored: PHONE, get: [], writeOk: false });
    await h.syncBackupState();
    eq(h.lastBackupAt(), PHONE, 'with no network at all, the local value still answers');
  }

  // markBackupDone is synchronous and does not wait for the network — the nag has to clear the
  // instant the file lands, whether or not the database ever hears about it.
  {
    const h = harness({ stored: null, get: [] });
    const iso = h.markBackupDone(new Date('2026-08-14T15:00:00.000Z'));
    eq(iso, '2026-08-14T15:00:00.000Z', 'it returns the timestamp it recorded, for the caller to publish');
    eq(h.local(), iso, 'localStorage is written immediately');
    eq(h.lastBackupAt(), iso, 'and the prompt reads it back with no network involved');
  }
})();


// ── An account with nothing in it is never nagged (25 Aug 2026) ────────────────────────────────
// The first thing a brand-new account was told was "No backup yet — tap to save a copy of your
// training history", about a history that did not exist. Del, on the second test account: "ITS
// ASKING THIS USER TO BACK UP - NO !!!!" The reminder is about losing something; until there is
// something, it says nothing.
(() => {
  const el = { textContent: 'x', style: { display: 'flex' } };
  const app = load({
    functions: ['renderBackupPrompt', 'backupPromptText', 'daysSince', 'lastBackupAt', 'readLocalBackup', 'laterIso', 'isAdmin'],
    decls: ['BACKUP_STALE_DAYS', 'BACKUP_STORE', 'accountHasWorkouts', 'remoteLastBackup', 'PROFILE'],
    deps: {
      document: { getElementById: () => el },
      localStorage: { getItem: () => null, setItem() {} },
    },
    accessors: {
      setHasWorkouts: '(v) => { accountHasWorkouts = v; }',
      setAdmin: '(v) => { PROFILE = { ...PROFILE, is_admin: v }; }',
    },
  });

  app.setAdmin(true);
  app.setHasWorkouts(null);
  app.renderBackupPrompt();
  eq(el.style.display, 'none', 'before the account has been asked about, the nudge stays hidden');

  app.setHasWorkouts(false);
  app.renderBackupPrompt();
  eq(el.style.display, 'none', 'an account with no workouts is never told to back up');
  eq(el.textContent, '', 'and the line is emptied, not just hidden behind a stale string');

  app.setHasWorkouts(true);
  app.renderBackupPrompt();
  eq(el.style.display, 'flex', 'once there is training to lose, the never-backed-up nudge returns');
  ok(/no backup yet/i.test(el.textContent), 'saying so in the words the pure function chose');

  // -- E17, 28 Aug 2026: "backups for normal users - NO !!" --
  // The gate that matters is this one. An account with a real history is exactly the state the
  // workouts gate above lets THROUGH, and it is where Del saw the line on the second account.
  app.setAdmin(false);
  app.renderBackupPrompt();
  eq(el.style.display, 'none', 'an account that is not Del is never shown the backup reminder');
  eq(el.textContent, '', 'and the line is emptied, not left holding the last thing it said');

  // PROFILE's shipped default, untouched. A failed read, an account with no profile row, and a row
  // written before the migration all arrive here — all three must read as NOT admin.
  app.setAdmin(undefined);
  app.renderBackupPrompt();
  eq(el.style.display, 'none', 'a missing is_admin is not admin: false is where every failure path lands');
  app.setAdmin('true');
  app.renderBackupPrompt();
  eq(el.style.display, 'none', 'and neither is the string "true" — the check is ===, not truthiness');

  app.setAdmin(true);
  app.renderBackupPrompt();
  eq(el.style.display, 'flex', 'Del still gets his own reminder, which is the half of this that is not a bug');
})();

// -- E17: the two things that would quietly undo it ------------------------------------------
// Both are one deletion away, and neither would fail an assertion anywhere else in the suite.
(() => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');

  // 1. THE EXPORT IS NOT THE NAG. Getting your own training history out of an app is EU data
  // portability (GDPR Article 20, and Del is in Ireland). Hiding 'Export my data' along with the
  // reminder is the one move in this item that would be unlawful rather than merely wrong.
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  ok(/id="export-btn"/.test(html), 'the export button is still on the account screen for everyone');
  const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
  const start = app.indexOf('async function exportAllData(');
  ok(start > 0, 'exportAllData() is still there to check');
  ok(!/isAdmin()/.test(app.slice(start, start + 4000)),
    'and it does NOT ask whether you are the admin before handing over your own data');

  // 2. THE FLAG IS ONLY REAL BECAUSE THE DATABASE PINS IT. The profiles policy is owner-only
  // `for all`, so the owner may write every column of their own row — without this trigger any
  // account can PATCH itself is_admin: true and the gate above is a suggestion. INSERT matters as
  // much as UPDATE, because onboarding creates the row with a POST and could carry it in the body.
  const mig = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20260828140000_profiles_is_admin.sql'), 'utf8');
  ok(/before insert or update on public.profiles/i.test(mig),
    'the guard trigger fires on INSERT as well as UPDATE');
  ok(/new.is_admin := old.is_admin/.test(mig), 'an UPDATE keeps whatever flag the row already had');
  ok(/new.is_admin := false/.test(mig), 'and an INSERT cannot arrive carrying one');
  ok(/is_admin boolean not null default false/i.test(mig),
    'the column defaults to not-admin, so no existing row was silently promoted');
  ok(/notify pgrst/.test(mig),
    'and the schema cache is reloaded, or select=* never returns the column at all');
})();

process.on('exit', () => {
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});
