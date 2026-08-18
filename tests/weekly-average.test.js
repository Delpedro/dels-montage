// Weekly average weight (17 Aug 2026) — Del's ask: "somewhere on the app, see the weekly average
// of my weight… select week 2, it only compares it to the current week, nothing more or less."
//
// The weight of this file is on the week NUMBERING, not the arithmetic. Averaging six numbers is
// not where this breaks; deciding which six belong to "week 6", and what makes a week week 6 in
// the first place, is.
//
// Renumbered 18 Aug 2026 after UAT. Numbers were ISO-8601 calendar weeks, so the card said "Week
// 33" to the one person using the app, who thinks in "week 6 of tracking my weight". Weeks now
// count from the start of the current RUN of weigh-ins, and a long enough silence starts a new
// run — which is the whole reason his abandoned Apr–May block doesn't push this week up to 19.
// Both edges of that rule are asserted below, because getting the threshold wrong is silent: the
// card still renders, it just prints a confidently wrong number.
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

// A DOM just big enough for the two render functions.
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
  ['weekavg-card', 'weekavg-wk-name', 'weekavg-range', 'weekavg-val', 'weekavg-cmp',
   'weekavg-prev', 'weekavg-next',
   'weekavg-waist', 'weekavg-waist-val', 'weekavg-waist-cmp'].forEach(get);
  return { els, get, document: { getElementById: id => get(id) } };
}

function harness(today) {
  const dom = fakeDom();
  const app = load({
    functions: ['mondayOf', 'weeksBetween', 'weekRangeLabel',
                'renderWeeklyAverage', 'showWeeklyAverage', 'showWeeklyWaist', 'stepWeeklyAverage',
                'dateStr', 'weekIndex'],
    decls: ['WEEKAVG_RUN_GAP', '_weekAvgs', '_weekAvgKey', '_weekWaists'],
    deps: { document: dom.document, esc: s => String(s), jsAttr: s => String(s), todayStr: () => today }
  });
  return { app, els: dom.els, get: dom.get };
}

console.log('Weekly average weight');

// ── Week arithmetic ───────────────────────────────────────────────────────────────────────────
{
  const { app } = harness('2026-08-17');

  eq(app.weeksBetween('2026-08-10', '2026-08-17'), 1, 'consecutive Mondays are one week apart');
  eq(app.weeksBetween('2026-08-17', '2026-08-17'), 0, 'a Monday is zero weeks from itself');
  eq(app.weeksBetween('2026-07-13', '2026-08-17'), 5, '13 Jul to 17 Aug is five weeks');

  // British Summer Time ends on Sunday 25 Oct 2026, so this pair is 7 days and 1 hour apart in
  // local time. Parsed locally it can floor to 6, and every week after the clocks change is then
  // numbered one short; parsed as UTC — which is what the function does — it stays 1.
  eq(app.weeksBetween('2026-10-19', '2026-10-26'), 1, 'the week the clocks change is still one week');

  // No ISO year left to get wrong: the anchor is a real date, so a run crossing new year just
  // keeps counting instead of resetting to week 1 on 1 January.
  eq(app.weeksBetween('2025-12-29', '2026-01-05'), 1, 'a run carries across the year boundary');
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

// ── Where a run starts and stops ──────────────────────────────────────────────────────────────
{
  // The threshold, from both sides. WEEKAVG_RUN_GAP is counted in EMPTY weeks: two off is a
  // holiday and keeps the count going, three off is a stop and resets it.
  const near = harness('2026-08-17');
  near.app.renderWeeklyAverage([
    { date: '2026-07-13', weight_kg: 82 },
    { date: '2026-08-03', weight_kg: 81 }   // two empty weeks in between
  ]);
  eq(near.els['weekavg-wk-name'].textContent, 'Week 4',
     'two empty weeks is a break inside a run, not the end of one — and the missed weeks still count');

  const far = harness('2026-08-17');
  far.app.renderWeeklyAverage([
    { date: '2026-07-13', weight_kg: 82 },
    { date: '2026-08-10', weight_kg: 81 }   // three empty weeks in between
  ]);
  eq(far.els['weekavg-wk-name'].textContent, 'Week 1',
     'three empty weeks ends the run, so the next weigh-in is week 1 again');
}

// ── The card itself ───────────────────────────────────────────────────────────────────────────
{
  // The real shape of Del's data on 18 Aug 2026: an abandoned block in April, a seven-week silence,
  // then the run he is actually on — six logged weeks, the last of them today's.
  const logs = [
    { date: '2026-04-13', weight_kg: 90 },                                        // old run, week 1
    { date: '2026-04-20', weight_kg: 89 },                                        // old run, week 2
    { date: '2026-07-13', weight_kg: 82 }, { date: '2026-07-15', weight_kg: 81 }, // week 1 → 81.5
    { date: '2026-07-20', weight_kg: 81 },                                        // week 2
    { date: '2026-07-27', weight_kg: 81 },                                        // week 3
    { date: '2026-08-03', weight_kg: 80.8 },                                      // week 4
    { date: '2026-08-10', weight_kg: 80 }, { date: '2026-08-16', weight_kg: 81 }, // week 5 → 80.5
    { date: '2026-08-17', weight_kg: 79 }                                         // week 6 → 79.0
  ];
  const { app, els } = harness('2026-08-17');
  app.renderWeeklyAverage(logs);

  ok(els['weekavg-card'].style.display === 'block', 'card is shown once there is at least one weigh-in');

  // The number Del gave in UAT: the week he is in is week 6 of tracking his weight, so the last
  // completed week is 5. This is the assertion the whole renumbering exists for.
  eq(els['weekavg-wk-name'].textContent, 'Week 5',
     'opens on week 5, the last completed week — not on week 6, and not on week 33');
  eq(els['weekavg-range'].textContent, '10 – 16 Aug', 'with its dates under the name');
  eq(els['weekavg-val'].innerHTML.startsWith('80.5'), true, 'week 5 averages 80.5 from 80 and 81');

  // A stepper, so nothing is on screen but the week you're on — and no list of any kind. Both
  // earlier pickers were rejected; see the CSS note on .weekavg-body.
  app.stepWeeklyAverage(-1);
  eq(els['weekavg-wk-name'].textContent, 'Week 4', '‹ steps back in time');
  app.stepWeeklyAverage(1);
  eq(els['weekavg-wk-name'].textContent, 'Week 5', '› steps forward again');

  // Stepping back past the start of this run lands in the abandoned one, which numbers from its
  // own week 1. The dates under the number are what tell the two week 2s apart — and the jump from
  // July to April in that line is the boundary made visible.
  ['Week 4', 'Week 3', 'Week 2', 'Week 1'].forEach(w => {
    app.stepWeeklyAverage(-1);
    eq(els['weekavg-wk-name'].textContent, w, `stepping back reaches ${w} of this run`);
  });
  eq(els['weekavg-range'].textContent, '13 – 19 Jul', 'week 1 of this run is the week of 13 Jul');

  app.stepWeeklyAverage(-1);
  eq(els['weekavg-wk-name'].textContent, 'Week 2', 'one more step lands in the abandoned April block…');
  eq(els['weekavg-range'].textContent, '20 – 26 Apr', '…numbered from its own start, not carried on from July');

  // Running off either end must stop dead, not wrap — wrapping would jump from this week to April.
  app.stepWeeklyAverage(-1);
  eq(els['weekavg-prev'].disabled, true, 'the oldest week disables ‹');
  eq(els['weekavg-next'].disabled, false, 'but not ›');
  app.stepWeeklyAverage(-1);
  eq(els['weekavg-range'].textContent, '13 – 19 Apr', 'stepping past the oldest week does nothing');

  app.showWeeklyAverage('2026-08-17');
  eq(els['weekavg-next'].disabled, true, 'the newest week disables ›');
  app.stepWeeklyAverage(1);
  eq(els['weekavg-wk-name'].textContent, 'Week 6', 'stepping past the newest week does nothing');

  // The one comparison the card makes, and the only one Del asked for — always against the week
  // he is in now, whatever he has picked.
  app.showWeeklyAverage('2026-08-10');
  eq(els['weekavg-cmp'].textContent, '▼ 1.5kg vs this week (79.0kg)', 'week 5 vs this week');
  eq(els['weekavg-cmp'].className, 'weekavg-cmp down', 'losing weight reads as green, not amber');

  app.showWeeklyAverage('2026-07-13');
  eq(els['weekavg-val'].innerHTML.startsWith('81.5'), true, 'week 1 averages 81.5');
  eq(els['weekavg-cmp'].textContent, '▼ 2.5kg vs this week (79.0kg)',
     'week 1 is still compared to THIS week — never to week 5 in between');

  // Even a week out of the abandoned run compares to the current week and nothing else. The delta
  // reads forwards — this week measured against the one you picked — so eleven kilos lighter now
  // than in April is a ▼ and green, not an ▲ for "he used to be heavier".
  app.showWeeklyAverage('2026-04-13');
  eq(els['weekavg-cmp'].textContent, '▼ 11.0kg vs this week (79.0kg)',
     'a week from the old block still compares to this week');
  eq(els['weekavg-cmp'].className, 'weekavg-cmp down', 'and being lighter now than then reads as green');

  // Selecting the current week has nothing to compare against; say so rather than printing 0.0kg.
  app.showWeeklyAverage('2026-08-17');
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
  app.showWeeklyAverage('2026-08-10');
  eq(els['weekavg-val'].innerHTML.startsWith('80.5'), true, 'null and blank weights are skipped, not counted as 0');

  // Numeric strings are what PostgREST actually hands back for a numeric column.
  const b = harness('2026-08-17');
  b.app.renderWeeklyAverage([{ date: '2026-08-10', weight_kg: '80.4' }, { date: '2026-08-11', weight_kg: '80.6' }]);
  b.app.showWeeklyAverage('2026-08-10');
  eq(b.els['weekavg-val'].innerHTML.startsWith('80.5'), true, 'string weights average as numbers, not concatenate');

  // No weigh-in this week at all — the comparison has no right-hand side.
  const c = harness('2026-08-17');
  c.app.renderWeeklyAverage([{ date: '2026-07-13', weight_kg: 82 }, { date: '2026-07-14', weight_kg: 82 }]);
  eq(c.els['weekavg-cmp'].textContent, 'No weigh-in yet this week',
     'with nothing logged this week the card says so instead of comparing to undefined');

  // The very first week of all: week 1, and it is the week you are in.
  const e = harness('2026-08-17');
  e.app.renderWeeklyAverage([{ date: '2026-08-17', weight_kg: 79 }]);
  eq(e.els['weekavg-wk-name'].textContent, 'Week 1', 'the first week you ever weigh in is week 1');
  eq(e.els['weekavg-cmp'].textContent, 'This week so far', 'and it is the week you are in');

  // Nothing at all: the card hides rather than rendering an empty picker over "--kg".
  const d = harness('2026-08-17');
  d.app.renderWeeklyAverage([]);
  eq(d.els['weekavg-card'].style.display, 'none', 'no weigh-ins at all hides the whole card');
}

// ── The waist half of the card (18 Aug 2026) ──────────────────────────────────────────────────
//
// Waist is measured about once a week, which is what makes it awkward on a card built from
// weigh-ins: most weeks have five weights and one waist, and some weeks have a weight and no waist
// at all. What is asserted here is that the two halves stay independent — the week you land on is
// still chosen by the weights, and the waist line says what it has rather than inventing a number.
{
  const weights = [
    { date: '2026-07-13', weight_kg: 82 },
    { date: '2026-07-20', weight_kg: 81 },
    { date: '2026-08-10', weight_kg: 80 },
    { date: '2026-08-17', weight_kg: 79 }
  ];

  // Nothing measured yet: the card is exactly what it was before this feature shipped.
  const none = harness('2026-08-17');
  none.app.renderWeeklyAverage(weights, []);
  eq(none.els['weekavg-waist'].style.display, 'none',
     'with no waist ever logged the whole waist block stays hidden');

  // Called the old way, with one argument, as anything not yet updated would.
  const legacy = harness('2026-08-17');
  legacy.app.renderWeeklyAverage(weights);
  eq(legacy.els['weekavg-waist'].style.display, 'none',
     'and renderWeeklyAverage still works called with weights alone');

  const waists = [
    { date: '2026-07-13', waist_cm: 99 },
    { date: '2026-07-20', waist_cm: 98.4 },
    // Nothing in the week of 10 Aug — a week he skipped the tape.
    { date: '2026-08-17', waist_cm: 96 }
  ];
  const { app, els } = harness('2026-08-17');
  app.renderWeeklyAverage(weights, waists);

  // Opens on the last completed week, chosen by the WEIGHTS — the waist line follows it there and
  // has nothing for that week. It must say so, not fall back to the nearest measurement.
  eq(els['weekavg-wk-name'].textContent, 'Week 5', 'the week shown is still picked by the weigh-ins');
  eq(els['weekavg-waist'].style.display, 'block', 'the block shows once any waist exists');
  eq(els['weekavg-waist-val'].innerHTML.startsWith('--'), true, 'a week with no waist prints --');
  eq(els['weekavg-waist-cmp'].textContent, 'Not measured that week', 'and says why');

  // A week that has one, against the week he is in.
  app.showWeeklyAverage('2026-07-13');
  eq(els['weekavg-waist-val'].innerHTML.startsWith('99.0'), true, 'week 1 shows its waist');
  eq(els['weekavg-waist-cmp'].textContent, '▼ 3.0cm vs this week (96.0cm)', 'compared to this week');
  eq(els['weekavg-waist-cmp'].className, 'weekavg-waist-cmp down', 'a smaller waist now reads as green');

  // Same rule as the weight half: the current week has nothing to compare against.
  app.showWeeklyAverage('2026-08-17');
  eq(els['weekavg-waist-cmp'].textContent, 'This week so far', 'the current week compares to nothing');

  // Two measurements in one week average, and PostgREST hands numerics back as strings.
  const two = harness('2026-08-17');
  two.app.renderWeeklyAverage(weights, [
    { date: '2026-07-13', waist_cm: '99.0' },
    { date: '2026-07-15', waist_cm: '98.0' },
    { date: '2026-08-17', waist_cm: 96 }
  ]);
  two.app.showWeeklyAverage('2026-07-13');
  eq(two.els['weekavg-waist-val'].innerHTML.startsWith('98.5'), true,
     'two measurements in a week average as numbers, not concatenate');

  // Measured in the past but not yet this week — there is no right-hand side to the comparison.
  const stale = harness('2026-08-17');
  stale.app.renderWeeklyAverage(weights, [{ date: '2026-07-13', waist_cm: 99 }]);
  stale.app.showWeeklyAverage('2026-07-13');
  eq(stale.els['weekavg-waist-cmp'].textContent, 'Not measured this week yet',
     'with nothing measured this week the line says so instead of comparing to undefined');
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
