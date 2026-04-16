const SUPABASE_URL = 'https://mltikqmwwlgyzogrgemr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2BQBFSox7bL1X2TlSlbOYA_hn8FcPmy';

const SESSIONS = [
  {
    id: 'upper-a', day: 'Monday', name: 'Upper A', focus: 'Push focus',
    exercises: [
      { name: 'Smith Machine Incline Press', sets: 3, reps: '6–10', rest: '180s', note: 'Start lighter than you think' },
      { name: 'Machine Chest Press', sets: 3, reps: '8–12', rest: '90s' },
      { name: 'Machine Shoulder Press', sets: 3, reps: '8–12', rest: '90s' },
      { name: 'Lateral Raise', sets: 3, reps: '12–15', rest: '60s', note: 'DB or machine' },
      { name: 'Overhead Cable Tricep Ext', sets: 3, reps: '10–15', rest: '60s' },
      { name: 'Tricep Pushdown', sets: 3, reps: '12–15', rest: '60s', note: 'Rope — neutral grip' },
    ]
  },
  {
    id: 'lower-a', day: 'Tuesday', name: 'Lower A', focus: 'Quad focus + core',
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
    id: 'upper-b', day: 'Thursday', name: 'Upper B', focus: 'Pull focus',
    exercises: [
      { name: 'Lat Pulldown', sets: 3, reps: '8–12', rest: '90s', note: 'Neutral grip' },
      { name: 'Chest Supported Row', sets: 3, reps: '8–12', rest: '90s' },
      { name: 'Seated Cable Row', sets: 3, reps: '10–12', rest: '75s' },
      { name: 'Face Pull', sets: 3, reps: '12–15', rest: '60s', note: "Don't skip this" },
      { name: 'Straight Arm Pulldown', sets: 3, reps: '12–15', rest: '60s' },
      { name: 'Hammer Curl', sets: 3, reps: '10–12', rest: '75s', note: '12 reps each side/arm — neutral grip' },
      { name: 'Incline Single Cable Curl', sets: 3, reps: '12–15', rest: '60s' },
    ]
  },
  {
    id: 'lower-b', day: 'Friday', name: 'Lower B', focus: 'Posterior chain + core',
    exercises: [
      { name: 'Smith RDL', sets: 3, reps: '6–10', rest: '120s', note: 'Hernia safe' },
      { name: 'Leg Press', sets: 3, reps: '8–12', rest: '180s', note: 'Higher feet — glute bias' },
      { name: 'Leg Curl', sets: 3, reps: '10–12', rest: '60s' },
      { name: 'Hip Thrust Machine', sets: 3, reps: '10–15', rest: '75s', note: 'If available' },
      { name: 'Seated Calf Raise', sets: 3, reps: '8–12', rest: '60s' },
      { name: 'Dead Bug', sets: 3, reps: '10 each', rest: '45s', note: 'Core — hernia safe', bodyweight: true },
      { name: 'Cable Woodchop', sets: 3, reps: '12 each', rest: '45s', note: 'Core — hernia safe' },
    ]
  },
  { id: 'conditioning', day: 'Saturday', name: 'Conditioning', focus: 'Wild card' }
];

let selectedEnergy = 0;
let selectedSession = null;
let previousSets = {};
let selectedVariations = {};
let editSelectedVariations = {};
let mainChart = null;
let currentChartType = 'weight';
let statsData = {};
let currentPage = 'home';
let currentWorkoutId = null;
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
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    initApp();
  } else {
    document.getElementById('login-error').style.display = 'block';
  }
}

function handleLogout() {
  sessionStorage.clear();
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleLogin();
});

window.addEventListener('load', () => {
  if (sessionStorage.getItem('del_auth')) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    const savedPage = sessionStorage.getItem('del_page') || 'home';
    initApp(savedPage);
  }
});

// ─── INIT ─────────────────────────────────────────────────
function initApp(page = 'home') {
  const now = new Date();
  document.getElementById('topbar-date').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  buildSessionGrid();
  loadTodayLog();
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

  if (!document.getElementById('home-week-strip').hasChildNodes()) {
    buildWeekStrip('home-week-strip');
  }
}

function getWeekStart() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().split('T')[0];
}

// ─── WEEK STRIP ───────────────────────────────────────────
async function buildWeekStrip(containerId = 'home-week-strip') {
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const today = new Date();
  const dow = today.getDay();
  const strip = document.getElementById(containerId);
  if (!strip) return;
  strip.innerHTML = '';

  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - dow + i);
    weekDates.push(d.toISOString().split('T')[0]);
  }

  const workouts = await sb(`workouts?date=gte.${weekDates[0]}&date=lte.${weekDates[6]}&select=date`);
  const doneDates = new Set((workouts || []).map(w => w.date));
  const restDays = [0, 3];

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

// ─── SESSION GRID ─────────────────────────────────────────
async function buildSessionGrid() {
  const grid = document.getElementById('session-grid');
  grid.innerHTML = '';
  const todayWorkouts = await sb(`workouts?date=eq.${todayStr()}&select=session_type`);
  const doneTodaySessions = new Set((todayWorkouts || []).map(w => w.session_type));

  SESSIONS.forEach(s => {
    const btn = document.createElement('div');
    btn.className = 'session-btn';
    btn.id = `session-btn-${s.id}`;
    if (doneTodaySessions.has(s.id)) btn.classList.add('done');
    btn.innerHTML = `<div class="session-day">${s.day}</div><div class="session-name">${s.name}</div><div class="session-focus">${s.focus}</div>${doneTodaySessions.has(s.id) ? '<div style="font-size:10px;color:var(--green);margin-top:4px;">✓ logged today</div>' : ''}`;
    btn.onclick = () => selectSession(s, btn);
    grid.appendChild(btn);
  });
}

async function selectSession(session, btn) {
  if (btn.classList.contains('done')) {
    if (!confirm(`You already logged ${session.name} today. Log again?`)) return;
  }

  // If switching session, delete previous empty workout
  if (currentWorkoutId) {
    const existingSets = await sb(`workout_sets?workout_id=eq.${currentWorkoutId}&select=id`);
    if (!existingSets || existingSets.length === 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/workouts?id=eq.${currentWorkoutId}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
    }
    currentWorkoutId = null;
  }

  selectedSession = session;
  selectedVariations = {};
  document.querySelectorAll('.session-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');

  if (session.id === 'conditioning') {
    document.getElementById('conditioning-form').style.display = 'block';
    document.getElementById('workout-logger').style.display = 'none';
    return;
  }

  // Create workout row immediately
  currentWorkoutId = null;

  document.getElementById('conditioning-form').style.display = 'none';
  document.getElementById('workout-logger').style.display = 'block';
  await buildWorkoutLogger(session);
}

// ─── WORKOUT LOGGER ───────────────────────────────────────
async function buildWorkoutLogger(session) {
  const logger = document.getElementById('workout-logger');
  logger.innerHTML = '<div class="loading">Loading previous lifts...</div>';

  const prevWorkouts = await sb(`workouts?session_type=eq.${session.id}&order=date.desc&limit=2&select=id,date`);
  previousSets = {};
  if (prevWorkouts && prevWorkouts.length > 0) {
    // Use the most recent workout that isn't the current one
    const prevWorkout = prevWorkouts.find(w => w.id !== currentWorkoutId);
    if (prevWorkout) {
      const prevSets = await sb(`workout_sets?workout_id=eq.${prevWorkout.id}&select=exercise,set_number,weight,reps,variation&order=set_number.asc`);
      (prevSets || []).forEach(s => {
        if (!previousSets[s.exercise]) previousSets[s.exercise] = [];
        previousSets[s.exercise].push({ weight: s.weight, reps: s.reps, variation: s.variation });
      });
    }
  }

  let html = '';
  session.exercises.forEach(ex => {
    const prev = previousSets[ex.name] || [];
    const prevVariation = prev[0]?.variation || '';
    const defaultVar = ex.variations ? (prevVariation || ex.variations[0]) : null;
    let filteredPrev = prev;
    if (ex.variations && !ex.band && defaultVar) {
      filteredPrev = prev.filter(p => p.variation === defaultVar);
      if (filteredPrev.length === 0) filteredPrev = prev;
    }
    const prevText = filteredPrev.length > 0
      ? filteredPrev.map(s => `${s.weight}×${s.reps}`).join(' / ')
      : 'No previous data';

    html += `<div class="exercise-block" id="block-${ex.name}">
      <div class="ex-top">
        <div class="ex-name-display">${ex.name}</div>
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
      if (!ex.band) {
        html += `<div class="ex-prev" id="prev-${ex.name}">Previous (${defaultVar}): ${prevText}</div>`;
      }
    } else {
      html += `<div class="ex-prev">Previous: ${prevText}</div>`;
    }

    for (let i = 1; i <= ex.sets; i++) {
      const prevSet = filteredPrev[i-1];
      const prevHint = prevSet ? `${prevSet.weight}×${prevSet.reps}` : '—';
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
      </div>`;
    }

    html += `<button class="btn btn-outline btn-full" id="done-btn-${ex.name}" onclick="completeExercise('${ex.name}')" style="margin-top:8px;">Mark Done</button>`;
    html += `</div>`;
  });

  html += `<div class="field-group" style="margin-top:0.875rem;">
    <label class="field-label">Session Notes</label>
    <textarea class="field-input" id="workout-notes" placeholder="How did it go..." oninput="saveDraft('${session.id}')"></textarea>
  </div>
  <button class="btn btn-save btn-full" onclick="saveWorkout()" style="margin-bottom:1rem;">Save Workout</button>`;

  logger.innerHTML = html;
  restoreDraft(session);
}

// ─── DRAFT AUTO-SAVE ─────────────────────────────────────
function saveDraft(sessionId) {
  if (!selectedSession) return;
  const draft = { sessionId, sets: {}, notes: document.getElementById('workout-notes')?.value || '' };
  selectedSession.exercises.forEach(ex => {
    for (let i = 1; i <= ex.sets; i++) {
      const wEl = document.getElementById(`w-${ex.name}-${i}`);
      const rEl = document.getElementById(`r-${ex.name}-${i}`);
      const w = wEl && wEl.tagName === 'INPUT' ? wEl.value : null;
      const r = rEl ? rEl.value : null;
      if (w || r) draft.sets[`${ex.name}-${i}`] = { w, r };
    }
  });
  localStorage.setItem('workout_draft', JSON.stringify(draft));
}

function restoreDraft(session) {
  try {
    const raw = localStorage.getItem('workout_draft');
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (draft.sessionId !== session.id) return;
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
  if (!currentWorkoutId || !selectedSession) return;
  const ex = selectedSession.exercises.find(e => e.name === exName);
  if (!ex) return;

  const sets = [];
  for (let i = 1; i <= ex.sets; i++) {
    const wEl = document.getElementById(`w-${exName}-${i}`);
    const rEl = document.getElementById(`r-${exName}-${i}`);
    const wVal = wEl ? (wEl.tagName === 'DIV' ? wEl.textContent : wEl.value) : '';
    const rVal = rEl ? rEl.value : '';
    if (wVal || rVal) {
      sets.push({
        workout_id: currentWorkoutId,
        exercise: exName,
        set_number: i,
        weight: wVal || null,
        reps: parseInt(rVal) || null,
        variation: selectedVariations[exName] || null
      });
    }
  }

  if (sets.length === 0) {
    showToast('Fill in at least one set first', 'error');
    return;
  }

  if (!currentWorkoutId) {
    await sb('workouts', 'POST', { date: todayStr(), session_type: selectedSession.id, notes: '' });
    const created = await sb(`workouts?date=eq.${todayStr()}&session_type=eq.${selectedSession.id}&order=created_at.desc&limit=1&select=id`);
    if (created && created.length > 0) currentWorkoutId = created[0].id;
  }

  // Delete existing sets for this exercise first (in case of re-done)
  await fetch(`${SUPABASE_URL}/rest/v1/workout_sets?workout_id=eq.${currentWorkoutId}&exercise=eq.${encodeURIComponent(exName)}`, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });

  await sb('workout_sets', 'POST', sets);

  // Green visual on exercise block
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

// ─── SAVE WORKOUT ─────────────────────────────────────────
async function saveWorkout() {
  if (!selectedSession || !currentWorkoutId) return;
  const notes = document.getElementById('workout-notes')?.value || '';
  await fetch(`${SUPABASE_URL}/rest/v1/workouts?id=eq.${currentWorkoutId}`, {
    method: 'PATCH',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes })
  });
  showToast('Workout saved!', 'success');
  localStorage.removeItem('workout_draft');
  currentWorkoutId = null;
  buildSessionGrid();
  document.getElementById('workout-logger').style.display = 'none';
  document.getElementById('conditioning-form').style.display = 'none';
  document.querySelectorAll('.session-btn').forEach(b => b.classList.remove('selected'));
  selectedSession = null;
}

// ─── SAVE CONDITIONING ────────────────────────────────────
async function saveConditioning() {
  const activity = document.getElementById('cond-activity').value.trim();
  if (!activity) { showToast('Add an activity first', 'error'); return; }
  await sb('conditioning_logs', 'POST', {
    date: todayStr(),
    activity,
    duration_mins: parseInt(document.getElementById('cond-duration').value) || null,
    notes: document.getElementById('cond-notes').value || null
  });
  showToast('Conditioning logged!', 'success');
  ['cond-activity','cond-duration','cond-notes'].forEach(id => document.getElementById(id).value = '');
}

// ─── DAILY LOG ────────────────────────────────────────────
async function loadTodayLog() {
  document.getElementById('log-weight').value = '';
  document.getElementById('log-steps').value = '';
  document.getElementById('log-cals').value = '';
  document.getElementById('log-fasting').value = '';
  document.getElementById('log-notes').value = '';
  setEnergy(0);
  const logs = await sb(`daily_logs?date=eq.${todayStr()}&select=*`);
  if (logs && logs.length > 0) {
    const l = logs[0];
    if (l.weight_kg) document.getElementById('log-weight').value = l.weight_kg;
    if (l.steps) document.getElementById('log-steps').value = l.steps;
    if (l.calories) document.getElementById('log-cals').value = l.calories;
    if (l.fasting_hours) document.getElementById('log-fasting').value = l.fasting_hours;
    if (l.energy) setEnergy(l.energy);
    if (l.notes) document.getElementById('log-notes').value = l.notes;
  }
}

async function saveDailyLog() {
  const data = {
    date: todayStr(),
    weight_kg: parseFloat(document.getElementById('log-weight').value) || null,
    steps: parseInt(document.getElementById('log-steps').value) || null,
    calories: parseInt(document.getElementById('log-cals').value) || null,
    fasting_hours: parseFloat(document.getElementById('log-fasting').value) || null,
    energy: selectedEnergy || null,
    notes: document.getElementById('log-notes').value || null
  };
  const existing = await sb(`daily_logs?date=eq.${todayStr()}&select=id`);
  if (existing && existing.length > 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/daily_logs?date=eq.${todayStr()}`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } else {
    await sb('daily_logs', 'POST', data);
  }
  showToast('Check-in saved!', 'success');
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
    const s = SESSIONS.find(s => s.id === w.session_type);
    return `<div class="history-item">
      <div class="history-date">${new Date(w.date).toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'short'})}</div>
      <div class="history-title">${s ? s.name : w.session_type}</div>
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
async function loadHistory() {
  const list = document.getElementById('history-list');
  list.innerHTML = '<div class="loading">Loading...</div>';
  const [logs, workouts] = await Promise.all([
    sb(`daily_logs?order=date.desc&limit=30&select=*`),
    sb(`workouts?order=date.desc&limit=30&select=id,date,session_type,notes`)
  ]);
  if ((!logs || logs.length === 0) && (!workouts || workouts.length === 0)) {
    list.innerHTML = '<div class="empty">No logs yet — start tracking today</div>';
    return;
  }
  const workoutsByDate = {};
  (workouts || []).forEach(w => {
    if (!workoutsByDate[w.date]) workoutsByDate[w.date] = [];
    workoutsByDate[w.date].push(w);
  });
  const allDates = [...new Set([
    ...(logs || []).map(l => l.date),
    ...(workouts || []).map(w => w.date)
  ])].sort((a, b) => b.localeCompare(a));
  const logsByDate = {};
  (logs || []).forEach(l => logsByDate[l.date] = l);

  list.innerHTML = allDates.map(date => {
    const l = logsByDate[date];
    const ws = workoutsByDate[date] || [];
    const dateStr = new Date(date).toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long'});
    let html = `<div style="margin-bottom:1rem;">`;
    html += `<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">${dateStr}</div>`;
    if (l) {
      html += `<div class="history-item" style="cursor:pointer;margin-bottom:6px;" onclick="openEditLog(${JSON.stringify(l).replace(/"/g,'&quot;')})">
        <div class="history-stats">
          ${l.weight_kg ? `<span class="pill pill-reps">${l.weight_kg}kg</span>` : ''}
          ${l.calories ? `<span class="pill" style="background:rgba(240,160,80,0.15);color:var(--amber);">${l.calories} kcal</span>` : ''}
          ${l.fasting_hours ? `<span class="pill pill-sets">${l.fasting_hours}h fast</span>` : ''}
          ${l.steps ? `<span class="pill pill-rest">${l.steps.toLocaleString()} steps</span>` : ''}
          ${l.energy ? `<span style="font-size:16px;">${['','😴','😑','🙂','😤','🔥'][l.energy]}</span>` : ''}
        </div>
        ${l.notes ? `<div style="font-size:12px;color:var(--muted);margin-top:5px;">${l.notes}</div>` : ''}
        <div style="font-size:11px;color:var(--amber);margin-top:6px;">tap to edit</div>
      </div>`;
    }
    ws.forEach(w => {
      const s = SESSIONS.find(s => s.id === w.session_type);
      html += `<div class="history-item" style="margin-bottom:6px;cursor:pointer;" onclick="openEditWorkout('${w.id}', '${w.session_type}', ${JSON.stringify(w.notes||'').replace(/"/g,'&quot;')})">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="pill" style="background:rgba(232,93,47,0.15);color:var(--accent);">workout</span>
          <span style="font-size:14px;font-weight:600;">${s ? s.name : w.session_type}</span>
        </div>
        ${w.notes ? `<div style="font-size:12px;color:var(--muted);margin-top:5px;">${w.notes}</div>` : ''}
        <div style="display:flex;justify-content:space-between;margin-top:6px;">
          <span style="font-size:11px;color:var(--amber);">tap to edit</span>
          <span style="font-size:11px;color:var(--red);cursor:pointer;" onclick="event.stopPropagation();deleteWorkout('${w.id}')">delete</span>
        </div>
      </div>`;
    });
    html += `</div>`;
    return html;
  }).join('');
}

// ─── NAV ─────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');
  document.getElementById(`nav-${name}`)?.classList.add('active');
  currentPage = name;
  sessionStorage.setItem('del_page', name);
  if (name === 'home') loadHomePage();
  if (name === 'stats') loadStats();
  if (name === 'history') loadHistory();
  if (name === 'today') loadTodayLog();
showSwTrigger(name === 'workout');
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
  const s = SESSIONS.find(s => s.id === sessionType);
  document.getElementById('edit-workout-title').textContent = s ? s.name : sessionType;
  document.getElementById('edit-workout-notes').value = notes || '';

  const sets = await sb(`workout_sets?workout_id=eq.${workoutId}&order=set_number.asc&select=*`);
  const setsByExercise = {};
  (sets || []).forEach(set => {
    if (!setsByExercise[set.exercise]) setsByExercise[set.exercise] = [];
    setsByExercise[set.exercise].push(set);
  });

  let html = '';
  if (s) {
    s.exercises.forEach(ex => {
      const exSets = setsByExercise[ex.name] || [];
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
        const prevHint = existing ? `${existing.weight}×${existing.reps}` : '—';
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

  const s = SESSIONS.find(s => s.id === editingSessionType);
  if (!s) { showToast('Workout updated!', 'success'); closeEditWorkout(); loadHistory(); return; }

  const existingSets = await sb(`workout_sets?workout_id=eq.${editingWorkoutId}&select=*&order=exercise.asc,set_number.asc`);

  for (const ex of s.exercises) {
    for (let i = 1; i <= ex.sets; i++) {
      const wEl = document.getElementById(`ew-${ex.name}-${i}`);
      const rEl = document.getElementById(`er-${ex.name}-${i}`);
      if (!wEl || !rEl) continue;

      const wVal = wEl.tagName === 'DIV' ? wEl.textContent : wEl.value;
      const rVal = rEl.value;
      const existingSet = (existingSets || []).find(es => es.exercise === ex.name && es.set_number === i);

      if (existingSet) {
        await fetch(`${SUPABASE_URL}/rest/v1/workout_sets?id=eq.${existingSet.id}`, {
          method: 'PATCH',
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            weight: wVal || null,
            reps: parseInt(rVal) || null,
            variation: editSelectedVariations[ex.name] || null
          })
        });
      } else if (wVal || rVal) {
        await sb('workout_sets', 'POST', {
          workout_id: editingWorkoutId,
          exercise: ex.name,
          set_number: i,
          weight: wVal || null,
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
  buildSessionGrid();
  loadHistory();
}

// ─── TOAST ────────────────────────────────────────────────
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.className = 'toast', 2500);
}

// ─── STOPWATCH ────────────────────────────────────────────
let swInterval = null;
let swSeconds = 0;
let swRunning = false;
let swPanelOpen = false;

function swFormat(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function swUpdateDisplay() {
  const display = document.getElementById('sw-display');
  const triggerTime = document.getElementById('sw-trigger-time');
  const formatted = swFormat(swSeconds);
  if (display) display.textContent = formatted;
  if (triggerTime) triggerTime.textContent = formatted;
}

function swStart() {
  const display = document.getElementById('sw-display');
  const label = document.getElementById('sw-label');
  const btn = document.getElementById('sw-start-btn');
  const bar = document.getElementById('sw-bar');
  const saved = document.getElementById('sw-saved');

  if (swRunning) {
    clearInterval(swInterval);
    swInterval = null;
    swRunning = false;
    if (display) { display.classList.remove('running'); display.classList.add('stopped'); }
    if (label) label.textContent = 'rest time';
    if (btn) { btn.className = 'sw-play-btn'; btn.innerHTML = '<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21" fill="#fff"/></svg>'; }
    if (bar) bar.classList.remove('running');
    swSaveToLastSet();
  } else {
    swRunning = true;
    if (display) { display.classList.add('running'); display.classList.remove('stopped'); }
    if (label) label.textContent = 'resting...';
    if (btn) { btn.className = 'sw-play-btn stop'; btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" fill="#fff"/></svg>'; }
    if (saved) saved.textContent = '';
    if (bar) bar.classList.add('running');
    swInterval = setInterval(() => { swSeconds++; swUpdateDisplay(); }, 1000);
  }
}

function swReset() {
  clearInterval(swInterval);
  swInterval = null;
  swRunning = false;
  swSeconds = 0;
  swUpdateDisplay();
  const display = document.getElementById('sw-display');
  const label = document.getElementById('sw-label');
  const btn = document.getElementById('sw-start-btn');
  const saved = document.getElementById('sw-saved');
  const bar = document.getElementById('sw-bar');
  if (display) { display.classList.remove('running', 'stopped'); }
  if (label) label.textContent = 'Ready';
  if (btn) { btn.className = 'sw-play-btn'; btn.innerHTML = '<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21" fill="#fff"/></svg>'; }
  if (saved) saved.textContent = '';
  if (bar) bar.classList.remove('running');
}

async function swSaveToLastSet() {
  if (!currentWorkoutId || !lastCompletedExercise) return;
  const saved = document.getElementById('sw-saved');
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/workout_sets?workout_id=eq.${currentWorkoutId}&exercise=eq.${encodeURIComponent(lastCompletedExercise)}&order=set_number.desc&limit=1`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ rest_seconds: swSeconds })
    });
    if (saved) saved.textContent = `✓ ${swFormat(swSeconds)} saved`;
  } catch(e) {
    if (saved) saved.textContent = 'save failed';
  }
}


function showSwTrigger(visible) {
  const trigger = document.getElementById('sw-trigger');
  if (trigger) trigger.classList.toggle('visible', visible);
}
