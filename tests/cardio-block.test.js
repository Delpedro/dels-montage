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

// ── 6. THE ONE PICKER (E24, 31 Aug 2026) ───────────────────────────────────
// Two identical cards four millimetres apart became one card with a switch, because Del kept
// tapping the wrong one — "i keep getting this and the add exercise mixed up".
//
// What is worth pinning here is NOT the tint. It is that there is exactly ONE add card on the
// logger again; that both selects kept the ids the rest of the app addresses them by
// (renderOpenAddExerciseOptions, handleAddCardio and the draft restore all reach for them); that a
// cardio-only session gets no switch it cannot use; and that #cardio-list survives, because
// addCardioEntry() appends into it and addOpenExercise() inserts in front of it.
{
  const picker = load({
    functions: ['esc', 'cardioDisplayName', 'cardioSelectHtml', 'renderCardioList', 'renderAddToSessionRow'],
    decls: ['CARDIO_ACTIVITIES', 'CARDIO_DISPLAY_NAMES', 'addMode'],
    deps: {
      openExerciseSelectOptionsHtml: () => '<option value="">Choose an exercise…</option>',
      renderCardioBlock: () => '<div class="card cardio-block"></div>',
    },
    accessors: { setMode: '(m) => { addMode = m; }' },
  });

  const countOf = (html, needle) => html.split(needle).length - 1;

  picker.setMode('exercise');
  const ex = picker.renderAddToSessionRow({ id: 'upper-a', cardioEntries: [] });

  eq(countOf(ex, 'class="card"'), 1, 'ONE add card on the logger, not two — this is the whole item');
  eq(countOf(ex, 'class="field-label"'), 1, 'and one label, so there is no second grey heading to confuse it with');
  ok(ex.includes('id="add-to-session-row"'), 'the card has the anchor id the insert paths look for');
  ok(ex.includes('id="open-exercise-select"'), 'the exercise select keeps its id');
  ok(ex.includes('id="cardio-activity-select"'), 'the cardio select keeps its id, in the same card');
  ok(ex.includes('onchange="handleOpenExerciseSelect(this)"'), 'the exercise handler is unchanged');
  ok(ex.includes('onchange="handleAddCardio(this)"'), 'the cardio handler is unchanged');

  // The two halves swap on the switch; exactly one picker is ever visible.
  ok(/id="open-exercise-select"(?![^>]*\bhidden\b)[^>]*>/.test(ex), 'exercise mode shows the exercise select');
  ok(/id="cardio-activity-select"[^>]*\shidden/.test(ex), 'exercise mode hides the cardio select');
  ok(ex.includes('aria-selected="true"') && ex.includes('data-mode="exercise"'), 'the Exercise tab reports itself selected');

  picker.setMode('cardio');
  const ca = picker.renderAddToSessionRow({ id: 'upper-a', cardioEntries: [] });
  eq(countOf(ca, 'class="card"'), 1, 'still one card in cardio mode');
  ok(/id="open-exercise-select"[^>]*\shidden/.test(ca), 'cardio mode hides the exercise select');
  ok(/id="cardio-activity-select"(?![^>]*\bhidden\b)[^>]*>/.test(ca), 'cardio mode shows the cardio select');

  // A cardio-only session (CV + Pump) has no exercises to add. Offering a two-way switch there
  // would be offering a mode that cannot do anything.
  const only = picker.renderAddToSessionRow({ id: 'cv-pump', cardio: true, cardioEntries: [] });
  ok(!only.includes('add-seg'), 'a cardio-only session gets no switch');
  ok(/id="cardio-activity-select"(?![^>]*\bhidden\b)[^>]*>/.test(only), 'and its cardio picker is visible, not hidden behind a mode');

  // #cardio-list is now the divider between the lifts and the cardio, and both insert paths depend
  // on it existing even when nothing has been added yet.
  ok(picker.renderCardioList({ cardioEntries: [] }).includes('id="cardio-list"'),
    'the cardio list container renders even when empty, so appending to it cannot throw');
}

// ── 7. the two-headings pattern cannot come back unnoticed ─────────────────
// Same idea as the native-confirm() grep in tests/confirm-dialog.test.js: no behavioural test can
// notice a second "Add ..." card being pasted back onto the logger next month, and that is exactly
// how this bug existed in the first place.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  // Matches the rendered heading, not the phrase, so the comment above renderAddToSessionRow()
  // explaining why it went does not trip its own guard.
  ok(!/section-title[^>]*>\s*Cardio \(optional\)/.test(src),
    'the logger no longer renders a "Cardio (optional)" heading — it was half of what made the two boxes look alike');
  ok(!src.includes("id=\"add-cardio-row\""),
    'and the separate add-cardio row is gone with it');
  // ⚠️ NOT ASSERTED, AND DELIBERATELY: index.html still carries the same two-heading pattern in the
  // HISTORY EDIT MODAL (`edit-add-cardio-row` under its own "Cardio (optional)"). That is a
  // different screen from the one E24 was raised against and it is logged, not fixed.
  ok(!/function renderCardioSection\b/.test(src),
    'renderCardioSection no longer exists — renderCardioList + renderAddToSessionRow replaced it');
}

console.log(`  ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
