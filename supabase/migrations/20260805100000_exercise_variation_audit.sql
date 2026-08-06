-- Variation audit requested 5 Aug — user confirmed which exercises get equipment toggles and
-- what the real options are at their gym.

update session_exercises set variations = '["Machine","DB"]'
where name = 'Chest Supported Row';

-- 3 leg press machines at this gym: two plate-loaded, one pin/weight-stack.
update session_exercises set variations = '["Plate 1","Plate 2","Pin"]'
where name = 'Leg Press';

update session_exercises set variations = '["Old","New"]'
where name = 'Lat Pulldown';

-- Attachment choice, same set for both tricep exercises.
update session_exercises set variations = '["Rope","Bar","V-Bar","Band"]', note = null
where name in ('Overhead Cable Tricep Ext', 'Tricep Pushdown');

-- Renamed 'Smith RDL' -> 'RDL' now it covers more than the Smith variant (same pattern as the
-- earlier Smith Machine Incline Press -> Incline Chest Press rename) — alias keeps old logged
-- history ('Smith RDL') matching via renderExerciseBlock/loadPreviousSetsForSession's alias fallback.
update session_exercises
set name = 'RDL', variations = '["Smith","DB","Oly Bar"]', aliases = '["Smith RDL"]'
where name = 'Smith RDL';

-- Gym has a single-leg curl machine and a separate pin/weight-stack leg curl machine, distinct
-- from the already-separate 'Lying Leg Curl' exercise (Lower A) which stays as its own entry.
update session_exercises set variations = '["Single Leg","Machine"]'
where name = 'Leg Curl';
