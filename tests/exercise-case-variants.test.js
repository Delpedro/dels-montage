// E4 · One lift, one row — case and whitespace (27 August 2026).
//
// `exercises_user_name_key` is UNIQUE (user_id, name) EXACTLY, so "Pull-Ups", "pull-ups" and
// "Pull Ups " were three lifts as far as the database was concerned, each holding its own share of
// the history. The 20 Aug exercise-id pass fixed that for RE-spellings (rename_exercise finds rows
// by id); it left re-CASINGS wide open, and the only reason Del's data has none is luck.
//
// Two halves, and this file is the second one:
//   · the database — migration 20260827180000: exercise_id_for() resolves on lower(btrim(name)),
//     and exercises_user_name_lower_key refuses the second spelling outright. Proven against the
//     live project before it was applied: an UPPERCASE name returned the existing row's id and
//     created nothing.
//   · the app — this file: the "already exists" guard on BOTH add-exercise paths was case
//     SENSITIVE, so typing "pull-ups" under an existing "Pull-Ups" sailed straight past it. The
//     database would now link the two anyway, but the app would still have shown Del two rows for
//     one lift and asked the server to reconcile it.
//
// What is asserted here is the OUTPUT — the name that flows onward and the sentence Del reads —
// not that some function was called. A test that stubs the thing under test is how C12 shipped as
// fixed and was not.
//
// Run: node tests/exercise-case-variants.test.js

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

const PULLUPS = '33333333-3333-4333-8333-333333333333';

async function main() {
  console.log('Exercise case variants');

  // ── The spelling already on file ────────────────────────────────────────────────────────────
  {
    const app = load({
      functions: ['sameExerciseName', 'canonicalExerciseName'],
      decls: ['EXERCISE_LIBRARY', 'EXERCISE_IDS'],
      accessors: {
        setLib: '(l, i) => { EXERCISE_LIBRARY = l; EXERCISE_IDS = i || {}; }',
      },
    });
    app.setLib({ 'Pull-Ups': { name: 'Pull-Ups' } }, {});

    ok(app.sameExerciseName('Pull-Ups', 'pull-ups'), 'case alone is not a different lift');
    ok(app.sameExerciseName('Pull-Ups', '  PULL-UPS '), 'nor is surrounding whitespace');
    ok(!app.sameExerciseName('Pull-Ups', 'Pull Ups'), 'but a hyphen is a real difference — that is a rename, not a casing');
    // Blank is NOT this function's job — both callers return on an empty name long before it, and
    // canonicalExerciseName() guards it separately. Pinned so nobody "fixes" it here instead.
    ok(app.sameExerciseName('', '   '), 'two blanks compare equal; emptiness is filtered upstream, not here');

    eq(app.canonicalExerciseName('pull-ups'), 'Pull-Ups', 'answers in the spelling on file');
    eq(app.canonicalExerciseName('PULL-UPS  '), 'Pull-Ups', 'trimmed and cased alike');
    eq(app.canonicalExerciseName('Face Pull'), null, 'a genuinely new name is new');
    eq(app.canonicalExerciseName('   '), null, 'blank is never canonical');

    // The library is the picker; EXERCISE_IDS is everything the database knows. A name can be in
    // the second without having been folded into the first yet — a lift another device created
    // mid-session — and it must still count as known.
    app.setLib({}, { 'Pull-Ups': PULLUPS });
    eq(app.canonicalExerciseName('pull-ups'), 'Pull-Ups', 'a name known only to the id map still counts');
  }

  // ── Find-or-create adopts it rather than adding a second label ──────────────────────────────
  {
    const calls = [];
    const app = load({
      functions: ['registerNewExercise', 'canonicalExerciseName', 'sameExerciseName'],
      decls: ['EXERCISE_LIBRARY', 'EXERCISE_IDS'],
      deps: {
        sb: async (url, method) => {
          calls.push([url.split('?')[0], method || 'GET']);
          if (url.startsWith('custom_exercises') && !method) return [];
          if (url.startsWith('exercises')) return [{ id: PULLUPS }];
          return { ok: true };
        },
      },
      accessors: {
        setLib: '(l) => { EXERCISE_LIBRARY = l; EXERCISE_IDS = {}; }',
        lib: '() => EXERCISE_LIBRARY',
      },
    });

    app.setLib({ 'Pull-Ups': { name: 'Pull-Ups', sets: 3, reps: '8–12', rest: '90s' } });
    const adopted = await app.registerNewExercise('pull-ups');
    eq(adopted, 'Pull-Ups', 'the caller is handed the spelling on file, not what was typed');
    eq(calls.length, 0, 'and nothing is written — no second row, no second label');
    eq(Object.keys(app.lib()).length, 1, 'the picker still shows one Pull-Ups');

    // A name that really is new must still behave exactly as it did before this change.
    app.setLib({});
    calls.length = 0;
    const made = await app.registerNewExercise('Face Pull');
    eq(made, 'Face Pull', 'a new name comes back unchanged');
    eq(JSON.stringify(calls), JSON.stringify([
      ['custom_exercises', 'GET'], ['custom_exercises', 'POST'], ['exercises', 'GET'],
    ]), 'checks, creates, then reads the new id back — unchanged from 20 Aug');
    eq(app.lib()['Face Pull'].reps, '8–12', 'and it lands in the picker with the default shape');
  }

  // ── The template editor: the guard Del actually meets ───────────────────────────────────────
  {
    const toasts = [];
    const app = load({
      functions: ['promptTemplateCustomExercise', 'addTemplateExercise', 'registerNewExercise',
                  'canonicalExerciseName', 'sameExerciseName'],
      decls: ['EXERCISE_LIBRARY', 'EXERCISE_IDS', 'editingTemplateExercises'],
      deps: {
        askPrompt: async () => 'pull-ups',
        showToast: (msg, kind) => toasts.push([msg, kind]),
        renderTemplateEditorRows: () => {},
        sb: async () => { throw new Error('registerNewExercise must not reach the network for a known lift'); },
      },
      accessors: {
        setLib: '(l) => { EXERCISE_LIBRARY = l; EXERCISE_IDS = {}; }',
        rows: '() => editingTemplateExercises',
      },
    });
    app.setLib({ 'Pull-Ups': { name: 'Pull-Ups', sets: 3, reps: '8–12', rest: '90s' } });

    await app.promptTemplateCustomExercise();
    eq(app.rows().length, 0, 'a case variant of a known lift is not added a second time');
    eq(toasts.length, 1, 'Del is told why');
    eq(toasts[0][0], 'Pull-Ups already exists — pick it from the dropdown',
      'and told it in the spelling that IS in the dropdown — "pull-ups already exists" next to a list showing "Pull-Ups" is the confusing version');
    eq(toasts[0][1], 'error', 'as an error toast');
  }

  // ── The same guard against what is already on the screen, not just the library ───────────────
  {
    const toasts = [];
    const app = load({
      functions: ['promptTemplateCustomExercise', 'addTemplateExercise', 'registerNewExercise',
                  'canonicalExerciseName', 'sameExerciseName'],
      decls: ['EXERCISE_LIBRARY', 'EXERCISE_IDS', 'editingTemplateExercises'],
      deps: {
        askPrompt: async () => '  FACE pull ',
        showToast: (msg, kind) => toasts.push([msg, kind]),
        renderTemplateEditorRows: () => {},
        sb: async () => { throw new Error('must not reach the network'); },
      },
      accessors: {
        seed: '(r) => { EXERCISE_LIBRARY = {}; EXERCISE_IDS = {}; editingTemplateExercises = r; }',
        rows: '() => editingTemplateExercises',
      },
    });
    // Typed into this session's template a minute ago, so it is on screen but not in the library.
    app.seed([{ name: 'Face Pull', sets: 3, reps: '8–12', rest: '90s' }]);

    await app.promptTemplateCustomExercise();
    eq(app.rows().length, 1, 'a variant of a row already in this template is refused too');
    eq(toasts[0][0], 'Face Pull already exists — pick it from the dropdown', 'named as it sits on screen');
  }

  // ── Open Workout's twin, which is the path Del uses mid-session ──────────────────────────────
  {
    const toasts = [];
    const added = [];
    const app = load({
      functions: ['promptCustomExercise', 'registerNewExercise', 'canonicalExerciseName', 'sameExerciseName'],
      decls: ['EXERCISE_LIBRARY', 'EXERCISE_IDS', 'selectedSession'],
      deps: {
        askPrompt: async () => 'PULL-UPS',
        showToast: (msg, kind) => toasts.push([msg, kind]),
        renderOpenAddExerciseOptions: () => {},
        addOpenExercise: async n => { added.push(n); },
        sb: async () => { throw new Error('must not reach the network for a known lift'); },
      },
      accessors: {
        setup: '(l, s) => { EXERCISE_LIBRARY = l; EXERCISE_IDS = {}; selectedSession = s; }',
      },
    });
    app.setup({ 'Pull-Ups': { name: 'Pull-Ups' } }, { exercises: [] });

    await app.promptCustomExercise();
    eq(added.length, 0, 'the variant never reaches the logger');
    eq(toasts[0][0], 'Pull-Ups already exists — pick it from the dropdown', 'same sentence, same spelling, both paths');
  }

  // ── And a genuinely new lift still gets in, under the name typed ─────────────────────────────
  {
    const added = [];
    const app = load({
      functions: ['promptCustomExercise', 'registerNewExercise', 'canonicalExerciseName', 'sameExerciseName'],
      decls: ['EXERCISE_LIBRARY', 'EXERCISE_IDS', 'selectedSession'],
      deps: {
        askPrompt: async () => 'Face Pull',
        showToast: () => {},
        renderOpenAddExerciseOptions: () => {},
        addOpenExercise: async n => { added.push(n); },
        sb: async (url, method) => {
          if (url.startsWith('custom_exercises') && !method) return [];
          if (url.startsWith('exercises')) return [{ id: PULLUPS }];
          return { ok: true };
        },
      },
      accessors: { setup: '(l, s) => { EXERCISE_LIBRARY = l; EXERCISE_IDS = {}; selectedSession = s; }' },
    });
    app.setup({ 'Pull-Ups': { name: 'Pull-Ups' } }, { exercises: [] });

    const out = await app.promptCustomExercise();
    eq(JSON.stringify(added), JSON.stringify(['Face Pull']), 'a new lift is added under the name typed');
    eq(out, 'Face Pull', 'and handed back, so the superset picker can pair with it');
  }

  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
