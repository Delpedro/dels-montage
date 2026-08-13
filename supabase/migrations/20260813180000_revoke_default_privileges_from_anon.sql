-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Make the anon lockout automatic instead of remembered — 13 Aug 2026
--
-- The 13 Aug auth migration revoked every existing table grant from `anon`, so the publishable
-- key in js/app.js opens nothing on its own. That fix covered the tables that existed on the day.
--
-- The gap: Supabase ships default privileges that grant **every newly created table in `public`**
-- to `anon` and `authenticated` automatically. So the next `create table` re-opens the hole, and
-- the only thing standing between the database and a repeat of the exact problem that took a day
-- to close is somebody remembering the checklist in CURRENT_STATUS.md → Traps.
--
-- ALTER DEFAULT PRIVILEGES changes what future objects inherit. It is not retroactive — existing
-- tables keep the grants they have (which are already correct, per the 13 Aug migration) — and it
-- only applies to objects created by the named role, which is why `postgres` is named explicitly:
-- that is the role migrations and the SQL editor run as.
--
-- After this, a new table is unreachable by `anon` from the moment it exists. It still needs its
-- `user_id uuid not null default auth.uid()` column and its `user_id = auth.uid()` policy, or it
-- will be readable by *any* logged-in user — that half of the checklist can't be automated away.
-- ═══════════════════════════════════════════════════════════════════════════════════════

begin;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

-- Belt and braces: the same, unqualified. Covers objects created by whichever role is executing
-- this statement, if that ever differs from `postgres`.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

commit;
