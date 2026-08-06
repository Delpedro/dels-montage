-- Hammer Curl had no variation toggle (single implicit option). Adds DB / Cable (pulley machine),
-- matching the existing "New/Old"-style equipment toggles on other exercises.
update session_exercises
set variations = '["DB","Cable"]'
where name = 'Hammer Curl';
