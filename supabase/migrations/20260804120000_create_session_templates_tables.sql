-- Moves the hardcoded SESSIONS array out of js/app.js into Supabase so fixed-programme
-- templates (exercise list, order, set counts) can be edited permanently in-app.
-- Seed data below is a 1:1 transcription of the SESSIONS array as of this migration,
-- plus two new variation toggles (Seated Cable Row, Incline Single Cable Curl).

create table session_templates (
  id text primary key,
  programme text not null,
  day text,
  name text not null,
  focus text,
  cardio boolean not null default false,
  sort_order int not null
);

create table session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references session_templates(id) on delete cascade,
  name text not null,
  sets int not null,
  reps text not null,
  rest text not null,
  note text,
  variations jsonb,
  aliases jsonb,
  band boolean not null default false,
  bodyweight boolean not null default false,
  sort_order int not null
);

alter table session_templates enable row level security;
alter table session_exercises enable row level security;
create policy "allow all" on session_templates for all using (true) with check (true);
create policy "allow all" on session_exercises for all using (true) with check (true);

-- ─── SESSION TEMPLATES ──────────────────────────────────────
insert into session_templates (id, programme, day, name, focus, cardio, sort_order) values
  ('upper-a', 'upper-lower', 'Monday', 'Upper A', 'Push focus', false, 0),
  ('lower-a', 'upper-lower', 'Tuesday', 'Lower A', 'Quad focus + core', false, 1),
  ('upper-b', 'upper-lower', 'Thursday', 'Upper B', 'Pull focus', false, 2),
  ('lower-b', 'upper-lower', 'Friday', 'Lower B', 'Posterior chain + core', false, 3),
  ('full-body-a', 'full-body-cv', null, 'Full Body A', 'Squat + push bias', false, 4),
  ('full-body-b', 'full-body-cv', null, 'Full Body B', 'Hinge + pull bias', false, 5),
  ('full-body-c', 'full-body-cv', null, 'Full Body C', 'Balanced performance', false, 6),
  ('cv-pump', 'full-body-cv', null, 'CV + Pump', 'One weak-point lift + cardio', true, 7);

-- ─── UPPER A ────────────────────────────────────────────────
insert into session_exercises (session_id, name, sets, reps, rest, note, variations, aliases, band, bodyweight, sort_order) values
  ('upper-a', 'Incline Chest Press', 3, '6–10', '180s', 'Start lighter than you think', '["Smith","DB"]', '["Smith Machine Incline Press"]', false, false, 0),
  ('upper-a', 'Machine Chest Press', 3, '8–12', '90s', null, null, null, false, false, 1),
  ('upper-a', 'Shoulder Press', 3, '8–12', '90s', null, '["Machine","Smith","DB"]', '["Machine Shoulder Press"]', false, false, 2),
  ('upper-a', 'Lateral Raise', 3, '12–15', '60s', null, '["DB","Machine"]', null, false, false, 3),
  ('upper-a', 'Overhead Cable Tricep Ext', 3, '10–15', '60s', null, null, null, false, false, 4),
  ('upper-a', 'Tricep Pushdown', 3, '12–15', '60s', 'Rope — neutral grip', null, null, false, false, 5);

-- ─── LOWER A ────────────────────────────────────────────────
insert into session_exercises (session_id, name, sets, reps, rest, note, variations, aliases, band, bodyweight, sort_order) values
  ('lower-a', 'Hack Squat / Leg Press', 3, '8–12', '180s', null, '["Hack Squat","Leg Press"]', null, false, false, 0),
  ('lower-a', 'Leg Extension', 3, '10–12', '60s', null, '["Leg Extension","New Leg Extension"]', null, false, false, 1),
  ('lower-a', 'Lying Leg Curl', 3, '8–12', '75s', null, null, null, false, false, 2),
  ('lower-a', 'Walking Lunge', 3, '6 steps each way', '75s', 'BW or light DBs — walk forward then back', null, null, false, false, 3),
  ('lower-a', 'Seated Calf Raise', 3, '10–12', '60s', null, '["Old Mach","New Mach"]', null, false, false, 4),
  ('lower-a', 'Pallof Press', 4, '12 each side', '45s', 'Core — hernia safe', '["Red Band","Yellow Band"]', null, true, false, 5);

-- ─── UPPER B ────────────────────────────────────────────────
insert into session_exercises (session_id, name, sets, reps, rest, note, variations, aliases, band, bodyweight, sort_order) values
  ('upper-b', 'Lat Pulldown', 3, '8–12', '90s', 'Neutral grip', null, null, false, false, 0),
  ('upper-b', 'Chest Supported Row', 3, '8–12', '90s', null, null, null, false, false, 1),
  ('upper-b', 'Seated Cable Row', 3, '10–12', '75s', 'Not rope attachment', '["Cable","Machine"]', null, false, false, 2),
  ('upper-b', 'Face Pull', 3, '12–15', '60s', 'Don''t skip this', null, null, false, false, 3),
  ('upper-b', 'Straight Arm Pulldown', 3, '12–15', '60s', null, null, null, false, false, 4),
  ('upper-b', 'Hammer Curl', 3, '10–12', '75s', '12 reps each side/arm — neutral grip', null, null, false, false, 5),
  ('upper-b', 'Incline Single Cable Curl', 3, '12–15', '60s', null, '["Cable","DB","Machine"]', null, false, false, 6);

-- ─── LOWER B ────────────────────────────────────────────────
insert into session_exercises (session_id, name, sets, reps, rest, note, variations, aliases, band, bodyweight, sort_order) values
  ('lower-b', 'Smith RDL', 3, '6–10', '120s', 'Hernia safe', null, null, false, false, 0),
  ('lower-b', 'Leg Press', 3, '8–12', '180s', 'Higher feet — glute bias', null, null, false, false, 1),
  ('lower-b', 'Leg Curl', 3, '10–12', '60s', null, null, null, false, false, 2),
  ('lower-b', 'Hip Thrusts', 3, '10–15', '75s', null, '["Hip Machine","Booty Hip Machine"]', '["Hip Thrust Machine"]', false, false, 3),
  ('lower-b', 'Seated Calf Raise', 3, '8–12', '60s', null, '["Old Mach","New Mach"]', null, false, false, 4),
  ('lower-b', 'Dead Bug', 3, '10 each', '45s', 'Core — hernia safe', null, null, false, true, 5),
  ('lower-b', 'Cable Woodchop', 3, '12 each', '45s', 'Core — hernia safe', '["Cable","KG"]', null, false, false, 6);

-- ─── FULL BODY A ────────────────────────────────────────────
insert into session_exercises (session_id, name, sets, reps, rest, note, variations, aliases, band, bodyweight, sort_order) values
  ('full-body-a', 'Hack Squat / Leg Press', 3, '6–10', '180s', null, '["Hack Squat","Leg Press"]', null, false, false, 0),
  ('full-body-a', 'Incline Chest Press', 3, '6–10', '150s', null, '["Smith","DB"]', '["Smith Machine Incline Press"]', false, false, 1),
  ('full-body-a', 'Chest Supported Row', 3, '8–12', '90s', null, null, null, false, false, 2),
  ('full-body-a', 'Lateral Raise', 3, '12–15', '60s', null, '["DB","Machine"]', null, false, false, 3),
  ('full-body-a', 'Tricep Pushdown', 2, '10–15', '60s', 'Controlled reps — no ego', null, null, false, false, 4),
  ('full-body-a', 'Seated Calf Raise', 3, '10–15', '60s', null, '["Old Mach","New Mach"]', null, false, false, 5);

-- ─── FULL BODY B ────────────────────────────────────────────
insert into session_exercises (session_id, name, sets, reps, rest, note, variations, aliases, band, bodyweight, sort_order) values
  ('full-body-b', 'Smith RDL', 3, '6–10', '150s', 'Hernia safe', null, null, false, false, 0),
  ('full-body-b', 'Machine Chest Press', 3, '8–12', '90s', null, null, null, false, false, 1),
  ('full-body-b', 'Lat Pulldown', 3, '8–12', '90s', 'Neutral grip', null, null, false, false, 2),
  ('full-body-b', 'Face Pull', 3, '12–15', '60s', 'Rear delts + shoulder health', null, null, false, false, 3),
  ('full-body-b', 'Hammer Curl', 2, '10–12', '60s', '12 reps each side/arm — neutral grip', null, null, false, false, 4),
  ('full-body-b', 'Dead Bug', 3, '10 each', '45s', 'Core — hernia safe', null, null, false, true, 5);

-- ─── FULL BODY C ────────────────────────────────────────────
insert into session_exercises (session_id, name, sets, reps, rest, note, variations, aliases, band, bodyweight, sort_order) values
  ('full-body-c', 'Leg Press', 3, '8–12', '180s', 'Controlled depth', null, null, false, false, 0),
  ('full-body-c', 'Shoulder Press', 3, '8–12', '90s', null, '["Machine","Smith","DB"]', '["Machine Shoulder Press"]', false, false, 1),
  ('full-body-c', 'Seated Cable Row', 3, '10–12', '75s', 'Not rope attachment', '["Cable","Machine"]', null, false, false, 2),
  ('full-body-c', 'Machine Chest Press', 2, '10–12', '90s', null, null, null, false, false, 3),
  ('full-body-c', 'Incline Single Cable Curl', 2, '12–15', '60s', null, '["Cable","DB","Machine"]', null, false, false, 4),
  ('full-body-c', 'Lying Leg Curl', 3, '10–12', '60s', null, null, null, false, false, 5);
