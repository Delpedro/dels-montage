-- ═══════════════════════════════════════════════════════════════════════════════════════
-- profiles — the app finally has a concept of a person. 21 Aug 2026
--
-- Until now D-LOG had nowhere to put one. `goals` holds macro targets, weight lives in
-- `daily_logs`, and the person themselves was a string literal in the source:
-- getGreeting() returned 'Good morning, Del'. That is fine for an app with one user and
-- wrong the moment there are two — the second account would be greeted by the first
-- account's name, which is the kind of detail that makes an app feel like someone else's.
--
-- This is step 1 of the second-user work (see MULTIUSER-PLAN.md §5). Step 2 is the
-- onboarding form that fills the row in, step 3 the programme catalogue it seeds from.
--
-- SHAPE: one row per user, so user_id IS the primary key. No surrogate id, because a
-- second profile row for the same person is not a thing that should be representable —
-- goals learned this the hard way and is still read with `order=updated_at.desc&limit=1`.
-- It also makes the client write a one-liner: POST ?on_conflict=user_id with merge.
--
-- MISSING ROW = NOT ONBOARDED. The absence of a row is what the onboarding form keys off,
-- so nothing here is backfilled for accounts that do not exist yet. `onboarded_at` is the
-- finer flag: a row can exist with a name in it before the full form has been completed.
--
-- Every column except display_name is nullable on purpose. A profile you can save halfway
-- is a form you can leave and come back to; a NOT NULL on height is a person stuck on a
-- screen because they do not know it in centimetres.
-- ═══════════════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,

  -- What the app calls you. Not the email address: GoTrue owns identity, this is the name
  -- on the greeting, and 'delpeter@gmail.com' is not a thing to say good morning to.
  display_name text not null,

  -- Nullable and 'other'-tolerant. Its only real job is future energy-expenditure maths
  -- (BMR formulas take a sex term); nothing in the app reads it today.
  sex text check (sex in ('male', 'female', 'other')),

  -- Date of birth rather than age, because age is a number that goes stale in a database.
  dob date,

  height_cm          numeric(4,1) check (height_cm between 100 and 250),
  start_weight_kg    numeric(5,1) check (start_weight_kg between 20 and 400),
  target_weight_kg   numeric(5,1) check (target_weight_kg between 20 and 400),

  -- Drives which programme the catalogue offers first (step 3). 'returning' is deliberate:
  -- someone who lifted for two years and stopped for five is neither a beginner nor an
  -- intermediate, and pretending otherwise is how a first programme comes out wrong.
  experience text check (experience in ('beginner', 'returning', 'intermediate', 'advanced')),

  training_days_per_week smallint check (training_days_per_week between 1 and 7),

  -- The app is metric everywhere today and nothing reads this yet — it exists so the
  -- onboarding form has somewhere to put the answer the day imperial is honoured. Do NOT
  -- offer it in the form before the UI actually converts: a stored preference the app
  -- ignores is worse than not asking.
  units text not null default 'metric' check (units in ('metric', 'imperial')),

  -- NULL until the onboarding form has been completed end to end. See the header.
  onboarded_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at is a trigger here rather than the client's job (which is how `goals` does it).
-- This row will be written from several places over time — onboarding, a settings screen,
-- whatever comes after — and one of them will forget. The database cannot.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Same posture as every other user table (see 20260813120000): RLS on, owner-only policy
-- granted to `authenticated`, and anon revoked outright so the publishable key in the
-- public repo opens nothing. The WITH CHECK is what rejects a forged user_id in a body.
alter table public.profiles enable row level security;
drop policy if exists "owner access" on public.profiles;
create policy "owner access" on public.profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.profiles from anon;
grant select, insert, update, delete on public.profiles to authenticated;

-- The one existing account. Same uuid as 20260813120000 and looked up the same way — by id, not by
-- email, because this file is in a public repo and the email address is a login identity.
--
-- Name only. Height, DOB and the rest stay NULL rather than being guessed: a fabricated height is
-- worse than a blank one, because nothing ever prompts you to correct a number that looks filled in.
-- onboarded_at stays NULL too, honestly — this row was written by a migration, not by a person
-- answering a form, and the form does not exist yet.
insert into public.profiles (user_id, display_name)
values ('10575e31-6c18-4d95-8f71-8fff682d29ef', 'Del')
on conflict (user_id) do nothing;

commit;
