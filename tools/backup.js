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
// CREDENTIALS — never hardcoded, never printed. Either:
//   set DLOG_EMAIL / DLOG_PASSWORD as environment variables, or
//   create .backup-credentials.json in the project root (gitignored):
//     { "email": "...", "password": "..." }
//   The password is the D-LOG login (Del's, in 1Password). It reads through the same per-user RLS
//   policies as the app, so this backs up exactly what the logged-in user can see — no service_role
//   key involved, nothing with more power than the app itself.
//
// SAFETY: dumps land in .backup/, which is gitignored. Do not move them into the repo — it is
// public, and these files are the whole database.

const fs = require('fs');
const path = require('path');

// Read the project URL and publishable key out of js/app.js rather than repeating them here — one
// source of truth, so rotating the key can't leave the backup silently pointing at the old project.
const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
function appConst(name) {
  const m = APP_SRC.match(new RegExp(`^const ${name} = '([^']+)';`, 'm'));
  if (!m) throw new Error(`backup: ${name} not found in js/app.js`);
  return m[1];
}
const SUPABASE_URL = appConst('SUPABASE_URL');
const SUPABASE_KEY = appConst('SUPABASE_KEY');

// Every table the app owns. A table missing from this list is silently not backed up, so it belongs
// in the same mental checklist as the RLS trap in CURRENT_STATUS.md → Traps: **new table => add it
// here as well as giving it a user_id policy.**
const TABLES = [
  'workouts',
  'workout_sets',
  'cardio_logs',
  'conditioning_logs',
  'daily_logs',
  'goals',
  'custom_exercises',
  'session_templates',
  'session_exercises',
  'quotes',
];

// Tables that are expected to be non-empty. If one of these comes back empty the dump is almost
// certainly a failure being written to disk as a success, which is worse than no backup at all —
// it would quietly overwrite the reason to worry. Exit non-zero so a scheduled task reports it.
const MUST_HAVE_ROWS = ['workouts', 'workout_sets', 'daily_logs'];

const ROOT = path.join(__dirname, '..');

function credentials() {
  if (process.env.DLOG_EMAIL && process.env.DLOG_PASSWORD) {
    return { email: process.env.DLOG_EMAIL, password: process.env.DLOG_PASSWORD };
  }
  const file = path.join(ROOT, '.backup-credentials.json');
  if (fs.existsSync(file)) {
    const { email, password } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (email && password) return { email, password };
  }
  console.error(
    'No credentials. Set DLOG_EMAIL and DLOG_PASSWORD, or create .backup-credentials.json\n' +
    '(gitignored) in the project root: { "email": "...", "password": "..." }'
  );
  process.exit(2);
}

async function login({ email, password }) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    // Deliberately does not echo the response body — it can contain the submitted email.
    console.error(`Login failed (${res.status}). Check the credentials.`);
    process.exit(2);
  }
  return (await res.json()).access_token;
}

// PostgREST caps a plain select; page through so a big table can't be silently truncated.
async function dumpTable(token, table) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token}`,
        'Range-Unit': 'items',
        'Range': `${from}-${from + PAGE - 1}`,
      },
    });
    if (!res.ok && res.status !== 206) throw new Error(`${table}: HTTP ${res.status}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

(async () => {
  const token = await login(credentials());

  // YYYYMMDD-HHMMSS, matching the hand-made 13 Aug snapshot so they sort together.
  const stamp = new Date().toISOString()
    .replace(/[-:T]/g, '').slice(0, 14).replace(/^(\d{8})(\d{6})$/, '$1-$2');
  const dir = path.join(ROOT, '.backup', stamp);
  fs.mkdirSync(dir, { recursive: true });

  const counts = {};
  const problems = [];

  for (const table of TABLES) {
    try {
      const rows = await dumpTable(token, table);
      fs.writeFileSync(path.join(dir, `${table}.json`), JSON.stringify(rows, null, 2));
      counts[table] = rows.length;
      if (rows.length === 0 && MUST_HAVE_ROWS.includes(table)) {
        problems.push(`${table} came back EMPTY — this dump is not trustworthy`);
      }
    } catch (e) {
      problems.push(`${table}: ${e.message}`);
    }
  }

  console.log(`Backup → .backup/${stamp}`);
  for (const [table, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(6)}  ${table}`);

  if (problems.length) {
    console.error('\nPROBLEMS:');
    problems.forEach(p => console.error(`  ${p}`));
    process.exit(1);
  }
  console.log('\nAll tables dumped.');
})();
