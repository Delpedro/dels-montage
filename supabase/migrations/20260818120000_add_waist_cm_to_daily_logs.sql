-- Waist measurement on the daily check-in (18 Aug 2026)
--
-- The primary goal is 8–12% body fat, and the fat that is meant to go is the lower belly. Weight,
-- calories, macros and steps were all being tracked and none of them say whether the belly is
-- moving — scale weight swings a kilo overnight on water alone. Waist at the navel does say it,
-- and it separates real change from daily noise.
--
-- Nullable, no default, no backfill: this is a weekly measurement on a daily table, so the vast
-- majority of rows will never carry one, and null means "not measured that day" rather than zero.
-- numeric, not integer — a tape reads to the millimetre and 96.5 is a real answer.
--
-- Column-level grants are not in play on this schema (the 13 Aug auth migration works at table
-- level), so the existing daily_logs grants and RLS policies cover this column as they stand.
alter table public.daily_logs add column if not exists waist_cm numeric;

comment on column public.daily_logs.waist_cm is
  'Waist circumference in cm, measured at the navel. Weekly, not daily — null on most rows.';
