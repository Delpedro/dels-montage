-- rest_alert_log — a readout for the rest-alert chain, added 25 Aug 2026.
--
-- Two silent failure modes have now cost two fixes and the alert still misses rests. Neither the
-- client nor the Edge Function leaves any trace when it gives up: sb() turns a dead gym connection
-- into a not-ok Response and scheduleRestAlert() returns on it, and the function's decisions go to
-- console.log where nothing reads them. So a missed alert and a cancelled one look identical
-- afterwards, and every theory about which one happened is unfalsifiable.
--
-- This table makes the chain say what it did. One row per decision point, both ends writing to it:
--   client   booked | upsert-failed | no-jwt | dispatch-failed
--   function invoked | chained | skipped | sent | push-error
--
-- Absence is a reading too. No rows at all for a rest means the client never got through.
--
-- TEMPORARY. Drop it once the miss is explained — it is instrumentation, not a feature.
create table if not exists public.rest_alert_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  at          timestamptz not null default now(),
  phase       text not null check (char_length(phase) between 1 and 40),
  token       text check (char_length(token) <= 80),
  exercise    text check (char_length(exercise) <= 80),
  detail      text check (char_length(detail) <= 300)
);

create index if not exists rest_alert_log_user_at_idx on public.rest_alert_log (user_id, at desc);

alter table public.rest_alert_log enable row level security;

-- Same shape as every other table here: you reach your own rows and nobody else's. The function
-- writes with the service role, which bypasses this.
create policy rest_alert_log_owner on public.rest_alert_log
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.rest_alert_log from anon;
grant select, insert on public.rest_alert_log to authenticated;
grant usage, select on sequence public.rest_alert_log_id_seq to authenticated;

-- The schema-wide default privileges hand `authenticated` the full set on any new table, which is
-- wider than the two verbs this needs. RLS would still hold the line, but the posture on every
-- other table here is least privilege, so match it.
revoke update, delete, truncate, references, trigger on public.rest_alert_log from authenticated;
revoke all on public.rest_alert_log from anon;
