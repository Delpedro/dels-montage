-- Run this in Supabase SQL Editor (Database > SQL Editor > New Query)

-- Daily health logs
create table daily_logs (
  id uuid default gen_random_uuid() primary key,
  date date not null unique,
  weight_kg numeric(4,1),
  calories integer,
  fasting_hours numeric(4,1),
  steps integer,
  energy integer check (energy between 1 and 5),
  notes text,
  created_at timestamp default now()
);

-- Workout sessions
create table workouts (
  id uuid default gen_random_uuid() primary key,
  date date not null,
  session_type text not null,
  duration_mins integer,
  notes text,
  created_at timestamp default now()
);

-- Individual sets within a workout
create table workout_sets (
  id uuid default gen_random_uuid() primary key,
  workout_id uuid references workouts(id) on delete cascade,
  exercise text not null,
  set_number integer not null,
  weight numeric(5,1),
  reps integer,
  created_at timestamp default now()
);

-- Saturday conditioning log
create table conditioning_logs (
  id uuid default gen_random_uuid() primary key,
  date date not null unique,
  activity text not null,
  duration_mins integer,
  notes text,
  created_at timestamp default now()
);

-- App user (just Del)
create table app_user (
  id uuid default gen_random_uuid() primary key,
  email text not null unique,
  password_hash text not null,
  created_at timestamp default now()
);

-- Enable Row Level Security but allow all for now (single user app)
alter table daily_logs enable row level security;
alter table workouts enable row level security;
alter table workout_sets enable row level security;
alter table conditioning_logs enable row level security;
alter table app_user enable row level security;

-- Allow all operations via anon key (we handle auth ourselves)
create policy "allow all" on daily_logs for all using (true) with check (true);
create policy "allow all" on workouts for all using (true) with check (true);
create policy "allow all" on workout_sets for all using (true) with check (true);
create policy "allow all" on conditioning_logs for all using (true) with check (true);
create policy "allow all" on app_user for all using (true) with check (true);
