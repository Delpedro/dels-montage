// What a brand-new account actually hits (24 Aug 2026).
//
// Multi-user's database side was already done — RLS on every table, `anon` with SELECT on nothing —
// so isolation was never the risk. The risk was that a second person could sign in successfully and
// still be unable to train, because two screens are built out of DATA THAT ONLY DEL HAS:
//
//   1. Log Workout renders a tile for every entry in the hardcoded TRAINING_PROGRAMMES, but the
//      sessions themselves live in session_templates. A stranger was advertised "Upper / Lower —
//      Upper 1, Lower 1, Upper 2, Lower 2", tapped it, and got a back button over a band reading
//      "0 sessions". Two dead ends, inside the first minute.
//
//   2. EXERCISE_LIBRARY is built from your own templates plus your own exercises rows — both zero
//      on a new account — so the Add Exercise dropdown held a disabled placeholder and nothing
//      else. Every single lift had to be typed by hand into a native prompt(). That was not a
//      polish issue; it was the entire first run.
//
// Both are fixed by construction rather than by a starter array in app.js: an empty programme is
// not rendered, and the picker is filled from a SHARED `exercise_catalogue` table that belongs to
// nobody. This file holds the empty account's side of both, since it is the one state Del can
// never see for himself — his own account has had four months of data in it since before either
// bug existed.
//
// Run: node tests/empty-account.test.js

const fs = require('fs');
const path = require('path');
const { load } = require('./extract');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; console.log(`  FAIL: ${label}`); }
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// ── 1. THE DEAD-END PROGRAMME TILES ───────────────────────────────────────────────────────────
{
  const app = load({
    functions: ['programmeHasSessions'],
    decls: ['SESSIONS'],
    accessors: { seed: '(s) => { SESSIONS = s; }' },
  });

  // A brand-new account: authenticated, isolated, and holding nothing at all.
  app.seed([]);
  ok(!app.programmeHasSessions('upper-lower'), 'a new account has no Upper / Lower to show');
  ok(!app.programmeHasSessions('full-body-cv'), 'and no Full Body + CV either');
  ok(!app.programmeHasSessions('custom'), 'and no saved sessions of their own yet');

  // Del's account, and anyone who has trained for a week.
  app.seed([
    { id: 'upper-1', programme: 'upper-lower' },
    { id: 'lower-1', programme: 'upper-lower' },
    { id: 'arms',    programme: 'custom' },
  ]);
  ok(app.programmeHasSessions('upper-lower'), 'a programme with sessions in it still renders');
  ok(!app.programmeHasSessions('full-body-cv'),
    'and one without does not — the rule is per-programme, not per-account');
  ok(app.programmeHasSessions('custom'),
    'a saved session counts, so the tile comes back by itself the moment there is something behind it');
}

// ── 2. THE EMPTY EXERCISE PICKER ──────────────────────────────────────────────────────────────
// buildExerciseLibrary() folds three sources in a fixed order — your templates, your own exercises
// rows, then the shared catalogue. The order is the entire safety property: it is what lets a
// stranger be handed 58 known lifts without one byte of it changing what Del already built.
{
  const app = load({
    functions: ['buildExerciseLibrary'],
    decls: ['SESSIONS', 'EXERCISE_VARIATIONS', 'EXERCISE_CATALOGUE'],
    accessors: {
      seed: '(s, v, c) => { SESSIONS = s; EXERCISE_VARIATIONS = v; EXERCISE_CATALOGUE = c; }',
    },
  });

  const catalogue = {
    'Pull-Ups':     { name: 'Pull-Ups',     timed_target: null,     optional_weight: true,  bodyweight: false, variations: null },
    'Side Plank':   { name: 'Side Plank',   timed_target: '30–45s', optional_weight: false, bodyweight: true,  variations: null },
    'Seated Row':   { name: 'Seated Row',   timed_target: null,     optional_weight: false, bodyweight: false, variations: ['Pully', 'Machine'] },
    'Machine Chest Press': { name: 'Machine Chest Press', timed_target: null, optional_weight: false, bodyweight: false, variations: null },
  };

  // The new account: no templates, no exercises rows of its own, catalogue only.
  app.seed([], {}, catalogue);
  const fresh = app.buildExerciseLibrary();

  eq(Object.keys(fresh).length, 4, 'a new account gets a picker with something in it — this is the bug');
  ok(!!fresh['Pull-Ups'], 'and the lifts are the shared, known ones');
  eq(fresh['Machine Chest Press'].sets, 3, 'each arrives with a default shape to hang sets on');
  eq(fresh['Machine Chest Press'].reps, '8–12', 'the ordinary default for an ordinary lift');
  // A timed exercise's "reps" mean seconds, so "8–12" would be asking for a hold nobody can do.
  eq(fresh['Side Plank'].reps, '30–45s', 'a timed lift opens with its time target, not a rep range');
  eq(fresh['Side Plank'].bodyweight, true, 'and a bodyweight lift is flagged as one');
  eq(JSON.stringify(fresh['Seated Row'].variations), JSON.stringify(['Pully', 'Machine']),
    'variations ride along, so the picker is populated on day one too');
  ok(!('bodyweight' in fresh['Pull-Ups']),
    'an optional-weight lift is NOT flagged bodyweight — otherwise its kg box would never appear');

  // ── Del's account. The catalogue must be invisible here: every one of these names is already a
  //    key by the time the catalogue is folded in, so this loop has to change nothing. ──
  app.seed(
    [{ id: 'upper-1', exercises: [{ name: 'Machine Chest Press', sets: 4, reps: '6–8', rest: '150s' }] }],
    { 'Seated Row': ['High Row', 'Low Row', 'Pully', 'Machine'] },
    catalogue);
  const del = app.buildExerciseLibrary();

  eq(del['Machine Chest Press'].sets, 4, "a template's own set count survives the catalogue");
  eq(del['Machine Chest Press'].reps, '6–8', 'and its rep range');
  eq(del['Machine Chest Press'].rest, '150s',
    'and its rest — the 18 Aug longer-rests-on-compounds work is not quietly undone');
  eq(JSON.stringify(del['Seated Row'].variations),
    JSON.stringify(['High Row', 'Low Row', 'Pully', 'Machine']),
    "Del's own four-option variation list wins over the catalogue's two");
  ok(!!del['Pull-Ups'], 'while a catalogue lift he has no template for is still offered');
}

// ── 3. THE CATALOGUE IS SHARED, AND READ-ONLY, AND NOT ANYBODY'S ──────────────────────────────
// Asserted against the migration rather than trusted, because this is the one table in the schema
// that is deliberately not owner-scoped. If a later edit ever grants a write here, one user could
// rename a lift out from under every other user — and this is a paid app.
{
  const sql = fs.readFileSync(path.join(
    __dirname, '..', 'supabase', 'migrations', '20260824210000_exercise_catalogue.sql'), 'utf8');

  ok(/alter table public\.exercise_catalogue enable row level security/.test(sql),
    'RLS is enabled on the catalogue');
  ok(/revoke all on public\.exercise_catalogue from anon/.test(sql),
    'anon is revoked — a signed-out visitor cannot even enumerate it');
  ok(/revoke all on public\.exercise_catalogue from authenticated/.test(sql),
    'and authenticated is revoked before anything is granted back');
  ok(/grant select on public\.exercise_catalogue to authenticated/.test(sql),
    'a signed-in user gets SELECT');
  ok(!/grant (insert|update|delete|all).* to authenticated/.test(sql),
    'and never a write — the catalogue is maintained by migration, not by users');
  ok(/for select to authenticated using \(true\)/.test(sql),
    'the policy is a plain shared read, the same shape `quotes` already has');

  // The FK has to stay nullable: a user's own typed-in lift has no catalogue row and must keep
  // working. This column says "this private row is the known lift X" — it gates nothing.
  ok(/add column if not exists catalogue_id uuid references public\.exercise_catalogue\(id\) on delete set null/.test(sql),
    'exercises.catalogue_id is nullable and does not cascade a delete into anyone\'s history');

  // The backfill only ever fills a NULL, which is what makes it safe to re-run.
  ok(/where e\.catalogue_id is null/.test(sql),
    'the backfill can never re-point a row that is already linked');

  // Same reasoning as the existing custom_exercises link trigger: a phone running a
  // service-worker-cached old app.js still has to produce correctly linked rows.
  ok(/create trigger exercises_catalogue/.test(sql), 'new exercises rows are linked by the database');
  ok(/set search_path = public/.test(sql),
    'and the trigger function pins search_path, per the 24 Aug advisor pass');
}


// ── 4. TWO ACCOUNTS ON ONE BROWSER ────────────────────────────────────────────────────────────
// Everything the app keeps in localStorage was keyed by nothing at all, because until multi-user
// there was only ever one person using it. The worst of them is dlog_last_backup: a second account
// on the same browser is shown the FIRST account's backup date and believes their own data is safe
// when nothing of theirs has ever been backed up. That is a lie about data safety, in a paid app.
{
  const store = (bag) => ({
    getItem: k => (k in bag ? bag[k] : null),
    setItem: (k, v) => { bag[k] = String(v); },
    removeItem: k => { delete bag[k]; },
  });

  const local = {}, session = {};
  const app = load({
    functions: ['claimDeviceForAccount', 'perDeviceKeys'],
    decls: ['LAST_ACCOUNT_STORE', 'BACKUP_STORE', 'HISTORY_FILTER_STORE', 'STATS_RANGE_STORE',
            'REST_ALERTS_STORE', 'REST_TOKEN_STORE'],
    deps: { localStorage: store(local), sessionStorage: store(session) },
  });

  const dirty = () => {
    local['dlog_last_backup'] = '2026-08-24';
    local['dlog_history_filters'] = '{"q":"squat"}';
    local['dlog_stats_range'] = '7d';
    local['dlog_rest_alerts'] = 'on';
    local['dlog_rest_token'] = 'tok-abc';
    local['workout_draft'] = '{"sets":1}';
    session['sw_state'] = '{"running":true}';
    session['del_page'] = 'stats';
  };

  // ── First ever sign-in on a clean device: there is nothing to protect anyone from. ──
  dirty();
  app.claimDeviceForAccount('del@example.com');
  eq(local['dlog_last_backup'], '2026-08-24', 'a first sign-in clears nothing');
  eq(local['dlog_last_account'], 'del@example.com', 'and records whose device this now is');

  // ── The same person signing in again, which is what actually happens every day. ──
  app.claimDeviceForAccount('del@example.com');
  eq(local['workout_draft'], '{"sets":1}',
    'signing in again as the same account is a no-op — a mid-workout draft is NOT thrown away');
  eq(session['sw_state'], '{"running":true}', 'and a running rest survives it');

  // ── A token refresh. storeSession() is the single funnel for both login and refresh, and a
  //    refresh carries no user payload — so it must decide nothing at all. ──
  app.claimDeviceForAccount('');
  eq(local['dlog_last_account'], 'del@example.com', 'a refresh with no user payload changes nothing');
  eq(local['workout_draft'], '{"sets":1}', 'and cannot clear a draft out from under a live workout');

  // ── A DIFFERENT account signs in on this browser. ──
  app.claimDeviceForAccount('tester@example.com');
  eq(local['dlog_last_backup'], undefined,
    "the second account is NOT shown the first account's backup date — the data-safety lie");
  eq(local['dlog_history_filters'], undefined,
    'and their History does not open filtered by someone else\'s search, reading as "my history is gone"');
  eq(local['dlog_stats_range'], undefined, 'stats range is theirs');
  eq(local['dlog_rest_alerts'], undefined, 'the rest-alert preference is theirs');
  eq(local['dlog_rest_token'], undefined, "and they do not inherit a live rest token from someone else's session");
  eq(local['workout_draft'], undefined, 'half a logged workout does not change hands');
  eq(session['sw_state'], undefined, 'nor does a running rest timer');
  eq(session['del_page'], undefined, 'nor the page the other person was last on');
  eq(local['dlog_last_account'], 'tester@example.com', 'the device now belongs to them');

  // ── Storage disabled entirely (private mode). The app has to work; it just forgets things. ──
  const blown = load({
    functions: ['claimDeviceForAccount', 'perDeviceKeys'],
    decls: ['LAST_ACCOUNT_STORE', 'BACKUP_STORE', 'HISTORY_FILTER_STORE', 'STATS_RANGE_STORE',
            'REST_ALERTS_STORE', 'REST_TOKEN_STORE'],
    deps: {
      localStorage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} },
      sessionStorage: { removeItem() {} },
    },
  });
  let threw = false;
  try { blown.claimDeviceForAccount('del@example.com'); } catch (e) { threw = true; }
  ok(!threw, 'storage being unavailable never throws into the login path');

  // ── The list has to keep covering every device key, including ones added later. This is the
  //    assertion that actually protects the property: the rule above is only as good as its list. ──
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const covered = new Set(app.perDeviceKeys());
  // Keys that are correctly NOT device-scoped, each for a stated reason.
  const exempt = new Set([
    'dlog_session',       // the credentials themselves — replaced by login, removed by logout
    'dlog_last_account',  // the marker this rule is built on
    'dlog_update_tried',  // about the app BUILD on this device, not about any person
    // The shared catalogue: public, identical for every user, nothing personal in it. Kept ACROSS
    // an account switch on purpose — the second account wants it too, and it is the fallback that
    // stops a bad connection from reproducing the empty picker on someone's first session.
    'dlog_exercise_catalogue',
  ]);
  const found = new Set([
    ...(src.match(/'dlog_[a-z_]+'/g) || []).map(s => s.slice(1, -1)),
    ...(src.match(/(?:local|session)Storage\.(?:get|set|remove)Item\('([a-z_]+)'/g) || [])
        .map(s => s.split("'")[1]),
  ]);
  for (const key of found) {
    // Per-account keys build their own name (`dlog_onboarded:<email>`) and are already safe.
    if (key.endsWith(':') || exempt.has(key)) continue;
    ok(covered.has(key),
      `${key} is either cleared on an account switch or listed as deliberately exempt — a new ` +
      `storage key must not silently leak between two people sharing a browser`);
  }
}


// ── 5. THE HARDENING PASS ─────────────────────────────────────────────────────────────────────
// Del asked whether a second reviewer would find flaws in the catalogue migration. It would have
// found these three. They are asserted here so a later edit cannot quietly undo them.
{
  const sql = fs.readFileSync(path.join(
    __dirname, '..', 'supabase', 'migrations', '20260824220000_catalogue_hardening.sql'), 'utf8');

  // 1. The uniqueness guarantee has to be the guarantee the code relies on. The table was unique on
  //    `name` exactly, while the trigger, the backfill and CATALOGUE_BY_KEY all key on
  //    lower(btrim(name)) — so "Pull-Ups" and "pull-ups" could both have existed, the trigger's
  //    `limit 1` would have picked one arbitrarily, and app.js would have kept whichever loaded
  //    last. Two users, different metadata for the same lift, non-deterministically.
  ok(/create unique index if not exists exercise_catalogue_name_lower_key\s+on public\.exercise_catalogue \(lower\(btrim\(name\)\)\)/.test(sql),
    'the catalogue is unique on exactly what every lookup keys on');

  // 2. rename_exercise() updates exercises.name in place, so an INSERT-only trigger left the link
  //    pointing at the old lift — keeping its optional_weight flag, and one day showing a pull-up
  //    clip on a bench press.
  ok(/before insert or update on public\.exercises/.test(sql),
    'the catalogue link is re-resolved on rename, not just on insert');
  ok(/tg_op = 'UPDATE' and new\.name is distinct from old\.name/.test(sql),
    'and it uses the same three-part condition as the existing link_exercise trigger');

  // 3. Least privilege on a trigger attached to a user-writable table.
  ok(/security invoker/.test(sql), 'the trigger function is not SECURITY DEFINER');
  ok(/set search_path = public/.test(sql),
    'and still pins search_path — the advisor checks that on every function, not just definer ones');

  // 4. The app caps the field at 60 characters, but the app is not the only way in: a signed-in
  //    user can POST straight to PostgREST with their own JWT.
  for (const t of ['exercise_catalogue', 'exercises', 'custom_exercises']) {
    ok(new RegExp(`alter table public\\.${t} add constraint ${t}_name_sane`).test(sql),
      `${t}.name cannot be empty or absurd, enforced in the database rather than the form`);
  }
  ok(/check \(btrim\(name\) <> '' and length\(name\) <= 80\)/.test(sql),
    'and the bound is stated once, the same way, on all three');
}

console.log(`empty-account: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
