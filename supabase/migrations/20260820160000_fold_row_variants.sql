-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Folding the row variants, and the incline curl — 20 Aug 2026
--
-- Del's three answers to the questions left open by 20260820150000:
--
--   1. High Row         → Seated Row, as the "High Row" variation. He had already moved it into
--                         Seated Row's option list, so it was sitting there twice.
--   2. Seated Cable Row → Seated Row. "Its the same, fix please."
--   3. DB Incline Curl  → Incline DB Curl.
--
-- ─── THE PART THAT NEEDED CARE ──────────────────────────────────────────────────────
--
-- Two sessions logged more than one row variant, so merging them breaks
-- UNIQUE(workout_id, exercise, set_number) — merge_exercises() refuses, correctly, rather than
-- dropping a set. What Del actually did, by created_at:
--
--   21 Jul  Seated Row ×3 06:36 · High Row ×3 06:53 · Seated Cable Row ×3 07:14   → 9 sets
--   28 Jul  High Row ×2 09:40 · Seated Row ×3 09:58                                → 5 sets
--
-- Once they are one exercise those are simply nine and five sets of Seated Row, so the sets are
-- renumbered 1..n **in the order he actually logged them**. created_at is the honest sequence here:
-- rows are written per exercise as Mark Done is tapped, so it records the order of the session.
-- Renumbering runs in two phases (park at +10000, then assign) because after the merge every row
-- shares one name and assigning final numbers in place could transiently collide.
--
-- The sets that lose their own name are stamped with the variation that replaces it, so the
-- progression stays readable instead of dissolving into a generic Seated Row:
--
--   High Row's 5 sets         → variation 'High Row'
--   Seated Cable Row's 6 sets → variation 'Pully'   ← ASSUMPTION, see below
--
-- **The 'Pully' stamp is an inference and is the one thing here Del should sanity-check.** None of
-- those six sets recorded a variation, and the exercise's own toggle was Cable/Machine — a seated
-- *cable* row is the pulley one, so 'Pully' is the reading. It is one UPDATE to change.
--
-- Seated Row's own 8 pre-existing sets are left with no variation on purpose. Which machine they
-- were on is genuinely not recorded, and inventing one would be worse than leaving the gap.
-- ═══════════════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  v_seated uuid; v_high uuid; v_cable uuid;
  v_curl_from uuid; v_curl_into uuid;
  v_workouts uuid[];
begin
  select id into v_seated from public.exercises where name = 'Seated Row';
  select id into v_high   from public.exercises where name = 'High Row';
  select id into v_cable  from public.exercises where name = 'Seated Cable Row';

  if v_seated is null then raise exception 'no Seated Row to merge into'; end if;

  -- Captured BEFORE the names converge — afterwards there is no way to tell which workouts had
  -- more than one variant in them.
  select array_agg(wid) into v_workouts from (
    select workout_id wid from public.workout_sets
     where exercise_id in (v_seated, v_high, v_cable)
     group by workout_id having count(distinct exercise_id) > 1) t;

  -- ── Stamp the variation onto the sets about to lose their name ──
  if v_high is not null then
    update public.workout_sets set variation = 'High Row'
     where exercise_id = v_high and variation is null;
  end if;
  if v_cable is not null then
    update public.workout_sets set variation = 'Pully'
     where exercise_id = v_cable and variation is null;
  end if;

  -- ── Move the sources clear of the target's set numbers ──
  -- Still distinct exercise names at this point, so these offsets cannot collide with anything;
  -- they exist only so merge_exercises() has a clean run at the unique key.
  if v_workouts is not null then
    if v_high is not null then
      update public.workout_sets set set_number = set_number + 100
       where exercise_id = v_high and workout_id = any(v_workouts);
    end if;
    if v_cable is not null then
      update public.workout_sets set set_number = set_number + 200
       where exercise_id = v_cable and workout_id = any(v_workouts);
    end if;
  end if;

  if v_high  is not null then perform public.merge_exercises(v_high,  v_seated); end if;
  if v_cable is not null then perform public.merge_exercises(v_cable, v_seated); end if;

  -- ── One exercise now: renumber those sessions into the order they were trained ──
  if v_workouts is not null then
    update public.workout_sets set set_number = set_number + 10000
     where exercise_id = v_seated and workout_id = any(v_workouts);

    with ordered as (
      select id, row_number() over (partition by workout_id order by created_at, set_number) rn
        from public.workout_sets
       where exercise_id = v_seated and workout_id = any(v_workouts))
    update public.workout_sets w set set_number = o.rn
      from ordered o where w.id = o.id;
  end if;

  -- Seated Cable Row's template rows are Seated Row's rows now, and their Cable/Machine list would
  -- override the exercise-level one — leaving Del with a different picker inside a fixed session
  -- than outside it. Clear it so exercises.variations is the single list everywhere.
  update public.session_exercises set variations = null where exercise_id = v_seated;

  -- ── The curl ──
  select id into v_curl_from from public.exercises where name = 'DB Incline Curl';
  select id into v_curl_into from public.exercises where name = 'Incline DB Curl';
  if v_curl_from is not null and v_curl_into is not null then
    perform public.merge_exercises(v_curl_from, v_curl_into);
  end if;
end $$;

commit;
