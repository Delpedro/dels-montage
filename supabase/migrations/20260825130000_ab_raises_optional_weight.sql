-- Lower AB leg raises can be loaded. 25 Aug 2026, Del: "Ab Raises need the ability to add wgt
-- (not always BW)" — he had done them at 3.5kg and had nowhere to record it, so the weight went in
-- the session notes as free text and counts towards no progression anywhere.
--
-- This is the first change the shared catalogue absorbs on its own: isOptionalWeight() reads
-- exercise_catalogue before it reads the hardcoded spelling list, so the flag is the whole fix and
-- no app code moves. The bodyweight flag stays true — optional_weight wins wherever the two meet,
-- which is what gives the row its "BW, tap to add weight" cell rather than a fixed BW label.
update public.exercise_catalogue
   set optional_weight = true
 where lower(btrim(name)) = 'lower ab leg raises';
