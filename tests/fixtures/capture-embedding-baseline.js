// Captures what the five read paths returned BEFORE the PostgREST embedding change (15 Aug 2026),
// straight out of git, into embedding-baseline.json.
//
// Same idea as capture-cardio-baseline.js: the refactor's whole claim is "identical data, fewer
// requests", and the honest way to test that is to freeze the old behaviour rather than to re-read
// the new code and agree with it. Reading the old version out of git at test time would be worse —
// once this change is committed, HEAD *is* the new version and the comparison quietly becomes
// vacuous. A checked-in JSON file can't rot that way.
//
// Run: node tests/fixtures/capture-embedding-baseline.js [git-ref]
//
// Defaults to HEAD, which is right when run from a dirty working tree just before committing. Pass
// an explicit ref (e.g. 23f5e48) to re-capture later. If you deliberately change what any of these
// functions returns, re-capture in the same commit so the diff shows exactly what moved.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runScenarios } = require('./embedding-scenarios');

const ref = process.argv[2] || 'HEAD';
const root = path.join(__dirname, '..', '..');
const tmp = path.join(os.tmpdir(), `dlog-app-${ref.replace(/[^\w.-]/g, '_')}.js`);

const src = execFileSync('git', ['show', `${ref}:js/app.js`], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
fs.writeFileSync(tmp, src);

runScenarios(tmp).then(baseline => {
  const out = path.join(__dirname, 'embedding-baseline.json');
  fs.writeFileSync(out, JSON.stringify(baseline, null, 2) + '\n');
  const total = Object.values(baseline).reduce((n, s) => n + s.requests.length, 0);
  console.log(`captured ${Object.keys(baseline).length} scenarios from ${ref} → ${path.relative(root, out)}`);
  console.log(`${total} requests across all scenarios (this is the number the change has to beat)`);
  fs.unlinkSync(tmp);
});
