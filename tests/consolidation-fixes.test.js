// The small, long-standing items closed on 13 Aug 2026 in the consolidation sweep. Individually
// minor; together they were most of what was left on the backlog that could fire during ordinary use.
//
//  · numOrNull/intOrNull — `parseInt(x) || null` stored a genuine 0 as "never recorded". 0 steps on a
//    sick day, a 0-calorie fast. It matters more now the Watch Shortcut writes steps.
//  · getDateRangeFilter('month') — setMonth() overflows, so "Last Month" run on the 31st asked for
//    31 February and landed on 3 March: three days of history instead of a month.
//  · History filters — reset on every visit, so stepping to Stats and back dropped you on All Time.
//  · looksLikeSeconds — the pill test used to be /s\b/, which matches any word ending in "s".
//  · savePassword — changed the password on the strength of the stored JWT alone, so an unlocked
//    phone could take the account in three taps.
//
// Run: node tests/consolidation-fixes.test.js

const { load } = require('./extract');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  FAIL: ${label}`);
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// A Date whose "now" is fixed, so the month-boundary cases can be tested on a Tuesday in August.
function dateAt(iso) {
  return class extends Date {
    constructor(...args) {
      if (args.length === 0) super(iso);
      else super(...args);
    }
  };
}

// ── 1. a stored zero is a real answer ──────────────────────────────────────
{
  console.log('0 survives the check-in round trip');
  const { numOrNull, intOrNull } = load({ functions: ['numOrNull', 'intOrNull'] });

  eq(numOrNull('0'), 0, 'a typed 0 is zero, not null — this is the whole bug');
  eq(intOrNull('0'), 0, 'and for the whole-number columns too');
  eq(numOrNull(''), null, 'an empty box is still "not recorded"');
  eq(intOrNull(''), null, 'ditto');
  eq(numOrNull(null), null, 'null in, null out');
  eq(numOrNull(undefined), null, 'undefined in, null out');
  eq(numOrNull('abc'), null, 'free text is not a number');
  eq(intOrNull('abc'), null, 'free text is not a whole number either');
  eq(numOrNull('72.4'), 72.4, 'a decimal weight is kept');
  eq(intOrNull('8421'), 8421, 'a step count comes through whole');
  eq(intOrNull('8421.6'), 8422, 'a decimal in an integer column is rounded, not truncated to a 400');
  eq(numOrNull(0), 0, 'a numeric 0 (not a string) is also zero');
  eq(numOrNull('-1.5'), -1.5, 'negatives are numbers');

  // The display side of the same bug: `l.steps ? … : '--'` and `l.weight || ''` both hid a real 0.
  const shown = (v) => (v != null ? String(v) : '--');
  eq(shown(0), '0', 'a recorded 0 renders as 0, not "--"');
  eq(shown(null), '--', 'and a genuinely missing value still renders as "--"');
}

// ── 2. "Last Month" on the 31st ────────────────────────────────────────────
{
  console.log('Last Month lands a month back');

  function rangeOn(iso, range) {
    const api = load({
      functions: ['getDateRangeFilter', 'dateStr'],
      decls: ['historyDateRange'],
      deps: { Date: dateAt(iso), getWeekStart: () => '2026-08-10' },
      accessors: { setRange: '(v) => { historyDateRange = v; }' },
    });
    api.setRange(range);
    return api.getDateRangeFilter();
  }

  // 31 March: setMonth(2 - 1) used to ask for 31 February, which JS rolls forward to 3 March.
  eq(rangeOn('2026-03-31T12:00:00', 'month'), '2026-02-28', 'on 31 March it clamps to 28 Feb, not 3 March');
  eq(rangeOn('2024-03-31T12:00:00', 'month'), '2024-02-29', 'and to 29 Feb in a leap year');
  eq(rangeOn('2026-05-31T12:00:00', 'month'), '2026-04-30', 'on 31 May it clamps to 30 April');
  eq(rangeOn('2026-08-13T12:00:00', 'month'), '2026-07-13', 'an ordinary day is just the same date last month');
  eq(rangeOn('2026-01-15T12:00:00', 'month'), '2025-12-15', 'and January steps back into last year');
  eq(rangeOn('2026-08-13T12:00:00', 'week'), '2026-08-10', 'This Week defers to getWeekStart(), unchanged');
  eq(rangeOn('2026-08-13T12:00:00', 'all'), '2000-01-01', 'All Time is still everything');

  // The regression this guards: the old code returned a start date only days back.
  const start = rangeOn('2026-03-31T12:00:00', 'month');
  ok(start < '2026-03-01', 'the month window genuinely reaches back past the start of this month');
}

// ── 3. History filters persist between visits ──────────────────────────────
{
  console.log('History remembers its filters');

  function build(stored) {
    const store = { v: stored === undefined ? null : stored };
    const api = load({
      functions: ['saveHistoryFilters', 'restoreHistoryFilters'],
      decls: ['historyPage', 'historyTab', 'historyDateRange', 'historyWorkoutFilter',
              'historySearchTerm', 'HISTORY_FILTER_STORE'],
      deps: {
        localStorage: {
          getItem: () => store.v,
          setItem: (k, v) => { store.v = v; },
        },
      },
      accessors: {
        state: '() => ({ page: historyPage, tab: historyTab, range: historyDateRange, workout: historyWorkoutFilter, search: historySearchTerm })',
        set: `(t, r, w, s) => { historyTab = t; historyDateRange = r; historyWorkoutFilter = w; historySearchTerm = s; }`,
      },
    });
    return { ...api, store };
  }

  {
    const h = build();
    h.set('workouts', 'week', 'lower-a', 'squat');
    h.saveHistoryFilters();
    const saved = JSON.parse(h.store.v);
    eq(saved.tab, 'workouts', 'the tab is written to storage');
    eq(saved.range, 'week', 'so is the date range');
    eq(saved.workout, 'lower-a', 'and the workout filter');
    eq(saved.search, undefined, 'the search term deliberately is NOT stored');
  }

  {
    const h = build('{"tab":"workouts","range":"week","workout":"lower-a"}');
    h.restoreHistoryFilters(['lower-a', 'upper-b']);
    const s = h.state();
    eq(s.tab, 'workouts', 'a saved tab comes back');
    eq(s.range, 'week', 'a saved range comes back — this is the bug, it used to reset to All Time');
    eq(s.workout, 'lower-a', 'a saved workout filter comes back');
    eq(s.search, '', 'the search box always starts empty');
    eq(s.page, 1, 'and paging always restarts at the top');
  }

  {
    // A session that has since been deleted would leave History filtered to nothing, with no
    // obvious way back — an empty feed reads as lost data in this app.
    const h = build('{"tab":"all","range":"all","workout":"deleted-session"}');
    h.restoreHistoryFilters(['lower-a']);
    eq(h.state().workout, 'all', 'a filter pointing at a session that no longer exists falls back to All');
  }

  {
    const h = build('{"tab":"all","range":"all","workout":"open"}');
    h.restoreHistoryFilters(['lower-a']);
    eq(h.state().workout, 'open', 'Open Workout is valid even though it is not in SESSIONS');
  }

  {
    const h = build('{"tab":"nonsense","range":"decade","workout":"all"}');
    h.restoreHistoryFilters([]);
    eq(h.state().tab, 'all', 'a junk tab value is ignored');
    eq(h.state().range, 'all', 'so is a junk range — nothing from storage is trusted as-is');
  }

  {
    const h = build('not json at all');
    h.restoreHistoryFilters([]);
    eq(h.state().tab, 'all', 'corrupt storage falls back to defaults instead of throwing');
    eq(h.state().range, 'all', 'on every field');
  }

  {
    const h = build();
    h.restoreHistoryFilters([]);
    eq(h.state().range, 'all', 'a first-ever visit gets the defaults');
  }
}

// ── 4. the timed-exercise pill ─────────────────────────────────────────────
{
  console.log('a duration is told apart from a plural');
  const { looksLikeSeconds } = load({ functions: ['looksLikeSeconds'] });

  eq(looksLikeSeconds('40s'), true, '"40s" is a duration');
  eq(looksLikeSeconds('30–45s'), true, 'so is a range');
  eq(looksLikeSeconds('45 s'), true, 'with a space');
  eq(looksLikeSeconds('30 secs'), true, 'or spelled short');
  eq(looksLikeSeconds('30 seconds'), true, 'or spelled out');
  eq(looksLikeSeconds('12 reps'), false, '"reps" ends in s and is NOT a duration — the old /s\\b/ said it was');
  eq(looksLikeSeconds('3 holds'), false, 'nor is "holds"');
  eq(looksLikeSeconds('8–12'), false, 'a plain rep range is not a duration');
  eq(looksLikeSeconds(''), false, 'empty is not a duration');
  eq(looksLikeSeconds(null), false, 'and neither is nothing at all');
  eq(looksLikeSeconds('to failure'), false, 'nor free text ending in a consonant');
}

// ── 5. Change Password asks who you are ────────────────────────────────────
(async () => {
  console.log('Change Password re-authenticates');

  function build({ email = 'del@example.com', authFetch }) {
    const errors = [];
    const toasts = [];
    const requests = [];
    const fields = {
      'pw-current': { value: 'oldpassword' },
      'pw-new': { value: 'newpassword1' },
      'pw-confirm': { value: 'newpassword1' },
      'pw-error': { textContent: '', style: {} },
    };
    const api = load({
      functions: ['verifyCurrentPassword', 'savePassword', 'netFetch'],
      decls: ['NET_TIMEOUT_MS'],
      deps: {
        document: { getElementById: (id) => fields[id] },
        authSession: email ? { email } : null,
        fetch: async (url, opts) => {
          requests.push({ url, body: JSON.parse(opts.body) });
          return authFetch(url, requests.length);
        },
        validAccessToken: async () => 'jwt-abc',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_KEY: 'publishable-key',
        showToast: (msg, type) => toasts.push({ msg, type }),
        closePasswordModal: () => {},
      },
    });
    return { ...api, fields, errors, toasts, requests, err: () => fields['pw-error'].textContent };
  }

  const okRes = async () => new Response('{}', { status: 200 });

  {
    const h = build({ authFetch: okRes });
    await h.savePassword();
    eq(h.requests.length, 2, 'two calls: prove the old password, then set the new one');
    ok(h.requests[0].url.includes('grant_type=password'), 'the first is the same password grant login uses');
    eq(h.requests[0].body.password, 'oldpassword', 'sent with the CURRENT password');
    eq(h.requests[0].body.email, 'del@example.com', 'for the logged-in account');
    ok(h.requests[1].url.endsWith('/auth/v1/user'), 'the second is the actual change');
    eq(h.requests[1].body.password, 'newpassword1', 'carrying the new password');
    eq(h.toasts[0].msg, 'Password changed', 'and it confirms');
  }

  {
    const h = build({ authFetch: async () => new Response('{}', { status: 400 }) });
    await h.savePassword();
    eq(h.err(), 'Current password is wrong', 'a wrong current password is named plainly');
    eq(h.requests.length, 1, 'and the password is never changed — the point of the fix');
  }

  {
    const h = build({ authFetch: () => { throw new TypeError('Failed to fetch'); } });
    await h.savePassword();
    eq(h.err(), "Can't reach the server", 'offline is told apart from a wrong password');
    eq(h.requests.length, 1, 'nothing is attempted against the account');
  }

  {
    const h = build({ authFetch: async () => new Response('{}', { status: 503 }) });
    await h.savePassword();
    eq(h.err(), "Couldn't verify that (503)", 'a server blip is not reported as a wrong password');
  }

  {
    const h = build({ email: null, authFetch: okRes });
    await h.savePassword();
    eq(h.err(), 'Session expired — log out and back in', 'with no email on the session there is nothing to verify against');
    eq(h.requests.length, 0, 'so nothing is sent');
  }

  {
    const h = build({ authFetch: okRes });
    h.fields['pw-current'].value = '';
    await h.savePassword();
    eq(h.err(), 'Enter your current password', 'the current password is required');
    eq(h.requests.length, 0, 'checked before anything leaves the phone');
  }

  {
    const h = build({ authFetch: okRes });
    h.fields['pw-current'].value = 'newpassword1';
    await h.savePassword();
    eq(h.err(), "That's the password you already have", 'setting it to the same password is caught');
    eq(h.requests.length, 0, 'without a round trip');
  }

  {
    const h = build({ authFetch: okRes });
    h.fields['pw-new'].value = 'short1';
    h.fields['pw-confirm'].value = 'short1';
    await h.savePassword();
    eq(h.err(), 'Your new password needs at least 8 characters', 'the length floor still applies');
    eq(h.requests.length, 0, 'and short-circuits before the network');
  }

  // Del's 13 Aug UAT: current password filled, the other two boxes empty. The length check fired and
  // read as though the box he HAD filled was too short. Each empty box now names itself.
  {
    const h = build({ authFetch: okRes });
    h.fields['pw-new'].value = '';
    h.fields['pw-confirm'].value = '';
    await h.savePassword();
    eq(h.err(), 'Enter a new password', 'an empty new password says so instead of blaming the length');
    eq(h.requests.length, 0, 'and nothing leaves the phone');
  }

  {
    const h = build({ authFetch: okRes });
    h.fields['pw-confirm'].value = '';
    await h.savePassword();
    eq(h.err(), 'Type your new password again to confirm it', 'an empty confirm box is not a mismatch');
    eq(h.requests.length, 0, 'still no round trip');
  }

  {
    const h = build({ authFetch: okRes });
    h.fields['pw-confirm'].value = 'somethingelse';
    await h.savePassword();
    eq(h.err(), "Those don't match", 'the confirmation still has to match');
  }
})();

// ── done ───────────────────────────────────────────────────────────────────
process.on('exit', () => {
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});
