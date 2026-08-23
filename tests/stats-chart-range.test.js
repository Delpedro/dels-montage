// The Stats weight chart became interactive on 23 Aug 2026: range pills (7D/30D/90D/All) above it,
// and a drag/tap readout on the line itself.
//
// What this file guards is the half that can go quietly wrong — the windowing. The chart used to be
// a fixed `date >= today-21` filter followed by `.slice(-12)`, and the loader no longer slices at
// all: it hands over every weigh-in the account has and the range decides. Three ways that breaks:
//
//  · an off-by-one on the window edge — "7D" that quietly means 6 days or 8,
//  · the hero delta and the chart drawn over different slices (the exact shape of the Home/Stats
//    drift bug from 14 Aug), so the line shows a month and "▼ 0.2kg in 11 days" underneath it doesn't,
//  · label thinning written for a 12-point chart being handed 120 points on "All".
//
// The pointer handling is not covered here — there is no DOM in this harness, and a scrub readout is
// a thing Del checks with a finger, not an assertion.
//
// Run: node tests/stats-chart-range.test.js

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

// "Now" fixed at Sunday 23 August 2026, the day the pills shipped.
function dateAt(iso) {
  return class extends Date {
    constructor(...args) {
      if (args.length === 0) super(iso);
      else super(...args);
    }
  };
}

// One weigh-in a day from `from` to `to` inclusive, so a window's size is countable.
function daily(from, to) {
  const out = [];
  const d = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  let v = 80;
  while (d <= end) {
    out.push({ date: d.toISOString().slice(0, 10), v: Math.round((v -= 0.05) * 10) / 10 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function ranger(points, range = '30d') {
  const api = load({
    functions: ['pointsForStatsRange', 'statsRangeDef', 'setStatsRange', 'dateStr', 'statsRangeEmptyNote'],
    decls: ['STATS_RANGES', 'STATS_RANGE_STORE', 'statsRange', 'statsWeightPoints'],
    deps: {
      Date: dateAt('2026-08-23T12:00:00'),
      localStorage: { getItem: () => null, setItem: () => {} },
      renderWeightRange: () => {},
    },
    accessors: {
      seed: '(pts) => { statsWeightPoints = pts; }',
      current: '() => statsRange',
    },
  });
  api.seed(points);
  api.setStatsRange(range);
  return api;
}

// ── 1. each pill means the number of days on its label ─────────────────────
{
  console.log('the pills window exactly what they say');

  // 100 consecutive weigh-ins ending today, so a window of N days holds exactly N points.
  const pts = daily('2026-05-16', '2026-08-23');
  eq(pts[pts.length - 1].date, '2026-08-23', 'the run ends today');

  eq(ranger(pts, '7d').pointsForStatsRange().length, 7, '7D holds seven days');
  eq(ranger(pts, '30d').pointsForStatsRange().length, 30, '30D holds thirty');
  eq(ranger(pts, '90d').pointsForStatsRange().length, 90, '90D holds ninety');
  eq(ranger(pts, 'all').pointsForStatsRange().length, pts.length, 'All holds the lot');

  // The edge itself: 7D run on Sunday 23rd starts on Monday 17th, and the Sunday before is out.
  const week = ranger(pts, '7d').pointsForStatsRange();
  eq(week[0].date, '2026-08-17', '7D reaches back six days, not seven — today is one of the seven');
  eq(week[week.length - 1].date, '2026-08-23', 'and it runs up to today');

  // Ordering is the loader's, and the chart draws left-to-right off it.
  const all = ranger(pts, 'all').pointsForStatsRange();
  ok(all.every((p, i) => i === 0 || p.date > all[i - 1].date), 'the slice stays in ascending date order');
}

// ── 2. a short run doesn't fake a long one ─────────────────────────────────
{
  console.log('a range wider than the data is just the data');

  const pts = daily('2026-08-20', '2026-08-23');   // four weigh-ins, all of them this week
  eq(ranger(pts, '90d').pointsForStatsRange().length, 4, '90D on a four-day run shows four points');
  eq(ranger(pts, 'all').pointsForStatsRange().length, 4, 'and so does All');
  eq(ranger([], 'all').pointsForStatsRange().length, 0, 'no weigh-ins at all is an empty slice, not a throw');
}

// ── 3. a range with nothing in it says which range ─────────────────────────
{
  console.log('an empty window names its own window');

  // Del stops weighing in for a fortnight: 7D is legitimately empty and has to say so, because
  // "No weigh-ins yet" on an account with four months of history reads as data loss.
  const stale = daily('2026-06-01', '2026-08-01');
  const r7 = ranger(stale, '7d');
  eq(r7.pointsForStatsRange().length, 0, 'nothing in the last 7 days');
  eq(r7.statsRangeEmptyNote(false), 'No weigh-ins in the last 7 days', 'and the note names the window');
  eq(ranger(stale, 'all').statsRangeEmptyNote(false), 'No weigh-ins yet', 'only All is allowed to say "yet"');

  // One point is its own case: there is a weight to show in the hero but no line to draw.
  const one = ranger(daily('2026-08-23', '2026-08-23'), '7d');
  eq(one.pointsForStatsRange().length, 1, 'a single weigh-in survives the slice');
  ok(one.statsRangeEmptyNote(true).startsWith('Only one weigh-in in the last 7 days'),
    'and the chart says why it is blank rather than claiming there is nothing');
}

// ── 4. an unknown range id can't blank the page ────────────────────────────
{
  console.log('a junk range is ignored, not obeyed');

  const pts = daily('2026-05-16', '2026-08-23');
  const api = ranger(pts, '30d');
  api.setStatsRange('all-time');            // e.g. a stored id from a future build, rolled back
  eq(api.current(), '30d', 'an id that is not on the list is refused');
  eq(api.pointsForStatsRange().length, 30, 'so the chart keeps drawing what it was drawing');
}

// ── 5. hero and chart are handed the same slice ────────────────────────────
{
  console.log('the hero delta and the line agree on their window');

  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const fn = src.slice(src.indexOf('function renderWeightRange('), src.indexOf('function renderStatsRangePills('));

  eq((fn.match(/pointsForStatsRange\(\)/g) || []).length, 1,
    'renderWeightRange() slices once — two calls is how the two halves drift apart');
  ok(/renderWeightHero\(pts/.test(fn) && /renderWeightChart\(pts/.test(fn),
    'and passes that one slice to both the hero and the chart');

  // The loader must not pre-slice any more, or the pills can only ever narrow a fixed window.
  const loader = src.slice(src.indexOf('async function loadStats('), src.indexOf('function renderWeightHero('));
  ok(!loader.includes('.slice(-12)'), 'loadStats no longer caps the chart at 12 points');
  ok(loader.includes('statsWeightPoints ='), 'it hands the whole run to the range instead');
}

// ── 6. label thinning survives a hundred points ────────────────────────────
{
  console.log('the axis stays readable on All');

  // The rule out of renderWeightChart(), asserted against the source below so it can't drift.
  const thin = n => {
    const step = Math.max(1, Math.ceil(n / 6));
    const last = n - 1;
    let count = 0;
    for (let i = 0; i < n; i++) if (i === last || (i % step === 0 && last - i > step / 2)) count++;
    return count;
  };

  for (const n of [2, 5, 12, 30, 60, 120, 400]) {
    const c = thin(n);
    ok(c <= 8, `${n} points print at most 8 labels (got ${c})`);
    ok(c >= 2, `${n} points still print at least the ends (got ${c})`);
  }
  eq(thin(12), 6, 'the 12-point chart Del has today prints 6 labels, near enough what it always did');

  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const chart = src.slice(src.indexOf('function renderWeightChart('), src.indexOf('function bindChartScrub('));
  ok(chart.includes('Math.ceil(points.length / 6)'), 'the source still thins to ~6 labels');
  ok(chart.includes('points.length <= 24'), 'and drops the per-point dots once they would merge');
  ok(chart.includes('spanDays > 45'), 'a wide window names the month on the axis');
}

console.log(`  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
