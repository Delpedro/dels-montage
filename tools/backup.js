// Dumps every D-LOG table to .backup/<timestamp>/<table>.json
//
// WHY THIS EXISTS: Supabase's free tier has **no automated backups**. The training history is the
// entire point of this app, it has already been partly lost twice, and until this script it lived
// in exactly one place plus a single hand-made snapshot from 13 Aug 2026. Everything else on the
// plan is an improvement; this is the difference between a bad week and starting again.
//
// USAGE
//   node tools/backup.js
//
// NO CREDENTIALS. NOWHERE. THAT IS THE POINT OF THIS DESIGN.
// It shells out to `supabase db query --linked`, which authenticates with the Supabase CLI token
// already sitting in Del's user profile from when the project was linked. No password, no prompt,
// no Docker, no env vars, no gitignored secrets file. Nothing here is usable by anyone who isn't
// already sitting at this PC — unlike a stored password, which works from anywhere on earth the
// moment the file holding it leaks. Rotate/revoke it from the Supabase dashboard if it ever needs
// killing.
//
// THE ONE CAVEAT, STATED HONESTLY RATHER THAN BURIED: `--linked` runs as a privileged role, so it
// bypasses RLS and can read (and would happily write) anything. For a single-user app it returns
// the same rows the app would either way, but it means **this script must only ever SELECT.** If
// you are editing it and you are about to type UPDATE, DELETE, INSERT, DROP or ALTER — don't. A
// backup tool has no business writing to the thing it is backing up.
//
// SAFETY: dumps land in .backup/, which is gitignored. Do not move them into the repo — it is
// public, and these files are the whole database.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// The whole public schema is 10 tables as of Aug 2026 and every one of them holds something the app
// can't be rebuilt without. Anything lower means the enumeration query half-worked, which would
// otherwise write a confident-looking backup that is quietly missing tables.
const MIN_TABLES = 10;

// Tables that are expected to be non-empty. If one of these comes back empty the dump is almost
// certainly a failure being written to disk as a success, which is worse than no backup at all —
// it would quietly overwrite the reason to worry. Exit non-zero so a scheduled task reports it.
const MUST_HAVE_ROWS = ['workouts', 'workout_sets', 'daily_logs'];

// `--agent no` is load-bearing: run under an AI agent the CLI wraps its JSON in an "untrusted data"
// envelope, and the parse below would fall over. Pinning it keeps the output shape the same however
// this gets invoked. `-o json` is today's default but is pinned for the same reason.
function query(sql) {
  let out;
  try {
    out = execFileSync(
      'supabase',
      ['db', 'query', '--linked', '--agent', 'no', '-o', 'json', sql],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (e) {
    // stderr carries the real reason (not linked, token expired, no network). The version-update
    // nag also lives there, which is why it is only surfaced when something has actually failed.
    const why = (e.stderr || '').trim() || e.message;
    throw new Error(why.split('\n').slice(0, 3).join(' '));
  }
  try {
    return JSON.parse(out);
  } catch (e) {
    throw new Error(`unparseable response (${out.length} bytes) — did the CLI output format change?`);
  }
}

(async () => {
  // Enumerated from the schema, never from a hardcoded list. A hardcoded list is the same trap as
  // the RLS checklist: it works until the day someone adds a table and forgets, and then the backup
  // silently stops covering the new thing while still reporting success.
  let tables;
  try {
    tables = query("select tablename from pg_tables where schemaname = 'public' order by tablename")
      .map(r => r.tablename);
  } catch (e) {
    console.error(`Could not list the tables: ${e.message}`);
    console.error('If this says the project is not linked, run: supabase link');
    process.exit(2);
  }

  if (tables.length < MIN_TABLES) {
    console.error(`Only ${tables.length} tables found, expected at least ${MIN_TABLES}.`);
    console.error('Refusing to write a backup that is probably incomplete.');
    process.exit(2);
  }

  // YYYYMMDD-HHMMSS, matching the hand-made 13 Aug snapshot so they sort together.
  const stamp = new Date().toISOString()
    .replace(/[-:T]/g, '').slice(0, 14).replace(/^(\d{8})(\d{6})$/, '$1-$2');
  const dir = path.join(ROOT, '.backup', stamp);
  fs.mkdirSync(dir, { recursive: true });

  const counts = {};
  const problems = [];

  for (const table of tables) {
    try {
      // count(*) first, then the rows, then check they agree. This is the truncation guard: the CLI
      // returns a whole table in one response, so there is no paging to get wrong, but "the file has
      // fewer rows than the database" is exactly the failure that must never pass silently.
      const expected = Number(query(`select count(*) as n from public."${table}"`)[0].n);
      const rows = query(`select * from public."${table}"`);

      if (rows.length !== expected) {
        problems.push(`${table}: got ${rows.length} rows, database says ${expected} — TRUNCATED`);
        continue;
      }
      if (rows.length === 0 && MUST_HAVE_ROWS.includes(table)) {
        problems.push(`${table} came back EMPTY — this dump is not trustworthy`);
        continue;
      }

      fs.writeFileSync(path.join(dir, `${table}.json`), JSON.stringify(rows, null, 2));
      counts[table] = rows.length;
    } catch (e) {
      problems.push(`${table}: ${e.message}`);
    }
  }

  // Written last, so its presence is itself the signal that the run got to the end. A .backup folder
  // with no manifest is a failed run, whatever else is sitting in it.
  fs.writeFileSync(
    path.join(dir, '_backup-manifest.json'),
    JSON.stringify({ taken: new Date().toISOString(), tables: counts, problems }, null, 2)
  );

  console.log(`Backup → .backup/${stamp}`);
  for (const [table, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(6)}  ${table}`);

  if (problems.length) {
    console.error('\nPROBLEMS:');
    problems.forEach(p => console.error(`  ${p}`));
    process.exit(1);
  }
  console.log(`\nAll ${tables.length} tables dumped.`);
})();
