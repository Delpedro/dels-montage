// The onboarding form — layout C, one question per screen (22 August 2026).
//
// Step 2 of the second-user work, and the first screen a person who is not Del will ever see. What
// is tested here is deliberately NOT the eight screens of markup, which change whenever the copy
// does. It is the three things that are load-bearing and silent when they break:
//
//   1. VALIDATION. Every answer except the name is skippable, and a skipped answer must arrive as
//      null rather than as "" or 0 — the exact mistake `parseInt(x) || null` made with steps, where
//      a real 0 became "never recorded". The number rules also have to match the numeric(5,1)
//      column checks, because a value Postgres rejects surfaces as a failed save at the very end of
//      an eight-screen form.
//   2. THE GATE. sb() returns [] for a GET that failed AND for a table with no matching row, so
//      "no profile" and "no signal" look identical from the client. Without the cache in
//      needsOnboarding() a gym trip with no signal opens the onboarding form over a four-month-old
//      account and asks Del his name again.
//   3. THE PAYLOAD. Every column the form owns is present on every write. A key omitted is a column
//      left alone, so on an edit, clearing an answer would quietly keep the old value.
//
// Run: node tests/onboarding.test.js

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

// A localStorage that behaves, and one that throws on every call — Safari in private mode, and the
// reason every access in the source is wrapped. A throw here used to mean a white screen.
function memStore(seed = {}) {
  const map = { ...seed };
  return {
    getItem: k => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: k => { delete map[k]; },
    _map: map
  };
}
const hostileStore = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
  removeItem() { throw new Error('denied'); }
};

function app({ store = memStore(), email = 'del@example.com', now = new Date(2026, 7, 22) } = {}) {
  class Fixed extends Date {
    constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
  }
  return load({
    decls: ['PROFILE', 'OB_DRAFT_PREFIX', 'ONBOARD_STEPS', 'OB_WHEEL', 'OB_ITEM'],
    functions: ['obValidate', 'obAgeOn', 'obPayload', 'needsOnboarding', 'markOnboarded',
                'onboardedKey', 'obDraftKey', 'obCmToFtIn', 'obKgToStLb', 'obConversion'],
    // authSession is passed rather than lifted: its declaration carries a trailing comment, which
    // extract.js cannot slice (see the note in TDLR.md).
    deps: { Date: Fixed, localStorage: store, authSession: email ? { email } : null },
    accessors: {
      steps: '() => ONBOARD_STEPS',
      wheels: '() => OB_WHEEL',
      item: '() => OB_ITEM',
      setProfile: 'p => { PROFILE = p; }'
    }
  });
}

const stepFor = (a, key) => a.steps().find(s => s.key === key);

console.log('Onboarding — the form that fills the profile in');

// ── 1. the shape of the form ──────────────────────────────────────────────────────────────────
{
  const a = app();
  eq(a.steps().length, 8, 'eight screens — layout C, the letter Del picked');
  eq(a.steps()[0].key, 'display_name', 'the name is asked first');
  eq(a.steps()[a.steps().length - 1].key, 'training_days_per_week', 'days per week is last');

  const required = a.steps().filter(s => s.required).map(s => s.key);
  eq(required.join(','), 'display_name',
    'the name is the ONLY required answer — display_name is the only NOT NULL column');

  ok(!a.steps().some(s => s.key === 'units'),
    'units is NOT asked: the column exists but nothing in the app reads it, and the app is metric');

  // Every step must be able to render itself, and every key must be a real profiles column.
  const cols = ['display_name', 'sex', 'dob', 'height_cm', 'start_weight_kg', 'target_weight_kg',
                'experience', 'training_days_per_week'];
  ok(a.steps().every(s => cols.includes(s.key)), 'every step writes a column that exists');
  eq(new Set(a.steps().map(s => s.key)).size, 8, 'no column is asked about twice');
  ok(a.steps().every(s => ['text', 'chips', 'number', 'dob'].includes(s.type)),
    'every step is a type obFieldHtml() knows how to draw');
  ok(a.steps().every(s => typeof s.q === 'string' && s.q.length > 0), 'every screen has a question');
  ok(a.steps().filter(s => s.type === 'number').every(s => s.unit && s.min < s.max),
    'every number step names its unit and its range');
}

// ── 1b. the wheels (23 Aug) ───────────────────────────────────────────────────────────────────
// Del rejected the form because the keypad opened and closed on seven of the eight screens. Every
// number and the date are picked off a wheel now. Two things can break silently here: a number
// screen with no wheel to draw, and a wheel that can reach a value obValidate() then rejects.
{
  const a = app();
  const nums = a.steps().filter(s => s.type === 'number');
  ok(nums.length > 0 && nums.every(s => a.wheels()[s.key]),
    'every number screen has a wheel — without one the screen renders an empty box');

  Object.keys(a.wheels()).forEach(key => {
    const step = stepFor(a, key);
    const w = a.wheels()[key];
    ok(!!step, `${key} has a wheel and a step`);
    ok(w.lo < w.hi, `${key}: the wheel counts upwards`);
    // The wheel is the narrower of the two ranges on purpose: 20–400 kg is 3,800 stops and a thumb
    // cannot cross it. What it must never do is offer a value the CHECK constraint refuses.
    ok(w.lo >= step.min && w.hi <= step.max,
      `${key}: the wheel cannot reach a value obValidate() would reject`);
    ok(w.start >= w.lo && w.start <= w.hi, `${key}: the wheel opens on a value it can show`);
    eq(typeof w.dec, 'boolean', `${key}: says whether it carries a tenths column`);
  });

  ok(a.steps().some(s => s.type === 'dob'), 'the date is still its own type, drawn as three wheels');
  eq(a.steps().filter(s => s.type === 'text').length, 1,
    'exactly ONE screen still opens a keyboard — the name');

  // The scroll position IS the answer: app.js reads it back as scrollTop / OB_ITEM. If the
  // stylesheet's row height ever stops agreeing with OB_ITEM, every wheel reads back the wrong
  // number and nothing throws.
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'css', 'style.css'), 'utf8');
  const row = /\.ob-wheel i \{[^}]*?height:\s*(\d+)px/.exec(css);
  ok(!!row, 'the stylesheet still sets a row height on .ob-wheel i');
  eq(parseInt(row[1], 10), a.item(), 'the CSS row height matches OB_ITEM');
  const band = /\.ob-band \{[^}]*?top:\s*(\d+)px;\s*height:\s*(\d+)px/.exec(css);
  ok(!!band, 'the selected-row band is still positioned');
  eq(parseInt(band[2], 10), a.item(), 'the band is exactly one row tall');
  eq(parseInt(band[1], 10), (176 - a.item()) / 2, 'the band sits over the centre row');
}

// ── 2. the name ───────────────────────────────────────────────────────────────────────────────
{
  const a = app();
  const s = stepFor(a, 'display_name');
  eq(a.obValidate(s, 'Sarah').value, 'Sarah', 'a name is taken as typed');
  eq(a.obValidate(s, '  Sarah  ').value, 'Sarah', 'and trimmed');
  ok(a.obValidate(s, '').error, 'an empty name is refused — it is the one thing the row cannot lack');
  ok(a.obValidate(s, '   ').error, 'whitespace is not a name either');
  eq(a.obValidate(s, 'x'.repeat(200)).value.length, 60, 'a pasted essay is capped, not rejected');
}

// ── 3. numbers — skippable, and inside the column checks ──────────────────────────────────────
{
  const a = app();
  const w = stepFor(a, 'start_weight_kg');
  const h = stepFor(a, 'height_cm');

  eq(a.obValidate(w, '').value, null, 'a blank weight is null, not 0 and not ""');
  eq(a.obValidate(w, '   ').value, null, 'spaces are blank');
  eq(a.obValidate(w, '68.4').value, 68.4, 'one decimal place survives');
  eq(a.obValidate(w, '68,4').value, 68.4, 'a comma decimal is read as a decimal, not truncated to 68');
  eq(a.obValidate(w, '68.44').value, 68.4, 'rounded to the numeric(5,1) the column actually stores');
  eq(a.obValidate(h, '172.7').value, 172.7, 'height keeps its decimal too');

  ok(a.obValidate(w, 'heavy').error, 'words are refused');
  ok(a.obValidate(w, '-70').error, 'a negative weight is refused');
  ok(a.obValidate(w, '7 0').error, 'a stray space inside the number is refused');
  // These are the CHECK constraints in 20260821220000_profiles.sql. A value that passes here and
  // fails there is a 400 at the end of an eight-screen form.
  ok(a.obValidate(w, '19').error, 'below the 20kg column check');
  ok(a.obValidate(w, '401').error, 'above the 400kg column check');
  eq(a.obValidate(w, '20').value, 20, 'the bottom of the range is allowed');
  eq(a.obValidate(w, '400').value, 400, 'and the top');
  ok(a.obValidate(h, '99').error, 'below the 100cm column check');
  ok(a.obValidate(h, '251').error, 'above the 250cm column check');
  ok(/20 and 400 kg/.test(a.obValidate(w, '5').error), 'the error names the range and the unit');
}

// ── 4. date of birth ──────────────────────────────────────────────────────────────────────────
{
  // "Today" is 22 Aug 2026 throughout.
  const a = app();
  const s = stepFor(a, 'dob');

  eq(a.obValidate(s, { d: '', m: '', y: '' }).value, null, 'all three blank is a skip, not an error');
  eq(a.obValidate(s, undefined).value, null, 'and so is nothing at all');
  eq(a.obValidate(s, { d: '9', m: '3', y: '1978' }).value, '1978-03-09',
    'a single-digit day and month are padded into a real date string');
  eq(a.obValidate(s, { d: '09', m: '03', y: '1978' }).value, '1978-03-09', 'zero-padded input too');

  ok(a.obValidate(s, { d: '9', m: '3', y: '' }).error, 'two thirds of a date is an error, not a guess');
  ok(a.obValidate(s, { d: '31', m: '2', y: '1978' }).error,
    '31 February does not exist — and must not roll forward into 3 March');
  ok(a.obValidate(s, { d: '9', m: '13', y: '1978' }).error, 'there is no month 13');
  ok(a.obValidate(s, { d: '9', m: '3', y: '78' }).error, 'a two-digit year is refused, not assumed');
  ok(a.obValidate(s, { d: '9', m: '3', y: '2025' }).error, 'a one-year-old does not lift');
  ok(a.obValidate(s, { d: '9', m: '3', y: '1850' }).error, 'nor does a 176-year-old');
  ok(/works out at 1\b/.test(a.obValidate(s, { d: '9', m: '3', y: '2025' }).error),
    'the error says what age it read, so the typo is obvious');

  // Whole years, birthday-aware — the reason obAgeOn exists rather than a division by 365.25.
  eq(a.obAgeOn(new Date(1978, 7, 22), new Date(2026, 7, 22)), 48, 'on the birthday you are the new age');
  eq(a.obAgeOn(new Date(1978, 7, 23), new Date(2026, 7, 22)), 47, 'the day before, you are not');
  eq(a.obAgeOn(new Date(1978, 8, 1), new Date(2026, 7, 22)), 47, 'a later month in the year counts down');
}

// ── 4b. the live conversion (23 Aug) ──────────────────────────────────────────────────────────
// Everything is still STORED metric. This is a readout under the question so someone who thinks in
// feet or stone can spin to their own number rather than doing the sum first.
{
  const a = app();
  eq(a.obCmToFtIn(186), '6ft 1in', '186 cm is 6ft 1in');
  eq(a.obCmToFtIn(173), '5ft 8in', "5ft 8in is 173 — the example that was hard-coded in the old sub line");
  eq(a.obCmToFtIn(183), '6ft 0in', 'a whole number of feet still says the inches, so the line never changes shape');
  eq(a.obCmToFtIn(120), '3ft 11in', 'the bottom of the wheel');
  eq(a.obCmToFtIn(220), '7ft 3in', 'the top of the wheel');

  // Rounded to whole pounds first, then split. The other way round, 13.6 lb rounds up into a
  // fourteenth pound and prints "12 st 14 lb", which is not a weight anybody says out loud.
  eq(a.obKgToStLb(79.7), '12st 8lb · 176lb', "Del's own weight");
  eq(a.obKgToStLb(76.2), '12st 0lb · 168lb', 'an exact stone reads 0 lb, not 14 lb of the one below');
  ok(!/1[4-9]lb|2\dlb/.test(a.obKgToStLb(76.15)), 'no split ever prints fourteen or more pounds');
  for (let kg = 30; kg <= 250; kg += 0.1) {
    const lb = Number(/(\d+)st (\d+)lb/.exec(a.obKgToStLb(Math.round(kg * 10) / 10))[2]);
    if (lb > 13) { ok(false, `${kg} kg split into ${lb} lb`); break; }
  }
  ok(true, 'every tenth of a kilo on the wheel splits into 0-13 lb');

  eq(a.obConversion('height_cm', 186), 'about 6ft 1in', 'the height screen gets feet and inches');
  eq(a.obConversion('start_weight_kg', 79.7), 'about 12st 8lb · 176lb', 'the weight screen gets stone and pounds');
  eq(a.obConversion('target_weight_kg', 70), 'about 11st 0lb · 154lb', 'so does the target');
  eq(a.obConversion('dob', 1978), '', 'nothing else converts');
  eq(a.obConversion('height_cm', null), '', 'an unanswered wheel converts to nothing, not to "NaNft"');
  eq(a.obConversion('height_cm', undefined), '', 'and neither does an undefined one');
}

// ── 5. chips ──────────────────────────────────────────────────────────────────────────────────
{
  const a = app();
  const sex = stepFor(a, 'sex');
  const exp = stepFor(a, 'experience');
  const days = stepFor(a, 'training_days_per_week');

  eq(a.obValidate(sex, undefined).value, null, 'no chip pressed is null');
  eq(a.obValidate(sex, 'female').value, 'female', 'a pressed chip is its value');
  eq(a.obValidate(days, 3).value, 3, 'days per week stays a number, not "3"');

  // These have to be accepted by the CHECK constraints or the whole save 400s. The form may offer
  // FEWER values than the column allows — 'other' was dropped from the form on 23 Aug at Del's
  // instruction and the constraint was deliberately left alone, so a row already carrying it still
  // saves. What it must never do is offer a value the column would reject.
  const sexAllowed = ['male', 'female', 'other'];
  ok(sex.options.every(([v]) => sexAllowed.includes(v)), "every sex offered passes the column's check");
  eq(sex.options.map(o => o[0]).join(','), 'male,female', 'the form asks male or female, in that order');
  eq(exp.options.map(o => o[0]).join(','), 'beginner,returning,intermediate,advanced',
    "experience matches the column's check, 'returning' included");
  ok(days.options.every(([v]) => Number.isInteger(v) && v >= 1 && v <= 7),
    'days per week stays inside the smallint check');
}

// ── 6. the payload ────────────────────────────────────────────────────────────────────────────
{
  const a = app();
  const row = a.obPayload({ display_name: 'Sarah', sex: 'female' }, '2026-08-22T10:00:00.000Z');

  eq(Object.keys(row).length, 9, 'eight columns plus onboarded_at');
  eq(row.display_name, 'Sarah', 'the answers given are carried');
  eq(row.onboarded_at, '2026-08-22T10:00:00.000Z', 'and the row is stamped as onboarded');
  // The half that matters on an EDIT: an omitted key is a column PostgREST leaves alone, so a
  // cleared answer would silently keep its old value.
  eq(row.dob, null, 'an unanswered column is present and null, not absent');
  eq(row.height_cm, null, 'same for height');
  ok(Object.keys(row).every(k => row[k] !== undefined), 'nothing goes over the wire as undefined');
  ok(!('units' in row), 'units is never written by the form');
  ok(!('user_id' in row), 'the client never claims whose row this is — user_id defaults to auth.uid()');

  eq(a.obPayload({ display_name: 'Sarah', target_weight_kg: '' }, 'x').target_weight_kg, null,
    'an empty string is stored as null, never as ""');
  eq(a.obPayload({ display_name: 'Sarah', training_days_per_week: 0 }, 'x').training_days_per_week, 0,
    'a real 0 survives — the steps bug, not repeated here');
}

// ── 7. the gate: who gets shown the form ──────────────────────────────────────────────────────
{
  {
    const a = app();
    ok(a.needsOnboarding(), 'a brand new account, no row at all: show the form');
  }
  {
    const a = app();
    a.setProfile({ display_name: 'Del', onboarded_at: null });
    ok(a.needsOnboarding(),
      "Del's own row: a name but onboarded_at null, so he sees it once — his own decision, 22 Aug");
  }
  {
    const a = app();
    a.setProfile({ display_name: 'Del', onboarded_at: '2026-08-22T10:00:00Z' });
    ok(!a.needsOnboarding(), 'an onboarded row: never again');
  }
  {
    // THE ONE THAT MATTERS. sb() returns [] for a failed GET as well as for an empty table, so a
    // gym with no signal leaves PROFILE blank and looks exactly like a new account.
    const store = memStore();
    const first = app({ store });
    first.setProfile({ display_name: 'Del', onboarded_at: '2026-08-22T10:00:00Z' });
    first.markOnboarded();

    const gymTrip = app({ store });   // fresh load, profile read came back empty
    ok(!gymTrip.needsOnboarding(),
      'no signal must not re-ask a four-month-old account for its name');
  }
  {
    // ...and the cache is per account, or the second person to use the phone is silently skipped
    // past the only form that gives them a name.
    const store = memStore();
    const del = app({ store, email: 'del@example.com' });
    del.markOnboarded();

    const her = app({ store, email: 'sarah@example.com' });
    ok(her.needsOnboarding(), 'a different account on the same phone still gets the form');
    ok(del.onboardedKey() !== her.onboardedKey(), 'the two accounts key on different entries');
    ok(del.obDraftKey() !== her.obDraftKey(),
      'and a half-finished form is not handed to whoever logs in next');
  }
  {
    const a = app({ store: hostileStore });
    a.setProfile({ display_name: 'Del', onboarded_at: '2026-08-22T10:00:00Z' });
    ok(!a.needsOnboarding(), 'storage that throws does not crash the gate — the row still wins');
    a.markOnboarded();   // must not throw
    ok(true, 'and marking it is survivable too');
    const blank = app({ store: hostileStore });
    ok(blank.needsOnboarding(), 'with no row and no storage, the form is the safe answer');
  }
}

// ── 8. what the source has to keep doing ──────────────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  ok(/if \(needsOnboarding\(\)\) openOnboarding\(\);/.test(src),
    'initApp actually opens the form — the plumbing exists but nothing shows it otherwise');
  ok(src.indexOf('showPage(page);') < src.indexOf('if (needsOnboarding())'),
    'and it opens over an app that has already painted');
  ok(/on_conflict=user_id/.test(src) && /upsert: true/.test(src),
    'the save is an upsert on the primary key — one row per user, insert or update');
  ok(/PROFILE = \{ \.\.\.\(PROFILE \|\| \{\}\), \.\.\.row \}/.test(src),
    'the greeting picks the new name up without a reload');

  // A failed save must not close the form: eight screens of answers behind a 503 is the check-in
  // data-loss bug in a worse place.
  const fin = src.slice(src.indexOf('async function obFinish'));
  const guard = fin.indexOf('if (!res.ok)');
  ok(guard > -1 && guard < fin.indexOf('closeOnboarding()'),
    'obFinish() returns on a failed write BEFORE it closes anything');

  ok(/onclick="openOnboarding\(true\)"/.test(html),
    'there is a way back into the answers — otherwise a typo in the name is permanent');
  ok(/id="onboarding"/.test(html) && /id="ob-rail"/.test(html) && /id="ob-next"/.test(html),
    'the frame the steps render into is in the page');
  ok(/closeOnboarding\(\);/.test(src.slice(src.indexOf('function showLoginScreen'),
                                           src.indexOf('function showLoginScreen') + 700)),
    'logging out tears the form down rather than leaving it for the next person');

  // The name box is the only free-text answer in the form, and for five days it was drawn in Bebas
  // Neue like the rest of the screen. Bebas Neue has no lowercase glyphs, so a caps-lock slip was
  // invisible while typing and surfaced on the home screen instead — "Good morning, cHARLIE" (Del,
  // 27 Aug 2026). Asserted against the stylesheet, because a later tidy that makes this screen
  // "consistent" again would put the bug straight back with nothing failing.
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  const obBig = css.slice(css.indexOf('.ob-big {'), css.indexOf('.ob-unit'));
  ok(!/Bebas/.test(obBig),
    'the name box is not drawn in a caps-only face — what you type into it is what you see');
  ok(obBig.includes("font-family: 'DM Sans'"),
    'it wears DM Sans, the same face as the greeting that prints the answer back');
  ok((src.match(/ob-big/g) || []).length === 1,
    'and one field in the whole app wears that class, so restyling it cannot reach anything else');
}

console.log(`  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
