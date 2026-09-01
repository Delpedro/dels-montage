// How the app opens — E19, 28 August 2026.
//
// Del: "the home page opens a little slow now, like a jump on the screen... it just doesnt open like
// a real app - its not smooth". The cause was never slow SQL. It was that loadHomePage() sent its
// requests in THREE sequential waves — the daily quote first, on its own, awaited ahead of every
// number on the screen — and then let each wave shove the page down as it landed.
//
// Fixing that was not enough, and the second report is the more important one: "the good afternoon
// del and the next up programme takes at least 2/3 seconds to load in". The greeting is one column
// of one row and does no fetching of its own, so a two-second greeting could only mean the delay
// was BEFORE Home ever ran — and it was. initApp() waited on four round trips one after another
// (stale-workout housekeeping, templates, exercise library, profile) while enterApp() had already
// put Home on the screen. Section 6 covers that boot order, and it is the same class of bug as the
// first five: independent reads made to queue.
//
// That makes this file's subject the SHAPE of the load, not the values, and there are only two ways
// for the fix to rot back into what it was, both invisible in a browser on a fast connection:
//
//   1. Someone writes a new read and puts an `await` in front of it. The page still shows the right
//      numbers, just one round trip later — which is exactly how the seven-day window and the week
//      strip came to sit behind the first batch in the first place.
//   2. Someone reaches for a fetch that has already been made. `sessions this week` and the week
//      strip are the same question about the same week, and asking it twice put the bottom of Home
//      a whole round trip behind the top of it.
//
// So the assertions below are on the request TIMELINE: what has been sent before anything has come
// back. A test that only checked the final DOM would pass just as happily against the version Del
// complained about.
//
// Run: node tests/home-load.test.js

const { load } = require('./extract');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  FAIL: ${label}`);
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// Lets every already-queued microtask run. A macrotask, so anything the code under test can do
// without the network has definitely happened by the time this resolves — while every stubbed
// request is still outstanding.
const settle = () => new Promise(r => setTimeout(r, 0));

function el() {
  const node = {
    style: {}, textContent: '', innerHTML: '', className: '', children: [],
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    appendChild(c) { node.children.push(c); return c; }
  };
  return node;
}

function fakeDom() {
  const els = {};
  const get = id => (els[id] ||= el());
  return { els, get, document: { getElementById: get, createElement: () => el() } };
}

async function main() {
  console.log('Home page load');

  // ── 1. One wave, and the quote is not holding it up ─────────────────────────────────────────
  const dom = fakeDom();
  const sent = [];            // every request path, in the order it went out
  const answered = [];        // the resolvers, held back so nothing lands until we say so
  const req = path => { sent.push(path); return new Promise(r => answered.push(() => r([]))); };

  let stripArgs = null;
  let cached = {};   // what Home writes to disk for the next launch to paint from
  const app = load({
    functions: ['loadHomePage', 'sevenDayWindow', 'dateStr'],
    deps: {
      document: dom.document,
      APP_BUILD: 'test-build',
      sb: req,
      // Recorded as a request of its own, because that is what it is: the point of this test is how
      // many round trips are outstanding at once, not which helper wraps them.
      realWorkoutsBetween: from => req(`workouts?date=gte.${from}`),
      buildWeekStrip: (id, rows) => { stripArgs = { id, rows }; },
      getWeekStart: () => '2026-08-24',
      getGreeting: () => 'Good morning, Del',
      claimRestAlertsFlag: () => {}, restAlertsDeviceAccount: () => null, paintRestAlertsButton: () => {},
      reconcileRestAlerts: () => {}, ensureRestAlertArmed: () => {}, renderBackupPrompt: () => {}, syncBackupState: () => {},
      renderNextUp: () => {}, renderDailyQuote: () => req('quotes?select=quote,author&order=id'),
      writeHomeCache: patch => { cached = { ...cached, ...patch }; },
      // No cache in this section, so the empty stubbed answers take the ordinary path rather than
      // the offline guard. That guard has section 9 to itself.
      readHomeCache: () => null,
      sessionDisplayName: t => ({ 'upper-a': 'Upper A' }[t] || t),
    }
  });

  const open = app.loadHomePage();
  await settle();

  // THE ASSERTION THIS FILE EXISTS FOR. Nothing has been answered yet, so everything already sent
  // was sent without waiting on anything else.
  const dataReads = sent.filter(p => !p.startsWith('quotes'));
  eq(dataReads.length, 3, 'all three data reads are in flight before a single one has answered');
  ok(sent.some(p => p.startsWith('daily_logs?order=date.desc')), 'the latest weight is one of them');
  ok(sent.some(p => p.startsWith('workouts?date=gte.')), "this week's workouts is one of them");
  ok(sent.some(p => p.includes('select=steps,weight_kg,calories')), 'the seven-day window is one of them');

  // The quote goes out as well — nothing is behind it. Under the old code this was the ONLY entry
  // in `sent` at this point and the three reads above were queued behind its answer.
  eq(sent[0], 'quotes?select=quote,author&order=id',
     'the quote still goes out first — it is un-awaited, not deprioritised');

  // The dead request: it selected today's steps into a variable nothing read, and had done since
  // 14 Aug, when AVG STEPS moved onto the rolling window.
  ok(!sent.some(p => p.includes('date=eq.')), "today's-steps request is gone, not merely unread");

  // The heading is arithmetic on today's date. It must not arrive on network time.
  ok(/^Last 7 days · /.test(dom.get('home-avg-window').textContent),
     'the seven-day heading is printed before the answers arrive, not after');

  // ── 2. The week strip is handed the rows, not sent for its own ──────────────────────────────
  answered.forEach(r => r());
  await open;

  eq(sent.filter(p => p.startsWith('workouts?date=gte.')).length, 1,
     'the week is fetched once, not once for the tile and again for the strip');
  ok(stripArgs && Array.isArray(stripArgs.rows),
     'and buildWeekStrip is handed those rows rather than left to fetch them');
  eq(stripArgs && stripArgs.id, 'home-week-strip', 'into the Home strip');

  // ── 3. The quote paints into space that is already reserved ─────────────────────────────────
  {
    const d = fakeDom();
    d.get('daily-quote').classList.add('is-pending');
    const q = load({
      functions: ['renderDailyQuote'],
      deps: {
        document: d.document, dayIndex: () => 0, todayStr: () => '2026-08-28', writeHomeCache: () => {},
        sb: async () => [{ quote: 'Discipline is doing what needs to be done', author: 'Anon' }]
      }
    });
    await q.renderDailyQuote();
    eq(d.get('quote-text').textContent, '"Discipline is doing what needs to be done"', 'the quote is painted');
    eq(d.get('quote-author').textContent, '— Anon', 'with its author');
    ok(!d.get('daily-quote').classList.contains('is-pending'), 'and the block becomes visible');
    // `display` is never touched now. The block is in the layout from the first frame, and putting
    // it back on display:none is precisely what would reintroduce the jump.
    eq(d.get('daily-quote').style.display, undefined, 'display is left alone — the CSS owns the box');
  }
  {
    // sb() answers [] on a failed GET as well as on an empty table. Nothing is painted and the
    // reserved space stays empty: no "Loading…" stuck on screen, and no jump either.
    const d = fakeDom();
    d.get('daily-quote').classList.add('is-pending');
    const q = load({
      functions: ['renderDailyQuote'],
      deps: { document: d.document, dayIndex: () => 0, todayStr: () => '2026-08-28', writeHomeCache: () => {}, sb: async () => [] }
    });
    await q.renderDailyQuote();
    eq(d.get('quote-text').textContent, '', 'a failed quote fetch paints nothing');
    ok(d.get('daily-quote').classList.contains('is-pending'), 'and leaves the block invisible');
  }

  // ── 4. Next up gives its reserved height back when it has nothing to offer ──────────────────
  {
    const d = fakeDom();
    d.get('next-up').classList.add('is-pending');
    const n = load({
      functions: ['renderNextUp'],
      decls: ['nextUpSession', 'cachedNextUpId'],
      deps: {
        document: d.document, todayStr: () => '2026-08-28',
        takeBootNextUpRows: () => null, fetchNextUpRows: async () => [], writeHomeCache: () => {},
        workoutRowHasContent: () => false, liveWorkoutRow: () => null,
        getSessionById: () => null, nextInRotation: () => null,
        sessionColourClass: () => 'sc-1', lastTrainedLabel: () => ''
      }
    });
    await n.renderNextUp();
    eq(d.get('next-up').style.display, 'none', 'a brand new account gets no card');
    ok(!d.get('next-up').classList.contains('is-pending'),
       'and no reserved gap sitting where the card would have been');
  }

  // ── 5. The strip renders from the rows it was given, with no request of its own ─────────────
  {
    const d = fakeDom();
    let fetched = 0;
    const s = load({
      functions: ['buildWeekStrip', 'dateStr', 'weekIndex'],
      deps: {
        document: d.document, esc: v => String(v),
        sessionDisplayName: t => ({ 'upper-a': 'Upper A' }[t] || t),
        realWorkoutsBetween: async () => { fetched++; return []; }
      }
    });
    // Whatever today is, the strip starts on Monday of this week — the same rule the app uses.
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    await s.buildWeekStrip('home-week-strip', [{ date: s.dateStr(monday), session_type: 'upper-a' }]);

    eq(fetched, 0, 'rows in hand means no second request for the same week');
    eq(d.get('home-week-strip').children.length, 7, 'seven days are painted');
    ok(d.get('home-week-strip').children[0].classList.contains('done'), "and Monday's session shows on it");
    // C18, 1 Sept 2026: the session name came off the strip. `done` is the whole signal now — it is
    // what turns the tile and its dot green — and every day keeps its dot.
    ok(d.get('home-week-strip').children[0].innerHTML.includes('wd-dot'), 'a trained day keeps its dot');
    ok(!d.get('home-week-strip').children[0].innerHTML.includes('UA'), 'and carries no abbreviated session name');

    // The other caller still works: no rows, so it goes and gets them.
    await s.buildWeekStrip('home-week-strip');
    eq(fetched, 1, 'a caller with nothing in hand still fetches');
  }

  // ── 6. The boot: four sequential waves became one, and the greeting waits for none of them ──
  {
    const d = fakeDom();
    const bootSent = [];
    const held = [];
    const hold = name => { bootSent.push(name); return new Promise(r => held.push(() => r([]))); };
    const painted = [];   // what the greeting said, each time it was painted
    let restored = false;

    const boot = load({
      functions: ['initApp'],
      decls: ['lastTemplateRefresh', 'EXERCISE_LIBRARY', 'bootNextUpRows'],
      deps: {
        document: d.document, todayStr: () => '2026-08-28',
        loadSessionTemplates: () => hold('templates'),
        loadExerciseIds: () => hold('exercise ids'),
        loadExerciseCatalogue: () => hold('catalogue'),
        loadProfile: () => hold('profile'),
        loadGoals: () => hold('goals'),
        fetchNextUpRows: () => hold('next up'),
        autoCloseStaleWorkouts: () => hold('housekeeping'),
        paintGreeting: () => { painted.push(bootSent.length); },
        buildExerciseLibrary: () => ({}), loadCustomExercises: () => {},
        buildSessionGrid: () => {}, renderCheckinSummary: () => {},
        showPage: () => {}, needsOnboarding: () => false, openOnboarding: () => {},
        paintHomeFromCache: () => { restored = true; },
      },
      accessors: { prefetched: '() => bootNextUpRows' }
    });

    const started = boot.initApp('home');
    await settle();

    // THE ASSERTION. Nothing has answered, and everything the boot needs has already been asked for.
    eq(bootSent.length, 7, 'every boot read is in flight at once, not four waves deep');
    ['templates', 'exercise ids', 'catalogue', 'profile', 'goals', 'next up']
      .forEach(name => ok(bootSent.includes(name), `${name} left with the rest`));

    // The greeting is the first thing on the screen and must not be behind any of them.
    ok(painted.length > 0, 'the greeting is painted before a single answer comes back');

    // Housekeeping on rows that have sat there since yesterday. It used to be the FIRST await in the
    // boot, with the whole app queued behind it.
    ok(bootSent.includes('housekeeping'), 'stale-workout cleanup still runs');

    ok(boot.prefetched() !== null, "and Next up's rows are fetched by the boot, not by the card");
    ok(restored, 'and the rest of Home is painted from disk in the same breath as the greeting');

    held.forEach(r => r());
    await started;
    ok(painted.length > 1, 'and painted again once the profile has actually answered');
  }

  // The prefetch is a snapshot of app-open, so exactly one render may have it.
  {
    const t = load({
      functions: ['takeBootNextUpRows'], decls: ['bootNextUpRows'],
      accessors: { seed: '(v) => { bootNextUpRows = v; }' }
    });
    t.seed(['a snapshot']);
    ok(Array.isArray(t.takeBootNextUpRows()), 'the first Home render gets the boot rows');
    eq(t.takeBootNextUpRows(), null,
       'and the second gets nothing, so a Home opened after a session fetches fresh');
  }

  // Only Home prefetches. Restoring onto the Workout tab, training, then tapping Home must not be
  // offered a card built from rows read before the session existed.
  {
    const d = fakeDom();
    let prefetches = 0;
    let restored = false;
    const boot = load({
      functions: ['initApp'],
      decls: ['lastTemplateRefresh', 'EXERCISE_LIBRARY', 'bootNextUpRows'],
      deps: {
        document: d.document, todayStr: () => '2026-08-28',
        loadSessionTemplates: async () => [], loadExerciseIds: async () => [],
        loadExerciseCatalogue: async () => [], loadProfile: async () => [], loadGoals: async () => [],
        fetchNextUpRows: () => { prefetches++; return Promise.resolve([]); },
        autoCloseStaleWorkouts: async () => {}, paintGreeting: () => {},
        buildExerciseLibrary: () => ({}), loadCustomExercises: () => {},
        buildSessionGrid: () => {}, renderCheckinSummary: () => {},
        showPage: () => {}, needsOnboarding: () => false, openOnboarding: () => {},
        paintHomeFromCache: () => { restored = true; },
      }
    });
    await boot.initApp('workout');
    eq(prefetches, 0, 'a boot onto the Workout tab does not prefetch a Next up it will not paint');
    ok(!restored, 'nor repaints a Home it is not opening on');
  }

  // ── 8. Home opens on what it last showed ────────────────────────────────────────────────────
  // Del, with the greeting already fixed: "now the welcome comes in, the bottom half comes in and
  // then the next workout comes in 2/3 seconds later... it does not look proffessional at all".
  // Three arrivals is the complaint. So the first frame is the last frame: everything is painted
  // from disk before a request is sent, and the live reads land on top of identical values.
  function cacheHarness(email, stored) {
    const d = fakeDom();
    // Both blocks ship `is-pending` in index.html — the reserved-but-invisible state. Set here so
    // "was it made visible" is a real question rather than one the empty fake answers for free.
    d.get('daily-quote').classList.add('is-pending');
    d.get('next-up').classList.add('is-pending');
    d.get('next-up').className = 'next-up is-pending';
    const store = {};
    if (stored) store[`dlog_home:${email}`] = JSON.stringify(stored);
    let stripRows = null;
    const app = load({
      functions: ['paintHomeFromCache', 'readHomeCache', 'writeHomeCache', 'homeCacheKey'],
      decls: ['HOME_CACHE_VERSION', 'cachedNextUpId'],
      deps: {
        document: d.document,
        authSession: { email },
        localStorage: {
          getItem: k => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); },
          removeItem: k => { delete store[k]; },
        },
        todayStr: () => '2026-08-28',
        getWeekStart: () => '2026-08-24',
        sevenDayWindow: () => ({ from: '2026-08-22', label: '22–28 Aug' }),
        buildWeekStrip: (id, rows) => { stripRows = rows; },
      },
      accessors: { nextUpId: '() => cachedNextUpId' }
    });
    return { app, get: d.get, store, strip: () => stripRows };
  }

  const FULL = {
    v: 1,
    nextUp: { id: 'upper-b', name: 'Upper B', sub: '3 / 4 · after Lower A · yesterday', go: 'Start →', colour: 'sc-upper' },
    weight: 82.4, sessions: 3, weekStart: '2026-08-24',
    weekRows: [{ date: '2026-08-26', session_type: 'cv-pump', name: 'CV + Pump' }],
    avgWeight: '82.1', avgCals: '2,140', avgSteps: '11,204',
    quote: { text: '"Discipline"', author: '— Anon', date: '2026-08-28' }
  };

  {
    const h = cacheHarness('delpeter@gmail.com', FULL);
    h.app.paintHomeFromCache();

    eq(h.get('next-up-name').textContent, 'Upper B', 'the card is on screen before anything is fetched');
    eq(h.get('next-up-sub').textContent, '3 / 4 · after Lower A · yesterday', 'with the line it had last time');
    eq(h.get('next-up').style.display, 'block', 'and visible, not reserved');
    ok(/sc-upper/.test(h.get('next-up').className), 'in its own session colour');
    ok(!/is-pending/.test(h.get('next-up').className), 'with the pending state dropped');
    eq(h.app.nextUpId(), 'upper-b',
       'and the session is remembered, so tapping Start works before the read lands');

    eq(h.get('home-weight').textContent, 82.4, 'current kg is there');
    eq(h.get('home-avg-weight').textContent, '82.1', 'and the averages');
    eq(h.get('home-avg-cals').textContent, '2,140', 'exactly as they were formatted');
    eq(h.get('home-steps').textContent, '11,204', 'commas and all');
    eq(h.get('home-sessions').textContent, 3, 'sessions this week is inside its week, so it is restored');
    ok(h.strip() && h.strip()[0].name === 'CV + Pump',
       'the strip rebuilds through its own renderer, from rows carrying the name they were drawn with');

    // Arithmetic on today's date, never restored: a stored copy could only be yesterday's dates.
    eq(h.get('home-avg-window').textContent, 'Last 7 days · 22–28 Aug', 'the window heading is computed, not remembered');

    eq(h.get('quote-text').textContent, '"Discipline"', "and today's quote is already there");
    ok(!h.get('daily-quote').classList.contains('is-pending'), 'with its block visible');
  }

  // THE ONE THAT MATTERS. Cached UI not scoped to the person it came from is exactly how a brand-new
  // account was greeted "Good afternoon, Del" and shown his 80kg on 25 Aug.
  {
    const h = cacheHarness('someone@else.com', null);
    h.store['dlog_home:delpeter@gmail.com'] = JSON.stringify(FULL);
    h.app.paintHomeFromCache();
    eq(h.get('next-up-name').textContent, '', "a second account on the phone sees none of Del's Home");
    eq(h.get('home-weight').textContent, '', 'not his weight either');
  }

  // A week-old cache. "3 sessions" from last Friday is not a stale number on a Monday, it is a wrong
  // one, so the week-scoped half expires on the Monday boundary while the rest carries on.
  {
    const h = cacheHarness('delpeter@gmail.com', { ...FULL, weekStart: '2026-08-17' });
    h.app.paintHomeFromCache();
    eq(h.get('home-sessions').textContent, '', "last week's session count is not restored into this week");
    eq(h.strip(), null, 'and neither is its week strip');
    eq(h.get('next-up-name').textContent, 'Upper B', 'the rotation card carries no week, so it still is');
    eq(h.get('home-weight').textContent, 82.4, 'and so does the weigh-in');
  }

  // The quote is chosen by date, so a cached one is restored on that date and on no other.
  {
    const h = cacheHarness('delpeter@gmail.com', { ...FULL, quote: { ...FULL.quote, date: '2026-08-27' } });
    h.app.paintHomeFromCache();
    eq(h.get('quote-text').textContent, '', "yesterday's quote is not painted as today's");
    ok(h.get('daily-quote').classList.contains('is-pending'), 'the block stays reserved until the real one lands');
  }

  // `nextUp: null` is a real answer — an account with no history. Restoring it means the reserved
  // gap does not open and close on every launch.
  {
    const h = cacheHarness('delpeter@gmail.com', { ...FULL, nextUp: null });
    h.app.paintHomeFromCache();
    eq(h.get('next-up').style.display, 'none', 'a remembered "no card" hides the card outright');
    ok(!h.get('next-up').classList.contains('is-pending'), 'rather than holding space for one');
  }

  // A payload from an older version of the file is dropped whole, not half-read.
  {
    const h = cacheHarness('delpeter@gmail.com', { ...FULL, v: 0 });
    h.app.paintHomeFromCache();
    eq(h.get('next-up-name').textContent, '', 'a stale cache version is ignored');
  }

  // Each renderer writes only its own part, and none of them clobbers the others.
  {
    const h = cacheHarness('delpeter@gmail.com', null);
    h.app.writeHomeCache({ weight: 80 });
    h.app.writeHomeCache({ sessions: 2 });
    const back = h.app.readHomeCache();
    eq(back.weight, 80, 'the first write survives');
    eq(back.sessions, 2, 'alongside the second');
    eq(back.v, 1, 'stamped with the version that wrote it');
  }

  // ── 7. The remembered name — instant, and keyed on the account ──────────────────────────────
  {
    const store = {};
    const localStorage = {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    };
    // Mutated, never reassigned: load() captures the dep by value when it builds the scope.
    const session = { email: 'delpeter@gmail.com' };
    const g = load({
      functions: ['getGreeting', 'cachedNameKey', 'cachedDisplayName', 'rememberDisplayName'],
      decls: ['PROFILE'],
      deps: { localStorage, authSession: session, Date },
      accessors: { setProfile: '(p) => { PROFILE = p; }' }
    });

    g.setProfile({ display_name: null });
    ok(!/,/.test(g.getGreeting()), 'nothing remembered yet, so the greeting drops the name');

    g.rememberDisplayName('Del');
    ok(/, Del$/.test(g.getGreeting()), 'once remembered it needs no profile and no network');

    // THE ONE THAT MATTERS. A cached greeting is how "Good afternoon, Del" got shown to a brand-new
    // account on 25 Aug. The email is in the key, so a second account finds nothing of Del's.
    session.email = 'someone@else.com';
    ok(!/Del/.test(g.getGreeting()), "a second account on the same phone is never greeted by Del's name");

    session.email = 'delpeter@gmail.com';
    g.setProfile({ display_name: 'Delbert' });
    ok(/, Delbert$/.test(g.getGreeting()), 'and the profile wins over the cache when it lands');

    g.rememberDisplayName('');
    g.setProfile({ display_name: null });
    ok(!/,/.test(g.getGreeting()), 'a blanked name clears the cache rather than lingering');
  }

  // ── 9. A dead connection must not erase a good screen ───────────────────────────────────────
  // The cost of opening on remembered values: sb() answers a failed GET with [] exactly as it
  // answers an empty table, so without a guard the gym-Wi-Fi launch paints `--` and a grey week over
  // numbers that were right. Both halves of Home are checked, because both would do it.
  {
    const d = fakeDom();
    d.get('home-weight').textContent = '82.4';       // as paintHomeFromCache() left it
    d.get('home-sessions').textContent = '3';
    let wrote = false;
    const app = load({
      functions: ['loadHomePage', 'sevenDayWindow', 'dateStr'],
      deps: {
        document: d.document, APP_BUILD: 'test-build',
        sb: async () => [], realWorkoutsBetween: async () => [],
        buildWeekStrip: () => { wrote = true; }, getWeekStart: () => '2026-08-24',
        getGreeting: () => 'Good morning, Del', sessionDisplayName: t => t,
        claimRestAlertsFlag: () => {}, restAlertsDeviceAccount: () => null, paintRestAlertsButton: () => {},
        reconcileRestAlerts: () => {}, ensureRestAlertArmed: () => {}, renderBackupPrompt: () => {}, syncBackupState: () => {},
        renderNextUp: () => {}, renderDailyQuote: () => {},
        readHomeCache: () => ({ v: 1, weight: 82.4 }),
        writeHomeCache: () => { wrote = true; },
      }
    });
    await app.loadHomePage();
    eq(d.get('home-weight').textContent, '82.4', 'a launch where nothing answers leaves the weight alone');
    eq(d.get('home-sessions').textContent, '3', 'and the session count');
    eq(d.get('home-avg-weight').textContent, '', 'nothing is overwritten with a dash');
    ok(!wrote, 'and an empty screen is never written back over a good cache');
  }

  // The same rule for the card. An account whose last launch had a rotation card has history, so
  // "no rows" is a connection, not a training log that vanished overnight.
  {
    const d = fakeDom();
    const n = load({
      functions: ['renderNextUp'],
      decls: ['nextUpSession', 'cachedNextUpId'],
      deps: {
        document: d.document, todayStr: () => '2026-08-28',
        takeBootNextUpRows: () => null, fetchNextUpRows: async () => [], writeHomeCache: () => {},
        workoutRowHasContent: () => false, liveWorkoutRow: () => null,
        getSessionById: () => null, nextInRotation: () => null,
        sessionColourClass: () => 'sc-1', lastTrainedLabel: () => ''
      },
      accessors: { restore: "(id) => { cachedNextUpId = id; }" }
    });
    n.restore('upper-b');                       // as if paintHomeFromCache() had put a card up
    d.get('next-up').style.display = 'block';
    await n.renderNextUp();
    eq(d.get('next-up').style.display, 'block',
       'a failed read leaves the restored card standing rather than blanking it');
  }

  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
