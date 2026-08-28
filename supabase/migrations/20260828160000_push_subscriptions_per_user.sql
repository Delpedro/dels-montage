-- ── ONE PUSH ROW PER PERSON PER DEVICE (C20, 28 Aug 2026) ───────────────────────────────────────
--
-- A push endpoint belongs to the INSTALL, not to the account. The same iPhone, signed in as somebody
-- else, hands back the same endpoint URL — it comes from the service worker registration, and the
-- app has one of those per install however many people sign in on it.
--
-- push_subscriptions was PRIMARY KEY (endpoint), so that row belonged to whoever subscribed first.
-- The second account's upsert (?on_conflict=endpoint) therefore resolved to ON CONFLICT DO UPDATE
-- against a row RLS will not let them touch — push_subscriptions_update_own is
-- `auth.uid() = user_id` — and PostgREST answers 403.
--
-- Charlie hit exactly that on Del's phone on 28 Aug: "Couldn't save the subscription (403)". A
-- second person could not switch rest alerts on at all, on any device that already had them on for
-- someone else. That is every device a second user is ever handed.
--
-- (user_id, endpoint) gives them a row each. Nothing else has to change to suit it:
--   • the Edge Function already reads `push_subscriptions?user_id=eq.<id>`, so it sends to the
--     person whose rest it is and to nobody else;
--   • its 404/410 cleanup deletes by endpoint alone, which is still right — an endpoint the push
--     service has retired is dead for every account that holds it;
--   • disableRestAlerts()' DELETE is RLS-scoped to the caller, so switching alerts off on a shared
--     phone cannot switch them off for the other person.
--
-- Profiled first: 1 row, 1 distinct endpoint, 1 distinct (user_id, endpoint), 0 null user_ids. No
-- row moves and nothing is dropped.
alter table public.push_subscriptions
  drop constraint push_subscriptions_pkey,
  add constraint push_subscriptions_pkey primary key (user_id, endpoint);
