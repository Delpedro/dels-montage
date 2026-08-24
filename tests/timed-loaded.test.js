// Timed and loaded exercises (18 Aug 2026) — added with the programme review.
//
// The bug this exists to prevent is silent and costs data, not a crash. The logger decides whether
// to show a kg box with:
//
//     const isBodyweight = (ex.bodyweight || ex.band || isTimed(ex)) && !isOptionalWeight(ex);
//
// So ANY timed exercise is bodyweight unless it is also named in OPTIONAL_WEIGHT_EXERCISES. A carry
// is timed *and* the whole point is the load — miss the second list and Del logs a 40kg Farmers Walk,
// the weight is written as null, the workout saves green, and the exercise can never show
// progression. Nothing tells him. `DeadHang` is the existing exercise of this shape and is why the
// two lists stack in the first place.
//
// Both lists are keyed by lowercased, trimmed name, so casing in the ✎ editor doesn't matter — but a
// stray capital or space in the LIST itself would make an entry permanently unreachable, which is
// asserted below rather than eyeballed.
//
// Run: node tests/timed-loaded.test.js

const fs = require('fs');
const path = require('path');
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

const {
  timedTarget, isTimed, isOptionalWeight, looksLikeSeconds, setCatalogue,
  TIMED_EXERCISES, OPTIONAL_WEIGHT_EXERCISES,
} = load({
  decls: ['TIMED_EXERCISES', 'OPTIONAL_WEIGHT_EXERCISES', 'CATALOGUE_BY_KEY'],
  functions: ['timedTarget', 'isTimed', 'isOptionalWeight', 'looksLikeSeconds', 'catalogueKey'],
  accessors: {
    TIMED_EXERCISES: '() => TIMED_EXERCISES',
    OPTIONAL_WEIGHT_EXERCISES: '() => OPTIONAL_WEIGHT_EXERCISES',
    setCatalogue: '(m) => { CATALOGUE_BY_KEY = m; }',
  },
});

const TIMED = TIMED_EXERCISES();
const OPTIONAL = OPTIONAL_WEIGHT_EXERCISES();

// The logger's rule, copied here so the two shapes can be compared directly. Copied code drifts,
// so the last block below greps the source to prove this is still what app.js does.
const isBodyweight = ex => (ex.bodyweight || ex.band || isTimed(ex)) && !isOptionalWeight(ex);

// ── Side Plank: a pure hold. Seconds, no kg box. ──
ok(isTimed('Side Plank'), 'Side Plank is timed');
eq(timedTarget('Side Plank'), '30–45s', 'Side Plank default target');
ok(isTimed('side plank'), 'Side Plank is case-insensitive');
ok(isTimed('  Side Plank  '), 'Side Plank tolerates surrounding space');
ok(isTimed('Side Planks'), 'the plural resolves too');
ok(!isOptionalWeight('Side Plank'), 'Side Plank is not optionally loaded');
ok(isBodyweight({ name: 'Side Plank' }), 'Side Plank renders as bodyweight — no kg box');

// ── Farmers Walk: timed AND loaded. This is the pairing that bites. ──
ok(isTimed('Farmers Walk'), 'Farmers Walk is timed');
eq(timedTarget('Farmers Walk'), '40s', 'Farmers Walk default target');
ok(isOptionalWeight('Farmers Walk'), 'Farmers Walk is optionally loaded');
ok(!isBodyweight({ name: 'Farmers Walk' }), 'Farmers Walk KEEPS its kg box — the carried weight is the lift');
ok(!isBodyweight({ name: 'farmer walk' }), 'the singular spelling keeps its weight too');
ok(!isBodyweight({ name: 'Farmers Walks' }), 'the plural spelling keeps its weight too');

// ── DeadHang unchanged — the precedent, and a regression canary for both lists. ──
ok(isTimed('DeadHang'), 'DeadHang is still timed');
ok(isOptionalWeight('DeadHang'), 'DeadHang is still optionally loaded');
ok(!isBodyweight({ name: 'DeadHang' }), 'DeadHang still keeps its kg box');

// ── Ordinary lifts are untouched by any of this. ──
for (const name of ['Lateral Raise', 'Incline DB Fly', 'Reverse Wrist Curl', 'RDL', 'Hack Squat / Leg Press']) {
  ok(!isTimed(name), `${name} is not timed`);
  ok(!isOptionalWeight(name), `${name} is not optionally loaded`);
}
ok(isBodyweight({ name: 'Lower AB leg raises', bodyweight: true }), 'an explicit bodyweight flag still wins');
eq(timedTarget('Not An Exercise'), null, 'an unknown name is not timed');
eq(timedTarget(undefined), null, 'an undefined name does not throw');

// ── List hygiene: lookup lowercases and trims, so an entry that is not already lowercase and
//    trimmed can never be matched by anything. Cheap to assert, invisible to spot by eye. ──
for (const key of Object.keys(TIMED)) {
  eq(key, key.trim().toLowerCase(), `TIMED_EXERCISES key "${key}" is lowercase and trimmed`);
  ok(looksLikeSeconds(TIMED[key]), `TIMED_EXERCISES["${key}"] reads as a duration`);
}
for (const name of OPTIONAL) {
  eq(name, name.trim().toLowerCase(), `OPTIONAL_WEIGHT_EXERCISES "${name}" is lowercase and trimmed`);
}

// ── The structural rule, not the individual cases: every carry-shaped entry must be in BOTH lists.
//    A carry in TIMED_EXERCISES alone is exactly the silent data loss described at the top. ──
for (const key of Object.keys(TIMED)) {
  if (/walk|carry|carries/.test(key)) {
    ok(OPTIONAL.includes(key), `"${key}" is timed AND a carry, so it must also be optional-weight or its load is discarded`);
  }
}


// ── THE SHARED CATALOGUE (24 Aug 2026) ────────────────────────────────────────────────────────
// The two lists above can only ever match a SPELLING, which is why one lift needs six of them and
// why "Neutral Grip Pull-ups" — a name no list author thought of — silently loses its kg box and
// with it every loaded rep the user records. The catalogue matches a ROW instead, so a name nobody
// enumerated behaves correctly by construction.
//
// The precedence is asserted in BOTH directions on purpose. Each direction is a different data
// loss: a catalogue that cannot ADD optional-weight loses the load off a stranger's belt, and a
// catalogue that can REMOVE it would lose the load off Del's.
setCatalogue({
  'neutral grip pull-ups': { name: 'Neutral Grip Pull-ups', timed_target: null,  optional_weight: true  },
  'wall sit':              { name: 'Wall Sit',              timed_target: '45s', optional_weight: false },
  // Deliberately disagrees with TIMED_EXERCISES, which holds 'side plank' at '30–45s'.
  'side plank':            { name: 'Side Plank',            timed_target: null,  optional_weight: false },
});

ok(isOptionalWeight('Neutral Grip Pull-ups'),
  'a catalogue row makes a spelling nobody enumerated optional-weight — the exact store bug this fixes');
ok(isOptionalWeight('  NEUTRAL grip PULL-ups '),
  'and the catalogue lookup trims and lowercases, like the list lookup it replaces');
ok(!isBodyweight({ name: 'Neutral Grip Pull-ups' }),
  'so its kg box survives — which is the whole point, a loaded rep stays recordable');

eq(timedTarget('Wall Sit'), '45s', 'a catalogue row supplies its own time target');
ok(isTimed('Wall Sit'), 'and reads as timed');
ok(isBodyweight({ name: 'Wall Sit' }), 'a timed, unloaded catalogue lift is bodyweight');

eq(timedTarget('Side Plank'), '30–45s',
  'a catalogue row with a null timed_target does NOT veto the shipped list — this change can never ' +
  'take timed-ness away from something that already had it');
ok(isOptionalWeight('Pull-Ups'),
  'a name the catalogue has never heard of still falls back to the shipped list');

// ── And with no catalogue at all: a failed read, a first paint, an offline start. Every original
//    answer has to stand, because this is what Del's phone does on a bad gym connection. ──
setCatalogue({});
eq(timedTarget('Side Plank'), '30–45s', 'no catalogue — Side Plank is still timed');
eq(timedTarget('Farmers Walk'), '40s', 'no catalogue — a carry still has its target');
ok(isOptionalWeight('Dips'), 'no catalogue — Dips is still optionally loaded');
ok(!isOptionalWeight('Neutral Grip Pull-ups'), 'no catalogue — and the unenumerated name is back to being unknown');

// ── Prove the copied rule above still matches the source. The whole point of this file is that one
//    expression; a test asserting a private copy of it would pass forever after app.js changed. ──
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const rule = /const isBodyweight = \(ex\.bodyweight \|\| ex\.band \|\| isTimed\(ex\)\) && !isOptionalWeight\(ex\);/g;
const hits = (src.match(rule) || []).length;
ok(hits >= 1, 'the logger still decides bodyweight with the rule this file copies');
eq(hits, (src.match(/const isBodyweight = /g) || []).length, 'every isBodyweight in app.js uses that same rule');

console.log(`timed-loaded: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
