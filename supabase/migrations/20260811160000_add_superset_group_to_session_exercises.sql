-- Supersets that are part of the session itself, not just decided on the day.
--
-- workout_sets.superset_group (20260811120000) records what was actually paired in a given workout.
-- This is the template side of the same idea: a pairing you always do on Upper A shouldn't have to be
-- rebuilt from the picker every single week. Same shape and same meaning — every exercise in one
-- superset shares a tag ('1', '2', … scoped to that session template), null is a standalone exercise,
-- which is every row that exists today. The in-gym picker still overrides it for the day.
alter table session_exercises add column if not exists superset_group text;
