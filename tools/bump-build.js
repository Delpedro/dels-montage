#!/usr/bin/env node
// Stamps a new build id across the four places that have to agree, then prints it.
//
//   node tools/bump-build.js
//
// RUN THIS BEFORE EVERY PUSH. The build id is what lets an already-open app notice that the code it
// is running is out of date (see checkForUpdate() in js/app.js) and what makes the asset URLs change
// so no HTTP cache can serve a stale copy. If the four values drift apart the app either never
// updates or reload-loops once and then gives up with a banner — neither is silent, but both waste a
// gym session, which is exactly what this whole mechanism exists to stop.
//
// The four places:
//   version.json   — what the server says the current build is
//   js/app.js      — APP_BUILD, what the running code thinks it is; a mismatch triggers the update
//   index.html     — ?v= on the css/js URLs, so a new build is a new URL
//   sw.js          — CACHE_NAME, so activating the new worker drops every older cache
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const d = new Date();
const p = n => String(n).padStart(2, '0');
const build = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;

function rewrite(file, replacer) {
  const full = path.join(root, file);
  const before = fs.readFileSync(full, 'utf8');
  const after = replacer(before);
  if (before === after) {
    console.error(`! ${file} — nothing replaced, check the pattern in tools/bump-build.js`);
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(full, after);
  console.log(`  ${file}`);
}

rewrite('version.json', s => s.replace(/"build":\s*"[^"]*"/, `"build": "${build}"`));
rewrite('js/app.js', s => s.replace(/const APP_BUILD = '[^']*';/, `const APP_BUILD = '${build}';`));
rewrite('index.html', s => s.replace(/\?v=[0-9-]+/g, `?v=${build}`));
rewrite('sw.js', s => s.replace(/const CACHE_NAME = '[^']*';/, `const CACHE_NAME = 'dlog-${build}';`));

console.log(`\nbuild ${build}`);
