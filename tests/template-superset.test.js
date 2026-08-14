// The ✎ template editor's superset picker — Del's 13 Aug report, fixed 14 Aug.
//
// He wanted Seated Calf Raise supersetted with *Single Leg Curl* in Lower B. The editor's picker could
// only offer what was already in the template, so the nearest name on the list — the seated **Leg
// Curl** — got picked instead, and pairing then dragged it out of its slot permanently: the pairing
// rewrote the exercise array itself, unpairing had no way back, and Save Changes wrote that order into
// session_exercises.sort_order.
//
// Every case below runs on the REAL Lower B order pulled from the live DB, because the bug is entirely
// about which row moves where and invented names hide that.
//
// Run: node tests/template-superset.test.js

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

console.log('template editor supersets');

// Lower B as it actually is in session_exercises, sort_order 0–7 (queried 14 Aug 2026).
const LOWER_B = ['Seated Calf Raise', 'RDL', 'Leg Curl', 'Leg Press', 'Hip Thrusts',
  'Abductor / Adductor', 'Lower AB leg raises', 'Pully Ab Crunch'];

// Single Leg Curl is in his workout_sets but NOT in custom_exercises, so it isn't in EXERCISE_LIBRARY
// either — the third strand of the report. Included here as a library entry so the add-and-pair path
// can be tested both ways: picked from the list, and typed in when it isn't on the list.
const LIBRARY = {};
[...LOWER_B, 'Single Leg Curl', 'Lying Leg Curl'].forEach(n => {
  LIBRARY[n] = { name: n, sets: 3, reps: '8–12', rest: '90s' };
});

const calls = { renders: 0, saved: [], toasts: [] };
let promptReturns = null;

const app = load({
  functions: [
    'esc', 'jsAttr', 'exerciseAddOptionsHtml', 'templateAddExerciseOptionsHtml',
    'activeTemplateGroups', 'templateGroupMap', 'templateGroupOf', 'templateUnits',
    'templateDisplayOrder', 'templateExerciseByName', 'pairTemplateSuperset', 'clearTemplateSuperset',
    'templateSupersetPickerHtml', 'addTemplateSupersetPartner', 'addTemplateExercise',
    'moveTemplateExercise', 'changeTemplateExerciseSets', 'removeTemplateExercise',
    'saveSessionTemplate',
  ],
  decls: ['editingTemplateExercises', 'editingTemplateGroups', 'editingTemplatePickerFor',
    'editingTemplateSessionId', 'EXERCISE_LIBRARY', 'selectedProgramme'],
  deps: {
    renderTemplateEditorRows: () => { calls.renders++; },
    // saveSessionTemplate's collaborators. sb() records the write so the row order can be asserted —
    // that order IS the bug: it's what made a mis-tapped pairing permanent.
    sb: async (path, method, body) => {
      if (method === 'POST') calls.saved.push(body);
      return { ok: true, status: 200 };
    },
    showToast: (msg, kind) => { calls.toasts.push([msg, kind]); },
    loadSessionTemplates: async () => {},
    buildExerciseLibrary: () => LIBRARY,
    closeSessionEditor: () => {},
    buildSessionGrid: () => {},
    // Mirrors the real one: it adds the typed exercise to the template itself and returns the name,
    // which is what lets the picker pair with something that didn't exist a second ago.
    promptTemplateCustomExercise: async () => {
      if (promptReturns) app.addTemplateExercise(promptReturns);
      return promptReturns;
    },
  },
  accessors: {
    order: '() => editingTemplateExercises.map(e => e.name)',
    groups: '() => editingTemplateGroups.map(g => [...g])',
    pickerFor: '() => editingTemplatePickerFor',
    setsOf: '(n) => (editingTemplateExercises.find(e => e.name === n) || {}).sets',
    reset: `(names, lib) => {
      editingTemplateExercises = names.map(n => ({ name: n, sets: 3, reps: '8–12', rest: '90s' }));
      editingTemplateGroups = [];
      editingTemplatePickerFor = null;
      editingTemplateSessionId = 'lower-b';
      EXERCISE_LIBRARY = lib;
    }`,
  },
});

const reset = () => app.reset(LOWER_B, LIBRARY);

// ═══════════════════════════════════════════════════════════════════════════
console.log('  pairing no longer moves anything permanently');
// ═══════════════════════════════════════════════════════════════════════════
// The exact sequence off his report, with the real functions on the real order:
//   SCR | RDL | Leg Curl → pair → SCR | Leg Curl | RDL → unpair → ???
// Before the fix the answer was SCR | Leg Curl | RDL — the mis-tap was unrepairable except with ↑/↓.
{
  reset();
  app.pairTemplateSuperset('Seated Calf Raise', 'Leg Curl');

  deep(app.templateDisplayOrder().slice(0, 4),
    ['Seated Calf Raise', 'Leg Curl', 'RDL', 'Leg Press'],
    'on screen the partner snaps up next to the exercise it was paired with');
  deep(app.order(), LOWER_B,
    'but the base order is untouched — the array pairing used to rewrite');

  app.clearTemplateSuperset('Leg Curl');
  deep(app.templateDisplayOrder(), LOWER_B,
    'unpairing puts Leg Curl back in its own slot — the whole defect, gone');
  deep(app.activeTemplateGroups(), [], 'a group left with one member stops being a superset');
}

{
  reset();
  app.pairTemplateSuperset('Seated Calf Raise', 'Leg Curl');
  app.clearTemplateSuperset('Seated Calf Raise');
  deep(app.templateDisplayOrder(), LOWER_B,
    'unpairing from the other side of the pair restores the order just the same');
}

{
  // Non-adjacent pairing across the whole session, then a third member (giant set), then dropping the
  // middle one — everything has to land back where it started.
  reset();
  app.pairTemplateSuperset('Seated Calf Raise', 'Pully Ab Crunch');
  app.pairTemplateSuperset('Seated Calf Raise', 'Hip Thrusts');
  deep(app.templateDisplayOrder().slice(0, 3),
    ['Seated Calf Raise', 'Pully Ab Crunch', 'Hip Thrusts'],
    'a giant set emits in the order it was built, at the earliest slot any member holds');
  eq(app.templateUnits().length, 6, 'three exercises in one unit, five solo');

  app.clearTemplateSuperset('Pully Ab Crunch');
  deep(app.templateDisplayOrder(),
    ['Seated Calf Raise', 'Hip Thrusts', 'RDL', 'Leg Curl', 'Leg Press',
      'Abductor / Adductor', 'Lower AB leg raises', 'Pully Ab Crunch'],
    'dropping the middle member returns it to slot 7 while the other two stay paired');
}

{
  reset();
  app.pairTemplateSuperset('Leg Curl', 'Leg Curl');
  deep(app.activeTemplateGroups(), [], 'an exercise cannot be supersetted with itself');

  app.pairTemplateSuperset('Seated Calf Raise', 'Leg Curl');
  app.pairTemplateSuperset('Leg Press', 'Leg Curl');
  deep(app.activeTemplateGroups(), [['Leg Press', 'Leg Curl']],
    'an exercise belongs to exactly one group — re-pairing moves it rather than splitting it');
  deep(app.templateDisplayOrder().slice(0, 4),
    ['Seated Calf Raise', 'RDL', 'Leg Press', 'Leg Curl'],
    'and the group it left dissolves, so SCR sits back on its own');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('  the picker can now add and pair in one step');
// ═══════════════════════════════════════════════════════════════════════════
// The gap that caused the whole thing: "superset this with something that isn't in the template yet"
// was inexpressible, so the wrong Leg Curl was the nearest available answer.
{
  reset();
  const html = app.templateSupersetPickerHtml('Seated Calf Raise');
  ok(html.includes('addTemplateSupersetPartner('),
    'the picker carries the same add-a-partner dropdown the in-gym one has');
  ok(html.includes('>Single Leg Curl</option>'),
    'and it offers exercises that are NOT in this session — the thing he was trying to do');
  ok(html.includes('__custom__'), 'including typing a brand new one');
  ok(!html.includes('<button type="button" class="ss-pick" onclick="pairTemplateSuperset(\'Seated Calf Raise\',\'Seated Calf Raise\')'),
    'the exercise itself is never in its own partner list');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('  ↑/↓ is the only thing that rewrites the base order');
// ═══════════════════════════════════════════════════════════════════════════
// Moving IS Del saying "this block belongs here", so unlike pairing it has to stick — but it must
// only disturb the two units involved.
{
  reset();
  app.pairTemplateSuperset('Seated Calf Raise', 'Leg Curl');
  app.moveTemplateExercise('Seated Calf Raise', 1);   // move the pair down past RDL

  deep(app.templateDisplayOrder().slice(0, 3), ['RDL', 'Seated Calf Raise', 'Leg Curl'],
    'the whole superset moves as one unit, never half of it');
  deep(app.order().slice(0, 3), ['RDL', 'Seated Calf Raise', 'Leg Curl'],
    'and the move is committed to the base order, so it survives an unpair');

  app.clearTemplateSuperset('Leg Curl');
  deep(app.templateDisplayOrder().slice(0, 3), ['RDL', 'Seated Calf Raise', 'Leg Curl'],
    'unpairing after a deliberate move leaves it where it was put');
}

{
  // The slot-preserving half: another superset elsewhere in the session must not be quietly collapsed
  // into the base order just because two unrelated units swapped.
  reset();
  app.pairTemplateSuperset('RDL', 'Lower AB leg raises');   // display pulls the AB raises up to slot 2
  app.moveTemplateExercise('Leg Press', -1);                // swap two units far away from that pair

  deep(app.order(), ['Seated Calf Raise', 'RDL', 'Leg Press', 'Leg Curl', 'Hip Thrusts',
    'Abductor / Adductor', 'Lower AB leg raises', 'Pully Ab Crunch'],
    'only the two units in the move change base position');
  app.clearTemplateSuperset('Lower AB leg raises');
  deep(app.templateDisplayOrder().slice(-2), ['Lower AB leg raises', 'Pully Ab Crunch'],
    'the untouched pair can still be unpaired back into its original slot');
}

{
  reset();
  app.moveTemplateExercise('Seated Calf Raise', -1);
  deep(app.order(), LOWER_B, 'the first unit cannot move up off the top');
  app.moveTemplateExercise('Pully Ab Crunch', 1);
  deep(app.order(), LOWER_B, 'nor the last one off the bottom');
  app.moveTemplateExercise('Nothing Like This', -1);
  deep(app.order(), LOWER_B, 'an unknown name is a no-op rather than a crash');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('  rows are keyed by name, not by list position');
// ═══════════════════════════════════════════════════════════════════════════
// Display order and base order are two different arrays now. The row controls used to pass an index
// into the base array while the row itself was rendered from the display order — which, the moment a
// pairing shifted anything, would remove or resize a different exercise than the one tapped.
{
  reset();
  app.pairTemplateSuperset('Seated Calf Raise', 'Pully Ab Crunch');   // display: SCR, Pully, RDL, …

  app.changeTemplateExerciseSets('RDL', 1);
  eq(app.setsOf('RDL'), 4, '+ acts on the row it was tapped on');
  eq(app.setsOf('Pully Ab Crunch'), 3, 'and on nothing else');

  app.changeTemplateExerciseSets('RDL', -1);
  app.changeTemplateExerciseSets('RDL', -1);
  app.changeTemplateExerciseSets('RDL', -1);
  app.changeTemplateExerciseSets('RDL', -1);
  eq(app.setsOf('RDL'), 1, 'sets never drop below 1');

  app.removeTemplateExercise('RDL');
  deep(app.order(), ['Seated Calf Raise', 'Leg Curl', 'Leg Press', 'Hip Thrusts',
    'Abductor / Adductor', 'Lower AB leg raises', 'Pully Ab Crunch'],
    '✕ removes the exercise named on the row');

  app.removeTemplateExercise('Pully Ab Crunch');
  deep(app.activeTemplateGroups(), [],
    'removing one half of a pair leaves the group dormant rather than a one-member superset');
  eq(app.templateGroupMap()['Seated Calf Raise'], undefined,
    'so no s/s tag is left hanging on the survivor');
}

{
  reset();
  app.addTemplateExercise('Lying Leg Curl');
  deep(app.order().slice(-1), ['Lying Leg Curl'], 'adding appends to the base order');
  app.addTemplateExercise('Lying Leg Curl');
  eq(app.order().filter(n => n === 'Lying Leg Curl').length, 1, 'and never twice');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('  the three add-an-exercise dropdowns share one builder');
// ═══════════════════════════════════════════════════════════════════════════
{
  reset();
  const opts = app.exerciseAddOptionsHtml(LOWER_B, '+ Something not in this session…');
  ok(opts.startsWith('<option value="" selected disabled>+ Something not in this session…</option>'),
    'the placeholder is the only difference between them');
  ok(!opts.includes('>Leg Press</option>'), 'what is already in the session is excluded');
  ok(opts.includes('>Single Leg Curl</option>') && opts.includes('>Lying Leg Curl</option>'),
    'everything else in the library is offered');
  ok(opts.trimEnd().endsWith('<option value="__custom__">+ Type a new exercise…</option>'),
    'type-a-new-one is always last');
  ok(app.templateAddExerciseOptionsHtml().includes('Add an exercise…'),
    'the editor row keeps its own wording');

  // Names go into both an attribute and the option text, and one of his real exercises is
  // "Leg Press Calf's" — the apostrophe rule exists because these strings end up in onclick handlers.
  app.reset(LOWER_B, { ...LIBRARY, 'Rack Pull & Hold': { name: 'Rack Pull & Hold', sets: 3 } });
  const escaped = app.exerciseAddOptionsHtml(LOWER_B, 'Add an exercise…');
  ok(escaped.includes('<option value="Rack Pull &amp; Hold">Rack Pull &amp; Hold</option>'),
    'names are escaped on the way into the option');
}

// ── The async paths, last: Node CJS has no top-level await. ──
async function asyncCases() {
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('  add-and-pair actually adds and pairs');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    reset();
    const before = app.order().length;
    await app.addTemplateSupersetPartner('Seated Calf Raise', { value: 'Single Leg Curl' });

    eq(app.order().length, before + 1, 'the partner is added to the template');
    deep(app.templateDisplayOrder().slice(0, 4),
      ['Seated Calf Raise', 'Single Leg Curl', 'RDL', 'Leg Curl'],
      'Single Leg Curl pairs with Seated Calf Raise and the seated Leg Curl is left exactly where it was');
    deep(app.order().slice(-1), ['Single Leg Curl'],
      'a newly added exercise joins the END of the base order, so unpairing sends it there rather than stranding it mid-session');
    eq(app.pickerFor(), null, 'and the picker closes behind it');
  }

  {
    reset();
    promptReturns = 'Single Leg Curl';   // the real prompt adds it to the template itself, then returns the name
    await app.addTemplateSupersetPartner('Seated Calf Raise', { value: '__custom__' });
    deep(app.activeTemplateGroups(), [['Seated Calf Raise', 'Single Leg Curl']],
      'a typed-in exercise pairs with what was just typed, not with a name that merely looks similar');
    eq(app.order().filter(n => n === 'Single Leg Curl').length, 1,
      'and the custom path is left to do the adding — addTemplateSupersetPartner must not add it a second time');

    reset();
    promptReturns = undefined;           // cancelled prompt / rejected name
    await app.addTemplateSupersetPartner('Seated Calf Raise', { value: '__custom__' });
    deep(app.activeTemplateGroups(), [], 'a cancelled prompt pairs nothing');
    deep(app.order(), LOWER_B, 'and adds nothing');

    reset();
    await app.addTemplateSupersetPartner('Seated Calf Raise', { value: '' });
    deep(app.order(), LOWER_B, 'the placeholder option is a no-op');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('  what actually gets written to session_exercises');
  // ═══════════════════════════════════════════════════════════════════════════
  // The permanent half of the bug: Save Changes persisted the on-screen order, so one mis-tap in the
  // editor rewrote sort_order for good.
  {
    reset();
    calls.saved = [];
    app.pairTemplateSuperset('Seated Calf Raise', 'Leg Curl');
    await app.saveSessionTemplate();

    const rows = calls.saved[0];
    deep(rows.map(r => r.name), LOWER_B,
      'sort_order is the BASE order — the pairing is stored as a tag, not baked into the sequence');
    deep(rows.map(r => r.sort_order), [0, 1, 2, 3, 4, 5, 6, 7], 'and it is contiguous from 0');
    eq(rows[0].superset_group, '1', 'the pair carries a group tag…');
    eq(rows[2].superset_group, '1', '…on both members');
    eq(rows[1].superset_group, null, 'and nothing else is tagged');
    ok(rows.every(r => r.session_id === 'lower-b'), 'every row belongs to the session being edited');
  }

  {
    // A move IS meant to persist, so this is the one order change Save Changes should write.
    reset();
    calls.saved = [];
    app.moveTemplateExercise('Leg Curl', -1);
    await app.saveSessionTemplate();
    deep(calls.saved[0].map(r => r.name).slice(0, 3), ['Seated Calf Raise', 'Leg Curl', 'RDL'],
      'a deliberate ↑ is written to sort_order');
  }
}

asyncCases().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
});
