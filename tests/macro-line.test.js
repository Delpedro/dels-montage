// One-line macro entry (18 Aug 2026) — Del's pet hate, in his words: "i need to type all the macros
// from myfitnesspal into my d-log app".
//
// The iOS Shortcut that pushes steps across from Health was offered as the model for this and
// rejected outright — "im not using that steps shit...i didnt like that idea" — so the fix is a box
// in the app with nothing to set up. That makes the parser the whole feature, and the parser is the
// only part that can be wrong quietly.
//
// What is asserted here is mostly what it must REFUSE. A parser that fills five boxes from a
// paste it half-understood is worse than one that fills none: the numbers look deliberate, they
// save without complaint, and the weekly averages then treat them as real.
//
// Run: node tests/macro-line.test.js

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

const app = load({ functions: ['parseMacroLine', 'macroLineEcho'], decls: [], deps: {} });
const p = app.parseMacroLine;

console.log('One-line macro entry');

// ── Positional: the fast path, and the one the placeholder teaches ────────────────────────────
{
  const r = p('2010 175 200 56 30');
  eq(r.calories, 2010, 'five bare numbers: calories first');
  eq(r.protein_g, 175, 'then protein');
  eq(r.carbs_g, 200, 'then carbs');
  eq(r.fat_g, 56, 'then fat');
  eq(r.fibre_g, 30, 'then fibre');

  // The form's own field order, so the shorthand is readable off the screen it fills.
  const four = p('2010 175 200 56');
  eq(four.fat_g, 56, 'four numbers still ends on fat');
  eq(four.fibre_g, null, 'and leaves fibre unset rather than shifting everything along');

  eq(p('2,010 175 200 56 30').calories, 2010, 'a thousands comma is part of the number, not a separator');
  eq(p('2010  175   200  56  30').carbs_g, 200, 'extra whitespace is harmless');
  eq(p('80.5 175 200 56 30').calories, 80.5, 'decimals survive');
}

// ── Labelled: a paste, or half-remembered typing ──────────────────────────────────────────────
{
  const r = p('Calories 2,010  Protein 175g  Carbs 200g  Fat 56g  Fibre 30g');
  eq(r.calories, 2010, 'labelled calories');
  eq(r.protein_g, 175, 'labelled protein');
  eq(r.carbs_g, 200, 'labelled carbs');
  eq(r.fat_g, 56, 'labelled fat');
  eq(r.fibre_g, 30, 'labelled fibre');

  // Order is not fixed once the words are there.
  const shuffled = p('protein 175, fat 56, calories 2010, fibre 30, carbs 200');
  eq(shuffled.calories, 2010, 'labels can arrive in any order');
  eq(shuffled.fat_g, 56, 'and still land in the right field');

  eq(p('PROTEIN 175 CARBS 200 FAT 56 CALORIES 2010').protein_g, 175, 'case is ignored');
  eq(p('175g protein 200g carbs 56g fat').protein_g, 175, 'the number may come before the word');
  eq(p('Energy: 2010kcal  Protein: 175 g').calories, 2010, 'colons, kcal and "Energy" all read');
  eq(p('Carbohydrates 200').carbs_g, 200, 'the long spelling of carbs');
  eq(p('cals 2010 protein 175 carbs 200 fat 56 fibre 30').calories, 2010,
     '"cals" is a calorie label too — it is what gets typed in a hurry');
  eq(p('cal 2010 protein 175').calories, 2010, 'and so is "cal"');
  eq(p('calcium 200 protein 175').calories, null,
     'but "calcium" is not — a label only counts with its number directly after it');
  eq(p('Dietary Fiber 30').fibre_g, 30, 'American spelling, and the "dietary" prefix');

  // Words it does not know must be ignored, not counted. This is what stops a full MyFitnessPal
  // breakdown — which carries sodium, sugar and cholesterol — from sliding everything sideways.
  const noisy = p('Calories 2010 Sodium 2300mg Sugar 45g Protein 175g Cholesterol 120mg Carbs 200g Fat 56g');
  eq(noisy.protein_g, 175, 'sodium and sugar do not displace protein');
  eq(noisy.carbs_g, 200, 'nor carbs');
  eq(noisy.fat_g, 56, 'nor fat');
}

// ── Saturated fat, which sits right next to the total in any real breakdown ───────────────────
{
  eq(p('Fat 56g Saturated Fat 12g').fat_g, 56, 'the total wins when it comes first');
  eq(p('Saturated Fat 12g Fat 56g').fat_g, 56,
     'and when it comes SECOND — the qualified ones are stripped before anything is read');
  eq(p('Total Fat 56g Saturated Fat 12g Trans Fat 0g').fat_g, 56, '"Total Fat" is read as the total');
  eq(p('Saturated Fat 12g Polyunsaturated Fat 8g Monounsaturated Fat 20g Total Fat 56g').fat_g, 56,
     'a full fat breakdown still yields the total');
  // Saturated fat on its own leaves nothing behind once it is stripped, so the whole line comes
  // back unrecognised — which is the better answer than an object full of nulls: the box says
  // "Not recognised" instead of silently filling nothing and looking like it worked.
  eq(p('Saturated Fat 12g'), null,
     'saturated fat ALONE is not recognised at all, rather than passing 12g off as the day');
}

// ── What it refuses, which is the point ───────────────────────────────────────────────────────
{
  eq(p(''), null, 'empty is nothing');
  eq(p('   '), null, 'whitespace is nothing');
  eq(p(null), null, 'null is nothing');
  eq(p('had a big lunch'), null, 'prose with no numbers fills nothing');

  // Too few bare numbers is ambiguous — "2010 175" could be calories and protein, or weight and
  // steps. Guessing puts two real-looking numbers into the wrong boxes.
  eq(p('2010'), null, 'one bare number is not a day');
  eq(p('2010 175'), null, 'two bare numbers are not a day');
  eq(p('2010 175 200'), null, 'three bare numbers are not a day');

  // Too many means a paste that was not understood. Filling the first five would be worse than
  // filling none, because it would look deliberate.
  eq(p('2010 175 200 56 30 12 9'), null, 'seven bare numbers fills nothing rather than taking the first five');

  // But a paste WITH labels is read even when it carries far more numbers than five.
  eq(p('2010 kcal, 175g protein, 200g carbs, 56g fat, 30g fibre, 2300mg sodium, 45g sugar').protein_g, 175,
     'once the words are there the extra numbers stop mattering');
}

// ── Partial labelled input fills only what it found ───────────────────────────────────────────
{
  // Typing just the protein is a legitimate thing to do. The other fields must come back null so
  // the caller leaves those boxes exactly as they were.
  const r = p('protein 175');
  eq(r.protein_g, 175, 'a single labelled value is read');
  eq(r.calories, null, 'and everything else is null…');
  eq(r.carbs_g, null, '…so the caller knows not to touch those boxes');
}

// ── The echo line under the box ───────────────────────────────────────────────────────────────
{
  eq(app.macroLineEcho(p('2010 175 200 56 30')), '2,010 kcal · 175p · 200c · 56f · 30 fibre',
     'the echo names which number went where');
  eq(app.macroLineEcho(p('protein 175')), '175p', 'a partial parse echoes only what it filled');
  eq(app.macroLineEcho(null), '', 'nothing parsed echoes nothing');
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
