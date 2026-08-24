-- ─── CATALOGUE HARDENING (24 Aug 2026, same night) ────────────────────────────────────────────
--
-- Del asked whether a second reviewer would find flaws in 20260824210000. It would have found these
-- three, so they are fixed here rather than left for it. All three are mine, from tonight.
--
--   1. THE UNIQUENESS DID NOT MATCH THE LOOKUP. The table was unique on `name` exactly, but every
--      single lookup against it — the link trigger, the backfill, and CATALOGUE_BY_KEY in app.js —
--      keys on lower(btrim(name)). So "Pull-Ups" and "pull-ups" could both have existed as separate
--      catalogue rows, and then: the trigger's `limit 1` with no ORDER BY would pick one
--      arbitrarily, and app.js's map would silently keep whichever loaded last. Two users could
--      have been shown different metadata for the same lift, non-deterministically. A guarantee
--      that is not the guarantee the code relies on is not a guarantee.
--
--   2. THE LINK WENT STALE ON RENAME. The trigger was BEFORE INSERT only, but rename_exercise()
--      (migration 20260820140000) updates exercises.name in place. Renaming "Pull-Ups" to
--      "Bench Press" left the row still pointing at the Pull-Ups catalogue row — so it would have
--      kept Pull-Ups' optional_weight flag, and a future exercise-media feature would have shown a
--      pull-up clip on a bench press. The existing link_exercise trigger is BEFORE INSERT OR UPDATE
--      for exactly this reason; mine should have matched it and did not.
--
--   3. IT WAS SECURITY DEFINER FOR NO REASON. It reads one table that every authenticated user is
--      already granted SELECT on. Definer was unnecessary privilege on a trigger attached to a
--      user-writable table, which is a pattern worth not having in a paid app.

-- ── 1. Unique on what the code actually looks up ──
-- Added alongside the exact-name unique rather than replacing it: the exact one still stops a
-- literal duplicate, this one stops a case/whitespace duplicate, and together they make the
-- trigger's single-row assumption true by construction instead of by luck.
create unique index if not exists exercise_catalogue_name_lower_key
  on public.exercise_catalogue (lower(btrim(name)));

-- ── 2. Names cannot be empty or absurd ──
-- The app caps the field at 60 characters, but the app is not the only way in: a signed-in user can
-- POST straight to PostgREST with their own JWT. Longest real name across all three tables today is
-- 30, so 80 is generous and validates against existing rows without a rewrite.
alter table public.exercise_catalogue drop constraint if exists exercise_catalogue_name_sane;
alter table public.exercise_catalogue add constraint exercise_catalogue_name_sane
  check (btrim(name) <> '' and length(name) <= 80);

alter table public.exercises drop constraint if exists exercises_name_sane;
alter table public.exercises add constraint exercises_name_sane
  check (btrim(name) <> '' and length(name) <= 80);

alter table public.custom_exercises drop constraint if exists custom_exercises_name_sane;
alter table public.custom_exercises add constraint custom_exercises_name_sane
  check (btrim(name) <> '' and length(name) <= 80);

-- ── 3. The link survives a rename, and drops least privilege ──
-- The shape is copied from link_exercise_from_name_col() deliberately: same three-part condition,
-- so the two triggers on this row behave the same way and there is one rule to remember, not two.
--
-- `select ... into` leaves NULL when nothing matches, which is the correct answer for a rename to a
-- name the catalogue has never heard of — better a null link than a confidently wrong one.
--
-- SECURITY INVOKER (the default, stated here so nobody re-adds definer): the function reads only
-- exercise_catalogue, which `authenticated` is granted SELECT on and whose policy is `using (true)`.
-- search_path stays pinned regardless — the advisor checks that on every function, not just definer
-- ones, and an unpinned search_path on a trigger is how a function gets tricked into reading the
-- wrong table.
create or replace function public.exercises_link_catalogue()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  if new.catalogue_id is null
     or (tg_op = 'UPDATE' and new.name is distinct from old.name
                          and new.catalogue_id is not distinct from old.catalogue_id) then
    select id into new.catalogue_id
      from public.exercise_catalogue
     where lower(btrim(name)) = lower(btrim(new.name));
  end if;
  return new;
end
$fn$;

drop trigger if exists exercises_catalogue on public.exercises;
create trigger exercises_catalogue
  before insert or update on public.exercises
  for each row execute function public.exercises_link_catalogue();

-- ── A NOTE FOR WHOEVER CHANGES CATALOGUE METADATA NEXT ──
-- The seed in 20260824210000 ends `on conflict (name) do nothing`, which means EDITING THAT FILE
-- AND RE-RUNNING IT CHANGES NOTHING. That is deliberate — a seed that overwrites would silently
-- revert any correction made since — but it is a trap if you do not know it. To change a lift's
-- metadata, or to add one, write a NEW migration with an explicit insert/update. Do not edit the
-- seed and expect it to apply.

-- ── 4. search_path = '' to match the other eight ──
-- The 24 Aug advisor pass (770834b) pinned every other function in `public` to the EMPTY string,
-- not to `public`. Empty is the stricter form: it resolves nothing implicitly, so every reference
-- has to be schema-qualified and there is no schema a caller could shadow. This function already
-- qualifies everything it touches, so it should have been '' from the start. Nine functions, one
-- rule — a lone exception is how the next audit gets a finding.
alter function public.exercises_link_catalogue() set search_path = '';
