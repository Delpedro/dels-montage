// A small PostgREST stand-in, plus the rows it serves.
//
// It exists for one job: the 15 Aug 2026 embedding change rewrote five read paths from "fetch the
// parents, then fetch their children with an `in.(ids)` filter" into a single request with the
// children embedded. The only claim worth proving is that **the same data comes out**, and that
// cannot be proved by reading either query — it needs both versions run against one database.
//
// So this understands just enough of PostgREST to serve both shapes: `eq` / `gte` / `lte` / `in` /
// `not.is.null` filters, `order` (multi-column), `limit`, column projection, embedded resources
// (`workouts?select=id,workout_sets(exercise)`) and the embed-scoped `workout_sets.order=` /
// `workout_sets.exercise=in.(…)` parameters. Anything else throws rather than silently returning
// the wrong rows — a permissive fake would make the comparison meaningless.
//
// It is NOT a general PostgREST implementation and should not grow into one. The prod behaviour it
// mimics was checked against the live database first (embedded ordering, embedded filters keeping
// their parent rows, arrays rather than nulls for childless parents).

// Which column points a child table back at `workouts`. Matches the real foreign keys —
// workout_sets_workout_id_fkey and cardio_logs_workout_id_fkey — which is also what makes the
// embedding unambiguous in prod: exactly one FK per child table.
const FK = { workout_sets: 'workout_id', cardio_logs: 'workout_id' };

// ── the rows ────────────────────────────────────────────────────────────────
// Shaped after the real data rather than invented: an abandoned workout with nothing in it (w4),
// a CV + Pump session carried only by its notes (w3), a cardio-only session (w7), the same lift
// logged under two variations in different weeks (Lat Pulldown, w2/w6), and an Open workout that
// was never completed (w8) so the `completed_at=not.is.null` filter has something to exclude.
//
// Deliberately avoided: two workouts of the same session_type on the same date both containing the
// same exercise. "Most recent occurrence" is genuinely undefined there — the old code broke the tie
// on whatever order Postgres returned the sets in — so pinning it would be pinning noise.
function db() {
  return {
    workouts: [
      { id: 'w1', date: '2026-08-01', session_type: 'lower-a', notes: '', completed_at: '2026-08-01T10:00:00' },
      { id: 'w2', date: '2026-08-03', session_type: 'upper-a', notes: '', completed_at: '2026-08-03T10:00:00' },
      { id: 'w3', date: '2026-08-05', session_type: 'cv-pump', notes: 'legs felt heavy', completed_at: '2026-08-05T10:00:00' },
      { id: 'w4', date: '2026-08-06', session_type: 'lower-a', notes: '', completed_at: '2026-08-06T10:00:00' },
      { id: 'w5', date: '2026-08-07', session_type: 'open', notes: '', completed_at: '2026-08-07T10:00:00' },
      { id: 'w6', date: '2026-08-08', session_type: 'upper-a', notes: '  ', completed_at: '2026-08-08T10:00:00' },
      { id: 'w7', date: '2026-08-09', session_type: 'lower-a', notes: '', completed_at: null },
      { id: 'w8', date: '2026-08-10', session_type: 'open', notes: '', completed_at: null },
    ],
    workout_sets: [
      // w1 — logged out of set order on purpose, so an `order=` that stops working is visible
      { id: 's3', workout_id: 'w1', exercise: 'Leg Press', set_number: 3, weight: 100, reps: 8, variation: null, rest_seconds: 0, superset_group: null, created_at: '2026-08-01T09:10:00' },
      { id: 's1', workout_id: 'w1', exercise: 'Leg Press', set_number: 1, weight: 100, reps: 10, variation: null, rest_seconds: 90, superset_group: null, created_at: '2026-08-01T09:10:00' },
      { id: 's2', workout_id: 'w1', exercise: 'Leg Press', set_number: 2, weight: 100, reps: 9, variation: null, rest_seconds: 95, superset_group: null, created_at: '2026-08-01T09:10:00' },
      { id: 's4', workout_id: 'w1', exercise: 'Seated Calf Raise', set_number: 1, weight: 50, reps: 12, variation: 'Old Mach', rest_seconds: 60, superset_group: 1, created_at: '2026-08-01T09:25:00' },
      { id: 's5', workout_id: 'w1', exercise: 'Single Leg Curl', set_number: 1, weight: 10, reps: 12, variation: null, rest_seconds: 0, superset_group: 1, created_at: '2026-08-01T09:26:00' },
      // w2 — Lat Pulldown under the Wide variation
      { id: 's6', workout_id: 'w2', exercise: 'Lat Pulldown', set_number: 1, weight: 60, reps: 10, variation: 'Wide', rest_seconds: 75, superset_group: null, created_at: '2026-08-03T09:05:00' },
      { id: 's7', workout_id: 'w2', exercise: 'Lat Pulldown', set_number: 2, weight: 60, reps: 9, variation: 'Wide', rest_seconds: 0, superset_group: null, created_at: '2026-08-03T09:05:00' },
      { id: 's8', workout_id: 'w2', exercise: 'Dips', set_number: 1, weight: null, reps: 12, variation: null, rest_seconds: 80, superset_group: null, created_at: '2026-08-03T09:20:00' },
      // w5 — an Open workout
      { id: 's9', workout_id: 'w5', exercise: 'Lat Pulldown', set_number: 1, weight: 55, reps: 12, variation: 'Close', rest_seconds: 70, superset_group: null, created_at: '2026-08-07T09:00:00' },
      { id: 's10', workout_id: 'w5', exercise: 'Hammer Curl', set_number: 1, weight: 14, reps: 10, variation: null, rest_seconds: 0, superset_group: null, created_at: '2026-08-07T09:15:00' },
      // w6 — the most recent upper-a. Only the Narrow variation of Lat Pulldown, so the
      // other-variation backfill in loadPreviousSetsForSession has to reach back to w2.
      { id: 's11', workout_id: 'w6', exercise: 'Lat Pulldown', set_number: 1, weight: 65, reps: 8, variation: 'Narrow', rest_seconds: 100, superset_group: null, created_at: '2026-08-08T09:05:00' },
      { id: 's12', workout_id: 'w6', exercise: 'Lat Pulldown', set_number: 2, weight: 65, reps: 7, variation: 'Narrow', rest_seconds: 0, superset_group: null, created_at: '2026-08-08T09:05:00' },
      // w8 — an Open workout that was never completed
      { id: 's13', workout_id: 'w8', exercise: 'Hammer Curl', set_number: 1, weight: 16, reps: 8, variation: null, rest_seconds: 0, superset_group: null, created_at: '2026-08-10T09:00:00' },
    ],
    cardio_logs: [
      { id: 'c1', workout_id: 'w1', activity: 'Treadmill', duration_mins: 15, distance: null, floors: null, incline: 14, speed_kmh: 5 },
      { id: 'c2', workout_id: 'w7', activity: 'Bike', duration_mins: 20, distance: 8, floors: null, incline: null, speed_kmh: null },
    ],
    daily_logs: [
      { id: 'd1', date: '2026-08-09', weight: 82.4, steps: 9000, calories: 2100 },
      { id: 'd2', date: '2026-08-08', weight: 82.6, steps: 7400, calories: 1980 },
    ],
  };
}

// ── the query engine ────────────────────────────────────────────────────────

// Splits on commas that aren't inside an embed's parentheses, so
// `id,date,workout_sets(exercise,reps),cardio_logs(activity)` yields three entries, not five.
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

// `in.("Leg Press","Dips")` and `in.(w1,w2)` — the app writes both, quoted and bare.
function parseInList(v) {
  const inner = v.replace(/^\(/, '').replace(/\)$/, '');
  if (!inner) return new Set();
  return new Set(splitTop(inner).map(x => x.trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"')));
}

function applyFilter(rows, col, expr) {
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  const val = expr.slice(dot + 1);
  if (op === 'eq') return rows.filter(r => String(r[col]) === val);
  if (op === 'gte') return rows.filter(r => String(r[col]) >= val);
  if (op === 'lte') return rows.filter(r => String(r[col]) <= val);
  if (op === 'in') { const set = parseInList(val); return rows.filter(r => set.has(String(r[col]))); }
  if (expr === 'not.is.null') return rows.filter(r => r[col] != null);
  if (expr === 'is.null') return rows.filter(r => r[col] == null);
  throw new Error(`fake-postgrest: unsupported filter ${col}=${expr}`);
}

function applyOrder(rows, spec) {
  if (!spec) return rows;
  const keys = spec.split(',').map(part => {
    const [col, dir] = part.split('.');
    return { col, sign: dir === 'desc' ? -1 : 1 };
  });
  // V8's sort is stable, so equal keys keep insertion order — the same tie-break both versions see.
  return rows.slice().sort((a, b) => {
    for (const { col, sign } of keys) {
      const x = a[col], y = b[col];
      if (x === y) continue;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x < y ? -1 : 1) * sign;
    }
    return 0;
  });
}

function project(row, cols) {
  if (cols.includes('*')) return { ...row };
  const out = {};
  for (const c of cols) out[c] = row[c];
  return out;
}

function runQuery(data, path) {
  const qIdx = path.indexOf('?');
  const table = qIdx < 0 ? path : path.slice(0, qIdx);
  if (!data[table]) throw new Error(`fake-postgrest: unknown table ${table}`);
  const params = [...new URLSearchParams(qIdx < 0 ? '' : path.slice(qIdx + 1))];

  let rows = data[table].slice();
  let select = '*', order = null, limit = null;
  const embedParams = {};

  for (const [k, v] of params) {
    if (k === 'select') { select = v; continue; }
    if (k === 'order') { order = v; continue; }
    if (k === 'limit') { limit = Number(v); continue; }
    const dot = k.indexOf('.');
    if (dot > 0 && data[k.slice(0, dot)]) {
      const tbl = k.slice(0, dot), key = k.slice(dot + 1);
      const bag = (embedParams[tbl] ||= { filters: [] });
      if (key === 'order') bag.order = v;
      else bag.filters.push([key, v]);
      continue;
    }
    rows = applyFilter(rows, k, v);
  }

  rows = applyOrder(rows, order);
  if (limit != null) rows = rows.slice(0, limit);

  const parts = splitTop(select).map(p => {
    const m = p.match(/^([a-z_]+)\((.*)\)$/);
    return m ? { embed: m[1], cols: splitTop(m[2]) } : { col: p };
  });
  const plainCols = parts.filter(p => p.col).map(p => p.col);
  const embeds = parts.filter(p => p.embed);

  return rows.map(row => {
    const out = project(row, plainCols);
    for (const { embed, cols } of embeds) {
      if (!FK[embed]) throw new Error(`fake-postgrest: no foreign key from ${embed} to ${table}`);
      let kids = data[embed].filter(c => c[FK[embed]] === row.id);
      for (const [col, expr] of (embedParams[embed]?.filters || [])) kids = applyFilter(kids, col, expr);
      kids = applyOrder(kids, embedParams[embed]?.order);
      // Childless parents come back with an empty array, not null, and are NOT dropped by a filter
      // on the embedded resource — both checked against the live database on 15 Aug 2026.
      out[embed] = kids.map(k => project(k, cols));
    }
    return out;
  });
}

// The `sb()` the extracted app code is handed. Records every path so a test can assert on the
// number of round trips, which is the entire point of the change being tested.
function makeSb(data = db()) {
  const requests = [];
  const sb = async (path, method = 'GET') => {
    if (method !== 'GET') throw new Error('fake-postgrest: reads only');
    requests.push(path);
    return runQuery(data, path);
  };
  return { sb, requests, data };
}

module.exports = { db, makeSb, runQuery };
