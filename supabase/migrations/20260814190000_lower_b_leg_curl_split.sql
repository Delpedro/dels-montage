-- Lower B: two leg curls instead of one exercise wearing two hats (14 Aug 2026)
--
-- Del does a single-leg curl supersetted with Seated Calf Raise, then a seated leg curl later in the
-- same session. That was inexpressible: one exercise name = one block per session (workout_sets has
-- unique (workout_id, exercise, set_number), the DOM block id is block-<name>, and prev/PR lookup keys
-- off the name), so the second slot had nowhere to record weight, sets or reps. The "Single Leg" /
-- "Machine" variation toggle on the Leg Curl row was an attempt at the same thing and can't work —
-- a variation is one block with a tag, not two slots.
--
-- So: `Leg Curl` becomes `Seated Leg Curl`, which is what that row has always meant, and
-- `Single Leg Curl` joins the session as its own exercise paired with Seated Calf Raise.
--
-- Logged history is NOT touched. The 24 `Leg Curl` rows in workout_sets keep their name and follow the
-- renamed template row via `aliases`, which is the mechanism that exists for exactly this (the app
-- reads it in renderExerciseBlock, the Last Time card and History's progress calc). In particular the
-- 3 sets from 7 Aug tagged "Single Leg" at 52–54kg stay where they are: the weights match the 14 Aug
-- seated sets rather than the 10kg Single Leg Curl work, so they were probably mislabelled — but "probably"
-- is not a good enough reason to rewrite training history, and Del can't recall the session either way.
--
-- Applied live via `supabase db query --linked` on 14 Aug 2026. Backup of the pre-change rows:
-- .backup/20260814-legcurl/ (gitignored).

begin;

-- 1 · The seated machine gets the name it always meant. The alias carries Apr–Aug's history onto it,
--     and the variation list goes: "Single Leg" is a separate exercise now, and "Machine" only ever
--     meant "the seated machine", which is the row's own name.
update session_exercises
   set name = 'Seated Leg Curl',
       aliases = '["Leg Curl"]'::jsonb,
       variations = null
 where session_id = 'lower-b'
   and name = 'Leg Curl';

-- 2 · Make room at slot 1, directly after Seated Calf Raise. The pairing below is what puts the two
--     next to each other on screen, but base order decides where they sit as a block — and the
--     superset is the first thing done in the session.
update session_exercises
   set sort_order = sort_order + 1
 where session_id = 'lower-b'
   and sort_order >= 1;

-- 3 · Single Leg Curl as its own exercise. user_id is copied from a sibling row rather than left to
--     the auth.uid() default, because the CLI runs as a privileged role with no auth context.
insert into session_exercises (session_id, name, sets, reps, rest, sort_order, superset_group, user_id)
select 'lower-b', 'Single Leg Curl', 3, '10–12', '60s', 1, '1', user_id
  from session_exercises
 where session_id = 'lower-b' and name = 'Seated Calf Raise';

-- 4 · Pair them. Same tag semantics as everywhere else: shared tag = one superset, null = standalone.
update session_exercises
   set superset_group = '1'
 where session_id = 'lower-b'
   and name = 'Seated Calf Raise';

commit;
