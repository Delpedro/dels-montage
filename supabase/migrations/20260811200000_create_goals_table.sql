-- Macro targets (11 Aug 2026).
--
-- Until now the app had no targets at all, which is why every check-in card's right-hand column
-- was "change since the previous check-in" — and why it kept being read as a goal shortfall.
-- One row, read newest-first; the app never creates a second one.
--
-- `calories` is deliberately nullable: null means "derive it from the macros" at 4/4/9 kcal per
-- gram, so changing a macro target moves the calorie target with it instead of leaving a stale
-- number behind. Set it explicitly only to override that (e.g. to match a rounder MyFitnessPal
-- figure). Same for `fibre_g` — null means no fibre target and the fibre row shows no verdict.
create table if not exists public.goals (
  id         uuid primary key default gen_random_uuid(),
  protein_g  numeric,
  carbs_g    numeric,
  fat_g      numeric,
  fibre_g    numeric,
  calories   integer,
  updated_at timestamptz not null default now()
);

-- Same allow-all pattern as every other table in this DB (see 20260729120000). This is NOT
-- per-user access control — that's still the Phase 2 job.
alter table public.goals enable row level security;

drop policy if exists "Allow all on goals" on public.goals;
create policy "Allow all on goals" on public.goals
  for all using (true) with check (true);

-- Seed with the user's MyFitnessPal targets. Guarded so re-running can't create a second row.
insert into public.goals (protein_g, carbs_g, fat_g)
select 175, 200, 56
where not exists (select 1 from public.goals);
