-- Clearing the Supabase advisor boards before the beta (24 August 2026).
--
-- Del sent both boards over while he was in the dashboard doing the password-reset settings:
-- 9 security warnings and 20 performance warnings, 0 errors. This closes 28 of the 29. The last one
-- (Leaked Password Protection Disabled) is a dashboard toggle, not DDL — it is not in this file.
--
-- Applied with `supabase db query --linked -f <this file>` and verified by reading pg_proc and
-- pg_policies back out. NOT applied with `supabase db push` — see the standing rule; 17 migrations
-- show blank on the remote and pushing would try to replay them.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Function Search Path Mutable  ×8   (SECURITY, WARN)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- What the linter is actually worried about: a function that does not pin `search_path` resolves
-- unqualified names against whatever path the CALLER happens to have, so somebody who can create
-- objects in a schema earlier on that path can shadow a table or a function the body meant to use.
--
-- **How bad is it here: not very, and it was checked rather than assumed.** All eight functions are
-- `prosecdef = false` — SECURITY INVOKER — so they run with the caller's own privileges and there is
-- no escalation to be had; the classic exploit needs a SECURITY DEFINER function running as the
-- owner. And `anon` holds no grant on any table in `public`, so an unauthenticated caller cannot
-- create anything to shadow with. It is a robustness warning here, not an open door.
--
-- Worth fixing anyway: it is eight one-line statements, it makes the functions resolve the same way
-- no matter who calls them, and an advisor board with nothing on it is worth having before anyone
-- else has an account and before a store review.
--
-- `search_path = ''` rather than `= public, pg_temp`, because every body was read first and every
-- reference to a user object is already schema-qualified (`public.exercises`,
-- `public.exercise_slugify`, `public.exercise_id_for`, …). The only unqualified names left are
-- built-ins — now(), coalesce(), btrim(), regexp_replace(), lower(), nullif(), trim() — and
-- pg_catalog is searched implicitly whether or not it appears in the path, so those keep working.
-- The empty path is the stronger of the two: it leaves no temp schema on the path either.
alter function public.exercise_id_for(p_user uuid, p_name text)  set search_path = '';
alter function public.exercise_slugify(txt text)                 set search_path = '';
alter function public.exercises_set_slug()                       set search_path = '';
alter function public.link_exercise_from_exercise_col()          set search_path = '';
alter function public.link_exercise_from_name_col()              set search_path = '';
alter function public.merge_exercises(p_from uuid, p_into uuid)   set search_path = '';
alter function public.rename_exercise(p_id uuid, p_name text)    set search_path = '';
alter function public.touch_updated_at()                         set search_path = '';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Auth RLS Initialization Plan  ×20   (PERFORMANCE, WARN)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- `auth.uid()` written bare in a policy is re-evaluated **once per row**. Wrapped in a sub-select it
-- becomes an InitPlan: Postgres runs it once for the whole statement and compares the constant. The
-- policy means exactly the same thing either way — this is a plan-shape change, not a rule change.
--
-- It is not urgent at one user and it is not free at four: `workout_sets` is the biggest table in
-- the app and every read of it goes through this predicate. The cost lands on exactly the queries
-- the Stats page runs over a whole year, which are already the slowest thing in the app.
--
-- **ALTER POLICY, deliberately, not DROP + CREATE.** ALTER rewrites the predicate in place, so there
-- is never an instant where the table has RLS enabled and no policy on it. (That instant would fail
-- closed rather than open — no policy means no access — but "Del's phone briefly cannot see his own
-- workouts mid-session" is not a thing worth risking for a performance tweak.)
alter policy "owner access" on public.app_meta          using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "owner access" on public.cardio_logs       using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "owner access" on public.conditioning_logs using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "owner access" on public.custom_exercises  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "owner access" on public.daily_logs        using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "owner access" on public.exercises         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "owner access" on public.goals             using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "owner access" on public.profiles          using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "owner access" on public.session_exercises using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "owner access" on public.session_templates using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "owner access" on public.workout_sets      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "owner access" on public.workouts          using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- push_subscriptions and rest_alerts came in with the rest-alert edge function and are split per
-- command rather than one ALL policy, so each one gets only the clause it actually has: a SELECT or
-- DELETE policy has no WITH CHECK, an INSERT policy has no USING, and naming the missing one is an
-- error rather than a no-op.
--
-- They are also the only two tables whose policies are granted `to public` instead of
-- `to authenticated`, so `TO authenticated` is folded into the same statement. **This is tidying,
-- not a hole**: `public` in a policy includes `anon`, but `anon` was revoked from every table in
-- `20260813180000_revoke_default_privileges_from_anon.sql` and holds no grant on either of these
-- (checked, not assumed), so an anonymous caller is refused at the permission layer before a policy
-- is ever evaluated. Being consistent means the next person reading these does not have to re-derive
-- that, and it stops the grant layer being the only thing standing there.
alter policy push_subscriptions_select_own on public.push_subscriptions to authenticated using ((select auth.uid()) = user_id);
alter policy push_subscriptions_insert_own on public.push_subscriptions to authenticated with check ((select auth.uid()) = user_id);
alter policy push_subscriptions_update_own on public.push_subscriptions to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy push_subscriptions_delete_own on public.push_subscriptions to authenticated using ((select auth.uid()) = user_id);

alter policy rest_alerts_select_own on public.rest_alerts to authenticated using ((select auth.uid()) = user_id);
alter policy rest_alerts_insert_own on public.rest_alerts to authenticated with check ((select auth.uid()) = user_id);
alter policy rest_alerts_update_own on public.rest_alerts to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy rest_alerts_delete_own on public.rest_alerts to authenticated using ((select auth.uid()) = user_id);

-- `quotes` is untouched: its policy is `for select to authenticated using (true)`, shared app content
-- with no auth.uid() in it, and the linter does not flag it.
