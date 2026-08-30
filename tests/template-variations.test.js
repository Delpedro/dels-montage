// E18 — a user types their OWN variations. Del's idea, 28 Aug 2026, built 30 Aug.
//
// "If a user was creating this exercise from scratch, it would be cool to allow them add these
// options (to suit their gym) and not ME, DEL, DEVELOPER gym only !!"
//
// The data in here is his, because it is the argument for the whole item: Seated Calf Raise carries
// ["Old Mach", "New Mach"] — two specific machines in one gym in Ireland. No tick-list of equipment
// produces that, so this is a free list of strings the user types.
//
// The half worth testing hardest is the RENAME. A variation is part of how history is keyed, so
// renaming one without carrying the past sets with it empties the Last time card for everything
// logged under the old string — and his gym replacing a machine is the exact scenario he described.
//
// Run: node tests/template-variations.test.js

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
  ok(actual === expected, `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function deep(actual, expected, label) {
  ok(JSON.stringify(actual) === JSON.stringify(expected),
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function has(hay, needle, label) {
  ok(String(hay).includes(needle), `${label} — ${JSON.stringify(needle)} not found`);
}
function hasNot(hay, needle, label) {
  ok(!String(hay).includes(needle), `${label} — ${JSON.stringify(needle)} should NOT be there`);
}

console.log('template editor — user-typed variations (E18)');

const calls = { renders: 0, toasts: [], writes: [], prompts: [], confirms: [] };
let promptReturns = null;      // what askPrompt resolves to
let confirmReturns = true;     // what askConfirm resolves to
let setCount = 0;              // rows workout_sets answers with
let writeOk = true;            // whether sb() reports success on a write

const app = load({
  functions: [
    'esc', 'jsAttr', 'templateExerciseByName',
    'templateVariationsOf', 'toggleTemplateVariationPicker', 'markTemplateVariationsTouched',
    'setTemplateVariations', 'templateVariationPickerHtml', 'addTemplateVariation',
    'renameTemplateVariation', 'countSetsForVariation', 'removeTemplateVariation',
    'applyTemplateVariationChanges',
  ],
  decls: [
    'editingTemplateExercises', 'editingTemplateVarFor', 'editingTemplateVarRenames',
    'editingTemplateVarTouched', 'editingTemplateSessionId', 'editingTemplatePickerFor',
    'EXERCISE_IDS', 'EXERCISE_VARIATIONS',
  ],
  deps: {
    renderTemplateEditorRows: () => { calls.renders++; },
    showToast: (msg, kind) => { calls.toasts.push([msg, kind]); },
    askPrompt: async (opts) => { calls.prompts.push(opts); return promptReturns; },
    askConfirm: async (opts) => { calls.confirms.push(opts); return confirmReturns; },
    // The one read is the profile count; everything else is a write and gets recorded whole.
    sb: async (p, method = 'GET', body = null) => {
      if (method === 'GET') return Array.from({ length: setCount }, (_, i) => ({ id: i + 1 }));
      calls.writes.push({ path: p, method, body });
      return { ok: writeOk, status: writeOk ? 204 : 403 };
    },
  },
  accessors: {
    varsOf: '(n) => (editingTemplateExercises.find(e => e.name === n) || {}).variations',
    hasVarKey: `(n) => Object.prototype.hasOwnProperty.call(
      editingTemplateExercises.find(e => e.name === n) || {}, 'variations')`,
    renames: '() => editingTemplateVarRenames.map(r => ({ ...r }))',
    touched: '() => [...editingTemplateVarTouched]',
    varFor: '() => editingTemplateVarFor',
    libVars: '() => JSON.parse(JSON.stringify(EXERCISE_VARIATIONS))',
    reset: `(exercises) => {
      editingTemplateExercises = exercises.map(e => ({ sets: 3, reps: '8–12', rest: '90s', ...e }));
      editingTemplateVarFor = null;
      editingTemplateVarRenames = [];
      editingTemplateVarTouched = [];
      editingTemplateSessionId = 'lower-a';
      editingTemplatePickerFor = null;
      EXERCISE_IDS = { 'Seated Calf Raise': 'ex-scr', 'RDL': 'ex-rdl' };
      EXERCISE_VARIATIONS = { 'Seated Calf Raise': ['Old Mach', 'New Mach'] };
    }`,
  },
});

// His real Lower A pair: the lift with two machines, and one with nothing on it yet.
const fresh = () => {
  app.reset([
    { name: 'Seated Calf Raise', variations: ['Old Mach', 'New Mach'] },
    { name: 'RDL' },
  ]);
  calls.renders = 0; calls.toasts = []; calls.writes = []; calls.prompts = []; calls.confirms = [];
  promptReturns = null; confirmReturns = true; setCount = 0; writeOk = true;
};

// ── 1. The panel ────────────────────────────────────────────────────────────────────────
fresh();
{
  const html = app.templateVariationPickerHtml('Seated Calf Raise');
  has(html, 'Old Mach', '1. panel lists the first variation');
  has(html, 'New Mach', '1. panel lists the second variation');
  has(html, `renameTemplateVariation('Seated Calf Raise','Old Mach')`, '1. each one can be renamed');
  has(html, `removeTemplateVariation('Seated Calf Raise','New Mach')`, '1. each one can be removed');
  has(html, `addTemplateVariation('Seated Calf Raise')`, '1. panel offers a new one');
  // Reusing the superset picker's classes is the point — pills "look cheap" and this is the control
  // the screen already has one of.
  has(html, 'ss-picker', '1. panel reuses the existing picker shell, not a new one');
  has(html, 'ss-pick', '1. rows reuse the existing pick button');

  const empty = app.templateVariationPickerHtml('RDL');
  has(empty, 'ss-picker-empty', '1. a lift with none gets the empty state');
  has(empty, `addTemplateVariation('RDL')`, '1. and can still add one');
  hasNot(empty, 'removeTemplateVariation', '1. nothing to remove on an empty list');

  app.toggleTemplateVariationPicker('RDL');
  eq(app.varFor(), 'RDL', '1. toggle opens the panel');
  app.toggleTemplateVariationPicker('RDL');
  eq(app.varFor(), null, '1. and closes it again');
}

// ── 2. Adding ───────────────────────────────────────────────────────────────────────────
(async () => {
  fresh();
  promptReturns = '  Plate 1  ';
  await app.addTemplateVariation('RDL');
  deep(app.varsOf('RDL'), ['Plate 1'], '2. a typed variation is trimmed and added');
  deep(app.touched(), ['RDL'], '2. the lift is marked for propagation');

  // The list is free text on purpose — an equipment enum cannot produce "Old Mach".
  promptReturns = 'Old Mach';
  await app.addTemplateVariation('RDL');
  deep(app.varsOf('RDL'), ['Plate 1', 'Old Mach'], '2. a second one appends');

  promptReturns = 'old mach';
  calls.toasts = [];
  await app.addTemplateVariation('RDL');
  deep(app.varsOf('RDL'), ['Plate 1', 'Old Mach'], '2. a case-variant duplicate is refused');
  eq(calls.toasts[0][1], 'error', '2. and says so');

  // Names flow into inline onclick handlers throughout this app.
  promptReturns = "Del's mach";
  calls.toasts = [];
  await app.addTemplateVariation('RDL');
  deep(app.varsOf('RDL'), ['Plate 1', 'Old Mach'], '2. an apostrophe is refused');
  eq(calls.toasts[0][1], 'error', '2. and says so');

  promptReturns = null;
  await app.addTemplateVariation('RDL');
  deep(app.varsOf('RDL'), ['Plate 1', 'Old Mach'], '2. cancelling adds nothing');

  // ── 3. Renaming — the half that touches history ──────────────────────────────────────
  fresh();
  setCount = 0;
  promptReturns = 'Machine A';
  await app.renameTemplateVariation('Seated Calf Raise', 'Old Mach');
  eq(calls.confirms.length, 0, '3. nothing logged under it → no question asked');
  deep(app.varsOf('Seated Calf Raise'), ['Machine A', 'New Mach'], '3. the list is renamed in place');
  deep(app.renames(), [{ name: 'Seated Calf Raise', from: 'Old Mach', to: 'Machine A' }],
    '3. the rename is QUEUED, not written — Save Changes is what writes');
  eq(calls.writes.length, 0, '3. and nothing was written yet');

  fresh();
  setCount = 34;
  promptReturns = 'Machine A';
  await app.renameTemplateVariation('Seated Calf Raise', 'Old Mach');
  eq(calls.confirms.length, 1, '3. logged sets → it profiles and asks first');
  has(calls.confirms[0].body, '34', '3. the count is said out loud before anything is agreed to');
  has(calls.confirms[0].body, 'Old Mach', '3. and names the label being moved off');
  deep(app.varsOf('Seated Calf Raise'), ['Machine A', 'New Mach'], '3. accepted → renamed');

  fresh();
  setCount = 34;
  confirmReturns = false;
  promptReturns = 'Machine A';
  await app.renameTemplateVariation('Seated Calf Raise', 'Old Mach');
  deep(app.varsOf('Seated Calf Raise'), ['Old Mach', 'New Mach'], '3. declined → the list is untouched');
  deep(app.renames(), [], '3. declined → nothing queued');

  fresh();
  promptReturns = 'new mach';
  calls.toasts = [];
  await app.renameTemplateVariation('Seated Calf Raise', 'Old Mach');
  deep(app.varsOf('Seated Calf Raise'), ['Old Mach', 'New Mach'], '3. renaming onto its sibling is refused');
  eq(calls.toasts[0][1], 'error', '3. and says so');

  fresh();
  promptReturns = 'Old Mach';
  await app.renameTemplateVariation('Seated Calf Raise', 'Old Mach');
  deep(app.renames(), [], '3. renaming to the same name does nothing');

  // Two hops in one sitting keep both, so the sets follow the whole path at save.
  fresh();
  promptReturns = 'Mach 1';
  await app.renameTemplateVariation('Seated Calf Raise', 'Old Mach');
  promptReturns = 'Machine A';
  await app.renameTemplateVariation('Seated Calf Raise', 'Mach 1');
  deep(app.renames().map(r => `${r.from}→${r.to}`), ['Old Mach→Mach 1', 'Mach 1→Machine A'],
    '3. chained renames keep every hop, in order');

  // ── 4. Removing ──────────────────────────────────────────────────────────────────────
  fresh();
  setCount = 12;
  await app.removeTemplateVariation('Seated Calf Raise', 'New Mach');
  has(calls.confirms[0].body, '12', '4. says how many sets carry it');
  has(calls.confirms[0].body, 'stay', '4. and that the history is NOT deleted');
  deep(app.varsOf('Seated Calf Raise'), ['Old Mach'], '4. removed from the offered list');

  fresh();
  confirmReturns = false;
  await app.removeTemplateVariation('Seated Calf Raise', 'New Mach');
  deep(app.varsOf('Seated Calf Raise'), ['Old Mach', 'New Mach'], '4. declined → nothing removed');

  // ── 5. An empty list is absent, never [] ─────────────────────────────────────────────
  // The logger draws the toggle on `ex.variations` being truthy, so [] would render an empty control.
  fresh();
  app.setTemplateVariations('Seated Calf Raise', []);
  eq(app.hasVarKey('Seated Calf Raise'), false, '5. emptying the list removes the key entirely');

  // ── 6. What Save actually writes ─────────────────────────────────────────────────────
  fresh();
  setCount = 34;
  promptReturns = 'Machine A';
  await app.renameTemplateVariation('Seated Calf Raise', 'Old Mach');
  calls.writes = [];
  const okRes = await app.applyTemplateVariationChanges();
  eq(okRes, true, '6. a clean run reports success');

  const w = calls.writes;
  eq(w[0].method, 'PATCH', '6. the history rename goes first');
  has(w[0].path, 'workout_sets?exercise_id=eq.ex-scr', '6. sets are found by exercise_id, never by the name text');
  has(w[0].path, 'variation=eq.Old%20Mach', '6. scoped to the old label only');
  deep(w[0].body, { variation: 'Machine A' }, '6. and re-labelled to the new one');

  const exWrite = w.find(x => x.path.startsWith('exercises?'));
  ok(!!exWrite, '6. the lift itself gets the new list');
  has(exWrite.path, 'exercises?id=eq.ex-scr', '6. by id');
  deep(exWrite.body, { variations: ['Machine A', 'New Mach'] }, '6. with both labels');

  const otherSessions = w.find(x => x.path.startsWith('session_exercises?'));
  ok(!!otherSessions, '6. every OTHER session carrying the lift is updated too');
  has(otherSessions.path, 'name=eq.Seated%20Calf%20Raise', '6. by lift name');
  has(otherSessions.path, 'session_id=neq.lower-a', '6. excluding the one just written');
  deep(app.libVars()['Seated Calf Raise'], ['Machine A', 'New Mach'],
    '6. and the in-memory list moves without waiting for a restart');

  // Nothing may reach the shared catalogue: its only policy is SELECT, and one gym's labels must
  // never become everybody's defaults. That is the whole point of the item.
  ok(!w.some(x => x.path.includes('exercise_catalogue')), '6. the shared catalogue is never written');

  deep(app.renames(), [], '6. the queue is cleared once applied');
  deep(app.touched(), [], '6. and so is the propagation set');

  // Emptying a list writes null, not [] — same reason as section 5, one layer down.
  fresh();
  app.setTemplateVariations('Seated Calf Raise', []);
  calls.writes = [];
  await app.applyTemplateVariationChanges();
  const nulled = calls.writes.find(x => x.path.startsWith('exercises?'));
  deep(nulled.body, { variations: null }, '6. an emptied list is stored as null');
  eq(app.libVars()['Seated Calf Raise'], undefined, '6. and drops out of the in-memory map');

  // ── 7. A half-applied rename is the one outcome worth being loud about ───────────────
  fresh();
  setCount = 5;
  promptReturns = 'Machine A';
  await app.renameTemplateVariation('Seated Calf Raise', 'Old Mach');
  calls.writes = []; calls.toasts = [];
  writeOk = false;
  const failed = await app.applyTemplateVariationChanges();
  eq(failed, false, '7. a failed history rename stops the save');
  eq(calls.toasts[0][1], 'error', '7. and tells you');
  has(calls.toasts[0][0], 'Old Mach', '7. naming which label did not move');
  ok(!calls.writes.some(x => x.path.startsWith('exercises?')),
    '7. the list is NOT written when its history could not follow it');

  // ── 8. Source rules ─────────────────────────────────────────────────────────────────
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  const rule = css.split('\n').find(l => l.includes('.ss-btn.var-btn-row.active'));
  ok(!!rule, '8. the variations button has its own filled state');
  // --blue has meant superset app-wide since 11 Aug. Two blue dashed buttons on one row would say
  // the same thing twice about two unrelated controls.
  ok(rule && !rule.includes('--blue'), '8. and it is NOT blue — blue is the superset button above it');

  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
