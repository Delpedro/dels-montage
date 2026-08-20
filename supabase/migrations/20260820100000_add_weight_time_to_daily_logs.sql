-- Time of day the weight was taken (20 August 2026)
--
-- Del's ask: "can we add some time stamp when a user is inputting their weight on the daily
-- check-in". The reason it matters is the same reason waist_cm was added — scale weight swings a
-- kilo overnight on water alone, so a reading is only comparable with another reading taken at the
-- same point in the day. A 7am fasted weight and a 9pm post-dinner weight sitting in the same trend
-- line read as a gain that never happened. The row already carried the date; now it carries the
-- hour, so the trend can be read honestly.
--
-- `time`, not `timestamptz`: what is being recorded is the wall clock Del stood on the scale at,
-- and the date column already says which day. A timestamptz would drag UTC conversion into a number
-- whose whole value is "was this before or after breakfast".
--
-- Nullable, no default, no backfill. Null means "we don't know when" — which is the honest value for
-- every row logged before today, and for any day the weight box is left empty. It is never inferred
-- from created_at: check-ins are often typed hours after the weighing.
--
-- Column-level grants are not in play on this schema (the 13 Aug auth migration works at table
-- level), so the existing daily_logs grants and RLS policies cover this column as they stand.
alter table public.daily_logs add column if not exists weight_time time;

comment on column public.daily_logs.weight_time is
  'Local wall-clock time the weight was taken, HH:MM. Null means not recorded — never inferred from created_at.';
