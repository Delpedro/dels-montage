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
// A `/` starts a regex literal rather than a division when the previous meaningful character can't
// end an expression. Good enough for this file, and it has to be here: `esc()` contains
// `.replace(/'/g, '&#39;')`, whose apostrophe *inside a regex* was read as the start of a string
// literal. The scanner then desynchronised and sliced to the end of the file, which surfaced as a
// baffling "Identifier already declared" from four hundred lines further down.
function regexStartsHere(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  return j < 0 || '(,=:[!&|?{};+-*%~^<>'.includes(src[j]) || /\breturn$|\btypeof$|\bcase$/.test(src.slice(Math.max(0, j - 6), j + 1));
}

function matchPair(src, i, open, close, name) {
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
    else if (c === '/' && src[i + 1] === '/') i = src.indexOf('\n', i);
    else if (c === '/' && src[i + 1] === '*') i = src.indexOf('*/', i) + 1;
    else if (c === '/' && regexStartsHere(src, i)) {
      // Skip the literal and its flags. A `/` inside a character class doesn't end it.
      let inClass = false;
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') i++;
        else if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        else if (src[i] === '\n') break;   // not a regex after all — bail rather than run away
      }
    }
    else if (c === '`') i = skipTemplate(src, i, name);
    else if (c === "'" || c === '"') {
      const quote = c;
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') i++;
        else if (src[i] === quote) break;
      }
    }
  }
  throw new Error(`extract: unbalanced ${open}${close} in ${name}()`);
}

// Returns the index of the backtick that closes the template starting at `i`.
//
// A template literal can't be scanned as "run to the next backtick", because its `${…}` holes
// contain real code — including more template literals. fetchOpenPreviousSets() is the case that
// forced this: it builds an `in.(…)` filter with a nested template inside a .map() inside a hole.
// The naive scan took the *inner* opening backtick as the end of the outer string, carried on in
// code mode inside what was actually a string, and sliced the function short — surfacing as a
// "missing ) after argument list" from new Function() rather than anything pointing here.
//
// The holes are handed back to matchPair, which knows about strings, comments and regexes, so the
// two functions recurse through each other for as deep as the nesting goes.
function skipTemplate(src, i, name) {
  for (i++; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === '`') return i;
    else if (src[i] === '$' && src[i + 1] === '{') i = matchPair(src, i + 1, '{', '}', name);
  }
  throw new Error(`extract: unterminated template literal in ${name}()`);
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

// Single-line first (`let currentWorkoutId = null;`), then the multi-line object/array form
// (`const CARDIO_ACTIVITIES = { … };` spread over eight lines), matched the same brace-counting way
// a function body is. Without the second case a test wanting real config data had to hand-copy it,
// which is precisely the stale-copy problem this file exists to stop.
function sliceDeclaration(src, name) {
  const oneLine = src.match(new RegExp(`^(let|const|var) ${name} = .*?;$`, 'm'));
  if (oneLine) return oneLine[0];

  const start = src.search(new RegExp(`^(let|const|var) ${name} = [\\{\\[]`, 'm'));
  if (start < 0) throw new Error(`extract: declaration ${name} not found in js/app.js`);
  const openIdx = src.slice(start).search(/[{[]/) + start;
  const open = src[openIdx];
  const end = matchPair(src, openIdx, open, open === '{' ? '}' : ']', name);
  // Include the trailing semicolon if there is one.
  return src.slice(start, end + 1) + (src[end + 1] === ';' ? ';' : '');
}

// names: function names to lift out. decls: top-level let/const names they close over.
// deps: an object of stubs (fetch, showToast, …) made visible to the extracted code.
// accessors: `{ name: 'arrow function source' }`, evaluated *inside* the extracted scope and returned
//   alongside the functions. This is how a test reads or sets a lifted `let` — `selectedVariations`
//   and friends are closed-over bindings, so handing back a snapshot would go stale the moment the
//   code under test reassigns one. e.g. `{ state: '() => ({ selectedVariations })' }`.
// `file` overrides which source is read. It exists for one job: capturing a baseline of what a
// function produced *before* a refactor, by pointing at the pre-change copy out of git
// (`git show HEAD:js/app.js`). Everything else should leave it alone and read the live app.
function load({ functions = [], decls = [], deps = {}, accessors = {}, file = APP }) {
  const src = fs.readFileSync(file, 'utf8');
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
