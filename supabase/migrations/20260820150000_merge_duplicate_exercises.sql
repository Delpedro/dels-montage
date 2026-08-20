-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Merging the duplicate spellings — 20 Aug 2026
--
-- The follow-up to 20260820140000, and the reason that one was done first. Four lifts were in the
-- data under more than one name, each spelling holding its own slice of the progression:
--
--   Seated Row + Seated Row (Mach) + Seated Row Mach   →  Seated Row
--   Pull Ups + PullUps                                  →  Pull-Ups
--   Sitting BB curl (restrict)                          →  Sitting BB Restricted Curl
--   Farmer Walks                                        →  Farmers Walk
--
-- Del's call, one name per lift, 20 Aug. This is a real data change, so it was profiled first:
-- no two spellings share a (workout_id, set_number), so nothing collides with the UNIQUE key on
-- workout_sets, and none of the affected rows carries a stored `variation` that could be
-- invalidated. Nothing is deleted except the now-empty exercises rows and, where both spellings
-- had one, a duplicate custom_exercises row.
--
-- Merging is repointing an id, which is only possible because the ids exist. Doing it name-first
-- would have been a find-and-replace across three tables with no way to tell a missed row from a
-- deliberate one.
--
-- Also here, because it is the other half of the same decision: Seated Row gets the variation
-- picker Del asked for — Pully / Machine / High Row / Low Row, "there is a few options in my gym".
-- Variations used to live only on session_exercises, i.e. only on exercises that belong to a fixed
-- template. Seated Row belongs to none, so `exercises` grows a `variations` column and the app
-- merges it into EXERCISE_LIBRARY. That is the natural home for it now the table exists: a
-- variation list describes the lift, not the session it happens to appear in.
--
-- NOT touched, because they were not asked for and are their own question:
--   * `High Row` is a standalone exercise with 5 sets of its own. It is offered here as a Seated
--     Row *option*, which is not the same as saying those 5 sets were Seated Rows.
--   * `Seated Cable Row` is a template exercise (upper-b, full-body-c) with its own Cable/Machine
--     toggle and 6 sets.
--   * `Incline DB Curl` / `DB Incline Curl` — the fifth pair, still unanswered.
-- ═══════════════════════════════════════════════════════════════════════════════════════

begin;

-- ─── MERGE ──────────────────────────────────────────────────────────────────────────
-- Refuses rather than silently dropping. A merge that quietly lost a set would be far worse than
-- one that stops and asks — and every check below was verified to pass against the live data
-- before this ran, so a raise here means the data has changed since and deserves a fresh look.
create or replace function public.merge_exercises(p_from uuid, p_into uuid) returns void
language plpgsql as $fn$
declare v_name text; v_user uuid; v_from text;
begin
  if p_from = p_into then return; end if;

  select name, user_id into v_name, v_user from public.exercises where id = p_into;
  if v_name is null then raise exception 'merge_exercises: no target exercise %', p_into; end if;
  select name into v_from from public.exercises where id = p_from and user_id = v_user;
  if v_from is null then
    raise exception 'merge_exercises: source % is missing, or belongs to another user', p_from;
  end if;

  -- workout_sets is UNIQUE(workout_id, exercise, set_number): if one workout logged both spellings
  -- at the same set number, the second row cannot survive the rename and the merge must not guess
  -- which one to keep.
  if exists (
    select 1 from public.workout_sets a
      join public.workout_sets b on a.workout_id = b.workout_id and a.set_number = b.set_number
    where a.exercise_id = p_from and b.exercise_id = p_into
  ) then
    raise exception 'merge_exercises: % and % both hold a set in the same workout at the same set number', v_from, v_name;
  end if;

  update public.workout_sets set exercise_id = p_into, exercise = v_name where exercise_id = p_from;

  -- A template cannot list the same exercise twice, so where both spellings sit in one session the
  -- loser goes rather than becoming a duplicate row.
  delete from public.session_exercises a using public.session_exercises b
    where a.exercise_id = p_from and b.exercise_id = p_into and a.session_id = b.session_id;
  update public.session_exercises set exercise_id = p_into, name = v_name where exercise_id = p_from;

  -- custom_exercises.name is still GLOBALLY unique (the 13 Aug per-user pass scoped daily_logs and
  -- left this one), so the source row cannot simply be renamed onto the target's name.
  delete from public.custom_exercises where exercise_id = p_from
    and exists (select 1 from public.custom_exercises c where c.exercise_id = p_into);
  update public.custom_exercises set exercise_id = p_into, name = v_name where exercise_id = p_from;

  delete from public.exercises where id = p_from;
end $fn$;

-- ─── DEL'S FOUR DECISIONS ───────────────────────────────────────────────────────────
-- Pull Ups is merged under its existing spelling and renamed afterwards: Del asked for "Pull-Ups",
-- which is a third spelling neither row used, and merging into a name that does not exist yet would
-- have nothing to merge into. OPTIONAL_WEIGHT_EXERCISES in js/app.js already lists both 'pull ups'
-- and 'pull-ups', so the hyphen does not cost the exercise its weight box.
do $$
declare r record;
begin
  for r in
    select f.id fid, t.id tid
    from (values
      ('Seated Row (Mach)',          'Seated Row'),
      ('Seated Row Mach',            'Seated Row'),
      ('PullUps',                    'Pull Ups'),
      ('Sitting BB curl (restrict)', 'Sitting BB Restricted Curl'),
      ('Farmer Walks',               'Farmers Walk')
    ) as m(src, dst)
    join public.exercises f on f.name = m.src
    join public.exercises t on t.name = m.dst and t.user_id = f.user_id
  loop
    perform public.merge_exercises(r.fid, r.tid);
  end loop;
end $$;

do $$
declare v_id uuid;
begin
  for v_id in select id from public.exercises where name = 'Pull Ups' loop
    perform public.rename_exercise(v_id, 'Pull-Ups');
  end loop;
end $$;

-- ─── VARIATIONS BELONG TO THE LIFT ──────────────────────────────────────────────────
-- Read by loadExerciseIds() and merged into EXERCISE_LIBRARY, so an exercise that is in no fixed
-- template can still offer a picker. A template's own session_exercises.variations still wins where
-- it has one — that list is scoped to the session on purpose (see the 19 Aug Incline Press change,
-- where Upper A and Full Body A needed Smith/BB while the DB variant stayed a separate exercise).
alter table public.exercises add column if not exists variations jsonb;

update public.exercises
   set variations = '["Pully","Machine","High Row","Low Row"]'::jsonb
 where name = 'Seated Row';

commit;
