-- Upper/Lower sessions: letters become numbers (21 Aug 2026)
--
-- Del: "Lets rename the upper and lower from a/b to 1/2". A and B never said which came first —
-- the rotation is Upper 1 → Lower 1 → Upper 2 → Lower 2, and a number reads as a position where a
-- letter reads as a variant.
--
-- NAMES ONLY. The ids stay `upper-a` … `lower-b`, and they must: `workouts.session_type` points at
-- them across every workout since 13 Jul, `session_exercises.session_id` hangs off them, and
-- sessionColourClass() reads `id.startsWith('upper')` for the tile colour. Renaming a session is
-- already a first-class operation in this app — the ✎ template editor edits `name` and never the
-- id — so this is that same edit, run once from here.
--
-- Full Body A/B/C is deliberately untouched: Del scoped this to the upper/lower programme.

update session_templates set name = 'Upper 1' where id = 'upper-a';
update session_templates set name = 'Lower 1' where id = 'lower-a';
update session_templates set name = 'Upper 2' where id = 'upper-b';
update session_templates set name = 'Lower 2' where id = 'lower-b';
