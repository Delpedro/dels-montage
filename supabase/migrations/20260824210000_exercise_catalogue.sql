-- ─── SHARED EXERCISE CATALOGUE (24 Aug 2026) ──────────────────────────────────────────────────
--
-- A brand-new account's exercise picker was EMPTY. `EXERCISE_LIBRARY` is built from the user's own
-- session templates plus their own `exercises` rows, and a stranger has neither — so the dropdown
-- held a disabled placeholder and "+ Type a new exercise…", and every single lift had to be typed
-- by hand into a native prompt(). That was the whole first run.
--
-- The fix is NOT a hardcoded starter array in app.js. Three store reasons:
--   1. Adding an exercise would become an App Store review cycle.
--   2. Exercise media (ROADMAP-2026) has nothing to hang off. If every user owns a private
--      `exercises` row for "Bench Press" there is no single row to attach a demo clip to.
--   3. TIMED_EXERCISES and OPTIONAL_WEIGHT_EXERCISES are already this bug, shipped: both are keyed
--      by hand-enumerated lowercase spellings — six strings for one lift — so a stranger typing
--      "Neutral Grip Pull-ups" loses the kg box and can never record the load. Spellings cannot be
--      enumerated. A boolean on a row fixes it by construction.
--
-- Migration 20260820140000 already learned this once: exercise NAMES became uuid ROWS. This is the
-- same move one level up — SHARED identity rather than per-user identity.
--
-- This is NOT the programme catalogue that was killed. That copied rows into someone's data and
-- told them what to train. This seeds nothing and copies nothing: it is a lookup list.

create table if not exists public.exercise_catalogue (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text not null,
  muscle_group    text,
  equipment       text,
  -- Same shape as exercises.variations, so buildExerciseLibrary() folds it in through the code path
  -- that already exists for EXERCISE_VARIATIONS.
  variations      jsonb,
  -- These three replace the hand-enumerated string lists in app.js. Null timed_target means "not a
  -- timed exercise"; the string is the default target ("30–45s") shown on the pill.
  timed_target    text,
  optional_weight boolean not null default false,
  bodyweight      boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint exercise_catalogue_name_key unique (name),
  constraint exercise_catalogue_slug_key unique (slug)
);

-- ─── ISOLATION ────────────────────────────────────────────────────────────────────────────────
-- Owned by nobody, readable by every signed-in user, writable through the API by NOBODY — exactly
-- the shape `quotes` already has, which is the only other shared table. Explicit REVOKE first
-- because Supabase's default privileges hand new public tables to anon and authenticated: relying
-- on RLS alone to stop a write would leave the grant sitting there for the next policy edit to
-- expose. anon gets nothing at all, so a signed-out visitor cannot enumerate the catalogue either.
alter table public.exercise_catalogue enable row level security;
revoke all on public.exercise_catalogue from public;
revoke all on public.exercise_catalogue from anon;
revoke all on public.exercise_catalogue from authenticated;
grant select on public.exercise_catalogue to authenticated;
grant all on public.exercise_catalogue to service_role;

drop policy if exists "catalogue is readable by signed-in users" on public.exercise_catalogue;
-- (select auth.role()) — the InitPlan form the 24 Aug advisor pass put on all 20 other policies.
create policy "catalogue is readable by signed-in users"
  on public.exercise_catalogue for select to authenticated using (true);

-- ─── THE LINK ─────────────────────────────────────────────────────────────────────────────────
-- Nullable on purpose. A user's own typed-in exercise has no catalogue row and must keep working:
-- this column says "this private row is the known lift X", it does not gate anything.
alter table public.exercises
  add column if not exists catalogue_id uuid references public.exercise_catalogue(id) on delete set null;
create index if not exists exercises_catalogue_id_idx on public.exercises (catalogue_id);

-- ─── THE SEED ─────────────────────────────────────────────────────────────────────────────────
-- Deliberately 58 — the exact set already proven in four months of real training, and deliberately
-- the size the native <select> already handles. Growing this past ~60 needs a searchable picker,
-- and THAT is its own job with a contact sheet first. Do not bolt more rows on here.
--
-- Slugs go through the same exercise_slugify() the exercises table's own trigger uses, so a
-- catalogue slug and a user's private slug for the same lift are identical strings.
--
-- timed_target / optional_weight / bodyweight carry what TIMED_EXERCISES and
-- OPTIONAL_WEIGHT_EXERCISES held as guessed spellings. Verified against the live data before
-- writing: 3 timed hits, 4 optional-weight hits, 3 with variations, 0 near-duplicate names.
insert into public.exercise_catalogue
  (name, slug, muscle_group, equipment, timed_target, optional_weight, bodyweight, variations)
values
  ('Abductor / Adductor',            public.exercise_slugify('Abductor / Adductor'),            'Glutes',      'Machine',       null,      false, false, null),
  ('Band RDL',                       public.exercise_slugify('Band RDL'),                       'Hamstrings',  'Band',          null,      false, false, null),
  ('Bent over BB Row',               public.exercise_slugify('Bent over BB Row'),               'Back',        'Barbell',       null,      false, false, null),
  ('Cable Flys',                     public.exercise_slugify('Cable Flys'),                     'Chest',       'Cable',         null,      false, false, null),
  ('Chest Supported Row',            public.exercise_slugify('Chest Supported Row'),            'Back',        'Machine',       null,      false, false, null),
  ('Dead Bug',                       public.exercise_slugify('Dead Bug'),                       'Core',        'Bodyweight',    null,      false, true,  null),
  ('DeadHang',                       public.exercise_slugify('DeadHang'),                       'Back',        'Bodyweight',    '30–45s',  true,  false, null),
  ('Dips',                           public.exercise_slugify('Dips'),                           'Chest',       'Bodyweight',    null,      true,  false, null),
  ('Face Pull',                      public.exercise_slugify('Face Pull'),                      'Shoulders',   'Cable',         null,      false, false, null),
  ('Farmers Walk',                   public.exercise_slugify('Farmers Walk'),                   'Full Body',   'Dumbbell',      '40s',     true,  false, null),
  ('Goblet Squat',                   public.exercise_slugify('Goblet Squat'),                   'Quads',       'Dumbbell',      null,      false, false, null),
  ('Hack Squat / Leg Press',         public.exercise_slugify('Hack Squat / Leg Press'),         'Quads',       'Machine',       null,      false, false, null),
  ('Hammer Curl',                    public.exercise_slugify('Hammer Curl'),                    'Biceps',      'Dumbbell',      null,      false, false, null),
  ('Hip Thrusts',                    public.exercise_slugify('Hip Thrusts'),                    'Glutes',      'Barbell',       null,      false, false, null),
  ('Incline Chest Press',            public.exercise_slugify('Incline Chest Press'),            'Chest',       'Machine',       null,      false, false, null),
  ('Incline DB Curl',                public.exercise_slugify('Incline DB Curl'),                'Biceps',      'Dumbbell',      null,      false, false, null),
  ('Incline DB Fly',                 public.exercise_slugify('Incline DB Fly'),                 'Chest',       'Dumbbell',      null,      false, false, null),
  ('Incline DB Press',               public.exercise_slugify('Incline DB Press'),               'Chest',       'Dumbbell',      null,      false, false, null),
  ('Incline Single Cable Curl',      public.exercise_slugify('Incline Single Cable Curl'),      'Biceps',      'Cable',         null,      false, false, null),
  ('Inner/Outer Thigh',              public.exercise_slugify('Inner/Outer Thigh'),              'Glutes',      'Machine',       null,      false, false, null),
  ('Lat Pulldown',                   public.exercise_slugify('Lat Pulldown'),                   'Back',        'Cable',         null,      false, false, '["Wide V-bar","Close grip","Cambered bar"]'::jsonb),
  ('Lateral Raise',                  public.exercise_slugify('Lateral Raise'),                  'Shoulders',   'Dumbbell',      null,      false, false, '["Standing DB","Leaning DB","Machine"]'::jsonb),
  ('Leg Curl',                       public.exercise_slugify('Leg Curl'),                       'Hamstrings',  'Machine',       null,      false, false, null),
  ('Leg Extension',                  public.exercise_slugify('Leg Extension'),                  'Quads',       'Machine',       null,      false, false, null),
  ('Leg Press',                      public.exercise_slugify('Leg Press'),                      'Quads',       'Machine',       null,      false, false, null),
  ('Leg Press Calf’s',               public.exercise_slugify('Leg Press Calf’s'),               'Calves',      'Machine',       null,      false, false, null),
  ('Loaded Back Ext',                public.exercise_slugify('Loaded Back Ext'),                'Back',        'Machine',       null,      false, false, null),
  ('Lower AB leg raises',            public.exercise_slugify('Lower AB leg raises'),            'Core',        'Bodyweight',    null,      false, true,  null),
  ('Lying Leg Curl',                 public.exercise_slugify('Lying Leg Curl'),                 'Hamstrings',  'Machine',       null,      false, false, null),
  ('Lying Tricep',                   public.exercise_slugify('Lying Tricep'),                   'Triceps',     'Barbell',       null,      false, false, null),
  ('Machine Chest Press',            public.exercise_slugify('Machine Chest Press'),            'Chest',       'Machine',       null,      false, false, null),
  ('Overhead Cable Tricep Ext',      public.exercise_slugify('Overhead Cable Tricep Ext'),      'Triceps',     'Cable',         null,      false, false, null),
  ('Pendulum Squat',                 public.exercise_slugify('Pendulum Squat'),                 'Quads',       'Machine',       null,      false, false, null),
  ('Preacher Curl',                  public.exercise_slugify('Preacher Curl'),                  'Biceps',      'Barbell',       null,      false, false, null),
  ('Press Ups',                      public.exercise_slugify('Press Ups'),                      'Chest',       'Bodyweight',    null,      false, true,  null),
  ('Pull-Ups',                       public.exercise_slugify('Pull-Ups'),                       'Back',        'Bodyweight',    null,      true,  false, null),
  ('Pully Ab Crunch',                public.exercise_slugify('Pully Ab Crunch'),                'Core',        'Cable',         null,      false, false, null),
  ('Pully Bicep Curl',               public.exercise_slugify('Pully Bicep Curl'),               'Biceps',      'Cable',         null,      false, false, null),
  ('RDL',                            public.exercise_slugify('RDL'),                            'Hamstrings',  'Barbell',       null,      false, false, null),
  ('Rear Delts',                     public.exercise_slugify('Rear Delts'),                     'Shoulders',   'Machine',       null,      false, false, null),
  ('Reverse Wrist Curl',             public.exercise_slugify('Reverse Wrist Curl'),             'Forearms',    'Dumbbell',      null,      false, false, null),
  ('Seated Calf Raise',              public.exercise_slugify('Seated Calf Raise'),              'Calves',      'Machine',       null,      false, false, null),
  ('Seated Leg Curl',                public.exercise_slugify('Seated Leg Curl'),                'Hamstrings',  'Machine',       null,      false, false, null),
  ('Seated Row',                     public.exercise_slugify('Seated Row'),                     'Back',        'Cable',         null,      false, false, '["Pully","Machine","High Row","Low Row"]'::jsonb),
  ('Shoulder Press',                 public.exercise_slugify('Shoulder Press'),                 'Shoulders',   'Dumbbell',      null,      false, false, null),
  ('Side Plank',                     public.exercise_slugify('Side Plank'),                     'Core',        'Bodyweight',    '30–45s',  false, true,  null),
  ('Single Arm Pully Bi',            public.exercise_slugify('Single Arm Pully Bi'),            'Biceps',      'Cable',         null,      false, false, null),
  ('Single Leg Curl',                public.exercise_slugify('Single Leg Curl'),                'Hamstrings',  'Machine',       null,      false, false, null),
  ('Single Leg Ext Mach',            public.exercise_slugify('Single Leg Ext Mach'),            'Quads',       'Machine',       null,      false, false, null),
  ('Single-Arm Cable Lateral Raise', public.exercise_slugify('Single-Arm Cable Lateral Raise'), 'Shoulders',   'Cable',         null,      false, false, null),
  ('Sitting BB Restricted Curl',     public.exercise_slugify('Sitting BB Restricted Curl'),     'Biceps',      'Barbell',       null,      false, false, null),
  ('Sitting Bicep Curl',             public.exercise_slugify('Sitting Bicep Curl'),             'Biceps',      'Dumbbell',      null,      false, false, null),
  ('Smith RDL',                      public.exercise_slugify('Smith RDL'),                      'Hamstrings',  'Smith Machine', null,      false, false, null),
  ('Smith Squat',                    public.exercise_slugify('Smith Squat'),                    'Quads',       'Smith Machine', null,      false, false, null),
  ('Straight Arm Pulldown',          public.exercise_slugify('Straight Arm Pulldown'),          'Back',        'Cable',         null,      false, false, null),
  ('T Bar Row',                      public.exercise_slugify('T Bar Row'),                      'Back',        'Barbell',       null,      false, false, null),
  ('Tricep Pushdown',                public.exercise_slugify('Tricep Pushdown'),                'Triceps',     'Cable',         null,      false, false, null),
  ('Walking Lunge',                  public.exercise_slugify('Walking Lunge'),                  'Quads',       'Dumbbell',      null,      false, false, null)
on conflict (name) do nothing;

-- ─── BACKFILL ─────────────────────────────────────────────────────────────────────────────────
-- Case- and whitespace-insensitive because the catalogue was seeded FROM these names: an exact
-- match is guaranteed for all 58 and the looser test costs nothing. Only ever fills a NULL, so it
-- is safe to re-run and can never re-point a row that has already been linked.
update public.exercises e
   set catalogue_id = c.id
  from public.exercise_catalogue c
 where e.catalogue_id is null
   and lower(btrim(e.name)) = lower(btrim(c.name));

-- ─── KEEPING IT LINKED ────────────────────────────────────────────────────────────────────────
-- In the database, not in app.js, for the same reason the existing exercise link trigger is: a
-- phone running a service-worker-cached old app.js still has to produce correctly linked rows.
-- This is also the entire multi-user path — a second user's `exercises` row is created by the
-- custom_exercises link trigger, which never passes a catalogue_id of its own.
create or replace function public.exercises_link_catalogue()
returns trigger
language plpgsql
security definer
set search_path = public          -- pinned, per the 24 Aug advisor pass on the other 8 functions
as $fn$
begin
  if new.catalogue_id is null and new.name is not null then
    select id into new.catalogue_id
      from public.exercise_catalogue
     where lower(name) = lower(btrim(new.name))
     limit 1;
  end if;
  return new;
end
$fn$;

drop trigger if exists exercises_catalogue on public.exercises;
create trigger exercises_catalogue
  before insert on public.exercises
  for each row execute function public.exercises_link_catalogue();
