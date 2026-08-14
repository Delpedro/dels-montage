-- "Lower AB leg raises" is a bodyweight exercise and was never flagged as one.
--
-- Reported twice by Del, most recently 14 Aug 2026: "still wont allow me put in BW". With
-- `bodyweight = false` and no entry in the app's OPTIONAL_WEIGHT_EXERCISES list, the row rendered an
-- ordinary kg box carrying `inputmode="decimal"` — and on iOS that is a NUMERIC KEYPAD WITH NO
-- LETTERS ON IT. The placeholder asked for a weight, the exercise has never had one, and the
-- keyboard physically could not type the two characters he wanted. Leaving it blank did save
-- correctly as null (which is why History reads "BW×18"), but nothing on screen said so.
--
-- `bodyweight = true` replaces the input with the fixed "BW" label Dead Bug already uses, so there
-- is nothing left to type. If a loaded version is ever wanted, the exercise goes in
-- OPTIONAL_WEIGHT_EXERCISES in js/app.js instead — that gives a "BW / kg" box where blank means
-- bodyweight. One line, no migration.
update session_exercises
   set bodyweight = true
 where name = 'Lower AB leg raises';

-- The 10 Aug rows stored a literal 0.0kg — Del typing a zero to mean "no weight" on the build
-- before optionalWeightValue() started folding a typed 0 down to null. Same value as every other
-- row of this exercise, stored differently, so it renders "0×25" instead of "BW×25".
update workout_sets
   set weight = null
 where exercise = 'Lower AB leg raises'
   and weight = 0;
