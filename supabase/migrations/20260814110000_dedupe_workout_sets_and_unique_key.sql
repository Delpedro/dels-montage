-- Duplicate sets: the damage, and the constraint that makes a repeat impossible.
--
-- CAUSE (fixed in js/app.js the same day): completeExercise() had no re-entrancy guard, and
-- saveExerciseSets() is three round trips — GET existing rests, DELETE the exercise's rows, POST the
-- new ones. On gym Wi-Fi that is over a second, during which the button still said "Mark Done" and
-- stayed tappable. A second tap started a second run whose DELETE completed before the first run's
-- POST landed, so both POSTs inserted. Nothing failed, nothing toasted, and the block went green.
--
-- EXTENT: 35 (workout, exercise, set_number) groups across 12 sessions between 1 May and 14 Aug
-- 2026, holding 90 rows where 35 belonged — up to 5 copies of one set (Shoulder Press, 19 May).
-- Every group was verified identical in weight, reps and variation before anything was deleted:
-- only `rest_seconds` and `id` differed, because the stopwatch PATCHes `existing[0]` and so wrote
-- the rest onto whichever copy came back first. That is why avg rest was wrong as well as set
-- counts and volume.
--
-- The surviving row is the one carrying the LARGEST rest_seconds, so the real recorded rest is kept
-- rather than a zero from a copy the stopwatch never reached. Pre-delete dump of all 90 rows is in
-- .backup/20260814-dedupe/duplicate-sets-before.json (gitignored) if this ever needs reversing.
-- Applied live 14 Aug 2026: 824 rows → 769.
with ranked as (
  select id, row_number() over (
    partition by workout_id, exercise, set_number
    order by coalesce(rest_seconds, 0) desc, id
  ) as rn
  from workout_sets
)
delete from workout_sets s using ranked r where r.id = s.id and r.rn > 1;

-- The app-level guard is the fix; this is the backstop, and it is the one that cannot be forgotten
-- by a future refactor. A set IS (workout, exercise, set_number) — that is how the logger addresses
-- it (`r-${name}-${i}`), how the stopwatch finds it and how the edit modal PATCHes it, so the
-- constraint states something already true rather than imposing a new rule. Both write paths stay
-- legal: saveExerciseSets() DELETEs before it POSTs, and saveEditWorkout() PATCHes by id when a row
-- exists and only POSTs when one doesn't. A concurrent double-save now gets a 409 and a "not saved —
-- tap Mark Done again" toast, which is a far better failure than silently doubling the row.
alter table workout_sets
  add constraint workout_sets_workout_exercise_set_key
  unique (workout_id, exercise, set_number);
