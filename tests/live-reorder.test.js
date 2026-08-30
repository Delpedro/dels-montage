// Moving an exercise DURING a session, without touching the template. Del, 30 Aug 2026:
//
//   "let's say I start upper a, and the 2nd exercise on the list is busy so I pick something else on
//    the list, need the ability to move that up so it's in sequence (but don't affect the template)"
//
// The parenthesis is the requirement. Every case below that asserts an order also asserts that
// nothing was written to session_exercises, because a reorder that quietly edited Upper A would be
// worse than no reorder at all — it would rewrite next week's session from the gym floor.
//
// The other half is C12 in reverse. resolveBaseOrder() deliberately lets the TEMPLATE outrank the
// draft's stored order for a fixed session — that is the C12 fix and it has to stay, because a stale
// draft order is exactly what threw away a ✎ edit made mid-session on 26 Aug. Today's move is the
// opposite case: an order the lifter just made, which must survive a refresh. Hence its own field.
//
// Run: node tests/live-reorder.test.js

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
function deep(actual, expected, label) {
  ok(JSON.stringify(actual) === JSON.stringify(expected),
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log('moving an exercise mid-session (today only)');

// Upper A as it actually is, in template order.
const UPPER_A = ['Incline Chest Press', 'Incline DB Press', 'Incline DB Fly', 'Machine Chest Press',
  'Shoulder Press', 'Lateral Raise'];

const calls = { drafts: [], applied: 0, writes: [] };
let draftRaw = null;
const buttons = {};   // id → { disabled }

const app = load({
  functions: [
    'unitsInOrder', 'moveUnitInOrder', 'moveLoggerExercise', 'applyTodayOrder',
    'peekDraftSessionOrder', 'refreshMoveButtons', 'activeSupersetGroups',
    'displayExerciseOrder', 'snapSupersetsIntoOrder', 'renderSupersetControl', 'esc', 'jsAttr',
  ],
  decls: ['supersetBaseOrder', 'sessionOrderToday', 'supersetGroups', 'selectedSession'],
  deps: {
    applySupersetOrder: () => { calls.applied++; },
    saveDraft: (id) => { calls.drafts.push(id); },
    // If this is ever reached from a move, the feature has failed its one hard requirement.
    sb: async (p, method, body) => { calls.writes.push({ p, method, body }); return { ok: true }; },
    localStorage: { getItem: () => draftRaw },
    document: { getElementById: (id) => buttons[id] || null },
  },
  accessors: {
    base: '() => [...supersetBaseOrder]',
    today: '() => (sessionOrderToday ? [...sessionOrderToday] : sessionOrderToday)',
    setUp: `(names, groups) => {
      selectedSession = { id: 'upper-a', exercises: names.map(n => ({ name: n, sets: 3 })) };
      supersetBaseOrder = [...names];
      supersetGroups = groups || [];
      sessionOrderToday = null;
    }`,
  },
});

const fresh = (groups) => {
  app.setUp(UPPER_A, groups);
  calls.drafts = []; calls.applied = 0; calls.writes = [];
};

// ── 1. The pure move ────────────────────────────────────────────────────────────────────
{
  deep(app.moveUnitInOrder(UPPER_A, [], 'Incline DB Fly', -1).slice(0, 3),
    ['Incline Chest Press', 'Incline DB Fly', 'Incline DB Press'],
    '1. ↑ swaps a solo exercise with the one above it');

  deep(app.moveUnitInOrder(UPPER_A, [], 'Incline Chest Press', 1).slice(0, 2),
    ['Incline DB Press', 'Incline Chest Press'],
    '1. ↓ swaps it with the one below');

  deep(app.moveUnitInOrder(UPPER_A, [], 'Incline Chest Press', -1), UPPER_A,
    '1. the top block cannot go higher');
  deep(app.moveUnitInOrder(UPPER_A, [], 'Lateral Raise', 1), UPPER_A,
    '1. the bottom block cannot go lower');
  deep(app.moveUnitInOrder(UPPER_A, [], 'Not in this session', -1), UPPER_A,
    '1. a name that is not here moves nothing');

  const before = [...UPPER_A];
  app.moveUnitInOrder(UPPER_A, [], 'Lateral Raise', -1);
  deep(UPPER_A, before, '1. and the array it was given is never mutated');
}

// ── 2. A superset moves whole, never half ───────────────────────────────────────────────
// The 14 Aug bug: a plain adjacent swap stepped one member over its own partner, leaving the tag
// intact and the two rows split — and the logger snapped them back together anyway.
{
  const groups = [['Incline DB Press', 'Incline DB Fly']];
  deep(app.unitsInOrder(UPPER_A, groups)[1], ['Incline DB Press', 'Incline DB Fly'],
    '2. a pair is ONE unit');

  const moved = app.moveUnitInOrder(UPPER_A, groups, 'Incline DB Press', 1);
  deep(moved.slice(0, 4),
    ['Incline Chest Press', 'Machine Chest Press', 'Incline DB Press', 'Incline DB Fly'],
    '2. ↓ on one half takes the pair past the next block, still together');

  const up = app.moveUnitInOrder(UPPER_A, groups, 'Incline DB Fly', -1);
  deep(up.slice(0, 3), ['Incline DB Press', 'Incline DB Fly', 'Incline Chest Press'],
    '2. ↑ on the other half moves the same pair, not just the one tapped');

  // A group whose partner has been removed from the session is dormant, exactly as in the logger.
  deep(app.unitsInOrder(UPPER_A, [['Incline DB Press', 'Gone']])[1], ['Incline DB Press'],
    '2. a pairing whose partner is absent is a unit of one');
}

// ── 3. The live move, and what it must NOT do ───────────────────────────────────────────
{
  fresh();
  app.moveLoggerExercise('Incline DB Fly', -1);
  deep(app.base().slice(0, 3), ['Incline Chest Press', 'Incline DB Fly', 'Incline DB Press'],
    '3. the block moves up the live order');
  deep(app.today(), app.base(), '3. and today\'s order is recorded');
  eq(calls.applied, 1, '3. the screen is re-ordered in place');
  deep(calls.drafts, ['upper-a'], '3. and the draft is written once');

  // THE REQUIREMENT, stated as an assertion.
  deep(calls.writes, [], '3. NOTHING is written to the database — the template is untouched');

  fresh();
  app.moveLoggerExercise('Incline Chest Press', -1);
  deep(app.base(), UPPER_A, '3. a move with nowhere to go leaves the order alone');
  eq(app.today(), null, '3. and does not mark the session as reordered');
  eq(calls.applied, 0, '3. nor redraw');
  deep(calls.drafts, [], '3. nor write a draft');

  // Del's own scenario, end to end: the second machine is busy, so the third gets done first and
  // then gets moved up to where it actually happened.
  fresh();
  app.moveLoggerExercise('Incline DB Fly', -1);
  deep(app.displayExerciseOrder().slice(0, 3),
    ['Incline Chest Press', 'Incline DB Fly', 'Incline DB Press'],
    '3. the busy-machine case reads in the order it was trained');
  deep(calls.writes, [], '3. still nothing written');
}

// ── 4. Surviving a mid-session refresh ──────────────────────────────────────────────────
// applyTodayOrder runs AFTER resolveBaseOrder, never instead of it — the template still decides
// which exercises are in the session, today's order only decides where they sit.
{
  const template = [...UPPER_A];
  const today = ['Incline Chest Press', 'Incline DB Fly', 'Incline DB Press'];

  deep(app.applyTodayOrder(template, today).slice(0, 3), today,
    '4. what was moved keeps its place after a refresh');
  deep(app.applyTodayOrder(template, today).slice(3),
    ['Machine Chest Press', 'Shoulder Press', 'Lateral Raise'],
    '4. everything untouched follows in the template\'s order');

  deep(app.applyTodayOrder(template, null), template, '4. no moves made → the template order stands');
  deep(app.applyTodayOrder(template, []), template, '4. an empty order changes nothing');

  // A ✎ edit adding a lift while the session is open: it must appear, not vanish because today's
  // order has never heard of it.
  const grown = [...UPPER_A, 'Rear Delts'];
  ok(app.applyTodayOrder(grown, today).includes('Rear Delts'),
    '4. an exercise the template has since gained still appears');

  // And one removed from the session today must not be resurrected by the stored order.
  const shrunk = UPPER_A.filter(n => n !== 'Incline DB Press');
  ok(!app.applyTodayOrder(shrunk, today).includes('Incline DB Press'),
    '4. one removed today is not brought back by the stored order');
  deep(app.applyTodayOrder(shrunk, today).slice(0, 2), ['Incline Chest Press', 'Incline DB Fly'],
    '4. and the rest of the placing survives losing it');
}

// ── 5. Reading it back off the draft ────────────────────────────────────────────────────
{
  const order = ['Incline DB Fly', 'Incline Chest Press'];
  draftRaw = JSON.stringify({ sessionId: 'upper-a', sessionOrder: order, timestamp: Date.now() });
  deep(app.peekDraftSessionOrder('upper-a'), order, '5. today\'s order is read back');
  eq(app.peekDraftSessionOrder('lower-b'), null, '5. a draft for another session is ignored');

  draftRaw = JSON.stringify({ sessionId: 'upper-a', sessionOrder: order, timestamp: Date.now() - 25*60*60*1000 });
  eq(app.peekDraftSessionOrder('upper-a'), null, '5. and one from yesterday has expired');

  draftRaw = JSON.stringify({ sessionId: 'upper-a', timestamp: Date.now() });
  eq(app.peekDraftSessionOrder('upper-a'), null, '5. a session nobody reordered stores nothing');

  draftRaw = 'not json';
  eq(app.peekDraftSessionOrder('upper-a'), null, '5. a corrupt draft answers null rather than throwing');
  draftRaw = null;
  eq(app.peekDraftSessionOrder('upper-a'), null, '5. and so does no draft at all');
}

// ── 6. The arrows themselves ────────────────────────────────────────────────────────────
{
  const html = app.renderSupersetControl({ name: 'Lateral Raise', sets: 4 });
  ok(html.includes(`moveLoggerExercise('Lateral Raise', -1)`), '6. every block can move up');
  ok(html.includes(`moveLoggerExercise('Lateral Raise', 1)`), '6. and down');
  ok(html.includes('ex-tail-row'), '6. the arrows share the tail row with ⇄ Superset');
  // They stayed out of .ex-name-row on purpose — that row already carries the name, the ✕ and the
  // timer ring, and is where the 28 Aug clipping bug lived.
  ok(!/ex-name-row/.test(html), '6. and not the name row');
  ok(html.includes('aria-label="Move Lateral Raise earlier'), '6. and they say what they do');

  fresh();
  UPPER_A.forEach(n => { buttons[`move-up-${n}`] = { disabled: false }; buttons[`move-down-${n}`] = { disabled: false }; });
  app.refreshMoveButtons();
  eq(buttons['move-up-Incline Chest Press'].disabled, true, '6. the top block cannot move up');
  eq(buttons['move-down-Incline Chest Press'].disabled, false, '6. but can move down');
  eq(buttons['move-down-Lateral Raise'].disabled, true, '6. the bottom block cannot move down');
  eq(buttons['move-up-Lateral Raise'].disabled, false, '6. but can move up');
  eq(buttons['move-up-Shoulder Press'].disabled, false, '6. everything between moves both ways');

  // Both halves of a pair sit in the same unit, so both arrows answer for the unit, not the row.
  app.setUp(UPPER_A, [['Incline Chest Press', 'Incline DB Press']]);
  app.refreshMoveButtons();
  eq(buttons['move-up-Incline DB Press'].disabled, true,
    '6. the lower half of a pair at the top cannot move up either — the unit is already first');
}

console.log(`  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
