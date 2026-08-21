-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Scope the last three global constraints per user — 21 Aug 2026
--
-- Migration 20260813120000 made every table multi-tenant (user_id + `user_id = auth.uid()` RLS)
-- and scoped daily_logs' UNIQUE(date) to (user_id, date). It missed three more constraints that
-- carry the same single-user assumption, and an audit for the second account found all three.
--
-- Each one fails in the worst possible way: a duplicate-key error naming a row that RLS makes
-- INVISIBLE to the person hitting it. "Key (id)=(upper-a) already exists" for a session she cannot
-- see and did not create reads as a bug in the app, not as a constraint doing its job.
--
--   1. session_templates.id is a GLOBAL text primary key ('upper-a', 'cv-pump', 'full-body-a').
--      This is the blocker: a second account's programme cannot be seeded at all, because every
--      readable session id is already taken by the first account's row.
--   2. custom_exercises.name is globally unique — she could never add an exercise this account
--      already has. Already flagged in the body of merge_exercises(), never fixed.
--   3. conditioning_logs.date is globally unique — she could never log a CV + Pump session on a
--      date this account had already logged. Exactly the bug daily_logs had.
--
-- WHY A COMPOSITE PK RATHER THAN UUIDs on session_templates. The text ids are load-bearing and
-- readable: createWorkoutRow('cv-pump') names one directly, workouts.session_type stores them as
-- text, and every history filter is keyed by them. Making the PK (user_id, id) keeps all of that
-- working unchanged and per user — each account gets its own 'upper-a'. No client change at all:
-- every query already filters ?id=eq.<id>, which RLS scopes to the caller's own rows.
--
-- It also fixes a latent bug in offerSaveOpenAsTemplate(): it checks the new slug against
-- SESSIONS, i.e. against this user's sessions only. Under the global PK that check was wrong —
-- naming an Open Workout the same as another account's session would 409 on a row you cannot see.
-- Under (user_id, id) the check it already performs is exactly the right one.
--
-- Profiled before writing (0 orphaned session_exercises, 0 duplicate names, 0 duplicate
-- conditioning dates, 0 null user_ids), so nothing here can fail on existing data and no row of
-- the first account's changes.
-- ═══════════════════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1. session_templates: id becomes unique per user, not globally ──────────────────
-- The FK has to go first — it points at the primary key being replaced.
alter table public.session_exercises drop constraint if exists session_exercises_session_id_fkey;
alter table public.session_templates drop constraint if exists session_templates_pkey;
alter table public.session_templates add  constraint session_templates_pkey primary key (user_id, id);

-- Composite FK: a session_exercises row belongs to ITS OWN user's template of that id. Without
-- user_id in the FK, a row could point at another account's template — the reference would be
-- satisfied by a row RLS says does not exist.
--
-- on update cascade because the id is a slug, not a surrogate: renaming a template's id should
-- carry its exercises rather than orphan them.
alter table public.session_exercises add constraint session_exercises_session_fkey
  foreign key (user_id, session_id) references public.session_templates (user_id, id)
  on delete cascade on update cascade;

-- Index the FK's own columns. Postgres indexes the referenced side automatically (it is the PK)
-- but never the referencing side, and without this every template delete sequential-scans
-- session_exercises to find the children.
create index if not exists session_exercises_user_session_idx
  on public.session_exercises (user_id, session_id);

-- ─── 2. custom_exercises: one name per user ──────────────────────────────────────────
alter table public.custom_exercises drop constraint if exists custom_exercises_name_key;
alter table public.custom_exercises add  constraint custom_exercises_user_name_key unique (user_id, name);

-- ─── 3. conditioning_logs: one entry per user per day ────────────────────────────────
alter table public.conditioning_logs drop constraint if exists conditioning_logs_date_key;
alter table public.conditioning_logs add  constraint conditioning_logs_user_date_key unique (user_id, date);

commit;
