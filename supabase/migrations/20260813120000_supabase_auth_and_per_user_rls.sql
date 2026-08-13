-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Supabase Auth + per-user RLS — 13 Aug 2026
--
-- Closes the #1 finding from every review this app has had: the database was world-readable
-- and world-writable. Every table carried `create policy "allow all" ... to public using (true)`,
-- so the publishable key in js/app.js (public repo, public GitHub Pages site) was a full
-- read/write credential for all 798 workout sets, 59 daily check-ins and everything else.
-- The login screen was decorative — auth was `sessionStorage.del_auth = '1'`, settable in devtools.
--
-- What changes:
--   1. Every user-data table gets `user_id`, defaulting to auth.uid(), FK to auth.users.
--   2. "allow all" is replaced by `user_id = auth.uid()`, granted to `authenticated` only.
--   3. `anon` (the publishable key with no logged-in user) loses every table grant outright,
--      so the key on its own now opens nothing at all — belt and braces alongside RLS.
--   4. The hand-rolled app_user table and login() RPC are dropped; GoTrue owns credentials now.
--
-- The DEFAULT is what keeps the client diff small: the app never sends user_id on an insert,
-- Postgres fills it from the JWT, and the WITH CHECK proves it matches. A forged user_id in a
-- request body is rejected rather than ignored.
--
-- Backfill: every existing row predates multi-user and belongs to the one real account.
-- ═══════════════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  t text;
  -- Looked up by id, not by email: this file is in a public repo and an email address here
  -- would hand a reader the login identity for the app. The uuid grants nothing on its own.
  owner_id uuid := (select id from auth.users where id = '10575e31-6c18-4d95-8f71-8fff682d29ef');
  tables text[] := array[
    'workouts', 'workout_sets', 'daily_logs', 'cardio_logs', 'conditioning_logs',
    'custom_exercises', 'session_templates', 'session_exercises', 'goals'
  ];
begin
  -- Fail loudly rather than backfilling NULLs and then failing the NOT NULL halfway through.
  if owner_id is null then
    raise exception 'No auth.users row for the owner id — create the account before running this';
  end if;

  foreach t in array tables loop
    execute format(
      'alter table public.%I add column if not exists user_id uuid references auth.users(id) on delete cascade', t);
    execute format('update public.%I set user_id = %L where user_id is null', t, owner_id);
    execute format('alter table public.%I alter column user_id set not null', t);
    execute format('alter table public.%I alter column user_id set default auth.uid()', t);
    execute format('create index if not exists %I on public.%I (user_id)', t || '_user_id_idx', t);

    execute format('alter table public.%I enable row level security', t);
    -- Both spellings the old policies used ("allow all" everywhere, "Allow all on goals" on goals).
    execute format('drop policy if exists "allow all" on public.%I', t);
    execute format('drop policy if exists "Allow all on goals" on public.%I', t);
    execute format('drop policy if exists "owner access" on public.%I', t);
    execute format(
      'create policy "owner access" on public.%I for all to authenticated '
      'using (user_id = auth.uid()) with check (user_id = auth.uid())', t);

    -- RLS alone would already block anon (the policy is `to authenticated`), but removing the
    -- grant means anon is refused at the permission layer before any policy is even evaluated.
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- daily_logs was UNIQUE(date) globally, which is the single-user assumption baked into a
-- constraint: a second account could never log a day this one had already logged. Scope it.
-- The iOS Shortcut's upsert moves from ?on_conflict=date to ?on_conflict=user_id,date —
-- user_id still comes from the DEFAULT, the Shortcut only names the constraint. See RTFM.md.
alter table public.daily_logs drop constraint if exists daily_logs_date_key;
alter table public.daily_logs add constraint daily_logs_user_date_key unique (user_id, date);

-- quotes is shared app content, not user data — no user_id, read-only to any logged-in user.
alter table public.quotes enable row level security;
drop policy if exists "allow all" on public.quotes;
drop policy if exists "read quotes" on public.quotes;
create policy "read quotes" on public.quotes for select to authenticated using (true);
revoke all on public.quotes from anon;
revoke insert, update, delete on public.quotes from authenticated;
grant select on public.quotes to authenticated;

-- The old auth, now dead. password_hash was unsalted single-round SHA-256 and the hash travelled
-- as a POST body to a SECURITY DEFINER RPC that returned a boolean the client was free to ignore.
drop function if exists public.login(text, text);
drop table if exists public.app_user;

commit;
