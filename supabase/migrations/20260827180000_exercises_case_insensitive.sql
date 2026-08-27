-- E4 · ONE LIFT, ONE ROW — case- and whitespace-insensitively (27 August 2026)
--
-- `exercises_user_name_key` is UNIQUE (user_id, name) *exactly*. To the database, "Pull-Ups",
-- "pull-ups" and "Pull Ups " were three different lifts, each with its own uuid and its own half of
-- the history — and nothing in the app could tell they were the same thing. That is the same class
-- of bug the 20 Aug exercise-id pass fixed for RE-spellings; this is what it left open for
-- re-CASINGS. Del's live data already carried five splits of the first kind before it was found.
--
-- PROFILED BEFORE WRITING, against the live project, not against these docs:
--   exercises          0 groups where lower(btrim(name)) repeats per user
--   custom_exercises   0
--   workout_sets       0 (distinct spellings of one lower(btrim(exercise)))
--   session_exercises  0
--   exercises          0 rows where name <> btrim(name)
-- Nothing to merge, so this is pure prevention — which is exactly why it goes in TODAY. A second
-- account was created through the app this morning (27 Aug, 09:06) and has no history yet. Once it
-- does, this migration stops being free.
--
-- ⚠️ WRITTEN AGAINST THE link_exercise LANDMINE. `exercise_id_for()` is the function BOTH
-- link_exercise triggers call (workout_sets.exercise, session_exercises.name, custom_exercises.name),
-- and it CREATES the exercises row when the name is new. Adding the index on its own would convert
-- every case variant from a silent history split into a hard 23505 in the middle of a set save.
-- So the LOOKUP is widened in the same migration, and it goes first: after this, logging a set as
-- "pull-ups" links to the "Pull-Ups" that already exists instead of forking it.
--
-- WHAT THIS DELIBERATELY DOES NOT DO — it does not rewrite the text the client sent. A set logged
-- as "pull-ups " keeps that text in workout_sets.exercise while pointing at the "Pull-Ups" row, so
-- the orphan check (CHANGELOG, 26 Aug) can report `e.name is distinct from s.exercise` for a
-- trailing space. That is cosmetic and the client trims both entry points already; forking the
-- history was not. Canonicalising the text column is a separate job with its own rename ordering.

-- ── 1. The lookup: resolve a name to a lift the way a human reads it ──────────────────────────
create or replace function public.exercise_id_for(p_user uuid, p_name text)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare v_id uuid;
begin
  if p_user is null or p_name is null or btrim(p_name) = '' then return null; end if;

  select id into v_id from public.exercises
   where user_id = p_user and lower(btrim(name)) = lower(btrim(p_name));

  if v_id is null then
    -- No arbiter on the conflict clause on purpose. There are now TWO unique indexes this insert
    -- can land on — (user_id, name) and (user_id, lower(btrim(name))) — and naming one of them
    -- means a concurrent insert of the other spelling raises instead of being swallowed. The
    -- re-select below is what turns either loss into the id that won.
    insert into public.exercises (user_id, name, slug) values (p_user, p_name, '')
      on conflict do nothing returning id into v_id;
    if v_id is null then
      select id into v_id from public.exercises
       where user_id = p_user and lower(btrim(name)) = lower(btrim(p_name));
    end if;
  end if;

  return v_id;
end
$function$;

-- ── 2. The backstop ───────────────────────────────────────────────────────────────────────────
-- Mirrors exercise_catalogue_name_lower_key, which has guarded the shared catalogue since 24 Aug.
-- The exact-name index stays: it is what merge_exercises() and every on-conflict path already
-- assume, and it costs nothing to keep both.
create unique index if not exists exercises_user_name_lower_key
  on public.exercises (user_id, lower(btrim(name)));
