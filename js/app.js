// ─── BUILD / SELF-UPDATE ──────────────────────────────────
// Bumped by `node tools/bump-build.js` before every push, together with version.json, the ?v= stamps
// in index.html and sw.js's CACHE_NAME. Never edit this by hand — run the script.
//
// Why this exists: an installed iOS PWA is not reliably *relaunched* when you tap its icon. iOS often
// resumes the suspended web view instead, so no navigation happens, nothing is re-fetched, and the app
// keeps running whatever JS it loaded days ago — the deploy is live on the server and invisible on the
// phone. Deleting the home-screen icon "fixed" it because that threw the web view away. Three separate
// debugging sessions have been burned on features that were live all along. So the app now checks a
// build stamp on the server whenever it comes back to the foreground and refreshes itself if it's
// running old code.
const APP_BUILD = '2026-08-24-1616';

// What version.json says, once we have asked. Only ever used for the login readout: if this and
// APP_BUILD disagree, the page is running code the server has already replaced - the stale-pair
// case a network-first service worker is supposed to make impossible, and the first thing to rule
// out when a fix "didn't work".
let serverBuild = null;

// ─── EVERY REQUEST HAS A DEADLINE ─────────────────────────
// 20 August 2026, and this is the bug six attempts at the "login bug" were standing next to.
//
// "i cant do anything, the only thing that will work is closing down and opening the app - and
// thats fucking wrecking my head" (Del). Plus, in the same breath, two facts that name the cause
// between them: **it worked in the browser**, and **he was still on build 1805 after 1814 shipped.**
//
// An iOS PWA is not relaunched when you tap its icon — the suspended web view is resumed, and it
// hands the next request a socket from a network stack that died while the phone was asleep. That
// fetch never resolves and never rejects. It just sits there. A browser tab does not do this
// because opening it is a fresh navigation, which is exactly the asymmetry Del reported.
//
// Attempt #6 fixed the timeout in ONE place — handleLogin() — and nine other fetches were left
// unbounded. Two of them are the whole failure:
//
//   1. On load, a stored session goes validAccessToken() → refreshSession() → fetch(). Hangs, so
//      enterApp() is never reached and the login screen sits there over a perfectly good session.
//      Tapping Get In then hangs on the same dead stack until its 12s abort — which Del, reasonably,
//      never waited for.
//   2. checkForUpdate() → fetch('version.json'). Hangs *inside the try*, so its finally never runs,
//      so updateCheckRunning stays true forever, so the app can never check for an update again
//      for the life of that web view. **That is why he was stranded on 1805.** applyUpdate() then
//      awaits refreshInFlight, which is the promise from (1), which never settles either.
//
// Force-quitting was the only cure because a new process gets a new network stack. Nothing was ever
// wrong with the session, the password, or the palette.
//
// So: no request in this app may be unbounded. A dead socket has to fail like a dead socket —
// loudly, in seconds — instead of pretending to still be working.
const NET_TIMEOUT_MS = 10000;

// AbortController rather than a bare timer, deliberately: aborting tears the dead connection down,
// so the *next* request gets a fresh socket instead of queueing behind a corpse. A timer that only
// rejects the promise would leave the stack just as jammed.
//
// A caller that brings its own signal is passed straight through — handleLogin() owns its own
// deadline because it has a specific sentence to show when it expires.
function netFetch(url, opts = {}, timeoutMs = NET_TIMEOUT_MS) {
  if (opts.signal) return fetch(url, opts);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}

let updateCheckRunning = false;
let lastUpdateCheck = 0;

// The poll below runs every 60s, and setInterval drifts late — a background tab is throttled, a
// resumed web view fires the tick whenever it wakes. A 60s throttle would swallow roughly every
// other tick as "too soon"; 20s leaves room for the jitter while still collapsing the burst of
// checks a foreground can produce (visibilitychange + pageshow + the tick landing together).
const UPDATE_THROTTLE_MS = 20000;
const UPDATE_POLL_MS = 60000;

// `force` skips the throttle (used on first load). Silent on any failure — a flaky connection
// must never block the app, and the next foreground will try again.
async function checkForUpdate(force = false) {
  if (updateCheckRunning) return;
  if (!force && Date.now() - lastUpdateCheck < UPDATE_THROTTLE_MS) return;
  updateCheckRunning = true;
  lastUpdateCheck = Date.now();
  try {
    const res = await netFetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { build } = await res.json();
    serverBuild = build || null;
    renderLoginDiag();
    if (!build || build === APP_BUILD) return;

    // Mid-workout, a surprise reload in the middle of typing a set is worse than being one build
    // behind — offer it instead. (Inputs are draft-saved, but a running rest timer and the scroll
    // position are not worth losing while he's under a bar.)
    if (currentWorkoutId) { showUpdateBanner(); return; }

    // Same rule on the login screen. A reload mid-tap wipes both fields and reads as "the button
    // did nothing" — the exact symptom that cost eight rounds on the login bug. Only when he has
    // actually started typing: a login screen sitting untouched is the best moment there is to
    // take a new build.
    if (loginInputBusy()) { showUpdateBanner(); return; }

    // One automatic reload per build, then stop. If the page comes back still running the old build
    // the reload isn't working, and looping would leave the app unusable rather than merely stale.
    if (sessionStorage.getItem('dlog_update_tried') === build) { showUpdateBanner(); return; }
    sessionStorage.setItem('dlog_update_tried', build);
    // Released BEFORE applyUpdate rather than in the finally. applyUpdate ends in location.reload(),
    // so the flag's value afterwards is academic — but if anything in there ever fails to settle,
    // leaving this true would silently retire the app's ability to update itself for the rest of the
    // web view's life. That is the shape of the bug that stranded Del on 1805; it does not get to
    // happen twice.
    updateCheckRunning = false;
    await applyUpdate();
  } catch (e) {
    // offline / DNS / GitHub Pages hiccup — nothing to do
  } finally {
    updateCheckRunning = false;
  }
}

// Pulls the new service worker and reloads. The ?v= build stamp on the asset URLs means the fresh
// index.html points at URLs nothing has ever cached, so this can't come back with old JS.
//
// This used to delete every cache first, and that is what broke the app on 18 Aug. Deleting the
// caches removes the offline fallback at the exact moment it is most likely to be needed — the
// reload immediately after a deploy, when GitHub Pages may still be serving a half-published tree.
// One failed asset fetch then had nothing to fall back to and the page rendered with no CSS and no
// JS: white, unstyled text. It was also redundant. The service worker's own 'activate' already
// deletes every cache whose name isn't the current build's, so the cleanup happens anyway — just in
// the right order, after a working replacement exists rather than before.
async function applyUpdate() {
  // Wait for any token refresh to land before tearing the page down. Supabase rotates the refresh
  // token on every use: the server marks the old one spent and hands back a new one, and only
  // storeSession() writing that response to localStorage makes the new one ours. Reload in the
  // gap and localStorage keeps a token the server has already retired — the next boot gets a 400
  // and the login screen. That is why updating and "I had to sign in again" kept happening on the
  // same morning, and why reopening quickly seemed to avoid it: GoTrue lets a spent token through
  // for ~10 seconds, so only the slow reopen actually noticed.
  //
  // The wait is one HTTP round trip at most, and it can't hang the update — but only because
  // refreshSession()'s fetch now has a deadline. It did not, and this await is where that hang
  // became "the app can never update itself again". Raced anyway: this promise belongs to another
  // function, and a reload that is merely early is infinitely better than one that never comes.
  if (refreshInFlight) {
    try {
      await Promise.race([refreshInFlight, new Promise(r => setTimeout(r, NET_TIMEOUT_MS))]);
    } catch (e) {}
  }
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.update()));
    }
  } catch (e) {}
  location.reload();
}

// The login screen is a full-viewport overlay, so anything the banner offers there is the only way
// out of a stale build — but only if he is mid-entry. Empty fields mean nothing is lost by a reload.
function loginInputBusy() {
  if (!document.documentElement.classList.contains('login-active')) return false;
  const email = document.getElementById('login-email');
  const pass = document.getElementById('login-password');
  return !!((email && email.value) || (pass && pass.value));
}

function showUpdateBanner() {
  if (document.getElementById('update-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'update-banner';
  bar.className = 'update-banner';
  bar.innerHTML = `<span>New version ready</span><button type="button" onclick="applyUpdate()">Update</button>`;
  document.body.appendChild(bar);
}

// The two moments a resumed PWA can notice it's stale: coming back to the foreground, and being
// restored from the back/forward cache. A plain 'load' listener never fires in either case.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForUpdate();
});
window.addEventListener('pageshow', (e) => { if (e.persisted) checkForUpdate(true); });
window.addEventListener('load', () => checkForUpdate(true));

// ...and the one moment neither of those covers: nothing happening at all. Every trigger above is a
// transition, so a tab left open and focused — a phone on the bench between sets, a PC tab open all
// evening — never checked again after the load check, which GitHub Pages' ~30-60s publish lag means
// almost always fired before the new build existed. That is the whole reason Del kept pressing F5.
// Skipped while hidden: a background tab's timers are throttled to minutes anyway, and
// visibilitychange already covers the return.
setInterval(() => {
  if (document.visibilityState === 'visible') checkForUpdate();
}, UPDATE_POLL_MS);

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
// The scroll-lock that used to live here forced window.scrollTo(0, 0) on every scroll event while
// the login screen was up. On a phone that is a fight you lose: tap the password field, iOS scrolls
// it clear of the keyboard, this yanked it straight back under the keyboard. Removed 19 Aug 2026
// along with `touch-action: none` — see the CSS note on html.login-active. The login screen is a
// fixed, opaque, full-viewport overlay, so it needs no scroll lock to stay in front of anything.

const SUPABASE_URL = 'https://mltikqmwwlgyzogrgemr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2BQBFSox7bL1X2TlSlbOYA_hn8FcPmy';

// Loaded from Supabase (session_templates + session_exercises) at app init — see loadSessionTemplates().
// Was previously a hardcoded literal here; moved to the DB so fixed-session templates (exercise list,
// order, set counts) can be edited permanently in-app via the template editor.
let SESSIONS = [];

// Fetches session_templates + session_exercises and rebuilds SESSIONS in the same shape the rest of
// the app already expects. Must be awaited before anything that reads SESSIONS (buildExerciseLibrary,
// buildSessionGrid, etc.) — called from initApp() before those run.
async function loadSessionTemplates() {
  const [templates, exercises] = await Promise.all([
    sb('session_templates?order=sort_order.asc&select=*'),
    sb('session_exercises?order=sort_order.asc&select=*')
  ]);
  const exByTemplate = {};
  (exercises || []).forEach(row => {
    const ex = { name: row.name, sets: row.sets, reps: row.reps, rest: row.rest };
    if (row.note) ex.note = row.note;
    if (row.variations) ex.variations = row.variations;
    if (row.aliases) ex.aliases = row.aliases;
    if (row.band) ex.band = true;
    if (row.bodyweight) ex.bodyweight = true;
    // A superset built into the template (added 11 Aug 2026) — exercises sharing a tag start the
    // session already paired. See the Supersets section: the in-gym picker can still change it.
    if (row.superset_group) ex.supersetGroup = row.superset_group;
    (exByTemplate[row.session_id] ||= []).push(ex);
  });
  const next = (templates || []).map(t => {
    const session = {
      id: t.id, name: t.name, focus: t.focus, programme: t.programme, sort_order: t.sort_order,
      exercises: exByTemplate[t.id] || []
    };
    if (t.day) session.day = t.day;
    if (t.cardio) session.cardio = true;
    return session;
  });
  // A failed GET comes back as [] rather than throwing (see sb()), and this used to assign that []
  // straight over SESSIONS. Harmless while the only callers were init and a save that had just
  // succeeded; not harmless now that refreshSessionTemplates() calls it on every foreground, which
  // on a gym-basement connection would have replaced a perfectly good session grid with an empty
  // one. An empty read only wins when there was nothing to lose — a brand-new account whose
  // templates genuinely are empty. It cannot strand a deletion either: only a My Session can be
  // deleted (see deleteSessionTemplate), so the built-ins keep every real read non-empty.
  if (!next.length && SESSIONS.length) return false;
  SESSIONS = next;
  return true;
}

// ─── TEMPLATE FRESHNESS (24 Aug 2026) ─────────────────────────────────────────────────────────
// SESSIONS was a snapshot taken once, at boot, and nothing ever re-read it except the device that
// did the editing — the ✎ editor and the save/delete of a My Session each call loadSessionTemplates()
// on their way out, so locally the change looked instant and the gap was invisible for four months.
//
// The gap: edit Upper 1 on the laptop, then train off the phone whose PWA has been sitting resumed
// since yesterday, and the phone logs YESTERDAY'S template. Nothing on screen says it is stale and
// nothing short of force-quitting the app fixes it. checkForUpdate() does not cover this — it
// reloads on a new BUILD, not on new DATA, so an edit only ever reached the second device by the
// accident of a deploy happening afterwards. That is the "how long does it take?" with no answer.
//
// Two phones on one account is the normal case once this is on the stores, not an edge case, and
// "I changed my programme and the app carried on with the old one" is a refund, not a bug report.
//
// So: re-read on every foreground and on every visit to the Workout tab. Two small selects, both
// throttled, and neither can disturb a session in progress — the logger runs off its own clone
// (see selectSession's clone-before-mutate), so a refresh mid-workout changes nothing on screen.
// Today's session picks the edit up the next time the tile is tapped.
const TEMPLATE_REFRESH_THROTTLE_MS = 30000;
let templateRefreshRunning = false;
let lastTemplateRefresh = 0;

async function refreshSessionTemplates(force = false) {
  if (templateRefreshRunning) return;
  // Nothing loaded yet means initApp() hasn't finished — it owns the first read, and firing a
  // second one alongside it would only race it. The login overlay is skipped for a harder reason:
  // sb() with no session calls forceLogout(), so a background refresh there would boot him out.
  if (!SESSIONS.length) return;
  if (document.documentElement.classList.contains('login-active')) return;
  if (!force && Date.now() - lastTemplateRefresh < TEMPLATE_REFRESH_THROTTLE_MS) return;
  templateRefreshRunning = true;
  lastTemplateRefresh = Date.now();
  try {
    const before = templateFingerprint();
    if (!await loadSessionTemplates()) return;   // failed read — keep what we had
    if (templateFingerprint() === before) return;
    EXERCISE_LIBRARY = buildExerciseLibrary();
    // Only repaint what is actually on screen. buildSessionGrid() rebuilds every tile and re-reads
    // this week's workouts to redo the done states, which is wasted work behind the logger — and the
    // logger itself is deliberately left alone, see the note above.
    if (document.getElementById('session-grid').style.display !== 'none') {
      await buildSessionGrid(selectedProgramme);
    }
  } catch (e) {
    // Offline or a bad read. The old SESSIONS stand and the next foreground tries again.
  } finally {
    templateRefreshRunning = false;
  }
}

// Cheap enough to run on every foreground, and it is what stops a refresh that changed nothing from
// tearing down and rebuilding the grid under his thumb. Covers everything the ✎ editor can write:
// membership, order, set counts, reps/rest, supersets, and the session name/focus on the tile.
function templateFingerprint() {
  return SESSIONS.map(s => [s.id, s.name, s.focus, s.programme, s.sort_order,
    (s.exercises || []).map(e => [e.name, e.sets, e.reps, e.rest, e.supersetGroup || ''].join('~')).join('|')
  ].join('~')).join('\n');
}

// The same two moments checkForUpdate() watches, for the same reason — a resumed PWA is the case
// that was broken. 'load' is not among them: initApp() has just read the templates itself.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshSessionTemplates();
});
window.addEventListener('pageshow', (e) => { if (e.persisted) refreshSessionTemplates(true); });

// Sessions saved out of an Open Workout carry this programme id (see offerSaveOpenAsTemplate). It's
// purely a marker on the row — what makes a session yours rather than built-in, so it can be deleted
// and so buildSessionGrid knows to put it on the top screen. There is deliberately NO tile for it:
// a saved session appears as its own tile under "Log Workout", named whatever you called it, not
// filed behind a "My Sessions" folder.
const CUSTOM_PROGRAMME_ID = 'custom';

const TRAINING_PROGRAMMES = [
  {
    id: 'upper-lower',
    // Short names, 17 Aug 2026. These render in Bebas at 20px in a half-width tile now, and
    // "Upper / Lower Training Programme" wrapped to three lines there. The `focus` line under it
    // already says what's in the programme, so "Training Programme" was saying nothing twice.
    name: 'Upper / Lower',
    focus: 'Upper 1, Lower 1, Upper 2, Lower 2'
  },
  {
    id: 'full-body-cv',
    name: 'Full Body + CV',
    focus: '3 strength days, 2 CV + pump days'
  },
  // Kept so session_templates.programme has something to point at; never rendered as a tile.
  {
    id: CUSTOM_PROGRAMME_ID,
    name: 'My Sessions',
    focus: 'Saved from your own Open Workouts'
  }
];

// ─── EXERCISE LIBRARY (for Open Workout's Add Exercise dropdown) ──
// Flattened from SESSIONS, deduped by name (first occurrence wins), keyed by name for O(1) lookup.
function buildExerciseLibrary() {
  const map = {};
  SESSIONS.forEach(s => {
    // Copy, minus supersetGroup: a pairing belongs to the session it was set in, not to the exercise.
    // Every caller clones from here ({...EXERCISE_LIBRARY[name]}), so leaving the tag on would carry
    // Upper 1's pairing into an Open Workout — two exercises that happened to be tagged '1' in their
    // source templates would silently pair themselves the moment you added them.
    (s.exercises || []).forEach(ex => {
      if (!map[ex.name]) { const { supersetGroup, ...shape } = ex; map[ex.name] = shape; }
    });
  });
  // Variations stored on the exercise itself (exercises.variations, 20 Aug 2026). Until now a
  // variation picker could only come from a session_exercises row, so a lift belonging to no fixed
  // template could never have one — which is exactly what Seated Row is, and Del wants its four
  // gym options (Pully / Machine / High Row / Low Row) on it.
  //
  // A template's own list still wins. That list is session-scoped on purpose: Upper 1 and Full Body
  // A want Smith/BB on the Incline Press while the DB variant stays a separate exercise.
  Object.entries(EXERCISE_VARIATIONS).forEach(([name, variations]) => {
    if (!map[name]) map[name] = { name, sets: 3, reps: '8–12', rest: '90s' };
    if (!map[name].variations) map[name].variations = variations;
  });
  return map;
}
let EXERCISE_LIBRARY = {};  // populated after loadSessionTemplates() resolves — see initApp()

// ─── EXERCISE IDENTITY ────────────────────────────────────
// An exercise used to BE its name: workout_sets.exercise, session_exercises.name and the keys of
// EXERCISE_LIBRARY were all the same free-text string, so respelling one orphaned its history.
// Migration 20260820140000 gave every exercise a row in `exercises` with a stable uuid, and the
// three tables now carry an exercise_id FK alongside the name.
//
// Names remain the in-memory key on purpose — they key EXERCISE_LIBRARY, the draft, previousSets,
// the superset groups and a few hundred DOM ids, and converting all of that buys nothing the FK
// doesn't already give. This map is the boundary: name in, durable id out, sent with every write.
//
// Nothing here is load-bearing for saving. A missing id is filled in by the database's link
// trigger from the name, which is what keeps a service-worker-cached old app.js saving sets.
let EXERCISE_IDS = {};          // name → uuid
let EXERCISE_VARIATIONS = {};   // name → string[], straight off the exercises row

// Populates both maps. Does NOT rebuild EXERCISE_LIBRARY — initApp() awaits this *before* the
// build, so buildExerciseLibrary() can fold the variations in on its own terms. Rebuilding here
// would race loadCustomExercises(), which is deliberately not awaited.
async function loadExerciseIds() {
  const rows = await sb('exercises?select=id,name,variations');
  const ids = {}, variations = {};
  (rows || []).forEach(r => {
    ids[r.name] = r.id;
    if (Array.isArray(r.variations) && r.variations.length) variations[r.name] = r.variations;
  });
  EXERCISE_IDS = ids;
  EXERCISE_VARIATIONS = variations;
}

// Returns { exercise_id } to spread into a row, or {} when the name isn't known yet — a brand new
// exercise typed in Open Workout, or a map that hasn't loaded. Never sends null: an explicit null
// and an absent key both leave the trigger to resolve it, and the absent key keeps the payload
// honest about what the client actually knew.
function exerciseIdFields(name) {
  const id = EXERCISE_IDS[name];
  return id ? { exercise_id: id } : {};
}

// A name typed into Open Workout or the template editor is new to this app session but not
// necessarily new to the database, so this is find-or-create. The `exercises` row itself is made
// by the custom_exercises link trigger; reading its id straight back afterwards is what lets the
// very first set logged under the new name carry the id, instead of it appearing only after the
// next app start. Both entry points share this — they had drifted into two identical copies.
async function registerNewExercise(name) {
  const existing = await sb(`custom_exercises?name=eq.${encodeURIComponent(name)}&select=id`);
  if (!existing || existing.length === 0) {
    await sb('custom_exercises', 'POST', { name });
  }
  const row = await sb(`exercises?name=eq.${encodeURIComponent(name)}&select=id`);
  if (row && row[0]) EXERCISE_IDS[name] = row[0].id;
  EXERCISE_LIBRARY[name] = { name, sets: 3, reps: '8–12', rest: '90s' };
}

// Merges in custom_exercises rows (typed on the fly in Open Workout) — called once at app init.
async function loadCustomExercises() {
  const rows = await sb('custom_exercises?select=name&order=name.asc');
  (rows || []).forEach(r => {
    if (!EXERCISE_LIBRARY[r.name]) {
      EXERCISE_LIBRARY[r.name] = { name: r.name, sets: 3, reps: '8–12', rest: '90s' };
    }
  });
}

// ─── CARDIO ACTIVITIES (for the Cardio section on the workout logger) ──
// fields lists which inputs to render, in order. Units: distance is km for Bike, meters for Rower/Ski Erg.
const CARDIO_ACTIVITIES = {
  'Skipping':  { fields: ['duration'] },
  'HIIT':      { fields: ['duration'], presets: [5, 10, 15] },
  'Bike':      { fields: ['duration', 'distance'], distanceLabel: 'Distance (km)' },
  'Rower':     { fields: ['duration', 'distance'], distanceLabel: 'Distance (m)' },
  'Ski Erg':   { fields: ['duration', 'distance'], distanceLabel: 'Distance (m)' },
  'Stepper':   { fields: ['duration', 'floors'] },
  'Treadmill': { fields: ['duration', 'incline', 'speed'] }
};
// The 'Stepper' key is the DB/lookup value (already stored on existing cardio_logs rows) — only the
// user-facing label changes here, so old rows keep matching CARDIO_ACTIVITIES and stay editable.
const CARDIO_DISPLAY_NAMES = { 'Stepper': 'Stairmaster' };
function cardioDisplayName(activity) { return CARDIO_DISPLAY_NAMES[activity] || activity; }
let cardioEntryCounter = 0;

let selectedEnergy = 0;
let selectedSession = null;
let selectedProgramme = null;
let previousSets = {};
let selectedVariations = {};
// Names removed via the ✕ button on a fixed session's live logger (one-off, today-only swap —
// never written back to the template). Reset whenever a new session is selected.
let removedSessionExercises = [];
// Explicit membership lists — each entry is one superset group (2+ exercise names, in the order the
// user paired them). NOT derived from the logger's exercise order: you superset whatever you actually
// picked up, which is rarely the block underneath. Reset on every new session.
let supersetGroups = [];
// The exercise order with no supersets applied. What's displayed is derived from this plus the groups
// (displayExerciseOrder), so unpairing always drops an exercise back where it started.
let supersetBaseOrder = [];
// Only write superset_group back to the DB on save if this workout ever had a link toggled/restored
// — otherwise every ordinary save would fire pointless PATCHes over every set.
let supersetsTouched = false;
let editSelectedVariations = {};
let currentPage = 'home';
let currentWorkoutId = null;
let currentWorkoutHasSets = false;
let lastCompletedExercise = null;
// True while a Mark Done save is mid-flight. Blocks a second tap from starting a concurrent
// delete-then-reinsert of the same rows — see the comment in completeExercise().
let completeInFlight = false;

// ─── HTML ESCAPING ────────────────────────────────────────
// This app renders everything by interpolating strings into innerHTML, so an exercise name, a
// session name or a check-in note is untrusted input: a row containing `<img src=x onerror=…>`
// would execute here on the next load.
//
// When this was written (11 Aug) the database was writable by anyone holding the publishable key,
// which made it a live stored-XSS chain rather than self-XSS. That hole is closed as of 13 Aug
// (see the auth section below) — but none of this comes out. Escaping and access control are
// different defences: one stops data executing, the other stops it being written. The app needs
// both, and the escaping is what still holds if a second user is ever added.
//
// The rule: escape at the point a value is interpolated into HTML, not inside the helper that
// produced it — helpers like setValueLabel() are also used with .textContent, where escaping would
// print visible &amp;. Values the app itself computed (numbers, literal class names) don't need it.
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// For a value going into a JS string literal inside an HTML attribute — onclick="fn('${name}')",
// which is the pattern used all over this file. TWO decoders run before the JS parser sees it: the
// HTML attribute is entity-decoded first, then the JS string literal is parsed. So backslash-escape
// the JS metacharacters first and entity-escape second, or esc()'s `&#39;` would decode back into a
// bare quote and close the string. Note esc() must escape & first (it does) so a name containing
// the literal text `&#39;` survives as text rather than decoding into a quote.
function jsAttr(v) {
  return esc(String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n'));
}

// ─── SUPABASE ─────────────────────────────────────────────
// Every request carries the logged-in user's JWT, not the publishable key. Since 13 Aug 2026 the
// key on its own opens nothing: `anon` has no grant on any table, and every policy is
// `user_id = auth.uid()` for the `authenticated` role only. See the auth section below.
function sbHeaders(token, method) {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=minimal' : ''
  };
}

// A dead connection makes fetch() *throw* rather than return a failed response, so every network
// error has to be caught before the .ok checks below are ever reached. netFail() is the single place
// that decides what the user is told. It throttles because one screen fires several requests — an
// offline History load would otherwise re-fire the same toast four times in a row.
let lastNetToastAt = 0;
function netFail(what, path, err) {
  console.error(`sb() ${what} network failure: ${path}`, err);
  const now = Date.now();
  if (now - lastNetToastAt < 4000) return;
  lastNetToastAt = now;
  showToast(what === 'GET' ? "No signal — couldn't load" : 'No signal — NOT saved', 'error');
}

// `opts.quiet` suppresses the generic failure toast below — pass it when the caller reports the
// failure itself with a more specific message, or when the request is background housekeeping the
// user shouldn't be told about. It suppresses the offline toast too: a write the user never asked
// for shouldn't announce that the gym has no signal.
async function sb(path, method = 'GET', body = null, { quiet = false, upsert = false } = {}) {
  const opts = { method };
  if (body) opts.body = JSON.stringify(body);

  const token = await validAccessToken();
  if (!token) {
    // No usable session at all. Don't fire a request that can only 401 — sign out cleanly instead.
    forceLogout('Session expired — log in again');
    return method === 'GET' ? [] : new Response(null, { status: 401 });
  }

  opts.headers = sbHeaders(token, method);
  // `upsert: true` turns a POST into PostgREST's insert-or-update. The caller still has to name the
  // constraint in the path (?on_conflict=…) — this only adds the half that lives in a header, which
  // is why it isn't inferred. Added to sbHeaders' output here rather than to sbHeaders itself so its
  // signature stays what the auth test harness pulls out of this file.
  if (upsert && method === 'POST') opts.headers.Prefer = 'return=minimal,resolution=merge-duplicates';
  let res;
  try {
    res = await netFetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);

    // A 401 here means PostgREST rejected the JWT even though we thought it was live — clock skew,
    // a password change on another device, or a token revoked server-side. Refresh once and retry
    // before treating it as a real failure, so a token expiring mid-save doesn't lose the save.
    if (res.status === 401) {
      const fresh = await refreshSession(true);
      if (fresh) {
        opts.headers = sbHeaders(fresh, method);
        res = await netFetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
      }
    }
  } catch (e) {
    // Offline, DNS gone, Supabase unreachable, request aborted. Return the same shapes a failed
    // request returns so no caller has to know the difference: [] for a read, a not-ok Response for
    // a write. 503 rather than 0 because Response rejects a status outside 200–599.
    if (!quiet) netFail(method, path, e);
    return method === 'GET' ? [] : new Response(null, { status: 503 });
  }

  if (method === 'GET') {
    if (!res.ok) {
      // A failed read used to return [] in silence, which renders as "you have no data" — the
      // read-side twin of the write bug that lost the July cardio. The [] stays (callers do
      // (rows || []).forEach and must not throw), but it is no longer silent.
      console.error(`sb() GET failed (${res.status}): ${path}`);
      if (!quiet) showToast(`Couldn't load (${res.status})`, 'error');
      return [];
    }
    return res.json();
  }
  // A failed write used to return silently, and the caller would carry on and say "Saved!". That is
  // exactly how two days of cardio data were lost in July — the POST 400'd, nothing checked it, and
  // the toast said success. Every write now surfaces its own failure here, so a caller that forgets
  // to check can no longer report a false success.
  if (!res.ok && !quiet) {
    console.error(`sb() ${method} failed (${res.status}): ${path}`);
    showToast(`Save failed (${res.status}) — not saved`, 'error');
  }
  return res;
}

// Needs the inserted row back (for its id), so it can't use sb()'s `return=minimal` POST — but it
// still goes through the same token + 401-retry path rather than hand-rolling headers.
async function createWorkoutRow(sessionId) {
  const body = JSON.stringify({ date: todayStr(), session_type: sessionId, notes: '' });
  const send = (token) => netFetch(`${SUPABASE_URL}/rest/v1/workouts`, {
    method: 'POST',
    headers: { ...sbHeaders(token, 'POST'), 'Prefer': 'return=representation' },
    body
  });

  const token = await validAccessToken();
  if (!token) { forceLogout('Session expired — log in again'); return null; }

  let res;
  try {
    res = await send(token);
    if (res.status === 401) {
      const fresh = await refreshSession(true);
      if (!fresh) return null;
      res = await send(fresh);
    }
  } catch (e) {
    // Offline. Before this catch existed the exception escaped the whole call chain, so tapping a
    // session tile in a basement gym did nothing at all — no error, no session, no explanation.
    // Deliberately silent here: every caller that matters already toasts on a null return, and
    // toasting twice would just overwrite the better message with a worse one.
    console.error('createWorkoutRow network failure', e);
    return null;
  }
  const rows = await res.json();
  return rows[0]?.id ?? null;
}

// ─── AUTH ─────────────────────────────────────────────────
// Supabase Auth (GoTrue), talked to over plain fetch — no SDK, because this app has no build step.
//
// What this replaced, 13 Aug 2026: the login screen used to check a client-side SHA-256 of the
// password against an app_user table, then set `sessionStorage.del_auth = '1'`. That flag WAS the
// security model — anyone could type it into devtools — and it protected nothing anyway, because
// every table was readable and writable by the publishable key alone. Now the password is checked
// by GoTrue, the app holds a short-lived JWT, and the JWT is the only thing the database accepts.
//
// Tokens live in localStorage, not sessionStorage: the access token expires in an hour and is
// refreshed automatically, so a session that survives the phone killing the PWA's web view is the
// point. sessionStorage would have meant logging in again every time iOS discarded the app.
const AUTH_STORE = 'dlog_session';
let authSession = null;      // { access_token, refresh_token, expires_at (ms), email }
let refreshInFlight = null;  // dedupes concurrent refreshes — initApp fires many requests at once

function storeSession(tok) {
  authSession = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    // Trust expires_in over the server's expires_at: it's a duration, so a phone with a wrong
    // clock still refreshes on time relative to its own Date.now().
    expires_at: Date.now() + (tok.expires_in ?? 3600) * 1000,
    email: tok.user?.email ?? authSession?.email ?? ''
  };
  localStorage.setItem(AUTH_STORE, JSON.stringify(authSession));
  return authSession;
}

function loadStoredSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORE);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s?.refresh_token ? s : null;
  } catch (e) { return null; }
}

function clearSession() {
  authSession = null;
  localStorage.removeItem(AUTH_STORE);
}

// Returns a token that should be accepted, refreshing first if it's close to expiry.
// The 60s margin covers a request that's in flight as the clock ticks over.
async function validAccessToken() {
  if (!authSession) authSession = loadStoredSession();
  if (!authSession) return null;
  if (Date.now() < authSession.expires_at - 60000) return authSession.access_token;
  return refreshSession();
}

// The offline case is the one that matters here: in a gym basement with no signal this throws, and
// the right answer is to hand back the token we already have and let the actual request fail with a
// network error. Being bounced to a login screen you have no connection to reach is far worse than
// a failed save you can retry. Only a 4xx — a genuine "this refresh token is dead" from GoTrue —
// ends the session.
async function refreshSession(force = false) {
  if (!authSession?.refresh_token) return null;
  if (!force && Date.now() < authSession.expires_at - 60000) return authSession.access_token;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await netFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: authSession.refresh_token })
      });
      if (res.ok) return storeSession(await res.json()).access_token;
      if (res.status >= 400 && res.status < 500) {
        forceLogout('Session expired — log in again');
        return null;
      }
      return authSession?.access_token ?? null;   // 5xx: Supabase blip, keep going
    } catch (e) {
      return authSession?.access_token ?? null;   // offline
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// A tap on Get In had no visible effect of any kind until it was completely finished, and three
// separate paths ended in nothing happening at all: an empty field returned silently, a hung
// connection never resolved, and enterApp() could stall on a frame that never came. All three look
// identical from the outside — "1password populates the two fields and the get in button wont work"
// (Del, 20 Aug 2026, locked out on the phone for the third time).
//
// The hung connection is the one that explains why force-quitting the app "fixed" it every time.
// fetch() had no timeout, and an iOS PWA resumed after being backgrounded will happily hand a stale
// socket to the next request and sit on it indefinitely. Nothing about the session was ever wrong;
// a new process just got a new network stack.
const LOGIN_TIMEOUT_MS = 12000;

// The login screen's black box. Always shows the running build; shows the last thing handleLogin()
// did on top of it. Deliberately terse and monospaced - it gets read off a phone at arm's length.
let loginStatus = null;

function renderLoginDiag() {
  const el = document.getElementById('login-diag');
  if (!el) return;
  const stale = serverBuild && serverBuild !== APP_BUILD;
  const parts = ['build ' + APP_BUILD];
  if (stale) parts.push('STALE · server has ' + serverBuild);
  if (loginStatus) parts.push(loginStatus.text);
  el.textContent = parts.join('  ·  ');
  el.classList.toggle('warn', !!stale || !!(loginStatus && loginStatus.warn));
}

function loginStep(text, warn = false) {
  loginStatus = { text, warn };
  renderLoginDiag();
}

async function handleLogin() {
  loginStep('tap');
  const email = document.getElementById('login-email').value.trim();
  const pw = document.getElementById('login-password').value;
  const err = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  const fail = msg => { err.textContent = msg; err.style.display = 'block'; };

  // Never a silent return. If the fields look full and this fires anyway, that is worth seeing —
  // it means the password manager filled something the page cannot read.
  // Lengths, not contents. Enough to tell "the manager filled nothing the page can read" apart
  // from "the manager filled something", which is the whole question, without ever putting a
  // password on screen.
  if (!email || !pw) { fail('Enter your email and password'); loginStep('empty · email ' + email.length + ' · pw ' + pw.length, true); return; }
  // A second tap must not start a second token request. This was the last silent return left in
  // the function, and from the outside it is indistinguishable from a dead button - so it says so.
  if (btn && btn.disabled) { loginStep('already signing in - wait'); return; }

  err.style.display = 'none';
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

  // AbortController rather than a bare timer: aborting tears the dead connection down, so tapping
  // again gets a fresh socket instead of queueing behind the one that is already hanging.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOGIN_TIMEOUT_MS);
  loginStep('sending · email ' + email.length + ' · pw ' + pw.length);

  let res;
  try {
    // Routed through netFetch for one reason: so that grepping this file for a bare fetch( finds
    // nothing. Its own signal is set, so netFetch passes it through and LOGIN_TIMEOUT_MS still owns
    // the deadline here — this call has a specific sentence to show when it expires.
    res = await netFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pw }),
      signal: ctrl.signal
    });
  } catch (e) {
    // Worth telling apart from a wrong password — otherwise a dead connection reads as
    // "I've forgotten my own password" and you retype it five times.
    fail(e && e.name === 'AbortError'
      ? 'The server did not answer — tap Get In again'
      : "Can't reach the server — check your connection");
    loginStep(e && e.name === 'AbortError'
      ? 'aborted after ' + (LOGIN_TIMEOUT_MS / 1000) + 's'
      : 'network: ' + ((e && e.name) || 'unknown'), true);
    return;
  } finally {
    clearTimeout(timer);
    if (btn) { btn.disabled = false; btn.textContent = 'Get In'; }
  }

  if (!res.ok) {
    fail(res.status === 400 ? 'Wrong email or password' : `Login failed (${res.status})`);
    loginStep('http ' + res.status, true);
    return;
  }

  // Past this line the token is good and the login screen is about to be torn down - so anything
  // that throws in here left Del looking at a half-built app with no login screen and no message,
  // which from the outside reads exactly like "the button did nothing". Put the login screen back
  // and say what broke instead.
  try {
    loginStep('token ok · opening');
    storeSession(await res.json());
    err.style.display = 'none';
    document.getElementById('login-password').value = '';
    sessionStorage.setItem('del_page', 'home');
    await enterApp('home');
  } catch (e) {
    showLoginScreen('Signed in, but the app failed to open');
    loginStep('open failed: ' + ((e && e.message) || e), true);
  }
}

// One animation frame, or 60ms, whichever lands first. requestAnimationFrame does NOT fire in a
// backgrounded webview, and enterApp() awaited two of them before hiding the login screen — so a
// PWA resumed mid-login could sit there with a valid session behind a login card that never went
// away. The wait is a nicety (it stops the card flashing over the app as the scroll lock releases),
// so it must never be something the app can hang on.
function nextFrame() {
  return new Promise(resolve => {
    let settled = false;
    const fire = () => { if (!settled) { settled = true; resolve(); } };
    requestAnimationFrame(fire);
    setTimeout(fire, 60);
  });
}

// Shared by a fresh login and by restoring a stored session on load.
async function enterApp(page = 'home') {
  document.documentElement.classList.remove('login-active');
  window.scrollTo(0, 0);
  await nextFrame();
  await nextFrame();
  document.getElementById('login-screen').style.display = 'none';
  initApp(page);
}


function showLoginScreen(message) {
  window.scrollTo(0, 0);
  // A token can expire with the onboarding form open. The login screen sits in front of it either
  // way (z-index 999 against 900), but leaving it mounted means the NEXT person to log in on this
  // phone lands on somebody else's half-answered form the moment the login screen hides.
  closeOnboarding();
  // It can expire with a password reset half-finished too, and that one leaves a code box and a
  // typed-out new password on screen for whoever picks the phone up next. Both go back to the
  // sign-in panel. This runs before the message because showLoginPanel() clears the error line.
  resetRecoveryState();
  showLoginPanel('signin');
  const err = document.getElementById('login-error');
  if (message) { err.textContent = message; err.style.display = 'block'; }
  else { err.style.display = 'none'; }
  document.documentElement.classList.add('login-active');
  document.getElementById('login-screen').style.display = 'flex';
}

// Deliberately keeps the workout draft. This fires on token expiry as well as a real logout, and
// binning a half-logged session because a JWT lapsed would be the same class of data loss the app
// has already been burned by. handleLogout() clears it explicitly; expiry doesn't.
function forceLogout(message) {
  clearSession();
  sessionStorage.clear();
  showLoginScreen(message);
}

function handleLogout() {
  const token = authSession?.access_token;
  // Revokes the refresh token server-side. Fire-and-forget: a failure here must not stop the
  // client-side logout, and the local tokens are gone either way.
  //
  // `scope=local` is deliberate and must not be dropped. GoTrue defaults to scope=global, which
  // revokes EVERY session on the account — so logging out in the browser on the PC would silently
  // sign the phone out too, and that would be discovered mid-session in the gym. Logout means
  // "log out this device". There is no sign-out-everywhere button; if a device is ever lost, revoke
  // the sessions from the PC (see CODEBASE.md → Auth).
  if (token) {
    netFetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` }
    }).catch(() => {});
  }
  clearSession();
  sessionStorage.clear();
  localStorage.removeItem('workout_draft');  // Clear any mid-workout draft so next login starts fresh
  showLoginScreen();
}

// ─── FORGOTTEN PASSWORD ───────────────────────────────────
// 24 August 2026. Until today there was no way back into an account whose password had been lost.
// The only recovery was Del opening the Supabase dashboard and setting a new one by hand, which is
// fine for an app with one user who owns the project and useless the moment anybody else has an
// account. That is why this is built *before* the beta rather than after the first lockout.
//
// **A numeric code typed into D-LOG, not a link in an email.** The link is the default Supabase
// flow and it was turned down deliberately, on both of Del's stated axes:
//
//   - *Fewest mountains to the store.* A link has to land somewhere. In a browser that is a
//     redirect URL to allow-list; in a store-shipped app it is a universal link / app link, which
//     means an associated-domains entitlement, a domain-association file served from the host, and
//     a whole class of "it opened Safari instead of the app" bugs to answer for. A code that is
//     typed in needs **no URL configuration at all** — not now, not when this ships as an app.
//   - *Security.* Both are one-time tokens issued and checked by GoTrue, so neither is weaker at
//     the protocol. In practice the link is worse: corporate mail scanners follow links to check
//     them and burn the one-time token before the human ever taps it, and the token ends up in
//     browser history and in the referrer. Neither happens to a number you read and type.
//
// What this adds on top of GoTrue:
//
//   1. **The email is never confirmed or denied.** Sending says the same sentence whether or not
//      the address has an account, and a bad code and an unknown address fail identically. The
//      login screen must not be a way to find out who has an account here.
//   2. **A verified code does not sign anybody in.** GoTrue answers a good code with a full
//      session. That session is held in memory only and is never written to localStorage until the
//      new password has actually been set — walk away half-way through and the device keeps
//      nothing, and a code shoulder-surfed off a notification buys no access on its own.
//   3. **Every other session on the account is revoked** the moment the password changes. That is
//      the point of a reset: whoever caused it should be signed out everywhere, not just here.
//   4. **Five wrong codes ends it**, so the code cannot be worked through from the login screen.
//   5. **One send a minute**, counted down on the button.
//   6. **The code length is whatever the dashboard says.** See RECOVERY_CODE_MIN / _MAX below.
//
// Requires the Supabase "Reset Password" email template to send `{{ .Token }}` — the stock one only
// contains a link, and a link cannot be typed in. The template to paste is kept in the repo at
// supabase/templates/recovery.html.
const RECOVERY_MAX_ATTEMPTS = 5;
const RECOVERY_RESEND_MS = 60000;
// **The length of the code is a dashboard setting, not ours.** Authentication → Sign In / Providers
// → Email → "Email OTP length" was found sitting on 8 on 24 Aug, while every string in this flow and
// a `maxlength="6"` on the input said six — so the code could not physically be typed in. Rather
// than pin the app to whatever the dashboard says today, accept the range GoTrue can be configured
// to and let the digits speak for themselves. Nothing in the UI states a number any more.
const RECOVERY_CODE_MIN = 6;
const RECOVERY_CODE_MAX = 10;

// The session bought by a verified code. Memory only, never localStorage — see (2) above.
let recoverySession = null;
let recoveryEmail = '';
let recoveryAttempts = 0;
let recoveryResendAt = 0;
let recoveryTimer = null;

// The login screen is three panels inside one card — sign in, ask for a code, type the code — and
// they share a single #login-error and #login-diag. Every message this screen can produce comes out
// in the same two places no matter which panel is up, which is the whole reason the diag readout
// was worth keeping: it stays the one instrument pointed at getting into the app.
function showLoginPanel(which) {
  const err = document.getElementById('login-error');
  if (err) err.style.display = 'none';
  const panels = [['login-form', 'signin'], ['reset-request', 'request'], ['reset-confirm', 'confirm']];
  for (const [id, name] of panels) {
    const el = document.getElementById(id);
    if (el) el.style.display = which === name ? '' : 'none';
  }
}

function loginFail(msg) {
  const err = document.getElementById('login-error');
  if (!err) return;
  err.textContent = msg;
  err.style.display = 'block';
}

// Leaves nothing behind: not the code, not the typed password, not the in-memory session, and not
// the resend interval. Called on every way out of the flow, including a session expiring somewhere
// else in the app and putting the login screen back up.
function resetRecoveryState() {
  recoverySession = null;
  recoveryEmail = '';
  recoveryAttempts = 0;
  recoveryResendAt = 0;
  if (recoveryTimer) { clearInterval(recoveryTimer); recoveryTimer = null; }
  for (const id of ['reset-email', 'reset-code', 'reset-new', 'reset-confirm-pw', 'reset-sent-to']) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  }
}

function showForgotPassword() {
  resetRecoveryState();
  // He has almost always typed his email into the sign-in box already — failing to get in is how
  // anyone arrives here. Carry it over rather than asking for it twice.
  const typed = (document.getElementById('login-email')?.value || '').trim();
  const box = document.getElementById('reset-email');
  if (box) box.value = typed;
  showLoginPanel('request');
  loginStep('reset · email');
  if (box && box.focus) box.focus();
}

function backToSignIn() {
  resetRecoveryState();
  showLoginPanel('signin');
  loginStep('sign in');
}

// The button counts its own cooldown down. A dead "Send a new code" button with no explanation is
// the same bug as a dead Get In button — see login.test.js — so it says how long it has left.
function startResendCooldown() {
  recoveryResendAt = Date.now() + RECOVERY_RESEND_MS;
  if (recoveryTimer) clearInterval(recoveryTimer);
  const paint = () => {
    const btn = document.getElementById('reset-resend');
    if (!btn) return;
    const left = Math.ceil((recoveryResendAt - Date.now()) / 1000);
    if (left > 0) {
      btn.textContent = 'Send a new code (' + left + 's)';
      btn.disabled = true;
      return;
    }
    btn.textContent = 'Send a new code';
    btn.disabled = false;
    if (recoveryTimer) { clearInterval(recoveryTimer); recoveryTimer = null; }
  };
  paint();
  recoveryTimer = setInterval(paint, 1000);
}

async function sendRecoveryCode() {
  const email = (document.getElementById('reset-email')?.value || '').trim();
  const btn = document.getElementById('reset-send-btn');
  const resend = document.getElementById('reset-resend');
  // Both buttons, because both of them send. "Send a new code" sits on the panel after this one and
  // reaches here through resendRecoveryCode(), and driving only the first would leave that tap with
  // no feedback at all until the request came back — the dead-button symptom again.
  const busy = on => {
    if (btn) { btn.disabled = on; btn.textContent = on ? 'Sending…' : 'Send me a code'; }
    if (resend) { resend.disabled = on; resend.textContent = on ? 'Sending…' : 'Send a new code'; }
  };

  // Never a silent return on this screen. Same rule as handleLogin(): if a tap does nothing and
  // says nothing, it is indistinguishable from a dead button, and that cost eight rounds once.
  if (!email || !email.includes('@')) {
    loginFail('Enter the email address you sign in with');
    loginStep('reset · no email', true);
    return;
  }
  if (btn && btn.disabled) { loginStep('reset · already sending - wait'); return; }
  if (Date.now() < recoveryResendAt) {
    loginFail('Wait ' + Math.ceil((recoveryResendAt - Date.now()) / 1000) + 's before asking for another code');
    return;
  }

  busy(true);
  loginStep('reset · sending');

  let res;
  try {
    res = await netFetch(SUPABASE_URL + '/auth/v1/recover', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
  } catch (e) {
    loginFail("Can't reach the server — check your connection");
    loginStep('reset · network: ' + ((e && e.name) || 'unknown'), true);
    return;
  } finally {
    busy(false);
  }

  // 429 is the one status worth telling the truth about. GoTrue caps recovery emails per hour, and
  // "no email arrived" with no explanation sends you to the spam folder for ten minutes over
  // something that is not your fault and not fixable by trying again immediately.
  if (res.status === 429) {
    loginFail('Too many requests — wait a few minutes and try again');
    loginStep('reset · http 429', true);
    // Start the cooldown anyway. Being rate-limited and then handed an enabled button is an
    // invitation to tap straight into another 429.
    startResendCooldown();
    return;
  }

  // Everything else lands here, INCLUDING an address with no account. Do not branch on res.ok:
  // the identical outcome for a real and an unknown address is the anti-enumeration property, and
  // a helpful "no account with that email" would hand it straight back.
  recoveryEmail = email;
  recoveryAttempts = 0;
  const sentTo = document.getElementById('reset-sent-to');
  if (sentTo) sentTo.value = email;
  showLoginPanel('confirm');
  startResendCooldown();
  loginStep('reset · code sent · http ' + res.status);
  const codeBox = document.getElementById('reset-code');
  if (codeBox && codeBox.focus) codeBox.focus();
}

function resendRecoveryCode() {
  const box = document.getElementById('reset-email');
  if (box) box.value = recoveryEmail;
  sendRecoveryCode();
}

async function completePasswordReset() {
  const codeEl = document.getElementById('reset-code');
  // Digits only, so a code pasted out of the email as "148 209" is the same code as "148209".
  const code = ((codeEl && codeEl.value) || '').replace(/\D/g, '');
  const pw = document.getElementById('reset-new')?.value || '';
  const again = document.getElementById('reset-confirm-pw')?.value || '';
  const btn = document.getElementById('reset-save-btn');
  const release = () => { if (btn) { btn.disabled = false; btn.textContent = 'Set password'; } };

  if (recoveryAttempts >= RECOVERY_MAX_ATTEMPTS) {
    loginFail('Too many wrong codes — ask for a new one');
    loginStep('reset · attempts spent', true);
    return;
  }
  // Every message names the field it means — the same lesson savePassword() carries: an empty
  // password box falling through to the length check reads as a complaint about the box above it.
  if (code.length < RECOVERY_CODE_MIN || code.length > RECOVERY_CODE_MAX) return loginFail('The code is the digits from the email');
  if (!pw) return loginFail('Enter a new password');
  if (pw.length < 8) return loginFail('Your new password needs at least 8 characters');
  if (!again) return loginFail('Type your new password again to confirm it');
  if (pw !== again) return loginFail("Those don't match");
  if (pw.toLowerCase() === recoveryEmail.toLowerCase()) return loginFail("Don't use your email address as your password");
  if (btn && btn.disabled) { loginStep('reset · already saving - wait'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Setting…'; }
  loginStep('reset · verifying');

  let res;
  try {
    res = await netFetch(SUPABASE_URL + '/auth/v1/verify', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'recovery', email: recoveryEmail, token: code })
    });
  } catch (e) {
    loginFail("Can't reach the server — check your connection");
    loginStep('reset · network: ' + ((e && e.name) || 'unknown'), true);
    release();
    return;
  }

  if (!res.ok) {
    recoveryAttempts++;
    const left = RECOVERY_MAX_ATTEMPTS - recoveryAttempts;
    // One sentence for a wrong code, an expired code, and an address that has no account at all.
    // Same reason as the send step: this screen does not answer "is this person a member here".
    loginFail(left > 0
      ? 'That code is wrong or has expired — ' + left + (left === 1 ? ' try left' : ' tries left')
      : 'Too many wrong codes — ask for a new one');
    loginStep('reset · verify http ' + res.status, true);
    release();
    return;
  }

  let session = null;
  try { session = await res.json(); } catch (e) { session = null; }
  const token = session && session.access_token;
  if (!token) {
    loginFail('That code was accepted but the server sent nothing back — try again');
    loginStep('reset · verify ok, no token', true);
    release();
    return;
  }
  // In memory, and only in memory. Nothing has been written to this device yet and nothing will be
  // until the password below actually changes.
  recoverySession = session;

  let put;
  try {
    put = await netFetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'PUT',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
  } catch (e) {
    recoverySession = null;
    loginFail("Can't reach the server — check your connection");
    loginStep('reset · set network: ' + ((e && e.name) || 'unknown'), true);
    release();
    return;
  }

  if (!put.ok) {
    recoverySession = null;
    let detail = '';
    try { detail = (await put.json())?.msg || ''; } catch (e) {}
    loginFail(detail || "Couldn't set the password (" + put.status + ')');
    loginStep('reset · set http ' + put.status, true);
    release();
    return;
  }

  // Past this line the reset has happened, so the session the code bought is a legitimate one and
  // is worth keeping — he proved he holds the mailbox and then chose the password. Anything that
  // throws from here leaves him looking at a torn-down login screen with no message, so it puts
  // the screen back and says what broke, exactly as handleLogin() does.
  try {
    storeSession(session);
    revokeOtherSessions(token);
    resetRecoveryState();
    showLoginPanel('signin');
    const pwBox = document.getElementById('login-password');
    if (pwBox) pwBox.value = '';
    sessionStorage.setItem('del_page', 'home');
    loginStep('reset · done · opening');
    await enterApp('home');
    showToast('Password changed — you are signed in', 'success');
  } catch (e) {
    showLoginScreen('Password changed — sign in with your new one');
    loginStep('reset · open failed: ' + ((e && e.message) || e), true);
  } finally {
    release();
  }
}

// The reset is only half a reset if whoever knew the old password stays signed in on their own
// device. `scope=others` revokes every refresh token on the account except the one just issued
// here — the exact opposite of handleLogout()'s `scope=local`, and for the opposite reason.
// Fire-and-forget: it runs after the password has already changed, so a failure here must never
// stand between Del and his app.
function revokeOtherSessions(token) {
  netFetch(SUPABASE_URL + '/auth/v1/logout?scope=others', {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token }
  }).catch(() => {});
}

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleLogin();
});

// No keydown handlers for the two reset panels: each is a real <form> with a submit button, so Enter
// already submits it. Binding one on top of that would run the handler twice on a single Enter.

window.addEventListener('load', async () => {
  renderLoginDiag();

  authSession = loadStoredSession();
  if (!authSession) return;

  // Del's words for the old behaviour here were "i cant do anything". He was right, and the screen
  // was lying to him: a stored session was being restored, the request had died, and the login card
  // sat there looking like a login card with a dead button. Nothing said a word. Say the word.
  loginStep('restoring your session');

  // Refreshes if stale. Offline — and now, a timed-out request — this returns the stored token
  // rather than logging out, so the app still opens on a dead connection. It just can't reach the
  // database, same as before. What it must never do again is neither.
  const token = await validAccessToken();
  if (!token) { loginStep('session expired — sign in', true); return; }
  loginStep('session ok · opening');
  await enterApp(sessionStorage.getItem('del_page') || 'home');
});

// ─── CHANGE PASSWORD ──────────────────────────────────────
// Exists so the temporary password the account was created with can be replaced without going
// through a database migration, and so a password can be rotated at any point from the phone.
function openPasswordModal() {
  document.getElementById('pw-current').value = '';
  document.getElementById('pw-new').value = '';
  document.getElementById('pw-confirm').value = '';
  const err = document.getElementById('pw-error');
  err.textContent = '';
  err.style.display = 'none';
  document.getElementById('password-modal').style.display = 'block';
}

function closePasswordModal() {
  document.getElementById('password-modal').style.display = 'none';
}

// Proves the person holding the phone knows the current password, via the same password grant login
// uses. Returns true, or the message to show. The token it hands back is deliberately thrown away —
// the live session stays as it is, so a failed check can't log you out of your own account.
async function verifyCurrentPassword(current) {
  const email = authSession?.email;
  if (!email) return 'Session expired — log out and back in';
  let res;
  try {
    res = await netFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: current })
    });
  } catch (e) {
    return "Can't reach the server";
  }
  if (res.status === 400) return 'Current password is wrong';
  if (!res.ok) return `Couldn't verify that (${res.status})`;
  return true;
}

async function savePassword() {
  const current = document.getElementById('pw-current').value;
  const pw = document.getElementById('pw-new').value;
  const confirm = document.getElementById('pw-confirm').value;
  const err = document.getElementById('pw-error');
  const fail = (msg) => { err.textContent = msg; err.style.display = 'block'; };

  // Every message names the field it means. An empty new-password box used to fall straight through
  // to the length check and read as "Use at least 8 characters", which looks like a complaint about
  // the current-password box you just filled in.
  // GoTrue's own minimum is 6; 8 is the floor worth having on an account holding a year of data.
  if (!current) return fail('Enter your current password');
  if (!pw) return fail('Enter a new password');
  if (pw.length < 8) return fail('Your new password needs at least 8 characters');
  if (!confirm) return fail('Type your new password again to confirm it');
  if (pw !== confirm) return fail("Those don't match");
  if (pw === current) return fail("That's the password you already have");

  const token = await validAccessToken();
  if (!token) return fail('Session expired — log out and back in');

  // Re-authenticate before changing anything. The app deliberately stays logged in across restarts,
  // so without this an unlocked phone left on the table could set a new password in three taps and
  // take the account outright — the JWT alone was the whole authorisation.
  const reauth = await verifyCurrentPassword(current);
  if (reauth !== true) return fail(reauth);

  let res;
  try {
    res = await netFetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
  } catch (e) { return fail("Can't reach the server"); }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.msg || ''; } catch (e) {}
    return fail(detail || `Couldn't change it (${res.status})`);
  }

  closePasswordModal();
  showToast('Password changed', 'success');
}

// ─── DATA EXPORT ──────────────────────────────────────────
// Every row this account owns, as one JSON file, from the phone. Two jobs: you should be able to get
// your training history *out* of an app you've trusted it to, and it doubles as a backup you can take
// yourself — no PC, no scheduled task, no stored credentials. It does not replace `tools/backup.js`
// (that one runs unattended, which is the point of it), but it means a backup is never more than a
// tap away.
//
// **A new table has to be added here or it silently isn't in the export.** tools/backup.js used to
// carry a matching list and now enumerates the schema instead, so it needs nothing — this is the
// only one of the two backup routes that can still fall behind. A test pins it against the schema.
const EXPORT_TABLES = [
  'workouts', 'workout_sets', 'cardio_logs', 'conditioning_logs', 'daily_logs',
  'goals', 'profiles', 'custom_exercises', 'exercises', 'session_templates', 'session_exercises', 'quotes',
  // Nothing you'd miss if it were lost — one row saying when you last backed up. It's here because
  // "the export is every table" is a rule worth keeping absolute: the moment there's a judgement
  // call about which tables count, the list starts drifting, which is the exact failure this and
  // tools/backup.js are both built to prevent. It costs one line in the file.
  'app_meta',
];

// Tables that must not come back empty. An export that succeeds while empty is worse than no export
// at all — it looks like a backup, so it removes the reason to worry. Same rule as tools/backup.js,
// which exits non-zero for it.
const EXPORT_MUST_HAVE_ROWS = ['workouts', 'workout_sets', 'daily_logs'];

const EXPORT_PAGE = 1000;

// PostgREST caps a response (1000 rows by default) and workout_sets passed 798 in August 2025, so
// this is not hypothetical — an unpaged read would start silently truncating the most important
// table in the file. Ordered by id so the pages can't overlap or skip: without an ORDER BY, Postgres
// makes no promise about row order between two queries.
async function fetchAllRows(table) {
  const rows = [];
  for (let offset = 0; ; offset += EXPORT_PAGE) {
    const page = await sb(`${table}?select=*&order=id.asc&limit=${EXPORT_PAGE}&offset=${offset}`);
    if (!page || !page.length) return rows;
    rows.push(...page);
    if (page.length < EXPORT_PAGE) return rows;
  }
}

// Which of the must-have tables came back empty. Pure, so the "don't hand over an empty backup"
// rule is testable without a database.
function exportProblems(data) {
  return EXPORT_MUST_HAVE_ROWS.filter(t => !(data[t] || []).length);
}

function exportFilename(now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `d-log-export-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

// iOS first: the share sheet is how you get a file into Files/iCloud/email from an installed PWA,
// and a plain <a download> inside a standalone web app often does nothing visible. Falls back to the
// download link on desktop, and also if share() refuses — Safari can reject it when the user gesture
// has been "spent" by the awaits above, which is exactly what happens here.
// `charset=utf-8` is declared on both the File and the Blob. The bytes were always correct — the
// Blob constructor encodes strings as UTF-8 regardless — but without the declaration a viewer is
// free to guess, and Windows editors guess ANSI, which renders every smart quote in Del's notes as
// mojibake ("I’d" → "Iâ€™d"). Nothing would be wrong with the file; it would just *look* like the
// history had been corrupted, and this project has already lost an hour to exactly that panic.
async function deliverExport(json, filename) {
  const file = new File([json], filename, { type: 'application/json;charset=utf-8' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'D-LOG export' });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';   // user tapped away; not a failure
    }
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

async function exportAllData() {
  const btn = document.getElementById('export-btn');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Exporting…'; }
  try {
    const data = {};
    for (const table of EXPORT_TABLES) data[table] = await fetchAllRows(table);

    // sb() has already toasted whatever went wrong on a failed read; this is the second line of
    // defence, so a half-read export can never be handed over looking whole.
    const problems = exportProblems(data);
    if (problems.length) {
      showToast(`Export not saved — ${problems.join(', ')} came back empty`, 'error');
      return;
    }

    const counts = Object.fromEntries(Object.entries(data).map(([t, r]) => [t, r.length]));
    const filename = exportFilename();
    const json = JSON.stringify({
      app: 'D-LOG',
      build: APP_BUILD,
      exported_at: new Date().toISOString(),
      account: authSession?.email || null,
      counts,
      data,
    }, null, 2);

    const how = await deliverExport(json, filename);
    if (how === 'cancelled') return;
    const backedUpAt = markBackupDone();
    renderBackupPrompt();
    // After the paint, and not awaited into the toast below: the file is already in his hands, so
    // publishing the fact to the other devices must not be able to delay or fail the export.
    pushBackupTimestamp(backedUpAt);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    showToast(`Exported ${total.toLocaleString()} rows`, 'success');
  } catch (e) {
    console.error('export failed', e);
    showToast('Export failed — try again', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Export my data'; }
  }
}

// ─── BACKUP REMINDER ──────────────────────────────────────
// The phone half of the backup answer. tools/backup.js only runs when the PC is on, so a fortnight
// away from it is a fortnight with the training history in exactly one place — a free-tier database
// with no automated backups. This is the part that doesn't depend on Del's PC being awake: Home says
// how long it's been and the line itself is the button.
//
// WHERE THE TIMESTAMP LIVES — changed 14 Aug 2026, and the history matters.
//
// It was localStorage only, on the reasoning that this is a per-device nag about a per-device action
// that must work with no network. Del exported on his phone on 13 Aug, opened the app in a PC browser
// the next day, and Home said "No backup yet" — correct by that design and wrong about the thing it
// actually claims, because what gets backed up is the database, not the device. A reminder that
// contradicts what you did yesterday is one you learn to ignore, so it was worse than none.
//
// Now BOTH, newest wins: localStorage stays as the offline-readable copy (so the nag still renders on
// gym Wi-Fi that can't reach Supabase — the trip furthest from the PC that runs the other half), and
// app_meta.last_backup_at carries it across devices. syncBackupState() reconciles the two on app open.
const BACKUP_STORE = 'dlog_last_backup';
const BACKUP_STALE_DAYS = 7;

// The account-wide value, filled by syncBackupState(). Null until the network answers, so the first
// paint falls back to localStorage rather than stalling or claiming there's no backup.
let remoteLastBackup = null;

// Whole calendar days between two dates, local time. Not `(b - a) / 86400000` on the raw timestamps:
// an export at 22:00 and a check at 09:00 nine days later is 8.5 raw days, and "8 days ago" for
// something that happened on the 9th preceding date is the wrong number to put in front of someone.
// Rounding after flattening to local midnight also absorbs the 23- and 25-hour days at the DST
// boundaries.
function daysSince(iso, now = new Date()) {
  const then = new Date(iso);
  if (!iso || isNaN(then.getTime())) return null;
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / 86400000);
}

// Pure, so the wording and the threshold are testable without a DOM. null = say nothing.
// A date in the future (a phone clock that's wrong, or one that was wrong when the export ran) reads
// as fresh rather than as a nag with a negative number in it.
function backupPromptText(lastIso, now = new Date()) {
  const days = daysSince(lastIso, now);
  if (days === null) return 'No backup yet — tap to save a copy of your training history';
  if (days < BACKUP_STALE_DAYS) return null;
  return `Last backup ${days} days ago — back up now`;
}

// Pure. Whichever of two ISO strings is later, ignoring anything unparseable — a device with a wrong
// clock, or a storage value someone has poked at, must not be able to silence the reminder forever.
function laterIso(a, b) {
  const ta = Date.parse(a || '');
  const tb = Date.parse(b || '');
  if (isNaN(ta)) return isNaN(tb) ? null : b;
  if (isNaN(tb)) return a;
  return ta >= tb ? a : b;
}

function readLocalBackup() {
  try { return localStorage.getItem(BACKUP_STORE); } catch (e) { return null; }
}

function writeLocalBackup(iso) {
  try { localStorage.setItem(BACKUP_STORE, iso); } catch (e) {}
}

// What every reader should ask for: this device's copy or the account's, whichever is more recent.
function lastBackupAt() {
  return laterIso(readLocalBackup(), remoteLastBackup);
}

// Only ever called after a file has actually been handed over — a cancelled share sheet or a failed
// read must not reset the clock, or the reminder starts lying about a backup that doesn't exist.
// localStorage first and synchronously: the nag must go away the instant the file lands, whether or
// not the database write gets through.
function markBackupDone(when = new Date()) {
  const iso = when.toISOString();
  writeLocalBackup(iso);
  remoteLastBackup = laterIso(remoteLastBackup, iso);
  return iso;
}

// Fire-and-forget, and quiet on purpose: the export itself succeeded, so a failed sync is not
// something to put a red toast in front of someone about. It self-heals on the next app open.
// merge-duplicates is safe here because `iso` was generated from now() — it is always the newest
// value anyone has.
async function pushBackupTimestamp(iso) {
  await sb('app_meta?on_conflict=user_id', 'POST',
    { last_backup_at: iso, updated_at: new Date().toISOString() },
    { quiet: true, upsert: true });
}

// Reconciles the two stores on app open. Runs after the first paint, so a slow or dead network only
// ever delays the cross-device half — the localStorage value has already rendered.
async function syncBackupState() {
  const rows = await sb('app_meta?select=last_backup_at&limit=1', 'GET', null, { quiet: true });
  const local = readLocalBackup();

  if (rows && rows.length) {
    // The row exists and we know its value, so both directions are safe.
    remoteLastBackup = rows[0].last_backup_at || null;
    const newest = laterIso(local, remoteLastBackup);
    if (newest && newest !== local) writeLocalBackup(newest);            // another device backed up
    if (newest && newest !== remoteLastBackup) await pushBackupTimestamp(newest);  // heal a lost write
  } else if (local) {
    // Empty array means EITHER no row yet OR a failed read — sb() returns [] for both, and guessing
    // wrong the second way would overwrite a newer remote value with this device's older one, which
    // is precisely the "lying about backups" failure this whole change exists to stop.
    // So: a plain INSERT, no on_conflict. If the read lied and a row is really there, the UNIQUE on
    // user_id rejects this with a 409 and nothing is clobbered. The constraint does the deciding.
    const res = await sb('app_meta', 'POST',
      { last_backup_at: local, updated_at: new Date().toISOString() }, { quiet: true });
    if (res && res.ok) remoteLastBackup = local;
  }

  renderBackupPrompt();
}

function renderBackupPrompt() {
  const el = document.getElementById('backup-nudge');
  if (!el) return;
  const text = backupPromptText(lastBackupAt());
  el.textContent = text || '';
  el.style.display = text ? 'flex' : 'none';
}

let lastTypedSet = null;
let pendingRest = {};

document.addEventListener('input', (e) => {
  const t = e.target;
  if (!t || !t.id || !t.id.startsWith('r-')) return;
  const rest = t.id.substring(2);
  const lastDash = rest.lastIndexOf('-');
  if (lastDash < 0) return;
  const exName = rest.substring(0, lastDash);
  const setNum = parseInt(rest.substring(lastDash + 1));
  if (!isNaN(setNum)) lastTypedSet = { exName, setNum };
});

// Auto-close any in-progress workouts older than 24 hours.
// These are orphans — user started a session then something interrupted them
// (phone died, app crashed, life got in the way) and they never hit Save Workout.
// Matches the 24hr draft expiry rule so the UX stays consistent across the app.
// Note: completed_at gets stamped with "now" for simplicity — accurate timestamps
// would require fetching each row first. Not worth the extra DB calls for an edge case.
async function autoCloseStaleWorkouts() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // quiet: background housekeeping that runs on every app start — a toast here would be noise, and
  // there's nothing the user could do about it anyway. It's logged to the console either way.
  await sb(`workouts?completed_at=is.null&created_at=lt.${cutoff}`, 'PATCH',
    { completed_at: new Date().toISOString() }, { quiet: true });
}

// ─── THE PERSON USING THE APP ─────────────────────────────
// Added 21 Aug 2026 — the first step of the second-user work (MULTIUSER-PLAN.md §5).
//
// Until now D-LOG had no concept of a person at all: getGreeting() returned the literal string
// 'Good morning, Del'. With one account that reads as a nice touch. With two it means the second
// person is greeted by the first person's name every time they open the app.
//
// One row per user — profiles.user_id IS the primary key — so this is a single object rather than
// a list, and there is no "which row is the current one" question to get wrong later. (goals is
// the counter-example: it has a surrogate id and has to be read `order=updated_at.desc&limit=1`.)
//
// A MISSING ROW IS NOT AN ERROR. It means an account nobody has onboarded yet, which is exactly
// what the onboarding form keys off. So everything here has to read as blank rather than broken:
// no name in the greeting, no toast, no console noise.
let PROFILE = { display_name: null, onboarded_at: null };

async function loadProfile() {
  // No ?user_id=eq.… filter: RLS scopes the table to the caller, and the primary key means there
  // is at most one row to come back. Sending the id would be decorative — the server ignores what
  // the client claims about whose data this is, which is the whole point of the policy.
  const rows = await sb('profiles?select=*&limit=1');
  if (!rows || !rows[0]) return;   // not onboarded — the greeting drops the name, see getGreeting()
  PROFILE = rows[0];
}

// ─── ONBOARDING ───────────────────────────────────────────
// 22 Aug 2026. Step 2 of the second-user work: the form that fills the profiles row in.
//
// LAYOUT C, picked by Del off the contact sheet (aa915156) after seeing all three. One question per
// screen, eight screens, thumb already on the keyboard. It is the slowest of the three and the most
// copy to write, and it was chosen for the reason it exists at all: the first person through it has
// never used a training app, and a single page of eleven fields is where that person stops.
//
// EVERY ANSWER EXCEPT THE NAME IS SKIPPABLE. Tap Next with the field blank and the column stays
// null — deliberate, and it matches the table, where display_name is the only NOT NULL. A form that
// will not let you past a question you cannot answer is how someone ends up typing a guess, and a
// fabricated height is worse than a blank one because nothing ever prompts you to correct a number
// that looks filled in.
//
// UNITS IS NOT ASKED. The column exists, nothing in the app reads it, and the app is metric
// everywhere. A stored preference the UI ignores is worse than not asking — see the migration.
//
// DEL SEES IT ONCE TOO, by his own decision (22 Aug). His row predates the form: onboarded_at is
// null and his date of birth was never recorded, only his age. So the gate is "no row OR
// onboarded_at is null", and the form prefills from whatever the row already holds — he is not
// retyping his own name and height to get past it.
const ONBOARD_STEPS = [
  {
    key: 'display_name', type: 'text', required: true, placeholder: 'Name',
    q: "First — what's your name?",
    sub: 'It goes on the home screen, nowhere else.'
  },
  {
    key: 'sex', type: 'chips',
    q: 'Are you male or female?',
    // The column's CHECK still allows 'other' — a constraint is not worth a migration to narrow,
    // and an old row carrying it must not start failing to save. The form just stops offering it.
    sub: 'Its only job is energy and protein maths later on. Nothing in the app reads it today.',
    options: [['male', 'Male'], ['female', 'Female']]
  },
  {
    key: 'dob', type: 'dob',
    q: 'When were you born?',
    sub: 'A date rather than an age — an age is a number that goes stale in a database.'
  },
  {
    key: 'start_weight_kg', type: 'number', unit: 'kg', min: 20, max: 400,
    q: 'What do you weigh today?',
    sub: "This becomes today's weigh-in. Nearest 0.1 is fine."
  },
  {
    key: 'height_cm', type: 'number', unit: 'cm', min: 100, max: 250,
    q: 'How tall are you?',
    sub: 'Centimetres. Spin until the feet and inches underneath match.'
  },
  {
    key: 'target_weight_kg', type: 'number', unit: 'kg', min: 20, max: 400,
    q: 'Is there a weight you are aiming for?',
    sub: "Leave it blank if there isn't. Nothing in the app nags you about this."
  },
  {
    key: 'experience', type: 'chips',
    q: 'How much lifting have you done?',
    sub: 'This is what picks the programme you start on.',
    options: [['beginner', 'New to it'], ['returning', 'Coming back'], ['intermediate', 'A year or two'], ['advanced', 'Years']]
  },
  {
    key: 'training_days_per_week', type: 'chips',
    q: 'How many days a week can you train?',
    sub: 'Be honest — the programme is built around this number.',
    options: [[2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']]
  }
];

// Del rejected the form on 23 Aug for one reason: the keypad opened and closed on seven of the
// eight screens. "imagine an older user of the app - it would fucking do their head in". So every
// number and the date are now picked off a scrolling wheel — the control an iPhone already uses for
// alarms and dates — and the name is the only screen left that opens a keyboard.
//
// These ranges are what a thumb can cross in a flick or two. They are NOT the validation limits:
// step.min/step.max still hold those, and they still mirror the columns' CHECK constraints. A wheel
// that spanned 20–400 kg would be 3,800 stops and unusable, which is the whole reason for a second
// pair of numbers.
const OB_WHEEL = {
  start_weight_kg:  { lo: 30,  hi: 250, dec: true,  start: 75 },
  height_cm:        { lo: 120, hi: 220, dec: false, start: 175 },
  target_weight_kg: { lo: 30,  hi: 250, dec: true,  start: 75 }
};

// One row of the wheel, in px. Must match .ob-wheel i in the stylesheet — the scroll position IS
// the answer (index = scrollTop / OB_ITEM), so a disagreement here reads back the wrong number.
const OB_ITEM = 44;

const OB_DRAFT_PREFIX = 'dlog_onboard_draft:';
let obStep = 0;
let obAnswers = {};
let obEditing = false;
// A wheel always sits on some value, so "showing 75 kg" cannot mean "answered 75 kg" — otherwise
// tapping straight through would write a made-up weigh-in and a made-up birthday into the profile.
// An answer is only recorded once the column has actually been dragged; untouched still means null,
// exactly as an empty box did.
let obTouch = {};
// The date's three columns, kept as the strings obValidate() already knows how to check rather than
// as an ISO date, so the validation path is unchanged.
let obDob = { d: '', m: '', y: '' };

// Per account, because two people can share a phone and the second one is not onboarded just
// because the first one was. The email is already in localStorage under dlog_session — this adds
// no new exposure, it just needs something stable to key on.
function onboardedKey() {
  return `dlog_onboarded:${authSession?.email || ''}`;
}

// The half-finished form is per account for the same reason: Del abandoning the form on screen 3
// must not hand his answers to whoever logs in on that phone next.
function obDraftKey() {
  return `${OB_DRAFT_PREFIX}${authSession?.email || ''}`;
}

// A missing profile row means "not onboarded" — but sb() also returns [] for a GET that FAILED, and
// from here those two are indistinguishable. Without this cache, one trip to a gym with no signal
// would open the onboarding form over a four-month-old account and ask Del his name again.
//
// So the row is the authority when it arrives, and this is the memory of the last time it did.
function needsOnboarding() {
  if (PROFILE && PROFILE.onboarded_at) return false;
  try {
    if (localStorage.getItem(onboardedKey()) === '1') return false;
  } catch (e) {}
  return true;
}

function markOnboarded() {
  try { localStorage.setItem(onboardedKey(), '1'); } catch (e) {}
}

// Pure, so the rules can be tested without a DOM. Returns { value } or { error }; a blank answer on
// an optional step is { value: null }, which is a real answer meaning "not recorded".
function obValidate(step, raw) {
  if (step.type === 'chips') {
    return { value: (raw === undefined || raw === '' || raw === null) ? null : raw };
  }
  if (step.type === 'text') {
    const v = String(raw ?? '').trim();
    if (!v) return step.required ? { error: 'The app needs something to call you.' } : { value: null };
    return { value: v.slice(0, 60) };
  }
  if (step.type === 'number') {
    // A comma is what some locales' phone keypads give for a decimal point, and "68,4" parses as
    // 68 without this — a silently wrong weigh-in rather than a visible error.
    const s = String(raw ?? '').trim().replace(',', '.');
    if (!s) return { value: null };
    if (!/^\d+(\.\d+)?$/.test(s)) return { error: 'Numbers only.' };
    const n = parseFloat(s);
    if (n < step.min || n > step.max) return { error: `That should be between ${step.min} and ${step.max} ${step.unit}.` };
    // Matches the numeric(5,1) / numeric(4,1) columns. Rounding here rather than letting Postgres
    // do it means the number stored is the number the screen shows back.
    return { value: Math.round(n * 10) / 10 };
  }
  if (step.type === 'dob') {
    const d = String(raw && raw.d !== undefined ? raw.d : '').trim();
    const m = String(raw && raw.m !== undefined ? raw.m : '').trim();
    const y = String(raw && raw.y !== undefined ? raw.y : '').trim();
    if (!d && !m && !y) return { value: null };
    if (!d || !m || !y) return { error: 'Day, month and year — or leave all three blank.' };
    if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !/^\d{4}$/.test(y)) {
      return { error: 'Day, month, then a four-digit year.' };
    }
    const dd = parseInt(d, 10), mm = parseInt(m, 10), yy = parseInt(y, 10);
    // Round-trip through Date rather than a days-in-month table: 31/02 constructs as 03/03 and
    // comes back out with a different month, which is exactly the check.
    const dt = new Date(yy, mm - 1, dd);
    if (dt.getFullYear() !== yy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) {
      return { error: "That date doesn't exist." };
    }
    const age = obAgeOn(dt, new Date());
    if (age < 13 || age > 100) return { error: `That works out at ${age} — check the year.` };
    const p = n => String(n).padStart(2, '0');
    return { value: `${yy}-${p(mm)}-${p(dd)}` };
  }
  return { value: null };
}

// Whole years, birthday-aware. Not `(now - birth) / 365.25` — that is off by a day either side of a
// birthday, which is exactly where an age check gets argued with.
function obAgeOn(birth, now) {
  const age = now.getFullYear() - birth.getFullYear();
  const before = now.getMonth() < birth.getMonth()
    || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  return before ? age - 1 : age;
}

// Every column the form owns, present on every save. A key left off the body is a column left
// alone, which on an edit means clearing an answer would silently keep the old one.
function obPayload(answers, nowIso) {
  const row = {};
  ONBOARD_STEPS.forEach(s => {
    const v = answers[s.key];
    row[s.key] = (v === undefined || v === '') ? null : v;
  });
  row.onboarded_at = nowIso;
  return row;
}

function openOnboarding(edit = false) {
  obEditing = !!edit;
  obStep = 0;
  obAnswers = {};
  obTouch = {};
  obDob = { d: '', m: '', y: '' };
  // Prefill from whatever the row already holds. PostgREST hands numerics back as strings, so the
  // numbers go through numOrNull/intOrNull rather than being trusted raw.
  ONBOARD_STEPS.forEach(s => {
    const v = PROFILE ? PROFILE[s.key] : null;
    if (v === null || v === undefined || v === '') return;
    if (s.type === 'number') obAnswers[s.key] = numOrNull(v);
    else if (s.key === 'training_days_per_week') obAnswers[s.key] = intOrNull(v);
    else obAnswers[s.key] = v;
  });
  // A run abandoned halfway beats the row: it is the more recent set of answers. Not applied when
  // the form was opened deliberately to edit — that starts from what is actually stored.
  if (!obEditing) {
    try {
      const raw = localStorage.getItem(obDraftKey());
      const draft = raw ? JSON.parse(raw) : null;
      if (draft && draft.answers) {
        obAnswers = { ...obAnswers, ...draft.answers };
        obStep = Math.min(Math.max(0, draft.step | 0), ONBOARD_STEPS.length - 1);
      }
    } catch (e) {}
  }
  // Anything that came off the row or the draft is already an answer, so its wheel opens on it and
  // reads as set rather than as an untouched default.
  Object.keys(obAnswers).forEach(k => { obTouch[k] = true; });
  document.getElementById('ob-date').textContent =
    new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  document.getElementById('onboarding').style.display = 'flex';
  document.documentElement.classList.add('ob-active');
  obBindViewport();
  window.scrollTo(0, 0);
  obRender();
}

function closeOnboarding() {
  document.getElementById('onboarding').style.display = 'none';
  document.documentElement.classList.remove('ob-active');
  obUnbindViewport();
}

// iOS does not resize a `position: fixed` element when the keyboard opens — it shrinks the visual
// viewport only. The form is fixed and full-height, so on the one screen that still takes a
// keyboard the footer holding Next ends up underneath it, and .ob-wrap centres the question against
// a height that is no longer on screen. Matching the panel to the visual viewport is the fix.
function obViewportFit() {
  const el = document.getElementById('onboarding');
  const vv = window.visualViewport;
  if (!el || !vv) return;
  el.style.height = vv.height + 'px';
  el.style.top = vv.offsetTop + 'px';
}

function obBindViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  vv.addEventListener('resize', obViewportFit);
  vv.addEventListener('scroll', obViewportFit);
  obViewportFit();
}

function obUnbindViewport() {
  const el = document.getElementById('onboarding');
  // Cleared, not left at the last keyboard-shrunk height: the panel is reopened by "Your details"
  // and would otherwise come back half a screen tall.
  if (el) { el.style.height = ''; el.style.top = ''; }
  const vv = window.visualViewport;
  if (!vv) return;
  vv.removeEventListener('resize', obViewportFit);
  vv.removeEventListener('scroll', obViewportFit);
}

function obRender() {
  const step = ONBOARD_STEPS[obStep];
  const last = obStep === ONBOARD_STEPS.length - 1;
  const answer = obAnswers[step.key];

  document.getElementById('ob-rail').innerHTML =
    ONBOARD_STEPS.map((_, i) => `<i class="${i <= obStep ? 'on' : ''}"></i>`).join('');
  document.getElementById('ob-q').textContent = step.q;
  document.getElementById('ob-sub').textContent = step.sub || '';
  // Cleared on every step; only the number screens fill it, from obMountNumber().
  document.getElementById('ob-conv').textContent = '';
  document.getElementById('ob-err').textContent = '';
  document.getElementById('ob-count').textContent = `${obStep + 1} / ${ONBOARD_STEPS.length}`;
  document.getElementById('ob-next').textContent = last ? (obEditing ? 'Save' : 'Finish') : 'Next';

  const back = document.getElementById('ob-back');
  back.textContent = obStep === 0 ? 'Cancel' : '← Back';
  // Hidden, not removed: the footer keeps its shape, so Next does not jump sideways between
  // screen 1 and screen 2.
  back.style.visibility = (obStep === 0 && !obEditing) ? 'hidden' : 'visible';

  document.getElementById('ob-field').innerHTML = obFieldHtml(step, answer);
  obMountField(step, answer);

  const input = document.getElementById('ob-input');
  // Only the name still takes a keyboard, and only there is the focus wanted. Focusing on every
  // render is what made the keypad spring up and drop away eight times over — the thing Del
  // rejected the form for on 23 Aug.
  if (input && step.type === 'text') { try { input.focus(); } catch (e) {} }
}

function obFieldHtml(step, answer) {
  if (step.type === 'chips') {
    // One character per option (2–6 days a week) goes in a row; anything wordy gets a row each, so
    // nothing wraps and no option ends up orphaned on a line of its own.
    const row = step.options.every(([, label]) => String(label).length <= 2);
    return `<div class="ob-opts${row ? ' row' : ''}">` + step.options.map(([value, label]) => {
      const arg = typeof value === 'number' ? String(value) : `'${esc(String(value))}'`;
      return `<button type="button" class="ob-opt${answer === value ? ' on' : ''}" onclick="obChoose(${arg})">${esc(label)}<span class="ob-tick">&#10003;</span></button>`;
    }).join('') + '</div>';
  }
  if (step.type === 'dob') {
    return obWheelsHtml([
      { id: 'ob-w-d', label: 'Day' },
      { id: 'ob-w-m', label: 'Month' },
      { id: 'ob-w-y', label: 'Year' }
    ], '', obTouch[step.key]);
  }
  if (step.type === 'number') {
    const cols = [{ id: 'ob-w-whole', label: step.q }];
    if (OB_WHEEL[step.key] && OB_WHEEL[step.key].dec) cols.push({ id: 'ob-w-dec', label: 'Tenths' });
    return obWheelsHtml(cols, step.unit || '', obTouch[step.key]);
  }
  const unit = step.unit ? `<span class="ob-unit">${step.unit}</span>` : '';
  const mode = step.type === 'number' ? 'decimal' : 'text';
  const cap = step.type === 'text' ? ' autocapitalize="words"' : '';
  const shown = (answer === null || answer === undefined) ? '' : String(answer);
  return `<div class="ob-row"><input class="ob-big" id="ob-input" type="text" inputmode="${mode}"${cap} placeholder="${esc(step.placeholder || '')}" value="${esc(shown)}" onkeydown="obKey(event)" />${unit}</div>`;
}

// The shell. The rows themselves are filled by obMountField() rather than built into this string:
// a year column is eighty-odd rows, and the field builder stays readable without them.
function obWheelsHtml(cols, unit, set) {
  const wheels = cols.map(c =>
    `<div class="ob-wheel" id="${c.id}" tabindex="0" role="listbox" aria-label="${esc(c.label)}"></div>`
  ).join('');
  const u = unit ? `<span class="ob-wheel-unit">${esc(unit)}</span>` : '';
  return `<div class="ob-wheels${set ? '' : ' unset'}" id="ob-wheels">${wheels}${u}<div class="ob-band"></div></div>
          <p class="ob-hint" id="ob-hint">${set ? '' : 'spin to set &middot; or skip it with next'}</p>`;
}

// One scrolling column. The answer is read back off scrollTop rather than tracked in a variable,
// because iOS momentum keeps the list moving after the finger has gone and only where it comes to
// rest is an answer. `onSettle` fires once the scrolling stops.
//
// Touch is detected from a real gesture, never from the scroll event: setting scrollTop to open the
// wheel on its start value fires `scroll` too, and treating that as an answer is exactly the
// made-up birthday this is meant to prevent.
function obWheel(el, labels, index, onSettle, onTouch) {
  if (!el) return;
  el.innerHTML = labels.map(l => `<i>${l}</i>`).join('');
  const mark = () => {
    const i = Math.max(0, Math.min(labels.length - 1, Math.round(el.scrollTop / OB_ITEM)));
    for (let n = 0; n < el.children.length; n++) el.children[n].classList.toggle('on', n === i);
    return i;
  };
  let timer = null;
  el.addEventListener('scroll', () => {
    const i = mark();
    clearTimeout(timer);
    timer = setTimeout(() => onSettle(i), 90);
  }, { passive: true });
  ['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(ev =>
    el.addEventListener(ev, onTouch, { passive: true })
  );
  el.scrollTop = Math.max(0, Math.min(labels.length - 1, index)) * OB_ITEM;
  mark();
}

// Everything is stored metric — the columns are height_cm and *_weight_kg and that does not change.
// This is a live readout under the question so someone who thinks in feet and stone can spin to
// their own number instead of doing the arithmetic first. Del, 23 Aug: "is there a way of a user
// uses 186cm it gives a hint under main heading is about 6ft 3in".
function obCmToFtIn(cm) {
  const totalIn = Math.round(cm / 2.54);
  return `${Math.floor(totalIn / 12)}ft ${totalIn % 12}in`;
}

// Rounded to whole pounds FIRST, then split. Splitting first lets 13.6 lb round up to a fourteenth
// pound and print "12 st 14 lb", which is not a weight anybody says out loud.
function obKgToStLb(kg) {
  const lb = Math.round(kg * 2.2046226218);
  return `${Math.floor(lb / 14)}st ${lb % 14}lb · ${lb}lb`;
}

function obConversion(key, value) {
  if (value === null || value === undefined || isNaN(value)) return '';
  if (key === 'height_cm') return `about ${obCmToFtIn(value)}`;
  if (key === 'start_weight_kg' || key === 'target_weight_kg') return `about ${obKgToStLb(value)}`;
  return '';
}

function obDaysIn(m, y) {
  return new Date(y, m, 0).getDate();   // m is 1-based here, so day 0 of m+0 is the last of m
}

function obRange(lo, hi, fmt) {
  const out = [];
  for (let i = lo; i <= hi; i++) out.push(fmt ? fmt(i) : String(i));
  return out;
}

// Turns the wheel from a default into an answer, and drops the "or skip it" hint.
function obMarkTouched(step) {
  if (obTouch[step.key]) return;
  obTouch[step.key] = true;
  const box = document.getElementById('ob-wheels');
  if (box) box.classList.remove('unset');
  const hint = document.getElementById('ob-hint');
  if (hint) hint.textContent = '';
}

function obMountField(step, answer) {
  if (step.type === 'number') return obMountNumber(step, answer);
  if (step.type === 'dob') return obMountDob(step, answer);
}

function obMountNumber(step, answer) {
  const w = OB_WHEEL[step.key];
  if (!w) return;
  // A target weight with nothing to go on opens on what they just told us they weigh, which is the
  // only number on the screen that is theirs rather than an average.
  const fallback = step.key === 'target_weight_kg' && numOrNull(obAnswers.start_weight_kg) !== null
    ? numOrNull(obAnswers.start_weight_kg) : w.start;
  const v = Math.min(w.hi, Math.max(w.lo, numOrNull(answer) === null ? fallback : numOrNull(answer)));
  const whole = Math.floor(v);
  const tenth = Math.round((v - whole) * 10);

  const read = () => {
    const wEl = document.getElementById('ob-w-whole');
    const dEl = document.getElementById('ob-w-dec');
    if (!wEl) return;
    const n = w.lo + Math.round(wEl.scrollTop / OB_ITEM);
    const t = (w.dec && dEl) ? Math.round(dEl.scrollTop / OB_ITEM) : 0;
    const val = Math.min(w.hi, Math.max(w.lo, n)) + (w.dec ? t / 10 : 0);
    if (obTouch[step.key]) obAnswers[step.key] = Math.round(val * 10) / 10;
    // Follows the wheel whether or not it has been touched — it is a readout, not an answer, and
    // the whole point is to let someone who thinks in feet and stone find their own number.
    const conv = document.getElementById('ob-conv');
    if (conv) conv.textContent = obConversion(step.key, Math.round(val * 10) / 10);
  };
  // A tap without a drag still counts: the wheel goes full-colour, so it has to commit the value
  // it is showing or the screen would claim an answer it never recorded.
  const touch = () => { obMarkTouched(step); read(); };

  obWheel(document.getElementById('ob-w-whole'), obRange(w.lo, w.hi), whole - w.lo, read, touch);
  if (w.dec) obWheel(document.getElementById('ob-w-dec'), obRange(0, 9, i => '.' + i), tenth, read, touch);
  // The conversion has to be on screen before the first flick. Opening the wheel on index 0 moves
  // nothing, so waiting for a scroll event would leave the line blank on exactly the lightest user.
  read();
}

function obMountDob(step, answer) {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const nowY = new Date().getFullYear();
  // The wheel cannot offer a year obValidate() would reject: it caps age at 13 and 100.
  const yLo = nowY - 100, yHi = nowY - 13;
  const parts = String(answer || '').split('-');
  const y = Math.min(yHi, Math.max(yLo, parseInt(parts[0], 10) || 1980));
  const m = Math.min(12, Math.max(1, parseInt(parts[1], 10) || 1));
  const d = Math.min(31, Math.max(1, parseInt(parts[2], 10) || 1));

  const read = () => {
    const dEl = document.getElementById('ob-w-d');
    const mEl = document.getElementById('ob-w-m');
    const yEl = document.getElementById('ob-w-y');
    if (!dEl || !mEl || !yEl) return;
    const mm = 1 + Math.round(mEl.scrollTop / OB_ITEM);
    const yy = yLo + Math.round(yEl.scrollTop / OB_ITEM);
    // February cannot offer a 30th. Scrolling the day column back is what re-renders it, and the
    // scroll settles again on the clamped value — so this converges rather than looping.
    const max = obDaysIn(mm, yy);
    let dd = 1 + Math.round(dEl.scrollTop / OB_ITEM);
    if (dd > max) { dd = max; dEl.scrollTop = (max - 1) * OB_ITEM; }
    if (!obTouch[step.key]) return;
    obDob = { d: String(dd), m: String(mm), y: String(yy) };
    document.getElementById('ob-hint').textContent =
      `${dd} ${MON[mm - 1]} ${yy} · aged ${obAgeOn(new Date(yy, mm - 1, dd), new Date())}`;
  };
  // A tap without a drag still counts: the wheel goes full-colour, so it has to commit the value
  // it is showing or the screen would claim an answer it never recorded.
  const touch = () => { obMarkTouched(step); read(); };

  obDob = answer ? { d: String(d), m: String(m), y: String(y) } : { d: '', m: '', y: '' };
  obWheel(document.getElementById('ob-w-d'), obRange(1, 31), d - 1, read, touch);
  obWheel(document.getElementById('ob-w-m'), MON, m - 1, read, touch);
  obWheel(document.getElementById('ob-w-y'), obRange(yLo, yHi), y - yLo, read, touch);
  if (answer) read();
}

function obKey(e) {
  if (e.key === 'Enter') { e.preventDefault(); obNext(); }
}

function obChoose(value) {
  const step = ONBOARD_STEPS[obStep];
  // Tapping the chosen chip again clears it — the only way back to "not answered" once one has been
  // pressed, and every chip step is optional.
  obAnswers[step.key] = obAnswers[step.key] === value ? undefined : value;
  obRender();
}

function obReadRaw(step) {
  const val = id => {
    const el = document.getElementById(id);
    return el ? el.value : '';
  };
  if (step.type === 'chips') return obAnswers[step.key];
  // The wheels write into state as they settle, so state is the field — and an untouched wheel
  // holds nothing, which obValidate() reads as a skipped answer exactly like an empty box did.
  if (step.type === 'dob') return obDob;
  if (step.type === 'number') {
    const v = obAnswers[step.key];
    return (v === null || v === undefined) ? '' : v;
  }
  return val('ob-input');
}

// Keeps whatever is on screen if it is valid, so Back never costs an answer. Rejecting is Next's
// job alone — a half-typed date must not block a step backwards.
function obStash() {
  const step = ONBOARD_STEPS[obStep];
  if (step.type === 'chips') return;
  const res = obValidate(step, obReadRaw(step));
  if (res.error === undefined) obAnswers[step.key] = res.value;
}

function obSaveDraft() {
  try {
    localStorage.setItem(obDraftKey(), JSON.stringify({ step: obStep, answers: obAnswers }));
  } catch (e) {}
}

function obBack() {
  if (obStep === 0) {
    closeOnboarding();   // Cancel. Only reachable in edit mode — see obRender().
    return;
  }
  obStash();
  obSaveDraft();
  obStep--;
  obRender();
}

function obNext() {
  const step = ONBOARD_STEPS[obStep];
  const res = obValidate(step, obReadRaw(step));
  if (res.error) {
    document.getElementById('ob-err').textContent = res.error;
    return;
  }
  obAnswers[step.key] = res.value;
  if (obStep < ONBOARD_STEPS.length - 1) {
    obStep++;
    obSaveDraft();
    obRender();
    return;
  }
  obFinish();
}

async function obFinish() {
  const btn = document.getElementById('ob-next');
  btn.disabled = true;
  const row = obPayload(obAnswers, new Date().toISOString());
  // One row per user and user_id defaults to auth.uid(), so insert-or-update on the primary key is
  // the whole write — the client never says whose row this is.
  const res = await sb('profiles?on_conflict=user_id', 'POST', row, { upsert: true, quiet: true });
  btn.disabled = false;
  if (!res.ok) {
    // Stays on the last screen with every answer intact. A form that closes on a failed save is the
    // check-in bug all over again.
    document.getElementById('ob-err').textContent = `Not saved (${res.status}) — try again.`;
    return;
  }
  PROFILE = { ...(PROFILE || {}), ...row };
  markOnboarded();
  try { localStorage.removeItem(obDraftKey()); } catch (e) {}
  if (row.start_weight_kg !== null) await obSaveFirstWeighIn(row.start_weight_kg);
  const wasEditing = obEditing;
  closeOnboarding();
  showToast(wasEditing ? 'Details updated' : `You're set up, ${row.display_name}`, 'success');
  showPage('home');
}

// "This becomes today's weigh-in" has to be true, or the first thing the app does is lie. Weight
// lives in daily_logs, not on the profile — start_weight_kg is the point Stats measures from, the
// weigh-in is the data point.
//
// An existing weight for today is never overwritten: someone who checked in this morning and then
// opened the form has typed the same number twice, and the check-in is the one they meant.
async function obSaveFirstWeighIn(kg) {
  const date = todayStr();
  const rows = await sb(`daily_logs?date=eq.${date}&select=id,weight_kg`, 'GET', null, { quiet: true });
  const existing = rows && rows[0];
  if (existing && existing.weight_kg !== null && existing.weight_kg !== undefined) return;
  const res = existing
    ? await sb(`daily_logs?date=eq.${date}`, 'PATCH', { weight_kg: kg }, { quiet: true })
    : await sb('daily_logs', 'POST', { date, weight_kg: kg }, { quiet: true });
  if (!res.ok) showToast("Details saved — today's weigh-in didn't", 'error');
}

// ─── MACRO TARGETS ────────────────────────────────────────
// Added 11 Aug 2026. Before this the app had no targets, so every macro comparison in the UI was
// "change since the previous check-in" — which read as a goal shortfall and caused real confusion
// (a 17g fibre day showing −10g was just 27g the day before, not a miss).
//
// A null target means "no target for this macro" and every consumer must render a plain — for it.
// Never fall back to 0: a shortfall measured against a target you never set is worse than no
// verdict at all, which is the exact mistake this feature exists to stop making.
let MACRO_GOALS = { protein_g: null, carbs_g: null, fat_g: null, fibre_g: null, calories: null };
let goalsRowId = null;

// PostgREST returns numerics as strings ("175"), so everything goes through this rather than being
// trusted raw — `"175" - 0` works but `"175" > 100` is a string comparison waiting to happen.
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// Same, for the whole-number columns (steps, calories). These used to be `parseInt(x) || null`,
// which turned a genuine 0 into "not recorded" — 0 steps on a sick day, or a 0-calorie fast day,
// stored as null and then read back as blank. It matters more now the Watch Shortcut writes steps.
function intOrNull(v) {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
}

async function loadGoals() {
  const rows = await sb('goals?select=*&order=updated_at.desc&limit=1');
  if (!rows || !rows[0]) return;          // no row yet — targets stay null, UI shows the empty state
  goalsRowId = rows[0].id;
  MACRO_GOALS = {
    protein_g: numOrNull(rows[0].protein_g),
    carbs_g:   numOrNull(rows[0].carbs_g),
    fat_g:     numOrNull(rows[0].fat_g),
    fibre_g:   numOrNull(rows[0].fibre_g),
    calories:  numOrNull(rows[0].calories)
  };
}

// The stored calorie override if there is one, else derived from the macros at 4/4/9 kcal per gram
// (175p/200c/56f = 2004). Derived only when all three macros have targets — summing a partial set
// produces a number that looks like a calorie goal but isn't one.
function goalCalories() {
  if (MACRO_GOALS.calories !== null) return MACRO_GOALS.calories;
  const { protein_g: p, carbs_g: c, fat_g: f } = MACRO_GOALS;
  if (p === null || c === null || f === null) return null;
  return Math.round(p * 4 + c * 4 + f * 9);
}

function hasAnyGoal() {
  return MACRO_GOALS.protein_g !== null || MACRO_GOALS.carbs_g !== null || MACRO_GOALS.fat_g !== null;
}

// Verdict on one macro: 'good' (green), 'bad' (red), 'soft' (amber), or null when there's nothing
// to judge. Which direction counts as bad depends on the macro, which is why `underIsMiss` exists:
// falling short on protein is the failure, whereas on carbs/fat/calories it's going over. Under on
// carbs is 'soft' — under budget on a cut isn't a success worth a green tick, but it isn't a miss.
//
// The ±5% (min 3 units) tolerance is the point of the whole thing. Nobody hits 175g protein to the
// gram, and a row that is permanently red teaches you to stop reading the colour.
// The width of the "close enough" band in the macro's own unit: 5% of target, never under 3. It is
// now printed beside the target (`200 ±10g`) rather than living only in here, because a hidden band
// makes the colours look arbitrary — +84 calories green sitting above +35g carbs red is only
// defensible once you can see that one band is 100 wide and the other is 10.
function goalBand(t) { return Math.max(t * 0.05, 3); }

function goalState(actual, target, underIsMiss = false) {
  const a = numOrNull(actual), t = numOrNull(target);
  if (a === null || t === null || t === 0) return null;
  const diff = a - t;
  if (Math.abs(diff) <= goalBand(t)) return 'good';
  if (underIsMiss) return diff < 0 ? 'bad' : 'good';
  return diff > 0 ? 'bad' : 'soft';
}

// The right-hand cell on a check-in macro row — and most days, on most rows, it is empty.
//
// Three goes at this card failed the same way, and it took Del saying he did not like any of them
// to see why. Every version judged all five macros and coloured all five, so a day arrived as five
// verdicts: green, green, red, amber, green. Nobody reads a day as five verdicts. Worse, the
// verdicts ran in opposite directions without saying so — under is the miss on protein and fibre,
// over is the miss on calories, carbs and fat — so two rows could both show a minus, one green and
// one red, and both be right. No choice of colour, band or delta unit fixes that. The grading was
// the problem.
//
// So the card stopped grading and started flagging. A row is plain unless it is genuinely off, and
// then it says by how much, in the unit you would act on. Hitting a target earns no colour — the
// reward for hitting it is that the row goes quiet. Wed 19 Aug lights one row (carbs +35g). Tue 18
// lights three. That is a day you can read without decoding anything.
//
// Under on calories, carbs or fat is not a miss on a cut, so it is not flagged. That was the amber
// 'soft' state, which spent a colour to say "this is fine".
function missCell(actual, target, opts = {}) {
  const { suffix = '', decimals = 0, underIsMiss = false } = opts;
  if (goalState(actual, target, underIsMiss) !== 'bad') return '<span class="pf-d"></span>';
  const diff = numOrNull(actual) - numOrNull(target);
  const txt = `${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(decimals).replace(/\.0$/, '')}${suffix}`;
  return `<span class="pf-d off">${txt}</span>`;
}

// One meter row on the Check-in card. `actual` may be null (nothing logged yet) — the bar renders
// empty rather than the row disappearing, so the targets are visible before you've eaten anything.
function goalMeter(label, actual, target, underIsMiss = false, unit = 'g') {
  const t = numOrNull(target);
  if (t === null) return '';
  const a = numOrNull(actual);
  const state = a === null ? 'empty' : goalState(a, t, underIsMiss);
  // Bar caps at 100% so a 3000-calorie day can't render a fill wider than its track; the number
  // beside it still tells the truth.
  const pct = a === null ? 0 : Math.min(100, Math.round((a / t) * 100));
  const left = a === null ? '' : (a >= t ? `${Math.round(a - t)}${unit} over` : `${Math.round(t - a)}${unit} left`);
  return `<div class="goal-row">
    <span class="goal-name">${label}</span>
    <span class="goal-val"><b class="gv-${state}">${a === null ? '--' : Math.round(a)}</b> / ${Math.round(t)}${unit}</span>
    <span class="goal-track"><i class="goal-fill ${state}" style="width:${pct}%"></i></span>
    <span class="goal-left">${left}</span>
  </div>`;
}

function renderCheckinGoals(l) {
  const wrap = document.getElementById('checkin-goals');
  const rows = document.getElementById('checkin-goal-rows');
  if (!wrap || !rows) return;
  wrap.style.display = 'block';
  if (!hasAnyGoal()) {
    rows.innerHTML = `<div class="goal-empty">No targets set yet.</div>`;
    return;
  }
  const g = MACRO_GOALS;
  rows.innerHTML =
    goalMeter('Protein', l.protein_g, g.protein_g, true) +
    goalMeter('Carbs',   l.carbs_g,   g.carbs_g) +
    goalMeter('Fat',     l.fat_g,     g.fat_g) +
    goalMeter('Fibre',   l.fibre_g,   g.fibre_g, true) +
    goalMeter('Calories', l.calories, goalCalories(), false, '');
}

// ─── EDIT TARGETS MODAL ───────────────────────────────────
function openGoalsModal() {
  const set = (id, v) => { document.getElementById(id).value = v === null || v === undefined ? '' : v; };
  set('goal-protein', MACRO_GOALS.protein_g);
  set('goal-carbs',   MACRO_GOALS.carbs_g);
  set('goal-fat',     MACRO_GOALS.fat_g);
  set('goal-fibre',   MACRO_GOALS.fibre_g);
  set('goal-cals',    MACRO_GOALS.calories);
  updateGoalCalHint();
  document.getElementById('goals-modal').style.display = 'block';
}

function closeGoalsModal() {
  document.getElementById('goals-modal').style.display = 'none';
}

// Live "= 2004 kcal" readout under the calories field, recomputed as the macros are typed. The
// calories input is left blank on purpose when it matches — blank stores null, which keeps the
// calorie target derived rather than freezing today's number into the row.
function updateGoalCalHint() {
  const p = numOrNull(document.getElementById('goal-protein').value);
  const c = numOrNull(document.getElementById('goal-carbs').value);
  const f = numOrNull(document.getElementById('goal-fat').value);
  const hint = document.getElementById('goal-cal-hint');
  if (p === null || c === null || f === null) {
    hint.textContent = 'Fill all three macros for an automatic calorie target.';
    return;
  }
  hint.textContent = `Leave blank to use ${Math.round(p * 4 + c * 4 + f * 9)} kcal, derived from the macros above.`;
}

async function saveGoals() {
  const cals = numOrNull(document.getElementById('goal-cals').value);
  const data = {
    protein_g: numOrNull(document.getElementById('goal-protein').value),
    carbs_g:   numOrNull(document.getElementById('goal-carbs').value),
    fat_g:     numOrNull(document.getElementById('goal-fat').value),
    fibre_g:   numOrNull(document.getElementById('goal-fibre').value),
    calories:  cals === null ? null : Math.round(cals),   // column is integer
    updated_at: new Date().toISOString()
  };
  const res = goalsRowId
    ? await sb(`goals?id=eq.${goalsRowId}`, 'PATCH', data, { quiet: true })
    : await sb('goals', 'POST', data, { quiet: true });
  if (res && res.ok === false) { showToast(`Could not save targets (${res.status})`, 'error'); return; }
  await loadGoals();
  closeGoalsModal();
  renderCheckinSummary();
  showToast('Targets saved!', 'success');
}

// ─── INIT ─────────────────────────────────────────────────
async function initApp(page = 'home') {
  const now = new Date();
  document.getElementById('topbar-date').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('log-date').max = todayStr();
  await autoCloseStaleWorkouts();  // Clean up orphans from >24hrs ago before rendering the session grid
  await loadSessionTemplates();  // Fixed-session templates now live in Supabase, not a hardcoded array — must resolve before anything reads SESSIONS
  // Starts the freshness clock, so restoring straight onto the Workout tab (sessionStorage remembers
  // the last page) does not fire a second read of what we just read. See refreshSessionTemplates().
  lastTemplateRefresh = Date.now();
  // Before the build, not after: buildExerciseLibrary() folds EXERCISE_VARIATIONS in, and every
  // workout_sets write consults EXERCISE_IDS — the logger can open the moment initApp returns.
  await loadExerciseIds();
  EXERCISE_LIBRARY = buildExerciseLibrary();
  loadCustomExercises();  // Merges into EXERCISE_LIBRARY in the background — Open Workout dropdown reads it lazily
  // Two independent single-row reads, so they go together rather than one after the other — this
  // runs on every app start, sometimes on a gym connection. Both must resolve before showPage():
  // loadHomePage prints the greeting, and renderCheckinSummary/loadHistory judge macros against
  // the targets.
  await Promise.all([loadProfile(), loadGoals()]);
  buildSessionGrid();
  renderCheckinSummary();
  showPage(page);
  // Last, and after showPage() on purpose: the overlay opens over an app that has already painted,
  // so finishing the form reveals a Home that is ready rather than a blank frame. See
  // needsOnboarding() for why a failed profile read does not count as "new account".
  if (needsOnboarding()) openOnboarding();
}

// Local-timezone YYYY-MM-DD. Never use toISOString() for a date key — it converts to UTC first,
// so during BST anything between 00:00 and 01:00 comes out stamped as the previous day.
function dateStr(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The rolling seven-day window that Home and Stats both average over — defined once, because two
// screens each working out "the last 7 days" for themselves is exactly how they came to print two
// different step averages under labels that looked identical.
//
// `- 6`, not `- 7` (fixed 19 Aug 2026). The query is `date >= from` and today is in range, so
// subtracting 7 produced an EIGHT-day window wearing a "7 days" label: on 19 Aug that read 13,611
// avg steps where the true seven-day figure was 13,848. It returns the label as well, so the
// heading can name the actual dates instead of leaving the reader to work out which seven are meant.
function sevenDayWindow() {
  const from = new Date(); from.setDate(from.getDate() - 6);
  const to = new Date();
  const day = d => String(d.getDate());
  const mth = d => d.toLocaleDateString('en-GB', { month: 'short' });
  return {
    from: dateStr(from),
    label: from.getMonth() === to.getMonth()
      ? `${day(from)}–${day(to)} ${mth(to)}`
      : `${day(from)} ${mth(from)} – ${day(to)} ${mth(to)}`
  };
}

function todayStr() {
  return dateStr();
}

// Days since the epoch, wrapped to the length of a list — a pick that holds all day and moves on
// at midnight. Built from local Y/M/D through Date.UTC so a timezone offset can't roll it early.
function dayIndex(len) {
  const d = new Date();
  const days = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  return ((days % len) + len) % len;
}

// The name comes from the profile row now, not from the source (21 Aug 2026). If there is no row
// yet — a brand new account that hasn't been onboarded — it greets without a name rather than
// guessing, inventing "there" or, worst of all, calling someone else Del.
function getGreeting() {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const name = (PROFILE.display_name || '').trim();
  return name ? `${part}, ${name}` : part;
}

// ─── LANDING PAGE ─────────────────────────────────────────
async function loadHomePage() {
  document.getElementById('landing-greeting').textContent = getGreeting();
  document.getElementById('landing-date').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  try {
    // One quote a day, not one a page load. A fresh random pick every time Home rendered meant the
    // line changed on every refresh and every tap back from another tab — motion with no meaning
    // behind it. `order=id` pins the list order too, so the row PostgREST happens to return first
    // can't shuffle the choice underneath the date.
    const quotes = await sb(`quotes?select=quote,author&order=id`);
    if (quotes && quotes.length > 0) {
      const q = quotes[dayIndex(quotes.length)];
      document.getElementById('quote-text').textContent = `"${q.quote}"`;
      document.getElementById('quote-author').textContent = q.author ? `— ${q.author}` : '';
      document.getElementById('daily-quote').style.display = '';
    }
  } catch(e) {}

  const buildTag = document.getElementById('build-tag');
  if (buildTag) buildTag.textContent = `build ${APP_BUILD}`;

  // Reads localStorage and Notification.permission only — no network, so the label is honest even
  // on gym Wi-Fi that can't reach Supabase, and it corrects itself if permission was revoked in
  // iPhone Settings since the last visit.
  paintRestAlertsButton();

  // Before the awaits below — this one needs no network, so it still appears on gym Wi-Fi that
  // can't reach Supabase, which is the trip most likely to be far from the PC that runs the other
  // half of the backup. syncBackupState() then repaints it once the account-wide value arrives,
  // deliberately un-awaited so a slow network can't hold up the rest of Home.
  renderBackupPrompt();
  syncBackupState();

  // Un-awaited for the same reason as syncBackupState() above — it is a network read and Home must
  // not sit blank behind it.
  renderNextUp();

  const [latest, todayLog, weekWorkouts] = await Promise.all([
    sb(`daily_logs?order=date.desc&limit=1&select=weight_kg`),
    sb(`daily_logs?date=eq.${todayStr()}&select=steps`),
    // Empty rows have to be filtered out, not just counted — see realWorkoutsBetween()
    realWorkoutsBetween(getWeekStart())
  ]);

  if (latest && latest[0]?.weight_kg) {
    document.getElementById('home-weight').textContent = latest[0].weight_kg;
  }
  document.getElementById('home-sessions').textContent = weekWorkouts.length;

  // ── ONE WINDOW, ONE REQUEST (14 Aug 2026) ────────────────────────────────────────────────────
  // Steps averaged over the rolling last 7 days while weight and calories averaged over Mon–today,
  // so Home and Stats printed different average calories on the same morning and there was no way
  // to tell which was wrong — Del's "Home and stats don't match". Both are now the rolling 7 days,
  // which is what Stats has always used and the more useful of the two anyway: on a Monday, "this
  // week" is one day, and one breakfast is not an average. The two `sessions this week` tiles are
  // untouched — those are genuinely Mon-anchored (getWeekStart) on both screens and always agreed.
  // Also one request instead of two, which matters on gym Wi-Fi more than it looks.
  //
  // 19 Aug 2026: the window itself moved into sevenDayWindow(), shared with Stats, because it was
  // still an EIGHT-day window wearing a "7 days" label — and AVG STEPS moved down into this block
  // in index.html. It had always been averaged over exactly these seven days, but it sat in the row
  // above with CURRENT KG and SESSIONS THIS WEEK, under no heading, so it read as a weekly figure
  // and looked like it disagreed with the Stats week card. Same number, correct neighbours.
  const win = sevenDayWindow();
  const weekLogs = await sb(`daily_logs?date=gte.${win.from}&select=steps,weight_kg,calories`);

  // Name the dates on screen (19 Aug 2026). Two averages labelled "7 days" that were computed over
  // different windows is how this drifted apart the first time; a heading that says which seven days
  // it means costs nothing and makes the next drift visible instead of mysterious.
  const winLabel = document.getElementById('home-avg-window');
  if (winLabel) winLabel.textContent = `Last 7 days · ${win.label}`;

  // `!= null` — a recorded 0 belongs in the average (you walked nothing that day); only a day with
  // no reading at all should be left out of it.
  const stepsArr = (weekLogs || []).filter(l => l.steps != null).map(l => Number(l.steps));
  const avgSteps = stepsArr.length ? Math.round(stepsArr.reduce((a,b)=>a+b,0)/stepsArr.length) : null;
  document.getElementById('home-steps').textContent = avgSteps != null ? avgSteps.toLocaleString() : '--';

  const weightArr = (weekLogs || []).filter(l => l.weight_kg != null).map(l => l.weight_kg);
  const calsArr = (weekLogs || []).filter(l => l.calories != null).map(l => l.calories);
  const avgWeight = weightArr.length ? (weightArr.reduce((a,b)=>a+b,0)/weightArr.length).toFixed(1) : null;
  const avgCals = calsArr.length ? Math.round(calsArr.reduce((a,b)=>a+b,0)/calsArr.length) : null;
  document.getElementById('home-avg-weight').textContent = avgWeight ?? '--';
  document.getElementById('home-avg-cals').textContent = avgCals ? avgCals.toLocaleString() : '--';

  // Always rebuild — buildWeekStrip clears innerHTML first, so no risk of duplicates
  buildWeekStrip('home-week-strip');
}

// Workouts in a date range that actually record something — the same definition History uses.
//
// A `workouts` row is created the instant a session tile is tapped, before a single set is logged, so
// opening a session and walking away (or a test run) leaves a row with nothing in it. History hides
// those, but "sessions / week" on Home and the green dots on the week strip were counting raw rows,
// so Home claimed 4 sessions in a week with 2 real ones and there was nothing visible in History to
// delete. Anything with sets, cardio or notes is real and counts; notes is what keeps CV + Pump in
// (it logs to conditioning_logs and has neither sets nor cardio rows).
//
// Deliberately not keyed on completed_at: autoCloseStaleWorkouts() stamps that onto abandoned rows
// after 24h, which would let every one of them back in the next day.
//
// One request, not three (15 Aug 2026). It used to fetch the workouts, then fire two `in.(ids)`
// queries to find out which of them had anything in them; PostgREST embedding answers all of that in
// the same round trip. `workout_sets(id)` selects the cheapest possible column — nothing reads these
// two arrays, they exist only to be counted — and both are stripped off before returning, so callers
// get exactly the row shape they always got. See CODEBASE.md → "One request per screen, not fifteen".
// Sets, cardio or notes make a row real. This is the ONE definition — realWorkoutsBetween() uses it
// to count, beginWorkoutSession() uses it to decide whether a session is genuinely under way. They
// were the same rule stated twice until 19 Aug, and only one of the two copies existed, which is how
// an empty row came to warn about a session that never happened. Expects the embedded shape
// (`workout_sets(id),cardio_logs(id)`); a row selected without them reads as content-free.
function workoutRowHasContent(w) {
  return (w.workout_sets || []).length > 0
      || (w.cardio_logs || []).length > 0
      || (w.notes || '').trim() !== '';
}

// Does the UNSAVED half of a session exist for this session type? Numbers typed but not yet Mark
// Done'd live only in localStorage, so a workout you are standing in the middle of can genuinely
// have zero rows in the database. One draft per device, expiring at 24h — the same cutoff
// restoreDraft() applies, so a draft this says is live is one that would actually restore.
function draftHasContentFor(sessionType) {
  try {
    const raw = localStorage.getItem('workout_draft');
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (d.sessionId !== sessionType) return false;
    if (d.timestamp && Date.now() - d.timestamp > 24 * 60 * 60 * 1000) return false;
    return Object.keys(d.sets || {}).length > 0
        || (d.notes || '').trim() !== ''
        || (d.cardio || []).some(c => Object.keys(c.values || {}).length > 0);
  } catch (e) {
    return false;
  }
}

// Which of today's rows, if any, is the session you are standing in the middle of — or null.
//
// THE 21 AUG 2026 BUG. Del, three sets into Smith Incline on Upper A: "home page - in progress (not
// sure) when i started the first exercise (smith incline) on 3rd set - it wasnt working". Home
// offered him Upper A as *Next up*, the session he was already doing, and only switched to
// "In progress" an hour later. The data says exactly why: the first Mark Done of that session landed
// at 10:53, two minutes AFTER his screenshot. Sets are written on Mark Done, not on typing, so
// renderNextUp() — which read the live session off the most recent row that had DB content — could
// not see a session until it was part-saved. The whole first exercise is a blind spot.
//
// The rule here is the ghost rule, the one beginWorkoutSession() has used since 19 Aug: content in
// the row OR a live draft for that session type. Both halves are needed. Without the draft an
// untouched session is invisible; without the row check a stray tap on a tile would report a
// workout with nothing in it as in progress, which is the ghost bug this app already fixed once.
//
// `hasDraft` is injected so this stays pure and testable — see tests/next-up.test.js.
function liveWorkoutRow(rows, today, hasDraft = draftHasContentFor) {
  return (rows || []).find(w =>
    !w.completed_at && w.date === today && (workoutRowHasContent(w) || hasDraft(w.session_type))
  ) || null;
}

async function realWorkoutsBetween(fromDate, toDate = null) {
  const range = `date=gte.${fromDate}` + (toDate ? `&date=lte.${toDate}` : '');
  const rows = await sb(`workouts?${range}&select=id,date,session_type,notes,completed_at,workout_sets(id),cardio_logs(id)`) || [];
  return rows
    .filter(workoutRowHasContent)
    .map(({ workout_sets, cardio_logs, ...w }) => w);
}

// Monday-anchored. Everything week-shaped in the app (sessions/week, weekly averages, the
// History "This Week" filter, the week strip) goes through this one boundary.
function getWeekStart() {
  const d = new Date();
  d.setDate(d.getDate() - weekIndex(d));
  return dateStr(d);
}

// 0 = Monday … 6 = Sunday. getDay() is Sunday-anchored, hence the shift.
function weekIndex(d) {
  return (d.getDay() + 6) % 7;
}

// ─── WEEK STRIP ───────────────────────────────────────────
async function buildWeekStrip(containerId = 'home-week-strip') {
  // Mon–Sun, matching getWeekStart() — the strip used to run Sun–Sat, so it disagreed with
  // every other "this week" in the app about which days counted.
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const today = new Date();
  const dow = weekIndex(today);
  const strip = document.getElementById(containerId);
  if (!strip) return;

  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - dow + i);
    weekDates.push(dateStr(d));
  }

  // Real sessions only — an abandoned row would otherwise paint a day green with nothing logged on it
  const workouts = await realWorkoutsBetween(weekDates[0], weekDates[6]);
  strip.innerHTML = '';  // Clear AFTER fetch — prevents race between concurrent calls
  const byDate = {};
  (workouts || []).forEach(w => { (byDate[w.date] ||= []).push(sessionDisplayName(w.session_type)); });

  weekDates.forEach((date, i) => {
    const div = document.createElement('div');
    div.className = 'week-day';
    // Both classes, not one or the other. `today` used to win outright, so the day you'd just
    // trained never turned green — the one day of the week you'd actually look at for confirmation.
    // The CSS keeps today's accent border and gives the dot to `done` when they land together.
    if (i === dow) div.classList.add('today');
    const names = byDate[date] || [];
    if (names.length) div.classList.add('done');
    // The name of what was trained replaces the dot rather than sitting under it: a day carrying a
    // label is a day that was trained, so the dot alongside it would be saying the same thing twice
    // in a tile a seventh of a phone wide. Untrained days keep the dot.
    const label = names.map(shortSessionLabel).filter(Boolean).join(' ');
    div.innerHTML = `<div class="wd-name">${days[i]}</div>` + (label
      ? `<div class="wd-session" title="${esc(names.join(', '))}">${esc(label)}</div>`
      : `<div class="wd-dot"></div>`);
    strip.appendChild(div);
  });
}

// Squeezes a session name into a seventh of a phone's width — "Upper 1" → U1, "Full Body A" → FBA,
// "CV + Pump" → CVP. Initials, except that a word already written in capitals is an acronym and is
// kept whole (dropping CV to a bare C would lose the only part that identifies the session). A digit
// is uppercase-equal to itself, so it survives the same way — which is what keeps Upper 1 and
// Upper 2 apart on a strip seven columns wide.
// A one-word name keeps its first five letters instead, since its initial alone says nothing.
// The full name rides along in the tile's `title`, and History spells every session out in full.
function shortSessionLabel(name) {
  const words = (name || '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) return words[0].slice(0, 5).toUpperCase();
  return words.map(w => (w === w.toUpperCase() ? w : w[0])).join('').slice(0, 5).toUpperCase();
}

// ─── PROGRAMME / SESSION GRID ─────────────────────────────
// Session ids that have a *real* completed workout today — drives the "✓ logged today" tick.
//
// Two conditions, both needed. `completed_at` because an in-progress workout (Mark Done but no Save
// Workout) must not lock the session. Real content because a row is created the instant a tile is
// tapped, so opening a session and backing out would otherwise tick it as done for the rest of the
// day with nothing logged in it — the same empty-row problem as the sessions/week count.
async function sessionsDoneToday() {
  const rows = await realWorkoutsBetween(todayStr(), todayStr());
  return new Set(rows.filter(w => w.completed_at).map(w => w.session_type));
}

function getSessionById(id) {
  return SESSIONS.find(s => s.id === id);
}

// ─── TILE COLOUR (17 Aug 2026) ────────────────────────────
// Which colour a session tile wears. Keyed on the **id prefix**, never the name: the name is
// editable in the ✎ template editor, the id isn't, so renaming "Lower B" to "Lower 2" — which is
// exactly what happened on 21 Aug 2026 — would otherwise silently drop it back to grey. A session that matches nothing falls through to the
// neutral class rather than picking a colour at random.
function sessionColourClass(s) {
  const id = s.id || '';
  if (s.programme === CUSTOM_PROGRAMME_ID) return 'sc-own';
  if (s.cardio || id.startsWith('cv')) return 'sc-cv';
  if (id.startsWith('upper')) return 'sc-upper';
  if (id.startsWith('lower')) return 'sc-lower';
  if (id.startsWith('full-body')) return 'sc-full';
  return 'sc-own';
}

// Most recent *real* session per session type, for the "last · 14 Aug" line. The embeds are here
// for the same reason realWorkoutsBetween() has them: a `workouts` row is created the moment a tile
// is tapped, so without this an opened-and-abandoned session would report itself as the last time
// you trained. One request, ordered desc, first hit per type wins.
async function lastTrainedBySession() {
  const rows = await sb('workouts?select=session_type,date,notes,workout_sets(id),cardio_logs(id)&order=date.desc') || [];
  const map = {};
  rows.forEach(w => {
    if (map[w.session_type]) return;
    const real = (w.workout_sets || []).length > 0 || (w.cardio_logs || []).length > 0 || (w.notes || '').trim() !== '';
    if (real) map[w.session_type] = w.date;
  });
  return map;
}

// "today" / "yesterday" / "14 Aug". The two recent cases get words because those are the ones you
// read at a glance to answer "did I already do this one?".
function lastTrainedLabel(date) {
  if (!date) return null;
  if (date === todayStr()) return 'today';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (date === dateStr(y)) return 'yesterday';
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ─── NEXT UP (18 Aug 2026) ────────────────────────────────
// Del trains a rolling Upper 1 → Lower 1 → Upper 2 → Lower 2 rotation at ~5 sessions a week, so the
// cycle drifts across weekdays and never lines up with a calendar. Home's week strip is
// weekday-shaped and therefore cannot answer the only question he asks Home on the way to the gym:
// which one is next. Every fact needed to answer it was already in the app; nothing ever said it.
//
// The rotation IS the programme's session list in sort_order, so "the last one trained, plus one" is
// the whole algorithm. Kept pure and fed its inputs so it can be tested without a DB — see
// tests/next-up.test.js.
//
// `recent` must be newest-first and already filtered to real workouts. Anything outside a fixed
// programme (an Open Workout, a session saved out of one) is SKIPPED rather than ending the search:
// doing an Open Workout on a Wednesday does not move you round the cycle.
function nextInRotation(recent, sessions = SESSIONS, programmes = TRAINING_PROGRAMMES) {
  const fixed = new Set((programmes || []).map(p => p.id));

  let last = null, lastDate = null;
  for (const w of (recent || [])) {
    const s = (sessions || []).find(x => x.id === w.session_type);
    if (s && fixed.has(s.programme)) { last = s; lastDate = w.date; break; }
  }
  // No history inside a fixed programme — say nothing rather than guess. sb() hands back [] on a
  // failed GET, so guessing here would print "Upper 1 next" at a man standing in a gym with no
  // signal, which is worse than an absent card.
  if (!last) return null;

  const rotation = (sessions || []).filter(s => s.programme === last.programme);
  const i = rotation.findIndex(s => s.id === last.id);
  if (i < 0) return null;
  const at = (i + 1) % rotation.length;
  return { session: rotation[at], after: last, afterDate: lastDate, position: at + 1, total: rotation.length };
}

// The session the card is currently offering, so the tap handler doesn't recompute it.
let nextUpSession = null;

// Paints the card, or hides it. One request, deliberately not awaited by loadHomePage — a slow gym
// connection must not hold the rest of Home behind it.
//
// The in-progress branch matters more than it looks. Without it, doing half of Upper 2 and glancing
// at Home would offer Lower 2, and tapping that lands on beginWorkoutSession's "you have an
// in-progress Upper 2, start Lower 2 instead?" confirm — a dead end built by the card itself.
async function renderNextUp() {
  const card = document.getElementById('next-up');
  if (!card) return;
  const hide = () => { nextUpSession = null; card.style.display = 'none'; };

  // Same "real workout" test realWorkoutsBetween() uses, and for the same reason: a workouts row
  // exists from the moment a tile is tapped. completed_at sorts nullsfirst on a desc order in
  // PostgREST, which is what puts today's in-progress session ahead of today's finished one.
  const rows = await sb('workouts?select=session_type,date,notes,completed_at,workout_sets(id),cardio_logs(id)&order=date.desc,completed_at.desc&limit=20') || [];
  const recent = rows.filter(workoutRowHasContent);

  // `recent` answers "where am I in the rotation", which is a question only finished work can
  // answer. Which session is LIVE is a different question with a different rule — see
  // liveWorkoutRow(). Reading the live one off `recent[0]` was the 21 Aug bug: it made the card
  // wait for the first Mark Done before it would admit a session had started.
  const live = liveWorkoutRow(rows, todayStr());
  const liveSession = live ? getSessionById(live.session_type) : null;
  const next = liveSession ? null : nextInRotation(recent);
  if (!liveSession && !next) return hide();

  const session = liveSession || next.session;
  nextUpSession = session;
  card.className = 'next-up ' + sessionColourClass(session);
  card.style.display = 'block';
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('next-up-label', liveSession ? 'In progress' : 'Next up');
  set('next-up-name', session.name);
  set('next-up-focus', session.focus || '');
  set('next-up-go', liveSession ? 'Resume \u2192' : 'Start \u2192');
  set('next-up-step', liveSession ? '' : next.position + ' of ' + next.total);
  set('next-up-after', liveSession
    ? 'started today, not saved yet'
    : 'after ' + next.after.name + ' \u00b7 ' + lastTrainedLabel(next.afterDate));
}

// Straight into the session the card is offering. Deliberately routed through the real tile's own
// handler rather than calling selectSession() directly: the tile owns the already-logged-today
// confirm, the selected highlight and the cardio branch, and a second copy of all that would drift
// out of step with it exactly like the seven copies showWorkoutView() replaced.
//
// The ORDER is the whole bug, 20 Aug 2026: "it goes to workout page first for a second then diverts
// to the next planned workout....not cool" (Del). This used to show the page and leave the session
// PICKER on screen while it did two network round trips - buildSessionGrid() and then the workouts
// row inside beginWorkoutSession() - so a tap on Start visibly landed on a choice he had not asked
// to make and then jumped off it again. On a slow gym connection that is not a flash, it is a wait
// on the wrong screen.
//
// Navigation still happens on the first line, because a tap that does nothing for two round trips
// is its own bug. What changed is what fills the gap: showWorkoutView('opening') runs synchronously
// straight after showPage(), so the browser never paints a frame with the picker in it, and the
// wait now names the session it is opening instead of offering three others.
async function startNextSession() {
  const s = nextUpSession;
  if (!s) return;
  showPage('workout');
  showWorkoutView('opening', s.name);

  // The 1-2s wait, 20 Aug 2026: "not happy with that either" (Del). Three network hops ran strictly
  // back to back - the grid build, then the open-rows read inside beginWorkoutSession(), then the
  // POST that creates the row. The first two are independent (one paints tiles, the other asks what
  // is already open today), so the read starts HERE and is handed down through btn.select() rather
  // than being fired once the grid has landed. Two hops deep instead of three.
  //
  // The POST is deliberately still behind the read: it is the read that decides whether a row needs
  // creating at all, and opening the logger before its row exists is the shape of the July cardio
  // loss. Del chose this over the instant version for exactly that reason.
  const openRows = fetchOpenWorkoutRows();

  await buildSessionGrid(s.programme);
  const btn = document.getElementById('session-btn-' + s.id);
  // The card offered a session the grid does not contain — a template deleted between Home
  // painting and Start being tapped. The picker is the honest fallback; a dead 'opening' panel
  // is not.
  if (!btn) { showWorkoutView('grid'); return; }   // openRows is dropped here — a spare GET, not a leak

  // Cancelling one of the two confirms inside here is a real answer, not a failure — but the
  // picker has already been left behind, so put it back rather than stranding him on 'opening'.
  if (!await btn.select(openRows)) showWorkoutView('grid');
}

async function buildSessionGrid(programmeId = null) {
  const grid = document.getElementById('session-grid');
  const sub = document.getElementById('workout-subtitle');
  if (!grid) return;

  // Programme picker first. Session picker second.
  if (!programmeId) {
    selectedProgramme = null;

    // Sessions saved out of an Open Workout sit on this top screen as their own tiles, under the name
    // they were given — not behind a "My Sessions" folder. They're one-off sessions you built yourself,
    // so burying them a tap deeper than the programmes made them harder to reach than the thing they
    // replaced. Fetched before the grid is cleared, same race discipline as the session branch below.
    const customSessions = SESSIONS.filter(s => s.programme === CUSTOM_PROGRAMME_ID);
    // Both in one round trip. lastMap is wanted unconditionally now (every tile carries a
    // last-trained line), doneToday still only when there are custom tiles that can show it.
    const [doneTodaySessions, lastMap] = await Promise.all([
      customSessions.length ? sessionsDoneToday() : Promise.resolve(new Set()),
      lastTrainedBySession()
    ]);

    grid.innerHTML = '';
    if (sub) sub.textContent = 'Choose your training programme';

    TRAINING_PROGRAMMES.forEach(p => {
      if (p.id === CUSTOM_PROGRAMME_ID) return;   // never a folder tile — see customSessions below
      const btn = document.createElement('div');
      btn.className = `session-btn programme-btn tinted sc-prog-${p.id}`;
      btn.id = `programme-btn-${p.id}`;
      // A programme's "last trained" is the most recent of any session inside it, and it names
      // which one — "last · Lower 1, today" answers what to do next better than a bare date does.
      let bestId = null, bestDate = null;
      SESSIONS.filter(s => s.programme === p.id).forEach(s => {
        const d = lastMap[s.id];
        if (d && (!bestDate || d > bestDate)) { bestDate = d; bestId = s.id; }
      });
      const bestName = bestId ? (getSessionById(bestId) || {}).name : null;
      const meta = bestDate && bestName
        ? `<div class="session-last">last · ${esc(bestName)}, ${esc(lastTrainedLabel(bestDate))}</div>`
        : '';
      btn.innerHTML = `<div class="session-name">${esc(p.name)}</div><div class="session-focus">${esc(p.focus)}</div>${meta}`;
      btn.onclick = () => showProgrammeSessions(p.id);
      grid.appendChild(btn);
    });

    const openBtn = document.createElement('div');
    openBtn.className = 'session-btn programme-btn tinted sc-open';
    openBtn.id = 'programme-btn-open';
    // 'open' is the session_type Open Workouts are written under — see sessionDisplayName().
    const openLast = lastTrainedLabel(lastMap['open']);
    openBtn.innerHTML = `<div class="session-name">Open Workout</div><div class="session-focus">Pick exercises as you go</div>` +
      (openLast ? `<div class="session-last">last · ${esc(openLast)}</div>` : '');
    openBtn.onclick = () => startOpenWorkout();
    grid.appendChild(openBtn);

    customSessions.forEach(s => grid.appendChild(sessionTile(s, doneTodaySessions, lastMap)));
    return;
  }

  selectedProgramme = programmeId;
  if (sub) sub.textContent = 'Choose your session';

  // Fetch data BEFORE clearing grid — prevents concurrent calls racing and both appending to same empty grid
  const [doneTodaySessions, lastMap] = await Promise.all([sessionsDoneToday(), lastTrainedBySession()]);
  grid.innerHTML = '';
  const sessions = SESSIONS.filter(s => s.programme === programmeId);

  // Full width, and deliberately left untinted: a half-width coloured "← Programmes" reads as a
  // fifth thing you could train.
  const back = document.createElement('div');
  back.className = 'session-btn grid-full';
  back.innerHTML = `<div class="session-name">← Programmes</div><div class="session-focus">Back to programme selection</div>`;
  back.onclick = () => resetSessionSelection(true);
  grid.appendChild(back);

  // Carries the colour of the tile you just tapped, so this screen visibly belongs to it.
  const prog = TRAINING_PROGRAMMES.find(p => p.id === programmeId);
  if (prog) {
    const band = document.createElement('div');
    band.className = `prog-band sc-prog-${prog.id}`;
    band.innerHTML = `<span class="prog-band-bar"></span><span class="prog-band-name">${esc(prog.name)}</span>` +
      `<span class="prog-band-count">${sessions.length} session${sessions.length === 1 ? '' : 's'}</span>`;
    grid.appendChild(band);
  }

  sessions.forEach(s => grid.appendChild(sessionTile(s, doneTodaySessions, lastMap)));
}

// One session tile. Shared by the programme's session list and the saved-session tiles on the top
// screen, so a saved session behaves exactly like a built-in one — same ✎ editor, same done state.
function sessionTile(s, doneTodaySessions, lastMap = {}) {
  const btn = document.createElement('div');
  btn.className = `session-btn tinted ${sessionColourClass(s)}`;
  btn.id = `session-btn-${s.id}`;
  const done = doneTodaySessions.has(s.id);
  if (done) btn.classList.add('done');
  const editBtn = s.cardio ? '' : `<button class="session-edit-btn" aria-label="Edit ${esc(s.name)} template" title="Edit template" onclick="event.stopPropagation(); openSessionEditor('${jsAttr(s.id)}')">✎</button>`;
  // "logged today" replaces the last-trained line rather than sitting under it — they'd both be
  // answering the same question, and today is the more useful answer.
  const last = lastTrainedLabel(lastMap[s.id]);
  const foot = done
    ? '<div class="session-last done">✓ logged today</div>'
    : (last ? `<div class="session-last">last · ${esc(last)}</div>` : '');
  btn.innerHTML = `${editBtn}<div class="session-name">${esc(s.name)}</div><div class="session-focus">${esc(s.focus)}</div>${foot}`;
  // The click handler is published on the element as well as bound to it. startNextSession() needs
  // to *await* entering the session and a synthetic .click() throws the promise away, but it must
  // not get there by calling selectSession() itself - that is the second copy the comment on
  // startNextSession() warns about. One call, reachable two ways.
  // The optional argument is startNextSession()'s in-flight open-rows read. A plain tap has no
  // prefetch to hand over, and onclick is wrapped rather than assigned so a MouseEvent never
  // arrives in its place.
  btn.select = (openRows = null) => selectSession(s, btn, openRows);
  btn.onclick = () => btn.select();
  return btn;
}

function showProgrammeSessions(programmeId) {
  selectedProgramme = programmeId;
  buildSessionGrid(programmeId);
}

// ─── SESSION TEMPLATE EDITOR ────────────────────────────────
// Permanent reorder / add / remove exercises / add-remove sets for a fixed session (Upper 1, etc).
// Works on a cloned buffer (editingTemplateExercises) — nothing touches the live SESSIONS/DB until Save.
//
// editingTemplateExercises is the BASE order — the order with no supersets applied, exactly like the
// logger's supersetBaseOrder. What's on screen is derived from it (templateDisplayOrder), so pairing
// never moves anything and unpairing needs no undo. Only ↑/↓ rewrites it. See the 14 Aug note on
// moveTemplateExercise for the bug that made this necessary.
let editingTemplateSessionId = null;
let editingTemplateExercises = [];
// Supersets saved into the template, as membership lists — same model as the in-gym `supersetGroups`,
// so the two behave identically and the editor's picker is the same picker. Rebuilt from each
// exercise's stored tag on open, written back out as tags on save.
let editingTemplateGroups = [];
let editingTemplatePickerFor = null;

function openSessionEditor(sessionId) {
  const session = getSessionById(sessionId);
  if (!session) return;
  editingTemplateSessionId = sessionId;
  editingTemplateExercises = session.exercises.map(e => ({ ...e }));
  const byTag = {};
  editingTemplateExercises.forEach(e => { if (e.supersetGroup) (byTag[e.supersetGroup] ||= []).push(e.name); });
  editingTemplateGroups = Object.values(byTag).filter(g => g.length > 1);
  editingTemplatePickerFor = null;
  document.getElementById('edit-session-title').textContent = `Edit ${session.name}`;
  const delLink = document.getElementById('delete-session-link');
  if (delLink) delLink.style.display = session.programme === CUSTOM_PROGRAMME_ID ? 'block' : 'none';
  renderTemplateEditorRows();
  document.getElementById('edit-session-modal').style.display = 'block';
}

function closeSessionEditor() {
  document.getElementById('edit-session-modal').style.display = 'none';
  editingTemplateSessionId = null;
  editingTemplateExercises = [];
  editingTemplateGroups = [];
  editingTemplatePickerFor = null;
}

// ── Template supersets ──
// Groups whose members are still in the template and still number 2+. A pairing whose partner has
// since been removed from the session is dormant, exactly as in the live logger.
function activeTemplateGroups() {
  const present = new Set(editingTemplateExercises.map(e => e.name));
  return editingTemplateGroups.map(g => g.filter(n => present.has(n))).filter(g => g.length > 1);
}

function templateGroupMap() {
  const map = {};
  activeTemplateGroups().forEach((g, i) => g.forEach(n => { map[n] = String(i + 1); }));
  return map;
}

function templateGroupOf(name) {
  return editingTemplateGroups.find(g => g.includes(name)) || null;
}

// The editor list chunked into what ↑/↓ actually move: a superset is ONE unit, a solo exercise is a
// unit of one. Mirrors displayExerciseOrder() in the live logger — a pair that snaps together on
// screen there has to stay together here, or the template shows an order the logger won't honour.
function templateUnits() {
  const groups = activeTemplateGroups();
  const groupOf = {};
  groups.forEach((g, i) => g.forEach(n => { groupOf[n] = i; }));
  const emitted = new Set();
  const units = [];
  editingTemplateExercises.forEach(ex => {
    if (emitted.has(ex.name)) return;
    const gi = groupOf[ex.name];
    if (gi === undefined) { units.push([ex.name]); emitted.add(ex.name); return; }
    const unit = groups[gi].filter(n => !emitted.has(n));
    unit.forEach(n => emitted.add(n));
    units.push(unit);
  });
  return units;
}

// What the editor actually shows: base order, with each superset emitted whole at the earliest slot
// any of its members holds. Pure function of base order + groups — the same shape as the logger's
// displayExerciseOrder(), and the reason pairing no longer has to move anything.
function templateDisplayOrder() {
  return templateUnits().flat();
}

function templateExerciseByName(name) {
  return editingTemplateExercises.find(e => e.name === name) || null;
}

function toggleTemplateSupersetPicker(name) {
  editingTemplatePickerFor = editingTemplatePickerFor === name ? null : name;
  renderTemplateEditorRows();
}

// Same one-group-per-exercise rule as pairSuperset(): pairing moves an exercise out of whatever
// group it was in rather than putting it in two at once.
function pairTemplateSuperset(name, partner) {
  if (name === partner) return;
  editingTemplateGroups = editingTemplateGroups.map(g => g.filter(n => n !== partner)).filter(g => g.length > 1);
  const group = templateGroupOf(name);
  if (group) group.push(partner);
  else editingTemplateGroups.push([name, partner]);
  editingTemplatePickerFor = null;
  renderTemplateEditorRows();   // the partner slides up next to its group on screen only — base order is untouched
}

function clearTemplateSuperset(name) {
  editingTemplateGroups = editingTemplateGroups.map(g => g.filter(n => n !== name)).filter(g => g.length > 1);
  editingTemplatePickerFor = null;
  renderTemplateEditorRows();   // drops back into its original slot, because that slot was never given up
}

function templateSupersetPickerHtml(name) {
  const group = templateGroupOf(name) || [];
  const partners = group.filter(n => n !== name);
  const others = editingTemplateExercises.map(e => e.name).filter(n => n !== name && !group.includes(n));

  let html = `<div class="ss-picker" style="display:block;">
    <div class="ss-picker-title">${partners.length ? 'Add another to this superset' : 'Superset with…'}</div>`;
  others.forEach(n => {
    const moving = (templateGroupOf(n) || []).filter(m => m !== n).length > 0;
    html += `<button type="button" class="ss-pick" onclick="pairTemplateSuperset('${jsAttr(name)}','${jsAttr(n)}')">${esc(n)}${moving ? '<span class="ss-pick-note">moves out of its current superset</span>' : ''}</button>`;
  });
  if (!others.length) html += `<div class="ss-picker-empty">Nothing else in this session to pair with.</div>`;

  // The half the editor was missing until 14 Aug: "superset this with something that isn't in the
  // template yet" was inexpressible here, so the nearest wrong name got picked instead — which is how
  // pairing Seated Calf Raise with Single Leg Curl grabbed Lower B's existing Leg Curl.
  html += `<select class="field-input ss-pick-add" onchange="addTemplateSupersetPartner('${jsAttr(name)}', this)">${exerciseAddOptionsHtml(editingTemplateExercises.map(e => e.name), '+ Something not in this session…')}</select>`;
  if (partners.length) {
    html += `<button type="button" class="ss-pick ss-pick-clear" onclick="clearTemplateSuperset('${jsAttr(name)}')">✕ Remove ${esc(name)} from this superset</button>`;
  }
  return html + `</div>`;
}

// Adds the exercise to the template and pairs it in one step — the template equivalent of the gym
// picker's addSupersetPartner(). Adding it lands it at the end of the base order; the pairing is what
// pulls it up next to its partner on screen, so unpairing later still returns it to the end.
async function addTemplateSupersetPartner(name, selectEl) {
  const val = selectEl.value;
  if (!val) return;
  selectEl.value = '';
  const partner = val === '__custom__' ? await promptTemplateCustomExercise() : val;
  if (!partner) return;
  if (val !== '__custom__') addTemplateExercise(partner);   // the custom path already adds it
  pairTemplateSuperset(name, partner);
}

function renderTemplateEditorRows() {
  const list = document.getElementById('edit-session-exercises');
  const groupMap = templateGroupMap();
  // ↑/↓ act on units, so they're disabled for every row of the first/last unit — not just the first
  // and last row. Otherwise the top half of a leading superset still offers an ↑ that can't move.
  const units = templateUnits();
  const unitIndex = {};
  units.forEach((u, ui) => u.forEach(n => { unitIndex[n] = ui; }));
  // Rows are keyed by NAME, not by index into editingTemplateExercises — the two orders are no longer
  // the same thing now that the display order is derived, and an index would act on the wrong row.
  list.innerHTML = templateDisplayOrder().map(exName => {
    const ex = templateExerciseByName(exName);
    if (!ex) return '';
    const tag = groupMap[ex.name];
    const partners = tag ? (templateGroupOf(ex.name) || []).filter(n => n !== ex.name && groupMap[n]) : [];
    const ui = unitIndex[ex.name] ?? 0;
    return `
    <div class="template-ex-row${tag ? ' in-superset' : ''}">
      <div class="template-ex-name">${esc(ex.name)}${tag ? `<span class="pf-ss">s/s ${esc(tag)}</span>` : ''}</div>
      <div class="template-ex-controls">
        <button type="button" class="btn btn-outline template-ex-btn" ${ui === 0 ? 'disabled' : ''} onclick="moveTemplateExercise('${jsAttr(ex.name)}', -1)" aria-label="Move up">↑</button>
        <button type="button" class="btn btn-outline template-ex-btn" ${ui === units.length - 1 ? 'disabled' : ''} onclick="moveTemplateExercise('${jsAttr(ex.name)}', 1)" aria-label="Move down">↓</button>
        <button type="button" class="btn btn-outline template-ex-btn" onclick="changeTemplateExerciseSets('${jsAttr(ex.name)}', -1)" aria-label="Remove set">−</button>
        <span class="template-ex-sets">${ex.sets} sets</span>
        <button type="button" class="btn btn-outline template-ex-btn" onclick="changeTemplateExerciseSets('${jsAttr(ex.name)}', 1)" aria-label="Add set">+</button>
        <button type="button" class="ex-remove-btn" onclick="removeTemplateExercise('${jsAttr(ex.name)}')" aria-label="Remove exercise" title="Remove">✕</button>
      </div>
      <button type="button" class="ss-btn${partners.length ? ' active' : ''}" onclick="toggleTemplateSupersetPicker('${jsAttr(ex.name)}')">${partners.length ? `⇄ Superset with ${esc(partners.join(' + '))}` : '⇄ Superset'}</button>
      ${editingTemplatePickerFor === ex.name ? templateSupersetPickerHtml(ex.name) : ''}
    </div>`;
  }).join('') || '<div class="empty">No exercises — add one below</div>';
  const addRow = document.getElementById('edit-session-add-row');
  if (addRow) addRow.innerHTML = templateAddExerciseOptionsHtml();
}

// Moves the whole superset the exercise belongs to, never one half of it. Plain adjacent-swap was
// the bug: nudging an s/s member up stepped it over its own partner, leaving the tag intact but the
// two rows split apart — and the logger would silently snap them back together on the day anyway.
//
// This is the ONLY thing that rewrites the base order, and deliberately so: ↑/↓ is Del saying "this
// block belongs here", which should stick. Pairing is not, which is why it no longer touches it.
// The rewrite swaps the two units *within the slots those units already occupy*, so every exercise
// not involved in the move — including the members of other supersets — keeps its base position and
// can still be unpaired back into it.
function moveTemplateExercise(name, dir) {
  if (!templateExerciseByName(name)) return;
  const units = templateUnits();
  const u = units.findIndex(unit => unit.includes(name));
  const target = u + dir;
  if (u < 0 || target < 0 || target >= units.length) return;

  const seq = dir < 0 ? [...units[u], ...units[target]] : [...units[target], ...units[u]];
  const moving = new Set(seq);
  const order = editingTemplateExercises.map(e => e.name);
  const slots = order.reduce((acc, n, i) => (moving.has(n) ? [...acc, i] : acc), []);
  slots.forEach((slot, k) => { order[slot] = seq[k]; });

  const byName = {};
  editingTemplateExercises.forEach(e => { byName[e.name] = e; });
  editingTemplateExercises = order.map(n => byName[n]).filter(Boolean);
  renderTemplateEditorRows();
}

function changeTemplateExerciseSets(name, delta) {
  const ex = templateExerciseByName(name);
  if (!ex) return;
  ex.sets = Math.max(1, ex.sets + delta);
  renderTemplateEditorRows();
}

function removeTemplateExercise(name) {
  editingTemplateExercises = editingTemplateExercises.filter(e => e.name !== name);
  renderTemplateEditorRows();
}

// The three add-an-exercise dropdowns — the template editor's, the in-gym superset picker's and the
// template superset picker's — are the same list of everything not already chosen, plus the type-it-in
// option. They differ only in the placeholder, so they share one builder rather than drifting apart
// the way the two cardio renderers did.
function exerciseAddOptionsHtml(chosenNames, placeholder) {
  const chosen = new Set(chosenNames);
  const names = Object.keys(EXERCISE_LIBRARY).filter(n => !chosen.has(n)).sort();
  let opts = `<option value="" selected disabled>${esc(placeholder)}</option>`;
  names.forEach(n => { opts += `<option value="${esc(n)}">${esc(n)}</option>`; });
  return opts + `<option value="__custom__">+ Type a new exercise…</option>`;
}

function templateAddExerciseOptionsHtml() {
  return exerciseAddOptionsHtml(editingTemplateExercises.map(e => e.name), 'Add an exercise…');
}

async function handleTemplateExerciseSelect(selectEl) {
  const val = selectEl.value;
  if (!val) return;
  if (val === '__custom__') {
    await promptTemplateCustomExercise();
  } else {
    addTemplateExercise(val);
  }
}

function addTemplateExercise(name) {
  if (editingTemplateExercises.some(e => e.name === name)) return;
  editingTemplateExercises.push({ ...(EXERCISE_LIBRARY[name] || { name, sets: 3, reps: '8–12', rest: '90s' }) });
  renderTemplateEditorRows();
}

// Same validation/persistence as Open Workout's promptCustomExercise() — names flow into inline
// onclick handlers throughout the app, so quote characters are rejected client-side.
async function promptTemplateCustomExercise() {
  const raw = prompt('Exercise name:');
  renderTemplateEditorRows();  // reset dropdown back to placeholder regardless of outcome
  const name = raw ? raw.trim() : '';
  if (!name) return;
  if (/['"`]/.test(name)) {
    showToast(`Avoid quotes/apostrophes in exercise names — try again without them`, 'error');
    return;
  }
  if (EXERCISE_LIBRARY[name] || editingTemplateExercises.some(e => e.name === name)) {
    showToast(`${name} already exists — pick it from the dropdown`, 'error');
    return;
  }
  await registerNewExercise(name);
  addTemplateExercise(name);
  return name;   // so the superset picker can pair with what was just typed in
}

// Delete-all-then-reinsert for this session's exercises — same idiom completeExercise() already
// uses for idempotent re-saves, and far simpler than diffing individual reorder/add/remove ops.
async function saveSessionTemplate() {
  if (!editingTemplateSessionId) return;
  const id = editingTemplateSessionId;
  const delRes = await sb(`session_exercises?session_id=eq.${id}`, 'DELETE', null, { quiet: true });
  if (!delRes.ok) { showToast(`Save failed (${delRes.status})`, 'error'); return; }
  const groupMap = templateGroupMap();   // presence-filtered, so a removed partner can't leave a tag behind
  // sort_order is the BASE order, not what's on screen: the pairs are stored as tags and both the
  // editor and the logger re-derive the together-on-screen order from them on open. Writing the
  // derived order instead would bake a pairing into the sort permanently, so unpairing next week
  // would leave the exercise stranded next to its ex-partner — the 13 Aug Lower B bug, one save later.
  const rows = editingTemplateExercises.map((ex, i) => ({
    session_id: id, name: ex.name, ...exerciseIdFields(ex.name), sets: ex.sets, reps: ex.reps, rest: ex.rest,
    note: ex.note ?? null, variations: ex.variations ?? null, aliases: ex.aliases ?? null,
    band: !!ex.band, bodyweight: !!ex.bodyweight, sort_order: i,
    superset_group: groupMap[ex.name] || null
  }));
  if (rows.length) {
    const postRes = await sb('session_exercises', 'POST', rows, { quiet: true });
    if (!postRes.ok) { showToast(`Save failed (${postRes.status})`, 'error'); return; }
  }
  await loadSessionTemplates();
  lastTemplateRefresh = Date.now();   // freshest read there is — don't let a foreground redo it
  EXERCISE_LIBRARY = buildExerciseLibrary();
  closeSessionEditor();
  showToast('Template updated', 'success');

  // The ✎ link also sits INSIDE the logger ("Reorder / add / remove exercises for this session"),
  // and until now saving from there changed the template, changed the grid, and changed nothing you
  // could see: the logger runs off a clone taken when the tile was tapped, so the session you were
  // standing in carried on with the old exercise list until you left the screen and came back.
  //
  // Re-clone and rebuild it. Nothing is lost — buildWorkoutLogger() re-hydrates from the draft and
  // from the sets already saved against currentWorkoutId, the same path a mid-session browser
  // refresh takes — and the superset state is reset first so it re-derives exactly as a fresh entry
  // would (draft first, then the template's tags, then the saved sets) rather than keeping a
  // pairing that was just unpaired in the editor. Scroll position is put back: being thrown to the
  // top of a long session between sets is its own small bug.
  const loggerShowingThisSession = selectedSession && selectedSession.id === id
    && document.getElementById('workout-logger').style.display !== 'none';
  if (loggerShowingThisSession) {
    const fresh = getSessionById(id);
    if (fresh) {
      const y = window.scrollY;
      supersetGroups = [];
      supersetsTouched = false;
      selectedSession = { ...fresh, exercises: fresh.exercises.map(e => ({ ...e })) };
      await buildWorkoutLogger(selectedSession);
      window.scrollTo(0, y);
    }
  }
  buildSessionGrid(selectedProgramme);
}

// ─── THE APP'S OWN CONFIRM ────────────────────────────────
// Eight yes/no questions used to go through the browser's native confirm(). On 19 Aug 2026 Del hit
// one of them on Home and what he saw was an OS dialog captioned "delpedro.github.io says" sitting
// on top of a hand-built app — the same objection a native <select> got on 17 Aug, and the one part
// of the app that had no design language on it at all.
//
// This is a drop-in: it returns a promise, so `if (!confirm(x)) return;` became
// `if (!await askConfirm({...})) return;` and nothing else about the call sites moved. Seven of the
// eight callers were already async; only resetSessionSelection() had to become one, and all three
// of its callers are fire-and-forget click handlers.
//
// Labels say what the button DOES ("Finish without them", "Go back") rather than OK/Cancel, because
// a two-button dialog is read fastest when the buttons make sense without the question above them.
// Text goes in through textContent, never innerHTML — session and exercise names are user-typed.
let confirmResolve = null;

function askConfirm({ title, body = '', yes = 'OK', no = 'Cancel', danger = false }) {
  // A second question asked while one is open would strand the first promise forever, and an
  // await that never settles is a frozen screen. Answer the old one "no": every one of these
  // guards an action, so no is always the safe direction.
  if (confirmResolve) { const stale = confirmResolve; confirmResolve = null; stale(false); }

  const modal = document.getElementById('confirm-modal');
  const bodyEl = document.getElementById('confirm-body');
  const yesBtn = document.getElementById('confirm-yes');
  const noBtn = document.getElementById('confirm-no');
  document.getElementById('confirm-title').textContent = title;
  bodyEl.textContent = body;
  bodyEl.style.display = body ? 'block' : 'none';
  yesBtn.textContent = yes;
  noBtn.textContent = no;
  yesBtn.classList.toggle('confirm-yes-danger', !!danger);

  const settle = (answer) => {
    modal.style.display = 'none';
    const done = confirmResolve;
    confirmResolve = null;
    if (done) done(answer);
  };
  // Assigned, not addEventListener: assignment replaces, so re-opening the dialog can never leave
  // two handlers on one button resolving two different promises.
  yesBtn.onclick = () => settle(true);
  noBtn.onclick = () => settle(false);
  // The backdrop is a cancel. `e.target === modal` and not a closest() check, so a tap that lands
  // on the card itself — or on a button inside it — never reads as one.
  modal.onclick = (e) => { if (e.target === modal) settle(false); };

  modal.style.display = 'block';
  return new Promise(resolve => { confirmResolve = resolve; });
}

// Today's workouts rows that were never completed. Split out of beginWorkoutSession() so a caller
// that knows a session is coming can start it early and overlap it with its own work — see
// startNextSession(). Always resolves to an array: sb() already turns a failed GET into [], and the
// catch covers a malformed body, because every caller reads this as "nothing is open".
function fetchOpenWorkoutRows() {
  return sb(`workouts?date=eq.${todayStr()}&completed_at=is.null&select=id,session_type,notes,workout_sets(id),cardio_logs(id)`)
    .then(rows => rows || [])
    .catch(() => []);
}

// Resolves in-progress/resume/warn-and-switch and eagerly creates the workout row.
// Sets selectedSession/selectedVariations/currentWorkoutId/currentWorkoutHasSets on success.
// Shared by selectSession() (fixed sessions) and startOpenWorkout() (Open Workout).
async function beginWorkoutSession(session, openRowsPrefetch = null) {
  // Which of today's rows, if any, is a session ACTUALLY under way.
  //
  // `completed_at IS NULL` is not the answer on its own, and believing it was is the 19 Aug bug: a
  // workouts row is created the instant a tile is tapped, and only the ← control deletes it again on
  // the way out. Leave the logger by the bottom nav instead and the empty row survives until
  // autoCloseStaleWorkouts() reaches it 24h later — so one stray tap on Open Workout at 15:10 made
  // every session start for the rest of the day warn about an Open Workout with nothing in it.
  //
  // The rule is the counters' rule (workoutRowHasContent) plus the draft, because a session you are
  // standing in the middle of can have no rows yet. Anything failing both is a ghost: deleted on
  // sight rather than left to ask the question again tomorrow.
  //
  // The caller may already have this in flight (startNextSession does) — awaiting a promise that has
  // been running for 400ms costs nothing, so both paths share one query and one set of rules.
  const openRows = await (openRowsPrefetch || fetchOpenWorkoutRows());

  // A row for the session being tapped is kept whether or not it has anything in it — it is about to
  // be resumed, so adopting it is cheaper than deleting it and posting a replacement.
  const sameSession = openRows.find(w => w.session_type === session.id);
  const ghosts = openRows.filter(w =>
    w !== sameSession && !workoutRowHasContent(w) && !draftHasContentFor(w.session_type));
  // quiet + not awaited: housekeeping. If a delete fails the row is still invisible everywhere that
  // matters (realWorkoutsBetween hides it) and autoCloseStaleWorkouts() closes it within the day.
  ghosts.forEach(w => sb(`workouts?id=eq.${w.id}`, 'DELETE', null, { quiet: true }));

  const inProgress = openRows.filter(w => !ghosts.includes(w));

  if (inProgress.length > 0) {
    const existing = sameSession || inProgress[0];

    if (existing.session_type === session.id) {
      // SAME session tapped — silently adopt the existing workout row.
      // buildWorkoutLogger + restoreDraft will rehydrate inputs & rest times.
      currentWorkoutId = existing.id;
      // Read from the row rather than assuming true: adopting an empty one and backing out again
      // should still bin it, which is what this flag gates at backToSessions().
      currentWorkoutHasSets = (existing.workout_sets || []).length > 0;
    } else {
      // DIFFERENT session tapped — warn before abandoning the in-progress one.
      const existingName = sessionDisplayName(existing.session_type);
      const go = await askConfirm({
        title: `${existingName} is still open`,
        body: `Starting ${session.name} leaves it exactly where it is — nothing is lost, and you can pick it up again later.`,
        yes: `Start ${session.name}`,
        no: 'Cancel',
      });
      if (!go) {
        return false;
      }
      currentWorkoutId = await createWorkoutRow(session.id);
      currentWorkoutHasSets = false;
      if (!currentWorkoutId) { showToast('Could not start session — check connection and try again', 'error'); return false; }
    }
  } else {
    currentWorkoutId = await createWorkoutRow(session.id);
    currentWorkoutHasSets = false;
    if (!currentWorkoutId) { showToast('Could not start session — check connection and try again', 'error'); return false; }
  }

  selectedSession = session;
  selectedVariations = {};
  removedSessionExercises = [];
  supersetGroups = [];
  supersetBaseOrder = [];
  supersetsTouched = false;
  return true;
}

// ─── WHICH OF THE THREE WORKOUT VIEWS IS ON SCREEN (18 Aug 2026) ──────────────────────────────
// The Workout page is three mutually exclusive panels — the session grid, the logger, and the CV +
// Pump form — plus the pill that names the session you're in. Every entry and exit point used to
// set those four `style.display`s by hand, six copies of the same four lines, and they had already
// drifted: saveWorkout() set the grid back but never hid the pill, so finishing a workout left you
// on the picker with the finished session's name still stuck to the top of it. One function now
// owns all four, which is what makes that class of bug impossible rather than merely fixed.
// 'opening' is the fourth mode and the odd one out: it is not a place you can be left, it is the
// two round trips between tapping Start on the Next up card and the logger existing. It keeps the
// pill, because the pill already answers the only question worth asking while you wait - which
// session is this.
function showWorkoutView(mode, sessionName = '') {
  const grid = mode === 'grid';
  document.getElementById('session-grid').style.display = grid ? 'grid' : 'none';
  document.getElementById('session-pill').style.display = grid ? 'none' : 'flex';
  document.getElementById('workout-logger').style.display = mode === 'logger' ? 'block' : 'none';
  document.getElementById('conditioning-form').style.display = mode === 'conditioning' ? 'block' : 'none';
  document.getElementById('workout-opening').style.display = mode === 'opening' ? 'block' : 'none';
  // The subtitle is the picker's caption — "Choose your training programme" — so it belongs to the
  // grid and to nothing else. An instruction to choose, sitting directly above a panel saying the
  // choice is already made, is the same contradiction in words that the visible picker was in
  // pixels. It was hidden for 'opening' on 21 Aug and left showing over the logger; Del read that
  // screen back on 23 Aug and it was the first line his eye landed on.
  document.getElementById('workout-subtitle').style.display = grid ? 'block' : 'none';
  if (!grid) document.getElementById('session-pill-name').textContent = sessionName;
}

// Returns whether a session was actually entered. Both ways out are a deliberate choice by Del -
// cancelling the already-logged-today confirm, or cancelling the in-progress warning inside
// beginWorkoutSession() - and the caller has to be able to tell that apart from success, because
// startNextSession() has already left the picker behind by then and needs somewhere to put him.
async function selectSession(session, btn, openRows = null) {
  if (btn.classList.contains('done')) {
    const again = await askConfirm({
      title: `${session.name} is already logged today`,
      body: 'Logging it again adds a second session to today rather than editing the first.',
      yes: 'Log it again',
      no: 'Cancel',
    });
    if (!again) return false;
  }

  if (session.cardio) {
    selectedSession = session;
    selectedVariations = {};
    document.querySelectorAll('.session-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    currentWorkoutId = null;
    currentWorkoutHasSets = false;

    showWorkoutView('conditioning', session.name);
    return true;
  }

  // Clone before mutating — `session` here is the live SESSIONS array element (see buildSessionGrid),
  // and the live logger now allows a one-off add/remove exercise for today only (same mechanic Open
  // Workout already had). Mutating the shared object directly would silently edit the template in
  // memory for the rest of the browser session.
  const sessionCopy = { ...session, exercises: session.exercises.map(ex => ({ ...ex })) };

  const ok = await beginWorkoutSession(sessionCopy, openRows);
  if (!ok) return false;

  document.querySelectorAll('.session-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');

  showWorkoutView('logger', sessionCopy.name);
  buildWorkoutLogger(sessionCopy);
  return true;
}

// 'open' (Open Workout) is deliberately not in SESSIONS — its exercise list is per-workout, not fixed.
function sessionDisplayName(sessionType) {
  if (sessionType === 'open') return 'Open Workout';
  const known = SESSIONS.find(s => s.id === sessionType)?.name;
  if (known) return known;
  // Template since deleted (a "My Sessions" one) — History still holds the id, so un-slug it
  // rather than printing "arms-blast" on the card.
  return (sessionType || '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Rebuilds a { exercises: [...] } shape from actually-saved sets — for session types not in SESSIONS
// (currently just 'open'), and for History editing of ANY session type (see openEditWorkout), since
// membership/order/set-count must reflect what was actually logged, not whatever the live template
// currently looks like. `metaByName` (optional) supplies per-exercise display metadata (variations,
// bodyweight, band, reps/rest labels) keyed by exercise name/alias — falls back to the current
// EXERCISE_LIBRARY, then to a bare shape if the exercise isn't known anywhere.
function reconstructSessionFromSets(sets, metaByName) {
  const byExercise = {};
  (sets || []).forEach(s => {
    if (!byExercise[s.exercise]) byExercise[s.exercise] = 0;
    byExercise[s.exercise] = Math.max(byExercise[s.exercise], s.set_number);
  });
  const exercises = Object.keys(byExercise).map(name => {
    const meta = (metaByName && metaByName[name]) || EXERCISE_LIBRARY[name];
    return meta ? { ...meta, sets: byExercise[name] } : { name, sets: byExercise[name], reps: '', rest: '' };
  });
  return { exercises };
}

// ─── TIMED EXERCISES ──────────────────────────────────────
// Some exercises are held, not repped (deadhangs). session_exercises only stores sets/reps, so
// timed-ness is resolved by name here rather than by a new schema column: the second input still
// writes to workout_sets.reps, but it MEANS SECONDS and renders as "45s" everywhere sets are shown.
// Timed exercises are also treated as bodyweight — no kg box, weight saved as null.
// To make an exercise timed, add its name (any casing/spacing) here with its default target.
const TIMED_EXERCISES = {
  'deadhang': '30–45s',
  'deadhangs': '30–45s',
  'dead hang': '30–45s',
  'dead hangs': '30–45s',
  // Added 18 Aug 2026 with the programme review. Side Plank is a pure hold; Farmers Walk is a hold
  // that is also loaded, so it appears in OPTIONAL_WEIGHT_EXERCISES too — timed alone would force
  // the weight to null and the kg you carried would never be saved.
  'side plank': '30–45s',
  'side planks': '30–45s',
  'farmers walk': '40s',
  'farmers walks': '40s',
  'farmer walk': '40s'
};

// The default time target for a timed exercise, or null if it isn't timed.
function timedTarget(ex) {
  const name = typeof ex === 'string' ? ex : ex?.name;
  return TIMED_EXERCISES[(name || '').trim().toLowerCase()] || null;
}
function isTimed(ex) { return timedTarget(ex) !== null; }

// True when a target already reads as a duration ("40s", "30–45s", "30 secs"), in which case the
// pill shows it as written rather than replacing it with the default. The test used to be `/s\b/`,
// which matched any word ending in "s" — "12 reps", "3 holds" — so a timed exercise with a
// worded target silently kept it instead of showing its time. A digit has to come first now.
function looksLikeSeconds(reps) {
  return /\d\s*s(ecs?|econds?)?\b/i.test(reps || '');
}

// ─── OPTIONAL-WEIGHT EXERCISES ────────────────────────────
// Bodyweight lifts that can also be loaded (pull-ups with a belt/DB). These keep a normal kg box
// instead of a fixed "BW" label: leave it blank for bodyweight (saved as null, shown as "BW×10"),
// or type the added weight. Add a name here — any casing/spacing — to give it that box.
const OPTIONAL_WEIGHT_EXERCISES = [
  'pullup', 'pullups', 'pull up', 'pull ups', 'pull-up', 'pull-ups',
  'chinup', 'chinups', 'chin up', 'chin ups', 'chin-up', 'chin-ups',
  'dip', 'dips',
  // Timed *and* optionally loaded — a deadhang can be hung with a DB/belt. The two lists stack:
  // reps still mean seconds (TIMED_EXERCISES), the weight column just stops being a fixed "BW".
  'deadhang', 'deadhangs', 'dead hang', 'dead hangs',
  // A carry is the same shape as a deadhang: timed, and the whole point is the load. Without this
  // the weight column is forced to null and a Farmers Walk can never show progression.
  'farmers walk', 'farmers walks', 'farmer walk'
];
function isOptionalWeight(ex) {
  const name = typeof ex === 'string' ? ex : ex?.name;
  return OPTIONAL_WEIGHT_EXERCISES.includes((name || '').trim().toLowerCase());
}

// What to store in workout_sets.weight for a typed-in weight box.
//
// The box is free text — the optional-weight ones are literally labelled "BW / kg" — so anything
// non-numeric has to be turned into null HERE, before it reaches a numeric column. Typing "BW" into
// a Dips row used to pass the string straight through to PostgREST, which rejected the whole insert
// with a 400: that one exercise saved nothing while every other block sat green, so the workout
// looked finished and wasn't. Blank means bodyweight, "BW" means bodyweight, and bodyweight is null.
//
// A typed 0 on an optional-weight exercise means the same thing ("no added weight") — storing a real
// 0 leaves a "0kg" row that reads as a load in the edit modal and has to be corrected by hand.
function optionalWeightValue(ex, wVal) {
  const n = parseFloat(String(wVal ?? '').trim());
  if (!Number.isFinite(n)) return null;
  if (n === 0 && isOptionalWeight(ex)) return null;
  return n;
}

// ─── THE BODYWEIGHT CELL (19 Aug 2026) ────────────────────────────────────────────────────────
// Pull ups, dips, deadhangs and farmers walks can be done at bodyweight OR loaded, so their weight
// box is optional. It used to be a text input placeheld "BW / kg" with inputmode="decimal", and
// that was wrong in two compounding ways, both of which Del hit on 18 Aug:
//
//   1. inputmode="decimal" gives iOS a keypad with no letters on it, so the word the placeholder
//      was asking for could not physically be typed.
//   2. It never needed to be typed. Blank has always meant bodyweight — see optionalWeightValue()
//      above, which maps blank, "BW" and a typed 0 to the same null — but nothing on screen said
//      so, so an empty box read as "not filled in yet" rather than as "bodyweight".
//
// The owner of the app, four months and several hundred sets in, could not tell which. A stranger
// on their first session has no chance at all. So the cell now STATES its state instead of relying
// on a convention: it reads "BW" until you tap it, tapping turns it into the kg box, and emptying
// the box turns it back into "BW". There is no longer any such thing as an ambiguous blank.
//
// The <input> is only ever HIDDEN, never removed. Six other functions locate this set's weight with
// getElementById('w-…') and branch on `.tagName` — collectExerciseSets, saveDraft, restoreDraft,
// the resume-saved-sets fill, the unsaved-work guard, and the edit modal's save — and every one of
// them already treats an empty INPUT as bodyweight. Keeping the element in the DOM meant none of
// them had to learn a new state, which is the difference between this fix and a rewrite.
function bwCellHtml(id, value, extraAttrs = '') {
  const loaded = String(value ?? '').trim() !== '';
  return `<div class="bw-cell">
      <button type="button" class="bw-pill" id="bwbtn-${id}" ${loaded ? 'hidden' : ''}
        onclick="bwReveal('${jsAttr(id)}')"
        title="Bodyweight — tap to add weight" aria-label="Bodyweight. Tap to add weight.">BW</button>
      <input type="text" class="set-input bw-input" id="${id}" placeholder="kg" inputmode="decimal"
        value="${esc(value ?? '')}" ${loaded ? '' : 'hidden'}
        onblur="bwCollapse('${jsAttr(id)}')" ${extraAttrs} />
    </div>`;
}

function bwReveal(id) {
  const input = document.getElementById(id);
  const btn = document.getElementById(`bwbtn-${id}`);
  if (!input || !btn) return;
  btn.hidden = true;
  input.hidden = false;
  input.focus();
}

// Emptying the box is how you go back to bodyweight — so the cell has to reclaim its BW face when
// you leave an empty one, or you would be looking at a blank box again and back where we started.
function bwCollapse(id) {
  const input = document.getElementById(id);
  const btn = document.getElementById(`bwbtn-${id}`);
  if (!input || !btn || input.value.trim() !== '') return;
  input.hidden = true;
  btn.hidden = false;
}

// Draft restore and the resume-a-saved-session fill both write straight into the input with
// `wEl.value = …`, which fires no event of any kind. Without this sweep afterwards, a loaded dip
// resumed mid-session would have its weight sitting in a box that is still hidden behind "BW".
function bwSyncAll() {
  document.querySelectorAll('.bw-cell').forEach(cell => {
    const input = cell.querySelector('.bw-input');
    const btn = cell.querySelector('.bw-pill');
    if (!input || !btn) return;
    const loaded = input.value.trim() !== '';
    input.hidden = !loaded;
    btn.hidden = loaded;
  });
}

// One logged set rendered for display: "45s" (or "10×45s" when the hold carried added weight)
// when timed, else "80×10" / "BW×10" / band initials.
function setValueLabel(ex, s, bandFallback = 'Band') {
  if (!s) return '—';
  if (isTimed(ex)) {
    if (s.reps == null) return '—';
    return parseFloat(s.weight) > 0 ? `${s.weight}×${s.reps}s` : `${s.reps}s`;
  }
  const label = ex.band ? (s.variation || bandFallback).split(' ').map(w => w[0]).join('') : (s.weight ?? 'BW');
  return `${label}×${s.reps}`;
}

// Which of an exercise's previous sets belong to the variation currently selected.
//
// `previousSets[name]` is a CONCATENATION: the most recent workout's sets, then any other variation
// backfilled from its own most recent occurrence (see loadPreviousSetsForSession). So it is a mixed
// list and slicing it by set index without filtering reads rows from two different sessions.
//
// The old rule was `filter(variation) || everything`, and the fallback is what Del caught on 14 Aug:
// Leg Curl has never been logged as "Machine", so selecting Machine matched nothing, fell back to the
// whole list, and showed the "Single Leg" numbers — 52×13 / 54×10 / 54×10 — under a Machine heading.
// Toggling between the two variations showed IDENTICAL past numbers, which is what made it obvious.
// That is worse than showing nothing: the badge is what you load the machine off, and a variation you
// have never done is exactly where a borrowed number does damage.
//
// Untagged rows are still a legitimate fallback. Variations were added to an exercise after months of
// logging, so its older rows carry `variation: null` — they are that exercise, unspecified, not some
// other variation of it. A named variation's rows never stand in for a different named variation.
function prevSetsForVariation(prev, variation) {
  const exact = prev.filter(p => p.variation === variation);
  if (exact.length) return exact;
  return prev.filter(p => !p.variation);
}

// ─── SUPERSETS ────────────────────────────────────────────
// Two (or more) exercises done back-to-back with no rest between them. There's no pairing UI in the
// template — a superset is decided in the moment, in the gym — so it's per-workout state. The partner
// is whatever you actually picked up, so tapping "⇄" opens a picker of every other exercise in today's
// session (plus a way to pull in one that isn't in it yet); the group then snaps together on screen so
// you're not scrolling between two distant blocks on every set.
// Persisted as workout_sets.superset_group: every set of every exercise in one group shares a tag
// ('1', '2', … scoped to that workout); null means an ordinary standalone exercise.

// Groups whose members are actually still in the session, and still number 2+. A group left with one
// member (its partner was removed for today) is dormant, not a superset — it neither tags nor snaps.
function activeSupersetGroups() {
  const present = new Set((selectedSession?.exercises || []).map(e => e.name));
  return supersetGroups.map(g => g.filter(n => present.has(n))).filter(g => g.length > 1);
}

// {exerciseName: groupTag} for the active groups. Exercises not in one are absent from the map.
function supersetGroupMap() {
  const map = {};
  activeSupersetGroups().forEach((g, i) => g.forEach(n => { map[n] = String(i + 1); }));
  return map;
}

// The stored group this exercise belongs to (live reference — callers push into it), or null.
function supersetGroupOf(exName) {
  return supersetGroups.find(g => g.includes(exName)) || null;
}

// Display order: base order, except that reaching the first member of a group emits the whole group
// together. A pure function of base order + groups, which is what makes unpairing restore the original
// position for free. The group keeps the order it was built in — you tap ⇄ on the lift you do first —
// while sitting at the earliest slot any of its members held.
function displayExerciseOrder() {
  const groups = activeSupersetGroups();
  const groupOf = {};
  groups.forEach((g, i) => g.forEach(n => { groupOf[n] = i; }));
  const emitted = new Set();
  const order = [];
  supersetBaseOrder.forEach(name => {
    if (emitted.has(name)) return;
    const gi = groupOf[name];
    if (gi === undefined) { order.push(name); emitted.add(name); return; }
    groups[gi].forEach(n => { if (!emitted.has(n)) { order.push(n); emitted.add(n); } });
  });
  return order;
}

// Reorders selectedSession.exercises and the rendered blocks to match displayExerciseOrder(). Moves
// the existing DOM nodes rather than re-rendering, so typed-but-unsaved inputs, done state and any
// live rest timer all survive a pairing. Safe to call before the blocks exist (initial render).
function applySupersetOrder() {
  if (!selectedSession) return;
  const order = displayExerciseOrder();
  const byName = {};
  selectedSession.exercises.forEach(e => { byName[e.name] = e; });
  selectedSession.exercises = order.map(n => byName[n]).filter(Boolean);

  const logger = document.getElementById('workout-logger');
  if (!logger) return;
  const blocks = order.map(n => document.getElementById(`block-${n}`)).filter(Boolean);
  if (!blocks.length) return;
  // Anchor on wherever the first block currently sits (below the ✎ link / Last time card), then
  // chain the rest after it. Only nodes actually out of place get moved.
  const firstRendered = logger.querySelector('.exercise-block');
  if (firstRendered && firstRendered !== blocks[0]) logger.insertBefore(blocks[0], firstRendered);
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i - 1].nextElementSibling !== blocks[i]) {
      logger.insertBefore(blocks[i], blocks[i - 1].nextElementSibling);
    }
  }
}

function renderSupersetControl(ex) {
  return `<button type="button" class="ss-btn" id="ss-${esc(ex.name)}" onclick="toggleSupersetPicker('${jsAttr(ex.name)}')">⇄ Superset</button>
    <div class="ss-picker" id="ss-picker-${esc(ex.name)}" style="display:none;"></div>`;
}

// One picker open at a time — two expanded lists on a phone screen is just noise.
function toggleSupersetPicker(exName) {
  const panel = document.getElementById(`ss-picker-${exName}`);
  if (!panel) return;
  const wasOpen = panel.style.display !== 'none';
  closeSupersetPickers();
  if (wasOpen) return;
  panel.innerHTML = supersetPickerHtml(exName);   // built on open, so the list is never stale
  panel.style.display = '';
}

function closeSupersetPickers() {
  document.querySelectorAll('.ss-picker').forEach(p => { p.style.display = 'none'; });
}

function supersetPickerHtml(exName) {
  const group = supersetGroupOf(exName) || [];
  const partners = group.filter(n => n !== exName);
  const others = (selectedSession?.exercises || []).map(e => e.name)
    .filter(n => n !== exName && !group.includes(n));

  let html = `<div class="ss-picker-title">${partners.length ? 'Add another to this superset' : 'Superset with…'}</div>`;
  others.forEach(n => {
    // Flagged because an exercise belongs to exactly one group — pairing it here moves it out of the
    // group it's currently in rather than putting it in two at once.
    const moving = (supersetGroupOf(n) || []).filter(m => m !== n).length > 0;
    html += `<button type="button" class="ss-pick" onclick="pairSuperset('${jsAttr(exName)}','${jsAttr(n)}')">${esc(n)}${moving ? `<span class="ss-pick-note">moves out of its current superset</span>` : ''}</button>`;
  });
  if (!others.length) html += `<div class="ss-picker-empty">Nothing else in this session yet.</div>`;

  html += `<select class="field-input ss-pick-add" onchange="addSupersetPartner('${jsAttr(exName)}', this)">${supersetAddOptionsHtml()}</select>`;
  if (partners.length) {
    html += `<button type="button" class="ss-pick ss-pick-clear" onclick="clearSuperset('${jsAttr(exName)}')">✕ Remove ${esc(exName)} from this superset</button>`;
  }
  return html;
}

function supersetAddOptionsHtml() {
  return exerciseAddOptionsHtml((selectedSession?.exercises || []).map(e => e.name), '+ Something not in this session…');
}

// Adds an exercise to today's session and pairs it in one go — the whole point being that the lift you
// superset with often isn't on the template at all.
async function addSupersetPartner(exName, selectEl) {
  const val = selectEl.value;
  if (!val) return;
  selectEl.value = '';
  const name = val === '__custom__' ? await promptCustomExercise() : val;
  if (!name) return;
  if (val !== '__custom__') await addOpenExercise(name);   // the custom path already adds it
  pairSuperset(exName, name);
}

// Puts `partner` in exName's group, creating one if neither is grouped yet. An exercise belongs to
// exactly one group, so this moves it rather than splitting it across two.
function pairSuperset(exName, partner) {
  if (exName === partner) return;
  supersetGroups = supersetGroups.map(g => g.filter(n => n !== partner)).filter(g => g.length > 1);
  const group = supersetGroupOf(exName);
  if (group) group.push(partner);
  else supersetGroups.push([exName, partner]);
  supersetsTouched = true;
  afterSupersetChange();
}

// Drops this one exercise out of its group (the rest of a giant set stays paired); a group left with
// a single member stops being a superset.
function clearSuperset(exName) {
  supersetGroups = supersetGroups.map(g => g.filter(n => n !== exName)).filter(g => g.length > 1);
  supersetsTouched = true;
  afterSupersetChange();
}

function afterSupersetChange() {
  applySupersetOrder();
  refreshSupersetUi();
  saveDraft(selectedSession.id);
}

// Repaints every block's ⇄ button + linked styling. Called after any change to the exercise list or
// the groups themselves, since either can change what a block says and whether it's rendered linked.
function refreshSupersetUi() {
  const map = supersetGroupMap();
  (selectedSession?.exercises || []).forEach(ex => {
    const block = document.getElementById(`block-${ex.name}`);
    if (block) block.classList.toggle('in-superset', !!map[ex.name]);
    // One superset, one Mark Done. Every member is written together by completeExercise(), so a
    // button per block offered the identical action two or three times over. It lives on the last
    // member of the group; the others hide theirs until the group is broken up again.
    const group = map[ex.name] ? (supersetGroupOf(ex.name) || []).filter(n => map[n]) : [];
    const inGroup = group.length > 1;
    const isLastOfGroup = !inGroup || group[group.length - 1] === ex.name;
    const doneBtn = document.getElementById(`done-btn-${ex.name}`);
    if (doneBtn) {
      doneBtn.style.display = isLastOfGroup ? '' : 'none';
      if (!doneBtn.dataset.done) doneBtn.textContent = inGroup ? 'Mark Superset Done' : 'Mark Done';
    }

    // One superset, one stopwatch — same rule, same member as the Mark Done above. You rest after the
    // round, not after each half of it, so two watches on a pair offered the same rest twice and made
    // you pick one. It has to be the LAST member specifically: startRestAfter() hands the auto-started
    // rest to whichever exercise finished the group, so parking the watch on the first member would
    // leave a Mark Done rest counting down on a button that isn't on screen.
    const watchBtn = document.getElementById(`watch-${ex.name}`);
    if (watchBtn) {
      watchBtn.style.display = isLastOfGroup ? '' : 'none';
      if (!isLastOfGroup && swRunning && swActiveExercise === ex.name) swHandOverWatch(group[group.length - 1]);
    }

    const btn = document.getElementById(`ss-${ex.name}`);
    if (!btn) return;
    const partners = group.filter(n => n !== ex.name);
    btn.classList.toggle('active', partners.length > 0);
    btn.textContent = partners.length ? `⇄ Superset with ${partners.join(' + ')}` : '⇄ Superset';
  });
  closeSupersetPickers();   // an open picker would now be showing a stale list
}

// Writes the current grouping over every set of the workout — including exercises Mark Done'd before
// the link was made, and clearing any group the user has since unlinked. Runs once, on Save Workout.
async function persistSupersetGroups() {
  if (!supersetsTouched || !currentWorkoutId) return;
  const map = supersetGroupMap();
  const inList = names => `in.(${names.map(n => `"${n.replace(/"/g, '\\"')}"`).join(',')})`;
  const byGroup = {};
  Object.entries(map).forEach(([name, group]) => { (byGroup[group] ||= []).push(name); });
  for (const [group, names] of Object.entries(byGroup)) {
    await sb(`workout_sets?workout_id=eq.${currentWorkoutId}&exercise=${encodeURIComponent(inList(names))}`,
      'PATCH', { superset_group: group });
  }
  const grouped = Object.keys(map);
  const clearFilter = grouped.length ? `&exercise=not.${encodeURIComponent(inList(grouped))}` : '';
  await sb(`workout_sets?workout_id=eq.${currentWorkoutId}${clearFilter}`, 'PATCH', { superset_group: null });
}

// ─── WORKOUT LOGGER ───────────────────────────────────────
// Builds one set row (weight/reps inputs + previous-set badge + rest line). Shared by
// renderExerciseBlock's initial render and addOpenSetRow's dynamic append, so both stay in sync.
function renderSetRow(ex, i, prevSet, sessionId, defaultVar) {
  const prevHint = setValueLabel(ex, prevSet);
  const repPlaceholder = isTimed(ex) ? 'secs' : (ex.name === 'Walking Lunge' ? 'steps' : 'reps');

  let weightCol = '';
  if (isOptionalWeight(ex)) {
    weightCol = bwCellHtml(`w-${esc(ex.name)}-${i}`, '', `oninput="saveDraft('${jsAttr(sessionId)}')"`);
  } else if (ex.bodyweight || isTimed(ex)) {
    weightCol = `<div class="set-label" id="w-${esc(ex.name)}-${i}">BW</div>`;
  } else if (ex.variations && ex.band) {
    const currentVar = selectedVariations[ex.name] || defaultVar || ex.variations[0];
    weightCol = `<div class="set-label" id="w-${esc(ex.name)}-${i}">${esc(currentVar)}</div>`;
  } else {
    weightCol = `<input type="text" class="set-input" id="w-${esc(ex.name)}-${i}" placeholder="kg" inputmode="decimal" oninput="saveDraft('${jsAttr(sessionId)}')" />`;
  }

  return `<div class="set-row">
      <div class="set-num">${i}</div>
      ${weightCol}
      <input type="number" class="set-input" id="r-${esc(ex.name)}-${i}" placeholder="${esc(repPlaceholder)}" inputmode="numeric" oninput="saveDraft('${jsAttr(sessionId)}')" />
      <div class="prev-badge" id="badge-${esc(ex.name)}-${i}">${esc(prevHint)}</div>
    </div>
    <div class="rest-line" id="rest-${esc(ex.name)}-${i}"></div>`;
    // ↑ empty by default — filled in with "↳ Rest 2:45" after the watch is stopped for this set
}

// The sets pill IS the add/remove control (24 Aug 2026, Del's gym note #1, mockup D of seven).
// It keeps the `pill pill-sets` clothes it has always worn — same blue tint, same 20px radius — so
// the header still reads as three pills; the two arrows are carved out of its ends. The count keeps
// id `sets-pill-<name>`, which is what addOpenSetRow/removeOpenSetRow retitle.
// `at-min` dims the − at one set, where removeOpenSetRow is a no-op (removing the whole exercise is
// the ✕ in the name row, not this).
function setsStepperHtml(ex) {
  return `<span class="pill pill-sets sets-stepper${ex.sets <= 1 ? ' at-min' : ''}" id="sets-step-${esc(ex.name)}">
      <button type="button" class="sets-step" onclick="removeOpenSetRow('${jsAttr(ex.name)}')" aria-label="Remove last set of ${esc(ex.name)}">−</button>
      <span class="sets-step-count" id="sets-pill-${esc(ex.name)}">${ex.sets} sets</span>
      <button type="button" class="sets-step" onclick="addOpenSetRow('${jsAttr(ex.name)}')" aria-label="Add a set to ${esc(ex.name)}">+</button>
    </span>`;
}

// Both handlers change the same two things about the stepper, so they say it once here.
function syncSetsStepper(exName, sets) {
  const count = document.getElementById(`sets-pill-${exName}`);
  if (count) count.textContent = `${sets} sets`;
  document.getElementById(`sets-step-${exName}`)?.classList.toggle('at-min', sets <= 1);
}

// Builds the HTML for one exercise block (header, variation toggle, set rows, Mark Done).
// Reused for fixed-session rendering, Open Workout's initial render, and dynamic append via the Add Exercise dropdown.
function renderExerciseBlock(ex, session) {
  const prev = previousSets[ex.name] || (ex.aliases || []).flatMap(a => previousSets[a] || []);
  const prevVariation = prev[0]?.variation || '';
  const defaultVar = ex.variations ? (prevVariation || ex.variations[0]) : null;
  let filteredPrev = prev;
  if (ex.variations && !ex.band && defaultVar) {
    filteredPrev = prevSetsForVariation(prev, defaultVar);
  }

  let html = `<div class="exercise-block" id="block-${esc(ex.name)}" data-rest-target="${swParseRest(ex.rest)}">
      <div class="ex-top">
        <div class="ex-name-row">
          <div class="ex-name-display">${esc(ex.name)}</div>
          <button class="ex-remove-btn" id="remove-${esc(ex.name)}" onclick="removeOpenExercise('${jsAttr(ex.name)}')" aria-label="Remove exercise" title="Remove for today">✕</button>
          <button class="ex-watch" id="watch-${esc(ex.name)}" onclick="swTapWatch('${jsAttr(ex.name)}')" aria-label="Rest timer">
            <svg class="ex-watch-ring" viewBox="0 0 30 30">
              <circle class="ex-watch-bg" cx="15" cy="15" r="12"></circle>
              <circle class="ex-watch-fill" cx="15" cy="15" r="12"></circle>
            </svg>
            <span class="ex-watch-inner">
              <svg class="ex-watch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                <circle cx="12" cy="13" r="5"/>
                <path d="M12 10.5v2.5l1.5 1.5"/>
                <path d="M10 5h4"/>
              </svg>
            </span>
          </button>
        </div>
        <div class="ex-pills">
          ${setsStepperHtml(ex)}
          <span class="pill pill-reps">${esc(isTimed(ex) && !looksLikeSeconds(ex.reps) ? timedTarget(ex) : ex.reps)}</span>
          <span class="pill pill-rest">${esc(ex.rest)}</span>
        </div>
        ${ex.note ? `<div class="ex-note-text">${esc(ex.note)}</div>` : ''}
      </div>`;

  if (ex.variations) {
    selectedVariations[ex.name] = defaultVar;
    html += `<div class="variation-toggle">`;
    ex.variations.forEach(v => {
      const isSelected = v === defaultVar ? 'selected' : '';
      html += `<button class="var-btn ${isSelected}" onclick="selectVariation('${jsAttr(ex.name)}', '${jsAttr(v)}')">${esc(v)}</button>`;
    });
    html += `</div>`;
  }

  for (let i = 1; i <= ex.sets; i++) {
    html += renderSetRow(ex, i, filteredPrev[i-1], session.id, defaultVar);
  }

  // The + / − pair used to live down here as two full-width outline buttons, the same weight as
  // Mark Done — four stacked bars under three cramped inputs. Del's first gym note on 24 Aug was
  // "adjust size of add/remove sets", and he picked the stepper off a seven-frame mockup. It is now
  // setsStepperHtml() up in .ex-pills: the count and the control are the same object, and the block
  // tail is one row shorter. Availability is unchanged — every session, not just Open Workout.
  html += `<button class="btn btn-outline btn-full" id="done-btn-${esc(ex.name)}" onclick="completeExercise('${jsAttr(ex.name)}')" style="margin-top:8px;">Mark Done</button>`;
  html += renderSupersetControl(ex);
  html += `</div>`;
  return html;
}

// How far back a "last time" lookup reaches. It bounds the single query below — without a bound it
// grows with the training history forever — and an exercise untouched for six months is not a
// reference point any more, it's a fresh start.
const PREV_SETS_LOOKBACK_DAYS = 180;

// Populates `previousSets` — the grey "45×8" badge beside every set row — for one session.
//
// ── SCOPED BY EXERCISE, NOT BY SESSION (19 Aug 2026) ──────────────────────────────────────────
// This used to filter `session_type=eq.<this session>`, so Lower B could not see a lift you had
// done on Lower A four days earlier. Five exercises in the upper/lower programme sit in two
// sessions — Seated Calf Raise, Single Leg Curl, Lower AB leg raises and Side Plank across the
// lower pair, Lateral Raise across the upper pair — and Open Workouts were sealed off from every
// fixed session in both directions on top of that.
//
// It was not cosmetic. Del's Seated Calf Raise ran 47.5 → 51 → 52.5kg across alternating Lower A
// and Lower B sessions on the same machine. On 14 Aug the app showed him 51kg (the last Lower *B*
// figure) when he had already pressed 52.5kg four days earlier on Lower A, and he did 51 — so that
// session sits in his history as a step backwards that never happened. On 19 Aug it tried the same
// thing on Single Leg Curl and he only caught it by stopping mid-exercise to open History.
//
// A calf raise is a calf raise; the session it was filed under is filing, not physiology. The
// lookup is now purely by exercise name (plus aliases) across every session type, Open included.
// Variation still filters at read time in prevSetsForVariation() — that is what stops a Hack Squat
// row showing you Leg Press numbers, and it is the escape hatch if one name ever does mean two
// different lifts in two different sessions.
async function loadPreviousSetsForSession(session) {
  // Aliases have to go into the filter explicitly now. The old query pulled *every* set of the last
  // ten workouts and let renderExerciseBlock find aliases in the leftovers; an `exercise=in.(…)`
  // filter only returns the names it was given, so "Smith Machine Incline Press" would silently
  // stop resolving for "Incline Chest Press" if it weren't asked for by name.
  const names = [];
  (session.exercises || []).forEach(e => {
    if (!names.includes(e.name)) names.push(e.name);
    (e.aliases || []).forEach(a => { if (!names.includes(a)) names.push(a); });
  });
  previousSets = await fetchPreviousSetsFor(names);
}

// The one engine behind every "last time" badge, for fixed sessions and Open Workouts alike.
// Returns { exerciseName: [{weight, reps, variation}, …] }, set order preserved.
async function fetchPreviousSetsFor(exNames) {
  const result = {};
  const names = [...new Set((exNames || []).filter(Boolean))];
  if (!names.length) return result;

  const since = new Date();
  since.setDate(since.getDate() - PREV_SETS_LOOKBACK_DAYS);
  // One request. `workouts!inner(date)` does two jobs at once: it carries each set's own date back
  // on the row (so no second lookup is needed to work out which occurrence is most recent), and
  // `!inner` makes the date bound filter the *sets* rather than merely blanking the embedded object.
  const exFilter = encodeURIComponent(`in.(${names.map(n => `"${n.replace(/"/g, '\\"')}"`).join(',')})`);
  const rows = await sb(`workout_sets?exercise=${exFilter}`
    + `&select=exercise,set_number,weight,reps,variation,workout_id,workouts!inner(date)`
    + `&workouts.date=gte.${dateStr(since)}&order=set_number.asc`);
  // The session in progress is dropped after the fetch rather than excluded in the filter — one
  // workout's worth of rows to save a round trip on the screen you are standing in a gym waiting
  // for. Without it, sets typed ten minutes ago come back as "last time".
  const sets = (rows || []).filter(s => s.workout_id !== currentWorkoutId);
  if (!sets.length) return result;

  const dateOf = s => s.workouts?.date || '';
  const byExercise = {};
  sets.forEach(s => { (byExercise[s.exercise] ||= []).push(s); });

  Object.entries(byExercise).forEach(([exName, exSets]) => {
    // Anchor on this exercise's own most recent outing, whichever session that happened to be.
    let anchor = null;
    exSets.forEach(s => { if (!anchor || dateOf(s) > dateOf(anchor)) anchor = s; });
    const anchorId = anchor.workout_id;
    const primary = exSets.filter(s => s.workout_id === anchorId).sort((a, b) => a.set_number - b.set_number);
    const seen = new Set(primary.map(s => s.variation || ''));
    const out = primary.map(s => ({ weight: s.weight, reps: s.reps, variation: s.variation }));

    // Backfill any variation that wasn't used in that most recent outing from its own latest one.
    // A toggle you reach for every third week shouldn't come up blank just because it wasn't the
    // one you used last time.
    const byVariation = {};
    exSets.filter(s => s.workout_id !== anchorId && !seen.has(s.variation || ''))
      .forEach(s => { (byVariation[s.variation || ''] ||= []).push(s); });
    Object.values(byVariation).forEach(group => {
      let latest = null;
      group.forEach(s => { if (!latest || dateOf(s) > dateOf(latest)) latest = s; });
      out.push(...group.filter(s => s.workout_id === latest.workout_id)
        .sort((a, b) => a.set_number - b.set_number)
        .map(s => ({ weight: s.weight, reps: s.reps, variation: s.variation })));
    });

    result[exName] = out;
  });
  return result;
}

// "Last time you did this session" full snapshot — fixed sessions only (CV+Pump never reaches
// buildWorkoutLogger, and an Open Workout has no fixed identity to look up).
//
// This one stays SESSION-scoped on purpose, and did not change on 19 Aug when previousSets went
// exercise-scoped. The two answer different questions: the badges beside each set row answer "what
// did I last do on THIS LIFT", which has nothing to do with filing; this card answers "how did Lower
// B go last time", and a card blending four different mornings would not be an answer to that.
async function fetchLastSessionSnapshot(session) {
  // One request, not three (15 Aug 2026). Cardio comes back alongside the sets — "what did I do
  // last time" has to include the bike/treadmill work, not just the lifts, or the card silently
  // under-reports the session — and both now ride back embedded in the workout that owns them.
  // rest_seconds joins the select so the card can answer "how long did I rest last time" — the
  // number this app records and then never showed you anywhere you'd be standing when you need it.
  // limit=8, not 1 (23 Aug 2026). "The most recent row" is not the same thing as "the last time I
  // trained this": an opened-and-backed-out session leaves a completed row with nothing in it, and
  // taking the top row blind lands the card on that blank and renders nothing at all. Del hit it the
  // hour the card shipped on Open Workout — "open workout looks exactly the same" — and the reason
  // it bites there worst is that Open Workout is the easiest session to open by accident: 9 of his
  // 18 open rows hold sets, and the five most recent hold none.
  //
  // The empties are not deleted here. Whether a ghost row should exist at all is a separate question
  // with its own test file (ghost-workout-row.test.js); this function's job is only to answer "what
  // did I actually do last time", and a row with no sets and no cardio is not an answer to that.
  const last = await sb(`workouts?session_type=eq.${session.id}&completed_at=not.is.null&order=date.desc&limit=8`
    + `&select=id,date,workout_sets(exercise,set_number,weight,reps,variation,rest_seconds),cardio_logs(activity,duration_mins,distance,floors,incline,speed_kmh)`
    + `&workout_sets.order=set_number.asc`);
  const candidates = (last || []).filter(w =>
    w.id !== currentWorkoutId && ((w.workout_sets || []).length || (w.cardio_logs || []).length));
  if (!candidates.length) return null;
  const workout = candidates[0];
  const byExercise = {};
  (workout.workout_sets || []).forEach(s => { (byExercise[s.exercise] ||= []).push(s); });
  return { date: workout.date, exercises: byExercise, cardio: workout.cardio_logs || [] };
}

// "Rest 1:30 avg" for one exercise's sets, or '' when nothing was timed.
//
// Averaged over the sets that actually carry a rest, not over every set. The last set of an exercise
// has no rest after it (and since 14 Aug never records one — see swStop), so dividing by the set
// count would drag every figure down by a third on a 3-set lift. Same shape as the History card's
// `rest 1:30 avg`, deliberately: it's the same number, and the two screens shouldn't word it
// differently. Rounds to the nearest 5s — you are reading this to decide whether to start the next
// set, and "1:28 vs 1:31" is precision the number doesn't have.
function lastTimeRestLabel(sets) {
  const rests = (sets || []).map(s => parseInt(s.rest_seconds)).filter(n => !isNaN(n) && n > 0);
  if (!rests.length) return '';
  const avg = rests.reduce((a, b) => a + b, 0) / rests.length;
  return `rest ${fmtRest(Math.round(avg / 5) * 5)} avg`;
}

// The snapshot behind the repeat button, held here because that button is drawn inside an innerHTML
// string and has nothing to close over.
let lastOpenSnapshot = null;

// opts.repeatable — Open Workout only: adds the button that loads last time's exercises back in, and
// opens the card by default. On a fixed session this card is reference material beside a logger that
// is already full; on Open Workout it is the only thing on the screen, and collapsed it would be one
// more line of grey text in the space Del just called too empty.
function renderLastTimeCard(snapshot, session, opts = {}) {
  if (!snapshot) return '';
  const dateStr = new Date(snapshot.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  const restSpan = sets => {
    const txt = lastTimeRestLabel(sets);
    return txt ? `<div class="last-time-rest">${esc(txt)}</div>` : '';
  };
  let rows = session.exercises.map(ex => {
    const sets = snapshot.exercises[ex.name] || (ex.aliases || []).flatMap(a => snapshot.exercises[a] || []);
    if (!sets.length) return '';
    const variationTag = sets[0].variation ? ` <span class="last-time-var">(${esc(sets[0].variation)})</span>` : '';
    const setsStr = sets.map(s => setValueLabel(ex, s)).join(', ');
    return `<div class="last-time-row"><span class="last-time-ex">${esc(ex.name)}${variationTag}</span><span class="last-time-sets">${esc(setsStr)}${restSpan(sets)}</span></div>`;
  }).join('');
  // Exercises the template no longer contains (a one-off swap last time) would otherwise vanish
  // from the card entirely — list them after the template's own, so nothing logged goes unshown.
  const templateNames = new Set(session.exercises.flatMap(ex => [ex.name, ...(ex.aliases || [])]));
  Object.keys(snapshot.exercises).filter(n => !templateNames.has(n)).forEach(name => {
    const sets = snapshot.exercises[name];
    const variationTag = sets[0].variation ? ` <span class="last-time-var">(${esc(sets[0].variation)})</span>` : '';
    const setsStr = sets.map(s => setValueLabel({ name }, s)).join(', ');
    rows += `<div class="last-time-row"><span class="last-time-ex">${esc(name)}${variationTag}</span><span class="last-time-sets">${esc(setsStr)}${restSpan(sets)}</span></div>`;
  });
  (snapshot.cardio || []).forEach(c => {
    const detail = cardioDetailParts(c).join(', ') || '—';
    rows += `<div class="last-time-row last-time-cardio"><span class="last-time-ex">${esc(cardioDisplayName(c.activity))}</span><span class="last-time-sets">${esc(detail)}</span></div>`;
  });
  if (!rows) return '';
  const names = Object.keys(snapshot.exercises);
  const repeat = opts.repeatable && names.length
    ? `<button type="button" class="btn btn-outline btn-full last-time-load" onclick="loadLastOpenExercises()">` +
      `Load ${names.length === 1 ? 'this exercise' : `these ${names.length} exercises`}</button>`
    : '';
  return `<div class="card last-time-card${opts.repeatable ? ' expanded' : ''}" id="last-time-card">
    <div class="last-time-header" onclick="document.getElementById('last-time-card').classList.toggle('expanded')">
      <span>📅 ${opts.open ? 'Last open workout' : 'Last time'} — ${dateStr}</span>
      <span class="last-time-chevron">▾</span>
    </div>
    <div class="last-time-body">${rows}${repeat}</div>
  </div>`;
}

// Repeat last session's exercise list in one tap. Open Workout has no template, so a repeat meant
// picking every one of them back out of a dropdown of the whole library — the biggest piece of
// friction on the screen, and the reason this card earns its place here more than anywhere else.
//
// Sequential, not Promise.all: addOpenExercise() fetches that exercise's previous sets and splices
// its block in above the add row, and five of those at once race on both.
async function loadLastOpenExercises() {
  const names = Object.keys(lastOpenSnapshot?.exercises || {});
  if (!names.length) return;
  const btn = document.querySelector('.last-time-load');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  for (const name of names) await addOpenExercise(name);
  if (btn) btn.remove();
  // Collapse on the way out: what was the whole screen a second ago is now reference material above
  // five exercise blocks, and it should take up the room it takes on every other session.
  const card = document.getElementById('last-time-card');
  if (card) card.classList.remove('expanded');
  showToast(names.length === 1 ? '1 exercise loaded' : `${names.length} exercises loaded`);
}

// Reads any exercises an in-progress session's draft added but hadn't Mark-Done'd yet (so a refresh
// mid-session doesn't lose the block — DB reconstruction alone only knows about *saved* sets).
// Used by both Open Workout (per-workout exercise list) and fixed sessions (one-off today-only adds).
function peekDraftOpenExercises(sessionId) {
  try {
    const raw = localStorage.getItem('workout_draft');
    if (!raw) return [];
    const draft = JSON.parse(raw);
    if (draft.sessionId !== sessionId) return [];
    if (draft.timestamp && Date.now() - draft.timestamp > 24*60*60*1000) return [];
    return draft.openExercises || [];
  } catch (e) { return []; }
}

// Exercises removed via the ✕ button on a fixed session's live logger (one-off, today-only —
// never written to the template), so a mid-session refresh doesn't bring them back.
function peekDraftRemovedExercises(sessionId) {
  try {
    const raw = localStorage.getItem('workout_draft');
    if (!raw) return [];
    const draft = JSON.parse(raw);
    if (draft.sessionId !== sessionId) return [];
    if (draft.timestamp && Date.now() - draft.timestamp > 24*60*60*1000) return [];
    return draft.removedExercises || [];
  } catch (e) { return []; }
}

// Supersets made before a mid-session refresh, plus the pre-snap exercise order they were made
// against. (Pairings made *after* an exercise was Mark Done'd are also recoverable from
// workout_sets.superset_group on resume — see buildWorkoutLogger.)
function peekDraftSupersets(sessionId) {
  const empty = { groups: [], baseOrder: [] };
  try {
    const raw = localStorage.getItem('workout_draft');
    if (!raw) return empty;
    const draft = JSON.parse(raw);
    if (draft.sessionId !== sessionId) return empty;
    if (draft.timestamp && Date.now() - draft.timestamp > 24*60*60*1000) return empty;
    return { groups: draft.supersetGroups || [], baseOrder: draft.supersetBaseOrder || [] };
  } catch (e) { return empty; }
}

// Per-exercise set-row counts saved by saveDraft, so a mid-session refresh doesn't lose rows
// added/removed via addOpenSetRow/removeOpenSetRow before the exercise was Mark Done'd.
function peekDraftSetCounts(sessionId) {
  try {
    const raw = localStorage.getItem('workout_draft');
    if (!raw) return {};
    const draft = JSON.parse(raw);
    if (draft.sessionId !== sessionId) return {};
    if (draft.timestamp && Date.now() - draft.timestamp > 24*60*60*1000) return {};
    return draft.openSetCounts || {};
  } catch (e) { return {}; }
}

async function buildWorkoutLogger(session) {
  const logger = document.getElementById('workout-logger');
  logger.innerHTML = '<div class="loading">Loading previous lifts...</div>';

  if (!session.cardioEntries) session.cardioEntries = [];

  // Re-hydrate any one-off add/remove made before a mid-session refresh — Open Workout's exercise
  // list is per-workout by design; fixed sessions get the same "today only" flexibility here too
  // (never written back to the template — see selectSession's clone-before-mutate + the ✎ template
  // editor for permanent changes).
  if (!session.cardio) {
    const removedNames = new Set(peekDraftRemovedExercises(session.id));
    removedSessionExercises = Array.from(removedNames);
    session.exercises = session.exercises.filter(e => !removedNames.has(e.name));

    const existingNames = new Set(session.exercises.map(e => e.name));
    peekDraftOpenExercises(session.id).forEach(name => {
      if (!existingNames.has(name) && !removedNames.has(name)) {
        session.exercises.push({ ...(EXERCISE_LIBRARY[name] || { name, sets: 3, reps: '8–12', rest: '90s' }) });
        existingNames.add(name);
      }
    });
    const savedCounts = peekDraftSetCounts(session.id);
    session.exercises.forEach(ex => { if (savedCounts[ex.name]) ex.sets = savedCounts[ex.name]; });

    const draftSs = peekDraftSupersets(session.id);
    if (draftSs.groups.length) { supersetGroups = draftSs.groups; supersetsTouched = true; }
    else {
      // No draft — start from whatever the template says is supersetted (set in the ✎ editor). Marked
      // touched so the pairing gets written onto the sets on save even if it's never touched today;
      // the ⇄ picker can still break or change it, exactly as if it had been made by hand.
      const byTag = {};
      session.exercises.forEach(e => { if (e.supersetGroup) (byTag[e.supersetGroup] ||= []).push(e.name); });
      const fromTemplate = Object.values(byTag).filter(g => g.length > 1);
      if (fromTemplate.length) { supersetGroups = fromTemplate; supersetsTouched = true; }
    }
    // Base order comes from the draft where there is one (session.exercises is by then in *display*
    // order, which would make unpairing a no-op); anything the draft doesn't know about goes on the end.
    const names = session.exercises.map(e => e.name);
    supersetBaseOrder = draftSs.baseOrder.filter(n => names.includes(n));
    names.forEach(n => { if (!supersetBaseOrder.includes(n)) supersetBaseOrder.push(n); });
    applySupersetOrder();
  }

  await loadPreviousSetsForSession(session);

  let html = '';
  let lastTimeHtml = '';
  if (!session.cardio) {
    // The ✎ link stays off Open Workout — there is no template to reorder. The card does not: as of
    // 23 Aug 2026 the one session type with no template is no longer the one that arrives with no
    // idea what you did last time. renderLastTimeCard() needed nothing for this beyond being
    // called: an empty session.exercises sends every logged exercise down its "not in the template"
    // path, which is exactly the right list for a session that has no template.
    if (session.id !== 'open') {
      html += `<div class="edit-template-link" onclick="openSessionEditor('${jsAttr(session.id)}')">✎ Reorder / add / remove exercises for this session</div>`;
    }
    const lastTimeSnapshot = await fetchLastSessionSnapshot(session);
    lastOpenSnapshot = session.id === 'open' ? lastTimeSnapshot : null;
    // Repeatable only while the session is still empty: a resumed Open Workout already has its
    // blocks on screen, and an open card offering to load them again on top of them is noise.
    lastTimeHtml = renderLastTimeCard(lastTimeSnapshot, session, {
      open: session.id === 'open',
      repeatable: session.id === 'open' && session.exercises.length === 0,
    });
    html += lastTimeHtml;
  }
  session.exercises.forEach(ex => { html += renderExerciseBlock(ex, session); });

  if (!session.cardio) {
    // Only worth printing when there is nothing else on the screen. Under the card above it, "tap
    // Add Exercise below" is a caption on a box already labelled Add Exercise — Del, looking at the
    // empty Open Workout screen: "too much space, or maybe i just dont like the text".
    if (session.exercises.length === 0 && !lastTimeHtml) {
      html += `<div class="empty" style="margin-bottom:0.875rem;">Tap Add Exercise below to get started</div>`;
    }
    html += renderAddExerciseRow();
  }

  html += renderCardioSection(session);

  html += `<div class="field-group" style="margin-top:0.875rem;">
    <label class="field-label">Session Notes</label>
    <textarea class="field-input" id="workout-notes" placeholder="How did it go..." oninput="saveDraft('${jsAttr(session.id)}')"></textarea>
  </div>
  <button class="btn btn-save btn-full" onclick="saveWorkout()" style="margin-bottom:1rem;">Save Workout</button>`;

  logger.innerHTML = html;
  const draftVariations = restoreDraft(session);

  // Restore already-saved sets on resume: paint rest times, fill empty inputs, mark exercises done
  if (currentWorkoutId) {
    const savedSets = await sb(`workout_sets?workout_id=eq.${currentWorkoutId}&select=exercise,set_number,rest_seconds,weight,reps,superset_group,variation`);
    // Rebuild the groups from what's already saved (covers resuming a workout after the draft has
    // gone) — everything sharing a group tag was one superset.
    if (!supersetGroups.length) {
      const byTag = {};
      (savedSets || []).forEach(s => {
        if (s.superset_group) (byTag[s.superset_group] ||= new Set()).add(s.exercise);
      });
      Object.values(byTag).forEach(tagged => {
        const members = Array.from(tagged);
        if (members.length > 1) { supersetGroups.push(members); supersetsTouched = true; }
      });
      if (supersetGroups.length) applySupersetOrder();
    }
    (savedSets || []).forEach(s => {
      if (s.rest_seconds) swPaintRestLine(s.exercise, s.set_number, s.rest_seconds);
      // Fill inputs only where draft didn't already populate them
      const wEl = document.getElementById(`w-${s.exercise}-${s.set_number}`);
      const rEl = document.getElementById(`r-${s.exercise}-${s.set_number}`);
      if (wEl && wEl.tagName === 'INPUT' && !wEl.value && s.weight != null) wEl.value = s.weight;
      if (rEl && !rEl.value && s.reps != null) rEl.value = s.reps;
    });
    bwSyncAll();   // a resumed set with added weight must show the box, not the BW pill
    // Variations of exercises already written to the DB. The draft wins where it has one — it also
    // carries a toggle changed *after* Mark Done, which the saved rows can't know about yet. This
    // branch is what covers a resume with no draft at all (24h expiry, or another device).
    const fromSaved = {};
    (savedSets || []).forEach(s => { if (s.variation && !fromSaved[s.exercise]) fromSaved[s.exercise] = s.variation; });
    Object.entries(fromSaved).forEach(([exName, v]) => {
      if (!draftVariations[exName]) applyVariation(exName, v);
    });

    // Mark any exercise that has at least one saved set as done (green)
    const doneExercises = new Set((savedSets || []).map(s => s.exercise));
    doneExercises.forEach(exName => {
      markExerciseBlockDone(exName);
      const removeBtn = document.getElementById(`remove-${exName}`);
      if (removeBtn) removeBtn.style.display = 'none';
    });
  }

  refreshSupersetUi();

  // Rebuild any live timer from sessionStorage (user may have navigated away + back)
  swRestoreFromStorage();
}

// ─── OPEN WORKOUT ─────────────────────────────────────────
async function startOpenWorkout() {
  const openSession = { id: 'open', name: 'Open Workout', exercises: [] };
  const ok = await beginWorkoutSession(openSession);
  if (!ok) return;

  if (currentWorkoutId) {
    const savedSets = await sb(`workout_sets?workout_id=eq.${currentWorkoutId}&select=exercise,set_number`);
    if (savedSets && savedSets.length > 0) {
      openSession.exercises = reconstructSessionFromSets(savedSets).exercises;
    }
  }

  showWorkoutView('logger', openSession.name);
  buildWorkoutLogger(openSession);
}

// ─── SAVE AN OPEN WORKOUT AS A REUSABLE SESSION ───────────
// Offered once, on Save Workout, when the session was an Open Workout with exercises in it: the
// session you just improvised becomes a fixed session tile under the "My Sessions" programme,
// editable afterwards with the same ✎ template editor as every other session.
async function offerSaveOpenAsTemplate(exercises, supersetTags = {}) {
  if (!exercises.length) return;
  const save = await askConfirm({
    title: 'Save this as a session?',
    body: `It becomes a tile on the Log Workout screen, with these exercises:\n\n${exercises.map(e => e.name).join('\n')}`,
    yes: 'Save it',
    no: 'Not now',
  });
  if (!save) return;

  const raw = prompt('Name this session:', '');
  const name = raw ? raw.trim() : '';
  if (!name) return;
  // Same rule as custom exercise names — these flow into inline onclick="…('${id}')" handlers.
  if (/['"`]/.test(name)) {
    showToast('Avoid quotes/apostrophes in session names — try again without them', 'error');
    return;
  }

  let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session';
  const taken = new Set(SESSIONS.map(s => s.id));
  if (taken.has(id)) { let n = 2; while (taken.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }

  const sortOrder = SESSIONS.reduce((max, s) => Math.max(max, s.sort_order ?? 0), 0) + 1;
  const tplRes = await sb('session_templates', 'POST', {
    id, programme: CUSTOM_PROGRAMME_ID, name,
    focus: `${exercises.length} exercises`, cardio: false, sort_order: sortOrder
  }, { quiet: true });
  if (!tplRes.ok) { showToast(`Couldn't save session (${tplRes.status})`, 'error'); return; }

  const rows = exercises.map((ex, i) => ({
    session_id: id, name: ex.name, ...exerciseIdFields(ex.name),
    sets: ex.sets || 3, reps: ex.reps || '8–12', rest: ex.rest || '90s',
    note: ex.note ?? null, variations: ex.variations ?? null, aliases: ex.aliases ?? null,
    band: !!ex.band, bodyweight: !!ex.bodyweight, sort_order: i,
    superset_group: supersetTags[ex.name] || null
  }));
  const exRes = await sb('session_exercises', 'POST', rows, { quiet: true });
  if (!exRes.ok) {
    // Don't leave a session tile with no exercises behind.
    await sb(`session_templates?id=eq.${id}`, 'DELETE', null, { quiet: true });
    showToast(`Couldn't save session (${exRes.status})`, 'error');
    return;
  }

  await loadSessionTemplates();
  EXERCISE_LIBRARY = buildExerciseLibrary();
  showToast(`${name} saved — it's a tile on the Log Workout screen`, 'success');
}

// Deletes a saved-from-Open-Workout session template. Only offered for the "My Sessions" programme —
// the built-in programmes' sessions are never deletable from the UI. Logged workouts are untouched:
// workouts.session_type is a plain string, so History keeps showing the session by name.
async function deleteSessionTemplate() {
  const session = getSessionById(editingTemplateSessionId);
  if (!session || session.programme !== CUSTOM_PROGRAMME_ID) return;
  const del = await askConfirm({
    title: `Delete ${session.name}?`,
    body: 'This removes the tile only. Workouts you have already logged with it stay in History.',
    yes: 'Delete it',
    no: 'Keep it',
    danger: true,
  });
  if (!del) return;
  const id = session.id;
  await sb(`session_exercises?session_id=eq.${id}`, 'DELETE', null, { quiet: true });
  const res = await sb(`session_templates?id=eq.${id}`, 'DELETE', null, { quiet: true });
  if (!res.ok) { showToast(`Delete failed (${res.status})`, 'error'); return; }
  await loadSessionTemplates();
  EXERCISE_LIBRARY = buildExerciseLibrary();
  closeSessionEditor();
  showToast('Session deleted', 'success');
  // Saved sessions live on the top screen, so that's where you land after deleting one.
  buildSessionGrid(selectedProgramme === CUSTOM_PROGRAMME_ID ? null : selectedProgramme);
}

function renderAddExerciseRow() {
  return `<div class="card" id="open-add-exercise-row" style="margin-bottom:0.875rem;">
    <label class="field-label">Add Exercise</label>
    <select class="field-input" id="open-exercise-select" onchange="handleOpenExerciseSelect(this)">
      ${openExerciseSelectOptionsHtml()}
    </select>
  </div>`;
}

function openExerciseSelectOptionsHtml() {
  const chosen = new Set((selectedSession?.exercises || []).map(e => e.name));
  const names = Object.keys(EXERCISE_LIBRARY).filter(n => !chosen.has(n)).sort();
  let opts = `<option value="" selected disabled>Choose an exercise…</option>`;
  names.forEach(n => { opts += `<option value="${esc(n)}">${esc(n)}</option>`; });
  opts += `<option value="__custom__">+ Type a new exercise…</option>`;
  return opts;
}

function renderOpenAddExerciseOptions() {
  const sel = document.getElementById('open-exercise-select');
  if (sel) sel.innerHTML = openExerciseSelectOptionsHtml();
}

async function handleOpenExerciseSelect(selectEl) {
  const val = selectEl.value;
  if (!val) return;
  if (val === '__custom__') {
    await promptCustomExercise();
  } else {
    await addOpenExercise(val);
  }
}

async function promptCustomExercise() {
  const raw = prompt('Exercise name:');
  renderOpenAddExerciseOptions();  // reset dropdown back to placeholder regardless of outcome
  const name = raw ? raw.trim() : '';
  if (!name) return;
  // Exercise names flow straight into inline onclick="...('${name}')" handlers throughout the app
  // (existing pattern, not new to Open Workout) — quote characters would break the generated HTML.
  if (/['"`]/.test(name)) {
    showToast(`Avoid quotes/apostrophes in exercise names — try again without them`, 'error');
    return;
  }
  if (EXERCISE_LIBRARY[name] || (selectedSession?.exercises || []).some(e => e.name === name)) {
    showToast(`${name} already exists — pick it from the dropdown`, 'error');
    return;
  }
  await registerNewExercise(name);
  await addOpenExercise(name);
  return name;   // so the superset picker can pair with what was just typed in
}

async function addOpenExercise(name) {
  if (!selectedSession || selectedSession.exercises.some(e => e.name === name)) return;
  // Clone (not the shared EXERCISE_LIBRARY object) — addOpenSetRow/removeOpenSetRow mutate ex.sets
  // per-instance, which must not leak into the shared template used by every future workout.
  const def = { ...(EXERCISE_LIBRARY[name] || { name, sets: 3, reps: '8–12', rest: '90s' }) };
  selectedSession.exercises.push(def);
  if (!supersetBaseOrder.includes(name)) supersetBaseOrder.push(name);

  const emptyMsg = document.querySelector('#workout-logger .empty');
  if (emptyMsg) emptyMsg.remove();

  const fetched = await fetchPreviousSetsFor([name, ...(def.aliases || [])]);
  Object.assign(previousSets, fetched);

  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderExerciseBlock(def, selectedSession);
  const addRow = document.getElementById('open-add-exercise-row');
  addRow.parentNode.insertBefore(wrapper.firstElementChild, addRow);
  renderOpenAddExerciseOptions();
  removedSessionExercises = removedSessionExercises.filter(n => n !== name);
  refreshSupersetUi();   // every other block's picker can now offer this one
  saveDraft(selectedSession.id);
}

// Removes an exercise for this workout only — never touches the permanent template (see ✎ Session
// Template Editor for that). Works on both Open Workout and fixed sessions.
function removeOpenExercise(name) {
  if (!selectedSession) return;
  selectedSession.exercises = selectedSession.exercises.filter(e => e.name !== name);
  if (!removedSessionExercises.includes(name)) removedSessionExercises.push(name);
  supersetGroups = supersetGroups.map(g => g.filter(n => n !== name)).filter(g => g.length > 1);
  supersetBaseOrder = supersetBaseOrder.filter(n => n !== name);
  const block = document.getElementById(`block-${name}`);
  if (block) block.remove();
  renderOpenAddExerciseOptions();
  applySupersetOrder();   // losing a partner can dissolve a group, freeing the survivor to slide back
  refreshSupersetUi();
  saveDraft(selectedSession.id);
}

// Appends one more set row, on any session (mutates this exercise instance's own `sets` count,
// safe because selectSession clones off the shared EXERCISE_LIBRARY template rather than aliasing it).
// The session id has to be threaded through rather than hardcoded to 'open': renderSetRow bakes it
// into each input's oninput="saveDraft(...)", so an added row on Upper 1 used to save the draft
// under 'open' — and peekDraft* rejects a mismatched id, silently binning the whole session's draft.
function addOpenSetRow(exName) {
  const ex = selectedSession?.exercises.find(e => e.name === exName);
  if (!ex) return;
  ex.sets += 1;
  // Anchor is Mark Done since 24 Aug — the set-row-controls div the new row used to be inserted
  // before is gone with the stepper move, and Mark Done is the first thing after the last set row.
  const anchor = document.getElementById(`done-btn-${exName}`);
  if (anchor) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderSetRow(ex, ex.sets, null, selectedSession.id, selectedVariations[exName]);
    while (wrapper.firstChild) anchor.parentNode.insertBefore(wrapper.firstChild, anchor);
  }
  syncSetsStepper(exName, ex.sets);
  saveDraft(selectedSession.id);
}

// Removes the last set row, on any session. Keeps at least one row per exercise (to remove the
// whole exercise, use the ✕ button instead).
function removeOpenSetRow(exName) {
  const ex = selectedSession?.exercises.find(e => e.name === exName);
  if (!ex || ex.sets <= 1) return;
  const i = ex.sets;
  document.getElementById(`w-${exName}-${i}`)?.closest('.set-row')?.remove();
  document.getElementById(`rest-${exName}-${i}`)?.remove();
  ex.sets -= 1;
  syncSetsStepper(exName, ex.sets);
  saveDraft(selectedSession.id);
}

// ─── CARDIO SECTION ───────────────────────────────────────
// Optional cardio logged after the weights, at the bottom of any workout logger (not CV + Pump,
// which never reaches buildWorkoutLogger). Multiple entries allowed, including repeats of the
// same activity (e.g. two separate bike intervals). Unlike exercises, entries aren't saved
// incrementally — they're read live from their inputs and POSTed once, in saveWorkout().
const CARDIO_FIELD_LABELS = { duration: 'Duration (min)', floors: 'Floors', incline: 'Incline (%)', speed: 'Speed (km/h)' };

// The filled-in fields of a saved cardio_logs row, labelled — e.g. ['15min', '14% incline'].
// Shared by the History summary line and the workout logger's "Last time" card.
function cardioDetailParts(c) {
  const details = [];
  if (c.duration_mins != null) details.push(`${c.duration_mins}min`);
  if (c.distance != null) details.push(`${c.distance}${c.activity === 'Bike' ? 'km' : 'm'}`);
  if (c.floors != null) details.push(`${c.floors} floors`);
  if (c.incline != null) details.push(`${c.incline}% incline`);
  if (c.speed_kmh != null) details.push(`${c.speed_kmh}km/h speed`);
  return details;
}

// One-line summary for a saved cardio_logs row, used in History workout cards.
function formatCardioEntry(c) {
  const details = cardioDetailParts(c);
  const name = cardioDisplayName(c.activity);
  return details.length ? `${name} ${details.join(', ')}` : name;
}

function renderCardioSection(session) {
  const entries = session.cardioEntries || [];
  return `<div class="section-title" style="font-size:16px;margin-top:0.875rem;margin-bottom:0.5rem;">Cardio (optional)</div>
    <div id="cardio-list">${entries.map(e => renderCardioBlock(e, 'live', session.id)).join('')}</div>
    <div class="card" id="add-cardio-row" style="margin-bottom:0.875rem;">
      <label class="field-label">Add Cardio</label>
      <select class="field-input" id="cardio-activity-select" onchange="handleAddCardio(this)">
        <option value="" selected disabled>Choose an activity…</option>
        ${Object.keys(CARDIO_ACTIVITIES).map(a => `<option value="${a}">${cardioDisplayName(a)}</option>`).join('')}
      </select>
    </div>`;
}

// ─── THE CARDIO BLOCK — ONE RENDERER, TWO SCREENS ─────────
// The live logger and the History edit modal draw the identical cardio box. They used to do it with
// two near-identical copies of this function, ~350 lines apart, and **two separate bugs have already
// come from them drifting** — a change lands on one, the other silently stays behind. Collapsed on
// 13 Aug 2026. If you're adding anything to the cardio box, there is now exactly one place to add it.
//
// Everything about the markup is shared. The only real differences are collected here:
//   · the id prefix — the two blocks can be on the page at once, so the ids must not collide
//   · whether typing saves the workout draft (the modal has no draft; it edits saved rows)
//   · which handlers the preset and remove buttons call
const CARDIO_BLOCK_MODES = {
  live: {
    prefix: 'cardio',
    fieldAttrs: (sessionId) => ` oninput="saveDraft('${jsAttr(sessionId)}')"`,
    preset: (id, mins, sessionId) => `setCardioPreset(${id}, ${mins}, '${jsAttr(sessionId)}')`,
    remove: (id) => `removeCardioEntry(${id})`,
  },
  edit: {
    prefix: 'ecardio',
    fieldAttrs: () => '',
    preset: (id, mins) => `setEditCardioPreset(${id}, ${mins})`,
    remove: (id) => `removeEditCardioEntry(${id})`,
  },
};

function renderCardioBlock(entry, mode, sessionId = '') {
  const m = CARDIO_BLOCK_MODES[mode];
  const def = CARDIO_ACTIVITIES[entry.activity];
  if (!def || !m) return '';
  const fields = def.fields.map(f => {
    const label = f === 'distance' ? (def.distanceLabel || 'Distance') : CARDIO_FIELD_LABELS[f];
    return `<div class="field-group">
      <label class="field-label">${esc(label)}</label>
      <input type="number" step="0.1" class="field-input" id="${m.prefix}-${entry.id}-${f}"${m.fieldAttrs(sessionId)} />
    </div>`;
  }).join('');
  const presets = def.presets ? `<div class="variation-toggle" style="margin-top:6px;">
      ${def.presets.map(p => `<button class="var-btn" type="button" onclick="${m.preset(entry.id, p, sessionId)}">${p}m</button>`).join('')}
    </div>` : '';
  return `<div class="card cardio-block" id="${m.prefix}-block-${entry.id}" style="margin-bottom:0.875rem;">
    <div class="ex-name-row">
      <div class="ex-name-display">${esc(cardioDisplayName(entry.activity))}</div>
      <button class="ex-remove-btn" onclick="${m.remove(entry.id)}" aria-label="Remove cardio entry" title="Remove">✕</button>
    </div>
    <div class="cardio-field-grid" style="display:grid; grid-template-columns:repeat(${def.fields.length}, 1fr); gap:8px; margin-top:8px;">${fields}</div>
    ${presets}
  </div>`;
}

function handleAddCardio(selectEl) {
  const activity = selectEl.value;
  if (!activity) return;
  addCardioEntry(activity);
  selectEl.value = '';
}

// values (optional) restores a previously-drafted entry's field contents after re-render.
function addCardioEntry(activity, values) {
  if (!selectedSession || !CARDIO_ACTIVITIES[activity]) return null;
  if (!selectedSession.cardioEntries) selectedSession.cardioEntries = [];
  const id = cardioEntryCounter++;
  selectedSession.cardioEntries.push({ id, activity });

  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderCardioBlock({ id, activity }, 'live', selectedSession.id);
  const addRow = document.getElementById('add-cardio-row');
  addRow.parentNode.insertBefore(wrapper.firstElementChild, addRow);

  if (values) {
    Object.keys(values).forEach(f => {
      const el = document.getElementById(`cardio-${id}-${f}`);
      if (el && values[f] != null && values[f] !== '') el.value = values[f];
    });
  }
  saveDraft(selectedSession.id);
  return id;
}

function removeCardioEntry(id) {
  if (!selectedSession) return;
  selectedSession.cardioEntries = (selectedSession.cardioEntries || []).filter(e => e.id !== id);
  const block = document.getElementById(`cardio-block-${id}`);
  if (block) block.remove();
  saveDraft(selectedSession.id);
}

function setCardioPreset(id, minutes, sessionId) {
  const el = document.getElementById(`cardio-${id}-duration`);
  if (el) el.value = minutes;
  saveDraft(sessionId);
}

// ─── DRAFT AUTO-SAVE ─────────────────────────────────────
function saveDraft(sessionId) {
  if (!selectedSession) return;
  const draft = {
    sessionId,
    sets: {},
    notes: document.getElementById('workout-notes')?.value || '',
    pendingRest: pendingRest,   // persist rest times too, so they survive reload
    // The toggle is the only record of which variation today's sets belong to until Mark Done writes
    // them. Without this a refresh snapped it back to last session's variation and the rest of the
    // workout saved under the wrong one.
    variations: { ...selectedVariations },
    timestamp: Date.now()
  };
  selectedSession.exercises.forEach(ex => {
    for (let i = 1; i <= ex.sets; i++) {
      const wEl = document.getElementById(`w-${ex.name}-${i}`);
      const rEl = document.getElementById(`r-${ex.name}-${i}`);
      const w = wEl && wEl.tagName === 'INPUT' ? wEl.value : null;
      const r = rEl ? rEl.value : null;
      if (w || r) draft.sets[`${ex.name}-${i}`] = { w, r };
    }
  });
  // Open Workout's exercise list is per-workout, not a fixed template; fixed sessions now also allow
  // a one-off today-only add/remove (see selectSession/removeOpenExercise) — remember both so a
  // refresh mid-session doesn't lose a block that hasn't been Mark Done'd (and saved) yet, or bring
  // back one that was just removed.
  if (!selectedSession.cardio) {
    draft.openExercises = selectedSession.exercises.map(e => e.name);
    // Also remember each exercise's current (possibly add/remove-Set-adjusted) row count, so a
    // refresh mid-session doesn't shrink it back to the exercise library's default.
    draft.openSetCounts = {};
    selectedSession.exercises.forEach(e => { draft.openSetCounts[e.name] = e.sets; });
    draft.removedExercises = removedSessionExercises;
    draft.supersetGroups = supersetGroups;
    draft.supersetBaseOrder = supersetBaseOrder;
  }
  // Cardio entries are never saved to the DB until Save Workout — remember the whole list + their
  // current field values so a refresh mid-session doesn't lose them.
  draft.cardio = (selectedSession.cardioEntries || []).map(e => {
    const def = CARDIO_ACTIVITIES[e.activity];
    const values = {};
    (def?.fields || []).forEach(f => {
      const el = document.getElementById(`cardio-${e.id}-${f}`);
      if (el && el.value) values[f] = el.value;
    });
    return { activity: e.activity, values };
  });
  localStorage.setItem('workout_draft', JSON.stringify(draft));
}

// Returns the variations it restored (`{}` if none), so buildWorkoutLogger knows which exercises
// still need one recovering from their already-saved sets.
function restoreDraft(session) {
  const restoredVariations = {};
  try {
    const raw = localStorage.getItem('workout_draft');
    if (!raw) return restoredVariations;
    const draft = JSON.parse(raw);
    if (draft.sessionId !== session.id) return restoredVariations;
    if (draft.timestamp && Date.now() - draft.timestamp > 24*60*60*1000) { localStorage.removeItem('workout_draft'); return restoredVariations; }  // Expire drafts after 24hrs
    session.exercises.forEach(ex => {
      for (let i = 1; i <= ex.sets; i++) {
        const key = `${ex.name}-${i}`;
        if (draft.sets[key]) {
          const wEl = document.getElementById(`w-${ex.name}-${i}`);
          const rEl = document.getElementById(`r-${ex.name}-${i}`);
          if (wEl && wEl.tagName === 'INPUT' && draft.sets[key].w) wEl.value = draft.sets[key].w;
          if (rEl && draft.sets[key].r) rEl.value = draft.sets[key].r;
        }
      }
    });
    bwSyncAll();   // same, for a weight typed before the refresh
    if (draft.notes) document.getElementById('workout-notes').value = draft.notes;

    // Restore cardio entries (never DB-saved until Save Workout, so the draft is the only copy)
    if (draft.cardio && draft.cardio.length) {
      draft.cardio.forEach(c => addCardioEntry(c.activity, c.values));
    }

    // Restore rest times: rebuild pendingRest + repaint the "↳ Rest m:ss" lines
    if (draft.pendingRest) {
      pendingRest = draft.pendingRest;
      Object.keys(pendingRest).forEach(exName => {
        Object.keys(pendingRest[exName]).forEach(setNum => {
          swPaintRestLine(exName, parseInt(setNum), pendingRest[exName][setNum]);
        });
      });
    }

    // Re-select the variation toggles. Last, because applyVariation() repaints the prev badges for
    // the chosen variation and must not be undone by anything above it.
    Object.entries(draft.variations || {}).forEach(([exName, v]) => {
      if (v && applyVariation(exName, v)) restoredVariations[exName] = v;
    });
  } catch(e) {}
  return restoredVariations;
}

// Applies a variation to `selectedVariations` and to the UI: the toggle highlight, the band weight
// labels and the per-set prev badges. Split out of selectVariation() because a refresh/resume has to
// re-select the variation that was actually logged, and there is no click event to hang that off —
// renderExerciseBlock has by then reset every toggle to *last session's* variation. Getting that
// wrong writes sets under the wrong variation, which is the key History's deltas and PRs use.
// Returns false if the variation isn't one this exercise offers (e.g. renamed since it was logged).
function applyVariation(exName, variation) {
  const ex = selectedSession?.exercises.find(e => e.name === exName);
  if (!ex || !ex.variations || !ex.variations.includes(variation)) return false;
  selectedVariations[exName] = variation;

  // Matched by index rather than by button text: the label is esc()'d in the HTML, so comparing
  // rendered text against the raw variation name would miss on anything with a metacharacter.
  const idx = ex.variations.indexOf(variation);
  const btns = document.getElementById(`block-${exName}`)?.querySelectorAll('.variation-toggle .var-btn');
  if (btns) btns.forEach((b, i) => b.classList.toggle('selected', i === idx));

  if (ex.band) {
    for (let i = 1; i <= ex.sets; i++) {
      const wEl = document.getElementById(`w-${exName}-${i}`);
      if (wEl) wEl.textContent = variation;
    }
  } else {
    const prev = previousSets[exName] || (ex.aliases || []).flatMap(a => previousSets[a] || []);
    const filteredPrev = prevSetsForVariation(prev, variation);
    // The per-set grey badges are the only place last time's numbers are shown. There used to be a
    // `Previous (…): …` line written to a `prev-${exName}` element here as well — no such element
    // has ever been rendered, so it was dead code that read like a live path.
    for (let i = 1; i <= ex.sets; i++) {
      const badge = document.getElementById(`badge-${exName}-${i}`);
      const set = filteredPrev[i-1];
      if (badge) badge.textContent = setValueLabel(ex, set);
    }
  }
  return true;
}

// The onclick on every variation button. Saves the draft as well as applying the choice — otherwise
// toggling a variation and then refreshing without typing anything loses the toggle.
function selectVariation(exName, variation) {
  if (!applyVariation(exName, variation)) return;
  if (selectedSession) saveDraft(selectedSession.id);
}

// ─── COMPLETE EXERCISE ────────────────────────────────────
// Reads the filled-in rows for one exercise off the DOM. Pure — no DB, no button repainting — so
// completeExercise() can collect a whole superset before writing any of it.
function collectExerciseSets(ex, supersetGroup) {
  const exName = ex.name;
  const sets = [];
  for (let i = 1; i <= ex.sets; i++) {
    const wEl = document.getElementById(`w-${exName}-${i}`);
    const rEl = document.getElementById(`r-${exName}-${i}`);
    const wVal = wEl ? (wEl.tagName === 'DIV' ? wEl.textContent : wEl.value) : '';
    const rVal = rEl ? rEl.value : '';
    if (wVal || rVal) {
      const isBodyweight = (ex.bodyweight || ex.band || isTimed(ex)) && !isOptionalWeight(ex);
      const setObj = {
        workout_id: currentWorkoutId,
        exercise: exName,
        ...exerciseIdFields(exName),
        set_number: i,
        weight: isBodyweight ? null : optionalWeightValue(ex, wVal),
        reps: parseInt(rVal) || null,
        variation: selectedVariations[exName] || null,
        // Groups made *after* this exercise was marked done are backfilled by persistSupersetGroups()
        // on Save Workout, so the two orderings agree.
        superset_group: supersetGroup
      };
      const restSecs = (pendingRest[exName] && pendingRest[exName][i]) ? pendingRest[exName][i] : 0;
      if (restSecs > 0) swPaintRestLine(exName, i, restSecs);
      setObj.rest_seconds = restSecs;
      sets.push(setObj);
    }
  }

  return sets;
}

// Replaces one exercise's rows wholesale. Returns null on success, or the HTTP status that failed.
// The DELETE is checked because if it failed the POST below would duplicate every set.
// Carries already-recorded rest times across a re-save. Rest reaches the database two different ways:
// before the first Mark Done it buffers in `pendingRest` (and is consumed there), and after it the
// stopwatch PATCHes straight onto the row. So re-tapping Mark Done — which is how you fix a typo —
// deleted the rows holding those rests and re-inserted them as 0, silently blanking that exercise's
// "avg rest" in History. Pure, so it can be tested without a DB.
// A set that carries its own rest wins; the existing value only fills a gap.
function mergeExistingRests(sets, existingRows) {
  const byNum = {};
  (existingRows || []).forEach(r => {
    const secs = parseInt(r.rest_seconds);
    if (!isNaN(secs) && secs > 0) byNum[r.set_number] = secs;
  });
  return sets.map(s => (s.rest_seconds > 0 || !byNum[s.set_number])
    ? s
    : { ...s, rest_seconds: byNum[s.set_number] });
}

async function saveExerciseSets(exName, sets) {
  const scope = `workout_id=eq.${currentWorkoutId}&exercise=eq.${encodeURIComponent(exName)}`;
  // Read before the delete, not after — these are the rows about to be thrown away. Quiet, and a
  // failure just returns [] (no merge): the DELETE below fails too on a dead connection and reports
  // it properly, and a lost rest time must never be the thing that blocks the sets from saving.
  const existing = await sb(`workout_sets?${scope}&select=set_number,rest_seconds`, 'GET', null, { quiet: true });
  const rows = mergeExistingRests(sets, existing);
  const delRes = await sb(`workout_sets?${scope}`, 'DELETE', null, { quiet: true });
  if (!delRes.ok) return delRes.status;
  const saveRes = await sb('workout_sets', 'POST', rows, { quiet: true });
  return saveRes.ok ? null : saveRes.status;
}

// Paints a block as saved. `dataset.done` is the flag the rest of the app reads — refreshSupersetUi()
// checks it before relabelling the button, and saveWorkout() checks it to spot typed-in exercises
// that were never actually written.
function markExerciseBlockDone(exName) {
  const block = document.getElementById(`block-${exName}`);
  if (block) block.style.borderColor = 'var(--green)';
  const doneBtn = document.getElementById(`done-btn-${exName}`);
  if (doneBtn) {
    doneBtn.textContent = '✓ Done';
    doneBtn.dataset.done = '1';
    doneBtn.style.borderColor = 'var(--green)';
    doneBtn.style.color = 'var(--green)';
  }
}

// Completes the whole superset, not just the block whose button was tapped — a superset is one round
// of work, and the app now renders a single Mark Done for it (on the last member, which is where you
// are when the round actually ends). A solo exercise is a group of one, so this is the same path
// either way. Members with nothing typed in are skipped rather than blocking the ones that have data.
async function completeExercise(exName) {
  // Unlocked here, not in the swStart() below, and this is the whole reason it's a separate call:
  // iOS only lets a page create/resume an AudioContext inside a user gesture, and by the time the
  // save has awaited the network this handler is no longer one. Without it, a rest timer that was
  // started by Mark Done rather than by tapping the watch would count down in silence.
  swUnlockAudio();
  if (!selectedSession) return;
  if (!currentWorkoutId) {
    showToast('Session error — go back and re-select the workout', 'error');
    return;
  }
  // ── THE RE-ENTRANCY GUARD (14 Aug 2026) — do not remove ──────────────────────────────────────
  // saveExerciseSets() is GET → DELETE → POST, three round trips, and on gym Wi-Fi that is over a
  // second during which the button sat enabled and said "Mark Done". Tapping it again started a
  // SECOND run whose DELETE had already happened before the first run's POST landed, so both POSTs
  // inserted and the exercise ended up with two copies of every set. Confirmed in live data on
  // 14 Aug: Leg Press carried THREE copies of sets 1 and 2 (created_at 23ms apart), Hip Thrusts two.
  // The damage is silent and spreads — set counts, volume and avg rest are all computed off these
  // rows, and the stopwatch PATCHes onto `existing[0]` so the rest lands on one copy and not the
  // others. One save at a time, app-wide: there is one pair of thumbs.
  if (completeInFlight) return;
  completeInFlight = true;
  const tappedBtn = document.getElementById(`done-btn-${exName}`);
  const tappedLabel = tappedBtn ? tappedBtn.textContent : null;
  if (tappedBtn && !tappedBtn.dataset.done) tappedBtn.textContent = 'Saving…';
  try {
    await completeExerciseInner(exName);
  } finally {
    completeInFlight = false;
    // Only restore if the save didn't repaint it green itself — markExerciseBlockDone() writes
    // "✓ Done", and putting "Mark Done" back over the top of that would undo the confirmation.
    if (tappedBtn && !tappedBtn.dataset.done && tappedLabel !== null) tappedBtn.textContent = tappedLabel;
  }
}

async function completeExerciseInner(exName) {
  const map = supersetGroupMap();
  const group = map[exName] ? (supersetGroupOf(exName) || []).filter(n => map[n]) : [];
  const names = group.length > 1 ? group : [exName];

  const pending = [];
  for (const n of names) {
    const ex = selectedSession.exercises.find(e => e.name === n);
    if (!ex) continue;
    const sets = collectExerciseSets(ex, map[n] || null);
    if (sets.length) pending.push({ name: n, sets });
  }
  if (!pending.length) {
    showToast('Fill in at least one set first', 'error');
    return;
  }

  // Saved one exercise at a time so a failure part-way through still leaves the earlier ones green
  // and written — the retry then only re-does what's actually missing.
  const saved = [];
  for (const { name, sets } of pending) {
    const failedStatus = await saveExerciseSets(name, sets);
    if (failedStatus) {
      saved.forEach(markExerciseBlockDone);
      if (saved.length) currentWorkoutHasSets = true;   // some rows did land — the workout isn't empty
      showToast(`${name} not saved (${failedStatus}) — tap Mark Done again`, 'error');
      return;
    }
    saved.push(name);
    if (pendingRest[name]) delete pendingRest[name];
  }

  currentWorkoutHasSets = true;
  saved.forEach(markExerciseBlockDone);
  showToast(saved.length > 1 ? `Superset saved — ${saved.join(' + ')}` : `${saved[0]} saved!`, 'success');
  lastCompletedExercise = saved[saved.length - 1];
  startRestAfter(lastCompletedExercise);
}

// The rest timer starts itself on Mark Done (14 Aug 2026). Rest begins the moment a set ends, which
// is exactly when this button gets tapped, so the separate tap on the watch was asking for something
// the app already knew.
//
// Three deliberate details:
// - **Only on success.** Every failure path in completeExercise() returns before this, because a
//   Mark Done that didn't save leaves you mid-set with a retry to do, not resting.
// - **The last member of a superset**, which is where the single Mark Done button lives and where the
//   round actually ends — not the block whose name was passed in.
// - **A re-tap restarts the period instead of banking it.** swStart() overwrites a timer already
//   running for the same exercise without going through swStop(), and that's the point: an interval
//   that spans the set you just logged isn't a rest for any set.
// - **`save: false`** (14 Aug 2026). The original version let this timer PATCH itself onto the last
//   typed set when it stopped, which put the walk-to-the-next-machine into `rest_seconds` and wrecked
//   every average built on it. It counts and beeps; it does not record. See swStop().
function startRestAfter(exName) {
  if (!exName) return;
  swStart(exName, { save: false });
}

function selectEditVariation(exName, variation, btn) {
  editSelectedVariations[exName] = variation;
  btn.parentElement.querySelectorAll('.var-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  const s = SESSIONS.find(s => s.id === editingSessionType);
  const ex = s?.exercises.find(e => e.name === exName);
  if (ex?.band) {
    for (let i = 1; i <= ex.sets; i++) {
      const wEl = document.getElementById(`ew-${exName}-${i}`);
      if (wEl) wEl.textContent = variation;
    }
  }
}
// Called when "Log Workout" title is tapped — warns if data exists, then resets back to
// programme/session grid. Async since 19 Aug only because the warning is now askConfirm(); all
// three callers are click handlers that ignore the return value, so nothing had to await it.
async function resetSessionSelection(toProgrammePicker = false) {
  if (selectedSession) {
    const hasData = selectedSession.exercises?.some(ex => {
      for (let i = 1; i <= ex.sets; i++) {
        const r = document.getElementById(`r-${ex.name}-${i}`);
        if (r && r.value) return true;
      }
      return false;
    });
    if (hasData) {
      const leave = await askConfirm({
        title: 'Lose what you have typed?',
        body: `${selectedSession.name} has numbers in it that were never marked done. Going back discards them.`,
        yes: 'Go back anyway',
        no: 'Stay here',
        danger: true,
      });
      if (!leave) return;
    }
  }
  if (currentWorkoutId && !currentWorkoutHasSets) {
    // quiet + not awaited: cleanup of an empty row. If it fails, History and every counter already
    // hide it (realWorkoutsBetween), so there's nothing to tell the user about.
    sb(`workouts?id=eq.${currentWorkoutId}`, 'DELETE', null, { quiet: true });
  }
  currentWorkoutHasSets = false;
  selectedSession = null;
  currentWorkoutId = null;
  // ── A REST YOU WALKED OUT ON DOES NOT GET TO BUZZ (24 Aug 2026) ──────────────────────────────────
  // swStop() and swReset() were the only two callers of cancelRestAlert(), and neither of them runs
  // when you simply leave the session with the watch still counting. The booking outlives the
  // workout, and the phone goes off in the car park. Nothing else here needs the timer, so this ends
  // it outright rather than only silencing the push.
  if (swRunning) swReset(); else cancelRestAlert();
  // Backing out of CV + Pump after a failed save abandons that row rather than reusing it next time.
  // It has no notes and no sets, so every counter already hides it and autoCloseStaleWorkouts() tidies it.
  conditioningWorkoutId = null;
  localStorage.removeItem('workout_draft');

  showWorkoutView('grid');

  if (toProgrammePicker) {
    selectedProgramme = null;
    buildSessionGrid();
  } else {
    buildSessionGrid(selectedProgramme);
  }
}

// ─── SAVE WORKOUT ─────────────────────────────────────────
// Reads cardio entries live from their inputs (not the draft) and maps them to cardio_logs columns.
// Skipped entirely if an entry was added but never filled in.
// Every row always carries the full column set (unused ones as null) — PostgREST's bulk insert
// rejects a batch whose objects have different keys (PGRST102 "All object keys must match"), which
// silently dropped every cardio row whenever a session logged two different activity types together.
const CARDIO_ALL_COLUMNS = ['duration_mins', 'distance', 'floors', 'incline', 'speed_kmh'];
function collectCardioRows() {
  const rows = [];
  (selectedSession?.cardioEntries || []).forEach(e => {
    const def = CARDIO_ACTIVITIES[e.activity];
    if (!def) return;
    const row = { workout_id: currentWorkoutId, activity: e.activity };
    CARDIO_ALL_COLUMNS.forEach(col => { row[col] = null; });
    let hasData = false;
    def.fields.forEach(f => {
      const el = document.getElementById(`cardio-${e.id}-${f}`);
      const val = el && el.value !== '' ? parseFloat(el.value) : null;
      if (val != null) hasData = true;
      const col = f === 'duration' ? 'duration_mins' : f === 'speed' ? 'speed_kmh' : f;
      row[col] = val;
    });
    if (hasData) rows.push(row);
  });
  return rows;
}

async function saveWorkout() {
  if (!selectedSession || !currentWorkoutId) return;

  // Mark Done is what writes sets — nothing else does. So an exercise with numbers typed into it but
  // no green tick has NOTHING in the database, and finishing here would close the workout over the
  // top of it. That is exactly how a 400 on one block turned into a saved-looking session with an
  // exercise missing: every other block was green, so there was nothing on screen to notice.
  const unsaved = (selectedSession.exercises || []).filter(ex => {
    const btn = document.getElementById(`done-btn-${ex.name}`);
    if (btn && btn.dataset.done) return false;
    for (let i = 1; i <= ex.sets; i++) {
      const rEl = document.getElementById(`r-${ex.name}-${i}`);
      const wEl = document.getElementById(`w-${ex.name}-${i}`);
      // A "BW" label is not typed data, so only real inputs count here.
      const wVal = wEl && wEl.tagName !== 'DIV' ? wEl.value : '';
      if ((rEl && rEl.value) || wVal) return true;
    }
    return false;
  }).map(ex => ex.name);
  if (unsaved.length) {
    const finish = await askConfirm({
      title: 'Some exercises were never marked done',
      body: `${unsaved.join('\n')}\n\nThose have numbers filled in but nothing saved. Go back and tap Mark Done on them, or finish the workout without them.`,
      yes: 'Finish without them',
      no: 'Go back',
      danger: true,
    });
    if (!finish) return;
  }

  const notes = document.getElementById('workout-notes')?.value || '';
  const cardioEntryCount = (selectedSession.cardioEntries || []).length;
  const cardioRows = collectCardioRows();
  // An entry exists (user picked an activity) but produced no data — every field read back empty.
  // Warn instead of silently dropping it, since this exact silent-drop cost two days of cardio data.
  if (cardioEntryCount > 0 && cardioRows.length === 0) {
    const saveAnyway = await askConfirm({
      title: 'Cardio entries look empty',
      body: 'Fill in at least one field per entry, or remove them with ✕. The rest of the workout saves either way.',
      yes: 'Save without cardio',
      no: 'Go back',
    });
    if (!saveAnyway) return;
  }
  if (cardioRows.length) {
    // Delete-then-insert, the same idiom saveExerciseSets() uses. The POST used to stand alone, so
    // when a *later* step failed — the toast for which says "tap Save Workout again" — the retry
    // wrote a second copy of every cardio row. Sets have always been idempotent; cardio wasn't.
    // Deliberately inside the `if`: on a resume the cardio entries come from the draft, so an
    // unconditional wipe could bin rows the UI has no way to re-post.
    const wipeRes = await sb(`cardio_logs?workout_id=eq.${currentWorkoutId}`, 'DELETE', null, { quiet: true });
    if (!wipeRes.ok) {
      showToast(`Cardio save failed (${wipeRes.status}) — rest of workout not saved either, tap Save Workout again`, 'error');
      return;
    }
    const cardioRes = await sb('cardio_logs', 'POST', cardioRows, { quiet: true });
    if (!cardioRes.ok) {
      showToast(`Cardio save failed (${cardioRes.status}) — rest of workout not saved either, tap Save Workout again`, 'error');
      return;
    }
  }
  await persistSupersetGroups();
  // This PATCH is what actually completes the workout. It used to be fire-and-forget, so a failure
  // left the session in-progress, cleared the draft below, and still said "Workout saved!". Bail
  // before any of that happens instead — the sets are already safe in the DB, so retrying is free.
  const doneRes = await sb(`workouts?id=eq.${currentWorkoutId}`, 'PATCH',
    { notes, completed_at: new Date().toISOString() }, { quiet: true });
  if (!doneRes.ok) {
    showToast(`Couldn't finish the workout (${doneRes.status}) — your sets are saved, tap Save Workout again`, 'error');
    return;
  }
  showToast('Workout saved!', 'success');
  localStorage.removeItem('workout_draft');
  currentWorkoutHasSets = false;
  currentWorkoutId = null;
  // Captured before the reset below — if this becomes a saved session, whatever you supersetted today
  // should be part of it, not something to rebuild by hand next week.
  const savedGroups = supersetGroupMap();
  supersetGroups = [];
  supersetBaseOrder = [];
  supersetsTouched = false;
  // An Open Workout you'd want to repeat is worth keeping — offer to turn it into a session tile.
  if (selectedSession.id === 'open') {
    await offerSaveOpenAsTemplate((selectedSession.exercises || []).map(e => ({ ...e })), savedGroups);
  }
  showWorkoutView('grid');
  buildSessionGrid(selectedProgramme);
  document.querySelectorAll('.session-btn').forEach(b => b.classList.remove('selected'));
  selectedSession = null;
}

// ─── SAVE CONDITIONING / CV + PUMP ────────────────────────
// Survives a failed save so the retry re-uses the same workouts row instead of creating another.
// Cleared on success and whenever the form is left via resetSessionSelection().
let conditioningWorkoutId = null;

async function saveConditioning() {
  const pumpFocus = document.getElementById('cond-pump-focus').value;
  const pumpMethod = document.getElementById('cond-pump-method').value.trim();
  const activity = document.getElementById('cond-activity').value;
  const duration = parseInt(document.getElementById('cond-duration').value) || null;
  const intensity = document.getElementById('cond-intensity').value;
  const notes = document.getElementById('cond-notes').value.trim();

  if (!activity) { showToast('Add a cardio type first', 'error'); return; }

  const summary = [
    `Pump: ${pumpFocus}${pumpMethod ? ` — ${pumpMethod}` : ''}`,
    `Cardio: ${activity}${duration ? ` — ${duration} mins` : ''} — ${intensity}`,
    notes ? `Notes: ${notes}` : ''
  ].filter(Boolean).join('\n');

  // Ordered so that everything before the final write is idempotent on a retry. Previously the
  // conditioning_logs POST went first and was the only checked write: a failed workouts row was
  // skipped in silence and a failed PATCH had its error toast immediately overwritten by
  // "CV + Pump logged!". Since nothing ever *reads* conditioning_logs, that meant the session
  // vanished from History and every counter while the screen said it had saved.
  //
  // The workouts row is reused across retries rather than created again, so a second attempt can't
  // leave a trail of empty in-progress rows behind it.
  if (!conditioningWorkoutId) conditioningWorkoutId = await createWorkoutRow('cv-pump');
  if (!conditioningWorkoutId) {
    showToast('CV + Pump NOT saved — try again', 'error');
    return;
  }

  // The notes on this row are load-bearing: CV + Pump has no sets and no cardio_logs rows, so
  // realWorkoutsBetween()/loadHistory() only count it as a real session because of them.
  const patchRes = await sb(`workouts?id=eq.${conditioningWorkoutId}`, 'PATCH',
    { notes: summary, completed_at: new Date().toISOString() }, { quiet: true });
  if (!patchRes.ok) {
    showToast(`CV + Pump NOT saved (${patchRes.status}) — try again`, 'error');
    return;
  }

  const condRes = await sb('conditioning_logs', 'POST', {
    date: todayStr(),
    activity,
    duration_mins: duration,
    notes: summary
  }, { quiet: true });
  if (!condRes.ok) {
    showToast(`Saved to History, but the CV + Pump record failed (${condRes.status}) — tap Save again`, 'error');
    return;
  }

  conditioningWorkoutId = null;
  showToast('CV + Pump logged!', 'success');
  ['cond-pump-method','cond-duration','cond-notes'].forEach(id => document.getElementById(id).value = '');
  showWorkoutView('grid');
  selectedSession = null;
  buildSessionGrid(selectedProgramme);
}

// ─── WEIGHT TIMESTAMP ─────────────────────────────────────
// Scale weight swings a kilo overnight on water alone, so a reading is only comparable with another
// one taken at the same point in the day. Until 20 Aug the row carried only the date, so a 7am
// fasted weight and a 9pm post-dinner weight sat in the same trend line and the difference read as
// a gain that never happened. Typing a weight now stamps the clock time beside it.
//
// Stamped, not derived: created_at is when the check-in was typed, which is regularly hours after
// the scale was stood on. The box stays editable for exactly that case.
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Postgres hands a `time` column back as HH:MM:SS; an <input type="time"> wants HH:MM.
function hhmm(v) {
  return v ? String(v).slice(0, 5) : '';
}

// Keeps the "Weighed at" row in step with the weight box: shown only when there is a weight to
// timestamp, cleared when the weight goes. `stamp` fills a blank with the current time — and only a
// blank, because retyping a weight (a correction, or the decimal landing a keystroke later) must not
// overwrite a time set by hand or read back from an earlier save.
function syncWeightTime(prefix, stamp) {
  const weight = document.getElementById(`${prefix}-weight`);
  const row = document.getElementById(`${prefix}-weight-time-row`);
  const time = document.getElementById(`${prefix}-weight-time`);
  if (!weight || !row || !time) return;
  const hasWeight = String(weight.value).trim() !== '';
  row.style.display = hasWeight ? 'flex' : 'none';
  if (!hasWeight) { time.value = ''; return; }
  if (stamp && !time.value) time.value = nowHHMM();
}

// Null unless there is both a weight and a time. A time on its own timestamps nothing, and a weight
// deleted has to take its stamp with it or the row keeps yesterday's hour against today's blank.
function weightTimeValue(prefix) {
  const weight = numOrNull(document.getElementById(`${prefix}-weight`).value);
  const time = document.getElementById(`${prefix}-weight-time`).value;
  return (weight === null || !time) ? null : time;
}

// ─── DAILY LOG ────────────────────────────────────────────
async function loadDailyLog(date = todayStr()) {
  document.getElementById('log-date').value = date;
  document.getElementById('log-weight').value = '';
  document.getElementById('log-weight-time').value = '';
  document.getElementById('log-waist').value = '';
  clearMacroLine();
  document.getElementById('log-steps').value = '';
  document.getElementById('log-cals').value = '';
  document.getElementById('log-fasting').value = '';
  document.getElementById('log-protein').value = '';
  document.getElementById('log-carbs').value = '';
  document.getElementById('log-fat').value = '';
  document.getElementById('log-fibre').value = '';
  document.getElementById('log-notes').value = '';
  setEnergy(0);
  const logs = await sb(`daily_logs?date=eq.${date}&select=*`);
  if (logs && logs.length > 0) {
    const l = logs[0];
    // `!= null`, not truthiness — a stored 0 is a real answer (0 steps, a fasting day) and used to
    // read back as an empty box, so re-saving the check-in quietly wiped it.
    const fill = (id, v) => { if (v != null) document.getElementById(id).value = v; };
    fill('log-weight', l.weight_kg);
    document.getElementById('log-weight-time').value = hhmm(l.weight_time);
    fill('log-waist', l.waist_cm);
    fill('log-steps', l.steps);
    fill('log-cals', l.calories);
    fill('log-fasting', l.fasting_hours);
    fill('log-protein', l.protein_g);
    fill('log-carbs', l.carbs_g);
    fill('log-fat', l.fat_g);
    fill('log-fibre', l.fibre_g);
    if (l.energy) setEnergy(l.energy);   // energy 0 is the slider's "not set" position, not a value
    if (l.notes) document.getElementById('log-notes').value = l.notes;
  }
  // Runs whether or not a log came back: it is what hides the "Weighed at" row on a day with no
  // weight, and what shows it on a day that already has one.
  syncWeightTime('log', false);
}

async function openCheckinModal(date = todayStr()) {
  await loadDailyLog(date);
  document.getElementById('checkin-modal').style.display = 'block';
}

// Home's Daily Check-in tile — 19 Aug 2026, Del's call on "why is daily log a double click to get
// to enter values", open since 14 Aug.
//
// The page it lands on is a summary card plus a Log Today button, which is a reasonable page and a
// bad destination: Check-in exists to enter numbers, and the summary of numbers you have not entered
// yet is not worth a tap. So the tile now goes straight to the boxes.
//
// It still switches to the page underneath rather than opening the modal over Home, and that is the
// point of doing it this way: closing or saving drops you on the summary — which is the one moment
// the summary is worth reading, because by then it has today's numbers in it. The Log Today button
// stays for a second edit in the same day.
async function startCheckin() {
  showPage('today');
  await openCheckinModal();
}

function closeCheckinModal() {
  document.getElementById('checkin-modal').style.display = 'none';
}

async function renderCheckinSummary() {
  const date = todayStr();
  document.getElementById('checkin-summary-date').textContent =
    new Date(date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const logs = await sb(`daily_logs?date=eq.${date}&select=*`);
  const l = logs && logs[0];
  const emptyEl = document.getElementById('checkin-summary-empty');
  const statsEl = document.getElementById('checkin-summary-stats');
  const pillsEl = document.getElementById('checkin-summary-pills');
  const notesEl = document.getElementById('checkin-summary-notes');
  const btn = document.getElementById('checkin-log-btn');
  // The targets block renders either way — with nothing logged it shows empty bars against today's
  // targets, which is the useful state at 7am. Everything below it is hidden until there's an entry.
  renderCheckinGoals(l || {});
  if (!l) {
    emptyEl.style.display = 'block';
    statsEl.style.display = 'none';
    pillsEl.innerHTML = '';
    notesEl.style.display = 'none';
    btn.textContent = 'Log Today';
    return;
  }
  emptyEl.style.display = 'none';
  statsEl.style.display = 'grid';
  document.getElementById('checkin-sum-weight').textContent = l.weight_kg ?? '--';
  // The tile's unit carries the weighing time when there is one, so the number on Home says
  // whether it is comparable with the one it is being read against.
  document.getElementById('checkin-sum-weight-label').textContent =
    l.weight_time ? `kg · ${hhmm(l.weight_time)}` : 'kg';
  document.getElementById('checkin-sum-cals').textContent = l.calories ?? '--';
  document.getElementById('checkin-sum-steps').textContent = l.steps != null ? Number(l.steps).toLocaleString() : '--';
  // The four macro pills that used to sit here were removed 11 Aug 2026 — the targets block above
  // now shows the same numbers with a target beside each, so the pills were the same data twice.
  const pills = [];
  // Waist leads the pills when there is one, because on the days it's measured it's the number that
  // answers the actual goal — the belly — and the three tiles above only carry weight/cals/steps.
  if (l.waist_cm != null) pills.push(`<span class="pill pill-accent">Waist · ${l.waist_cm}cm</span>`);
  if (l.energy) pills.push(`<span class="pill pill-rest">Energy · ${ENERGY_WORDS[l.energy] || l.energy}</span>`);
  pillsEl.innerHTML = pills.join('');
  if (l.notes) { notesEl.style.display = 'block'; notesEl.textContent = l.notes; } else { notesEl.style.display = 'none'; }
  btn.textContent = 'Edit Today';
}

async function saveDailyLog() {
  const date = document.getElementById('log-date').value || todayStr();
  const data = {
    date,
    weight_kg: numOrNull(document.getElementById('log-weight').value),
    weight_time: weightTimeValue('log'),
    waist_cm: numOrNull(document.getElementById('log-waist').value),
    steps: intOrNull(document.getElementById('log-steps').value),
    calories: intOrNull(document.getElementById('log-cals').value),
    fasting_hours: numOrNull(document.getElementById('log-fasting').value),
    protein_g: numOrNull(document.getElementById('log-protein').value),
    carbs_g: numOrNull(document.getElementById('log-carbs').value),
    fat_g: numOrNull(document.getElementById('log-fat').value),
    fibre_g: numOrNull(document.getElementById('log-fibre').value),
    energy: selectedEnergy || null,
    notes: document.getElementById('log-notes').value || null
  };
  const existing = await sb(`daily_logs?date=eq.${date}&select=id`);
  // Both writes used to be unchecked, and the success toast fired regardless — so a failed check-in
  // looked identical to a saved one and the modal closed on numbers that were never stored. The
  // modal deliberately stays OPEN on failure so the typed values aren't lost.
  const res = existing && existing.length > 0
    ? await sb(`daily_logs?date=eq.${date}`, 'PATCH', data, { quiet: true })
    : await sb('daily_logs', 'POST', data, { quiet: true });
  if (!res.ok) {
    showToast(`Check-in NOT saved (${res.status}) — try again`, 'error');
    return;
  }
  showToast(date === todayStr() ? 'Check-in saved!' : `Check-in saved for ${date}!`, 'success');
  closeCheckinModal();
  renderCheckinSummary();
}

// Energy is stored 1–5 in the DB, and null when it was never answered.
//
// The rail runs Flat → Flying and holds nothing else. It briefly carried a sixth stop on the left
// labelled "Not set", which was the wrong fix to the right complaint: Del dragged the thumb fully
// left, expected Flat, and got "—". He rejected "Not set" on sight the same morning — a state word
// has no business being one end of a scale.
//
// So the thumb rests at Flat when nothing has been chosen, because a slider has to sit somewhere,
// and the WORD is what carries the difference: muted while it is only a resting position, accent
// once Del has actually moved it. Untouched still saves null rather than Flat — where the control
// happens to rest is not an answer he gave, and a check-in that quietly claims he felt flat every
// day he skipped the question is worse than one that says nothing.
//
// Index 0 is a placeholder for that null and is never rendered: setEnergy falls back to 1.
const ENERGY_WORDS = ['—', 'Flat', 'Low', 'OK', 'Good', 'Flying'];

function setEnergy(val) {
  selectedEnergy = val || null;
  const slider = document.getElementById('log-energy');
  const word = document.getElementById('log-energy-word');
  if (slider) slider.value = selectedEnergy || 1;
  if (word) {
    word.textContent = ENERGY_WORDS[selectedEnergy || 1];
    word.classList.toggle('energy-unset', !selectedEnergy);
  }
}

// Copies the most recent earlier check-in into the form — the macros are hand-relayed
// from MyFitnessPal daily and rarely move much, so this is usually 90% right.
async function fillFromYesterday() {
  const date = document.getElementById('log-date').value || todayStr();
  const prev = await sb(`daily_logs?date=lt.${date}&order=date.desc&limit=1&select=*`);
  if (!prev || !prev.length) { showToast('No earlier check-in to copy', 'error'); return; }
  const l = prev[0];
  const set = (id, v) => { document.getElementById(id).value = (v === null || v === undefined) ? '' : v; };
  // Waist is deliberately NOT copied. The macros are near enough the same every day, which is what
  // makes this button worth having; a waist is a measurement taken with a tape, and copying last
  // week's forward would write a fabricated one into the run that the Stats card then averages.
  set('log-weight', l.weight_kg);
  set('log-steps', l.steps);
  set('log-cals', l.calories);
  set('log-protein', l.protein_g);
  set('log-carbs', l.carbs_g);
  set('log-fat', l.fat_g);
  set('log-fibre', l.fibre_g);
  setEnergy(l.energy || 0);
  // Yesterday's weighing time belongs to yesterday's weighing. This button copies the number, not
  // the reading, so the stamp is cleared rather than carried across or reset to now — a copied
  // weight wearing today's clock would be a fact nobody recorded.
  document.getElementById('log-weight-time').value = '';
  syncWeightTime('log', false);
  showToast(`Copied from ${l.date}`, 'success');
}

// The one-line box and its echo are cleared alongside the fields, and on every open of the modal.
// Left behind, yesterday's line sits under today's date looking like it has already been applied.
function clearMacroLine() {
  const box = document.getElementById('log-macroline');
  const echo = document.getElementById('log-macroline-echo');
  if (box) box.value = '';
  if (echo) { echo.textContent = ''; echo.className = 'macroline-echo'; }
}

function clearCheckinFields() {
  ['log-weight','log-weight-time','log-waist','log-steps','log-cals','log-protein','log-carbs','log-fat','log-fibre','log-notes']
    .forEach(id => { document.getElementById(id).value = ''; });
  clearMacroLine();
  setEnergy(0);
  syncWeightTime('log', false);
}

// ─── ONE-LINE MACRO ENTRY (18 Aug 2026) ───────────────────
// Del's pet hate: the macros come out of MyFitnessPal and go into this form by hand, five separate
// boxes, five taps at the number pad, every morning. This is the fix — one box that takes the whole
// day in a single go. It fills the ordinary fields rather than replacing them, so anything it gets
// wrong is corrected the way it always was.
//
// The iOS Shortcut route was explicitly rejected (18 Aug), so this deliberately needs no setup on
// his phone, no automation, and no password to keep in step. It is just a box in the app.
//
// Two shapes are understood, tried in that order:
//
//   Labelled — "Calories 2,010  Protein 175g  Carbs 200g  Fat 56g  Fibre 30g", which is the shape
//   of anything pasted or half-remembered out of MyFitnessPal. Order does not matter and unknown
//   words (sodium, sugar) are ignored.
//
//   Positional — "2010 175 200 56 30": bare numbers in the order the form itself lists them,
//   calories first. Four is allowed and means no fibre.
//
// Anything else returns null and fills nothing, because a half-understood paste writing three
// plausible numbers into a check-in is worse than doing nothing.
function parseMacroLine(text) {
  let s = String(text || '').toLowerCase().trim();
  if (!s) return null;
  // "2,010" is one number. Looped rather than one pass with a lookbehind, which older iOS Safari
  // did not have — this file is served to a phone, not to node.
  while (/\d,\d/.test(s)) s = s.replace(/(\d),(\d)/g, '$1$2');

  // Saturated/trans/unsaturated fat sit directly beside the total in a MyFitnessPal breakdown, and
  // whichever appears first in the string would otherwise win. Blanked out before anything is read.
  const body = s.replace(/(?:saturated|sat|trans|polyunsaturated|monounsaturated|unsaturated|poly|mono)[\s.-]*fat\D{0,4}\d+(?:\.\d+)?/g, ' ');

  // Every fragment below comes from a regex LITERAL via .source, never from a quoted string. Written
  // as strings, `\d` and `\s` are just `d` and `s` — the pattern still compiles, still runs, and
  // silently matches nothing, which here meant the labelled branch was dead and the positional
  // fallback quietly answered for it. Caught by tests/macro-line.test.js; kept this way so it cannot
  // come back.
  const NUM = /(\d+(?:\.\d+)?)/.source;          // the number, captured
  const GAP = /\s*[:=]?\s*/.source;              // "Protein 175", "Protein: 175", "Protein=175"
  const UNIT = /\s*(?:g|kcal|cal)?\s*(?:of\s+)?/.source;
  const val = v => (v !== undefined && isFinite(parseFloat(v)) ? parseFloat(v) : null);
  // Which way round the day is written, decided ONCE for the whole string rather than per label.
  // Both "175g protein 200g carbs" and "Protein 175g Carbs 200g" are things people write, but tried
  // in the wrong order each label steals its neighbour's number: on "175g protein 200g carbs" the
  // pattern `protein\s*(\d+)` reads the 200 sitting after the word and reports 200g of protein.
  // Whether the text opens with a number is the tell, and the other order is still tried as a
  // fallback so a mixed line ("Calories 2010, 175g protein") gets both halves.
  const numberFirst = /^\s*\d/.test(body);
  const labelled = (words, src = body) => {
    const after = () => { const m = src.match(new RegExp(`(?:${words})` + GAP + NUM)); return m ? val(m[1]) : null; };
    const before = () => { const m = src.match(new RegExp(NUM + UNIT + `(?:${words})`)); return m ? val(m[1]) : null; };
    return numberFirst ? (before() ?? after()) : (after() ?? before());
  };

  const out = {
    calories: labelled(/calories|calorie|kcals|kcal|cals|cal|energy/.source),
    protein_g: labelled(/protein/.source),
    carbs_g: labelled(/carbohydrates|carbohydrate|carbs|carb/.source),
    // "Total fat" wins outright where it is written; a bare "fat" is the fallback, and by this point
    // the qualified ones have already been stripped out above.
    fat_g: labelled(/total\s*fat/.source) ?? labelled(/fat/.source),
    fibre_g: labelled(/dietary\s*fibre|dietary\s*fiber|fibre|fiber/.source)
  };
  if (Object.values(out).some(v => v !== null)) return out;

  // Nothing was labelled, so it is either the positional shorthand or something we should not guess
  // at. Five numbers is the whole row, four is the row without fibre; any other count is a paste
  // that was not understood, and filling half the form from it would be worse than filling none.
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length !== 4 && nums.length !== 5) return null;
  return {
    calories: nums[0], protein_g: nums[1], carbs_g: nums[2], fat_g: nums[3],
    fibre_g: nums.length === 5 ? nums[4] : null
  };
}

// What the box echoes back underneath itself. The point is that a mis-parse is visible before the
// check-in is saved rather than after — the numbers are in the boxes above too, but this reads in
// one glance and names which is which.
function macroLineEcho(parsed) {
  if (!parsed) return '';
  const bits = [];
  if (parsed.calories != null) bits.push(`${Math.round(parsed.calories).toLocaleString()} kcal`);
  if (parsed.protein_g != null) bits.push(`${parsed.protein_g}p`);
  if (parsed.carbs_g != null) bits.push(`${parsed.carbs_g}c`);
  if (parsed.fat_g != null) bits.push(`${parsed.fat_g}f`);
  if (parsed.fibre_g != null) bits.push(`${parsed.fibre_g} fibre`);
  return bits.join(' · ');
}

// Parses as you type and fills only what it found — a field it could not read is left exactly as it
// was, so typing over one number by hand afterwards is never undone by the next keystroke.
function applyMacroLine() {
  const box = document.getElementById('log-macroline');
  const echo = document.getElementById('log-macroline-echo');
  if (!box || !echo) return;
  const raw = box.value.trim();
  if (!raw) { echo.textContent = ''; echo.className = 'macroline-echo'; return; }
  const parsed = parseMacroLine(raw);
  if (!parsed) {
    echo.className = 'macroline-echo miss';
    echo.textContent = 'Not recognised — try 2010 175 200 56 30';
    return;
  }
  const put = (id, v) => { if (v != null) document.getElementById(id).value = v; };
  put('log-cals', parsed.calories);
  put('log-protein', parsed.protein_g);
  put('log-carbs', parsed.carbs_g);
  put('log-fat', parsed.fat_g);
  put('log-fibre', parsed.fibre_g);
  echo.className = 'macroline-echo hit';
  echo.textContent = macroLineEcho(parsed);
}

// ─── STATS ────────────────────────────────────────────────
// Redesigned 10 Aug 2026: hero weight + hand-rolled SVG trend chart + macro averages.
// The old Chart.js tile-switcher was removed — see CODEBASE.md for what went and why.
async function loadStats() {
  const statsWin = sevenDayWindow();
  const weekAgoStr = statsWin.from;

  const [allWeights, allWaists, allLogs, allWorkouts] = await Promise.all([
    // Every weigh-in, not the last 21 days — the weekly card below needs the whole run. The chart
    // is filtered back down to its 21-day window client-side, so it renders exactly what it always
    // did, and this is still one request rather than two. `not.is.null` because a check-in row with
    // no weight on it is not a weigh-in.
    sb(`daily_logs?weight_kg=not.is.null&order=date.asc&select=date,weight_kg`),
    // Its own request rather than a column on the one above, because the filter is different: a
    // check-in with a weight on it usually has no waist, and `weight_kg=not.is.null` would drop
    // a waist logged on a day that wasn't weighed in.
    sb(`daily_logs?waist_cm=not.is.null&order=date.asc&select=date,waist_cm`),
    // No date filter, same as the two reads above it: the weekly card can navigate to any week in
    // the run, so it needs every day's steps, and the 7-day macro window is sliced out of the same
    // rows locally. A ranged read here as well would put the card's figures and the macro averages
    // on two windows fetched separately, which is the exact shape of the Home/Stats drift bug.
    sb(`daily_logs?order=date.asc&select=date,steps,calories,protein_g,carbs_g,fat_g`),
    // Every real workout, for the same reason: the card counts sessions for whichever week the
    // arrows are on. Raw `workouts` rows would inflate it — an opened-and-abandoned session counts
    // as one — hence the has-sets-or-cardio-or-notes filter inside realWorkoutsBetween().
    realWorkoutsBetween(STATS_EPOCH)
  ]);

  // Only days with an actual weigh-in — skipped days are dropped entirely so the
  // line never shows a hole (Del weighs in ~5 days a week, not 7). The whole run is kept: the
  // range pills above the chart decide the window now, so the old fixed 21-day / last-12 slice
  // moved out of the loader and into pointsForStatsRange().
  statsWeightPoints = (allWeights || [])
    .filter(l => l.weight_kg !== null && l.weight_kg !== undefined)
    .map(l => ({ date: l.date, v: parseFloat(l.weight_kg) }));

  renderWeightRange();
  renderWeeklyAverage(allWeights || [], allWaists || [], allLogs || [], allWorkouts || []);

  // The macro card is the one group on the page that is not week-shaped: a rolling 7 days, the same
  // window Home uses, sliced off the rows already fetched above rather than asked for separately.
  // After both faces have their content: the tile's height is the taller of the two, and neither is
  // known until the week card has decided whether it exists.
  sizeStatsFlip();

  const macroWinLabel = document.getElementById('stats-avg-window');
  if (macroWinLabel) macroWinLabel.textContent = `Last 7 days · ${statsWin.label}`;
  renderMacroAverages((allLogs || []).filter(l => l.date >= weekAgoStr));
}

function renderWeightHero(points, emptyNote) {
  const valEl = document.getElementById('stats-hero-weight');
  const subEl = document.getElementById('stats-hero-delta');
  if (!points.length) {
    valEl.innerHTML = `--<span class="stats-hero-unit">kg</span>`;
    subEl.textContent = emptyNote || 'No weigh-ins yet';
    subEl.className = 'stats-hero-sub flat';
    return;
  }
  const latest = points[points.length - 1];
  valEl.innerHTML = `${latest.v.toFixed(1)}<span class="stats-hero-unit">kg</span>`;
  if (points.length < 2) { subEl.textContent = ''; subEl.className = 'stats-hero-sub flat'; return; }
  const first = points[0];
  const diff = latest.v - first.v;
  const days = Math.max(1, Math.round((new Date(latest.date) - new Date(first.date)) / 86400000));
  if (Math.abs(diff) < 0.05) {
    subEl.textContent = `No change in ${days} days`;
    subEl.className = 'stats-hero-sub flat';
  } else {
    const down = diff < 0;
    subEl.textContent = `${down ? '▼' : '▲'} ${Math.abs(diff).toFixed(1)}kg in ${days} days`;
    subEl.className = `stats-hero-sub ${down ? 'down' : 'up'}`;
  }
}

// ─── Weight chart ────────────────────────────────────────
// The window the chart and the hero above it are drawn over. Not a fetch window — loadStats()
// already holds every weigh-in — so switching range is instant and costs no request.
// Widest first, because the arrows below step through this list by index and ‹ has to mean "show me
// more", the same direction ‹ means on the week card — back through time, not down a menu.
const STATS_RANGES = [
  { id: 'all', name: 'ALL TIME',  days: null, note: 'yet' },
  { id: '90d', name: '90 DAYS',   days: 90,   note: 'the last 90 days' },
  { id: '30d', name: '30 DAYS',   days: 30,   note: 'the last 30 days' },
  { id: '7d',  name: '7 DAYS',    days: 7,    note: 'the last 7 days' },
];
const STATS_RANGE_STORE = 'dlog_stats_range';

// 30 days is the default because it is closest to the fixed 21-day / last-12-points window the
// chart had before it could be stepped — an update shouldn't move the chart under someone.
const STATS_RANGE_DEFAULT = '30d';
let statsRange = STATS_RANGE_DEFAULT;
let statsWeightPoints = [];   // every weigh-in, ascending; sliced per range at render time

try {
  const savedStatsRange = localStorage.getItem(STATS_RANGE_STORE);
  if (STATS_RANGES.some(r => r.id === savedStatsRange)) statsRange = savedStatsRange;
} catch (e) { /* private mode — the range just stops being remembered */ }

// ─── The two-faced weight tile ────────────────────────────────────────────
// Side A is the daily line, side B the week it sits in. One tile, spun by the dots underneath.
let statsFlipFace = 0;

function flipStats(face) {
  const tile = document.getElementById('stats-flip');
  const faces = [document.getElementById('stats-face-a'), document.getElementById('stats-face-b')];
  if (!tile || !faces[0] || !faces[1]) return;
  statsFlipFace = face ? 1 : 0;
  tile.classList.toggle('flipped', statsFlipFace === 1);
  faces.forEach((el, i) => {
    el.classList.toggle('active', i === statsFlipFace);
    // Hidden from the screen reader as well as from the pointer: backface-visibility only takes it
    // off the screen, and a card read out twice is worse than a card that cannot be tapped.
    el.setAttribute('aria-hidden', i === statsFlipFace ? 'false' : 'true');
  });
  const sw = document.getElementById('stats-flip-switch');
  if (sw) {
    sw.classList.toggle('at-b', statsFlipFace === 1);
    sw.querySelectorAll('.flip-switch-opt').forEach((o, i) => {
      o.classList.toggle('active', i === statsFlipFace);
      o.setAttribute('aria-pressed', i === statsFlipFace ? 'true' : 'false');
    });
  }
}

// Swipe the tile itself, which is how you'd expect to turn a card over on a phone. Bound once, on
// the tile rather than on either face, because the faces are swapped in and out from under the
// pointer mid-gesture.
//
// The chart is carved out deliberately: a horizontal drag across it is the scrub readout, and that
// gesture is the whole reason the chart is interactive. Two meanings for one drag in one box is a
// coin toss the user always loses, so the swipe listens everywhere on the tile except there.
function bindStatsFlipSwipe() {
  const tile = document.getElementById('stats-flip');
  if (!tile || tile.dataset.swipeBound) return;
  tile.dataset.swipeBound = '1';

  let x0 = null, y0 = null;
  tile.addEventListener('pointerdown', e => {
    if (e.target.closest('#stats-weight-chart') || e.target.closest('button')) { x0 = null; return; }
    x0 = e.clientX; y0 = e.clientY;
  });
  tile.addEventListener('pointerup', e => {
    if (x0 === null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    x0 = null;
    // 45px and mostly sideways: below that it is a tap, and a diagonal belongs to the page scroll.
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const to = dx < 0 ? 1 : 0;          // drag left to bring the next side in, as a carousel does
    // The switch being hidden is how "there is no second side yet" is stored — a swipe must not be
    // able to reach a side the control says isn't there.
    const sw = document.getElementById('stats-flip-switch');
    if (to !== statsFlipFace && sw && sw.style.display !== 'none') flipStats(to);
  });
  tile.addEventListener('pointercancel', () => { x0 = null; });
}

// Both faces are absolute, so nothing in the flow gives the tile a height — this does, at the taller
// of the two. Called after every render that can change either face's height (the chart's range, the
// week the arrows land on) and on resize, because the chart is fluid and the labels wrap.
//
// A hidden week card measures 0: on an account with no full week yet there is nothing to spin to, so
// the dots go away rather than offering a blank second side.
function sizeStatsFlip() {
  const inner = document.getElementById('stats-flip-inner');
  const a = document.getElementById('stats-face-a');
  const b = document.getElementById('stats-face-b');
  const control = document.getElementById('stats-flip-switch');
  if (!inner || !a || !b) return;
  bindStatsFlipSwipe();
  // Clear before measuring: a face carrying last render's height would measure that back out, and
  // the tile could then only ever grow.
  a.style.height = '';
  b.style.height = '';
  const hb = b.firstElementChild && b.firstElementChild.offsetParent !== null ? b.offsetHeight : 0;
  const h = Math.max(a.offsetHeight, hb);
  inner.style.height = `${h}px`;
  if (control) control.style.display = hb ? 'flex' : 'none';
  if (!hb && statsFlipFace === 1) flipStats(0);   // never strand anyone on a side that isn't there
}

window.addEventListener('resize', () => {
  clearTimeout(window._statsFlipResize);
  window._statsFlipResize = setTimeout(sizeStatsFlip, 150);
});

function statsRangeDef() {
  return STATS_RANGES.find(r => r.id === statsRange) ||
         STATS_RANGES.find(r => r.id === STATS_RANGE_DEFAULT);
}

function pointsForStatsRange() {
  const r = statsRangeDef();
  if (!r.days) return statsWeightPoints;
  const from = new Date();
  from.setDate(from.getDate() - (r.days - 1));
  const fromStr = dateStr(from);
  return statsWeightPoints.filter(p => p.date >= fromStr);
}

function setStatsRange(id) {
  if (!STATS_RANGES.some(r => r.id === id)) return;
  statsRange = id;
  try { localStorage.setItem(STATS_RANGE_STORE, id); } catch (e) { /* see above */ }
  renderWeightRange();
}

function statsRangeEmptyNote(one) {
  const note = statsRangeDef().note;
  if (note === 'yet') return one ? 'Only one weigh-in so far — nothing to draw a line between' : 'No weigh-ins yet';
  return one ? `Only one weigh-in in ${note} — nothing to draw a line between` : `No weigh-ins in ${note}`;
}

// Hero and chart are always drawn together, off the same slice. Two parts of this page disagreed
// about their window once already (the Home/Stats drift, 14 Aug), and this is the one place that
// can stop it recurring: "▼ 0.2kg in 11 days" now means the *selected* range, not a fixed 21 days.
function renderWeightRange() {
  const pts = pointsForStatsRange();
  renderStatsRangeNav(pts);
  renderWeightHero(pts, statsRangeEmptyNote(false));
  renderWeightChart(pts, statsRangeEmptyNote(pts.length === 1));
  sizeStatsFlip();
}

// ‹ widens the window, › narrows it, and both stop at the end of the list rather than wrapping —
// a control that silently jumps from 7 days to all time is a control you have to watch.
function stepStatsRange(delta) {
  const i = STATS_RANGES.findIndex(r => r.id === statsRange);
  const next = STATS_RANGES[i + delta];
  if (next) setStatsRange(next.id);
}

// The dates under the range name are the ones actually drawn, not the ones the range asked for: on
// "90 days" against a run that starts in July, "13 Jul – 23 Aug" is the honest label and 25 May is
// not. It also does the job the axis can't at that width — naming the months only once.
function renderStatsRangeNav(pts) {
  const nameEl = document.getElementById('stats-range-name');
  const spanEl = document.getElementById('stats-range-span');
  if (!nameEl || !spanEl) return;
  nameEl.textContent = statsRangeDef().name;
  spanEl.textContent = pts.length ? dateSpanLabel(pts[0].date, pts[pts.length - 1].date) : 'No weigh-ins';

  const i = STATS_RANGES.findIndex(r => r.id === statsRange);
  const prevBtn = document.getElementById('stats-range-prev');
  const nextBtn = document.getElementById('stats-range-next');
  if (prevBtn) prevBtn.disabled = i <= 0;
  if (nextBtn) nextBtn.disabled = i === -1 || i >= STATS_RANGES.length - 1;
}

// Hand-rolled SVG rather than Chart.js so every point can carry its own value label — and so the
// scrub readout can be wired straight onto coordinates this function has already worked out.
function renderWeightChart(points, emptyNote) {
  const box = document.getElementById('stats-weight-chart');
  if (points.length < 2) {
    box.innerHTML = `<div class="empty">${esc(emptyNote || 'Not enough weigh-ins to chart yet')}</div>`;
    return;
  }
  const W = 300, VBH = 112, TOP = 24, H = 74, L = 26, R = 278;
  const vals = points.map(p => p.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = Math.max(0.4, (max - min) * 0.25);   // keeps a flat week from rendering as a straight edge
  const lo = min - pad, hi = max + pad;
  const x = i => L + i * ((R - L) / (points.length - 1));
  const y = v => TOP + H - ((v - lo) / (hi - lo)) * H;

  const coords = points.map((p, i) => [x(i), y(p.v)]);
  const poly = coords.map(c => `${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
  const area = `M${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)} ` +
    coords.slice(1).map(c => `L${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ') +
    ` L${coords[coords.length-1][0].toFixed(1)},${TOP+H} L${coords[0][0].toFixed(1)},${TOP+H} Z`;

  // At most ~6 printed labels whatever the range holds. The old fixed "every 3rd point" was written
  // for a chart that could never show more than 12; "All" now runs to every weigh-in there is, and
  // the scrub readout is what reads the ones the axis no longer names.
  const step = Math.max(1, Math.ceil(points.length / 6));
  const last = points.length - 1;
  const labelled = i => i === last || (i % step === 0 && last - i > step / 2);
  const dots = points.length <= 24;   // past that the markers merge into one bead of dots

  // A bare day number is only unambiguous inside a month or so. Wider than that the axis has to name
  // the month, or "03" under a 90-day line could be any of three.
  const spanDays = Math.round((new Date(points[last].date) - new Date(points[0].date)) / 86400000);
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const axisLabel = d => {
    const dt = new Date(d);
    return spanDays > 45 ? `${dt.getDate()} ${MON[dt.getMonth()]}` : String(dt.getDate()).padStart(2, '0');
  };

  box.innerHTML = `<svg viewBox="0 0 ${W} ${VBH}" role="img" aria-label="Weight trend">
    <defs><linearGradient id="wgrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#b45527" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="#b45527" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#wgrad)"/>
    <polyline points="${poly}" fill="none" stroke="#b45527" stroke-width="2" stroke-linejoin="round"/>
    ${coords.map((c, i) => {
      const isLast = i === last;
      if (!dots && !isLast) return '';
      return `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${isLast ? 4 : 2.4}" fill="${isLast ? '#b45527' : '#fdfaf4'}" stroke="#b45527" stroke-width="1.7"/>`;
    }).join('')}
    ${coords.map((c, i) => labelled(i)
      ? `<text x="${c[0].toFixed(1)}" y="${(c[1] - 8).toFixed(1)}" text-anchor="middle" font-family="DM Mono, monospace" font-size="8" font-weight="500" fill="${i === last ? '#b45527' : '#6a6053'}">${points[i].v.toFixed(1)}</text>`
      : '').join('')}
    ${coords.map((c, i) => labelled(i)
      ? `<text x="${c[0].toFixed(1)}" y="106" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="7" fill="#8d8272">${axisLabel(points[i].date)}</text>`
      : '').join('')}
    <line class="chart-guide" x1="0" y1="${TOP - 8}" x2="0" y2="${TOP + H + 3}" stroke="#b45527" stroke-width="1" stroke-dasharray="2 3" opacity="0.5" style="display:none"/>
    <circle class="chart-cursor" cx="0" cy="0" r="4.5" fill="#b45527" stroke="#fdfaf4" stroke-width="1.8" style="display:none"/>
  </svg>
  <div class="chart-tip" hidden></div>`;

  bindChartScrub(box, points, coords, W, VBH);
}

// Drag along the line, or tap a point, and the readout names that day. Bound per render rather than
// once at startup because the innerHTML above replaces the <svg>, taking its listeners with it.
function bindChartScrub(box, points, coords, W, VBH) {
  const svg = box.querySelector('svg');
  const tip = box.querySelector('.chart-tip');
  if (!svg || !tip) return;
  const guide = svg.querySelector('.chart-guide');
  const cursor = svg.querySelector('.chart-cursor');
  if (!guide || !cursor) return;

  const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let shown = -1;

  // Nearest by x, not a hit test on the dot: on a phone the fingertip is 40px wide and the dots are
  // 5, so "the point I am on" has to mean the closest column, anywhere in the chart's height.
  const nearest = clientX => {
    const r = svg.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * W;
    let best = 0, bestD = Infinity;
    coords.forEach((c, i) => { const d = Math.abs(c[0] - vx); if (d < bestD) { bestD = d; best = i; } });
    return best;
  };

  const show = i => {
    const [cx, cy] = coords[i];
    const pt = points[i], prev = points[i - 1];
    guide.setAttribute('x1', cx.toFixed(1));
    guide.setAttribute('x2', cx.toFixed(1));
    cursor.setAttribute('cx', cx.toFixed(1));
    cursor.setAttribute('cy', cy.toFixed(1));
    guide.style.display = '';
    cursor.style.display = '';

    const dt = new Date(pt.date);
    // deltaCell() is the helper History's weight rows already use, so a drop is green and a gain is
    // red on both screens off one definition of "lower is better".
    tip.innerHTML = `<span class="chart-tip-date">${DAY[dt.getDay()]} ${dt.getDate()} ${MON[dt.getMonth()]}</span>` +
      `<span class="chart-tip-val">${pt.v.toFixed(1)}kg</span>` +
      (prev ? deltaCell(pt.v - prev.v, { suffix: 'kg', lowerIsBetter: true }) : '');
    tip.hidden = false;

    // The svg scales to the card, so its viewBox units mean nothing to a CSS offset — go through the
    // rendered box. Clamped to that width, or the readout clips off the edge of a phone.
    const r = svg.getBoundingClientRect();
    const px = (cx / W) * r.width, py = (cy / VBH) * r.height;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.round(Math.min(Math.max(px - tw / 2, 0), Math.max(0, r.width - tw)))}px`;
    tip.style.top = `${Math.round(Math.max(0, py - th - 10))}px`;
    shown = i;
  };

  const hide = () => {
    tip.hidden = true;
    guide.style.display = 'none';
    cursor.style.display = 'none';
    shown = -1;
  };

  let dragging = false;
  svg.addEventListener('pointerdown', e => {
    const i = nearest(e.clientX);
    // Tapping the point that is already open closes it. A touch user has no pointer to move off the
    // chart, so without this the readout has no way back off the screen.
    if (i === shown) { hide(); dragging = false; return; }
    dragging = true;
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* older WebKit */ }
    show(i);
  });
  svg.addEventListener('pointermove', e => {
    if (dragging || e.pointerType === 'mouse') show(nearest(e.clientX));
  });
  svg.addEventListener('pointerup', () => { dragging = false; });
  svg.addEventListener('pointercancel', () => { dragging = false; hide(); });
  svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
}

// ─── WEEKLY AVERAGE WEIGHT (17 Aug 2026) ──────────────────
// The daily chart above this card is noise by design — weight bounces a kilo between two mornings
// on the same diet. The weekly average is the number that actually moves, and the app had no way
// to see it. One card: pick a week, get that week's average, get it against the week you're in.
//
// Renumbered 18 Aug 2026 after UAT. This used to print ISO-8601 calendar weeks, so it said "Week
// 33" — a number that means something on a wall calendar and nothing to the one person using the
// app, who thinks in "week 6 of tracking my weight". Weeks are now numbered from the start of the
// current run of weigh-ins, so week 1 is the week he started, not the 1st week of January.
//
// A run ends when the weigh-ins stop. WEEKAVG_RUN_GAP empty weeks is the cut-off: long enough that
// a holiday or an ill fortnight stays inside the same run, short enough that the abandoned Apr–May
// block (last weigh-in 25 May, nothing again until 13 Jul) doesn't drag its count into this one.
// Each run restarts at week 1. Two runs can therefore both have a week 3 — the date range printed
// under the number is what tells them apart, and the seven-week jump in the dates is visible the
// moment you step across the boundary.
//
// Gaps *inside* a run are counted, not skipped: miss a week and the next one is +2, because "week
// 6" means six weeks since you started, not the sixth week you happened to log.
const WEEKAVG_RUN_GAP = 3;

// "Everything, from the beginning." realWorkoutsBetween() takes a from-date, and the honest value
// here is a date before the app existed rather than a guess at how far back to look — the weekly
// card can navigate to any week in the run, so a rolling window would leave older weeks blank.
const STATS_EPOCH = '2025-01-01';

// The Monday of whatever week this date falls in — also the bucket key, since an ISO date sorts
// chronologically as a string and can't collide across years the way a bare week number can.
// Local-time Date, via the same weekIndex() the rest of the app uses, so it can't disagree with
// the week strip about where a week starts.
function mondayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  t.setDate(t.getDate() - weekIndex(t));
  return dateStr(t);
}

// Whole weeks from one Monday to another. Both arguments are already Mondays, so this is exact —
// parsed as UTC so an hour of DST falling between them can't round 7 days down to 6.
function weeksBetween(mondayA, mondayB) {
  const utc = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(mondayB) - utc(mondayA)) / (7 * 86400000));
}

// "13 – 19 Jul", or "27 Jul – 2 Aug" when the week straddles two months. The month is only printed
// twice when it actually changes.
function weekRangeLabel(mondayIso) {
  const [y, m, d] = mondayIso.split('-').map(Number);
  return dateSpanLabel(mondayIso, dateStr(new Date(y, m - 1, d + 6)));
}

// "17 – 23 Aug", "28 Jul – 3 Aug", "13 Jul – 23 Aug". Written out of weekRangeLabel when the chart's
// range stepper needed the same string for a span that isn't a week — two functions formatting a
// date range two ways on one screen is how a page starts looking assembled rather than designed.
// The month is printed once when both ends share it, and the year is checked as well as the month
// so a span that crosses into the same month a year later can't collapse to "13 – 9 Aug".
function dateSpanLabel(fromIso, toIso) {
  const parse = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const a = parse(fromIso), b = parse(toIso);
  const day = dt => String(dt.getDate());
  const mth = dt => dt.toLocaleDateString('en-GB', { month: 'short' });
  if (fromIso === toIso) return `${day(a)} ${mth(a)}`;
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
    ? `${day(a)} – ${day(b)} ${mth(b)}`
    : `${day(a)} ${mth(a)} – ${day(b)} ${mth(b)}`;
}

let _weekAvgs = [];
let _weekAvgKey = null;
// Monday → that week's mean waist. Kept beside _weekAvgs rather than folded into it because the
// two runs are independent: a week can hold five weigh-ins and no waist, or the reverse.
let _weekWaists = {};
let _weekSessions = {};
let _weekSteps = {};
let _weekCals = {};

// Monday → { avg, days, first, last } for one numeric daily-log column, skipping the days that
// carry no figure. `logs` arrives ordered date.asc, so each bucket comes out chronological and
// first/last are the real ends of the span without a re-sort.
function weeklyMeans(logs, field) {
  const buckets = {};
  (logs || []).forEach(l => {
    const v = numOrNull(l[field]);
    if (v === null) return;
    (buckets[mondayOf(l.date)] ||= []).push({ v, date: l.date });
  });
  const out = {};
  Object.keys(buckets).forEach(k => {
    const b = buckets[k];
    out[k] = {
      avg: Math.round(b.reduce((a, c) => a + c.v, 0) / b.length),
      days: b.length,
      first: b[0].date,
      last: b[b.length - 1].date
    };
  });
  return out;
}

function renderWeeklyAverage(allWeights, allWaists = [], allLogs = [], allWorkouts = []) {
  const card = document.getElementById('weekavg-card');
  if (!card) return;

  const buckets = {};
  (allWeights || []).forEach(l => {
    const v = parseFloat(l.weight_kg);
    if (!isFinite(v)) return;
    (buckets[mondayOf(l.date)] ||= []).push(v);
  });

  // Waist is measured about once a week, so most of these buckets hold a single number and the
  // mean is that number. Averaging anyway is what makes two measurements in one week behave.
  const waistBuckets = {};
  (allWaists || []).forEach(l => {
    const v = parseFloat(l.waist_cm);
    if (!isFinite(v)) return;
    (waistBuckets[mondayOf(l.date)] ||= []).push(v);
  });
  _weekWaists = {};
  Object.keys(waistBuckets).forEach(k => {
    _weekWaists[k] = waistBuckets[k].reduce((a, c) => a + c, 0) / waistBuckets[k].length;
  });

  // Sessions: a straight count per week. A week with no workouts in it is a real zero, not a gap,
  // which is why this is only filled in for weeks that have one — `|| 0` at read time does the rest.
  _weekSessions = {};
  (allWorkouts || []).forEach(w => {
    _weekSessions[mondayOf(w.date)] = (_weekSessions[mondayOf(w.date)] || 0) + 1;
  });

  // Steps and calories: the mean of the days that have a figure, not of seven days. Dividing by 7
  // when the watch only synced on four of them prints a number lower than any day Del actually
  // walked, and the same holds for a week he only logged his food on three days of.
  _weekSteps = weeklyMeans(allLogs, 'steps');
  _weekCals  = weeklyMeans(allLogs, 'calories');

  // One pass, oldest first: carry an anchor Monday forward, and drop a new anchor whenever the
  // silence since the last logged week is long enough to count as having stopped.
  let anchor = null, prev = null;
  _weekAvgs = Object.keys(buckets).sort().map(monday => {
    if (anchor === null || weeksBetween(prev, monday) > WEEKAVG_RUN_GAP) anchor = monday;
    prev = monday;
    const vals = buckets[monday];
    return {
      key: monday,
      week: weeksBetween(anchor, monday) + 1,
      monday,
      avg: vals.reduce((a, c) => a + c, 0) / vals.length
    };
  });

  if (!_weekAvgs.length) { card.style.display = 'none'; return; }
  card.style.display = 'block';

  // Opens on the CURRENT week. It used to open on the last completed one, on the reasoning that the
  // current week can only be compared against itself — true, but it meant Del arrowed forward one
  // week every single time he opened Stats, which is a cost paid on every visit to buy a comparison
  // he did not ask for. The card is where you look to see where you are now.
  //
  // The comparison line is what makes that work: on the current week it no longer says "This week so
  // far" and stops, it compares against LAST week, so the default view still answers something.
  const thisKey = mondayOf(todayStr());
  const dflt = _weekAvgs.find(w => w.key === thisKey) || _weekAvgs[_weekAvgs.length - 1];
  showWeeklyAverage(dflt.key);
}

// One week back or forward. `_weekAvgs` is oldest-first, so ‹ is -1 and › is +1, and there is no
// wrapping — running off either end is a disabled arrow, not a jump from this week to April.
function stepWeeklyAverage(delta) {
  const i = _weekAvgs.findIndex(w => w.key === _weekAvgKey);
  if (i === -1) return;
  const next = _weekAvgs[i + delta];
  if (!next) return;
  showWeeklyAverage(next.key);
  // A week with no waist measurement drops a cell and reflows the 2×2 to one row, which changes the
  // face's height — and with it the tile's.
  sizeStatsFlip();
}

// The only comparison this card makes: the week you picked against the week you're in.
function showWeeklyAverage(key) {
  const valEl = document.getElementById('weekavg-val');
  const cmpEl = document.getElementById('weekavg-cmp');
  const rangeEl = document.getElementById('weekavg-range');
  const nameEl = document.getElementById('weekavg-wk-name');
  const picked = _weekAvgs.find(w => w.key === key);
  if (!picked || !valEl || !cmpEl) return;
  _weekAvgKey = key;

  const i = _weekAvgs.indexOf(picked);
  const prevBtn = document.getElementById('weekavg-prev');
  const nextBtn = document.getElementById('weekavg-next');
  if (prevBtn) prevBtn.disabled = i === 0;
  if (nextBtn) nextBtn.disabled = i === _weekAvgs.length - 1;

  if (nameEl) nameEl.textContent = `Week ${picked.week}`;
  if (rangeEl) rangeEl.textContent = weekRangeLabel(picked.monday);
  valEl.innerHTML = `${picked.avg.toFixed(1)}<span class="weekavg-unit">kg</span>`;

  showWeeklyWaist(key);
  showWeeklySplit(key);

  const now = _weekAvgs.find(w => w.key === mondayOf(todayStr()));
  if (!now) { cmpEl.className = 'weekavg-cmp flat'; cmpEl.textContent = 'No weigh-in yet this week'; return; }

  // On the current week, compare against LAST week rather than printing "This week so far" and
  // stopping. Since 19 Aug this is the view the card opens on, and a default view that says nothing
  // is a card you have to interact with before it tells you anything.
  if (now.key === picked.key) {
    const i = _weekAvgs.indexOf(picked);
    const last = i > 0 ? _weekAvgs[i - 1] : null;
    if (!last) { cmpEl.className = 'weekavg-cmp flat'; cmpEl.textContent = 'This week so far'; return; }
    const wd = now.avg - last.avg;
    if (Math.abs(wd) < 0.05) {
      cmpEl.className = 'weekavg-cmp flat';
      cmpEl.textContent = `So far · level with last week (${last.avg.toFixed(1)}kg)`;
    } else {
      cmpEl.className = `weekavg-cmp ${wd < 0 ? 'down' : 'up'}`;
      cmpEl.textContent = `So far · ${wd < 0 ? '▼' : '▲'} ${Math.abs(wd).toFixed(1)}kg vs last week (${last.avg.toFixed(1)}kg)`;
    }
    return;
  }

  const d = now.avg - picked.avg;
  if (Math.abs(d) < 0.05) {
    cmpEl.className = 'weekavg-cmp flat';
    cmpEl.textContent = `Level with this week (${now.avg.toFixed(1)}kg)`;
  } else {
    cmpEl.className = `weekavg-cmp ${d < 0 ? 'down' : 'up'}`;
    cmpEl.textContent = `${d < 0 ? '▼' : '▲'} ${Math.abs(d).toFixed(1)}kg vs this week (${now.avg.toFixed(1)}kg)`;
  }
}

// Sessions, average calories and average steps for the week the arrows are on (18 Aug 2026,
// calories added 19 Aug). They used to be tiles under this card; they read better as part of it,
// because the card already is "how did that week go" and they are three more answers to it.
//
// Sessions falls back to 0 rather than "--": a week in the middle of a run with no workouts in it
// is a week Del did not train, which is worth seeing. The two averages cannot do the same — no
// steps recorded means the watch did not sync rather than that he did not walk, and no calories
// means he did not log rather than that he did not eat, so those stay dashes.
function showWeeklySplit(key) {
  const sessEl = document.getElementById('weekavg-sessions');
  if (sessEl) sessEl.textContent = _weekSessions[key] || 0;
  const cals = _weekCals[key], steps = _weekSteps[key];
  weekHalf('weekavg-cals', cals);
  weekHalf('weekavg-steps', steps);

  // Where the day-span note goes, decided here because this is the only place that can see both
  // columns at once (23 Aug 2026). The note only ever earned its place by explaining a figure that
  // disagrees with Home's seven-day one, and on most weeks it explained the same thing twice:
  // calories and steps come off the same days, so "MON–SAT · 6 DAYS" printed under both columns,
  // wrapped to two lines in each, and knocked the three labels off a shared baseline. Now it is one
  // line under the pair when the spans match, per column only when they genuinely differ, and
  // nothing at all on a full week — "7 days" under a figure already labelled "Avg cals" is the
  // reader's default assumption, not news.
  const cLab = weekSpanNote(cals), sLab = weekSpanNote(steps);
  const shared = cLab && cLab === sLab;
  setSpanNote('weekavg-cals-days', shared ? '' : cLab);
  setSpanNote('weekavg-steps-days', shared ? '' : sLab);
  setSpanNote('weekavg-split-note', shared ? `Averaged over ${cLab}` : '');
}

// One averaged column of the split: just the number. Its day-span note is set by showWeeklySplit.
function weekHalf(id, m) {
  const el = document.getElementById(id);
  if (el) el.textContent = m === undefined ? '--' : m.avg.toLocaleString();
}

function setSpanNote(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// "Mon–Wed · 3 days", or "Mon · 1 day" when there is only one. Empty for a full week and for a
// column with no figure at all: in both of those there is nothing for the note to explain.
function weekSpanNote(st) {
  if (st === undefined || st.days >= 7) return '';
  const wd = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' });
  };
  const span = st.days === 1 ? wd(st.first) : `${wd(st.first)}–${wd(st.last)}`;
  return `${span} · ${st.days} ${st.days === 1 ? 'day' : 'days'}`;
}

// The waist half of the same card (18 Aug 2026), reading the week the arrows have landed on.
//
// Waist is the measurement the goal is actually about — 8–12% body fat means the lower belly goes,
// and scale weight can sit still for a fortnight while the tape moves. It rides under the weight
// rather than on a card of its own because it answers the same question, and because a weekly
// measurement does not fill a card.
//
// The whole block stays hidden until a waist has been logged at least once, so the card is
// unchanged until there is something to put in it. After that it renders on every week, printing
// "Not measured" on the weeks it was skipped — a block that appeared and vanished as you arrowed
// through would jump the card's height on every tap.
function showWeeklyWaist(key) {
  const box = document.getElementById('weekavg-waist');
  const valEl = document.getElementById('weekavg-waist-val');
  const cmpEl = document.getElementById('weekavg-waist-cmp');
  if (!box || !valEl || !cmpEl) return;

  const quad = document.getElementById('weekavg-quad');
  const note = (cls, text) => { cmpEl.className = `weekavg-cell-note ${cls}`; cmpEl.textContent = text; };

  const keys = Object.keys(_weekWaists);
  // Never measured: the cell goes entirely, and the three that are left reflow to one row of three
  // rather than sitting as a 2×2 with a hole in it.
  if (!keys.length) {
    box.style.display = 'none';
    if (quad) quad.classList.add('cols3');
    return;
  }
  box.style.display = 'block';
  if (quad) quad.classList.remove('cols3');

  const picked = _weekWaists[key];
  if (picked === undefined) { valEl.textContent = '--'; note('flat', 'Not measured'); return; }
  // Bare number: the unit lives in the label as "Waist (cm)" since 23 Aug 2026 (Del's call). In a
  // 148px cell the trailing "cm" was what pushed the label onto a second line.
  valEl.textContent = picked.toFixed(1);

  const nowKey = mondayOf(todayStr());
  const now = _weekWaists[nowKey];
  // These strings are terse on purpose. The cell is ~148px and the note is 8.5px uppercase, so the
  // full sentences this block used to print — "Not measured this week yet", "▼ 3.0cm vs this week
  // (96.0cm)" — wrapped to two and three lines once the figure moved into a column.
  if (now === undefined) { note('flat', 'Nothing to compare'); return; }
  if (nowKey === key) { note('flat', 'This week so far'); return; }
  const d = now - picked;
  if (Math.abs(d) < 0.05) { note('flat', 'Level with now'); return; }
  note(d < 0 ? 'down' : 'up', `${d < 0 ? '▼' : '▲'} ${Math.abs(d).toFixed(1)}cm vs now`);
}

// Signed delta, rendered the way the whole card reads it: "on" when it's bang on, else +30 / −17.
// Uses a real minus sign, not a hyphen, so it lines up under DM Mono's tabular figures.
function macroDelta(actual, target) {
  const d = Math.round(actual - target);
  return d === 0 ? 'on' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
}

// One macro row: name · actual/target · meter · verdict. Four grid cells, no wrapper element —
// they're cells of the single #macro-meters grid, which is what keeps the four columns aligned
// across all three rows (see the CSS note: one grid, not one grid per row).
//
// A macro with no target still gets a row — it prints its average and a flat empty meter rather
// than vanishing, so "no fibre target set" never looks like "no fibre logged".
function macroMeterRow(label, actual, target, underIsMiss = false) {
  const a = numOrNull(actual), t = numOrNull(target);
  const state = (a === null || t === null) ? 'empty' : (goalState(a, t, underIsMiss) || 'empty');
  const val = a === null ? '--'
            : t === null ? `<b>${Math.round(a)}</b>g`
            : `<b>${Math.round(a)}</b> / ${Math.round(t)}g`;
  // Capped at 100%: a bar can't overflow its own track, so an over-target macro shows full and the
  // delta beside it carries the overshoot. Same rule as the Check-in meters.
  const pct = (a === null || t === null || t === 0) ? 0 : Math.min(100, Math.round((a / t) * 100));
  const delta = (a === null || t === null) ? '—' : macroDelta(a, t);
  return `<span class="macro-m-name">${esc(label)}</span>
    <span class="macro-m-val">${val}</span>
    <span class="goal-track"><i class="goal-fill ${state}" style="width:${pct}%"></i></span>
    <span class="macro-m-delta gv-${state}">${delta}</span>`;
}

// Redesigned 11 Aug 2026. Was three tiles + a calorie-split bar + a 10px grey calorie line at the
// bottom; the calorie average was the most important number on the card and the least visible, and
// a third of a phone width couldn't hold "Target 175 −6" without wrapping it to three lines.
//
// Now: calories are the headline, the macros are the breakdown, in the same meter rows the Check-in
// page uses. The calorie-split bar and its percentage key were dropped with it — with a meter per
// macro the card already answers "am I hitting my targets", and a second bar meaning something
// different (composition, not progress) sitting underneath was the thing that read as cluttered.
function renderMacroAverages(logs) {
  const avg = key => {
    const vals = logs.filter(l => l[key] !== null && l[key] !== undefined).map(l => parseFloat(l[key]));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const ca = avg('calories'), ct = goalCalories();

  const calVal = document.getElementById('macro-cal-val');
  const calTarget = document.getElementById('macro-cal-target');
  if (calVal) {
    calVal.innerHTML = ca === null ? '--' : `${Math.round(ca).toLocaleString()}<span class="stat-unit">kcal</span>`;
  }
  if (calTarget) {
    const state = (ca === null || ct === null) ? null : goalState(ca, ct);
    calTarget.innerHTML = (ca === null || ct === null) ? ''
      : `Target ${Math.round(ct)}<b class="gv-${state || 'empty'}">${macroDelta(ca, ct)}</b>`;
  }

  const meters = document.getElementById('macro-meters');
  if (meters) {
    meters.innerHTML =
      macroMeterRow('Protein', avg('protein_g'), MACRO_GOALS.protein_g, true) +
      macroMeterRow('Carbs',   avg('carbs_g'),   MACRO_GOALS.carbs_g) +
      macroMeterRow('Fat',     avg('fat_g'),     MACRO_GOALS.fat_g);
  }
}


// ─── HISTORY ─────────────────────────────────────────────
let historyPage = 1;
let historyTab = 'all';
let historyDateRange = 'all';
let historyWorkoutFilter = 'all';
let historySearchTerm = '';
let allHistoryLogs = [];
let allHistoryWorkouts = [];

// The three dropdown/tab filters persist; the search term deliberately does not.
// Every visit to History used to reset all four, so setting "This Week" and stepping across to Stats
// and back put you on All Time again. The search box is the exception on purpose: a filter you
// forgot you set is visible as a highlighted control, whereas a remembered search string reads as
// "my history has gone" — the one failure mode this app has already caused a panic over.
const HISTORY_FILTER_STORE = 'dlog_history_filters';

function saveHistoryFilters() {
  try {
    localStorage.setItem(HISTORY_FILTER_STORE, JSON.stringify({
      tab: historyTab, range: historyDateRange, workout: historyWorkoutFilter
    }));
  } catch (e) { /* private mode / quota — filters just stop being remembered */ }
}

// Called once per History load, after SESSIONS exists so a saved session filter can be validated.
function restoreHistoryFilters(sessionIds = []) {
  historyPage = 1;
  historyTab = 'all';
  historyDateRange = 'all';
  historyWorkoutFilter = 'all';
  historySearchTerm = '';
  let saved;
  try { saved = JSON.parse(localStorage.getItem(HISTORY_FILTER_STORE) || 'null'); } catch (e) { return; }
  if (!saved) return;
  if (['all', 'workouts', 'daily'].includes(saved.tab)) historyTab = saved.tab;
  if (['all', 'month', 'lastweek', 'week'].includes(saved.range)) historyDateRange = saved.range;
  // A deleted session would otherwise leave History filtered to something that no longer exists,
  // which renders as an empty feed with no obvious way back.
  if (saved.workout === 'all' || saved.workout === 'open' || sessionIds.includes(saved.workout)) {
    historyWorkoutFilter = saved.workout;
  }
}

// Builds a `${workoutId}|${exercise}::${variation}` → {best, bestReps, delta, isPR, ...} map.
// Keyed by variation as well as name because e.g. "Hack Squat / Leg Press" carries wildly
// different loads per variation — comparing across them produces nonsense deltas/PRs.
// "best" is the heaviest weight logged in that workout; bodyweight/band work (weight null
// or 0) has no load to compare, so it reports reps only and never claims a delta.
function computeExerciseProgress(workouts, setsByWorkout) {
  const dateById = {};
  (workouts || []).forEach(w => { dateById[w.id] = w.date; });

  const byExercise = {};
  (workouts || []).forEach(w => {
    const perEx = {};
    (setsByWorkout[w.id] || []).forEach(s => {
      const key = `${s.exercise}::${s.variation || ''}`;
      if (!perEx[key]) perEx[key] = {
        exercise: s.exercise, variation: s.variation || null,
        best: null, bestReps: null, rests: [], setCount: 0, supersetGroup: null
      };
      const e = perEx[key];
      e.setCount++;
      if (s.superset_group) e.supersetGroup = s.superset_group;
      const rest = parseInt(s.rest_seconds);
      if (!isNaN(rest) && rest > 0) e.rests.push(rest);
      const wt = parseFloat(s.weight);
      const reps = parseInt(s.reps) || 0;
      if (!isNaN(wt) && wt > 0) {
        // `bestReps` is the best reps at the best weight, not the reps of whichever heaviest set
        // happened to be read first. 56×10 then 56×12 in one session used to report 56×10, which
        // then made the rep PR below un-winnable on the session that actually won it.
        if (e.best === null || wt > e.best) { e.best = wt; e.bestReps = reps; }
        else if (wt === e.best && reps > (e.bestReps || 0)) e.bestReps = reps;
      } else if (e.best === null && reps > (e.bestReps || 0)) {
        e.bestReps = reps;   // bodyweight/band: reps are the only progression signal (seconds, for timed exercises)
      }
    });
    Object.keys(perEx).forEach(key => {
      if (!byExercise[key]) byExercise[key] = [];
      byExercise[key].push({ workoutId: w.id, date: dateById[w.id], ...perEx[key] });
    });
  });

  const out = {};
  Object.keys(byExercise).forEach(key => {
    const list = byExercise[key].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    // ── WHAT COUNTS AS A PR (widened 14 Aug 2026) ────────────────────────────────────────────────
    // It used to be `heaviest weight ever` and nothing else, so two thirds of real progress went
    // unbadged: adding a rep at the same load is the normal way a lift moves — you sit at 56kg for
    // three weeks going 8→10→12 before the weight ever changes — and a bodyweight exercise has no
    // weight to beat at all, so Pull Ups, Dead Bug and the leg raises could never earn a badge in
    // their entire history. Three running bests now, and a session takes the badge if it beats any
    // one that applies to it:
    //   runningMax       — heaviest weight ever                       → a heavier top set
    //   runningRepsAtMax — most reps ever done AT that heaviest weight → same top weight, more reps
    //   runningBwReps    — most reps ever, for work carrying no weight → more reps / a longer hold
    // Reps at a LIGHTER weight are deliberately not a PR: 40×15 doesn't beat 56×10, and badging it
    // would put a PR on every deload week and teach you to ignore the badge.
    let runningMax = null;
    let runningRepsAtMax = 0;
    let runningBwReps = 0;
    list.forEach((entry, i) => {
      const prev = i > 0 ? list[i - 1] : null;
      const delta = (entry.best !== null && prev && prev.best !== null) ? entry.best - prev.best : null;
      const reps = entry.bestReps || 0;

      // First-ever occurrence isn't flagged as a PR — otherwise every old entry wears a badge.
      let isPR = false, prKind = null;
      if (i > 0) {
        if (entry.best !== null && runningMax !== null) {
          if (entry.best > runningMax) { isPR = true; prKind = 'weight'; }
          else if (entry.best === runningMax && reps > runningRepsAtMax) { isPR = true; prKind = 'reps'; }
        } else if (entry.best === null && runningBwReps > 0 && reps > runningBwReps) {
          isPR = true; prKind = 'reps';
        }
      }

      if (entry.best !== null) {
        // A new heaviest weight RESETS the rep record rather than keeping the old one — the reps you
        // managed at 54kg say nothing about what's a good day at 56kg.
        if (runningMax === null || entry.best > runningMax) { runningMax = entry.best; runningRepsAtMax = reps; }
        else if (entry.best === runningMax) runningRepsAtMax = Math.max(runningRepsAtMax, reps);
      } else {
        runningBwReps = Math.max(runningBwReps, reps);
      }

      out[`${entry.workoutId}|${key}`] = {
        exercise: entry.exercise, variation: entry.variation, supersetGroup: entry.supersetGroup,
        best: entry.best, bestReps: entry.bestReps, delta, isPR, prKind,
        avgRest: entry.rests.length ? Math.round(entry.rests.reduce((a, b) => a + b, 0) / entry.rests.length) : null,
        setCount: entry.setCount
      };
    });
  });
  return out;
}

function fmtRest(seconds) {
  if (seconds === null || seconds === undefined) return null;
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Renders the green/red/grey "vs last time" cell shared by workout and check-in cards.
//
// `neutral` prints the change without judging it. Used for every macro: green/red there was actively
// misleading — more calories was painted green and fewer red, which is backwards on a cut, and the
// app has no macro targets to judge against in the first place. Colour is reserved for the two
// things that do have a direction: lift weight (up is better) and bodyweight (lowerIsBetter).
function deltaCell(delta, opts = {}) {
  const { suffix = '', lowerIsBetter = false, decimals = 1, neutral = false } = opts;
  if (delta === null || delta === undefined || isNaN(delta)) return `<span class="pf-d same">—</span>`;
  const rounded = Math.abs(delta) < 0.05 ? 0 : delta;
  if (rounded === 0) return `<span class="pf-d same">—</span>`;
  const txt = `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(decimals).replace(/\.0$/, '')}${suffix}`;
  if (neutral) return `<span class="pf-d neutral">${txt}</span>`;
  const good = lowerIsBetter ? rounded < 0 : rounded > 0;
  return `<span class="pf-d ${good ? 'up' : 'down'}">${txt}</span>`;
}

async function loadHistory() {
  const list = document.getElementById('history-list');
  list.innerHTML = '<div class="loading">Loading history...</div>';
  // Two requests, not four (15 Aug 2026). The sets and the cardio come back nested inside their
  // own workout via PostgREST embedding, so the two follow-up `in.(ids)` round trips are gone —
  // and with them the URL-length ceiling those filters were heading for. `workout_sets.order`
  // orders the rows *within* each workout, which is all the old global order ever achieved once
  // the rows were grouped by workout anyway. `workout_id` stays in the select because the grouped
  // rows are read downstream (computeExerciseProgress, the History cards) as standalone set rows.
  const [logs, workouts] = await Promise.all([
    sb(`daily_logs?order=date.desc&select=*`),
    sb(`workouts?order=date.desc&select=id,date,session_type,notes`
      + `,workout_sets(workout_id,exercise,weight,reps,rest_seconds,set_number,variation,superset_group,created_at)`
      + `,cardio_logs(workout_id,activity,duration_mins,distance,floors,incline,speed_kmh)`
      + `&workout_sets.order=created_at.asc,set_number.asc`)
  ]);
  allHistoryLogs = logs || [];
  // Ordered by created_at so exercises list in the order they were actually completed
  // (workout_sets has no explicit sequence column). rest_seconds drives the rest display.
  window._setsByWorkout = {};
  window._cardioByWorkout = {};
  (workouts || []).forEach(w => {
    if ((w.workout_sets || []).length) window._setsByWorkout[w.id] = w.workout_sets;
    if ((w.cardio_logs || []).length) window._cardioByWorkout[w.id] = w.cardio_logs;
  });
  // The embedded arrays are lifted out above and dropped here: allHistoryWorkouts is filtered,
  // sliced and rendered from all over this file, and it should stay the flat row it has always been.
  allHistoryWorkouts = (workouts || []).map(({ workout_sets, cardio_logs, ...w }) => w);
// Hide (never delete) abandoned sessions: a workouts row is created the instant a session
// tile is tapped, so opening a session and walking away leaves a row with nothing in it.
// Anything with sets, cardio, or notes is real and stays — notes is what keeps CV + Pump
// visible, since it logs to conditioning_logs and has neither sets nor cardio rows.
// Deliberately not keyed on completed_at: autoCloseStaleWorkouts() stamps that onto
// abandoned rows after 24h, which would let them back in.
allHistoryWorkouts = allHistoryWorkouts.filter(w =>
  (window._setsByWorkout[w.id] || []).length > 0 ||
  (window._cardioByWorkout[w.id] || []).length > 0 ||
  (w.notes || '').trim() !== ''
);
// Per-workout-per-exercise deltas vs last time + PR flags, computed once for the whole feed
window._progress = computeExerciseProgress(allHistoryWorkouts, window._setsByWorkout);
  restoreHistoryFilters(SESSIONS.map(s => s.id));
  if (allHistoryLogs.length === 0 && allHistoryWorkouts.length === 0) {
    list.innerHTML = '<div class="empty">No logs yet — start tracking today</div>';
    return;
  }
  renderHistoryPage();
}

// Returns the window History is filtered to, as { start, end } date keys. `end` is null for every
// range that runs up to today — only "Last Week" is a closed window, bounded at both ends, which is
// why this returns a pair rather than the single start date it used to.
function getDateRangeFilter() {
  const today = new Date();
  let startDate = new Date('2000-01-01');
  if (historyDateRange === 'week') {
    return { start: getWeekStart(), end: null };
  } else if (historyDateRange === 'lastweek') {
    // Anchored on getWeekStart() rather than counted back from today, so "last week" is the same
    // Monday-to-Sunday block the week card and the week strip mean by it.
    const start = new Date(`${getWeekStart()}T00:00:00`);
    start.setDate(start.getDate() - 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start: dateStr(start), end: dateStr(end) };
  } else if (historyDateRange === 'month') {
    // setMonth() alone overflows: run on 31 March it asks for 31 February, which JS rolls forward
    // to 3 March — so "Last Month" showed three days instead of a month. Clamp to the last day of
    // the target month first, the way a person reads "a month ago" on the 31st.
    startDate = new Date(today);
    startDate.setDate(1);
    startDate.setMonth(today.getMonth() - 1);
    const lastDayOfTarget = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate();
    startDate.setDate(Math.min(today.getDate(), lastDayOfTarget));
  }
  return { start: dateStr(startDate), end: null };
}

function filterHistoryData() {
  const { start, end } = getDateRangeFilter();
  const inWindow = d => d >= start && (!end || d <= end);
  let filteredLogs = allHistoryLogs.filter(l => inWindow(l.date));
  let filteredWorkouts = allHistoryWorkouts.filter(w => inWindow(w.date));
  
  if (historyWorkoutFilter !== 'all') {
    filteredWorkouts = filteredWorkouts.filter(w => w.session_type === historyWorkoutFilter);
  }
  
  if (historySearchTerm) {
    const search = historySearchTerm.toLowerCase();
    filteredLogs = filteredLogs.filter(l => (l.notes && l.notes.toLowerCase().includes(search)));
    filteredWorkouts = filteredWorkouts.filter(w => (w.notes && w.notes.toLowerCase().includes(search)) || sessionDisplayName(w.session_type).toLowerCase().includes(search));
  }
  
  if (historyTab === 'workouts') return { logs: [], workouts: filteredWorkouts };
  if (historyTab === 'daily') return { logs: filteredLogs, workouts: [] };
  return { logs: filteredLogs, workouts: filteredWorkouts };
}

function renderHistoryPage() {
  const list = document.getElementById('history-list');
  const { logs, workouts } = filterHistoryData();

  // Filter bar — uses CSS classes from style.css, 'selected' attrs preserve dropdown state across re-renders
  let html = `<div class="history-filters">
    <div class="history-tabs">
      <button class="history-tab ${historyTab === 'all' ? 'active' : ''}" onclick="setHistoryTab('all')">All</button>
      <button class="history-tab ${historyTab === 'workouts' ? 'active' : ''}" onclick="setHistoryTab('workouts')">Workouts</button>
      <button class="history-tab ${historyTab === 'daily' ? 'active' : ''}" onclick="setHistoryTab('daily')">Daily Logs</button>
    </div>

    <div class="history-selects">
      <select class="history-select ${historyDateRange !== 'all' ? 'has-value' : ''}" onchange="setHistoryDateRange(this.value)">
        <option value="all" ${historyDateRange === 'all' ? 'selected' : ''}>All Time</option>
        <option value="month" ${historyDateRange === 'month' ? 'selected' : ''}>Last Month</option>
        <option value="lastweek" ${historyDateRange === 'lastweek' ? 'selected' : ''}>Last Week</option>
        <option value="week" ${historyDateRange === 'week' ? 'selected' : ''}>This Week</option>
      </select>
      <select class="history-select ${historyWorkoutFilter !== 'all' ? 'has-value' : ''}" onchange="setHistoryWorkoutFilter(this.value)">
        <option value="all" ${historyWorkoutFilter === 'all' ? 'selected' : ''}>All Workouts</option>
        ${SESSIONS.filter(s => s.id !== 'conditioning').map(s =>
          `<option value="${esc(s.id)}" ${historyWorkoutFilter === s.id ? 'selected' : ''}>${esc(s.name)}</option>`
        ).join('')}
        <option value="open" ${historyWorkoutFilter === 'open' ? 'selected' : ''}>Open Workout</option>
      </select>
    </div>

    <input type="text" class="history-search" id="history-search-input" placeholder="Search notes..." value="${esc(historySearchTerm)}" oninput="setHistorySearch(this.value)" />
  </div>`;

  if (logs.length === 0 && workouts.length === 0) {
    html += '<div class="empty">No results found</div>';
    list.innerHTML = html;
    restoreSearchFocus();
    return;
  }

  const allItems = [];
  logs.forEach(l => allItems.push({ type: 'log', date: l.date, data: l }));
  workouts.forEach(w => allItems.push({ type: 'workout', date: w.date, data: w }));
  allItems.sort((a, b) => b.date.localeCompare(a.date));

  const itemsPerPage = 15;
  const endIdx = historyPage * itemsPerPage;
  const paginatedItems = allItems.slice(0, endIdx);
  const hasMore = allItems.length > endIdx;

  const byDate = {};
  paginatedItems.forEach(item => {
    if (!byDate[item.date]) byDate[item.date] = [];
    byDate[item.date].push(item);
  });

  // Check-in deltas compare against the previous check-in chronologically — built from the
  // full unfiltered set so a filtered view still shows true day-on-day changes.
  const prevLogByDate = {};
  const logsAsc = [...allHistoryLogs].sort((a, b) => a.date.localeCompare(b.date));
  logsAsc.forEach((l, i) => { if (i > 0) prevLogByDate[l.date] = logsAsc[i - 1]; });
  // Waist is a weekly measurement on a daily table, so the *previous check-in* nearly always has no
  // waist on it and a plain day-on-day delta would print an empty column every single time. Each
  // measurement is paired with the last day a waist was actually recorded instead.
  const prevWaistByDate = {};
  let lastWaisted = null;
  logsAsc.forEach(l => {
    if (l.waist_cm === null || l.waist_cm === undefined) return;
    if (lastWaisted) prevWaistByDate[l.date] = lastWaisted;
    lastWaisted = l;
  });

  Object.keys(byDate).sort((a, b) => b.localeCompare(a)).forEach(date => {
    const dateStr = new Date(date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    html += `<div class="history-date-group"><div class="history-date-header">${dateStr}</div>`;

    byDate[date].forEach(item => {
      if (item.type === 'log') {
        const l = item.data;
        const prev = prevLogByDate[l.date] || null;
        const dnum = key => (prev && l[key] !== null && prev[key] !== null &&
                             l[key] !== undefined && prev[key] !== undefined)
          ? parseFloat(l[key]) - parseFloat(prev[key]) : null;
        // Each metric emits its cells straight into one grid for the whole block rather than
        // owning a self-contained row, so the number, the slash and the target line up in columns
        // down the card. As separate rows the value column was `auto`, so "79.9kg", "1985 / 2000"
        // and "171 / 175g" each set their own left edge and the slashes staggered — which is most
        // of what made the card look messy. `sub` is the small line under the label naming what
        // this row is compared against; rows with a target inline don't need one.
        const metric = (label, sub, valCells, cell) =>
          `<span class="pf-mname">${esc(label)}${sub ? `<span class="pf-sub">${esc(sub)}</span>` : ''}</span>${valCells}${cell}`;
        // No target to print, so the value spans the three number columns and right-aligns into
        // the same edge as the targets above and below it.
        const row = (label, sub, value, cell) => value === null || value === undefined ? '' :
          metric(label, sub, `<span class="pf-mval pf-mwide">${esc(value)}</span>`, cell);
        // Macros are judged against the target as of 11 Aug 2026. This column used to be the change
        // since the previous check-in, which read as a shortfall it wasn't — "17g fibre, −10g" was
        // just 27g the day before, not a miss. Printing the target inline in the value column
        // (`168 / 175g`) is what makes the right-hand number unambiguous.
        //
        // Falls back to the old change-vs-previous for any macro with NO target set, so a fibre row
        // still says something useful while there's no fibre goal.
        const macroRow = (label, key, target, opts = {}) => {
          const v = numOrNull(l[key]);
          if (v === null) return '';
          const t = numOrNull(target);
          const unit = opts.unit === undefined ? 'g' : opts.unit;
          if (t === null) {
            return row(label, '', `${v}${unit}`, deltaCell(dnum(key), { suffix: unit, decimals: 0, neutral: true }));
          }
          const cells = `<span class="pf-mval">${Math.round(v)}</span>`
                      + `<span class="pf-msep">/</span>`
                      + `<span class="pf-mtgt">${Math.round(t)}${esc(unit)}</span>`;
          return metric(label, '', cells, missCell(v, t, { suffix: unit, decimals: 0, underIsMiss: !!opts.underIsMiss }));
        };
        // Weight has no target, so it stays a day-on-day change — the one column therefore holds
        // two different kinds of number, which is only safe because each row says which it is: the
        // macro rows carry their target inline, weight and waist carry the date they moved from.
        const prevWaist = prevWaistByDate[l.date] || null;
        const dWaist = prevWaist ? parseFloat(l.waist_cm) - parseFloat(prevWaist.waist_cm) : null;
        const shortDate = d => new Date(d).toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'});
        // The comparison basis sits on the row it belongs to instead of a run-on legend across the
        // top of the card ("macros vs target · weight vs Tue 18 Aug · waist vs Wed 12 Aug"), which
        // had to be read and then mentally mapped back onto three different rows. The macro rows
        // need no legend at all — the target is printed in the row. Waist names its date because
        // the last waist reading is usually a week back, not the card below.
        // The sub-line is the weighing time and nothing else. It used to name the reading being
        // compared against as well ("08:20 · vs 07:45 Wed 19 Aug"), but the feed is already in
        // date order, so the previous check-in is the card directly below this one — restating its
        // date here only added a second thing to read and left a dangling separator on every row
        // with no time recorded, which is every row before 20 Aug 2026.
        const weightSub = l.weight_time ? hhmm(l.weight_time) : '';

        const waistSub = prevWaist ? `vs ${shortDate(prevWaist.date)}` : '';
        const footBits = [];
        if (l.steps != null) footBits.push(`<span>Steps <b>${esc(Number(l.steps).toLocaleString())}</b></span>`);
        if (l.energy) footBits.push(`<span>Energy <b>${esc(ENERGY_WORDS[l.energy] || l.energy)}</b></span>`);
        // esc() rather than a bare "-to-&quot; replace: the old version only escaped double quotes,
        // so a note containing the literal text `&quot;` decoded back into a real quote and broke
        // out of this JS string into executable code. esc() escapes & first, which stops that.
        html += `<div class="pf-card log" onclick="openEditLog(${esc(JSON.stringify(l))})">
          <div class="pf-head">
            <span class="pf-name">CHECK-IN</span>
            <span class="pf-date">${new Date(l.date).toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'})}</span>
          </div>
          <div class="pf-metrics">
            ${row('Weight', weightSub, l.weight_kg !== null && l.weight_kg !== undefined ? `${l.weight_kg}kg` : null, deltaCell(dnum('weight_kg'), {suffix:'kg', lowerIsBetter:true}))}
            ${row('Waist', waistSub, l.waist_cm !== null && l.waist_cm !== undefined ? `${l.waist_cm}cm` : null, deltaCell(dWaist, {suffix:'cm', lowerIsBetter:true}))}
            ${macroRow('Calories', 'calories', goalCalories(), {unit:''})}
            ${macroRow('Protein', 'protein_g', MACRO_GOALS.protein_g, {underIsMiss:true})}
            ${macroRow('Carbs', 'carbs_g', MACRO_GOALS.carbs_g)}
            ${macroRow('Fat', 'fat_g', MACRO_GOALS.fat_g)}
            ${macroRow('Fibre', 'fibre_g', MACRO_GOALS.fibre_g, {underIsMiss:true})}
          </div>
          ${l.notes ? `<div class="history-card-notes">${esc(l.notes)}</div>` : ''}
          ${footBits.length ? `<div class="pf-foot">${footBits.join('')}</div>` : ''}
        </div>`;
      } else {
        const w = item.data;
        const sets = window._setsByWorkout[w.id] || [];
        const order = [];
        sets.forEach(s => {
          const key = `${s.exercise}::${s.variation || ''}`;
          if (!order.includes(key)) order.push(key);
        });
        let prCount = 0, totalSets = 0;
        const allRests = [];
        const liftRows = order.map(key => {
          const p = (window._progress || {})[`${w.id}|${key}`];
          if (!p) return '';
          totalSets += p.setCount;
          if (p.isPR) prCount++;
          if (p.avgRest !== null) allRests.push(p.avgRest);
          const value = isTimed(p.exercise)
                      ? (p.bestReps ? (p.best !== null ? `${p.best}×${p.bestReps}s` : `${p.bestReps}s`) : '—')
                      : p.best !== null ? `${p.best}×${p.bestReps || 0}`
                      : (p.bestReps ? `BW×${p.bestReps}` : '—');
          // A lift with one set has no rest to average — you don't rest after the last set — so
          // this printed a bare `rest —` under a third of the lifts on the card. The logger's
          // lastTimeRestLabel() has always returned '' in the same situation; History now matches.
          const restTxt = p.avgRest !== null ? `rest ${fmtRest(p.avgRest)} avg` : '';
          const label = `${esc(p.exercise)}${p.variation ? ` <span style="color:var(--muted);">· ${esc(p.variation)}</span>` : ''}`;
          // Supersets: the lifts in one group carry the same tag, so they read as a pair on the card.
          const ssTag = p.supersetGroup ? `<span class="pf-ss">s/s ${esc(p.supersetGroup)}</span>` : '';
          return `<div class="pf-lift${p.supersetGroup ? ' pf-ss-row' : ''}">
            <span><span class="pf-lname">${label}${ssTag}${p.isPR ? `<span class="pf-badge">${p.prKind === 'reps' ? 'REP PR' : 'PR'}</span>` : ''}</span>${restTxt ? `<div class="pf-sub">${esc(restTxt)}</div>` : ''}</span>
            <span class="pf-lval">${esc(value)}</span>
            ${p.best !== null ? deltaCell(p.delta, {decimals:1}) : '<span class="pf-d same">—</span>'}
          </div>`;
        }).join('');
        const cardio = window._cardioByWorkout[w.id] || [];
        const sessionRest = allRests.length ? Math.round(allRests.reduce((a,b)=>a+b,0)/allRests.length) : null;
        html += `<div class="pf-card" onclick="openEditWorkout('${jsAttr(w.id)}', '${jsAttr(w.session_type)}', ${esc(JSON.stringify(w.notes||''))})">
          <div class="pf-head">
            <span class="pf-name">${esc(sessionDisplayName(w.session_type))}</span>
            <span class="pf-date">${new Date(w.date).toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'})}</span>
          </div>
          ${liftRows || '<div class="pf-sub" style="padding:4px 0;">No sets logged</div>'}
          ${cardio.length ? `<div class="pf-sub" style="margin-top:6px;">${esc(cardio.map(formatCardioEntry).join(' / '))}</div>` : ''}
          ${w.notes ? `<div class="history-card-notes">${esc(w.notes)}</div>` : ''}
          <div class="pf-foot">
            <span>Sets <b>${totalSets}</b></span>
            <span>PRs <b>${prCount}</b></span>
            ${sessionRest !== null ? `<span>Avg rest <b>${fmtRest(sessionRest)}</b></span>` : ''}
            <span class="pf-delete" onclick="event.stopPropagation();deleteWorkout('${jsAttr(w.id)}')">Delete</span>
          </div>
        </div>`;
      }
    });

    html += `</div>`;
  });

  if (hasMore) {
    html += `<button class="btn btn-outline btn-full" onclick="loadMoreHistory()" style="margin-top:1rem;">Load More</button>`;
  }

  list.innerHTML = html;
  restoreSearchFocus();
}

// Keeps cursor/focus in search box across re-renders (otherwise typing loses focus every keystroke)
let _searchFocusState = null;
function restoreSearchFocus() {
  const input = document.getElementById('history-search-input');
  if (!input || !_searchFocusState) return;
  if (_searchFocusState.focused) {
    input.focus();
    try { input.setSelectionRange(_searchFocusState.pos, _searchFocusState.pos); } catch(e) {}
  }
  _searchFocusState = null;
}

function setHistoryTab(tab) {
  historyTab = tab;
  historyPage = 1;
  saveHistoryFilters();
  renderHistoryPage();
}

function setHistoryDateRange(range) {
  historyDateRange = range;
  historyPage = 1;
  saveHistoryFilters();
  renderHistoryPage();
}

function setHistoryWorkoutFilter(type) {
  historyWorkoutFilter = type;
  historyPage = 1;
  saveHistoryFilters();
  renderHistoryPage();
}

function setHistorySearch(term) {
  // Remember where cursor was so it survives the re-render
  const input = document.getElementById('history-search-input');
  if (input && document.activeElement === input) {
    _searchFocusState = { focused: true, pos: input.selectionStart };
  }
  historySearchTerm = term;
  historyPage = 1;
  renderHistoryPage();
}

function loadMoreHistory() {
  historyPage++;
  renderHistoryPage();
}

// ─── NAV ─────────────────────────────────────────────────
function showPage(name) {
  // Any tab change away from an opened-but-never-logged session deletes its empty
  // workouts row. Home used to be excluded, which left the row behind and showed it
  // as a blank entry in History.
  if (currentWorkoutId && !currentWorkoutHasSets) {
    // Same empty-row cleanup as resetSessionSelection() — quiet for the same reason.
    sb(`workouts?id=eq.${currentWorkoutId}`, 'DELETE', null, { quiet: true });
    currentWorkoutId = null;
    currentWorkoutHasSets = false;
    selectedSession = null;
    showWorkoutView('grid');
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');
  document.getElementById(`nav-${name}`)?.classList.add('active');
  currentPage = name;
  sessionStorage.setItem('del_page', name);
  requestAnimationFrame(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  });
  if (name === 'home') loadHomePage();
  if (name === 'stats') loadStats();
  if (name === 'history') loadHistory();
  if (name === 'today') renderCheckinSummary();
  // Not awaited: the tab must paint now, and the grid it paints is right in every case except the
  // one this catches — a template edited on another device since this one booted. See
  // refreshSessionTemplates(). Landing on Workout is the last moment before a tile gets tapped, so
  // it is the moment worth spending a round trip on.
  if (name === 'workout') refreshSessionTemplates();
  }

// ─── EDIT CHECK-IN MODAL ──────────────────────────────────
let editingLogDate = null;
let editingEnergy = 0;

function openEditLog(l) {
  editingLogDate = l.date;
  editingEnergy = l.energy || 0;
  document.getElementById('edit-modal-title').textContent =
    new Date(l.date).toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long'});
  // `?? ''` rather than `|| ''` — see loadDailyLog(): a stored 0 is a real answer and `||` blanked it,
  // so opening a day with 0 steps and saving turned that 0 into "never recorded".
  const set = (id, v) => { document.getElementById(id).value = v ?? ''; };
  set('edit-weight', l.weight_kg);
  document.getElementById('edit-weight-time').value = hhmm(l.weight_time);
  set('edit-waist', l.waist_cm);
  set('edit-fasting', l.fasting_hours);
  set('edit-cals', l.calories);
  set('edit-steps', l.steps);
  set('edit-protein', l.protein_g);
  set('edit-carbs', l.carbs_g);
  set('edit-fat', l.fat_g);
  set('edit-fibre', l.fibre_g);
  document.getElementById('edit-notes').value = l.notes || '';
  setEditEnergy(editingEnergy);
  syncWeightTime('edit', false);
  document.getElementById('edit-modal').style.display = 'block';
}

function closeEditLog() {
  document.getElementById('edit-modal').style.display = 'none';
  editingLogDate = null;
}

// Same rules as setEnergy() — see the note above ENERGY_WORDS.
function setEditEnergy(val) {
  editingEnergy = val || null;
  const slider = document.getElementById('edit-energy');
  const word = document.getElementById('edit-energy-word');
  if (slider) slider.value = editingEnergy || 1;
  if (word) {
    word.textContent = ENERGY_WORDS[editingEnergy || 1];
    word.classList.toggle('energy-unset', !editingEnergy);
  }
}

async function saveEditLog() {
  if (!editingLogDate) return;
  const res = await sb(`daily_logs?date=eq.${editingLogDate}`, 'PATCH', {
    weight_kg: numOrNull(document.getElementById('edit-weight').value),
    weight_time: weightTimeValue('edit'),
    waist_cm: numOrNull(document.getElementById('edit-waist').value),
    fasting_hours: numOrNull(document.getElementById('edit-fasting').value),
    calories: intOrNull(document.getElementById('edit-cals').value),
    steps: intOrNull(document.getElementById('edit-steps').value),
    protein_g: numOrNull(document.getElementById('edit-protein').value),
    carbs_g: numOrNull(document.getElementById('edit-carbs').value),
    fat_g: numOrNull(document.getElementById('edit-fat').value),
    fibre_g: numOrNull(document.getElementById('edit-fibre').value),
    energy: editingEnergy || null,
    notes: document.getElementById('edit-notes').value || null
  }, { quiet: true });
  // Modal stays open on failure so the corrections aren't lost — same reasoning as saveDailyLog().
  if (!res.ok) { showToast(`NOT updated (${res.status}) — try again`, 'error'); return; }
  showToast('Updated!', 'success');
  closeEditLog();
  loadHistory();
}

// ─── EDIT WORKOUT MODAL ───────────────────────────────────
let editingWorkoutId = null;
let editingSessionType = null;
// Cardio in the edit modal, mirroring the live logger's cardioEntries but tracked against DB rows:
// dbId set = existing cardio_logs row (PATCH on save), dbId null = new entry (POST on save).
let editCardioEntries = [];
let editCardioCounter = 0;
let editRemovedCardioIds = [];

function setEditCardioPreset(id, minutes) {
  const el = document.getElementById(`ecardio-${id}-duration`);
  if (el) el.value = minutes;
}

function handleAddEditCardio(selectEl) {
  const activity = selectEl.value;
  if (!activity || !CARDIO_ACTIVITIES[activity]) return;
  const id = editCardioCounter++;
  editCardioEntries.push({ id, dbId: null, activity });
  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderCardioBlock({ id, activity }, 'edit');
  const addRow = document.getElementById('edit-add-cardio-row');
  addRow.parentNode.insertBefore(wrapper.firstElementChild, addRow);
  selectEl.value = '';
}

function removeEditCardioEntry(id) {
  const entry = editCardioEntries.find(e => e.id === id);
  if (entry && entry.dbId) editRemovedCardioIds.push(entry.dbId);
  editCardioEntries = editCardioEntries.filter(e => e.id !== id);
  const block = document.getElementById(`ecardio-block-${id}`);
  if (block) block.remove();
}

async function openEditWorkout(workoutId, sessionType, notes) {
  editingWorkoutId = workoutId;
  editingSessionType = sessionType;
  editSelectedVariations = {};
  document.getElementById('edit-workout-title').textContent = sessionDisplayName(sessionType);
  document.getElementById('edit-workout-notes').value = notes || '';

  editCardioEntries = [];
  editCardioCounter = 0;
  editRemovedCardioIds = [];
  const cardioListEl = document.getElementById('edit-cardio-list');
  cardioListEl.innerHTML = '';
  // One request, not two (15 Aug 2026) — the cardio rows and the sets both hang off this one
  // workout, so they come back embedded in it rather than as two sequential round trips.
  // created_at first, set_number second — same sort as loadHistory(), so the modal lists
  // exercises in the order they were actually logged. Ordering by set_number alone returned
  // all set 1s, then all set 2s, leaving the exercise order arbitrary.
  const editRow = (await sb(`workouts?id=eq.${workoutId}&select=id,cardio_logs(*),workout_sets(*)&workout_sets.order=created_at.asc,set_number.asc`))?.[0];
  const cardioRows = editRow?.cardio_logs || [];
  (cardioRows || []).forEach(row => {
    const id = editCardioCounter++;
    editCardioEntries.push({ id, dbId: row.id, activity: row.activity });
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderCardioBlock({ id, activity: row.activity }, 'edit');
    cardioListEl.appendChild(wrapper.firstElementChild);
    const def = CARDIO_ACTIVITIES[row.activity];
    (def?.fields || []).forEach(f => {
      const col = f === 'duration' ? 'duration_mins' : f === 'speed' ? 'speed_kmh' : f;
      const el = document.getElementById(`ecardio-${id}-${f}`);
      if (el && row[col] != null) el.value = row[col];
    });
  });
  const cardioSelectEl = document.getElementById('edit-cardio-activity-select');
  cardioSelectEl.innerHTML = `<option value="" selected disabled>Choose an activity…</option>${Object.keys(CARDIO_ACTIVITIES).map(a => `<option value="${esc(a)}">${esc(cardioDisplayName(a))}</option>`).join('')}`;

  const sets = editRow?.workout_sets || [];
  const setsByExercise = {};
  (sets || []).forEach(set => {
    if (!setsByExercise[set.exercise]) setsByExercise[set.exercise] = [];
    setsByExercise[set.exercise].push(set);
  });

  // Exercise list for History edits must come from what was ACTUALLY logged that day (`workout_sets`),
  // never from the live `SESSIONS` template — a fixed session's template can be reordered/added-to/
  // resized after the fact (Session Template Editor), and building this form from the current template
  // was making old workouts appear (and, on save, actually become) whatever the template looks like
  // *now* instead of what was really done. Template/EXERCISE_LIBRARY are only used below as a metadata
  // lookup (variations, bodyweight, band, aliases) by name — never for membership, order, or set count.
  const metaByName = {};
  (SESSIONS.find(s => s.id === sessionType)?.exercises || []).forEach(ex => {
    metaByName[ex.name] = ex;
    (ex.aliases || []).forEach(a => { metaByName[a] = ex; });
  });
  const s = reconstructSessionFromSets(sets, metaByName);

  let html = '';
  if (s) {
    s.exercises.forEach(ex => {
      const exSets = setsByExercise[ex.name] || (ex.aliases || []).flatMap(a => setsByExercise[a] || []);
      const currentVariation = exSets[0]?.variation || (ex.variations ? ex.variations[0] : null);
      if (currentVariation) editSelectedVariations[ex.name] = currentVariation;

      html += `<div class="exercise-block" style="margin-bottom:0.75rem;">
        <div class="ex-name-display" style="margin-bottom:8px;">${esc(ex.name)}</div>`;

      if (ex.variations) {
        const defaultVar = currentVariation || ex.variations[0];
        html += `<div class="variation-toggle">`;
        ex.variations.forEach(v => {
          const isSel = v === defaultVar ? 'selected' : '';
          html += `<button class="var-btn ${isSel}" onclick="selectEditVariation('${jsAttr(ex.name)}', '${jsAttr(v)}', this)">${esc(v)}</button>`;
        });
        html += `</div>`;
      }

      for (let i = 1; i <= ex.sets; i++) {
        const existing = exSets.find(s => s.set_number === i);
        const prevHint = setValueLabel(ex, existing, 'B');
        const repPlaceholder = isTimed(ex) ? 'secs' : (ex.name === 'Walking Lunge' ? 'steps' : 'reps');

        let weightCol = '';
        if (isOptionalWeight(ex)) {
          weightCol = bwCellHtml(`ew-${esc(ex.name)}-${i}`, existing?.weight || '');
        } else if (ex.bodyweight || isTimed(ex)) {
          weightCol = `<div class="set-label" id="ew-${esc(ex.name)}-${i}">BW</div>`;
        } else if (ex.variations && ex.band) {
          const bandLabel = currentVariation || ex.variations[0];
          weightCol = `<div class="set-label" id="ew-${esc(ex.name)}-${i}">${esc(bandLabel)}</div>`;
        } else {
          weightCol = `<input type="text" class="set-input" id="ew-${esc(ex.name)}-${i}" placeholder="kg" value="${esc(existing?.weight || '')}" />`;
        }

        html += `<div class="set-row">
          <div class="set-num">${i}</div>
          ${weightCol}
          <input type="number" class="set-input" id="er-${esc(ex.name)}-${i}" placeholder="${esc(repPlaceholder)}" value="${esc(existing?.reps || '')}" />
          <div class="prev-badge">${esc(prevHint)}</div>
        </div>`;
      }
      html += `</div>`;
    });
  }
  document.getElementById('edit-workout-sets').innerHTML = html;
  document.getElementById('edit-workout-modal').style.display = 'block';
}

function closeEditWorkout() {
  document.getElementById('edit-workout-modal').style.display = 'none';
  editingWorkoutId = null;
  editCardioEntries = [];
  editRemovedCardioIds = [];
}

async function saveEditWorkout() {
  if (!editingWorkoutId) return;
  const notes = document.getElementById('edit-workout-notes').value || null;

  // This function fires a write per set plus one per cardio entry, all of them previously unchecked
  // — a partial failure would silently save some rows and not others while reporting "Updated!".
  // Each write now reports into `failed`, and the modal stays open if anything didn't land.
  let failed = 0;
  const track = res => { if (!res.ok) failed++; return res; };

  track(await sb(`workouts?id=eq.${editingWorkoutId}`, 'PATCH', { notes }, { quiet: true }));

  const existingSets = await sb(`workout_sets?workout_id=eq.${editingWorkoutId}&select=*&order=exercise.asc,set_number.asc`);

  // Must mirror openEditWorkout()'s reconstruction exactly, or this loop targets exercises/set-counts
  // the form was never actually rendered with. See the comment there for why this can't come from the
  // live SESSIONS template.
  const metaByName = {};
  (SESSIONS.find(s => s.id === editingSessionType)?.exercises || []).forEach(ex => {
    metaByName[ex.name] = ex;
    (ex.aliases || []).forEach(a => { metaByName[a] = ex; });
  });
  const s = reconstructSessionFromSets(existingSets, metaByName);

  for (const ex of s.exercises) {
    for (let i = 1; i <= ex.sets; i++) {
      const wEl = document.getElementById(`ew-${ex.name}-${i}`);
      const rEl = document.getElementById(`er-${ex.name}-${i}`);
      if (!wEl || !rEl) continue;

      const wVal = wEl.tagName === 'DIV' ? wEl.textContent : wEl.value;
      const rVal = rEl.value;
      const exNames = [ex.name, ...(ex.aliases || [])];
      const existingSet = (existingSets || []).find(es => exNames.includes(es.exercise) && es.set_number === i);

      if (existingSet) {
        track(await sb(`workout_sets?id=eq.${existingSet.id}`, 'PATCH', {
          weight: ((ex.bodyweight || ex.band || isTimed(ex)) && !isOptionalWeight(ex)) ? null : optionalWeightValue(ex, wVal),
          reps: parseInt(rVal) || null,
          variation: editSelectedVariations[ex.name] || null
        }, { quiet: true }));
      } else if (wVal || rVal) {
        track(await sb('workout_sets', 'POST', {
          workout_id: editingWorkoutId,
          exercise: ex.name,
          set_number: i,
          weight: ((ex.bodyweight || ex.band || isTimed(ex)) && !isOptionalWeight(ex)) ? null : optionalWeightValue(ex, wVal),
          reps: parseInt(rVal) || null,
          variation: editSelectedVariations[ex.name] || null
        }, { quiet: true }));
      }
    }
  }

  // Cardio: delete removed rows, PATCH existing ones, POST new ones.
  for (const dbId of editRemovedCardioIds) {
    track(await sb(`cardio_logs?id=eq.${dbId}`, 'DELETE', null, { quiet: true }));
  }
  for (const entry of editCardioEntries) {
    const def = CARDIO_ACTIVITIES[entry.activity];
    if (!def) continue;
    const row = { workout_id: editingWorkoutId, activity: entry.activity };
    CARDIO_ALL_COLUMNS.forEach(col => { row[col] = null; });
    let hasData = false;
    def.fields.forEach(f => {
      const el = document.getElementById(`ecardio-${entry.id}-${f}`);
      const val = el && el.value !== '' ? parseFloat(el.value) : null;
      if (val != null) hasData = true;
      const col = f === 'duration' ? 'duration_mins' : f === 'speed' ? 'speed_kmh' : f;
      row[col] = val;
    });
    if (!hasData) continue;
    if (entry.dbId) {
      track(await sb(`cardio_logs?id=eq.${entry.dbId}`, 'PATCH', row, { quiet: true }));
    } else {
      track(await sb('cardio_logs', 'POST', row, { quiet: true }));
    }
  }

  if (failed) {
    showToast(`${failed} change${failed > 1 ? 's' : ''} didn't save — tap Save again`, 'error');
    return;
  }
  showToast('Workout updated!', 'success');
  closeEditWorkout();
  loadHistory();
}

// ─── DELETE WORKOUT ───────────────────────────────────────
async function deleteWorkout(workoutId) {
  const gone = await askConfirm({
    title: 'Delete this workout?',
    body: 'Its sets, cardio and notes go with it. This cannot be undone.',
    yes: 'Delete it',
    no: 'Cancel',
    danger: true,
  });
  if (!gone) return;
  // Sets first, then the workout row. If the sets delete fails, stop — deleting the parent would
  // orphan them and the workout would still count nowhere while its sets lingered in the DB.
  const setsRes = await sb(`workout_sets?workout_id=eq.${workoutId}`, 'DELETE', null, { quiet: true });
  if (!setsRes.ok) { showToast(`Delete failed (${setsRes.status}) — nothing removed`, 'error'); return; }
  const res = await sb(`workouts?id=eq.${workoutId}`, 'DELETE', null, { quiet: true });
  if (!res.ok) { showToast(`Delete failed (${res.status})`, 'error'); return; }
  showToast('Workout deleted', 'success');
  buildSessionGrid(selectedProgramme);
  loadHistory();
}

// ─── TOAST ────────────────────────────────────────────────
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.className = 'toast', 2500);
}

// ─── STOPWATCH (inline, per-exercise) ────────────────────
// Uses Date.now() timestamps instead of a counter — this means the timer
// keeps counting correctly even if the phone is locked, tab backgrounded,
// or app minimised. setInterval can be throttled by mobile browsers, but
// wall-clock time can't lie.
let swStartTimestamp = null;   // when the current rest started (ms since epoch)
let swTargetSeconds = 60;      // target rest for the current exercise
let swRunning = false;
let swInterval = null;         // only used to re-render the ring every second
let swActiveExercise = null;   // which exercise the watch is attached to
let swLongPressTimer = null;
let swLongPressFired = false;
let swCompletionBeeped = false; // so we beep only once per rest
// False when the running timer was auto-started by Mark Done — it counts down the gap before the
// NEXT exercise, which is not a rest for any set, so swStop() must not write it. See swStop().
let swSaveOnStop = true;
const SW_RING_CIRCUMFERENCE = 75.4; // 2 * π * r where r=12

// ─── STOPWATCH HELPERS ────────────────────────────────────

// Format seconds as "m:ss" (no leading zero on minutes — "1:15" not "01:15")
function swFormat(s) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

// Phone buzz helper — silently ignored on devices without vibration
function swVibrate(pattern) { if (navigator.vibrate) navigator.vibrate(pattern); }

// ─── REST ALERTS — THE HALF THAT REACHES A POCKET (23 Aug 2026) ──────────────────────────────────
// A Web Push notification, sent by the rest-alert Edge Function, which is called when a rest starts
// and sleeps out the remaining seconds before pushing. This is the only cue that survives a locked
// screen: the wake lock below keeps the beep alive while the app is in front, and this covers the
// case where it isn't.
//
// Three things it depends on, none of them optional:
//   1. D-LOG installed to the Home Screen. iOS gives Safari tabs no push at all, no exception.
//      Confirmed 23 Aug that Del runs it installed.
//   2. Permission, granted from a real tap. Asking on load is how you get a permanent "denied".
//   3. A subscription row per device, which is what the function sends to.
//
// The VAPID public key is public by design — it is handed to the push service on every subscribe.
// The private half is a Supabase function secret and is NOT in this repo, which is public.
const VAPID_PUBLIC_KEY = 'BPtOJx_GRiD6-hM_a9HnBFMd7vSinxPv_kzfqyu0MRPBCx0vLZWWs7mmwgVRtnhPY5NDRkKQfN_d9nEuoeJgijU';
const REST_ALERTS_STORE = 'dlog_rest_alerts';

// The token for the rest currently being counted. The Edge Function re-reads rest_alerts after
// sleeping and stays silent unless the token still matches, which is what stops a rest you ended
// early from buzzing you two minutes later in the middle of the next set.
//
// ── IT LIVES IN STORAGE, NOT IN A VARIABLE (24 Aug 2026) ─────────────────────────────────────────
// It was a module-level `let` until Del's 24 Aug session, and that is why alerts "fired out of
// nowhere". swRestoreFromStorage() rebuilds a running timer from sessionStorage on every navigation
// — Stats and back, or iOS discarding the webview while the phone is in a pocket — but it cannot
// rebuild a plain variable, so the token came back null. cancelRestAlert() opens with
// `if (!token) return`, so after ANY navigation, stopping the watch deleted nothing: the function
// slept on and the phone buzzed in the middle of the next set.
//
// localStorage rather than sessionStorage, because the case with nothing else left to cancel with is
// the app being killed and relaunched mid-rest — sessionStorage dies with the tab, this doesn't.
// A token left behind by a rest nobody ever ended is harmless: the next rest's upsert replaces the
// row, so the orphaned function wakes, sees a token it doesn't recognise, and says nothing.
const REST_TOKEN_STORE = 'dlog_rest_token';

function restAlertToken() {
  try { return localStorage.getItem(REST_TOKEN_STORE); } catch (e) { return null; }
}

function setRestAlertToken(token) {
  try {
    if (token) localStorage.setItem(REST_TOKEN_STORE, token);
    else localStorage.removeItem(REST_TOKEN_STORE);
  } catch (e) {}
}

// Closes any rest alert still sitting on the lock screen. sw.js tags every one 'rest-alert' so that a
// new one REPLACES the last rather than stacking — and iOS does not honour the tag. Del came out of a
// two-hour session on 24 Aug with 17 of them piled up, one per rest, not one of which had meant
// anything since the set after it. So the app closes them itself: when the next rest starts, when a
// rest is cancelled, and when the app comes back to the front.
async function clearRestNotifications() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg || typeof reg.getNotifications !== 'function') return;
    const open = await reg.getNotifications({ tag: 'rest-alert' });
    (open || []).forEach(n => n.close());
  } catch (e) { /* not supported, or no registration yet — nothing to close either way */ }
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Both halves have to be true. The localStorage flag alone would keep claiming alerts are on after
// permission was revoked in Settings; permission alone would turn them back on for someone who
// deliberately switched them off in the app.
function restAlertsOn() {
  if (!pushSupported()) return false;
  try {
    return Notification.permission === 'granted' && localStorage.getItem(REST_ALERTS_STORE) === '1';
  } catch (e) { return false; }
}

// The applicationServerKey has to be raw bytes, and VAPID keys travel as base64url.
function urlB64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - base64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function b64FromBuffer(buf) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
}

// Must be called from inside a tap — see note 2 above.
async function enableRestAlerts() {
  if (!pushSupported()) {
    showToast('This phone has no notification support', 'error');
    return false;
  }
  let permission;
  try { permission = await Notification.requestPermission(); } catch (e) { permission = 'denied'; }
  if (permission !== 'granted') {
    // iOS only shows the system prompt once ever. After a refusal the only way back is Settings, so
    // say that rather than letting a second tap look broken.
    showToast('Notifications are off — turn them on in iPhone Settings › D-LOG', 'error');
    return false;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const row = {
      endpoint: sub.endpoint,
      p256dh: b64FromBuffer(sub.getKey('p256dh')),
      auth: b64FromBuffer(sub.getKey('auth')),
      user_agent: navigator.userAgent.slice(0, 300),
    };
    // user_id defaults to auth.uid(), same as profiles — the client never says whose row this is.
    const res = await sb('push_subscriptions?on_conflict=endpoint', 'POST', row, { upsert: true, quiet: true });
    if (!res.ok) {
      showToast(`Couldn't save the subscription (${res.status})`, 'error');
      return false;
    }
    localStorage.setItem(REST_ALERTS_STORE, '1');
    paintRestAlertsButton();
    return true;
  } catch (e) {
    console.error('enableRestAlerts', e);
    showToast("Couldn't turn rest alerts on", 'error');
    return false;
  }
}

async function disableRestAlerts() {
  try { localStorage.setItem(REST_ALERTS_STORE, '0'); } catch (e) {}
  paintRestAlertsButton();
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, 'DELETE', null, { quiet: true });
      await sub.unsubscribe();
    }
  } catch (e) { /* the flag is off either way, which is what the user asked for */ }
}

async function toggleRestAlerts() {
  if (restAlertsOn()) {
    await disableRestAlerts();
    showToast('Rest alerts off');
    return;
  }
  const ok = await enableRestAlerts();
  if (ok) showToast('Rest alerts on — try Test alert', 'success');
}

function paintRestAlertsButton() {
  const btn = document.getElementById('rest-alerts-btn');
  if (!btn) return;
  if (!pushSupported()) {
    btn.textContent = 'Rest alerts — not supported';
    btn.disabled = true;
    return;
  }
  btn.textContent = restAlertsOn() ? 'Rest alerts: on' : 'Rest alerts: off';
}

// Books the notification for a rest that has just started. Fire-and-forget on purpose: a rest must
// start the instant the watch is tapped, and in a gym basement both calls below simply fail. The
// beep and the wake lock are unaffected by that — this is an addition to the cue, never the cue.
async function scheduleRestAlert(exName, seconds) {
  if (!restAlertsOn() || !(seconds >= 1)) return;
  // ── THE DEADLINE IS STAMPED HERE, AT THE TAP (24 Aug 2026) ─────────────────────────────────────
  // The function used to be handed a DURATION and started counting it out when it began running, so
  // the upsert below, the token check, the dispatch, the Deno cold start and — on a 180s rest — a
  // second cold start for the chain hop were all added on top of the rest itself. That is the 4–6s
  // late Del measured in the gym on 24 Aug. An absolute deadline absorbs all of it: however slow the
  // round trip was, the function still counts to the same instant.
  const dueAt = Date.now() + seconds * 1000;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  setRestAlertToken(token);
  clearRestNotifications();   // the last rest's alert is stale the moment this one starts
  try {
    const row = {
      token,
      due_at: new Date(dueAt).toISOString(),
      exercise: exName || null,
      updated_at: new Date().toISOString(),
    };
    const res = await sb('rest_alerts?on_conflict=user_id', 'POST', row, { upsert: true, quiet: true });
    if (!res.ok) return;
    const jwt = await validAccessToken();
    if (!jwt) return;
    // Not awaited beyond the dispatch — this request stays open for the whole rest by design.
    // `seconds` still travels alongside `dueAt` so a function deployed before this change keeps
    // working; the new one prefers the deadline and ignores it.
    netFetch(`${SUPABASE_URL}/functions/v1/rest-alert`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds, dueAt, token, exercise: exName || '' }),
    }).catch(() => {});
  } catch (e) { /* no signal — the beep and the wake lock still stand */ }
}

// Called when a rest ends by any route: stopped, reset, or already announced by the in-app beep.
// Deleting the row is what makes the sleeping function stay quiet.
async function cancelRestAlert() {
  // Read the token synchronously, before the first await. swStart() calls swStop() and then books the
  // next rest in the same tick, so a token read after that point would name the rest that has just
  // STARTED rather than the one being cancelled.
  const token = restAlertToken();
  setRestAlertToken(null);
  clearRestNotifications();
  if (!token || !restAlertsOn()) return;
  try {
    // ── SCOPED TO THE TOKEN, NOT TO THE USER (24 Aug 2026) ───────────────────────────────────────
    // This was `DELETE rest_alerts` with no filter, which deletes whatever row happens to be there —
    // including a rest booked microseconds earlier by swStart(). The delete and the upsert are two
    // unordered requests, and when the delete landed second it silently disarmed the rest that had
    // just started. That is Del's lateral raise first set, 24 Aug: no alert, no error, no pattern.
    // Filtered by token, the order stops mattering — a stale cancel can only ever delete its own row.
    await sb(`rest_alerts?token=eq.${encodeURIComponent(token)}`, 'DELETE', null, { quiet: true });
  } catch (e) {}
}

// The whole point of shipping this on a Sunday: Del can prove the route works from his sofa instead
// of finding out mid-session. Five seconds is long enough to lock the phone and put it down.
async function testRestAlert() {
  const btn = document.getElementById('rest-alerts-test');
  if (!restAlertsOn()) {
    const ok = await enableRestAlerts();
    if (!ok) return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  const token = `test-${Date.now()}`;
  const dueAt = Date.now() + 5000;
  setRestAlertToken(token);
  clearRestNotifications();
  try {
    const row = { token, due_at: new Date(dueAt).toISOString(), exercise: 'Test', updated_at: new Date().toISOString() };
    const res = await sb('rest_alerts?on_conflict=user_id', 'POST', row, { upsert: true, quiet: true });
    const jwt = await validAccessToken();
    if (!res.ok || !jwt) {
      showToast('Test failed — no connection', 'error');
    } else {
      netFetch(`${SUPABASE_URL}/functions/v1/rest-alert`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds: 5, dueAt, token, exercise: 'Test' }),
      }).catch(() => {});
      showToast('Lock your phone — it should buzz in 5s', 'success');
    }
  } catch (e) {
    showToast('Test failed', 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Test alert'; }
}

// ─── SCREEN WAKE LOCK — THE HALF THAT NEEDS NO NETWORK (23 Aug 2026) ─────────────────────────────
// swBeep() can only fire while the page is still rendering: screen on, app in front, logger visible.
// Four months of gym use say that is precisely when it isn't — the phone goes in a pocket and the
// rest ends in silence. The 21 Aug fix for that (a long silent WAV so the tones landed on wall-clock
// time) worked and was binned after one session, because a page playing audio owns the iOS audio
// session for the length of the file and Spotify stopped for the WHOLE rest. See the note above
// swElapsed() — that trade has been refused and must not be reintroduced.
//
// This is the cheap half of the replacement: while a rest is counting, ask iOS not to sleep the
// screen. The render tick keeps ticking, so the beep that already exists fires on time. The only
// thing the page takes from the system is the backlight — it never touches the audio session, so
// Spotify plays straight through. No keys, no permission prompt, no network, works in a basement.
// Web Push is the other half and is the only thing that covers the pocket; this covers the bench.
//
// Held for the REST PERIOD ONLY — dropped the instant the completion beep fires, and on stop/reset.
// A lock held for a whole session would drain the battery long after the cue it was taken for.
let swWakeLock = null;

async function swAcquireWakeLock() {
  if (!('wakeLock' in navigator) || swWakeLock) return;
  try {
    swWakeLock = await navigator.wakeLock.request('screen');
    // iOS releases the lock itself the moment the page is hidden, and the stale sentinel would then
    // make the guard above skip a re-acquire forever. Null it here so the handler below can retake.
    swWakeLock.addEventListener('release', () => { swWakeLock = null; });
  } catch (e) {
    // Denied, low-power mode, or a browser without it. The beep is unaffected — this is an upgrade
    // to the odds it is heard, never a dependency of it.
    swWakeLock = null;
  }
}

function swReleaseWakeLock() {
  if (!swWakeLock) return;
  try { swWakeLock.release(); } catch (e) { /* already released by the system */ }
  swWakeLock = null;
}

// Glancing at the app mid-rest hands back a page whose lock was dropped when it was hidden. Without
// this the screen sleeps again a few seconds later and the beep is lost exactly as before.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (swRunning && !swCompletionBeeped) swAcquireWakeLock();
  // If you are looking at the app you have had the cue. Anything still on the lock screen from an
  // earlier rest is now just clutter Del has to swipe away one at a time — see clearRestNotifications().
  clearRestNotifications();
});

// Parse "180s" / "90s" / "2min" into a number of seconds, default 60
function swParseRest(restStr) {
  if (!restStr) return 60;
  const m = restStr.match(/(\d+)/);
  return m ? parseInt(m[1]) : 60;
}

// WEB AUDIO BEEP — two short tones when the target rest is reached.
// Lazy-init so the audio context is only created when needed.
// iOS requires audio to be triggered from a user gesture, which tapping
// the watch counts as, so the first beep will work after that first tap.
// ─── AUDIO (iOS-aware) ───────────────────────────────────
// iOS blocks Web Audio until the user has tapped something. We unlock the
// context on the first watch tap and re-resume it on every subsequent tap,
// because iOS suspends the context on screen lock (common during gym rest).
let swAudioCtx = null;

// Called from swStart — runs INSIDE a user-gesture callback.
// Creates the context on first call; on every subsequent call it re-resumes it,
// because iOS suspends the context whenever the screen locks (common during gym rest).
function swUnlockAudio() {
  try {
    if (!swAudioCtx) {
      swAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // Play a 1ms silent buffer to convince iOS this context is "alive"
      const buf = swAudioCtx.createBuffer(1, 1, 22050);
      const src = swAudioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(swAudioCtx.destination);
      src.start(0);
    }
    // Always resume — cheap/idempotent if already running, essential if iOS suspended it
    if (swAudioCtx.state === 'suspended') swAudioCtx.resume();
  } catch (e) { /* device without audio */ }
}

// await the resume before scheduling oscillators — if iOS suspended the context
// while the screen was locked, scheduling without waiting produces silence.
async function swBeep() {
  if (!swAudioCtx) return;
  try {
    if (swAudioCtx.state === 'suspended') await swAudioCtx.resume();
    const now = swAudioCtx.currentTime;
    [0, 0.18].forEach(offset => {
      const osc = swAudioCtx.createOscillator();
      const gain = swAudioCtx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.4, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.14);
      osc.connect(gain); gain.connect(swAudioCtx.destination);
      osc.start(now + offset); osc.stop(now + offset + 0.16);
    });
  } catch (e) { /* silent fail */ }
}

// ─── WHY THERE IS NO SCHEDULED CUE (22 Aug 2026) ─────────────────────────────────────────────────
// There was one, for a day. It handed iOS a WAV of N seconds of near-silence followed by the two
// tones, so the beep arrived on wall-clock time with the screen locked and the app backgrounded —
// the one case swBeep() above can never cover, because iOS suspends the AudioContext on lock and
// setInterval is frozen by then anyway.
//
// It worked, and Del binned it after one session. A page playing audio holds the audio session for
// as long as the file lasts, so Spotify stopped for the WHOLE rest rather than for the beep. iOS
// picks duck-or-pause and a web page cannot ask for either, nor can it claim the session late. He
// stopped using rest at all rather than put up with it, and a timer nobody starts records nothing.
//
// So the beep is swBeep() on the render tick again: app open, screen on, logger visible. The real
// fix is a notification rather than audio — a chime off the notification channel fires with the
// screen locked and hands Spotify straight back within the half-second. The web has no LOCAL
// scheduled notification, so on iOS that means Web Push: VAPID keys, a subscription table, a push
// handler in sw.js, an Edge Function that waits out the remaining seconds, and D-LOG installed to
// the Home Screen (Safari tabs get no push, no exception). Queued as its own job on 22 Aug.
//
// Do not reintroduce a long silent audio file. This is the trade, and it has already been refused.

// ─── STOPWATCH STATE ──────────────────────────────────────
// Computes elapsed seconds from swStartTimestamp — wall-clock based,
// so locking the phone / backgrounding the tab can't pause it.
function swElapsed() {
  if (!swStartTimestamp) return 0;
  return Math.floor((Date.now() - swStartTimestamp) / 1000);
}

// Find the last typed set for the currently-timed exercise.
// Walks the set inputs backwards to find the highest set number with a rep value.
// This is the set the rest belongs to (rest happens AFTER a set).
function swFindLastTypedSetForExercise(exName) {
  if (!selectedSession) return null;
  const ex = selectedSession.exercises.find(e => e.name === exName);
  if (!ex) return null;
  for (let i = ex.sets; i >= 1; i--) {
    const rEl = document.getElementById(`r-${exName}-${i}`);
    if (rEl && rEl.value) return { exName, setNum: i };
  }
  return null;
}

// ─── RENDER ───────────────────────────────────────────────
// Paints one exercise's watch. Idle hides the ring, running shows
// ring progress + live time, done turns the ring green.
function swRenderWatch(exName) {
  const btn = document.getElementById(`watch-${exName}`);
  if (!btn) return;
  const fill = btn.querySelector('.ex-watch-fill');
  const inner = btn.querySelector('.ex-watch-inner');
  if (!fill || !inner) return;

  const isThisActive = swRunning && swActiveExercise === exName;
  btn.classList.toggle('running', isThisActive);

  if (isThisActive) {
    const secs = swElapsed();
    const pct = Math.min(secs / swTargetSeconds, 1);
    fill.style.strokeDashoffset = SW_RING_CIRCUMFERENCE * (1 - pct);
    btn.classList.toggle('done', pct >= 1);
    // Replace the icon with the live time text
    inner.innerHTML = `<span class="ex-watch-time">${swFormat(secs)}</span>`;

    // The beep, such as it is: only reachable with the logger on screen and the tab awake. That is
    // the whole limitation, and the note above swElapsed() is why it cannot be fixed from in here.
    if (pct >= 1 && !swCompletionBeeped) {
      swCompletionBeeped = true;
      swBeep();
      swVibrate([80, 60, 80]);
      // The cue has landed — the screen has no further job to do, so give the battery back.
      swReleaseWakeLock();
      // ── THE BEEP DOES NOT CALL OFF THE NOTIFICATION (23 Aug 2026) ──────────────────────────────
      // It used to, for half a morning, on the reasoning that being told twice is worse than being
      // told once. That was wrong for this phone. The notification lands on Del's Apple Watch, and
      // the wake lock above now holds the screen on for the whole rest — so the beep fires nearly
      // every time, and cancelling here meant the wrist tap essentially never arrived. A phone beep
      // in a loud gym with Spotify playing is the cue most likely to be missed; the wrist tap is the
      // one least likely to be. So both fire, and the redundant one is the cheap one.
      // Stopping a rest early still cancels — see swStop(). That is the case the token exists for.
    }
  } else {
    btn.classList.remove('done');
    fill.style.strokeDashoffset = SW_RING_CIRCUMFERENCE;
    // Restore the icon glyph
    inner.innerHTML = `<svg class="ex-watch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="13" r="5"/><path d="M12 10.5v2.5l1.5 1.5"/><path d="M10 5h4"/></svg>`;
  }
}

// ─── START / STOP / RESET ────────────────────────────────
function swStart(exName, { save = true } = {}) {
  // UNLOCK AUDIO — must happen inside this tap handler or iOS blocks sound
  swUnlockAudio();
  // Keep the screen alive for the rest so the beep above actually has a render tick to fire on.
  swAcquireWakeLock();

  // If a different exercise was running, stop it first (no orphan timers)
  if (swRunning && swActiveExercise && swActiveExercise !== exName) swStop();

  const ex = selectedSession?.exercises.find(e => e.name === exName);
  swTargetSeconds = swParseRest(ex?.rest);
  swStartTimestamp = Date.now();
  swActiveExercise = exName;
  swRunning = true;
  swCompletionBeeped = false;
  swSaveOnStop = save;

  // Persist across page navigation — sessionStorage survives Stats→Workout
  sessionStorage.setItem('sw_state', JSON.stringify({
    start: swStartTimestamp,
    target: swTargetSeconds,
    exercise: exName,
    save: swSaveOnStop
  }));


  // Book the notification for this rest. Fire-and-forget — see scheduleRestAlert().
  scheduleRestAlert(exName, swTargetSeconds);

  swVibrate(10);
  swRenderWatch(exName);

  // Interval only drives re-renders; the maths is based on Date.now() so
  // even if this interval stutters or pauses, the time shown is still correct
  clearInterval(swInterval);
  swInterval = setInterval(() => swRenderWatch(exName), 1000);
}

async function swStop() {
  if (!swRunning) return;
  const elapsed = swElapsed();
  const exName = swActiveExercise;

  clearInterval(swInterval);
  swInterval = null;
  swRunning = false;
  swStartTimestamp = null;
  swActiveExercise = null;
  sessionStorage.removeItem('sw_state');
  swReleaseWakeLock();
  cancelRestAlert();
  swVibrate(10);
  swRenderWatch(exName);   // snap the ring back to idle now — don't wait on the network save below

  // ── A TIMER STARTED BY MARK DONE DOES NOT RECORD A REST (14 Aug 2026) ────────────────────────
  // Mark Done is tapped when the exercise is finished, so what this timer measures is the walk to
  // the next machine, not a rest between two sets. swFindLastTypedSetForExercise() would hang it on
  // the LAST set — a set that has no rest after it by definition — and the number is the wrong shape
  // entirely: 14 Aug wrote 166s onto Leg Curl set 3 and 380s onto Abductor set 2 (that one spans the
  // walk to cardio), against genuine between-set rests of 90–110s. Those inflate every avg-rest
  // figure in History and Stats. It still runs and still beeps — the countdown to the next exercise
  // is useful — it just isn't a data point. Stopping it by hand doesn't rescue it either; only a
  // timer you started by tapping the watch is a rest you chose to measure.
  const saveIt = swSaveOnStop;
  swSaveOnStop = true;
  if (!saveIt) return;

  // Save the rest to the last typed set for THIS exercise
  const target = swFindLastTypedSetForExercise(exName);
  if (target && elapsed > 0) {
    await swSaveRest(target.exName, target.setNum, elapsed);
    swPaintRestLine(target.exName, target.setNum, elapsed);
    swFlashWatch(exName);
    saveDraft(selectedSession?.id);   // persist rest to localStorage so it survives reload
  }
}

// Moves a RUNNING timer onto another exercise's watch without stopping it — same start timestamp, so
// no elapsed time is lost and nothing is written to the DB on the way past.
//
// One caller: refreshSupersetUi(), when pairing hides the watch the timer is currently attached to.
// A running timer on a hidden button is a trap rather than a cosmetic problem — it keeps counting and
// still beeps, and the tap that stops it (and the long-press that resets it) live on the button that
// just disappeared, so there is no way to end it.
function swHandOverWatch(toExName) {
  if (!swRunning || !toExName || swActiveExercise === toExName) return;
  const from = swActiveExercise;
  swActiveExercise = toExName;
  const ex = selectedSession?.exercises.find(e => e.name === toExName);
  swTargetSeconds = swParseRest(ex?.rest);
  // Re-derived, not carried over: the new target can be shorter than the elapsed time (already past
  // it, don't beep again) or longer than it (not there yet, so the beep is still to come).
  swCompletionBeeped = swElapsed() >= swTargetSeconds;
  sessionStorage.setItem('sw_state', JSON.stringify({
    start: swStartTimestamp,
    target: swTargetSeconds,
    exercise: toExName,
    save: swSaveOnStop
  }));
  clearInterval(swInterval);
  swInterval = setInterval(() => swRenderWatch(toExName), 1000);
  swRenderWatch(from);      // back to idle — its ring would otherwise stay frozen mid-sweep
  swRenderWatch(toExName);
}

// Long-press = wipe the timer without saving (in case of mis-tap)
function swReset() {
  const exName = swActiveExercise;
  clearInterval(swInterval);
  swInterval = null;
  swRunning = false;
  swStartTimestamp = null;
  swActiveExercise = null;
  sessionStorage.removeItem('sw_state');
  swReleaseWakeLock();
  cancelRestAlert();
  swVibrate([20, 40, 20]);
  if (exName) swRenderWatch(exName);
}

// ─── REST LINE PAINTING ──────────────────────────────────
// Paints "↳ Rest 2:45" under the set row. Called both after a live
// stop AND when loading the logger (so past rests are visible on reload).
function swPaintRestLine(exName, setNum, seconds) {
  const el = document.getElementById(`rest-${exName}-${setNum}`);
  if (el) el.textContent = `↳ Rest ${swFormat(seconds)}`;
}

// ─── SAVE REST TO DB (or buffer if workout not created yet) ──
async function swSaveRest(exName, setNum, seconds) {
  if (currentWorkoutId) {
    const existing = await sb(`workout_sets?workout_id=eq.${currentWorkoutId}&exercise=eq.${encodeURIComponent(exName)}&set_number=eq.${setNum}&select=id`);
    if (existing && existing.length > 0) {
      // quiet: a lost rest time is cosmetic next to the set itself, and a toast the moment you tap
      // the watch mid-set would be worse than the missing number. Console-logged either way.
      await sb(`workout_sets?id=eq.${existing[0].id}`, 'PATCH', { rest_seconds: seconds }, { quiet: true });
      return;
    }
  }
  // Workout row doesn't exist yet (user hasn't hit Mark Done on anything) —
  // buffer the rest so completeExercise can attach it later.
  if (!pendingRest[exName]) pendingRest[exName] = {};
  pendingRest[exName][setNum] = seconds;
}

// Briefly flash the watch green to confirm the rest was saved
function swFlashWatch(exName) {
  const btn = document.getElementById(`watch-${exName}`);
  if (!btn) return;
  btn.classList.add('flash-green');
  setTimeout(() => { btn.classList.remove('flash-green'); swRenderWatch(exName); }, 700);
}

// ─── TAP HANDLER (on the watch button itself) ────────────
// Short tap = start/stop toggle, long press = reset
function swTapWatch(exName) {
  if (swLongPressFired) { swLongPressFired = false; return; }
  if (swRunning && swActiveExercise === exName) swStop();
  else swStart(exName);
}

// Long-press detection lives on the button — attached in buildWorkoutLogger
// via delegation (see DOMContentLoaded handler below)
document.addEventListener('pointerdown', e => {
  const btn = e.target.closest('.ex-watch');
  if (!btn) return;
  swLongPressFired = false;
  swLongPressTimer = setTimeout(() => { swLongPressFired = true; swReset(); }, 450);
});
document.addEventListener('pointerup', () => clearTimeout(swLongPressTimer));
document.addEventListener('pointercancel', () => clearTimeout(swLongPressTimer));

// ─── RESTORE ACROSS PAGE NAVIGATION ──────────────────────
// If the user taps Stats then comes back to Workout, we rebuild the
// watch state from sessionStorage so the timer keeps going visibly.
function swRestoreFromStorage() {
  try {
    const raw = sessionStorage.getItem('sw_state');
    if (!raw) return;
    const s = JSON.parse(raw);
    if (!s.start || !s.exercise) return;
    swStartTimestamp = s.start;
    swTargetSeconds = s.target || 60;
    swActiveExercise = s.exercise;
    swRunning = true;
    // `!== false` so a state written by an older build (no `save` key) keeps saving, as it did then.
    swSaveOnStop = s.save !== false;
    swCompletionBeeped = (Date.now() - s.start) / 1000 >= s.target;
    if (!swCompletionBeeped) swAcquireWakeLock();
    swRenderWatch(s.exercise);
    clearInterval(swInterval);
    swInterval = setInterval(() => swRenderWatch(s.exercise), 1000);
  } catch (e) { sessionStorage.removeItem('sw_state'); }
}
