-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Exercise identity — 20 Aug 2026
--
-- Until now an exercise WAS its name. workout_sets.exercise, session_exercises.name and
-- custom_exercises.name each carry free text, and the app joins them by string equality.
-- Two consequences, both already visible in the live data:
--
--   * Renaming orphans history. Take an exercise out of a template and put it back spelled
--     differently and every set logged under the old spelling stops being its history.
--   * The same lift arrives under several spellings and nothing notices. Live today:
--     Seated Row / Seated Row (Mach) / Seated Row Mach · Pull Ups / PullUps ·
--     Farmer Walks / Farmers Walk · Incline DB Curl / DB Incline Curl ·
--     Sitting BB curl (restrict) / Sitting BB Restricted Curl.
--
-- This adds the identity that was missing: one `exercises` row per distinct name per user,
-- and an `exercise_id` FK on all three tables.
--
-- NOTHING IS MERGED. Every existing name keeps its own row, 1:1 — this migration changes no
-- data anyone can see. Merging the five splits above is a separate, reversible operation once
-- ids exist, and that is the whole reason for doing it in this order. It is deliberately not
-- in this file: workout_sets carries a unique (workout_id, exercise, set_number) key that a
-- careless merge would collide with, and that deserves its own pass.
--
-- The name columns stay, and stay authoritative for reads: every query in js/app.js still
-- filters `exercise=eq.<name>`. exercise_id is the durable anchor underneath them, so a rename
-- is now rename_exercise(id, new_name) — one function moving the name and every denormalised
-- copy of it together, found by id, so it cannot half-apply and cannot miss a row.
--
-- Triggers rather than NOT NULL: a client that still posts only a name gets exercise_id filled
-- in by the database, and an unrecognised name auto-creates its exercises row. That matters
-- because this is a PWA — a service worker can serve last week's app.js in the middle of a gym
-- session, and "your sets silently stopped saving" is not an acceptable way for a schema change
-- to fail.
-- ═══════════════════════════════════════════════════════════════════════════════════════

begin;

-- ─── THE TABLE ──────────────────────────────────────────────────────────────────────
-- uuid pk, not a slug pk: slugs collide across users the moment two accounts both log a
-- "Bench Press", and this app is heading for multiple accounts. The slug rides along as the
-- readable handle for eyeballing a query, unique per user, and is frozen at creation — a slug
-- that chased the name would be exactly as unstable as the name, which is the bug being fixed.
create table if not exists public.exercises (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  slug       text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists exercises_user_name_key on public.exercises (user_id, name);
create unique index if not exists exercises_user_slug_key on public.exercises (user_id, slug);
create index        if not exists exercises_user_id_idx   on public.exercises (user_id);

alter table public.exercises enable row level security;
drop policy if exists "owner access" on public.exercises;
create policy "owner access" on public.exercises for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.exercises from anon;
grant select, insert, update, delete on public.exercises to authenticated;

-- ─── SLUGS ──────────────────────────────────────────────────────────────────────────
create or replace function public.exercise_slugify(txt text) returns text
language sql immutable as $fn$
  select coalesce(nullif(trim(both '-' from
    regexp_replace(lower(coalesce(txt, '')), '[^a-z0-9]+', '-', 'g')), ''), 'exercise');
$fn$;

-- "Seated Row (Mach)" and "Seated Row Mach" are two different names that slugify identically,
-- and both are in the live data — so the suffix loop is load-bearing, not defensive padding.
create or replace function public.exercises_set_slug() returns trigger
language plpgsql as $fn$
declare base text; candidate text; n int := 1;
begin
  if new.slug is not null and new.slug <> '' then return new; end if;
  base := public.exercise_slugify(new.name);
  candidate := base;
  while exists (select 1 from public.exercises e
                where e.user_id = new.user_id and e.slug = candidate and e.id <> new.id) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  new.slug := candidate;
  return new;
end $fn$;

drop trigger if exists exercises_slug on public.exercises;
create trigger exercises_slug before insert on public.exercises
  for each row execute function public.exercises_set_slug();

-- ─── BACKFILL: one row per distinct name, per user ──────────────────────────────────
insert into public.exercises (user_id, name, slug)
select user_id, name, ''   -- '' so the trigger generates it; the column is NOT NULL
from (
  select user_id, exercise as name from public.workout_sets       where exercise is not null
  union select user_id, name       from public.session_exercises  where name     is not null
  union select user_id, name       from public.custom_exercises   where name     is not null
) t
on conflict (user_id, name) do nothing;

-- ─── THE FK COLUMNS ─────────────────────────────────────────────────────────────────
-- Nullable on purpose. See the header: an old cached client posts a name and no id, and the
-- trigger below fills it. NOT NULL would turn that into a failed save mid-workout.
alter table public.workout_sets      add column if not exists exercise_id uuid references public.exercises(id);
alter table public.session_exercises add column if not exists exercise_id uuid references public.exercises(id);
alter table public.custom_exercises  add column if not exists exercise_id uuid references public.exercises(id);

create index if not exists workout_sets_exercise_id_idx      on public.workout_sets (exercise_id);
create index if not exists session_exercises_exercise_id_idx on public.session_exercises (exercise_id);
create index if not exists custom_exercises_exercise_id_idx  on public.custom_exercises (exercise_id);

update public.workout_sets ws set exercise_id = e.id
  from public.exercises e
  where e.user_id = ws.user_id and e.name = ws.exercise and ws.exercise_id is null;
update public.session_exercises se set exercise_id = e.id
  from public.exercises e
  where e.user_id = se.user_id and e.name = se.name and se.exercise_id is null;
update public.custom_exercises cx set exercise_id = e.id
  from public.exercises e
  where e.user_id = cx.user_id and e.name = cx.name and cx.exercise_id is null;

-- ─── KEEPING IT LINKED ──────────────────────────────────────────────────────────────
-- Find-or-create. The insert can race another session on the same name, hence the on-conflict
-- re-read rather than trusting RETURNING to produce a row.
create or replace function public.exercise_id_for(p_user uuid, p_name text) returns uuid
language plpgsql as $fn$
declare v_id uuid;
begin
  if p_user is null or p_name is null or btrim(p_name) = '' then return null; end if;
  select id into v_id from public.exercises where user_id = p_user and name = p_name;
  if v_id is null then
    insert into public.exercises (user_id, name, slug) values (p_user, p_name, '')
      on conflict (user_id, name) do nothing returning id into v_id;
    if v_id is null then
      select id into v_id from public.exercises where user_id = p_user and name = p_name;
    end if;
  end if;
  return v_id;
end $fn$;

-- Two functions rather than one with TG_ARGV: the name column is `exercise` on workout_sets and
-- `name` on the other two, and NEW cannot be addressed dynamically without rebuilding the whole
-- row inside EXECUTE — which costs more than the duplicated eight lines.
create or replace function public.link_exercise_from_exercise_col() returns trigger
language plpgsql as $fn$
begin
  if new.exercise_id is null
     or (tg_op = 'UPDATE' and new.exercise is distinct from old.exercise
                          and new.exercise_id is not distinct from old.exercise_id) then
    new.exercise_id := public.exercise_id_for(new.user_id, new.exercise);
  end if;
  if new.exercise is null and new.exercise_id is not null then
    select name into new.exercise from public.exercises where id = new.exercise_id;
  end if;
  return new;
end $fn$;

create or replace function public.link_exercise_from_name_col() returns trigger
language plpgsql as $fn$
begin
  if new.exercise_id is null
     or (tg_op = 'UPDATE' and new.name is distinct from old.name
                          and new.exercise_id is not distinct from old.exercise_id) then
    new.exercise_id := public.exercise_id_for(new.user_id, new.name);
  end if;
  if new.name is null and new.exercise_id is not null then
    select name into new.name from public.exercises where id = new.exercise_id;
  end if;
  return new;
end $fn$;

drop trigger if exists link_exercise on public.workout_sets;
create trigger link_exercise before insert or update on public.workout_sets
  for each row execute function public.link_exercise_from_exercise_col();

drop trigger if exists link_exercise on public.session_exercises;
create trigger link_exercise before insert or update on public.session_exercises
  for each row execute function public.link_exercise_from_name_col();

drop trigger if exists link_exercise on public.custom_exercises;
create trigger link_exercise before insert or update on public.custom_exercises
  for each row execute function public.link_exercise_from_name_col();

-- ─── RENAME ─────────────────────────────────────────────────────────────────────────
-- The point of the whole migration. Rows are found by id, so no spelling can be missed and no
-- half-renamed state can survive the transaction. The exercises row is updated first so the
-- link triggers firing on the three UPDATEs below re-resolve to the same id, not a new one.
create or replace function public.rename_exercise(p_id uuid, p_name text) returns void
language plpgsql as $fn$
begin
  if btrim(coalesce(p_name, '')) = '' then raise exception 'rename_exercise: empty name'; end if;
  if not exists (select 1 from public.exercises where id = p_id) then
    raise exception 'rename_exercise: no exercise %', p_id;
  end if;
  update public.exercises         set name     = p_name where id          = p_id;
  update public.workout_sets      set exercise = p_name where exercise_id = p_id;
  update public.session_exercises set name     = p_name where exercise_id = p_id;
  update public.custom_exercises  set name     = p_name where exercise_id = p_id;
end $fn$;

commit;
