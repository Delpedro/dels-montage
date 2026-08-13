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
const APP_BUILD = '2026-08-13-1448';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}

let updateCheckRunning = false;
let lastUpdateCheck = 0;

// `force` skips the 60s throttle (used on first load). Silent on any failure — a flaky connection
// must never block the app, and the next foreground will try again.
async function checkForUpdate(force = false) {
  if (updateCheckRunning) return;
  if (!force && Date.now() - lastUpdateCheck < 60000) return;
  updateCheckRunning = true;
  lastUpdateCheck = Date.now();
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { build } = await res.json();
    if (!build || build === APP_BUILD) return;

    // Mid-workout, a surprise reload in the middle of typing a set is worse than being one build
    // behind — offer it instead. (Inputs are draft-saved, but a running rest timer and the scroll
    // position are not worth losing while he's under a bar.)
    if (currentWorkoutId) { showUpdateBanner(); return; }

    // One automatic reload per build, then stop. If the page comes back still running the old build
    // the reload isn't working, and looping would leave the app unusable rather than merely stale.
    if (sessionStorage.getItem('dlog_update_tried') === build) { showUpdateBanner(); return; }
    sessionStorage.setItem('dlog_update_tried', build);
    await applyUpdate();
  } catch (e) {
    // offline / DNS / GitHub Pages hiccup — nothing to do
  } finally {
    updateCheckRunning = false;
  }
}

// Drops every cached copy of the app and reloads. The ?v= build stamp on the asset URLs means the
// fresh index.html points at URLs nothing has ever cached, so this can't come back with old JS.
async function applyUpdate() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.update()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {}
  location.reload();
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

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.addEventListener('scroll', () => {
  if (document.documentElement.classList.contains('login-active')) window.scrollTo(0, 0);
});

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
  SESSIONS = (templates || []).map(t => {
    const session = {
      id: t.id, name: t.name, focus: t.focus, programme: t.programme, sort_order: t.sort_order,
      exercises: exByTemplate[t.id] || []
    };
    if (t.day) session.day = t.day;
    if (t.cardio) session.cardio = true;
    return session;
  });
}

// Sessions saved out of an Open Workout carry this programme id (see offerSaveOpenAsTemplate). It's
// purely a marker on the row — what makes a session yours rather than built-in, so it can be deleted
// and so buildSessionGrid knows to put it on the top screen. There is deliberately NO tile for it:
// a saved session appears as its own tile under "Log Workout", named whatever you called it, not
// filed behind a "My Sessions" folder.
const CUSTOM_PROGRAMME_ID = 'custom';

const TRAINING_PROGRAMMES = [
  {
    id: 'upper-lower',
    name: 'Upper / Lower Training Programme',
    focus: 'Upper A, Lower A, Upper B, Lower B'
  },
  {
    id: 'full-body-cv',
    name: 'Full Body + CV Training Programme',
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
    // Upper A's pairing into an Open Workout — two exercises that happened to be tagged '1' in their
    // source templates would silently pair themselves the moment you added them.
    (s.exercises || []).forEach(ex => {
      if (!map[ex.name]) { const { supersetGroup, ...shape } = ex; map[ex.name] = shape; }
    });
  });
  return map;
}
let EXERCISE_LIBRARY = {};  // populated after loadSessionTemplates() resolves — see initApp()

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
async function sb(path, method = 'GET', body = null, { quiet = false } = {}) {
  const opts = { method };
  if (body) opts.body = JSON.stringify(body);

  const token = await validAccessToken();
  if (!token) {
    // No usable session at all. Don't fire a request that can only 401 — sign out cleanly instead.
    forceLogout('Session expired — log in again');
    return method === 'GET' ? [] : new Response(null, { status: 401 });
  }

  opts.headers = sbHeaders(token, method);
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);

    // A 401 here means PostgREST rejected the JWT even though we thought it was live — clock skew,
    // a password change on another device, or a token revoked server-side. Refresh once and retry
    // before treating it as a real failure, so a token expiring mid-save doesn't lose the save.
    if (res.status === 401) {
      const fresh = await refreshSession(true);
      if (fresh) {
        opts.headers = sbHeaders(fresh, method);
        res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
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
  const send = (token) => fetch(`${SUPABASE_URL}/rest/v1/workouts`, {
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
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
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

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pw = document.getElementById('login-password').value;
  const err = document.getElementById('login-error');
  if (!email || !pw) return;

  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pw })
    });
  } catch (e) {
    // Worth telling apart from a wrong password — otherwise a dead connection reads as
    // "I've forgotten my own password" and you retype it five times.
    err.textContent = "Can't reach the server — check your connection";
    err.style.display = 'block';
    return;
  }

  if (!res.ok) {
    err.textContent = res.status === 400 ? 'Wrong email or password' : `Login failed (${res.status})`;
    err.style.display = 'block';
    return;
  }

  storeSession(await res.json());
  err.style.display = 'none';
  document.getElementById('login-password').value = '';
  sessionStorage.setItem('del_page', 'home');
  await enterApp('home');
}

// Shared by a fresh login and by restoring a stored session on load — the two-frame wait is what
// stops the login card flashing over the app as the scroll lock is released.
async function enterApp(page = 'home') {
  document.documentElement.classList.remove('login-active');
  window.scrollTo(0, 0);
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));
  document.getElementById('login-screen').style.display = 'none';
  initApp(page);
}

function showLoginScreen(message) {
  const err = document.getElementById('login-error');
  if (message) { err.textContent = message; err.style.display = 'block'; }
  else { err.style.display = 'none'; }
  window.scrollTo(0, 0);
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
    fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` }
    }).catch(() => {});
  }
  clearSession();
  sessionStorage.clear();
  localStorage.removeItem('workout_draft');  // Clear any mid-workout draft so next login starts fresh
  showLoginScreen();
}

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleLogin();
});

window.addEventListener('load', async () => {
  const pill = document.getElementById('sw-pill');
  if (pill) {
    pill.addEventListener('pointerdown', swPillPointerDown);
    pill.addEventListener('pointerup', swPillPointerUp);
    pill.addEventListener('pointerleave', swPillPointerCancel);
    pill.addEventListener('pointercancel', swPillPointerCancel);
  }

  authSession = loadStoredSession();
  if (!authSession) return;
  // Refreshes if stale. Offline this returns the stored token rather than logging out, so the app
  // still opens on a dead connection — it just can't reach the database, same as before.
  const token = await validAccessToken();
  if (!token) return;
  await enterApp(sessionStorage.getItem('del_page') || 'home');
});

// ─── CHANGE PASSWORD ──────────────────────────────────────
// Exists so the temporary password the account was created with can be replaced without going
// through a database migration, and so a password can be rotated at any point from the phone.
function openPasswordModal() {
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

async function savePassword() {
  const pw = document.getElementById('pw-new').value;
  const confirm = document.getElementById('pw-confirm').value;
  const err = document.getElementById('pw-error');
  const fail = (msg) => { err.textContent = msg; err.style.display = 'block'; };

  // GoTrue's own minimum is 6; 8 is the floor worth having on an account holding a year of data.
  if (pw.length < 8) return fail('Use at least 8 characters');
  if (pw !== confirm) return fail("Those don't match");

  const token = await validAccessToken();
  if (!token) return fail('Session expired — log out and back in');

  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
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
function goalState(actual, target, underIsMiss = false) {
  const a = numOrNull(actual), t = numOrNull(target);
  if (a === null || t === null || t === 0) return null;
  const diff = a - t;
  if (Math.abs(diff) <= Math.max(t * 0.05, 3)) return 'good';
  if (underIsMiss) return diff < 0 ? 'bad' : 'good';
  return diff > 0 ? 'bad' : 'soft';
}

// The "vs target" cell on check-in cards. Replaces deltaCell() for macros now that there is a
// target to judge against — and brings colour back with it, which deltaCell() deliberately
// suppressed because green/red against a moving previous-day number was meaningless.
function goalCell(actual, target, opts = {}) {
  const { suffix = '', decimals = 0, underIsMiss = false } = opts;
  const state = goalState(actual, target, underIsMiss);
  if (state === null) return `<span class="pf-d same">—</span>`;
  const diff = numOrNull(actual) - numOrNull(target);
  const txt = Math.abs(diff) < 0.5
    ? 'on target'
    : `${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(decimals).replace(/\.0$/, '')}${suffix}`;
  return `<span class="pf-d ${state}">${txt}</span>`;
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
  EXERCISE_LIBRARY = buildExerciseLibrary();
  loadCustomExercises();  // Merges into EXERCISE_LIBRARY in the background — Open Workout dropdown reads it lazily
  await loadGoals();      // Must resolve before renderCheckinSummary/loadHistory — both judge macros against it
  buildSessionGrid();
  renderCheckinSummary();
  showPage(page);
}

// Local-timezone YYYY-MM-DD. Never use toISOString() for a date key — it converts to UTC first,
// so during BST anything between 00:00 and 01:00 comes out stamped as the previous day.
function dateStr(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function todayStr() {
  return dateStr();
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning, Del';
  if (h < 17) return 'Good afternoon, Del';
  return 'Good evening, Del';
}

// ─── LANDING PAGE ─────────────────────────────────────────
async function loadHomePage() {
  document.getElementById('landing-greeting').textContent = getGreeting();
  document.getElementById('landing-date').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  try {
    const quotes = await sb(`quotes?select=quote,author`);
    if (quotes && quotes.length > 0) {
      const q = quotes[Math.floor(Math.random() * quotes.length)];
      document.getElementById('quote-text').textContent = `"${q.quote}"`;
      document.getElementById('quote-author').textContent = q.author ? `— ${q.author}` : '';
    }
  } catch(e) {}

  const buildTag = document.getElementById('build-tag');
  if (buildTag) buildTag.textContent = `build ${APP_BUILD}`;

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

  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekLogs = await sb(`daily_logs?date=gte.${dateStr(weekAgo)}&select=steps`);
  const stepsArr = (weekLogs || []).filter(l => l.steps).map(l => l.steps);
  const avgSteps = stepsArr.length ? Math.round(stepsArr.reduce((a,b)=>a+b,0)/stepsArr.length) : null;
  document.getElementById('home-steps').textContent = avgSteps ? avgSteps.toLocaleString() : '--';

  // This week (Mon-today), same boundary as the sessions/week tile above — separate from the
  // rolling-7-day steps average, which pre-dates this and is left as-is to avoid regressions.
  const thisWeekLogs = await sb(`daily_logs?date=gte.${getWeekStart()}&select=weight_kg,calories`);
  const weightArr = (thisWeekLogs || []).filter(l => l.weight_kg != null).map(l => l.weight_kg);
  const calsArr = (thisWeekLogs || []).filter(l => l.calories != null).map(l => l.calories);
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
async function realWorkoutsBetween(fromDate, toDate = null) {
  const range = `date=gte.${fromDate}` + (toDate ? `&date=lte.${toDate}` : '');
  const rows = await sb(`workouts?${range}&select=id,date,session_type,notes,completed_at`) || [];
  if (!rows.length) return [];
  const ids = rows.map(w => `"${w.id}"`).join(',');
  const [sets, cardio] = await Promise.all([
    sb(`workout_sets?workout_id=in.(${ids})&select=workout_id`),
    sb(`cardio_logs?workout_id=in.(${ids})&select=workout_id`)
  ]);
  const logged = new Set([
    ...(sets || []).map(s => s.workout_id),
    ...(cardio || []).map(c => c.workout_id)
  ]);
  return rows.filter(w => logged.has(w.id) || (w.notes || '').trim() !== '');
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
  const doneDates = new Set((workouts || []).map(w => w.date));
  const restDays = [];

  weekDates.forEach((date, i) => {
    const div = document.createElement('div');
    div.className = 'week-day';
    if (i === dow) div.classList.add('today');
    else if (doneDates.has(date)) div.classList.add('done');
    else if (restDays.includes(i)) div.classList.add('rest');
    div.innerHTML = `<div class="wd-name">${days[i]}</div><div class="wd-dot"></div>`;
    strip.appendChild(div);
  });
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
    const doneTodaySessions = customSessions.length ? await sessionsDoneToday() : new Set();

    grid.innerHTML = '';
    if (sub) sub.textContent = 'Choose your training programme';

    TRAINING_PROGRAMMES.forEach(p => {
      if (p.id === CUSTOM_PROGRAMME_ID) return;   // never a folder tile — see customSessions below
      const btn = document.createElement('div');
      btn.className = 'session-btn programme-btn';
      btn.id = `programme-btn-${p.id}`;
      btn.innerHTML = `<div class="session-name">${p.name}</div><div class="session-focus">${p.focus}</div>`;
      btn.onclick = () => showProgrammeSessions(p.id);
      grid.appendChild(btn);
    });

    const openBtn = document.createElement('div');
    openBtn.className = 'session-btn programme-btn';
    openBtn.id = 'programme-btn-open';
    openBtn.innerHTML = `<div class="session-name">Open Workout</div><div class="session-focus">Pick exercises as you go</div>`;
    openBtn.onclick = () => startOpenWorkout();
    grid.appendChild(openBtn);

    customSessions.forEach(s => grid.appendChild(sessionTile(s, doneTodaySessions)));
    return;
  }

  selectedProgramme = programmeId;
  if (sub) sub.textContent = 'Choose your session';

  // Fetch data BEFORE clearing grid — prevents concurrent calls racing and both appending to same empty grid
  const doneTodaySessions = await sessionsDoneToday();
  grid.innerHTML = '';
  const sessions = SESSIONS.filter(s => s.programme === programmeId);

  const back = document.createElement('div');
  back.className = 'session-btn';
  back.innerHTML = `<div class="session-name">← Programmes</div><div class="session-focus">Back to programme selection</div>`;
  back.onclick = () => resetSessionSelection(true);
  grid.appendChild(back);

  sessions.forEach(s => grid.appendChild(sessionTile(s, doneTodaySessions)));
}

// One session tile. Shared by the programme's session list and the saved-session tiles on the top
// screen, so a saved session behaves exactly like a built-in one — same ✎ editor, same done state.
function sessionTile(s, doneTodaySessions) {
  const btn = document.createElement('div');
  btn.className = 'session-btn';
  btn.id = `session-btn-${s.id}`;
  const done = doneTodaySessions.has(s.id);
  if (done) btn.classList.add('done');
  const editBtn = s.cardio ? '' : `<button class="session-edit-btn" aria-label="Edit ${esc(s.name)} template" title="Edit template" onclick="event.stopPropagation(); openSessionEditor('${jsAttr(s.id)}')">✎</button>`;
  btn.innerHTML = `${editBtn}<div class="session-name">${esc(s.name)}</div><div class="session-focus">${esc(s.focus)}</div>${done ? '<div style="font-size:10px;color:var(--green);margin-top:4px;">✓ logged today</div>' : ''}`;
  btn.onclick = () => selectSession(s, btn);
  return btn;
}

function showProgrammeSessions(programmeId) {
  selectedProgramme = programmeId;
  buildSessionGrid(programmeId);
}

// ─── SESSION TEMPLATE EDITOR ────────────────────────────────
// Permanent reorder / add / remove exercises / add-remove sets for a fixed session (Upper A, etc).
// Works on a cloned buffer (editingTemplateExercises) — nothing touches the live SESSIONS/DB until Save.
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
  applyTemplateUnitOrder();   // a template saved with its pairs apart opens with them together
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

// Rewrites editingTemplateExercises in unit order, so a superset's members sit next to each other.
function applyTemplateUnitOrder(units) {
  const byName = {};
  editingTemplateExercises.forEach(e => { byName[e.name] = e; });
  editingTemplateExercises = (units || templateUnits()).flat().map(n => byName[n]).filter(Boolean);
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
  applyTemplateUnitOrder();   // the new partner slides up next to its group rather than staying put
  renderTemplateEditorRows();
}

function clearTemplateSuperset(name) {
  editingTemplateGroups = editingTemplateGroups.map(g => g.filter(n => n !== name)).filter(g => g.length > 1);
  editingTemplatePickerFor = null;
  applyTemplateUnitOrder();
  renderTemplateEditorRows();
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
  if (partners.length) {
    html += `<button type="button" class="ss-pick ss-pick-clear" onclick="clearTemplateSuperset('${jsAttr(name)}')">✕ Remove ${esc(name)} from this superset</button>`;
  }
  return html + `</div>`;
}

function renderTemplateEditorRows() {
  const list = document.getElementById('edit-session-exercises');
  const groupMap = templateGroupMap();
  // ↑/↓ act on units, so they're disabled for every row of the first/last unit — not just the first
  // and last row. Otherwise the top half of a leading superset still offers an ↑ that can't move.
  const units = templateUnits();
  const unitIndex = {};
  units.forEach((u, ui) => u.forEach(n => { unitIndex[n] = ui; }));
  list.innerHTML = editingTemplateExercises.map((ex, i) => {
    const tag = groupMap[ex.name];
    const partners = tag ? (templateGroupOf(ex.name) || []).filter(n => n !== ex.name && groupMap[n]) : [];
    const ui = unitIndex[ex.name] ?? 0;
    return `
    <div class="template-ex-row${tag ? ' in-superset' : ''}">
      <div class="template-ex-name">${esc(ex.name)}${tag ? `<span class="pf-ss">s/s ${esc(tag)}</span>` : ''}</div>
      <div class="template-ex-controls">
        <button type="button" class="btn btn-outline template-ex-btn" ${ui === 0 ? 'disabled' : ''} onclick="moveTemplateExercise(${i}, -1)" aria-label="Move up">↑</button>
        <button type="button" class="btn btn-outline template-ex-btn" ${ui === units.length - 1 ? 'disabled' : ''} onclick="moveTemplateExercise(${i}, 1)" aria-label="Move down">↓</button>
        <button type="button" class="btn btn-outline template-ex-btn" onclick="changeTemplateExerciseSets(${i}, -1)" aria-label="Remove set">−</button>
        <span class="template-ex-sets">${ex.sets} sets</span>
        <button type="button" class="btn btn-outline template-ex-btn" onclick="changeTemplateExerciseSets(${i}, 1)" aria-label="Add set">+</button>
        <button type="button" class="ex-remove-btn" onclick="removeTemplateExercise(${i})" aria-label="Remove exercise" title="Remove">✕</button>
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
function moveTemplateExercise(index, dir) {
  const name = editingTemplateExercises[index]?.name;
  if (!name) return;
  const units = templateUnits();
  const u = units.findIndex(unit => unit.includes(name));
  const target = u + dir;
  if (u < 0 || target < 0 || target >= units.length) return;
  [units[u], units[target]] = [units[target], units[u]];
  applyTemplateUnitOrder(units);
  renderTemplateEditorRows();
}

function changeTemplateExerciseSets(index, delta) {
  const ex = editingTemplateExercises[index];
  if (!ex) return;
  ex.sets = Math.max(1, ex.sets + delta);
  renderTemplateEditorRows();
}

function removeTemplateExercise(index) {
  editingTemplateExercises.splice(index, 1);
  renderTemplateEditorRows();
}

function templateAddExerciseOptionsHtml() {
  const chosen = new Set(editingTemplateExercises.map(e => e.name));
  const names = Object.keys(EXERCISE_LIBRARY).filter(n => !chosen.has(n)).sort();
  let opts = `<option value="" selected disabled>Add an exercise…</option>`;
  names.forEach(n => { opts += `<option value="${esc(n)}">${esc(n)}</option>`; });
  opts += `<option value="__custom__">+ Type a new exercise…</option>`;
  return opts;
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
  const existing = await sb(`custom_exercises?name=eq.${encodeURIComponent(name)}&select=id`);
  if (!existing || existing.length === 0) {
    await sb('custom_exercises', 'POST', { name });
  }
  EXERCISE_LIBRARY[name] = { name, sets: 3, reps: '8–12', rest: '90s' };
  addTemplateExercise(name);
}

// Delete-all-then-reinsert for this session's exercises — same idiom completeExercise() already
// uses for idempotent re-saves, and far simpler than diffing individual reorder/add/remove ops.
async function saveSessionTemplate() {
  if (!editingTemplateSessionId) return;
  const id = editingTemplateSessionId;
  const delRes = await sb(`session_exercises?session_id=eq.${id}`, 'DELETE', null, { quiet: true });
  if (!delRes.ok) { showToast(`Save failed (${delRes.status})`, 'error'); return; }
  const groupMap = templateGroupMap();   // presence-filtered, so a removed partner can't leave a tag behind
  const rows = editingTemplateExercises.map((ex, i) => ({
    session_id: id, name: ex.name, sets: ex.sets, reps: ex.reps, rest: ex.rest,
    note: ex.note ?? null, variations: ex.variations ?? null, aliases: ex.aliases ?? null,
    band: !!ex.band, bodyweight: !!ex.bodyweight, sort_order: i,
    superset_group: groupMap[ex.name] || null
  }));
  if (rows.length) {
    const postRes = await sb('session_exercises', 'POST', rows, { quiet: true });
    if (!postRes.ok) { showToast(`Save failed (${postRes.status})`, 'error'); return; }
  }
  await loadSessionTemplates();
  EXERCISE_LIBRARY = buildExerciseLibrary();
  closeSessionEditor();
  showToast('Template updated', 'success');
  buildSessionGrid(selectedProgramme);
}

// Resolves in-progress/resume/warn-and-switch and eagerly creates the workout row.
// Sets selectedSession/selectedVariations/currentWorkoutId/currentWorkoutHasSets on success.
// Shared by selectSession() (fixed sessions) and startOpenWorkout() (Open Workout).
async function beginWorkoutSession(session) {
  // Check if ANY session is currently in progress today (completed_at IS NULL).
  // This covers both the "resume same session" case (e.g. refreshed mid-Upper-A)
  // AND the "switched session" case (started Upper A, now tapping Lower A).
  const inProgress = await sb(`workouts?date=eq.${todayStr()}&completed_at=is.null&select=id,session_type`);

  if (inProgress && inProgress.length > 0) {
    const existing = inProgress[0];

    if (existing.session_type === session.id) {
      // SAME session tapped — silently adopt the existing workout row.
      // buildWorkoutLogger + restoreDraft will rehydrate inputs & rest times.
      currentWorkoutId = existing.id;
      currentWorkoutHasSets = true;
    } else {
      // DIFFERENT session tapped — warn before abandoning the in-progress one.
      const existingName = sessionDisplayName(existing.session_type);
      if (!confirm(`You have an in-progress ${existingName} session. Start ${session.name} instead? (${existingName} will stay saved, you can resume it later.)`)) {
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

async function selectSession(session, btn) {
  if (btn.classList.contains('done')) {
    if (!confirm(`You already logged ${session.name} today. Log again?`)) return;
  }

  if (session.cardio) {
    selectedSession = session;
    selectedVariations = {};
    document.querySelectorAll('.session-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    currentWorkoutId = null;
    currentWorkoutHasSets = false;

    document.getElementById('session-grid').style.display = 'none';
    document.getElementById('session-pill').style.display = 'flex';
    document.getElementById('session-pill-name').textContent = session.name;
    document.getElementById('conditioning-form').style.display = 'block';
    document.getElementById('workout-logger').style.display = 'none';
    return;
  }

  // Clone before mutating — `session` here is the live SESSIONS array element (see buildSessionGrid),
  // and the live logger now allows a one-off add/remove exercise for today only (same mechanic Open
  // Workout already had). Mutating the shared object directly would silently edit the template in
  // memory for the rest of the browser session.
  const sessionCopy = { ...session, exercises: session.exercises.map(ex => ({ ...ex })) };

  const ok = await beginWorkoutSession(sessionCopy);
  if (!ok) return;

  document.querySelectorAll('.session-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');

  document.getElementById('session-grid').style.display = 'none';
  document.getElementById('session-pill').style.display = 'flex';
  document.getElementById('session-pill-name').textContent = sessionCopy.name;
  document.getElementById('conditioning-form').style.display = 'none';
  document.getElementById('workout-logger').style.display = 'block';
  buildWorkoutLogger(sessionCopy);
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
  'dead hangs': '30–45s'
};

// The default time target for a timed exercise, or null if it isn't timed.
function timedTarget(ex) {
  const name = typeof ex === 'string' ? ex : ex?.name;
  return TIMED_EXERCISES[(name || '').trim().toLowerCase()] || null;
}
function isTimed(ex) { return timedTarget(ex) !== null; }

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
  'deadhang', 'deadhangs', 'dead hang', 'dead hangs'
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
  const chosen = new Set((selectedSession?.exercises || []).map(e => e.name));
  const names = Object.keys(EXERCISE_LIBRARY).filter(n => !chosen.has(n)).sort();
  let opts = `<option value="" selected disabled>+ Something not in this session…</option>`;
  names.forEach(n => { opts += `<option value="${esc(n)}">${esc(n)}</option>`; });
  opts += `<option value="__custom__">+ Type a new exercise…</option>`;
  return opts;
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
    const doneBtn = document.getElementById(`done-btn-${ex.name}`);
    if (doneBtn) {
      doneBtn.style.display = (inGroup && group[group.length - 1] !== ex.name) ? 'none' : '';
      if (!doneBtn.dataset.done) doneBtn.textContent = inGroup ? 'Mark Superset Done' : 'Mark Done';
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
    weightCol = `<input type="text" class="set-input" id="w-${esc(ex.name)}-${i}" placeholder="BW / kg" inputmode="decimal" oninput="saveDraft('${jsAttr(sessionId)}')" />`;
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

// Builds the HTML for one exercise block (header, variation toggle, set rows, Mark Done).
// Reused for fixed-session rendering, Open Workout's initial render, and dynamic append via the Add Exercise dropdown.
function renderExerciseBlock(ex, session) {
  const prev = previousSets[ex.name] || (ex.aliases || []).flatMap(a => previousSets[a] || []);
  const prevVariation = prev[0]?.variation || '';
  const defaultVar = ex.variations ? (prevVariation || ex.variations[0]) : null;
  let filteredPrev = prev;
  if (ex.variations && !ex.band && defaultVar) {
    filteredPrev = prev.filter(p => p.variation === defaultVar);
    if (filteredPrev.length === 0) filteredPrev = prev;
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
          <span class="pill pill-sets" id="sets-pill-${esc(ex.name)}">${ex.sets} sets</span>
          <span class="pill pill-reps">${esc(isTimed(ex) && !/s\b/i.test(ex.reps || '') ? timedTarget(ex) : ex.reps)}</span>
          <span class="pill pill-rest">${esc(ex.rest)}</span>
        </div>
        ${ex.note ? `<div class="ex-note-text">${esc(ex.note)}</div>` : ''}
      </div>`;

  if (ex.variations) {
    selectedVariations[ex.name] = defaultVar;
    html += `<div class="variation-toggle">`;
    ex.variations.forEach(v => {
      const isSelected = v === defaultVar ? 'selected' : '';
      html += `<button class="var-btn ${isSelected}" onclick="selectVariation('${jsAttr(ex.name)}', '${jsAttr(v)}', this)">${esc(v)}</button>`;
    });
    html += `</div>`;
  }

  for (let i = 1; i <= ex.sets; i++) {
    html += renderSetRow(ex, i, filteredPrev[i-1], session.id, defaultVar);
  }

  if (session.id === 'open') {
    html += `<div class="set-row-controls" id="set-controls-${esc(ex.name)}" style="display:flex;gap:8px;margin-top:8px;">
      <button type="button" class="btn btn-outline" style="flex:1;" onclick="addOpenSetRow('${jsAttr(ex.name)}')">+ Add Set</button>
      <button type="button" class="btn btn-outline" style="flex:1;" onclick="removeOpenSetRow('${jsAttr(ex.name)}')">− Remove Set</button>
    </div>`;
  }

  html += `<button class="btn btn-outline btn-full" id="done-btn-${esc(ex.name)}" onclick="completeExercise('${jsAttr(ex.name)}')" style="margin-top:8px;">Mark Done</button>`;
  html += renderSupersetControl(ex);
  html += `</div>`;
  return html;
}

// Populates `previousSets` for the given session. Fixed sessions: scans the last 10 workouts of that
// session_type, per-exercise-per-variation most-recent-occurrence (a variation toggled less often than
// others would otherwise lose its prior-set history to whichever variation was used most recently).
// Open Workout: scoped to past Open workouts only, per-exercise most-recent-occurrence (a single "last
// Open workout" won't reliably contain every exercise picked this time, since they vary session to session).
async function loadPreviousSetsForSession(session) {
  previousSets = {};
  if (session.id === 'open') {
    Object.assign(previousSets, await fetchOpenPreviousSets(session.exercises.map(e => e.name)));
    return;
  }
  const prevWorkouts = await sb(`workouts?session_type=eq.${session.id}&order=date.desc&limit=10&select=id,date`);
  const candidates = (prevWorkouts || []).filter(w => w.id !== currentWorkoutId);
  if (!candidates.length) return;
  const dateById = Object.fromEntries(candidates.map(w => [w.id, w.date]));
  const idList = candidates.map(w => w.id).join(',');
  const sets = await sb(`workout_sets?workout_id=in.(${idList})&select=workout_id,exercise,set_number,weight,reps,variation`);
  const byExercise = {};
  (sets || []).forEach(s => { (byExercise[s.exercise] ||= []).push(s); });

  // Per exercise: anchor on its own most recent workout (any variation, for the default toggle),
  // then backfill any other variation from its own most recent occurrence further back — a variation
  // not used last time out shouldn't lose its prior-set history just because it wasn't logged most recently.
  Object.entries(byExercise).forEach(([exName, exSets]) => {
    let mostRecentWid = null;
    exSets.forEach(s => {
      if (!mostRecentWid || dateById[s.workout_id] > dateById[mostRecentWid]) mostRecentWid = s.workout_id;
    });
    const primary = exSets.filter(s => s.workout_id === mostRecentWid).sort((a, b) => a.set_number - b.set_number);
    const seenVariations = new Set(primary.map(s => s.variation || ''));
    const rows = primary.map(s => ({ weight: s.weight, reps: s.reps, variation: s.variation }));

    const byVariation = {};
    exSets.filter(s => s.workout_id !== mostRecentWid && !seenVariations.has(s.variation || ''))
      .forEach(s => { (byVariation[s.variation || ''] ||= []).push(s); });
    Object.values(byVariation).forEach(group => {
      let wid = null;
      group.forEach(s => { if (!wid || dateById[s.workout_id] > dateById[wid]) wid = s.workout_id; });
      rows.push(...group.filter(s => s.workout_id === wid)
        .sort((a, b) => a.set_number - b.set_number)
        .map(s => ({ weight: s.weight, reps: s.reps, variation: s.variation })));
    });

    previousSets[exName] = rows;
  });
}

async function fetchOpenPreviousSets(exNames) {
  const result = {};
  if (!exNames.length) return result;
  const pastWorkouts = await sb(`workouts?session_type=eq.open&completed_at=not.is.null&order=date.desc&limit=20&select=id,date`);
  const relevant = (pastWorkouts || []).filter(w => w.id !== currentWorkoutId);
  if (!relevant.length) return result;
  const idList = relevant.map(w => w.id).join(',');
  const exFilter = encodeURIComponent(`in.(${exNames.map(n => `"${n.replace(/"/g, '\\"')}"`).join(',')})`);
  const sets = await sb(`workout_sets?workout_id=in.(${idList})&exercise=${exFilter}&select=workout_id,exercise,set_number,weight,reps,variation`);
  const dateById = Object.fromEntries(relevant.map(w => [w.id, w.date]));
  const byExercise = {};
  (sets || []).forEach(s => { (byExercise[s.exercise] ||= []).push(s); });
  Object.keys(byExercise).forEach(exName => {
    let mostRecentWid = null;
    byExercise[exName].forEach(s => {
      if (!mostRecentWid || dateById[s.workout_id] > dateById[mostRecentWid]) mostRecentWid = s.workout_id;
    });
    result[exName] = byExercise[exName]
      .filter(s => s.workout_id === mostRecentWid)
      .sort((a, b) => a.set_number - b.set_number)
      .map(s => ({ weight: s.weight, reps: s.reps, variation: s.variation }));
  });
  return result;
}

// "Last time you did this session" full snapshot — fixed sessions only (Open Workout already has its
// own per-exercise previousSets scoping via fetchOpenPreviousSets, and CV+Pump never reaches
// buildWorkoutLogger). Unlike previousSets (which independently resolves each exercise's own most
// recent occurrence across the last 10 workouts), this is deliberately one single most-recent workout,
// so the whole card reflects exactly one prior session rather than a blend.
async function fetchLastSessionSnapshot(session) {
  const last = await sb(`workouts?session_type=eq.${session.id}&completed_at=not.is.null&order=date.desc&limit=1&select=id,date`);
  const candidates = (last || []).filter(w => w.id !== currentWorkoutId);
  if (!candidates.length) return null;
  const workout = candidates[0];
  // Cardio fetched alongside the sets — "what did I do last time" has to include the bike/treadmill
  // work, not just the lifts, or the card silently under-reports the session.
  const [sets, cardio] = await Promise.all([
    sb(`workout_sets?workout_id=eq.${workout.id}&order=set_number.asc&select=exercise,set_number,weight,reps,variation`),
    sb(`cardio_logs?workout_id=eq.${workout.id}&select=activity,duration_mins,distance,floors,incline,speed_kmh`)
  ]);
  const byExercise = {};
  (sets || []).forEach(s => { (byExercise[s.exercise] ||= []).push(s); });
  return { date: workout.date, exercises: byExercise, cardio: cardio || [] };
}

function renderLastTimeCard(snapshot, session) {
  if (!snapshot) return '';
  const dateStr = new Date(snapshot.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  let rows = session.exercises.map(ex => {
    const sets = snapshot.exercises[ex.name] || (ex.aliases || []).flatMap(a => snapshot.exercises[a] || []);
    if (!sets.length) return '';
    const variationTag = sets[0].variation ? ` <span class="last-time-var">(${esc(sets[0].variation)})</span>` : '';
    const setsStr = sets.map(s => setValueLabel(ex, s)).join(', ');
    return `<div class="last-time-row"><span class="last-time-ex">${esc(ex.name)}${variationTag}</span><span class="last-time-sets">${esc(setsStr)}</span></div>`;
  }).join('');
  // Exercises the template no longer contains (a one-off swap last time) would otherwise vanish
  // from the card entirely — list them after the template's own, so nothing logged goes unshown.
  const templateNames = new Set(session.exercises.flatMap(ex => [ex.name, ...(ex.aliases || [])]));
  Object.keys(snapshot.exercises).filter(n => !templateNames.has(n)).forEach(name => {
    const sets = snapshot.exercises[name];
    const variationTag = sets[0].variation ? ` <span class="last-time-var">(${esc(sets[0].variation)})</span>` : '';
    const setsStr = sets.map(s => setValueLabel({ name }, s)).join(', ');
    rows += `<div class="last-time-row"><span class="last-time-ex">${esc(name)}${variationTag}</span><span class="last-time-sets">${esc(setsStr)}</span></div>`;
  });
  (snapshot.cardio || []).forEach(c => {
    const detail = cardioDetailParts(c).join(', ') || '—';
    rows += `<div class="last-time-row last-time-cardio"><span class="last-time-ex">${esc(cardioDisplayName(c.activity))}</span><span class="last-time-sets">${esc(detail)}</span></div>`;
  });
  if (!rows) return '';
  return `<div class="card last-time-card" id="last-time-card">
    <div class="last-time-header" onclick="document.getElementById('last-time-card').classList.toggle('expanded')">
      <span>📅 Last time — ${dateStr}</span>
      <span class="last-time-chevron">▾</span>
    </div>
    <div class="last-time-body">${rows}</div>
  </div>`;
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
  if (session.id !== 'open' && !session.cardio) {
    html += `<div class="edit-template-link" onclick="openSessionEditor('${jsAttr(session.id)}')">✎ Reorder / add / remove exercises for this session</div>`;
    const lastTimeSnapshot = await fetchLastSessionSnapshot(session);
    html += renderLastTimeCard(lastTimeSnapshot, session);
  }
  session.exercises.forEach(ex => { html += renderExerciseBlock(ex, session); });

  if (!session.cardio) {
    if (session.exercises.length === 0) html += `<div class="empty" style="margin-bottom:0.875rem;">Tap Add Exercise below to get started</div>`;
    html += renderAddExerciseRow();
  }

  html += renderCardioSection(session);

  html += `<div class="field-group" style="margin-top:0.875rem;">
    <label class="field-label">Session Notes</label>
    <textarea class="field-input" id="workout-notes" placeholder="How did it go..." oninput="saveDraft('${jsAttr(session.id)}')"></textarea>
  </div>
  <button class="btn btn-save btn-full" onclick="saveWorkout()" style="margin-bottom:1rem;">Save Workout</button>`;

  logger.innerHTML = html;
  restoreDraft(session);

  // Restore already-saved sets on resume: paint rest times, fill empty inputs, mark exercises done
  if (currentWorkoutId) {
    const savedSets = await sb(`workout_sets?workout_id=eq.${currentWorkoutId}&select=exercise,set_number,rest_seconds,weight,reps,superset_group`);
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

  document.getElementById('session-grid').style.display = 'none';
  document.getElementById('session-pill').style.display = 'flex';
  document.getElementById('session-pill-name').textContent = openSession.name;
  document.getElementById('conditioning-form').style.display = 'none';
  document.getElementById('workout-logger').style.display = 'block';
  buildWorkoutLogger(openSession);
}

// ─── SAVE AN OPEN WORKOUT AS A REUSABLE SESSION ───────────
// Offered once, on Save Workout, when the session was an Open Workout with exercises in it: the
// session you just improvised becomes a fixed session tile under the "My Sessions" programme,
// editable afterwards with the same ✎ template editor as every other session.
async function offerSaveOpenAsTemplate(exercises, supersetTags = {}) {
  if (!exercises.length) return;
  if (!confirm(`Save this workout as a reusable session?\n\n${exercises.map(e => e.name).join('\n')}`)) return;

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
    session_id: id, name: ex.name, sets: ex.sets || 3, reps: ex.reps || '8–12', rest: ex.rest || '90s',
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
  if (!confirm(`Delete the "${session.name}" session? Workouts you've already logged with it are kept.`)) return;
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
  const existing = await sb(`custom_exercises?name=eq.${encodeURIComponent(name)}&select=id`);
  if (!existing || existing.length === 0) {
    await sb('custom_exercises', 'POST', { name });
  }
  EXERCISE_LIBRARY[name] = { name, sets: 3, reps: '8–12', rest: '90s' };
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

  const fetched = await fetchOpenPreviousSets([name]);
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

// Open Workout only — appends one more set row (mutates this exercise instance's own `sets`
// count, safe since addOpenExercise clones it off the shared EXERCISE_LIBRARY template).
function addOpenSetRow(exName) {
  const ex = selectedSession?.exercises.find(e => e.name === exName);
  if (!ex) return;
  ex.sets += 1;
  const controls = document.getElementById(`set-controls-${exName}`);
  if (controls) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderSetRow(ex, ex.sets, null, 'open', selectedVariations[exName]);
    while (wrapper.firstChild) controls.parentNode.insertBefore(wrapper.firstChild, controls);
  }
  const pill = document.getElementById(`sets-pill-${exName}`);
  if (pill) pill.textContent = `${ex.sets} sets`;
  saveDraft('open');
}

// Open Workout only — removes the last set row. Keeps at least one row per exercise (to remove
// the whole exercise, use the ✕ button instead).
function removeOpenSetRow(exName) {
  const ex = selectedSession?.exercises.find(e => e.name === exName);
  if (!ex || ex.sets <= 1) return;
  const i = ex.sets;
  document.getElementById(`w-${exName}-${i}`)?.closest('.set-row')?.remove();
  document.getElementById(`rest-${exName}-${i}`)?.remove();
  ex.sets -= 1;
  const pill = document.getElementById(`sets-pill-${exName}`);
  if (pill) pill.textContent = `${ex.sets} sets`;
  saveDraft('open');
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
    <div id="cardio-list">${entries.map(e => renderCardioEntryBlock(e, session.id)).join('')}</div>
    <div class="card" id="add-cardio-row" style="margin-bottom:0.875rem;">
      <label class="field-label">Add Cardio</label>
      <select class="field-input" id="cardio-activity-select" onchange="handleAddCardio(this)">
        <option value="" selected disabled>Choose an activity…</option>
        ${Object.keys(CARDIO_ACTIVITIES).map(a => `<option value="${a}">${cardioDisplayName(a)}</option>`).join('')}
      </select>
    </div>`;
}

function renderCardioEntryBlock(entry, sessionId) {
  const def = CARDIO_ACTIVITIES[entry.activity];
  if (!def) return '';
  const fields = def.fields.map(f => {
    const label = f === 'distance' ? (def.distanceLabel || 'Distance') : CARDIO_FIELD_LABELS[f];
    return `<div class="field-group">
      <label class="field-label">${esc(label)}</label>
      <input type="number" step="0.1" class="field-input" id="cardio-${entry.id}-${f}" oninput="saveDraft('${jsAttr(sessionId)}')" />
    </div>`;
  }).join('');
  const presets = def.presets ? `<div class="variation-toggle" style="margin-top:6px;">
      ${def.presets.map(p => `<button class="var-btn" type="button" onclick="setCardioPreset(${entry.id}, ${p}, '${jsAttr(sessionId)}')">${p}m</button>`).join('')}
    </div>` : '';
  return `<div class="card cardio-block" id="cardio-block-${entry.id}" style="margin-bottom:0.875rem;">
    <div class="ex-name-row">
      <div class="ex-name-display">${esc(cardioDisplayName(entry.activity))}</div>
      <button class="ex-remove-btn" onclick="removeCardioEntry(${entry.id})" aria-label="Remove cardio entry" title="Remove">✕</button>
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
  wrapper.innerHTML = renderCardioEntryBlock({ id, activity }, selectedSession.id);
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

function restoreDraft(session) {
  try {
    const raw = localStorage.getItem('workout_draft');
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (draft.sessionId !== session.id) return;
    if (draft.timestamp && Date.now() - draft.timestamp > 24*60*60*1000) { localStorage.removeItem('workout_draft'); return; }  // Expire drafts after 24hrs
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
  } catch(e) {}
}

function selectVariation(exName, variation, btn) {
  selectedVariations[exName] = variation;
  btn.parentElement.querySelectorAll('.var-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  const ex = selectedSession?.exercises.find(e => e.name === exName);
  if (!ex) return;
  if (ex.band) {
    for (let i = 1; i <= ex.sets; i++) {
      const wEl = document.getElementById(`w-${exName}-${i}`);
      if (wEl) wEl.textContent = variation;
    }
  } else {
    const prev = previousSets[exName] || (ex.aliases || []).flatMap(a => previousSets[a] || []);
    let filteredPrev = prev.filter(p => p.variation === variation);
    if (filteredPrev.length === 0) filteredPrev = prev;
    const prevText = filteredPrev.length > 0
      ? filteredPrev.map(s => setValueLabel(ex, s)).join(' / ')
      : 'No previous data';
    const prevEl = document.getElementById(`prev-${exName}`);
    if (prevEl) prevEl.textContent = `Previous (${variation}): ${prevText}`;
    for (let i = 1; i <= ex.sets; i++) {
      const badge = document.getElementById(`badge-${exName}-${i}`);
      const set = filteredPrev[i-1];
      if (badge) badge.textContent = setValueLabel(ex, set);
    }
  }
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
async function saveExerciseSets(exName, sets) {
  const delRes = await sb(`workout_sets?workout_id=eq.${currentWorkoutId}&exercise=eq.${encodeURIComponent(exName)}`,
    'DELETE', null, { quiet: true });
  if (!delRes.ok) return delRes.status;
  const saveRes = await sb('workout_sets', 'POST', sets, { quiet: true });
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
  if (!selectedSession) return;
  if (!currentWorkoutId) {
    showToast('Session error — go back and re-select the workout', 'error');
    return;
  }
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
// Called when "Log Workout" title is tapped — warns if data exists, then resets back to programme/session grid
function resetSessionSelection(toProgrammePicker = false) {
  if (selectedSession) {
    const hasData = selectedSession.exercises?.some(ex => {
      for (let i = 1; i <= ex.sets; i++) {
        const r = document.getElementById(`r-${ex.name}-${i}`);
        if (r && r.value) return true;
      }
      return false;
    });
    if (hasData && !confirm(`You've started logging ${selectedSession.name} — go back and lose your data?`)) return;
  }
  if (currentWorkoutId && !currentWorkoutHasSets) {
    // quiet + not awaited: cleanup of an empty row. If it fails, History and every counter already
    // hide it (realWorkoutsBetween), so there's nothing to tell the user about.
    sb(`workouts?id=eq.${currentWorkoutId}`, 'DELETE', null, { quiet: true });
  }
  currentWorkoutHasSets = false;
  selectedSession = null;
  currentWorkoutId = null;
  localStorage.removeItem('workout_draft');

  document.getElementById('session-grid').style.display = 'grid';
  document.getElementById('session-pill').style.display = 'none';
  document.getElementById('workout-logger').style.display = 'none';
  document.getElementById('conditioning-form').style.display = 'none';

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
    if (!confirm(`Nothing is saved for:\n\n${unsaved.join('\n')}\n\nThose have numbers filled in but were never marked done. Go back and tap Mark Done, or finish the workout without them?`)) return;
  }

  const notes = document.getElementById('workout-notes')?.value || '';
  const cardioEntryCount = (selectedSession.cardioEntries || []).length;
  const cardioRows = collectCardioRows();
  // An entry exists (user picked an activity) but produced no data — every field read back empty.
  // Warn instead of silently dropping it, since this exact silent-drop cost two days of cardio data.
  if (cardioEntryCount > 0 && cardioRows.length === 0) {
    if (!confirm('Cardio entries look empty — fill in at least one field per entry, or remove them with ✕. Save the rest of the workout without cardio?')) return;
  }
  if (cardioRows.length) {
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
  document.getElementById('session-grid').style.display = 'grid';
  buildSessionGrid(selectedProgramme);
  document.getElementById('workout-logger').style.display = 'none';
  document.getElementById('conditioning-form').style.display = 'none';
  document.querySelectorAll('.session-btn').forEach(b => b.classList.remove('selected'));
  selectedSession = null;
}

// ─── SAVE CONDITIONING / CV + PUMP ────────────────────────
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

  const condRes = await sb('conditioning_logs', 'POST', {
    date: todayStr(),
    activity,
    duration_mins: duration,
    notes: summary
  }, { quiet: true });
  if (!condRes.ok) {
    showToast(`CV + Pump NOT saved (${condRes.status}) — try again`, 'error');
    return;
  }

  const workoutId = await createWorkoutRow('cv-pump');
  if (workoutId) {
    // The notes on this row are load-bearing: CV + Pump has no sets and no cardio_logs rows, so
    // realWorkoutsBetween()/loadHistory() only count it as a real session because of them.
    await sb(`workouts?id=eq.${workoutId}`, 'PATCH',
      { notes: summary, completed_at: new Date().toISOString() });
  }

  showToast('CV + Pump logged!', 'success');
  ['cond-pump-method','cond-duration','cond-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('session-grid').style.display = 'grid';
  document.getElementById('session-pill').style.display = 'none';
  document.getElementById('conditioning-form').style.display = 'none';
  selectedSession = null;
  buildSessionGrid(selectedProgramme);
}

// ─── DAILY LOG ────────────────────────────────────────────
async function loadDailyLog(date = todayStr()) {
  document.getElementById('log-date').value = date;
  document.getElementById('log-weight').value = '';
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
    if (l.weight_kg) document.getElementById('log-weight').value = l.weight_kg;
    if (l.steps) document.getElementById('log-steps').value = l.steps;
    if (l.calories) document.getElementById('log-cals').value = l.calories;
    if (l.fasting_hours) document.getElementById('log-fasting').value = l.fasting_hours;
    if (l.protein_g) document.getElementById('log-protein').value = l.protein_g;
    if (l.carbs_g) document.getElementById('log-carbs').value = l.carbs_g;
    if (l.fat_g) document.getElementById('log-fat').value = l.fat_g;
    if (l.fibre_g) document.getElementById('log-fibre').value = l.fibre_g;
    if (l.energy) setEnergy(l.energy);
    if (l.notes) document.getElementById('log-notes').value = l.notes;
  }
}

async function openCheckinModal(date = todayStr()) {
  await loadDailyLog(date);
  document.getElementById('checkin-modal').style.display = 'block';
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
  document.getElementById('checkin-sum-cals').textContent = l.calories ?? '--';
  document.getElementById('checkin-sum-steps').textContent = l.steps ? l.steps.toLocaleString() : '--';
  // The four macro pills that used to sit here were removed 11 Aug 2026 — the targets block above
  // now shows the same numbers with a target beside each, so the pills were the same data twice.
  const pills = [];
  if (l.energy) pills.push(`<span class="pill pill-rest">Energy · ${ENERGY_WORDS[l.energy] || l.energy}</span>`);
  pillsEl.innerHTML = pills.join('');
  if (l.notes) { notesEl.style.display = 'block'; notesEl.textContent = l.notes; } else { notesEl.style.display = 'none'; }
  btn.textContent = 'Edit Today';
}

async function saveDailyLog() {
  const date = document.getElementById('log-date').value || todayStr();
  const data = {
    date,
    weight_kg: parseFloat(document.getElementById('log-weight').value) || null,
    steps: parseInt(document.getElementById('log-steps').value) || null,
    calories: parseInt(document.getElementById('log-cals').value) || null,
    fasting_hours: parseFloat(document.getElementById('log-fasting').value) || null,
    protein_g: parseFloat(document.getElementById('log-protein').value) || null,
    carbs_g: parseFloat(document.getElementById('log-carbs').value) || null,
    fat_g: parseFloat(document.getElementById('log-fat').value) || null,
    fibre_g: parseFloat(document.getElementById('log-fibre').value) || null,
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

// Energy is stored 1–5 in the DB; 0 is the slider's "not set" position and saves as null.
const ENERGY_WORDS = ['—', 'Flat', 'Low', 'OK', 'Good', 'Strong'];

function setEnergy(val) {
  selectedEnergy = val;
  const slider = document.getElementById('log-energy');
  const word = document.getElementById('log-energy-word');
  if (slider) slider.value = val;
  if (word) word.textContent = ENERGY_WORDS[val] || '—';
}

// Copies the most recent earlier check-in into the form — the macros are hand-relayed
// from MyFitnessPal daily and rarely move much, so this is usually 90% right.
async function fillFromYesterday() {
  const date = document.getElementById('log-date').value || todayStr();
  const prev = await sb(`daily_logs?date=lt.${date}&order=date.desc&limit=1&select=*`);
  if (!prev || !prev.length) { showToast('No earlier check-in to copy', 'error'); return; }
  const l = prev[0];
  const set = (id, v) => { document.getElementById(id).value = (v === null || v === undefined) ? '' : v; };
  set('log-weight', l.weight_kg);
  set('log-steps', l.steps);
  set('log-cals', l.calories);
  set('log-protein', l.protein_g);
  set('log-carbs', l.carbs_g);
  set('log-fat', l.fat_g);
  set('log-fibre', l.fibre_g);
  setEnergy(l.energy || 0);
  showToast(`Copied from ${l.date}`, 'success');
}

function clearCheckinFields() {
  ['log-weight','log-steps','log-cals','log-protein','log-carbs','log-fat','log-fibre','log-notes']
    .forEach(id => { document.getElementById(id).value = ''; });
  setEnergy(0);
}

// ─── STATS ────────────────────────────────────────────────
// Redesigned 10 Aug 2026: hero weight + hand-rolled SVG trend chart + macro averages.
// The old Chart.js tile-switcher was removed — see CODEBASE.md for what went and why.
async function loadStats() {
  const since = new Date(); since.setDate(since.getDate() - 21);
  const sinceStr = dateStr(since);
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = dateStr(weekAgo);

  const [weightLogs, weekLogs, weekSessions] = await Promise.all([
    sb(`daily_logs?date=gte.${sinceStr}&order=date.asc&select=date,weight_kg`),
    sb(`daily_logs?date=gte.${weekAgoStr}&order=date.asc&select=date,steps,calories,protein_g,carbs_g,fat_g`),
    // Was counting raw `workouts` rows, so an opened-and-abandoned session (or a test run) inflated
    // the tile — the exact bug fixed on Home on 11 Aug, which this tile was missed out of. Same
    // has-sets-or-cardio-or-notes test everything else uses now. See realWorkoutsBetween().
    realWorkoutsBetween(getWeekStart())
  ]);

  // Only days with an actual weigh-in — skipped days are dropped entirely so the
  // line never shows a hole (user weighs in ~5 days a week, not 7).
  const points = (weightLogs || [])
    .filter(l => l.weight_kg !== null && l.weight_kg !== undefined)
    .map(l => ({ date: l.date, v: parseFloat(l.weight_kg) }))
    .slice(-12);

  renderWeightHero(points);
  renderWeightChart(points);

  document.getElementById('stat-sessions').textContent = weekSessions.length;

  const sv = (weekLogs || []).filter(l => l.steps).map(l => l.steps);
  document.getElementById('stat-steps').textContent =
    sv.length ? Math.round(sv.reduce((a, b) => a + b, 0) / sv.length).toLocaleString() : '--';

  renderMacroAverages(weekLogs || []);
}

function renderWeightHero(points) {
  const valEl = document.getElementById('stats-hero-weight');
  const subEl = document.getElementById('stats-hero-delta');
  if (!points.length) {
    valEl.innerHTML = `--<span class="stats-hero-unit">kg</span>`;
    subEl.textContent = 'No weigh-ins yet';
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

// Hand-rolled SVG rather than Chart.js so every point can carry its own value label.
function renderWeightChart(points) {
  const box = document.getElementById('stats-weight-chart');
  if (points.length < 2) {
    box.innerHTML = '<div class="empty">Not enough weigh-ins to chart yet</div>';
    return;
  }
  const W = 300, TOP = 24, H = 74, L = 26, R = 278;
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

  // Label every 3rd point plus the latest, so a 12-point line stays readable on a phone.
  const labelled = i => i % 3 === 0 || i === points.length - 1;
  const dayOf = d => String(new Date(d).getDate()).padStart(2, '0');

  box.innerHTML = `<svg viewBox="0 0 ${W} 112" role="img" aria-label="Weight trend">
    <defs><linearGradient id="wgrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#e85d2f" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="#e85d2f" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#wgrad)"/>
    <polyline points="${poly}" fill="none" stroke="#e85d2f" stroke-width="2" stroke-linejoin="round"/>
    ${coords.map((c, i) => {
      const last = i === coords.length - 1;
      return `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${last ? 4 : 2.4}" fill="${last ? '#e85d2f' : '#0e0e0e'}" stroke="#e85d2f" stroke-width="1.7"/>`;
    }).join('')}
    ${coords.map((c, i) => labelled(i)
      ? `<text x="${c[0].toFixed(1)}" y="${(c[1] - 8).toFixed(1)}" text-anchor="middle" font-family="DM Mono, monospace" font-size="8" font-weight="500" fill="${i === coords.length - 1 ? '#e85d2f' : '#888'}">${points[i].v.toFixed(1)}</text>`
      : '').join('')}
    ${coords.map((c, i) => labelled(i)
      ? `<text x="${c[0].toFixed(1)}" y="106" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="7" fill="#666">${dayOf(points[i].date)}</text>`
      : '').join('')}
  </svg>`;
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
    calVal.innerHTML = ca === null ? '--' : `${Math.round(ca)}<span class="macro-cal-unit">kcal</span>`;
  }
  if (calTarget) {
    const state = (ca === null || ct === null) ? null : goalState(ca, ct);
    calTarget.innerHTML = (ca === null || ct === null) ? ''
      : `(Target ${Math.round(ct)}<b class="gv-${state || 'empty'}">${macroDelta(ca, ct)}</b>)`;
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
        if (e.best === null || wt > e.best) { e.best = wt; e.bestReps = reps; }
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
    let runningMax = null;
    list.forEach((entry, i) => {
      const prev = i > 0 ? list[i - 1] : null;
      const delta = (entry.best !== null && prev && prev.best !== null) ? entry.best - prev.best : null;
      // First-ever occurrence isn't flagged as a PR — otherwise every old entry wears a badge.
      const isPR = i > 0 && entry.best !== null && runningMax !== null && entry.best > runningMax;
      if (entry.best !== null) runningMax = runningMax === null ? entry.best : Math.max(runningMax, entry.best);
      out[`${entry.workoutId}|${key}`] = {
        exercise: entry.exercise, variation: entry.variation, supersetGroup: entry.supersetGroup,
        best: entry.best, bestReps: entry.bestReps, delta, isPR,
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
  const [logs, workouts] = await Promise.all([
    sb(`daily_logs?order=date.desc&select=*`),
    sb(`workouts?order=date.desc&select=id,date,session_type,notes`)
  ]);
  allHistoryLogs = logs || [];
  allHistoryWorkouts = workouts || [];
  // Fetch all sets for visible workouts in one batched call — not one call per card
const workoutIds = (workouts || []).map(w => `"${w.id}"`).join(',');
// Ordered by created_at so exercises list in the order they were actually completed
// (workout_sets has no explicit sequence column). rest_seconds drives the rest display.
const allSets = workoutIds.length
  ? await sb(`workout_sets?workout_id=in.(${workoutIds})&select=workout_id,exercise,weight,reps,rest_seconds,set_number,variation,superset_group,created_at&order=created_at.asc,set_number.asc`)
  : [];
// Group sets by workout_id for quick lookup when rendering cards
window._setsByWorkout = {};
(allSets || []).forEach(s => {
  if (!window._setsByWorkout[s.workout_id]) window._setsByWorkout[s.workout_id] = [];
  window._setsByWorkout[s.workout_id].push(s);
});
// Same batched-fetch pattern for cardio entries
const allCardio = workoutIds.length
  ? await sb(`cardio_logs?workout_id=in.(${workoutIds})&select=workout_id,activity,duration_mins,distance,floors,incline,speed_kmh`)
  : [];
window._cardioByWorkout = {};
(allCardio || []).forEach(c => {
  if (!window._cardioByWorkout[c.workout_id]) window._cardioByWorkout[c.workout_id] = [];
  window._cardioByWorkout[c.workout_id].push(c);
});
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
  historyPage = 1;
  historyTab = 'all';
  historyDateRange = 'all';
  historyWorkoutFilter = 'all';
  historySearchTerm = '';
  if (allHistoryLogs.length === 0 && allHistoryWorkouts.length === 0) {
    list.innerHTML = '<div class="empty">No logs yet — start tracking today</div>';
    return;
  }
  renderHistoryPage();
}

function getDateRangeFilter() {
  const today = new Date();
  let startDate = new Date('2000-01-01');
  if (historyDateRange === 'week') {
    return getWeekStart();
  } else if (historyDateRange === 'month') {
    startDate = new Date(today);
    startDate.setMonth(today.getMonth() - 1);
  }
  return dateStr(startDate);
}

function filterHistoryData() {
  const startDate = getDateRangeFilter();
  let filteredLogs = allHistoryLogs.filter(l => l.date >= startDate);
  let filteredWorkouts = allHistoryWorkouts.filter(w => w.date >= startDate);
  
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
        const row = (label, value, cell) => value === null || value === undefined ? '' :
          `<div class="pf-lift"><span class="pf-lname">${esc(label)}</span><span class="pf-lval">${esc(value)}</span>${cell}</div>`;
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
          const value = t === null ? `${v}${unit}` : `${Math.round(v)} / ${Math.round(t)}${unit}`;
          const cell = t === null
            ? deltaCell(dnum(key), { suffix: unit, decimals: 0, neutral: true })
            : goalCell(v, t, { suffix: unit, decimals: 0, underIsMiss: !!opts.underIsMiss });
          return row(label, value, cell);
        };
        // Weight has no target, so it stays a day-on-day change — two different comparison bases in
        // one column, which is only safe because both are named here and the macro rows carry their
        // target inline. The previous check-in is often not yesterday, so name the actual date.
        const bases = [];
        if (hasAnyGoal()) bases.push('macros vs target');
        if (prev) bases.push(`weight vs ${new Date(prev.date).toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'})}`);
        const cmpLine = bases.length ? `<div class="pf-cmp">${bases.join(' · ')}</div>` : '';
        const footBits = [];
        if (l.steps) footBits.push(`<span>Steps <b>${esc(l.steps.toLocaleString())}</b></span>`);
        if (l.energy) footBits.push(`<span>Energy <b>${esc(ENERGY_WORDS[l.energy] || l.energy)}</b></span>`);
        // esc() rather than a bare "-to-&quot; replace: the old version only escaped double quotes,
        // so a note containing the literal text `&quot;` decoded back into a real quote and broke
        // out of this JS string into executable code. esc() escapes & first, which stops that.
        html += `<div class="pf-card log" onclick="openEditLog(${esc(JSON.stringify(l))})">
          <div class="pf-head">
            <span class="pf-name">CHECK-IN</span>
            <span class="pf-date">${new Date(l.date).toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'})}</span>
          </div>
          ${cmpLine}
          ${row('Weight', l.weight_kg !== null && l.weight_kg !== undefined ? `${l.weight_kg}kg` : null, deltaCell(dnum('weight_kg'), {suffix:'kg', lowerIsBetter:true}))}
          ${macroRow('Calories', 'calories', goalCalories(), {unit:''})}
          ${macroRow('Protein', 'protein_g', MACRO_GOALS.protein_g, {underIsMiss:true})}
          ${macroRow('Carbs', 'carbs_g', MACRO_GOALS.carbs_g)}
          ${macroRow('Fat', 'fat_g', MACRO_GOALS.fat_g)}
          ${macroRow('Fibre', 'fibre_g', MACRO_GOALS.fibre_g, {underIsMiss:true})}
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
          const restTxt = p.avgRest !== null ? `rest ${fmtRest(p.avgRest)} avg` : 'rest —';
          const label = `${esc(p.exercise)}${p.variation ? ` <span style="color:var(--muted);">· ${esc(p.variation)}</span>` : ''}`;
          // Supersets: the lifts in one group carry the same tag, so they read as a pair on the card.
          const ssTag = p.supersetGroup ? `<span class="pf-ss">s/s ${esc(p.supersetGroup)}</span>` : '';
          return `<div class="pf-lift${p.supersetGroup ? ' pf-ss-row' : ''}">
            <span><span class="pf-lname">${label}${ssTag}${p.isPR ? '<span class="pf-badge">PR</span>' : ''}</span><div class="pf-sub">${esc(restTxt)}</div></span>
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
  renderHistoryPage();
}

function setHistoryDateRange(range) {
  historyDateRange = range;
  historyPage = 1;
  renderHistoryPage();
}

function setHistoryWorkoutFilter(type) {
  historyWorkoutFilter = type;
  historyPage = 1;
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
    document.getElementById('session-grid').style.display = 'grid';
    document.getElementById('session-pill').style.display = 'none';
    document.getElementById('workout-logger').style.display = 'none';
    document.getElementById('conditioning-form').style.display = 'none';
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
  }

// ─── EDIT CHECK-IN MODAL ──────────────────────────────────
let editingLogDate = null;
let editingEnergy = 0;

function openEditLog(l) {
  editingLogDate = l.date;
  editingEnergy = l.energy || 0;
  document.getElementById('edit-modal-title').textContent =
    new Date(l.date).toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long'});
  document.getElementById('edit-weight').value = l.weight_kg || '';
  document.getElementById('edit-fasting').value = l.fasting_hours || '';
  document.getElementById('edit-cals').value = l.calories || '';
  document.getElementById('edit-steps').value = l.steps || '';
  document.getElementById('edit-protein').value = l.protein_g || '';
  document.getElementById('edit-carbs').value = l.carbs_g || '';
  document.getElementById('edit-fat').value = l.fat_g || '';
  document.getElementById('edit-fibre').value = l.fibre_g || '';
  document.getElementById('edit-notes').value = l.notes || '';
  setEditEnergy(editingEnergy);
  document.getElementById('edit-modal').style.display = 'block';
}

function closeEditLog() {
  document.getElementById('edit-modal').style.display = 'none';
  editingLogDate = null;
}

function setEditEnergy(val) {
  editingEnergy = val;
  const slider = document.getElementById('edit-energy');
  const word = document.getElementById('edit-energy-word');
  if (slider) slider.value = val;
  if (word) word.textContent = ENERGY_WORDS[val] || '—';
}

async function saveEditLog() {
  if (!editingLogDate) return;
  const res = await sb(`daily_logs?date=eq.${editingLogDate}`, 'PATCH', {
    weight_kg: parseFloat(document.getElementById('edit-weight').value) || null,
    fasting_hours: parseFloat(document.getElementById('edit-fasting').value) || null,
    calories: parseInt(document.getElementById('edit-cals').value) || null,
    steps: parseInt(document.getElementById('edit-steps').value) || null,
    protein_g: parseFloat(document.getElementById('edit-protein').value) || null,
    carbs_g: parseFloat(document.getElementById('edit-carbs').value) || null,
    fat_g: parseFloat(document.getElementById('edit-fat').value) || null,
    fibre_g: parseFloat(document.getElementById('edit-fibre').value) || null,
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

function renderEditCardioEntryBlock(entry) {
  const def = CARDIO_ACTIVITIES[entry.activity];
  if (!def) return '';
  const fields = def.fields.map(f => {
    const label = f === 'distance' ? (def.distanceLabel || 'Distance') : CARDIO_FIELD_LABELS[f];
    return `<div class="field-group">
      <label class="field-label">${esc(label)}</label>
      <input type="number" step="0.1" class="field-input" id="ecardio-${entry.id}-${f}" />
    </div>`;
  }).join('');
  const presets = def.presets ? `<div class="variation-toggle" style="margin-top:6px;">
      ${def.presets.map(p => `<button class="var-btn" type="button" onclick="setEditCardioPreset(${entry.id}, ${p})">${p}m</button>`).join('')}
    </div>` : '';
  return `<div class="card cardio-block" id="ecardio-block-${entry.id}" style="margin-bottom:0.875rem;">
    <div class="ex-name-row">
      <div class="ex-name-display">${esc(cardioDisplayName(entry.activity))}</div>
      <button class="ex-remove-btn" onclick="removeEditCardioEntry(${entry.id})" aria-label="Remove cardio entry" title="Remove">✕</button>
    </div>
    <div class="cardio-field-grid" style="display:grid; grid-template-columns:repeat(${def.fields.length}, 1fr); gap:8px; margin-top:8px;">${fields}</div>
    ${presets}
  </div>`;
}

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
  wrapper.innerHTML = renderEditCardioEntryBlock({ id, activity });
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
  const cardioRows = await sb(`cardio_logs?workout_id=eq.${workoutId}&select=*`);
  (cardioRows || []).forEach(row => {
    const id = editCardioCounter++;
    editCardioEntries.push({ id, dbId: row.id, activity: row.activity });
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderEditCardioEntryBlock({ id, activity: row.activity });
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

  // created_at first, set_number second — same sort as loadHistory(), so the modal lists
  // exercises in the order they were actually logged. Ordering by set_number alone returned
  // all set 1s, then all set 2s, leaving the exercise order arbitrary.
  const sets = await sb(`workout_sets?workout_id=eq.${workoutId}&order=created_at.asc,set_number.asc&select=*`);
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
          weightCol = `<input type="text" class="set-input" id="ew-${esc(ex.name)}-${i}" placeholder="BW / kg" value="${esc(existing?.weight || '')}" />`;
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
  if (!confirm('Delete this workout?')) return;
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

    // Fire the beep once, the moment we cross the target
    if (pct >= 1 && !swCompletionBeeped) {
      swCompletionBeeped = true;
      swBeep();
      swVibrate([80, 60, 80]);
    }
  } else {
    btn.classList.remove('done');
    fill.style.strokeDashoffset = SW_RING_CIRCUMFERENCE;
    // Restore the icon glyph
    inner.innerHTML = `<svg class="ex-watch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="13" r="5"/><path d="M12 10.5v2.5l1.5 1.5"/><path d="M10 5h4"/></svg>`;
  }
}

// Paint all watches in the current session (cheap — only a handful of exercises)
function swRenderAll() {
  if (!selectedSession) return;
  selectedSession.exercises.forEach(ex => swRenderWatch(ex.name));
}

// ─── START / STOP / RESET ────────────────────────────────
function swStart(exName) {
  // UNLOCK AUDIO — must happen inside this tap handler or iOS blocks sound
  swUnlockAudio();

  // If a different exercise was running, stop it first (no orphan timers)
  if (swRunning && swActiveExercise && swActiveExercise !== exName) swStop();

  const ex = selectedSession?.exercises.find(e => e.name === exName);
  swTargetSeconds = swParseRest(ex?.rest);
  swStartTimestamp = Date.now();
  swActiveExercise = exName;
  swRunning = true;
  swCompletionBeeped = false;

  // Persist across page navigation — sessionStorage survives Stats→Workout
  sessionStorage.setItem('sw_state', JSON.stringify({
    start: swStartTimestamp,
    target: swTargetSeconds,
    exercise: exName
  }));

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
  swVibrate(10);
  swRenderWatch(exName);   // snap the ring back to idle now — don't wait on the network save below

  // Save the rest to the last typed set for THIS exercise
  const target = swFindLastTypedSetForExercise(exName);
  if (target && elapsed > 0) {
    await swSaveRest(target.exName, target.setNum, elapsed);
    swPaintRestLine(target.exName, target.setNum, elapsed);
    swFlashWatch(exName);
    saveDraft(selectedSession?.id);   // persist rest to localStorage so it survives reload
  }
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
    swCompletionBeeped = (Date.now() - s.start) / 1000 >= s.target;
    swRenderWatch(s.exercise);
    clearInterval(swInterval);
    swInterval = setInterval(() => swRenderWatch(s.exercise), 1000);
  } catch (e) { sessionStorage.removeItem('sw_state'); }
}

// Stub kept for compatibility with old calls — the new system doesn't need
// a global visibility toggle because the watch lives inside each tile.
function showSwPill() { /* no-op */ }