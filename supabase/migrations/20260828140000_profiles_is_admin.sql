-- ═══════════════════════════════════════════════════════════════════════════════════════
-- profiles.is_admin — the backup nag belongs to Del, not to everyone. 28 Aug 2026 (E17)
--
-- Del, 27 Aug, on a screenshot of the second account's Home: "backups for normal users - NO !!".
--
-- Home carries a line that reads "No backup yet — tap to save a copy of your training history".
-- It exists for one honest reason: Del's four months of training sit in a single free-tier
-- database with no automated backups, and tools/backup.js only runs while his PC is awake. That
-- is HIS hosting decision about HIS data. On somebody else's Home the identical sentence reads as
-- the app admitting it might lose their history — the worst possible first impression for an app
-- he intends to charge for, and a promise he would then have to keep.
--
-- ⛔ THIS IS THE NAG ONLY. "Export my data" stays visible to every account: getting your own
-- training history out of an app is EU data portability (GDPR Article 20) and Del is in Ireland.
-- Gating the export would be the one change here that is actually unlawful.
--
-- WHY A COLUMN AND NOT A HARDCODED UUID IN THE CLIENT. The uuid is already public (this repo is,
-- and 20260821220000 carries it), so hiding it is not the point — the point is that the app must
-- not have to be rebuilt to grant or revoke this, and that the server, not the JavaScript, is what
-- decides. A client-side `if (user.id === '...')` is a decision anyone can edit in devtools.
--
-- WHY A TRIGGER AND NOT JUST RLS. The profiles policy is `for all ... using (user_id = auth.uid())`
-- — owner-only, which is correct, and which means the owner may write EVERY column of their own
-- row. Without the guard below, granting yourself admin is one PATCH with `{"is_admin":true}` and
-- the flag is decoration. A policy cannot fix this on its own: WITH CHECK sees only the new row, so
-- there is no way to say "unchanged from what it was" in a policy.
--
-- A column-level GRANT was the other option and was rejected: it means every column added to this
-- table from now on has to be remembered in a grant list, and the day one is forgotten the symptom
-- is a write silently failing rather than anything pointing here. The trigger covers columns that
-- do not exist yet.
-- ═══════════════════════════════════════════════════════════════════════════════════════

begin;

-- NOT NULL DEFAULT FALSE, so every row that already exists and every row written from here answers
-- the question without the app having to handle a null. The client reads `is_admin === true` and
-- nothing else is admin — a missing column, a failed read and an un-onboarded account all land on
-- "not admin", which is the direction that cannot hurt anybody.
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- SECURITY INVOKER (the default, stated so nobody re-adds definer — it needs no privilege the
-- caller lacks) and search_path pinned to the empty string, matching the other nine functions in
-- `public`. See 20260824220000 for why empty rather than `public`.
create or replace function public.profiles_pin_is_admin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  -- No JWT on the request means this is not a person: a migration applied over the connection
  -- string, or a service-role call. Those may set the flag — it is how the row below gets it, and
  -- how a second admin would ever be granted one. auth.uid() reads request.jwt.claims with the
  -- missing_ok flag, so it returns NULL here rather than raising.
  if auth.uid() is null then
    return new;
  end if;

  -- Everything arriving through PostgREST — Del's own app included — gets the flag it already had.
  -- Not an exception raised: a rejected onboarding POST is a person stuck on a form over a column
  -- they never asked about. Silently pinning the value does the same job with no casualties.
  if tg_op = 'INSERT' then
    new.is_admin := false;
  else
    new.is_admin := old.is_admin;
  end if;

  return new;
end
$fn$;

-- BEFORE INSERT **OR UPDATE**: insert matters as much as update, because onboarding writes the row
-- with a POST and could otherwise ship `is_admin: true` in the very first body the account sends.
drop trigger if exists profiles_admin_guard on public.profiles;
create trigger profiles_admin_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_pin_is_admin();

-- The one admin. By id, not by email — this file is in a public repo and the address is a login
-- identity. Same uuid as 20260813120000 and 20260821220000, looked up the same way.
--
-- Deliberately AFTER the trigger rather than before it: this statement is the proof that the
-- escape hatch above works. If it silently changes nothing, the verification below says so
-- immediately, which is worth more than dodging the question by ordering around it.
update public.profiles
   set is_admin = true
 where user_id = '10575e31-6c18-4d95-8f71-8fff682d29ef';

commit;

-- A NEW COLUMN IS INVISIBLE TO PostgREST UNTIL THE SCHEMA CACHE RELOADS, and loadProfile() asks for
-- `select=*`. Without this the app keeps reading a profile with no is_admin on it and nobody, Del
-- included, ever sees the reminder again.
notify pgrst, 'reload schema';
