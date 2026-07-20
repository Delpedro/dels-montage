if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.addEventListener('scroll', () => {
  if (document.documentElement.classList.contains('login-active')) window.scrollTo(0, 0);
});

const SUPABASE_URL = 'https://mltikqmwwlgyzogrgemr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2BQBFSox7bL1X2TlSlbOYA_hn8FcPmy';

const SESSIONS = [
  {
    id: 'upper-a', day: 'Monday', name: 'Upper A', focus: 'Push focus', programme: 'upper-lower',
    exercises: [
      { name: 'Incline Chest Press', sets: 3, reps: '6–10', rest: '180s', note: 'Start lighter than you think', variations: ['Smith', 'DB'], aliases: ['Smith Machine Incline Press'] },
      { name: 'Machine Chest Press', sets: 3, reps: '8–12', rest: '90s' },
      { name: 'Shoulder Press', sets: 3, reps: '8–12', rest: '90s', variations: ['Machine', 'Smith', 'DB'], aliases: ['Machine Shoulder Press'] },
      { name: 'Lateral Raise', sets: 3, reps: '12–15', rest: '60s', variations: ['DB', 'Machine'] },
      { name: 'Overhead Cable Tricep Ext', sets: 3, reps: '10–15', rest: '60s' },
      { name: 'Tricep Pushdown', sets: 3, reps: '12–15', rest: '60s', note: 'Rope — neutral grip' },
    ]
  },
  {
    id: 'lower-a', day: 'Tuesday', name: 'Lower A', focus: 'Quad focus + core', programme: 'upper-lower',
    exercises: [
      { name: 'Hack Squat / Leg Press', sets: 3, reps: '8–12', rest: '180s', variations: ['Hack Squat', 'Leg Press'] },
      { name: 'Leg Extension', sets: 3, reps: '10–12', rest: '60s', variations: ['Leg Extension', 'New Leg Extension'] },
      { name: 'Lying Leg Curl', sets: 3, reps: '8–12', rest: '75s' },
      { name: 'Walking Lunge', sets: 3, reps: '6 steps each way', rest: '75s', note: 'BW or light DBs — walk forward then back' },
      { name: 'Seated Calf Raise', sets: 3, reps: '10–12', rest: '60s' },
      { name: 'Pallof Press', sets: 4, reps: '12 each side', rest: '45s', note: 'Core — hernia safe', variations: ['Red Band', 'Yellow Band'], band: true },
    ]
  },
  {
    id: 'upper-b', day: 'Thursday', name: 'Upper B', focus: 'Pull focus', programme: 'upper-lower',
    exercises: [
      { name: 'Lat Pulldown', sets: 3, reps: '8–12', rest: '90s', note: 'Neutral grip' },
      { name: 'Chest Supported Row', sets: 3, reps: '8–12', rest: '90s' },
      { name: 'Seated Cable Row', sets: 3, reps: '10–12', rest: '75s', note: 'Not rope attachment' },
      { name: 'Face Pull', sets: 3, reps: '12–15', rest: '60s', note: "Don't skip this" },
      { name: 'Straight Arm Pulldown', sets: 3, reps: '12–15', rest: '60s' },
      { name: 'Hammer Curl', sets: 3, reps: '10–12', rest: '75s', note: '12 reps each side/arm — neutral grip' },
      { name: 'Incline Single Cable Curl', sets: 3, reps: '12–15', rest: '60s' },
    ]
  },
  {
    id: 'lower-b', day: 'Friday', name: 'Lower B', focus: 'Posterior chain + core', programme: 'upper-lower',
    exercises: [
      { name: 'Smith RDL', sets: 3, reps: '6–10', rest: '120s', note: 'Hernia safe' },
      { name: 'Leg Press', sets: 3, reps: '8–12', rest: '180s', note: 'Higher feet — glute bias' },
      { name: 'Leg Curl', sets: 3, reps: '10–12', rest: '60s' },
      { name: 'Hip Thrusts', sets: 3, reps: '10–15', rest: '75s', variations: ['Hip Machine', 'Booty Hip Machine'], aliases: ['Hip Thrust Machine'] },
      { name: 'Seated Calf Raise', sets: 3, reps: '8–12', rest: '60s' },
      { name: 'Dead Bug', sets: 3, reps: '10 each', rest: '45s', note: 'Core — hernia safe', bodyweight: true },
      { name: 'Cable Woodchop', sets: 3, reps: '12 each', rest: '45s', note: 'Core — hernia safe', variations: ['Cable', 'KG'] },
    ]
  },
  {
    id: 'full-body-a', name: 'Full Body A', focus: 'Squat + push bias', programme: 'full-body-cv',
    exercises: [
      { name: 'Hack Squat / Leg Press', sets: 3, reps: '6–10', rest: '180s', variations: ['Hack Squat', 'Leg Press'] },
      { name: 'Incline Chest Press', sets: 3, reps: '6–10', rest: '150s', variations: ['Smith', 'DB'], aliases: ['Smith Machine Incline Press'] },
      { name: 'Chest Supported Row', sets: 3, reps: '8–12', rest: '90s' },
      { name: 'Lateral Raise', sets: 3, reps: '12–15', rest: '60s', variations: ['DB', 'Machine'] },
      { name: 'Tricep Pushdown', sets: 2, reps: '10–15', rest: '60s', note: 'Controlled reps — no ego' },
      { name: 'Seated Calf Raise', sets: 3, reps: '10–15', rest: '60s' },
    ]
  },
  {
    id: 'full-body-b', name: 'Full Body B', focus: 'Hinge + pull bias', programme: 'full-body-cv',
    exercises: [
      { name: 'Smith RDL', sets: 3, reps: '6–10', rest: '150s', note: 'Hernia safe' },
      { name: 'Machine Chest Press', sets: 3, reps: '8–12', rest: '90s' },
      { name: 'Lat Pulldown', sets: 3, reps: '8–12', rest: '90s', note: 'Neutral grip' },
      { name: 'Face Pull', sets: 3, reps: '12–15', rest: '60s', note: 'Rear delts + shoulder health' },
      { name: 'Hammer Curl', sets: 2, reps: '10–12', rest: '60s', note: '12 reps each side/arm — neutral grip' },
      { name: 'Dead Bug', sets: 3, reps: '10 each', rest: '45s', note: 'Core — hernia safe', bodyweight: true },
    ]
  },
  {
    id: 'full-body-c', name: 'Full Body C', focus: 'Balanced performance', programme: 'full-body-cv',
    exercises: [
      { name: 'Leg Press', sets: 3, reps: '8–12', rest: '180s', note: 'Controlled depth' },
      { name: 'Shoulder Press', sets: 3, reps: '8–12', rest: '90s', variations: ['Machine', 'Smith', 'DB'], aliases: ['Machine Shoulder Press'] },
      { name: 'Seated Cable Row', sets: 3, reps: '10–12', rest: '75s', note: 'Not rope attachment' },
      { name: 'Machine Chest Press', sets: 2, reps: '10–12', rest: '90s' },
      { name: 'Incline Single Cable Curl', sets: 2, reps: '12–15', rest: '60s' },
      { name: 'Lying Leg Curl', sets: 3, reps: '10–12', rest: '60s' },
    ]
  },
  { id: 'cv-pump', name: 'CV + Pump', focus: 'One weak-point lift + cardio', programme: 'full-body-cv', cardio: true }
];

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
  }
];

// ─── EXERCISE LIBRARY (for Open Workout's Add Exercise dropdown) ──
// Flattened from SESSIONS, deduped by name (first occurrence wins), keyed by name for O(1) lookup.
function buildExerciseLibrary() {
  const map = {};
  SESSIONS.forEach(s => {
    (s.exercises || []).forEach(ex => { if (!map[ex.name]) map[ex.name] = ex; });
  });
  return map;
}
let EXERCISE_LIBRARY = buildExerciseLibrary();

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
let cardioEntryCounter = 0;

let selectedEnergy = 0;
let selectedSession = null;
let selectedProgramme = null;
let previousSets = {};
let selectedVariations = {};
let editSelectedVariations = {};
let mainChart = null;
let currentChartType = 'weight';
let statsData = {};
let currentPage = 'home';
let currentWorkoutId = null;
let currentWorkoutHasSets = false;
let lastCompletedExercise = null;

// ─── SUPABASE ─────────────────────────────────────────────
async function sb(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=minimal' : ''
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  if (method === 'GET') return res.json();
  return res;
}

async function createWorkoutRow(sessionId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/workouts`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ date: todayStr(), session_type: sessionId, notes: '' })
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.id ?? null;
}

// ─── AUTH ─────────────────────────────────────────────────
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pw = document.getElementById('login-password').value;
  if (!email || !pw) return;
  const hash = await sha256(pw);
  const users = await sb(`app_user?email=eq.${encodeURIComponent(email)}&password_hash=eq.${hash}&select=id`);
  if (users && users.length > 0) {
    sessionStorage.setItem('del_auth', '1');
    sessionStorage.setItem('del_page', 'home');
    document.documentElement.classList.remove('login-active');
    window.scrollTo(0, 0);
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    document.getElementById('login-screen').style.display = 'none';
    initApp();
  } else {
    document.getElementById('login-error').style.display = 'block';
  }
}

function handleLogout() {
  sessionStorage.clear();
  localStorage.removeItem('workout_draft');  // Clear any mid-workout draft so next login starts fresh
  window.scrollTo(0, 0);
  document.documentElement.classList.add('login-active');
  document.getElementById('login-screen').style.display = 'flex';
}

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleLogin();
});

window.addEventListener('load', () => {
  if (sessionStorage.getItem('del_auth')) {
    document.documentElement.classList.remove('login-active');
    document.getElementById('login-screen').style.display = 'none';
    const savedPage = sessionStorage.getItem('del_page') || 'home';
    initApp(savedPage);
  }
  const pill = document.getElementById('sw-pill');
  if (pill) {
    pill.addEventListener('pointerdown', swPillPointerDown);
    pill.addEventListener('pointerup', swPillPointerUp);
    pill.addEventListener('pointerleave', swPillPointerCancel);
    pill.addEventListener('pointercancel', swPillPointerCancel);
  }
});

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
  await fetch(`${SUPABASE_URL}/rest/v1/workouts?completed_at=is.null&created_at=lt.${cutoff}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ completed_at: new Date().toISOString() })
  });
}

// ─── INIT ─────────────────────────────────────────────────
async function initApp(page = 'home') {
  const now = new Date();
  document.getElementById('topbar-date').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('log-date').max = todayStr();
  await autoCloseStaleWorkouts();  // Clean up orphans from >24hrs ago before rendering the session grid
  loadCustomExercises();  // Merges into EXERCISE_LIBRARY in the background — Open Workout dropdown reads it lazily
  buildSessionGrid();
  loadDailyLog();
  showPage(page);
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
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

  const [latest, todayLog, weekWorkouts] = await Promise.all([
    sb(`daily_logs?order=date.desc&limit=1&select=weight_kg`),
    sb(`daily_logs?date=eq.${todayStr()}&select=steps`),
    sb(`workouts?date=gte.${getWeekStart()}&select=id`)
  ]);

  if (latest && latest[0]?.weight_kg) {
    document.getElementById('home-weight').textContent = latest[0].weight_kg;
  }
  document.getElementById('home-sessions').textContent = (weekWorkouts || []).length;

  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekLogs = await sb(`daily_logs?date=gte.${weekAgo.toISOString().split('T')[0]}&select=steps`);
  const stepsArr = (weekLogs || []).filter(l => l.steps).map(l => l.steps);
  const avgSteps = stepsArr.length ? Math.round(stepsArr.reduce((a,b)=>a+b,0)/stepsArr.length) : null;
  document.getElementById('home-steps').textContent = avgSteps ? avgSteps.toLocaleString() : '--';

  // Always rebuild — buildWeekStrip clears innerHTML first, so no risk of duplicates
  buildWeekStrip('home-week-strip');
}

function getWeekStart() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().split('T')[0];
}

// ─── WEEK STRIP ───────────────────────────────────────────
async function buildWeekStrip(containerId = 'home-week-strip') {
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const today = new Date();
  const dow = today.getDay();
  const strip = document.getElementById(containerId);
  if (!strip) return;

  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - dow + i);
    weekDates.push(d.toISOString().split('T')[0]);
  }

  const workouts = await sb(`workouts?date=gte.${weekDates[0]}&date=lte.${weekDates[6]}&select=date`);
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
    grid.innerHTML = '';
    if (sub) sub.textContent = 'Choose your training programme';

    TRAINING_PROGRAMMES.forEach(p => {
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
    return;
  }

  selectedProgramme = programmeId;
  if (sub) sub.textContent = 'Choose your session';

  // Fetch data BEFORE clearing grid — prevents concurrent calls racing and both appending to same empty grid
  // Only count as "done" if completed_at is set — an in-progress workout (Mark Done but no Save Workout) should NOT lock the session
  const todayWorkouts = await sb(`workouts?date=eq.${todayStr()}&completed_at=not.is.null&select=session_type`);
  grid.innerHTML = '';
  const doneTodaySessions = new Set((todayWorkouts || []).map(w => w.session_type));
  const sessions = SESSIONS.filter(s => s.programme === programmeId);

  const back = document.createElement('div');
  back.className = 'session-btn';
  back.innerHTML = `<div class="session-name">← Programmes</div><div class="session-focus">Back to programme selection</div>`;
  back.onclick = () => resetSessionSelection(true);
  grid.appendChild(back);

  sessions.forEach(s => {
    const btn = document.createElement('div');
    btn.className = 'session-btn';
    btn.id = `session-btn-${s.id}`;
    if (doneTodaySessions.has(s.id)) btn.classList.add('done');
    btn.innerHTML = `<div class="session-name">${s.name}</div><div class="session-focus">${s.focus}</div>${doneTodaySessions.has(s.id) ? '<div style="font-size:10px;color:var(--green);margin-top:4px;">✓ logged today</div>' : ''}`;
    btn.onclick = () => selectSession(s, btn);
    grid.appendChild(btn);
  });
}

function showProgrammeSessions(programmeId) {
  selectedProgramme = programmeId;
  buildSessionGrid(programmeId);
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

  const ok = await beginWorkoutSession(session);
  if (!ok) return;

  document.querySelectorAll('.session-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');

  document.getElementById('session-grid').style.display = 'none';
  document.getElementById('session-pill').style.display = 'flex';
  document.getElementById('session-pill-name').textContent = session.name;
  document.getElementById('conditioning-form').style.display = 'none';
  document.getElementById('workout-logger').style.display = 'block';
  buildWorkoutLogger(session);
}

// 'open' (Open Workout) is deliberately not in SESSIONS — its exercise list is per-workout, not fixed.
function sessionDisplayName(sessionType) {
  if (sessionType === 'open') return 'Open Workout';
  return SESSIONS.find(s => s.id === sessionType)?.name || sessionType;
}

// Rebuilds a { exercises: [...] } shape from actually-saved sets, for session types not in SESSIONS
// (currently just 'open'). Used by resume (buildWorkoutLogger) and History editing.
function reconstructSessionFromSets(sets) {
  const byExercise = {};
  (sets || []).forEach(s => {
    if (!byExercise[s.exercise]) byExercise[s.exercise] = 0;
    byExercise[s.exercise] = Math.max(byExercise[s.exercise], s.set_number);
  });
  const exercises = Object.keys(byExercise).map(name => {
    const libEx = EXERCISE_LIBRARY[name];
    return libEx ? { ...libEx, sets: byExercise[name] } : { name, sets: byExercise[name], reps: '', rest: '' };
  });
  return { exercises };
}

// ─── WORKOUT LOGGER ───────────────────────────────────────
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

  let html = `<div class="exercise-block" id="block-${ex.name}" data-rest-target="${swParseRest(ex.rest)}">
      <div class="ex-top">
        <div class="ex-name-row">
          <div class="ex-name-display">${ex.name}</div>
          ${session.id === 'open' ? `<button class="ex-remove-btn" id="remove-${ex.name}" onclick="removeOpenExercise('${ex.name}')" aria-label="Remove exercise" title="Remove">✕</button>` : ''}
          <button class="ex-watch" id="watch-${ex.name}" onclick="swTapWatch('${ex.name}')" aria-label="Rest timer">
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
          <span class="pill pill-sets">${ex.sets} sets</span>
          <span class="pill pill-reps">${ex.reps}</span>
          <span class="pill pill-rest">${ex.rest}</span>
        </div>
        ${ex.note ? `<div class="ex-note-text">${ex.note}</div>` : ''}
      </div>`;

  if (ex.variations) {
    selectedVariations[ex.name] = defaultVar;
    html += `<div class="variation-toggle">`;
    ex.variations.forEach(v => {
      const isSelected = v === defaultVar ? 'selected' : '';
      html += `<button class="var-btn ${isSelected}" onclick="selectVariation('${ex.name}', '${v}', this)">${v}</button>`;
    });
    html += `</div>`;
  }

  for (let i = 1; i <= ex.sets; i++) {
    const prevSet = filteredPrev[i-1];
    const prevHint = prevSet ? `${ex.band ? (prevSet.variation || 'Band').split(' ').map(w => w[0]).join('') : (prevSet.weight ?? 'BW')}×${prevSet.reps}` : '—';
    const repPlaceholder = ex.name === 'Walking Lunge' ? 'steps' : 'reps';

    let weightCol = '';
    if (ex.bodyweight) {
      weightCol = `<div class="set-label" id="w-${ex.name}-${i}">BW</div>`;
    } else if (ex.variations && ex.band) {
      weightCol = `<div class="set-label" id="w-${ex.name}-${i}">${defaultVar}</div>`;
    } else {
      weightCol = `<input type="text" class="set-input" id="w-${ex.name}-${i}" placeholder="kg" inputmode="decimal" oninput="saveDraft('${session.id}')" />`;
    }

    html += `<div class="set-row">
      <div class="set-num">${i}</div>
      ${weightCol}
      <input type="number" class="set-input" id="r-${ex.name}-${i}" placeholder="${repPlaceholder}" inputmode="numeric" oninput="saveDraft('${session.id}')" />
      <div class="prev-badge" id="badge-${ex.name}-${i}">${prevHint}</div>
    </div>
    <div class="rest-line" id="rest-${ex.name}-${i}"></div>`;
    // ↑ empty by default — filled in with "↳ Rest 2:45" after the watch is stopped for this set
  }

  html += `<button class="btn btn-outline btn-full" id="done-btn-${ex.name}" onclick="completeExercise('${ex.name}')" style="margin-top:8px;">Mark Done</button>`;
  html += `</div>`;
  return html;
}

// Populates `previousSets` for the given session. Fixed sessions: last workout of that session_type.
// Open Workout: scoped to past Open workouts only, per-exercise most-recent-occurrence (a single "last
// Open workout" won't reliably contain every exercise picked this time, since they vary session to session).
async function loadPreviousSetsForSession(session) {
  previousSets = {};
  if (session.id === 'open') {
    Object.assign(previousSets, await fetchOpenPreviousSets(session.exercises.map(e => e.name)));
    return;
  }
  const prevWorkouts = await sb(`workouts?session_type=eq.${session.id}&order=date.desc&limit=2&select=id,date`);
  if (prevWorkouts && prevWorkouts.length > 0) {
    const prevWorkout = prevWorkouts.find(w => w.id !== currentWorkoutId);
    if (prevWorkout) {
      const prevSets = await sb(`workout_sets?workout_id=eq.${prevWorkout.id}&select=exercise,set_number,weight,reps,variation&order=set_number.asc`);
      (prevSets || []).forEach(s => {
        if (!previousSets[s.exercise]) previousSets[s.exercise] = [];
        previousSets[s.exercise].push({ weight: s.weight, reps: s.reps, variation: s.variation });
      });
    }
  }
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

// Reads any exercises an in-progress Open Workout draft added but hadn't Mark-Done'd yet (so a refresh
// mid-session doesn't lose the block — DB reconstruction alone only knows about *saved* sets).
function peekDraftOpenExercises() {
  try {
    const raw = localStorage.getItem('workout_draft');
    if (!raw) return [];
    const draft = JSON.parse(raw);
    if (draft.sessionId !== 'open') return [];
    if (draft.timestamp && Date.now() - draft.timestamp > 24*60*60*1000) return [];
    return draft.openExercises || [];
  } catch (e) { return []; }
}

async function buildWorkoutLogger(session) {
  const logger = document.getElementById('workout-logger');
  logger.innerHTML = '<div class="loading">Loading previous lifts...</div>';

  if (!session.cardioEntries) session.cardioEntries = [];

  if (session.id === 'open') {
    const existingNames = new Set(session.exercises.map(e => e.name));
    peekDraftOpenExercises().forEach(name => {
      if (!existingNames.has(name)) {
        session.exercises.push(EXERCISE_LIBRARY[name] || { name, sets: 3, reps: '8–12', rest: '90s' });
        existingNames.add(name);
      }
    });
  }

  await loadPreviousSetsForSession(session);

  let html = '';
  session.exercises.forEach(ex => { html += renderExerciseBlock(ex, session); });

  if (session.id === 'open') {
    if (session.exercises.length === 0) html += `<div class="empty" style="margin-bottom:0.875rem;">Tap Add Exercise below to get started</div>`;
    html += renderAddExerciseRow();
  }

  html += renderCardioSection(session);

  html += `<div class="field-group" style="margin-top:0.875rem;">
    <label class="field-label">Session Notes</label>
    <textarea class="field-input" id="workout-notes" placeholder="How did it go..." oninput="saveDraft('${session.id}')"></textarea>
  </div>
  <button class="btn btn-save btn-full" onclick="saveWorkout()" style="margin-bottom:1rem;">Save Workout</button>`;

  logger.innerHTML = html;
  restoreDraft(session);

  // Restore already-saved sets on resume: paint rest times, fill empty inputs, mark exercises done
  if (currentWorkoutId) {
    const savedSets = await sb(`workout_sets?workout_id=eq.${currentWorkoutId}&select=exercise,set_number,rest_seconds,weight,reps`);
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
      const block = document.getElementById(`block-${exName}`);
      if (block) block.style.borderColor = 'var(--green)';
      const doneBtn = document.getElementById(`done-btn-${exName}`);
      if (doneBtn) {
        doneBtn.textContent = '✓ Done';
        doneBtn.style.borderColor = 'var(--green)';
        doneBtn.style.color = 'var(--green)';
      }
      const removeBtn = document.getElementById(`remove-${exName}`);
      if (removeBtn) removeBtn.style.display = 'none';
    });
  }

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
  names.forEach(n => { opts += `<option value="${n}">${n}</option>`; });
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
}

async function addOpenExercise(name) {
  if (!selectedSession || selectedSession.exercises.some(e => e.name === name)) return;
  const def = EXERCISE_LIBRARY[name] || { name, sets: 3, reps: '8–12', rest: '90s' };
  selectedSession.exercises.push(def);

  const emptyMsg = document.querySelector('#workout-logger .empty');
  if (emptyMsg) emptyMsg.remove();

  const fetched = await fetchOpenPreviousSets([name]);
  Object.assign(previousSets, fetched);

  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderExerciseBlock(def, selectedSession);
  const addRow = document.getElementById('open-add-exercise-row');
  addRow.parentNode.insertBefore(wrapper.firstElementChild, addRow);
  renderOpenAddExerciseOptions();
  saveDraft('open');
}

function removeOpenExercise(name) {
  if (!selectedSession) return;
  selectedSession.exercises = selectedSession.exercises.filter(e => e.name !== name);
  const block = document.getElementById(`block-${name}`);
  if (block) block.remove();
  renderOpenAddExerciseOptions();
  saveDraft('open');
}

// ─── CARDIO SECTION ───────────────────────────────────────
// Optional cardio logged after the weights, at the bottom of any workout logger (not CV + Pump,
// which never reaches buildWorkoutLogger). Multiple entries allowed, including repeats of the
// same activity (e.g. two separate bike intervals). Unlike exercises, entries aren't saved
// incrementally — they're read live from their inputs and POSTed once, in saveWorkout().
const CARDIO_FIELD_LABELS = { duration: 'Duration (min)', floors: 'Floors', incline: 'Incline (%)', speed: 'Speed (km/h)' };

// One-line summary for a saved cardio_logs row, used in History workout cards.
function formatCardioEntry(c) {
  const details = [];
  if (c.duration_mins != null) details.push(`${c.duration_mins}min`);
  if (c.distance != null) details.push(`${c.distance}${c.activity === 'Bike' ? 'km' : 'm'}`);
  if (c.floors != null) details.push(`${c.floors} floors`);
  if (c.incline != null) details.push(`${c.incline}%`);
  if (c.speed_kmh != null) details.push(`${c.speed_kmh}km/h`);
  return details.length ? `${c.activity} ${details.join(', ')}` : c.activity;
}

function renderCardioSection(session) {
  const entries = session.cardioEntries || [];
  return `<div class="section-title" style="font-size:16px;margin-top:0.875rem;margin-bottom:0.5rem;">Cardio (optional)</div>
    <div id="cardio-list">${entries.map(e => renderCardioEntryBlock(e, session.id)).join('')}</div>
    <div class="card" id="add-cardio-row" style="margin-bottom:0.875rem;">
      <label class="field-label">Add Cardio</label>
      <select class="field-input" id="cardio-activity-select" onchange="handleAddCardio(this)">
        <option value="" selected disabled>Choose an activity…</option>
        ${Object.keys(CARDIO_ACTIVITIES).map(a => `<option value="${a}">${a}</option>`).join('')}
      </select>
    </div>`;
}

function renderCardioEntryBlock(entry, sessionId) {
  const def = CARDIO_ACTIVITIES[entry.activity];
  if (!def) return '';
  const fields = def.fields.map(f => {
    const label = f === 'distance' ? (def.distanceLabel || 'Distance') : CARDIO_FIELD_LABELS[f];
    return `<div class="field-group">
      <label class="field-label">${label}</label>
      <input type="number" step="0.1" class="field-input" id="cardio-${entry.id}-${f}" oninput="saveDraft('${sessionId}')" />
    </div>`;
  }).join('');
  const presets = def.presets ? `<div class="variation-toggle" style="margin-top:6px;">
      ${def.presets.map(p => `<button class="var-btn" type="button" onclick="setCardioPreset(${entry.id}, ${p}, '${sessionId}')">${p}m</button>`).join('')}
    </div>` : '';
  return `<div class="card cardio-block" id="cardio-block-${entry.id}" style="margin-bottom:0.875rem;">
    <div class="ex-name-row">
      <div class="ex-name-display">${entry.activity}</div>
      <button class="ex-remove-btn" onclick="removeCardioEntry(${entry.id})" aria-label="Remove cardio entry" title="Remove">✕</button>
    </div>
    <div style="display:grid; grid-template-columns:repeat(${def.fields.length}, 1fr); gap:8px; margin-top:8px;">${fields}</div>
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
  // Open Workout's exercise list is per-workout, not a fixed template — remember which ones were
  // added so a refresh mid-session doesn't lose a block that hasn't been Mark Done'd (and saved) yet.
  if (selectedSession.id === 'open') draft.openExercises = selectedSession.exercises.map(e => e.name);
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
    const filteredPrev = (previousSets[exName] || []).filter(p => p.variation === variation);
    const prevText = filteredPrev.length > 0
      ? filteredPrev.map(s => `${s.weight}×${s.reps}`).join(' / ')
      : 'No previous data';
    const prevEl = document.getElementById(`prev-${exName}`);
    if (prevEl) prevEl.textContent = `Previous (${variation}): ${prevText}`;
    for (let i = 1; i <= ex.sets; i++) {
      const badge = document.getElementById(`badge-${exName}-${i}`);
      const set = filteredPrev[i-1];
      if (badge) badge.textContent = set ? `${set.weight}×${set.reps}` : '—';
    }
  }
}

// ─── COMPLETE EXERCISE ────────────────────────────────────
async function completeExercise(exName) {
  if (!selectedSession) return;
  const ex = selectedSession.exercises.find(e => e.name === exName);
  if (!ex) return;

  const sets = [];
  for (let i = 1; i <= ex.sets; i++) {
    const wEl = document.getElementById(`w-${exName}-${i}`);
    const rEl = document.getElementById(`r-${exName}-${i}`);
    const wVal = wEl ? (wEl.tagName === 'DIV' ? wEl.textContent : wEl.value) : '';
    const rVal = rEl ? rEl.value : '';
    if (wVal || rVal) {
      const isBodyweight = ex.bodyweight || ex.band;
      const setObj = {
        workout_id: currentWorkoutId,
        exercise: exName,
        set_number: i,
        weight: isBodyweight ? null : (wVal || null),
        reps: parseInt(rVal) || null,
        variation: selectedVariations[exName] || null
      };
      const restSecs = (pendingRest[exName] && pendingRest[exName][i]) ? pendingRest[exName][i] : 0;
      if (restSecs > 0) swPaintRestLine(exName, i, restSecs);
      setObj.rest_seconds = restSecs;
      sets.push(setObj);
    }
  }

  if (sets.length === 0) {
    showToast('Fill in at least one set first', 'error');
    return;
  }

  if (!currentWorkoutId) {
    showToast('Session error — go back and re-select the workout', 'error');
    return;
  }

  await fetch(`${SUPABASE_URL}/rest/v1/workout_sets?workout_id=eq.${currentWorkoutId}&exercise=eq.${encodeURIComponent(exName)}`, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });

  const saveRes = await sb('workout_sets', 'POST', sets);
  if (!saveRes.ok) {
    showToast(`Save failed (${saveRes.status}) — tap Mark Done again`, 'error');
    return;
  }
  currentWorkoutHasSets = true;

  const block = document.getElementById(`block-${exName}`);
  if (block) block.style.borderColor = 'var(--green)';
  const doneBtn = document.getElementById(`done-btn-${exName}`);
  if (doneBtn) {
    doneBtn.textContent = '✓ Done';
    doneBtn.style.borderColor = 'var(--green)';
    doneBtn.style.color = 'var(--green)';
  }

  showToast(`${exName} saved!`, 'success');
  lastCompletedExercise = exName;
  if (pendingRest[exName]) delete pendingRest[exName];
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
    fetch(`${SUPABASE_URL}/rest/v1/workouts?id=eq.${currentWorkoutId}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
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
function collectCardioRows() {
  const rows = [];
  (selectedSession?.cardioEntries || []).forEach(e => {
    const def = CARDIO_ACTIVITIES[e.activity];
    if (!def) return;
    const row = { workout_id: currentWorkoutId, activity: e.activity };
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
  const notes = document.getElementById('workout-notes')?.value || '';
  const cardioRows = collectCardioRows();
  if (cardioRows.length) await sb('cardio_logs', 'POST', cardioRows);
  await fetch(`${SUPABASE_URL}/rest/v1/workouts?id=eq.${currentWorkoutId}`, {
    method: 'PATCH',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes, completed_at: new Date().toISOString() })
  });
  showToast('Workout saved!', 'success');
  localStorage.removeItem('workout_draft');
  currentWorkoutHasSets = false;
  currentWorkoutId = null;
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

  await sb('conditioning_logs', 'POST', {
    date: todayStr(),
    activity,
    duration_mins: duration,
    notes: summary
  });

  const workoutId = await createWorkoutRow('cv-pump');
  if (workoutId) {
    await fetch(`${SUPABASE_URL}/rest/v1/workouts?id=eq.${workoutId}`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: summary, completed_at: new Date().toISOString() })
    });
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
  if (existing && existing.length > 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/daily_logs?date=eq.${date}`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } else {
    await sb('daily_logs', 'POST', data);
  }
  showToast(date === todayStr() ? 'Check-in saved!' : `Check-in saved for ${date}!`, 'success');
}

function setEnergy(val) {
  selectedEnergy = val;
  document.querySelectorAll('.energy-btn').forEach(b => {
    b.classList.toggle('selected', parseInt(b.dataset.val) === val);
  });
}

// ─── STATS ────────────────────────────────────────────────
async function loadStats() {
  const fourteenAgo = new Date(); fourteenAgo.setDate(fourteenAgo.getDate() - 14);
  const fourteenAgoStr = fourteenAgo.toISOString().split('T')[0];
  const [latest, weightLogs, recentLogs, allWorkouts, recent] = await Promise.all([
    sb(`daily_logs?order=date.desc&limit=1&select=weight_kg`),
    sb(`daily_logs?date=gte.${fourteenAgoStr}&order=date.asc&select=date,weight_kg`),
    sb(`daily_logs?date=gte.${fourteenAgoStr}&order=date.asc&select=date,fasting_hours,steps`),
    sb(`workouts?date=gte.${fourteenAgoStr}&order=date.asc&select=date,session_type`),
    sb(`workouts?order=date.desc&limit=5&select=date,session_type,notes`)
  ]);

  if (latest && latest[0]?.weight_kg) {
    document.getElementById('stat-weight').innerHTML = `${latest[0].weight_kg}<span class="stat-unit">kg</span>`;
  }
  const weekSessions = (allWorkouts || []).filter(w => w.date >= getWeekStart());
  document.getElementById('stat-sessions').textContent = weekSessions.length;

  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = weekAgo.toISOString().split('T')[0];
  const recentWeekLogs = (recentLogs || []).filter(l => l.date >= weekAgoStr);
  const fv = recentWeekLogs.filter(l => l.fasting_hours).map(l => l.fasting_hours);
  const sv = recentWeekLogs.filter(l => l.steps).map(l => l.steps);
  if (fv.length) document.getElementById('stat-fasting').innerHTML = `${(fv.reduce((a,b)=>a+b,0)/fv.length).toFixed(1)}<span class="stat-unit">hrs</span>`;
  if (sv.length) document.getElementById('stat-steps').textContent = Math.round(sv.reduce((a,b)=>a+b,0)/sv.length).toLocaleString();

  statsData = {
    weight: weightLogs || [],
    fasting: recentLogs || [],
    steps: recentLogs || [],
    sessions: allWorkouts || []
  };
  switchChart(currentChartType);

  const rw = document.getElementById('recent-workouts');
  if (!recent || recent.length === 0) { rw.innerHTML = '<div class="empty">No workouts logged yet</div>'; return; }
  rw.innerHTML = recent.map(w => {
    return `<div class="history-item">
      <div class="history-date">${new Date(w.date).toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'short'})}</div>
      <div class="history-title">${sessionDisplayName(w.session_type)}</div>
      ${w.notes ? `<div style="font-size:12px;color:var(--muted);margin-top:3px;">${w.notes}</div>` : ''}
    </div>`;
  }).join('');
}

// ─── CHART SWITCHER ───────────────────────────────────────
function switchChart(type) {
  currentChartType = type;
  document.querySelectorAll('.stat-card').forEach(t => t.classList.remove('active'));
  document.getElementById(`tile-${type}`).classList.add('active');
  if (mainChart) { mainChart.destroy(); mainChart = null; }
  const wrap = document.querySelector('.chart-wrap');
  if (!wrap) return;
  if (!wrap.querySelector('canvas')) {
    wrap.innerHTML = '<canvas id="main-chart" role="img"></canvas>';
  }

  let labels = [], data = [], color = '#e85d2f', chartType = 'line', yCallback = v => v;

  if (type === 'weight') {
    const d = statsData.weight || [];
    if (d.length === 0) { wrap.innerHTML = '<div class="empty">No weight data yet</div>'; document.getElementById('chart-title').textContent = 'Weight Trend (last 14 days)'; return; }
    labels = d.map(x => new Date(x.date).toLocaleDateString('en-GB', {day:'numeric', month:'short'}));
    data = d.map(x => x.weight_kg);
    color = '#e85d2f'; yCallback = v => v + 'kg';
    document.getElementById('chart-title').textContent = 'Weight Trend (last 14 days)';
  } else if (type === 'sessions') {
    const d = statsData.sessions || [];
    if (d.length === 0) { wrap.innerHTML = '<div class="empty">No session data yet</div>'; document.getElementById('chart-title').textContent = 'Sessions (last 14 days)'; return; }
    const byDate = {};
    d.forEach(w => { byDate[w.date] = (byDate[w.date] || 0) + 1; });
    labels = Object.keys(byDate).map(x => new Date(x).toLocaleDateString('en-GB', {day:'numeric', month:'short'}));
    data = Object.values(byDate);
    color = '#4caf7d'; chartType = 'bar';
    document.getElementById('chart-title').textContent = 'Sessions (last 14 days)';
  } else if (type === 'fasting') {
    const d = (statsData.fasting || []).filter(x => x.fasting_hours);
    if (d.length === 0) { wrap.innerHTML = '<div class="empty">No fasting data yet</div>'; document.getElementById('chart-title').textContent = 'Fasting Hours (last 14 days)'; return; }
    labels = d.map(x => new Date(x.date).toLocaleDateString('en-GB', {day:'numeric', month:'short'}));
    data = d.map(x => x.fasting_hours);
    color = '#4a9eff'; yCallback = v => v + 'h';
    document.getElementById('chart-title').textContent = 'Fasting Hours (last 14 days)';
  } else if (type === 'steps') {
    const d = (statsData.steps || []).filter(x => x.steps);
    if (d.length === 0) { wrap.innerHTML = '<div class="empty">No steps data yet</div>'; document.getElementById('chart-title').textContent = 'Steps (last 14 days)'; return; }
    labels = d.map(x => new Date(x.date).toLocaleDateString('en-GB', {day:'numeric', month:'short'}));
    data = d.map(x => x.steps);
    color = '#f0a050'; yCallback = v => v >= 1000 ? (v/1000).toFixed(1) + 'k' : v;
    document.getElementById('chart-title').textContent = 'Steps (last 14 days)';
  }

  mainChart = new Chart(document.getElementById('main-chart'), {
    type: chartType,
    data: {
      labels,
      datasets: [{
        data,
        borderColor: color,
        backgroundColor: chartType === 'bar' ? color + '99' : color + '1a',
        borderWidth: 2,
        pointBackgroundColor: color,
        pointRadius: chartType === 'line' ? 4 : 0,
        fill: chartType === 'line',
        tension: 0.3,
        borderRadius: chartType === 'bar' ? 4 : 0
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#666', font: { size: 10 }, maxRotation: 45 }, grid: { color: '#222' } },
        y: { ticks: { color: '#666', font: { size: 10 }, callback: yCallback }, grid: { color: '#222' } }
      }
    }
  });
}

// ─── HISTORY ─────────────────────────────────────────────
let historyPage = 1;
let historyTab = 'all';
let historyDateRange = 'all';
let historyWorkoutFilter = 'all';
let historySearchTerm = '';
let allHistoryLogs = [];
let allHistoryWorkouts = [];

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
const allSets = workoutIds.length
  ? await sb(`workout_sets?workout_id=in.(${workoutIds})&select=workout_id,exercise,weight,reps&order=weight.desc`)
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
  return startDate.toISOString().split('T')[0];
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
          `<option value="${s.id}" ${historyWorkoutFilter === s.id ? 'selected' : ''}>${s.name}</option>`
        ).join('')}
        <option value="open" ${historyWorkoutFilter === 'open' ? 'selected' : ''}>Open Workout</option>
      </select>
    </div>

    <input type="text" class="history-search" id="history-search-input" placeholder="Search notes..." value="${historySearchTerm.replace(/"/g,'&quot;')}" oninput="setHistorySearch(this.value)" />
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

  Object.keys(byDate).sort((a, b) => b.localeCompare(a)).forEach(date => {
    const dateStr = new Date(date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    html += `<div class="history-date-group"><div class="history-date-header">${dateStr}</div>`;

    byDate[date].forEach(item => {
      if (item.type === 'log') {
        const l = item.data;
        html += `<div class="history-card" onclick="openEditLog(${JSON.stringify(l).replace(/"/g,'&quot;')})">
          <div class="history-card-label">Daily Check-in</div>
          <div class="history-stats">
            ${l.weight_kg ? `<span class="pill pill-reps">${l.weight_kg}kg</span>` : ''}
            ${l.calories ? `<span class="pill pill-cals">${l.calories} kcal</span>` : ''}
            ${l.steps ? `<span class="pill pill-rest">${l.steps.toLocaleString()} steps</span>` : ''}
            ${l.protein_g ? `<span class="pill pill-reps">${l.protein_g}g protein</span>` : ''}
            ${l.carbs_g ? `<span class="pill pill-sets">${l.carbs_g}g carbs</span>` : ''}
            ${l.fat_g ? `<span class="pill pill-cals">${l.fat_g}g fat</span>` : ''}
            ${l.fibre_g ? `<span class="pill pill-rest">${l.fibre_g}g fibre</span>` : ''}
            ${l.energy ? `<span style="font-size:16px;">${['','😴','😑','🙂','😤','🔥'][l.energy]}</span>` : ''}
          </div>
          ${l.notes ? `<div class="history-card-notes">${l.notes}</div>` : ''}
          
        </div>`;
      } else {
        const w = item.data;
        html += `<div class="history-card" onclick="openEditWorkout('${w.id}', '${w.session_type}', ${JSON.stringify(w.notes||'').replace(/"/g,'&quot;')})">
          <div class="history-workout-head">
<div class="history-card-label" style="color:var(--amber);">${sessionDisplayName(w.session_type)}</div>
            
            <span class="history-card-delete" onclick="event.stopPropagation();deleteWorkout('${w.id}')">Delete</span>
          </div>
          ${w.notes ? `<div class="history-card-notes">${w.notes}</div>` : ''}
${(() => {
  const sets = (window._setsByWorkout[w.id] || []).filter(s => s.weight);
  const seen = {};
  const top3 = [];
  for (const s of sets) {
    if (!seen[s.exercise]) { seen[s.exercise] = true; top3.push(s); }
    if (top3.length === 3) break;
  }
  return top3.length ? `<div style="font-size:11px;color:var(--muted2);margin-top:6px;">${top3.map(s => `${s.exercise} ${s.weight}×${s.reps}`).join(' / ')}</div>` : '';
})()}
${(() => {
  const cardio = window._cardioByWorkout[w.id] || [];
  return cardio.length ? `<div style="font-size:11px;color:var(--muted2);margin-top:4px;">${cardio.map(formatCardioEntry).join(' / ')}</div>` : '';
})()}

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
  if (name !== 'home' && currentWorkoutId && !currentWorkoutHasSets) {
    fetch(`${SUPABASE_URL}/rest/v1/workouts?id=eq.${currentWorkoutId}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
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
  if (name === 'today') loadDailyLog();
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
  document.querySelectorAll('#edit-energy-picker .energy-btn').forEach(b => {
    b.classList.toggle('selected', parseInt(b.dataset.val) === val);
  });
}

async function saveEditLog() {
  if (!editingLogDate) return;
  await fetch(`${SUPABASE_URL}/rest/v1/daily_logs?date=eq.${editingLogDate}`, {
    method: 'PATCH',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
    })
  });
  showToast('Updated!', 'success');
  closeEditLog();
  loadHistory();
}

// ─── EDIT WORKOUT MODAL ───────────────────────────────────
let editingWorkoutId = null;
let editingSessionType = null;

async function openEditWorkout(workoutId, sessionType, notes) {
  editingWorkoutId = workoutId;
  editingSessionType = sessionType;
  editSelectedVariations = {};
  document.getElementById('edit-workout-title').textContent = sessionDisplayName(sessionType);
  document.getElementById('edit-workout-notes').value = notes || '';

  const sets = await sb(`workout_sets?workout_id=eq.${workoutId}&order=set_number.asc&select=*`);
  const setsByExercise = {};
  (sets || []).forEach(set => {
    if (!setsByExercise[set.exercise]) setsByExercise[set.exercise] = [];
    setsByExercise[set.exercise].push(set);
  });

  // 'open' (Open Workout) isn't in SESSIONS — its exercise list is per-workout, so reconstruct it
  // from what was actually saved (same approach used to resume an in-progress Open Workout).
  const s = SESSIONS.find(s => s.id === sessionType) || reconstructSessionFromSets(sets);

  let html = '';
  if (s) {
    s.exercises.forEach(ex => {
      const exSets = setsByExercise[ex.name] || (ex.aliases || []).flatMap(a => setsByExercise[a] || []);
      const currentVariation = exSets[0]?.variation || (ex.variations ? ex.variations[0] : null);
      if (currentVariation) editSelectedVariations[ex.name] = currentVariation;

      html += `<div class="exercise-block" style="margin-bottom:0.75rem;">
        <div class="ex-name-display" style="margin-bottom:8px;">${ex.name}</div>`;

      if (ex.variations) {
        const defaultVar = currentVariation || ex.variations[0];
        html += `<div class="variation-toggle">`;
        ex.variations.forEach(v => {
          const isSel = v === defaultVar ? 'selected' : '';
          html += `<button class="var-btn ${isSel}" onclick="selectEditVariation('${ex.name}', '${v}', this)">${v}</button>`;
        });
        html += `</div>`;
      }

      for (let i = 1; i <= ex.sets; i++) {
        const existing = exSets.find(s => s.set_number === i);
        const prevHint = existing
          ? `${ex.band ? (existing.variation || 'B').split(' ').map(w => w[0]).join('') : (existing.weight ?? 'BW')}×${existing.reps}`
          : '—';
        const repPlaceholder = ex.name === 'Walking Lunge' ? 'steps' : 'reps';

        let weightCol = '';
        if (ex.bodyweight) {
          weightCol = `<div class="set-label" id="ew-${ex.name}-${i}">BW</div>`;
        } else if (ex.variations && ex.band) {
          const bandLabel = currentVariation || ex.variations[0];
          weightCol = `<div class="set-label" id="ew-${ex.name}-${i}">${bandLabel}</div>`;
        } else {
          weightCol = `<input type="text" class="set-input" id="ew-${ex.name}-${i}" placeholder="kg" value="${existing?.weight || ''}" />`;
        }

        html += `<div class="set-row">
          <div class="set-num">${i}</div>
          ${weightCol}
          <input type="number" class="set-input" id="er-${ex.name}-${i}" placeholder="${repPlaceholder}" value="${existing?.reps || ''}" />
          <div class="prev-badge">${prevHint}</div>
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
}

async function saveEditWorkout() {
  if (!editingWorkoutId) return;
  const notes = document.getElementById('edit-workout-notes').value || null;

  await fetch(`${SUPABASE_URL}/rest/v1/workouts?id=eq.${editingWorkoutId}`, {
    method: 'PATCH',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes })
  });

  const existingSets = await sb(`workout_sets?workout_id=eq.${editingWorkoutId}&select=*&order=exercise.asc,set_number.asc`);

  // 'open' (Open Workout) isn't in SESSIONS — reconstruct its exercise list from what's already saved,
  // same as openEditWorkout() does when building the form.
  const s = SESSIONS.find(s => s.id === editingSessionType) || reconstructSessionFromSets(existingSets);

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
        await fetch(`${SUPABASE_URL}/rest/v1/workout_sets?id=eq.${existingSet.id}`, {
          method: 'PATCH',
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            weight: (ex.bodyweight || ex.band) ? null : (wVal || null),
            reps: parseInt(rVal) || null,
            variation: editSelectedVariations[ex.name] || null
          })
        });
      } else if (wVal || rVal) {
        await sb('workout_sets', 'POST', {
          workout_id: editingWorkoutId,
          exercise: ex.name,
          set_number: i,
          weight: (ex.bodyweight || ex.band) ? null : (wVal || null),
          reps: parseInt(rVal) || null,
          variation: editSelectedVariations[ex.name] || null
        });
      }
    }
  }
  showToast('Workout updated!', 'success');
  closeEditWorkout();
  loadHistory();
}

// ─── DELETE WORKOUT ───────────────────────────────────────
async function deleteWorkout(workoutId) {
  if (!confirm('Delete this workout?')) return;
  await fetch(`${SUPABASE_URL}/rest/v1/workout_sets?workout_id=eq.${workoutId}`, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  await fetch(`${SUPABASE_URL}/rest/v1/workouts?id=eq.${workoutId}`, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
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

  // Save the rest to the last typed set for THIS exercise
  const target = swFindLastTypedSetForExercise(exName);
  if (target && elapsed > 0) {
    await swSaveRest(target.exName, target.setNum, elapsed);
    swPaintRestLine(target.exName, target.setNum, elapsed);
    swFlashWatch(exName);
    saveDraft(selectedSession?.id);   // persist rest to localStorage so it survives reload
  } else {
    swRenderWatch(exName);
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
      await fetch(`${SUPABASE_URL}/rest/v1/workout_sets?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rest_seconds: seconds })
      });
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