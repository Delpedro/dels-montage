// The profiles table — the app's first concept of a person (21 August 2026).
//
// Step 1 of the second-user work. The bug it closes is not a crash, it is a lie: getGreeting()
// returned the literal 'Good morning, Del', so the fiancée's account would greet her by Del's name
// every single morning. That is the sort of detail that tells someone an app was not built for them.
//
// The half that is easy to get wrong is the EMPTY case, and it is the one that matters most,
// because it is what a brand new account hits on its very first load. A missing profile row is not
// an error — it is "nobody has onboarded this account yet", which is exactly the state the
// onboarding form will key off. So: no name, no toast, no throw, and above all no fallback to 'Del'.
//
// Run: node tests/profile.test.js

const fs = require('fs');
const path = require('path');
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

// Freezes the clock at a given hour so all three greeting branches can be tested. `new Date()` with
// no arguments is the only call getGreeting makes, so pinning that is enough.
function atHour(h) {
  const Real = Date;
  class Fixed extends Real {
    constructor(...args) { super(...(args.length ? args : [2026, 7, 21, h, 30])); }
  }
  return Fixed;
}

function app(hour, sbImpl) {
  const calls = [];
  // A fresh localStorage per harness. getGreeting() falls back to the name this account last used on
  // this device (E19 follow-up, 28 Aug 2026 — the greeting was arriving four round trips into the
  // boot), so the cache has to start EMPTY here or section 2's "no profile row" cases would be
  // answered by a leftover name instead of by the absence of one.
  const store = {};
  const deps = {
    Date: atHour(hour),
    sb: async (p, ...rest) => { calls.push(p); return sbImpl ? sbImpl(p, ...rest) : []; },
    authSession: { email: 'test@example.com' },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
  };
  const lifted = load({
    decls: ['PROFILE'],
    functions: ['getGreeting', 'loadProfile', 'cachedNameKey', 'cachedDisplayName', 'rememberDisplayName'],
    deps,
    accessors: { profile: '() => PROFILE', setProfile: 'p => { PROFILE = p; }' },
  });
  return { ...lifted, calls, store };
}

console.log('Profiles — the app knows who is using it');

// ── 1. the greeting reads the profile, not the source ─────────────────────────────────────────
{
  const a = app(9);
  a.setProfile({ display_name: 'Del' });
  eq(a.getGreeting(), 'Good morning, Del', 'morning greets by the stored name');

  const b = app(14);
  b.setProfile({ display_name: 'Sarah' });
  eq(b.getGreeting(), 'Good afternoon, Sarah', 'afternoon uses the row, not a hardcoded name');

  const c = app(21);
  c.setProfile({ display_name: 'Sarah' });
  eq(c.getGreeting(), 'Good evening, Sarah', 'evening too');

  // The exact boundaries the old three-branch version had, kept so the rewrite cannot move them.
  const noon = app(12); noon.setProfile({ display_name: 'Del' });
  eq(noon.getGreeting(), 'Good afternoon, Del', 'noon is afternoon, not morning');
  const five = app(17); five.setProfile({ display_name: 'Del' });
  eq(five.getGreeting(), 'Good evening, Del', '17:00 is evening');
  const midnight = app(0); midnight.setProfile({ display_name: 'Del' });
  eq(midnight.getGreeting(), 'Good morning, Del', 'midnight is morning');
}

// ── 2. no profile row — the case a new account actually hits ──────────────────────────────────
{
  const a = app(9);
  eq(a.getGreeting(), 'Good morning', 'no profile yet: greet without a name');
  ok(!/Del/.test(a.getGreeting()), "and NEVER fall back to somebody else's name");

  const b = app(9);
  b.setProfile({ display_name: null });
  eq(b.getGreeting(), 'Good morning', 'an explicit null name is the same as no row');

  const c = app(9);
  c.setProfile({ display_name: '   ' });
  eq(c.getGreeting(), 'Good morning', 'whitespace is not a name — no dangling comma left behind');

  const d = app(9);
  d.setProfile({ display_name: ' Del ' });
  eq(d.getGreeting(), 'Good morning, Del', 'a name typed with spaces still reads right');
}

// ── 3. loadProfile ────────────────────────────────────────────────────────────────────────────
(async () => {
  {
    const a = app(9, () => [{ user_id: 'u1', display_name: 'Sarah', onboarded_at: null }]);
    await a.loadProfile();
    eq(a.profile().display_name, 'Sarah', 'the row is stored');
    eq(a.getGreeting(), 'Good morning, Sarah', 'and the greeting picks it up');
    eq(a.calls[0], 'profiles?select=*&limit=1', 'one row, no user_id filter — RLS scopes it');
    ok(!/user_id=eq/.test(a.calls[0]), 'the client never claims whose data it is asking for');
  }

  {
    // What a new account gets. Also what EVERY account gets in the gym with no signal: sb() returns
    // [] on a failed GET rather than throwing, so these two paths are the same code.
    const a = app(9, () => []);
    await a.loadProfile();
    eq(a.profile().display_name, null, 'no row leaves the blank profile in place');
    eq(a.getGreeting(), 'Good morning', 'and the greeting degrades quietly');
  }

  {
    const a = app(9, () => null);
    await a.loadProfile();
    eq(a.profile().display_name, null, 'a null response is survived, not thrown on');
  }

  {
    // Offline mid-session: a profile already loaded must not be wiped by a failed refresh.
    const a = app(9, () => []);
    a.setProfile({ display_name: 'Del' });
    await a.loadProfile();
    eq(a.getGreeting(), 'Good morning, Del', 'a failed reload keeps the name it already had');
  }

  // ── 4. the source no longer carries a name ──────────────────────────────────────────────────
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
    const at = src.indexOf('function getGreeting');
    ok(!/Good (morning|afternoon|evening), Del/.test(src.slice(at, at + 400)),
      "no hardcoded 'Good morning, Del' left in getGreeting");
    ok(/EXPORT_TABLES = \[[^\]]*'profiles'/s.test(src),
      'profiles is in the export — a new table is silently missing from it otherwise');
  }

  // ── 5. the migration ────────────────────────────────────────────────────────────────────────
  // Not decoration: this table holds the only genuinely personal data in the schema — name, sex,
  // date of birth — so the isolation on it is the part that must never quietly regress. Pinned
  // against the file that was actually applied.
  {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'supabase', 'migrations', '20260821220000_profiles.sql'), 'utf8');
    ok(/user_id uuid primary key/.test(sql), 'one row per user, enforced by the primary key');
    ok(/default auth\.uid\(\)/.test(sql), 'user_id comes from the JWT, not from the client');
    ok(/references auth\.users\(id\) on delete cascade/.test(sql),
      'deleting an account takes its profile with it');
    ok(/display_name text not null/.test(sql), 'a profile without a name is not a profile');
    ok(/enable row level security/.test(sql), 'RLS is on');
    ok(/using \(user_id = auth\.uid\(\)\) with check \(user_id = auth\.uid\(\)\)/.test(sql),
      'owner-only, and a forged user_id is rejected rather than ignored');
    ok(/revoke all on public\.profiles from anon/.test(sql), 'the publishable key opens nothing');
    ok(/create trigger profiles_touch before update/.test(sql),
      "updated_at is the database's job, because a caller will forget");
    // A form you can save halfway is a form you can come back to.
    ok(!/(dob date|height_cm[^,]*|sex text[^,]*) not null/.test(sql), 'the optional fields stay optional');
  }

  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
