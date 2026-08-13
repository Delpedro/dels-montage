// Runs every *.test.js in this folder, plus `node --check` on the app's JS. No dependencies, no
// test framework — the project has no build step and isn't getting one.
//
// Usage: npm test

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const failures = [];

function run(label, args) {
  try {
    const out = execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
    process.stdout.write(out);
    return true;
  } catch (e) {
    process.stdout.write(e.stdout || '');
    process.stderr.write(e.stderr || '');
    failures.push(label);
    return false;
  }
}

for (const file of ['js/app.js', 'sw.js', 'tools/bump-build.js']) {
  if (!fs.existsSync(path.join(root, file))) continue;
  if (run(`syntax: ${file}`, ['--check', file])) console.log(`syntax ok: ${file}`);
}

for (const file of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort()) {
  run(file, [path.join(__dirname, file)]);
}

if (failures.length) {
  console.error(`\nFAILED: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nAll green.');
