// The app asks its own yes/no questions (19 Aug 2026).
//
// Eight of them used to go through the browser's native confirm(). Del hit one on Home and what he
// got was an OS dialog captioned "delpedro.github.io says" sitting on top of a hand-built app —
// the same objection a native <select> got on 17 Aug, and the one part of the app with no design
// language on it. askConfirm() replaces all eight.
//
// It returns a promise, which is the whole risk: `confirm()` could not fail to answer, and a promise
// can. Every path that opens the dialog has to settle it exactly once, or a caller sits on an await
// forever and the screen looks frozen with no error anywhere. That is what most of this file checks.
//
// The source greps at the bottom are deliberate. A behavioural test cannot notice a NINTH native
// confirm() being added next month, and that is precisely how this got to eight in the first place.
//
// Run: node tests/confirm-dialog.test.js

const fs = require('fs');
const path = require('path');
const { load } = require('./extract');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  console.error('  FAIL: ' + label);
}
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return; }
  fail++;
  console.error('  FAIL: ' + label);
  console.error('    expected: ' + JSON.stringify(expected));
  console.error('    actual:   ' + JSON.stringify(actual));
}

// A DOM stub thin enough to be obvious and complete enough that askConfirm cannot tell.
function harness() {
  const mk = () => ({
    textContent: '', style: {}, onclick: null,
    classList: { names: new Set(), toggle(n, on) { if (on) this.names.add(n); else this.names.delete(n); }, has(n) { return this.names.has(n); } },
  });
  const els = {
    'confirm-modal': mk(), 'confirm-title': mk(), 'confirm-body': mk(),
    'confirm-yes': mk(), 'confirm-no': mk(),
  };
  const app = load({
    functions: ['askConfirm'],
    decls: ['confirmResolve'],
    deps: { document: { getElementById: (id) => els[id] } },
  });
  return { app, els };
}

console.log('the app asks its own questions now');

// ── Tapping the action resolves true, cancel resolves false ─────────────────
{
  const { app, els } = harness();
  const p = app.askConfirm({ title: 'Delete this workout?', yes: 'Delete it', no: 'Cancel' });
  eq(els['confirm-modal'].style.display, 'block', 'opening it shows the modal');
  eq(els['confirm-title'].textContent, 'Delete this workout?', 'the title is set');
  eq(els['confirm-yes'].textContent, 'Delete it', 'the action button says what it does');
  eq(els['confirm-no'].textContent, 'Cancel', 'and so does the other one');
  els['confirm-yes'].onclick();
  p.then(v => {
    eq(v, true, 'tapping the action resolves true');
    eq(els['confirm-modal'].style.display, 'none', 'and closes the modal');
  });
}
{
  const { app, els } = harness();
  const p = app.askConfirm({ title: 'x' });
  els['confirm-no'].onclick();
  p.then(v => eq(v, false, 'tapping cancel resolves false'));
}

// ── The backdrop is a cancel; the card is not ───────────────────────────────
{
  const { app, els } = harness();
  const modal = els['confirm-modal'];
  const p = app.askConfirm({ title: 'x' });
  modal.onclick({ target: modal });
  p.then(v => eq(v, false, 'tapping the backdrop cancels'));
}
{
  const { app, els } = harness();
  const modal = els['confirm-modal'];
  let settled = false;
  app.askConfirm({ title: 'x' }).then(() => { settled = true; });
  modal.onclick({ target: els['confirm-body'] });
  setTimeout(() => {
    eq(settled, false, 'a tap that lands on the card itself does NOT cancel');
    eq(modal.style.display, 'block', 'and leaves the dialog open');
  }, 10);
}

// ── Defaults, and the danger styling ────────────────────────────────────────
{
  const { app, els } = harness();
  app.askConfirm({ title: 'x' });
  eq(els['confirm-yes'].textContent, 'OK', 'the action defaults to OK');
  eq(els['confirm-no'].textContent, 'Cancel', 'and cancel to Cancel');
  eq(els['confirm-yes'].classList.has('confirm-yes-danger'), false, 'nothing is destructive by default');
  els['confirm-no'].onclick();
}
{
  const { app, els } = harness();
  app.askConfirm({ title: 'x', danger: true });
  eq(els['confirm-yes'].classList.has('confirm-yes-danger'), true, 'danger:true turns the action red');
  els['confirm-no'].onclick();
  // Re-used for a non-destructive question straight afterwards: the red must come back off, or the
  // next "Save it" inherits the styling of the last "Delete it".
  const { app: app2, els: els2 } = harness();
  app2.askConfirm({ title: 'y', danger: true });
  els2['confirm-no'].onclick();
  app2.askConfirm({ title: 'z' });
  eq(els2['confirm-yes'].classList.has('confirm-yes-danger'), false, 'and a later safe question takes it back off');
  els2['confirm-no'].onclick();
}

// ── The body is optional, and hidden when absent ────────────────────────────
{
  const { app, els } = harness();
  app.askConfirm({ title: 'Delete this workout?' });
  eq(els['confirm-body'].style.display, 'none', 'no body means the body element is hidden');
  els['confirm-no'].onclick();
  app.askConfirm({ title: 'x', body: 'because reasons' });
  eq(els['confirm-body'].style.display, 'block', 'and shown again when there is one');
  eq(els['confirm-body'].textContent, 'because reasons', 'set through textContent, never innerHTML');
  els['confirm-no'].onclick();
}

// ── The one that would freeze the app: two questions, one dialog ────────────
// An await that never settles is a screen that just stops, with nothing in the console.
{
  const { app, els } = harness();
  const first = app.askConfirm({ title: 'first' });
  const second = app.askConfirm({ title: 'second' });
  eq(els['confirm-title'].textContent, 'second', 'a second question takes over the dialog');
  first.then(v => eq(v, false, 'and the first promise settles false rather than hanging forever'));
  els['confirm-yes'].onclick();
  second.then(v => eq(v, true, 'while the second still answers normally'));
}

// ── Answering twice must not resolve twice ──────────────────────────────────
{
  const { app, els } = harness();
  let count = 0;
  app.askConfirm({ title: 'x' }).then(() => { count++; });
  els['confirm-yes'].onclick();
  els['confirm-yes'].onclick();
  els['confirm-no'].onclick();
  setTimeout(() => eq(count, 1, 'a double tap on the action resolves exactly once'), 20);
}

// ── Source guards ───────────────────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

  // `confirm(` also matches askConfirm( and closeConfirm(, hence the leading boundary.
  const native = code.match(/(^|[^a-zA-Z.])confirm\s*\(/g) || [];
  eq(native.length, 0, 'no native confirm() survives anywhere in app.js');

  // `await askConfirm({` rather than `askConfirm({`: the latter also matches the definition, and a
  // call site that forgot its await would be a bug this test should catch rather than count.
  const asks = code.match(/await askConfirm\(\{/g) || [];
  eq(asks.length, 8, 'all eight questions go through askConfirm()');

  ok(/bodyEl\.textContent = body;/.test(code),
     'the body is written with textContent — session and exercise names are user-typed');
  ok(!/confirm-body[\s\S]{0,80}innerHTML/.test(code),
     'and never with innerHTML');

  ok(/async function resetSessionSelection/.test(code),
     'resetSessionSelection() is async, since its warning is now awaited');

  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ok(/id="confirm-modal"[^>]*z-index:300/.test(html),
     'the dialog sits above the other modals — "Delete this workout?" is asked from inside one');
  ['confirm-title', 'confirm-body', 'confirm-yes', 'confirm-no'].forEach(id => {
    ok(html.includes('id="' + id + '"'), 'index.html carries #' + id);
  });

  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  ok(/\.confirm-body\s*\{[^}]*white-space:\s*pre-line/.test(css),
     'the body keeps its line breaks, so a list of exercise names reads as a list');
  ok(/\.confirm-actions \.btn\s*\{[^}]*flex:\s*1/.test(css),
     'both buttons share the width, so a long label cannot squeeze the other to nothing');
}

setTimeout(() => {
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
}, 60);
