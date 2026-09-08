-- Warm-up sets (8 September 2026)
--
-- Del: "Add warmup sets, not working sets" — lower weight, higher reps, to warm the muscle before
-- the working sets. Nothing for this existed: a case-insensitive grep for "warm" across the whole
-- front end returned zero.
--
-- ⭐ THE ONLY DECISION IN HERE THAT COULD NOT BE UNDONE IS THE NUMBERING, AND THIS IS IT.
-- A warm-up does NOT take set_number 1 and push the working sets down. Both sequences start at 1
-- and are told apart by `set_type`, so working set 1 stays working set 1 for every row already in
-- the table and every row after it. The alternative — one shared sequence — would have shifted
-- every per-set comparison the app makes (the overload panel's LAST and BEAT, prevSetsForVariation,
-- the PB flags in computeExerciseProgress) against four months of its own history, silently.
--
-- Applied to the linked project with `supabase db query --linked` and verified back; this file is
-- the record. Do NOT run `supabase db push` (see project notes).

-- 823 rows existed when this ran. The default is what stamps every one of them as working sets,
-- which is what they are, and it is why nothing downstream needs a backfill.
alter table public.workout_sets
  add column if not exists set_type text not null default 'working';

alter table public.workout_sets
  drop constraint if exists workout_sets_set_type_chk;
alter table public.workout_sets
  add constraint workout_sets_set_type_chk check (set_type in ('working', 'warmup'));

-- ⚠️ THE UNIQUE KEY HAS TO GAIN set_type OR THE FEATURE CANNOT BE SAVED AT ALL.
-- It was UNIQUE (workout_id, exercise, set_number), so a warm-up 1 and a working 1 of the same
-- exercise in the same workout collide on insert — and Mark Done writes both in one POST.
alter table public.workout_sets
  drop constraint if exists workout_sets_workout_exercise_set_key;
alter table public.workout_sets
  add constraint workout_sets_workout_exercise_set_key
  unique (workout_id, exercise, set_type, set_number);

-- How many warm-up rows an exercise opens with. Separate from `sets` on purpose and never folded
-- into it: `sets` is the number of WORKING sets and the whole app keys off that.
--
-- ⚠️ This is written from the LOGGER, not only from the ✎ editor — see persistWarmupCount(). It is
-- the one stepper that writes its template, because a warm-up count is a property of how you train
-- a lift rather than a decision about this morning.
alter table public.session_exercises
  add column if not exists warmups integer not null default 0;
