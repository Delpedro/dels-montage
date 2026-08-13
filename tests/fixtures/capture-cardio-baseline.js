// Captures what the cardio block looked like BEFORE the two renderers were merged (13 Aug 2026),
// straight out of the pre-merge `js/app.js` in git — not out of the current source, which is the
// whole point: the fixture has to be independent of the code it's checking.
//
//   node tests/fixtures/capture-cardio-baseline.js [git-ref]
//
// Default ref is `578db01`, the commit immediately before the merge, where the two original
// `renderCardioEntryBlock` / `renderEditCardioEntryBlock` functions still exist.
//
// **Re-run this only when you deliberately change the cardio box**, pointing it at the commit that
// holds the new intended output, and commit the regenerated fixture in the same change — so the diff
// shows exactly what moved on screen. Re-running it to make a failing test pass defeats the test.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { load } = require('../extract');

const ref = process.argv[2] || '578db01';
const root = path.join(__dirname, '..', '..');

const oldSrc = execFileSync('git', ['show', `${ref}:js/app.js`], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const tmp = path.join(os.tmpdir(), `dlog-app-${ref.replace(/[^a-z0-9]/gi, '')}.js`);
fs.writeFileSync(tmp, oldSrc);

// The real esc()/jsAttr()/cardioDisplayName from that same commit — no stubs, so the fixture records
// exactly what the browser was handed.
const api = load({
  file: tmp,
  functions: ['esc', 'jsAttr', 'cardioDisplayName', 'renderCardioEntryBlock', 'renderEditCardioEntryBlock'],
  decls: ['CARDIO_ACTIVITIES', 'CARDIO_DISPLAY_NAMES', 'CARDIO_FIELD_LABELS'],
  accessors: { activities: '() => CARDIO_ACTIVITIES' },
});

const out = {};
// Driven off CARDIO_ACTIVITIES rather than a hand-written list — a hardcoded list is how Ski Erg got
// missed on the first attempt, and the test asserts every activity has an entry here.
for (const activity of Object.keys(api.activities())) {
  out[`live:${activity}`] = api.renderCardioEntryBlock({ id: 3, activity }, 'lower-a');
  out[`edit:${activity}`] = api.renderEditCardioEntryBlock({ id: 3, activity });
}
out['live:unknown'] = api.renderCardioEntryBlock({ id: 1, activity: 'Nope' }, 'x');
out['edit:unknown'] = api.renderEditCardioEntryBlock({ id: 1, activity: 'Nope' });

const dest = path.join(__dirname, 'cardio-block-baseline.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
fs.unlinkSync(tmp);
console.log(`captured ${Object.keys(out).length} snapshots from ${ref} → ${path.relative(root, dest)}`);
