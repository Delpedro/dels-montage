// The overload panel — "last time" versus "the most you have ever done at this weight".
//
// Del's design, named in the gym on 7 Sept 2026: "a side modal for each exercise tile, that comes
// in from the side to contain overload information (so the last reps done are no longer there,
// giving more screen infrastructure) and we aim for best reps on the exercises to date versus the
// reps done last time". Cut J2 of a four-round contact sheet.
//
// What this file is really protecting is the BEAT number, because it is the one figure in D-LOG
// that is computed rather than recorded, and a wrong one sends him to a machine to chase a rep
// count he never actually did. The rule it must never break: a target is only ever offered at the
// weight it was set at. 12 reps at 60kg is not something to beat at 70kg.
//
// Run: node tests/overload-panel.test.js

const fs = require('fs');
const path = require('path');
const { load } = require('./extract');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  console.error('  FAIL: ' + label);
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');

// Real rows, in the shape PostgREST hands them back — weights as STRINGS with a trailing .0, which
// is half of why bestSetKey exists. Incline Chest Press, Del's actual history at 70kg, plus the
// 60kg outing it started from on 20 July.
const ICP_ROWS = [
  { exercise: 'Incline Chest Press', set_number: 1, weight: '60.0', reps: 6, variation: 'Smith', workout_id: 'w-jul20', workouts: { date: '2026-07-20' } },
  { exercise: 'Incline Chest Press', set_number: 2, weight: '60.0', reps: 4, variation: 'Smith', workout_id: 'w-jul20', workouts: { date: '2026-07-20' } },
  { exercise: 'Incline Chest Press', set_number: 1, weight: '70.0', reps: 6, variation: 'Smith', workout_id: 'w-aug15', workouts: { date: '2026-08-15' } },
  { exercise: 'Incline Chest Press', set_number: 2, weight: '70.0', reps: 8, variation: 'Smith', workout_id: 'w-aug15', workouts: { date: '2026-08-15' } },
  { exercise: 'Incline Chest Press', set_number: 3, weight: '70.0', reps: 7, variation: 'Smith', workout_id: 'w-aug15', workouts: { date: '2026-08-15' } },
  { exercise: 'Incline Chest Press', set_number: 1, weight: '70.0', reps: 7, variation: 'Smith', workout_id: 'w-sep01', workouts: { date: '2026-09-01' } },
  { exercise: 'Incline Chest Press', set_number: 2, weight: '70.0', reps: 6, variation: 'Smith', workout_id: 'w-sep01', workouts: { date: '2026-09-01' } },
  { exercise: 'Incline Chest Press', set_number: 3, weight: '70.0', reps: 5, variation: 'Smith', workout_id: 'w-sep01', workouts: { date: '2026-09-01' } },
];

function harness({ rows = ICP_ROWS, typed = {} } = {}) {
  const calls = [];
  const els = {};
  Object.entries(typed).forEach(([id, value]) => { els[id] = { value }; });

  const api = load({
    functions: ['fetchSetHistoryFor', 'fetchPreviousSetsFor', 'bestSetKey', 'sameLoadCheck', 'olWeightLabel',
                'prevSetsForVariation', 'overloadRowsFor', 'overloadPanelHtml'],
    decls: ['previousSets', 'bestSets', 'currentWorkoutId', 'selectedVariations', 'PREV_SETS_LOOKBACK_DAYS'],
    deps: {
      document: { getElementById: id => els[id] || null },
      sb: (url) => { calls.push(url); return Promise.resolve(rows); },
      dateStr: d => d.toISOString().slice(0, 10),
      isTimed: () => false,
      isOptionalWeight: () => false,
      esc: v => String(v),
    },
    accessors: {
      seed: '(p, b, v) => { previousSets = p; bestSets = b; selectedVariations = v || {}; }',
      prevOf: '() => previousSets',
      bestOf: '() => bestSets',
    },
  });
  return { ...api, calls, els };
}

// Every async block bumps this. Asserted at the end, because an assertion that lives inside a
// .then() stops running entirely if the promise rejects — and the suite would still print 0 failed.
// That is precisely how the empty-field case in confirm-dialog.test.js went quiet for a fortnight.
let thens = 0;

console.log('the overload panel');

// ── bestSetKey: one load, one key ──────────────────────────────────────────
// PostgREST returns "70.0"; a typed box returns "70". Keying on the raw text would file the same
// weight twice and every BEAT on a session where he typed the weight would come back empty.
{
  const h = harness();
  eq(h.bestSetKey('Smith', 1, '70.0'), h.bestSetKey('Smith', 1, 70),
     'a string weight and a number weight produce the same key');
  eq(h.bestSetKey('Smith', 1, '70'), h.bestSetKey('Smith', 1, '70.00'),
     'and so do two spellings of the same number');
  eq(h.bestSetKey(null, 1, null), h.bestSetKey('', 1, ''),
     'no variation and no weight is one key, not two — bodyweight work has to land somewhere');
  ok(h.bestSetKey('Smith', 1, 70) !== h.bestSetKey('Smith', 2, 70), 'set number is part of the key');
  ok(h.bestSetKey('Smith', 1, 70) !== h.bestSetKey('Smith', 1, 60), 'and so is the weight');
  ok(h.bestSetKey('Rope', 1, 70) !== h.bestSetKey('Machine', 1, 70), 'and so is the variation');
}

// ── one request feeds both halves ──────────────────────────────────────────
// The panel opens in a gym on 5G between sets. A "best ever" that fired its own query would be a
// round trip he stands there waiting for.
{
  const h = harness();
  h.fetchSetHistoryFor(['Incline Chest Press']).then(res => {
    thens++;
    eq(h.calls.length, 1, 'ONE request returns both last time and the ceiling');
    ok(res.prev['Incline Chest Press'], 'prev comes back');
    ok(res.best['Incline Chest Press'], 'best comes back off the same rows');

    // prev is the most recent outing only — 1 Sept, not 15 Aug and not 20 July.
    const prev = res.prev['Incline Chest Press'];
    eq(prev.length, 3, 'last time is one session, not the whole history');
    eq(prev[0].reps, 7, 'set 1 of 1 Sept');
    eq(prev[2].reps, 5, 'set 3 of 1 Sept');

    // best is the ceiling per (variation, set, weight).
    const best = res.best['Incline Chest Press'];
    eq(best[h.bestSetKey('Smith', 1, 70)], 7, 'best set 1 at 70kg is 7 — the 6 on 15 Aug loses to it');
    eq(best[h.bestSetKey('Smith', 2, 70)], 8, 'best set 2 at 70kg is 8, from 15 Aug, not 1 Septs 6');
    eq(best[h.bestSetKey('Smith', 3, 70)], 7, 'best set 3 at 70kg is 7, also from 15 Aug');
    eq(best[h.bestSetKey('Smith', 1, 60)], 6, 'the 60kg outing keeps its own ceiling, filed under 60');
    eq(best[h.bestSetKey('Smith', 3, 60)], undefined, 'and claims nothing on a set it never did');
  });
}

// ── ⭐ THE RULE: a target is only offered at the weight it was set at ───────
// This is the assertion the whole file exists for. 6 reps at 60kg was his best on set 1 in July;
// at 70kg it must never be offered as something to beat.
{
  const h = harness();
  h.fetchSetHistoryFor(['Incline Chest Press']).then(res => {
    thens++;
    h.seed(res.prev, res.best, { 'Incline Chest Press': 'Smith' });
    const ex = { name: 'Incline Chest Press', sets: 3, variations: ['Smith', 'Machine'] };
    const rows = h.overloadRowsFor(ex);

    eq(rows.length, 3, 'one row per programmed set');
    eq(rows[0].last, 7, 'LAST set 1 is what he did on 1 Sept');
    eq(rows[0].beat, 7, 'BEAT set 1 is his ceiling AT 70kg');
    eq(rows[1].last, 6, 'LAST set 2');
    eq(rows[1].beat, 8, 'BEAT set 2 is the 8 from 15 Aug — a different session, same weight');
    eq(rows[2].last, 5, 'LAST set 3');
    eq(rows[2].beat, 7, 'BEAT set 3');
  });
}

// Type a weight he has never used and BEAT correctly empties — a new load is a new baseline, and
// offering a rep count from a lighter one would be the app telling him to do less.
{
  const h = harness({ typed: { 'w-Incline Chest Press-1': '75' } });
  h.fetchSetHistoryFor(['Incline Chest Press']).then(res => {
    thens++;
    h.seed(res.prev, res.best, { 'Incline Chest Press': 'Smith' });
    const rows = h.overloadRowsFor({ name: 'Incline Chest Press', sets: 3, variations: ['Smith', 'Machine'] });
    eq(rows[0].beat, null, 'a weight with no history has nothing to beat');
    eq(rows[0].last, 7, 'but last time is still last time — it does not depend on what he types');
    eq(rows[1].beat, 8, 'and the sets he has not retyped are unaffected');
  });
}

// Drop back to a weight he HAS done and its own ceiling comes back, not 70kg's.
{
  const h = harness({ typed: { 'w-Incline Chest Press-1': '60' } });
  h.fetchSetHistoryFor(['Incline Chest Press']).then(res => {
    thens++;
    h.seed(res.prev, res.best, { 'Incline Chest Press': 'Smith' });
    const rows = h.overloadRowsFor({ name: 'Incline Chest Press', sets: 3, variations: ['Smith', 'Machine'] });
    eq(rows[0].beat, 6, 'at 60kg the target is the 60kg ceiling');
  });
}

// ── a set the template has but the history does not ────────────────────────
// Add a fourth set to a three-set lift and the fourth row must be blank, not a repeat of set 3.
{
  const h = harness();
  h.fetchSetHistoryFor(['Incline Chest Press']).then(res => {
    thens++;
    h.seed(res.prev, res.best, { 'Incline Chest Press': 'Smith' });
    const rows = h.overloadRowsFor({ name: 'Incline Chest Press', sets: 4, variations: ['Smith', 'Machine'] });
    eq(rows.length, 4, 'four programmed sets, four rows');
    eq(rows[3].last, null, 'set 4 has no last time');
    eq(rows[3].beat, null, 'and nothing to beat');
  });
}

// ── an exercise with no history at all ─────────────────────────────────────
// Single Arm PushDown, added mid-session on 7 Sept. Every row blank, nothing borrowed.
{
  const h = harness();
  h.seed({}, {}, {});
  const rows = h.overloadRowsFor({ name: 'Single Arm PushDown', sets: 2 });
  eq(rows[0].last, null, 'a brand-new exercise shows no last time');
  eq(rows[0].beat, null, 'and no target');
  eq(rows.length, 2, 'but it still gets a row per set, so the panel is not empty of structure');
}

// ── the markup ─────────────────────────────────────────────────────────────
// Set 1 decides whether the session moved, so it is the one that takes the size — and it is the
// grid's OWN figure rather than a second element above it, which is what keeps the panel one object.
{
  const h = harness();
  h.fetchSetHistoryFor(['Incline Chest Press']).then(res => {
    thens++;
    h.seed(res.prev, res.best, { 'Incline Chest Press': 'Smith' });
    const html = h.overloadPanelHtml({ name: 'Incline Chest Press', sets: 3, variations: ['Smith', 'Machine'] });

    eq((html.match(/ol-hero/g) || []).length, 1, 'exactly ONE hero figure, never two');
    ok(/(ol-beat|ol-eq) ol-hero/.test(html), 'and it is the target figure on set 1, not the LAST one');
    ok(!/ol-last[^"]*ol-hero/.test(html), 'never the LAST column');
    ok(html.includes('>Last<') && html.includes('>Beat<'), 'both columns are labelled');
    ok(!html.includes('>Best<'), 'the right column says BEAT, not BEST — it is a target, not a trophy');
    // ⚠️ P2: the first column is the LOAD, and the panel prints NO set numbers — the real set rows'
    // numbers show through the 12% gap it leaves on the left, so its own were a duplicate.
    eq((html.match(/ol-kg/g) || []).length, 3, 'one weight per programmed set');
    ok(!html.includes('ol-set'), 'and no set numbers of its own — the rows underneath already show them');
    ok(html.includes('>Kg<'), 'the column is labelled');
    eq((html.match(/>70</g) || []).length, 3, 'PostgREST\'s "70.0" prints as 70, on all three rows');
    ok(!html.includes('70.0'), 'never with the trailing zero the database hands back');

    // ⚠️ NO FOOTER ON AN ORDINARY LIFT (7 Sept 2026, cut L1). The panel used to print
    // "reps · Smith" along the bottom. Once it docked to the set rows instead of the whole tile,
    // the variation toggle and the rep-target tag were both left visible above it — so the footer
    // became the panel repeating two things already on screen.
    ok(!html.includes('ol-foot'), 'no footer: the variation and the rep target are still on the tile above');
    ok(!html.includes('Smith'), 'so the panel does not name the variation a visible button already names');
  });
}
// A missing figure is an em dash, not a blank cell and not a zero. Zero is a number he could have
// done; nothing is not.
{
  const h = harness();
  h.seed({}, {}, {});
  const html = h.overloadPanelHtml({ name: 'Single Arm PushDown', sets: 2 });
  eq((html.match(/—/g) || []).length, 6, 'two sets, three columns, six em dashes — the weight is missing too');
  ok(!/>0</.test(html), 'and never a zero');
}

// ── the weight column (P2, 7 Sept 2026) ────────────────────────────────────
// The panel shipped with reps and no load: "13" where the old badge said "52.5×13". Del: "where the
// fuck is the weight? am i to guess?" Missed because every mockup from round three on used a lift
// whose sessions were all at one weight, and the sheet carried it in a CAPTION rather than the panel.
{
  const h = harness();
  h.fetchSetHistoryFor(['Incline Chest Press']).then(res => {
    thens++;
    h.seed(res.prev, res.best, { 'Incline Chest Press': 'Smith' });
    const rows = h.overloadRowsFor({ name: 'Incline Chest Press', sets: 3, variations: ['Smith', 'Machine'] });
    eq(Number(rows[0].weight), 70, 'the row carries the load its figures were done at');
    eq(rows[0].lastWeight, null, 'and LAST needs no load of its own while the two agree');
  });
}
// ⭐ THE MISMATCH CASE. Type a weight he HAS history at but did not use last time, and the Kg column
// is naming a load LAST's reps were not done at. LAST then carries its own — "70×7" against a Kg
// column reading 60 — or the panel would attribute reps to a weight he never did them with.
{
  const h = harness({ typed: { 'w-Incline Chest Press-1': '60' } });
  h.fetchSetHistoryFor(['Incline Chest Press']).then(res => {
    thens++;
    h.seed(res.prev, res.best, { 'Incline Chest Press': 'Smith' });
    const ex = { name: 'Incline Chest Press', sets: 3, variations: ['Smith', 'Machine'] };
    const rows = h.overloadRowsFor(ex);
    eq(Number(rows[0].weight), 60, 'the Kg column follows the box he just typed in');
    eq(Number(rows[0].lastWeight), 70, 'and LAST is flagged as belonging to a different load');
    eq(rows[0].beat, 6, 'BEAT is the 60kg ceiling, not the 70kg one');
    eq(rows[0].level, false, 'and nothing goes green across two different loads');
    eq(rows[1].lastWeight, null, 'sets he did not retype are unaffected');

    const html = h.overloadPanelHtml(ex);
    ok(html.includes('70×7'), 'the panel spells last time out as 70×7 rather than a bare 7');
  });
}
// Bodyweight and band work have no kilos, and say what the tile's own weight column says.
{
  const h = harness();
  h.seed({}, {}, {});
  eq(h.olWeightLabel({ bodyweight: true }, null, null), 'BW', 'a bodyweight lift reads BW');
  eq(h.olWeightLabel({ band: true }, null, 'Black'), 'Black', 'a band exercise names the band');
  eq(h.olWeightLabel({ band: true }, null, null), 'Band', 'and falls back to Band with none picked');
  eq(h.olWeightLabel({}, null, null), '—', 'a loaded lift with no history shows a dash, not BW');
  eq(h.olWeightLabel({}, '47.5', null), '47.5', 'a half-plate weight keeps its half');
  const html = h.overloadPanelHtml({ name: 'Pallof Press', sets: 2, band: true, variations: ['Red', 'Black'] });
  ok(html.includes('>Band<'), 'and the column head says Band, not Kg, on a band exercise');
}

// ── N3: the sets he is already level on ────────────────────────────────────
// Del's Seated Calf Raise read 13/13, 11/11, 11/11 — two identical columns that look like a bug.
// They are not: he is sitting on his ceiling on every set. Green says so. Marked per set, so a
// mixed lift names the set with a rep still in it.
{
  const h = harness();
  h.fetchSetHistoryFor(['Incline Chest Press']).then(res => {
    thens++;
    h.seed(res.prev, res.best, { 'Incline Chest Press': 'Smith' });
    const rows = h.overloadRowsFor({ name: 'Incline Chest Press', sets: 3, variations: ['Smith', 'Machine'] });

    // Set 1: last 7, best at 70kg is 7 — he is level.
    eq(rows[0].level, true, 'set 1 matched his ceiling last time, so it is marked');
    // Sets 2 and 3: last 6 and 5 against ceilings of 8 and 7 — still out there.
    eq(rows[1].level, false, 'set 2 is 2 reps short of his best, so it is not');
    eq(rows[2].level, false, 'and neither is set 3');

    const html = h.overloadPanelHtml({ name: 'Incline Chest Press', sets: 3, variations: ['Smith', 'Machine'] });
    eq((html.match(/ol-eq/g) || []).length, 1, 'exactly one figure goes green — the set he matched');
    eq((html.match(/ol-beat(?! )/g) || []).length + (html.match(/ol-beat ol-hero/g) || []).length, 2,
       'and the two still out there stay on the target colour');
  });
}
// ⚠️ THE GUARD THAT MATTERS: green only when both figures describe the SAME LOAD. Type a weight he
// has never used and `beat` is answering a different question from `last` — matching them would
// paint a comparison that was never made.
{
  const h = harness({ typed: { 'w-Incline Chest Press-1': '75' } });
  h.fetchSetHistoryFor(['Incline Chest Press']).then(res => {
    thens++;
    h.seed(res.prev, res.best, { 'Incline Chest Press': 'Smith' });
    const rows = h.overloadRowsFor({ name: 'Incline Chest Press', sets: 3, variations: ['Smith', 'Machine'] });
    eq(rows[0].beat, null, 'no history at 75kg');
    eq(rows[0].level, false, 'and NOT marked level, even though last time he matched his 70kg best');
  });
}
// An exercise with no history is not "level with nothing".
{
  const h = harness();
  h.seed({}, {}, {});
  const rows = h.overloadRowsFor({ name: 'Single Arm PushDown', sets: 2 });
  eq(rows[0].level, false, 'two em dashes are not a match');
  const html = h.overloadPanelHtml({ name: 'Single Arm PushDown', sets: 2 });
  ok(!html.includes('ol-eq'), 'and nothing goes green on a lift that has never been done');
}

// ── source guards ──────────────────────────────────────────────────────────
// No behavioural test can notice a fourth column being helpfully reinstated on the set row next
// month, and that column is the whole point of the change.
{
  const logger = SRC.slice(SRC.indexOf('function renderSetRow'), SRC.indexOf('function setsStepperHtml'));
  ok(!logger.includes('prev-badge'),
     'the logger set row carries NO prev-badge — its numbers live in the panel now');
  ok(!/id="badge-/.test(logger), 'and no per-set badge element for anything to repaint');

  ok(/\.set-row\s*\{[^}]*grid-template-columns:\s*18px 1fr 1fr;/.test(CSS),
     'the set row is three columns, so both inputs keep the width the badge used to take');
  ok(/\.set-row\.has-prev\s*\{[^}]*18px 1fr 1fr 72px/.test(CSS),
     'and the History edit modal keeps its fourth column behind a named modifier');
  ok(SRC.includes('class="set-row has-prev"'),
     'which the edit modal actually asks for');

  // The colour rule, which is a project rule and not a preference: --accent means "you can tap
  // this". The tab is tappable; the numbers are not.
  ok(/\.overload-tab\s*\{[\s\S]*?var\(--accent\)/.test(CSS), 'the tab is accent — it is the pressable thing');
  ok(/\.ol-beat\s*\{\s*color:\s*var\(--sc\);/.test(CSS),
     'the BEAT column takes the SESSION colour, the same token as the rep-target tag: it states, it never invites a tap');
  ok(/\.ol-last\s*\{\s*color:\s*var\(--muted\);/.test(CSS), 'and LAST is muted — no verdict');

  // Rounds one to three were rejected for looking cluttered, and the cause was borders on
  // read-only figures. Nothing inside the panel may carry one.
  const panelCss = CSS.slice(CSS.indexOf('.ol-grid'), CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
  ok(!/border(?!-)/.test(panelCss) && !/border-\w+:/.test(panelCss),
     'NOT ONE BORDER inside the panel — the only bordered thing in a block stays something you can type in');
}

setTimeout(() => {
  eq(thens, 10, 'every async block actually ran — a rejected promise must fail loudly, not silently skip its assertions');
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
}, 80);
