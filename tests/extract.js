// Pulls named top-level functions (and `let`/`const` declarations) straight out of js/app.js and
// evaluates them against stubbed dependencies.
//
// Why this and not a module system: js/app.js is a single no-build script loaded by a <script> tag,
// and it is going to stay that way (see CURRENT_STATUS.md — "no framework" is a standing verdict).
// Every session up to 13 Aug 2026 wrote a throwaway harness that did exactly this and then deleted
// it — 200+ assertions binned. This file is that harness, kept.
//
// It reads the real source, so a test cannot silently pass against a stale copy of the function.

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'js', 'app.js');

// Walks from `i` (which must sit on `open`) to the matching close, skipping over string literals and
// line comments so a brace inside a string or a comment can't throw the count off.
function matchPair(src, i, open, close, name) {
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
    else if (c === '/' && src[i + 1] === '/') i = src.indexOf('\n', i);
    else if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') i++;
        else if (src[i] === quote) break;
      }
    }
  }
  throw new Error(`extract: unbalanced ${open}${close} in ${name}()`);
}

// Brace-matching rather than regex: a function body contains braces, strings containing braces, and
// template literals, so counting from the opening brace is the only reliable end-of-function.
//
// The parameter list has to be skipped first. sb() is declared
// `async function sb(path, method, body, { quiet = false } = {})` — a destructured options bag — so
// the first `{` in the source is a *parameter*, and counting from it stops the slice at the end of
// the signature. That silently produced a syntactically broken extract rather than an error.
function sliceFunction(src, name) {
  const start = src.search(new RegExp(`^(async )?function ${name}\\(`, 'm'));
  if (start < 0) throw new Error(`extract: function ${name}() not found in js/app.js`);
  const paramsEnd = matchPair(src, src.indexOf('(', start), '(', ')', name);
  const bodyEnd = matchPair(src, src.indexOf('{', paramsEnd), '{', '}', name);
  return src.slice(start, bodyEnd + 1);
}

function sliceDeclaration(src, name) {
  const m = src.match(new RegExp(`^(let|const|var) ${name} = .*?;$`, 'm'));
  if (!m) throw new Error(`extract: declaration ${name} not found in js/app.js`);
  return m[0];
}

// names: function names to lift out. decls: top-level let/const names they close over.
// deps: an object of stubs (fetch, showToast, …) made visible to the extracted code.
// accessors: `{ name: 'arrow function source' }`, evaluated *inside* the extracted scope and returned
//   alongside the functions. This is how a test reads or sets a lifted `let` — `selectedVariations`
//   and friends are closed-over bindings, so handing back a snapshot would go stale the moment the
//   code under test reassigns one. e.g. `{ state: '() => ({ selectedVariations })' }`.
function load({ functions = [], decls = [], deps = {}, accessors = {} }) {
  const src = fs.readFileSync(APP, 'utf8');
  const body = [
    ...decls.map(d => sliceDeclaration(src, d)),
    ...functions.map(f => sliceFunction(src, f)),
  ].join('\n\n');

  const returned = [...functions, ...Object.entries(accessors).map(([k, v]) => `${k}: (${v})`)];
  const depNames = Object.keys(deps);
  const factory = new Function(...depNames, `${body}\nreturn { ${returned.join(', ')} };`);
  return factory(...depNames.map(n => deps[n]));
}

module.exports = { load };
