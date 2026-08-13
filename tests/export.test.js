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

// ── 4. the export list and the backup script agree ─────────────────────────
// A new table added to one and not the other silently isn't backed up by that route. This asserts
// the app's list against tools/backup.js's, so the drift is caught here rather than discovered when
// a restore is needed.
{
  const fs = require('fs');
  const path = require('path');
  const { activities: exportTables } = load({
    decls: ['EXPORT_TABLES'],
    accessors: { activities: '() => EXPORT_TABLES' },
  });
  const backupSrc = fs.readFileSync(path.join(__dirname, '..', 'tools', 'backup.js'), 'utf8');
  const backupList = backupSrc.match(/const TABLES = \[([\s\S]*?)\]/)[1]
    .split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

  eq([...exportTables()].sort().join(','), [...backupList].sort().join(','),
    'the in-app export and tools/backup.js cover exactly the same tables');
}

process.on('exit', () => {
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});
