// Data export — the "get your training history out" button, added 13 Aug 2026.
//
// The failure mode that matters here isn't a crash, it's a **file that looks like a backup and
// isn't**: a truncated read, or an empty one handed over as a success. That would quietly remove the
// reason to worry, which is the same reasoning tools/backup.js exits non-zero for. So the two things
// worth testing are the paging and the refusal.
//
// Run: node tests/export.test.js

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

console.log('data export');

// ── 1. paging — the big table must not be silently truncated ────────────────
(async () => {
  function build(tableRowCounts) {
    const calls = [];
    const api = load({
      functions: ['fetchAllRows'],
      decls: ['EXPORT_PAGE'],
      deps: {
        sb: async (path) => {
          calls.push(path);
          const table = path.split('?')[0];
          const limit = Number(path.match(/limit=(\d+)/)[1]);
          const offset = Number(path.match(/offset=(\d+)/)[1]);
          const total = tableRowCounts[table] ?? 0;
          return Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({ id: offset + i }));
        },
      },
    });
    return { ...api, calls };
  }

  {
    // 798 rows was the real workout_sets count in August. One page, one request.
    const h = build({ workout_sets: 798 });
    const rows = await h.fetchAllRows('workout_sets');
    eq(rows.length, 798, 'a table under one page comes back whole');
    eq(h.calls.length, 1, 'in a single request');
    ok(h.calls[0].includes('order=id.asc'), 'ordered by id, so pages cannot overlap or skip rows');
    ok(h.calls[0].includes('select=*'), 'and every column is taken — this is a backup, not a view');
  }

  {
    // The case the paging exists for. Without it this silently returns 1000 and looks fine.
    const h = build({ workout_sets: 2400 });
    const rows = await h.fetchAllRows('workout_sets');
    eq(rows.length, 2400, 'a table over the PostgREST row cap is paged through in full');
    eq(h.calls.length, 3, 'three requests: 0-999, 1000-1999, 2000-2399');
    eq(new Set(rows.map(r => r.id)).size, 2400, 'and no row is fetched twice');
  }

  {
    // Exactly on the boundary: the loop must make one more (empty) request rather than stopping
    // early and assuming, which is the classic off-by-one in this shape of code.
    const h = build({ workout_sets: 2000 });
    const rows = await h.fetchAllRows('workout_sets');
    eq(rows.length, 2000, 'an exact multiple of the page size is complete');
    eq(h.calls.length, 3, 'confirmed by a final empty page rather than assumed');
  }

  {
    const h = build({ quotes: 0 });
    eq((await h.fetchAllRows('quotes')).length, 0, 'an empty table returns no rows without looping');
  }

  {
    // sb() returns [] on a failed read (and toasts). fetchAllRows must not spin on that.
    const api = load({ functions: ['fetchAllRows'], decls: ['EXPORT_PAGE'], deps: { sb: async () => null } });
    eq((await api.fetchAllRows('workouts')).length, 0, 'a failed read returns empty rather than hanging');
  }
})();

// ── 2. the refusal — never hand over an empty file as a backup ──────────────
{
  const { exportProblems } = load({
    functions: ['exportProblems'],
    decls: ['EXPORT_MUST_HAVE_ROWS'],
  });

  const full = { workouts: [{}], workout_sets: [{}], daily_logs: [{}], quotes: [] };
  eq(exportProblems(full).length, 0, 'a real export has no problems (an empty quotes table is fine)');

  eq(exportProblems({ ...full, workout_sets: [] }).join(','), 'workout_sets',
    'no sets means the export is not trustworthy and must not be delivered');
  eq(exportProblems({ workouts: [], workout_sets: [], daily_logs: [] }).length, 3,
    'a completely failed read names every missing table');
  eq(exportProblems({}).length, 3, 'a missing key counts as empty, not as absent');
}

// ── 3. the filename ────────────────────────────────────────────────────────
{
  const { exportFilename } = load({ functions: ['exportFilename'] });
  eq(exportFilename(new Date(2026, 7, 13)), 'd-log-export-2026-08-13.json', 'dated, zero-padded, sorts chronologically');
  eq(exportFilename(new Date(2026, 0, 5)), 'd-log-export-2026-01-05.json', 'single-digit months and days are padded');
  // Local date, not UTC — the same rule the rest of the app follows (see Traps: toISOString bug).
  eq(exportFilename(new Date(2026, 7, 13, 0, 30)), 'd-log-export-2026-08-13.json',
    'half past midnight is still today, not yesterday');
}

// ── 4. nothing quietly drops a table ───────────────────────────────────────
// This used to compare the app's EXPORT_TABLES against a hardcoded TABLES array in tools/backup.js.
// That array is gone (13 Aug 2026) — the backup now asks the database which tables exist, so it
// cannot drift by definition. **The in-app export is the only one of the two that still can**, so
// that is what this pins.
{
  const fs = require('fs');
  const path = require('path');
  const { activities: exportTables } = load({
    decls: ['EXPORT_TABLES'],
    accessors: { activities: '() => EXPORT_TABLES' },
  });

  // The public schema as of 14 Aug 2026, verified against pg_tables the day the backup was rewritten
  // and again when app_meta was added. Adding a table means adding it here and to EXPORT_TABLES.
  // tools/backup.js needs nothing.
  const KNOWN_TABLES = [
    'app_meta', 'cardio_logs', 'conditioning_logs', 'custom_exercises', 'daily_logs', 'exercises', 'goals',
    'quotes', 'session_exercises', 'session_templates', 'workout_sets', 'workouts',
  ];

  eq([...exportTables()].sort().join(','), [...KNOWN_TABLES].sort().join(','),
    'the in-app export covers every table in the schema');

  // The enumeration is the whole reason the backup is drift-proof. If someone reintroduces a
  // hardcoded list, that guarantee is gone silently — so fail here instead.
  const backupSrc = fs.readFileSync(path.join(__dirname, '..', 'tools', 'backup.js'), 'utf8');
  ok(/from pg_tables where schemaname = 'public'/.test(backupSrc),
    'tools/backup.js still enumerates its tables from the schema');
  ok(!/const TABLES = \[/.test(backupSrc),
    'tools/backup.js has not grown a hardcoded table list again');

  // A backup tool that can write is a backup tool that can destroy what it is backing up. --linked
  // runs privileged, so this is the only thing standing between a typo and the live database.
  ok(!/\b(insert into|update |delete from|drop |alter |truncate )/i.test(
    backupSrc.replace(/^\s*\/\/.*$/gm, '')),
    'tools/backup.js contains no statement that could write to the database');
}

process.on('exit', () => {
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});
