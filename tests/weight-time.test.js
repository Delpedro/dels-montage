// Weighing time on the daily check-in, and the energy slider's left-hand end (20 August 2026).
//
// Two of Del's, same morning. The energy rail said "Flat … Flying" but its leftmost stop rendered
// "—", so the label promised a reading the slider could not give; and a weight was being stored
// with a date but no hour, which makes the trend line lie — scale weight moves a kilo on water
// overnight, so a 7am fasted reading and a 9pm one are not the same measurement.
//
// The stamping rule is the part worth pinning down: it fills a BLANK only. A weight gets retyped
// constantly (a correction, the decimal landing a keystroke later), and every one of those keystrokes
// fires the same handler. If it overwrote, a time Del typed by hand — or one read back from a save
// made this morning — would be silently replaced with the moment he happened to be editing, which is
// exactly the fabricated fact the column exists to prevent.
//
// Run: node tests/weight-time.test.js

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

// A field is a value box; a row is a wrapper we only read `style.display` off; the energy word also
// carries a class. Enough DOM to run the real functions, and no more.
function el(value = '') {
  return {
    value,
    textContent: '',
    style: {},
    classes: {},
    classList: { toggle(name, on) { this._owner.classes[name] = !!on; } },
  };
}
function makeDom(prefix) {
  const els = {
    [`${prefix}-weight`]: el(),
    [`${prefix}-weight-time`]: el(),
    [`${prefix}-weight-time-row`]: el(),
  };
  for (const e of Object.values(els)) e.classList._owner = e;
  return { els, document: { getElementById: id => els[id] || null } };
}

console.log('Weighing time + energy slider ends');

// ── The stamp ─────────────────────────────────────────────────────────────────────────────────
{
  const dom = makeDom('log');
  const app = load({
    functions: ['nowHHMM', 'hhmm', 'syncWeightTime', 'weightTimeValue', 'numOrNull'],
    deps: { document: dom.document },
  });

  eq(app.hhmm('07:12:00'), '07:12', 'Postgres time reads back as HH:MM for the input');
  eq(app.hhmm(null), '', 'no stored time is an empty box, not "null"');
  eq(app.hhmm(''), '', 'and an empty string stays empty');
  ok(/^\d{2}:\d{2}$/.test(app.nowHHMM()), 'the stamp is zero-padded HH:MM');

  // Nothing typed yet: the row is not on screen at all, so a day with no weighing keeps the form
  // exactly as short as it was before this feature existed.
  app.syncWeightTime('log', true);
  eq(dom.els['log-weight-time-row'].style.display, 'none', 'no weight, no "Weighed at" row');
  eq(dom.els['log-weight-time'].value, '', 'and nothing is stamped against a blank weight');

  dom.els['log-weight'].value = '79.9';
  app.syncWeightTime('log', true);
  eq(dom.els['log-weight-time-row'].style.display, 'flex', 'typing a weight reveals the row');
  eq(dom.els['log-weight-time'].value, app.nowHHMM(), 'and stamps the current time');

  // The keystroke after that — 79.9 becoming 79.95 — must not move the stamp.
  dom.els['log-weight-time'].value = '06:40';
  dom.els['log-weight'].value = '79.95';
  app.syncWeightTime('log', true);
  eq(dom.els['log-weight-time'].value, '06:40', 'retyping the weight never overwrites a time already set');

  // Reading a saved log back is the same call with stamping off, so opening yesterday's check-in
  // cannot quietly restamp it with the hour Del opened it at.
  dom.els['log-weight-time'].value = '';
  app.syncWeightTime('log', false);
  eq(dom.els['log-weight-time'].value, '', 'loading a log with no stored time leaves it blank');
  eq(dom.els['log-weight-time-row'].style.display, 'flex', 'though the row still shows, so it can be filled in');

  // Deleting the weight takes its stamp with it. Left behind, the time would sit on the next weight
  // typed into that box and claim to be its reading.
  dom.els['log-weight-time'].value = '06:40';
  dom.els['log-weight'].value = '';
  app.syncWeightTime('log', false);
  eq(dom.els['log-weight-time'].value, '', 'clearing the weight clears the time');
  eq(dom.els['log-weight-time-row'].style.display, 'none', 'and hides the row again');

  // ── What actually gets written ──────────────────────────────────────────────────────────────
  dom.els['log-weight'].value = '79.9';
  dom.els['log-weight-time'].value = '07:12';
  eq(app.weightTimeValue('log'), '07:12', 'weight + time saves the time');

  dom.els['log-weight'].value = '';
  eq(app.weightTimeValue('log'), null, 'a time with no weight timestamps nothing, so it saves null');

  dom.els['log-weight'].value = '79.9';
  dom.els['log-weight-time'].value = '';
  eq(app.weightTimeValue('log'), null, 'a weight with no time saves null rather than an empty string');

  // Every historic row is null here, and null has to keep meaning "we do not know when" — never a
  // guess derived from created_at, which is when the check-in was typed, not when he weighed.
  dom.els['log-weight'].value = '0';
  dom.els['log-weight-time'].value = '07:12';
  eq(app.weightTimeValue('log'), '07:12', 'a zero weight is still a weight as far as this is concerned');
}

// ── The same three functions drive the edit modal, keyed by prefix ────────────────────────────
{
  const dom = makeDom('edit');
  const app = load({
    functions: ['nowHHMM', 'syncWeightTime', 'weightTimeValue', 'numOrNull'],
    deps: { document: dom.document },
  });
  dom.els['edit-weight'].value = '80.2';
  dom.els['edit-weight-time'].value = '08:05';
  app.syncWeightTime('edit', true);
  eq(dom.els['edit-weight-time'].value, '08:05', 'a correction in History keeps the hour it was measured at');
  eq(app.weightTimeValue('edit'), '08:05', 'and saves it back unchanged');
}

// ── The energy slider's ends ──────────────────────────────────────────────────────────────────
{
  const els = { 'log-energy': el(), 'log-energy-word': el() };
  for (const e of Object.values(els)) e.classList._owner = e;
  const app = load({
    functions: ['setEnergy'],
    decls: ['ENERGY_WORDS'],
    accessors: { words: '() => ENERGY_WORDS' },
    deps: { document: { getElementById: id => els[id] || null } },
  });
  const words = app.words();

  eq(words.length, 6, 'six stops: not-set plus the five the DB stores');
  eq(words[0], 'Not set', 'position 0 says what it is instead of "—"');
  eq(words[1], 'Flat', 'Flat is a real answer, one notch in');
  eq(words[5], 'Flying', 'and the top of the scale is the word printed on the right of the rail');

  app.setEnergy(0);
  eq(els['log-energy-word'].textContent, 'Not set', 'dragged fully left, the slider says Not set');
  ok(els['log-energy-word'].classes['energy-unset'], 'and reads muted, not as a scored answer');

  app.setEnergy(5);
  eq(els['log-energy-word'].textContent, 'Flying', 'dragged fully right, it says Flying');
  ok(!els['log-energy-word'].classes['energy-unset'], 'in the accent colour, because now it is an answer');
  eq(els['log-energy'].value, 5, 'and the thumb follows the value it was set to');
}

console.log(`  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
