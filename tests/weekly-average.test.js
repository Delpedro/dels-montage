// Weekly average weight (17 Aug 2026) — Del's ask: "somewhere on the app, see the weekly average
// of my weight… select week 2, it only compares it to the current week, nothing more or less."
//
// The weight of this file is on the week NUMBERING, not the arithmetic. Averaging six numbers is
// not where this breaks; deciding which six belong to "week 33" is. ISO-8601 was picked so the
// number matches a wall calendar, and its two nasty edges — the year boundary, and a Sunday
// belonging to the week that started the previous Monday — are both asserted here.
//
// Run: node tests/weekly-average.test.js

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

// A DOM just big enough for the two render functions. Ids are created on demand so the per-week
// pill elements (`weekavg-wk-2026-33`) exist as soon as the code asks for one, which is what lets
// the active-pill assertions below work.
function fakeDom() {
  const mk = () => ({
    style: {}, innerHTML: '', textContent: '', className: '', value: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    }
  });
  const els = {};
  const get = id => (els[id] ||= mk());
  ['weekavg-card', 'weekavg-weeks', 'weekavg-val', 'weekavg-range', 'weekavg-cmp'].forEach(get);
  return {
    els, get,
    document: {
      getElementById: id => get(id),
      // Only ever called with '.weekavg-wk' — every pill this run has created.
      querySelectorAll: () => Object.keys(els).filter(k => k.startsWith('weekavg-wk-')).map(k => els[k])
    }
  };
}

function harness(today) {
  const dom = fakeDom();
  const app = load({
    functions: ['isoWeek', 'isoWeekKey', 'mondayOf', 'weekRangeLabel',
                'renderWeeklyAverage', 'showWeeklyAverage', 'dateStr', 'weekIndex'],
    decls: ['_weekAvgs'],
    deps: { document: dom.document, esc: s => String(s), jsAttr: s => String(s), todayStr: () => today }
  });
  return { app, els: dom.els, get: dom.get };
}

console.log('Weekly average weight');

// ── ISO week numbers ──────────────────────────────────────────────────────────────────────────
{
  const { app } = harness('2026-08-17');

  eq(app.isoWeek('2026-07-06').week, 28, 'Mon 6 Jul 2026 is week 28 (the untracked intro week)');
  eq(app.isoWeek('2026-07-13').week, 29, 'Mon 13 Jul 2026 is week 29');
  eq(app.isoWeek('2026-08-17').week, 34, 'Mon 17 Aug 2026 is week 34');

  // Sunday closes the week that started the previous Monday. getUTCDay() calls Sunday 0, which
  // would make it look like the start of the NEXT week and split every Sunday weigh-in off from
  // the six days it belongs with.
  eq(app.isoWeek('2026-07-19').week, 29, 'Sun 19 Jul belongs to week 29, not 30');
  eq(app.isoWeek('2026-07-20').week, 30, 'Mon 20 Jul starts week 30');

  // The year boundary. 29 Dec 2025 is a Monday whose Thursday falls in 2026, so ISO puts the whole
  // week in 2026 week 1. Keying on the week number alone would file it under 2025.
  const ny = app.isoWeek('2025-12-29');
  eq(ny.week, 1, '29 Dec 2025 is week 1…');
  eq(ny.year, 2026, '…of 2026, not 2025');

  // Keys are zero-padded so a plain string sort stays chronological — the card sorts on them.
  eq(app.isoWeekKey('2026-08-17'), '2026-34', 'key is year-week');
  ok(app.isoWeekKey('2026-02-02') < app.isoWeekKey('2026-08-17'), 'week 6 sorts before week 34');
  ok(app.isoWeekKey('2025-12-01') < app.isoWeekKey('2025-12-29'), 'last year sorts before this one');
}

// ── Week boundaries and labels ────────────────────────────────────────────────────────────────
{
  const { app } = harness('2026-08-17');

  eq(app.mondayOf('2026-08-17'), '2026-08-17', 'a Monday is its own Monday');
  eq(app.mondayOf('2026-08-23'), '2026-08-17', 'Sunday 23 Aug maps back to Monday 17 Aug');
  eq(app.mondayOf('2026-08-20'), '2026-08-17', 'Thursday maps back to the same Monday');

  eq(app.weekRangeLabel('2026-07-13'), '13 – 19 Jul', 'a week inside one month names the month once');
  eq(app.weekRangeLabel('2026-07-27'), '27 Jul – 2 Aug', 'a week straddling two months names both');
}

// ── The card itself ───────────────────────────────────────────────────────────────────────────
{
  // Two clean weeks plus a one-day current week, which is exactly the shape of today's real data.
  const logs = [
    { date: '2026-07-13', weight_kg: 82 }, { date: '2026-07-15', weight_kg: 81 },  // wk29 → 81.5
    { date: '2026-08-10', weight_kg: 80 }, { date: '2026-08-16', weight_kg: 81 },  // wk33 → 80.5
    { date: '2026-08-17', weight_kg: 79 }                                          // wk34 → 79.0
  ];
  const { app, els, get } = harness('2026-08-17');
  app.renderWeeklyAverage(logs);

  ok(els['weekavg-card'].style.display === 'block', 'card is shown once there is at least one weigh-in');

  // Pills, not a <select> — a native dropdown renders as unstyleable OS chrome and stretches the
  // full width of a desktop window. See the CSS note on .weekavg-weeks.
  ok(!/<option|<select/.test(els['weekavg-weeks'].innerHTML), 'the picker is not a native select');
  ok(/class="weekavg-wk"/.test(els['weekavg-weeks'].innerHTML), 'it is a row of pill buttons');
  ok(/W33/.test(els['weekavg-weeks'].innerHTML), 'the row lists week 33');

  // Opens on the last COMPLETED week. Opening on the current one would compare it against itself.
  ok(get('weekavg-wk-2026-33').classList.contains('active'), 'opens on week 33, not on week 34');
  ok(!get('weekavg-wk-2026-34').classList.contains('active'), 'the current week is not the one selected');
  eq(els['weekavg-val'].innerHTML.startsWith('80.5'), true, 'week 33 averages 80.5 from 80 and 81');
  eq(els['weekavg-range'].textContent, 'Week 33 · 10 – 16 Aug', 'the dates sit under the number');

  // Newest first, so the week you most likely want needs no scrolling and April's junk weeks are
  // simply further along the swipe.
  const order = (els['weekavg-weeks'].innerHTML.match(/>W(\d+)</g) || []).map(s => +s.slice(2, -1));
  eq(JSON.stringify(order), JSON.stringify([34, 33, 29]), 'weeks are listed newest first');

  // The one comparison the card makes, and the only one Del asked for.
  eq(els['weekavg-cmp'].textContent, '▼ 1.5kg vs this week (79.0kg)', 'week 33 vs this week');
  eq(els['weekavg-cmp'].className, 'weekavg-cmp down', 'losing weight reads as green, not amber');

  app.showWeeklyAverage('2026-29');
  eq(els['weekavg-val'].innerHTML.startsWith('81.5'), true, 'week 29 averages 81.5');
  eq(els['weekavg-cmp'].textContent, '▼ 2.5kg vs this week (79.0kg)',
     'week 29 is still compared to THIS week — never to week 33 in between');
  ok(get('weekavg-wk-2026-29').classList.contains('active'), 'the tapped pill lights up');
  ok(!get('weekavg-wk-2026-33').classList.contains('active'), 'and the previous one lets go');

  // Selecting the current week has nothing to compare against; say so rather than printing 0.0kg.
  app.showWeeklyAverage('2026-34');
  eq(els['weekavg-cmp'].textContent, 'This week so far', 'the current week compares to nothing');
  eq(els['weekavg-cmp'].className, 'weekavg-cmp flat', 'and is not coloured as a win or a loss');
}

// ── Gaps and empties ──────────────────────────────────────────────────────────────────────────
{
  // A check-in with no weight on it is not a weigh-in and must not drag an average toward zero.
  const { app, els } = harness('2026-08-17');
  app.renderWeeklyAverage([
    { date: '2026-08-10', weight_kg: 80 },
    { date: '2026-08-11', weight_kg: null },
    { date: '2026-08-12', weight_kg: '' },
    { date: '2026-08-13', weight_kg: 81 }
  ]);
  app.showWeeklyAverage('2026-33');
  eq(els['weekavg-val'].innerHTML.startsWith('80.5'), true, 'null and blank weights are skipped, not counted as 0');

  // Numeric strings are what PostgREST actually hands back for a numeric column.
  const b = harness('2026-08-17');
  b.app.renderWeeklyAverage([{ date: '2026-08-10', weight_kg: '80.4' }, { date: '2026-08-11', weight_kg: '80.6' }]);
  b.app.showWeeklyAverage('2026-33');
  eq(b.els['weekavg-val'].innerHTML.startsWith('80.5'), true, 'string weights average as numbers, not concatenate');

  // No weigh-in this week at all — the comparison has no right-hand side.
  const c = harness('2026-08-17');
  c.app.renderWeeklyAverage([{ date: '2026-07-13', weight_kg: 82 }, { date: '2026-07-14', weight_kg: 82 }]);
  eq(c.els['weekavg-cmp'].textContent, 'No weigh-in yet this week',
     'with nothing logged this week the card says so instead of comparing to undefined');

  // Nothing at all: the card hides rather than rendering an empty picker over "--kg".
  const d = harness('2026-08-17');
  d.app.renderWeeklyAverage([]);
  eq(d.els['weekavg-card'].style.display, 'none', 'no weigh-ins at all hides the whole card');
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
