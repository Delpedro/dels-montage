-- Upper A listed "Incline Chest Press" with a Smith/DB toggle and then, one row below it, a
-- separate "Incline DB Press". Two ways to log the same dumbbell movement, on the same screen,
-- three inches apart — whichever one you picked, half your incline dumbbell history lived under
-- the other. The toggle now offers Smith or BB, so the barbell version has a home and the
-- dumbbell version has exactly one.
--
-- The six existing DB sets on Incline Chest Press (24 and 31 Jul 2026) are left where they are:
-- they are real sets and History reads sets directly, so they still show. They simply no longer
-- have a chip to prefill from, which is correct — BB is not DB.
update session_exercises
set variations = '["Smith","BB"]'
where name = 'Incline Chest Press'
  and session_id in ('upper-a', 'full-body-a');
