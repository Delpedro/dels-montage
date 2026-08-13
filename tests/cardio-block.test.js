// One cardio renderer, two screens — proving the collapse changed nothing you can see.
//
// The live workout logger and the History edit modal draw the identical cardio box, and used to do
// it with two near-identical copies of the same function ~350 lines apart. **Two separate bugs have
// already come from them drifting**: a fix lands on one, the other silently stays behind. Collapsed
// into `renderCardioBlock(entry, mode, sessionId)` on 13 Aug 2026.
//
// The risk in a merge like this is a silent cosmetic regression — a dropped attribute, a changed id —
// on a screen that isn't browser-tested. So `tests/fixtures/cardio-block-baseline.json` holds the
// **exact HTML the two original functions produced**, captured from the source immediately before
// they were deleted, for every activity in CARDIO_ACTIVITIES in both modes. The merged renderer has
// to reproduce it character for character.
//
// If you deliberately change the cardio box, this test SHOULD fail. Re-capture the baseline in the
// same commit as the change, so the diff shows exactly what moved.
//
// Run: node tests/cardio-block.test.js

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
  if (actual === expected) { pass++; return; }
  fail++;
  console.error(`  FAIL: ${label}`);
  console.error(`    expected: ${JSON.stringify(expected)}`);
  console.error(`    actual:   ${JSON.stringify(actual)}`);
}

// The real `esc`/`jsAttr`/`cardioDisplayName` are lifted alongside it rather than stubbed — the
// fixture was captured through the real ones too, so the comparison is against what the browser was
// actually handed. (A stubbed identity `jsAttr` quietly made the escaping assertion below fail
// against perfectly correct code, which is its own small lesson about stubbing.)
// `decls` are lifted into scope but not returned, so the activity list comes back via an accessor.
const { renderCardioBlock, activities } = load({
  functions: ['esc', 'jsAttr', 'cardioDisplayName', 'renderCardioBlock'],
  decls: ['CARDIO_BLOCK_MODES', 'CARDIO_ACTIVITIES', 'CARDIO_DISPLAY_NAMES', 'CARDIO_FIELD_LABELS'],
  accessors: { activities: '() => CARDIO_ACTIVITIES' },
});
const CARDIO_ACTIVITIES = activities();

const baseline = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'cardio-block-baseline.json'), 'utf8')
);

console.log('cardio block renders identically after the merge');

// ── 1. byte-for-byte against what the two old functions produced ────────────
for (const [key, expected] of Object.entries(baseline)) {
  const [mode, activity] = key.split(':');
  const entry = { id: activity === 'unknown' ? 1 : 3, activity: activity === 'unknown' ? 'Nope' : activity };
  const sessionId = mode === 'live' ? (activity === 'unknown' ? 'x' : 'lower-a') : undefined;
  eq(renderCardioBlock(entry, mode, sessionId), expected, `${key} renders exactly as it did before the merge`);
}

// ── 2. every activity is actually covered, so the baseline can't rot ────────
// Without this, adding a new activity to CARDIO_ACTIVITIES would leave it untested and the suite
// would still pass — the fixture is read from disk, not derived from the source.
for (const activity of Object.keys(CARDIO_ACTIVITIES)) {
  ok(baseline[`live:${activity}`] !== undefined, `${activity} has a live baseline — re-capture the fixture if you added it`);
  ok(baseline[`edit:${activity}`] !== undefined, `${activity} has an edit baseline`);
}

// ── 3. the differences between the two modes are the intended ones ──────────
// Everything above proves "unchanged". This proves the two modes still differ in exactly the four
// ways they are supposed to, so a future edit can't quietly collapse them into one behaviour.
{
  const live = renderCardioBlock({ id: 7, activity: 'HIIT' }, 'live', 'upper-a');
  const edit = renderCardioBlock({ id: 7, activity: 'HIIT' }, 'edit');

  ok(live.includes('id="cardio-block-7"'), 'live block keeps the cardio- id prefix');
  ok(edit.includes('id="ecardio-block-7"'), 'edit block keeps the ecardio- prefix, so ids never collide');
  ok(live.includes('id="cardio-7-duration"'), 'live field ids are unprefixed');
  ok(edit.includes('id="ecardio-7-duration"'), 'edit field ids are prefixed');

  ok(live.includes(`oninput="saveDraft('upper-a')"`), 'typing in the live logger saves the draft');
  ok(!edit.includes('saveDraft'), 'the edit modal has no draft to save — it edits rows that already exist');

  ok(live.includes('setCardioPreset(7, 5,'), 'live presets call the logger handler');
  ok(edit.includes('setEditCardioPreset(7, 5)'), 'edit presets call the modal handler');
  ok(live.includes('removeCardioEntry(7)'), 'live ✕ calls the logger handler');
  ok(edit.includes('removeEditCardioEntry(7)'), 'edit ✕ calls the modal handler');

  // The bit that made two copies worth having in the first place is now one line of config, so a
  // structural change genuinely lands on both screens.
  const strip = (s) => s.replace(/ecardio/g, 'cardio').replace(/ oninput="[^"]*"/g, '')
    .replace(/setEditCardioPreset/g, 'setCardioPreset').replace(/setCardioPreset\(7, (\d+), '[^']*'\)/g, 'setCardioPreset(7, $1)')
    .replace(/removeEditCardioEntry/g, 'removeCardioEntry');
  eq(strip(live), strip(edit), 'with the four known differences normalised away, the two modes are the same markup');
}

// ── 4. the guards ──────────────────────────────────────────────────────────
eq(renderCardioBlock({ id: 1, activity: 'Nope' }, 'live', 'x'), '', 'an unknown activity renders nothing rather than a broken box');
eq(renderCardioBlock({ id: 1, activity: 'HIIT' }, 'nonsense'), '', 'an unknown mode renders nothing rather than half a box');

// ── 5. escaping still happens at the same points ────────────────────────────
{
  const out = renderCardioBlock({ id: 2, activity: 'Bike' }, 'live', `o'brien & <b>`);
  ok(out.includes('&amp;') || out.includes("o'brien"), 'the session id reaches the draft call through jsAttr()');
  ok(!out.includes('<b>'), 'and an unescaped tag never lands in the markup');
}

console.log(`  ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
