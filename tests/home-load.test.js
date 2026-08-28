// How Home opens — E19, 28 August 2026.
//
// Del: "the home page opens a little slow now, like a jump on the screen... it just doesnt open like
// a real app - its not smooth". The cause was never slow SQL. It was that loadHomePage() sent its
// requests in THREE sequential waves — the daily quote first, on its own, awaited ahead of every
// number on the screen — and then let each wave shove the page down as it landed.
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
      reconcileRestAlerts: () => {}, renderBackupPrompt: () => {}, syncBackupState: () => {},
      renderNextUp: () => {}, renderDailyQuote: () => req('quotes?select=quote,author&order=id'),
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
        document: d.document, dayIndex: () => 0,
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
      deps: { document: d.document, dayIndex: () => 0, sb: async () => [] }
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
      decls: ['nextUpSession'],
      deps: {
        document: d.document, sb: async () => [], todayStr: () => '2026-08-28',
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
      functions: ['buildWeekStrip', 'shortSessionLabel', 'dateStr', 'weekIndex'],
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
    ok(d.get('home-week-strip').children[0].innerHTML.includes('UA'), 'labelled with the session, not a dot');

    // The other caller still works: no rows, so it goes and gets them.
    await s.buildWeekStrip('home-week-strip');
    eq(fetched, 1, 'a caller with nothing in hand still fetches');
  }

  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
