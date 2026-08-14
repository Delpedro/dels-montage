-- Per-account app state — 14 Aug 2026.
--
-- Created for one column, `last_backup_at`, but deliberately named for the general case rather than
-- `backups`: this is the "one row of small facts about this account's use of the app" table, and the
-- next thing that needs one (onboarding seen, a dismissed notice) belongs here rather than in
-- another single-column table.
--
-- WHY IT EXISTS AT ALL. The backup reminder on Home stored its timestamp only in localStorage, which
-- is per-browser and per-device. Del exported on his phone on 13 Aug and the PC browser said "No
-- backup yet" the next day — correct by the old design (a per-device nag about a per-device action)
-- and wrong by the thing it is actually claiming, because what gets backed up is the database, not
-- the device. A reminder that contradicts something you did yesterday is a reminder you learn to
-- ignore, which makes it worse than none.
--
-- localStorage does NOT go away — it stays as the offline-readable copy, and the app takes whichever
-- of the two is later. That keeps the property that motivated the original choice: the nag still
-- renders with no network, which is exactly the trip where it matters most.
--
-- UNIQUE on user_id, not just the primary key: it makes `?on_conflict=user_id` +
-- `Prefer: resolution=merge-duplicates` a legal upsert, so the client never has to read a row id
-- before it can write. Same idiom daily_logs uses for the Watch Shortcut.
create table if not exists public.app_meta (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  last_backup_at timestamptz,
  updated_at     timestamptz not null default now(),
  constraint app_meta_user_id_key unique (user_id)
);

-- Same shape as every other table since 20260813120000: owner-only, authenticated only, anon
-- refused at the grant layer before any policy is evaluated.
alter table public.app_meta enable row level security;

drop policy if exists "owner access" on public.app_meta;
create policy "owner access" on public.app_meta
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.app_meta from anon;
grant select, insert, update, delete on public.app_meta to authenticated;
