-- 21 Aug 2026 — rest prescriptions raised on the compound lifts.
--
-- Del, after Friday's Upper 1: "i felt todays workout load was too high, i was dropping reps from
-- last week on chest". The set data says the rest prescription was part of it. His own logged rests
-- on the 90s-prescribed compounds already run ~100s (Incline DB Press 102s, Machine Chest Press
-- 100s, Incline DB Fly 97/106s on 21 Aug) — so the ring was going green while he was still recovering
-- and the prescription was under-reporting what he actually needs.
--
-- 90s is a hypertrophy-isolation number. For a compound press or pull taken to 8-12 near failure the
-- evidence-based figure is 2-3 minutes; the drop from set 1 to set 3 on Machine Chest Press
-- (42.5kg 9-8-6 on 15 Aug) is the classic signature of resting too short on a compound.
--
-- Deliberately NOT touched:
--   - the 180s heavies (Incline Chest Press, Hack Squat / Leg Press, Leg Press) — already right
--   - every 60s isolation — 60s is correct for 12-15 rep side delts, calves, pushdowns
--   - Incline DB Fly / Rear Delts / Single-Arm Cable Lateral Raise at 90s — isolation, 90s is right.
--     The 34s he took on the Single-Arm raise is him rushing, not the prescription.
--   - RDL at 120s — already at the new figure
--
-- This is prescription only. workout_sets.rest_seconds — the measured history — is untouched.
-- One query reverts it: set the same rows back to 90s/90s/90s/75s.

update session_exercises set rest = '120s'
where (session_id, name) in (
  ('upper-a','Incline DB Press'),
  ('upper-a','Machine Chest Press'),
  ('upper-a','Shoulder Press'),
  ('upper-a','Dips'),
  ('upper-b','Pull-Ups'),
  ('upper-b','Lat Pulldown'),
  ('upper-b','Chest Supported Row'),
  ('upper-b','T Bar Row'),
  ('lower-a','Farmers Walk')
);

-- A squat prescribed at 8-12 was resting the same as a lateral raise.
update session_exercises set rest = '150s'
where session_id = 'lower-a' and name = 'Pendulum Squat';

update session_exercises set rest = '90s'
where (session_id, name) in (
  ('upper-b','Hammer Curl'),
  ('lower-a','Lying Leg Curl')
);
