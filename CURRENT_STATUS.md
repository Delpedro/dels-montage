CURRENT STATUS — D-Log
Last updated: Tuesday 21 April 2026

---

<details open>
<summary>🔴 TOP PRIORITY NEXT</summary>

1. PWA + background notifications

Requires manifest.json + service-worker.js + icons
Enables iOS beep when phone locked/app closed
Big job — start in a fresh chat at 0% usage

</details>

---

<details open>
<summary>📚 DOCS TO WRITE</summary>

CODEBASE.md — plain English walkthrough of every major function
RTFM.md — how to USE the app (long-press reset, draft auto-save, variations etc)

</details>

---

<details open>
<summary>📋 Backlog (roughly priority order)</summary>

App name — "D-Log" is placeholder, needs a proper name
~~Pallof null fix in edit modal (separate to live logger bug above)~~ ✅
~~Stopwatch — inline per-exercise, wall-clock based, survives lock/background/navigation/refresh; rest m:ss persists via localStorage~~ ✅
~~Audio beep on rest complete (when app visible + focused)~~ ✅
~~Session grid collapses after selection — pill shows active session, full screen for logging~~ ✅
~~Tap "Log Workout" title to go back — warns if data exists~~ ✅
~~History workout cards — top 3 lifts by heaviest weight, amber session label~~ ✅
~~Draft auto-save — survives reload, 24hr expiry, cleared on logout~~ ✅
~~Dead Bug saves correctly (null weight, not "BW")~~ ✅
~~Pallof/band prev badges show "RB×15" / "YB×15" — abbreviated band name~~ ✅
~~Pallof weight column label renders in DM Sans (was DM Mono)~~ ✅
~~Variation toggle buttons — text vertically centred~~ ✅
~~In-progress workout state — save/resume/warn-and-switch/24hr auto-close~~ ✅
Home weight tile → Monday-to-Monday trend
Stats "Recent Workouts" → show lifts not descriptions
Display rest_seconds in workout history view
Smith Machine Incline — variation toggle (Smith / Incline Bench / DB Incline)
Lateral Raise — variation toggle (Machine / DBs)
~~History "This Week" filter shows last week's workouts instead of current week — date range bug~~ ✅
History filters don't persist across visits — should remember last state between tab changes
~~Login page scroll bug on phone — have to drag page down to reach top on first load~~ ✅ (probably — needs final confirm)
Stats: exercise picker to view progressive overload for a chosen lift over time
Adherence score on home page (e.g. "3/4 sessions, 5/7 step target")
Protein/carbs/fat on daily check-in + Supabase columns
Programme B (3-5 rep heavy strength) + Programme C (15-20 reps)
Workout types in DB — session grid needs programme picker when multiple programmes exist
Saturday conditioning: named exercises with variation toggle
Stats weight graph — chart currently plots daily weigh-ins so gaps appear on days you skip (cheat meal days etc). Needs rethinking: weekly average trend instead of daily dots, so missing days don't create jagged holes
Graph audit — review all charts for fit-for-purpose; shift from daily to weekly trend view where appropriate
Data labels on chart nodes
Weekly nutrition summary in Stats
Bottom nav layout bug on scroll (Chrome iOS)
Retrofit more comments into app.js
Phase 2: proper Supabase auth + Vercel, user_id on all tables, RLS

</details>

---

<details>
<summary>🔧 Toolchain Audit (dedicated session — do this before next bigger feature work)</summary>

Supabase CLI v2.84.2 is buggy — db push silently records a migration as applied but skips executing the SQL body. Had to run migration via Supabase dashboard SQL editor instead on 20 Apr. Update to v2.90.0 (tarball already downloaded).
Supabase CLI is installed at C:\WINDOWS\system32\supabase.exe — bad practice, should be relocated to a proper tools folder (or installed via a package manager).
General audit: npm global packages, Docker status, VS Code extensions. Check everything's current and configured sensibly.

</details>

---

<details>
<summary>📝 Phase 3 notes — multi-user / coach platform (PARKED)</summary>

App started as a personal tool but is growing fast. Plan: ship multiple-programmes support → recruit a handful of UAT testers → evaluate proper multi-user rollout. Scaling decisions made now will either save or cost serious time later, so the right habits need to be in place while the codebase is still small.

Foundation priorities (tackle before UAT):
- Security: no secrets/hashes in source code; environment variables only. Currently single-user so the hardcoded credential is an accepted short-term risk — must be gone before anyone else logs in.
- Proper Supabase auth (Phase 2, line 50): replace custom auth with Supabase Auth, add user_id FK on all tables, enable RLS. Free tier handles this fine at small scale.
- Schema hygiene: keep the template/log separation intact (SESSIONS = template, workouts/workout_sets = log). This is the right shape for multi-user; don't collapse it.
- Performance baseline: stay within Supabase free-tier limits (500 MB DB, 2 GB bandwidth). Index foreign keys now; don't wait for it to be slow.
- Manageability: migrations via Supabase CLI only (not ad-hoc SQL editor runs). Resolve CLI v2.84.2 bug (toolchain audit item) before the next schema change.

Coaching-platform ideas (from GPT chat 20 Apr) — still valid architecture targets, not urgent:
- Adherence scoring, coach/client roles, programme library, simple progression automation, weekly check-ins.
- None of this gets built until the single-user experience is bulletproof and UAT has validated the core loop.

</details>

---

<details>
<summary>✅ Recent Bug Fixes</summary>

**21 Apr — session 5**

Login scroll bug (iOS Chrome) — page loaded scrolled down so topbar/greeting not visible on first load.
Fixes applied: `history.scrollRestoration = 'manual'` (prevents Chrome restoring previous scroll position for the URL), `requestAnimationFrame` deferred scroll reset in `showPage`, `window.scrollTo(0,0)` on login and page navigation. Reverted a bad detour through `position: fixed` on the login screen (broke iOS layout due to large-viewport calculation). Needs phone confirmation.

---

**21 Apr — session 4**

History "This Week" date range bug — filter was using a rolling `today - 7` window instead of the current calendar week, and `getWeekStart()` was anchored to Sunday instead of Monday. Fixed: `getWeekStart()` now uses `(d.getDay() + 6) % 7` (Monday anchor), and `getDateRangeFilter()` calls `getWeekStart()` directly instead of computing its own rolling 7-day offset. Also fixes "Sessions This Week" on Home and Stats which share the same function.

---

**21 Apr — session 3**

Pallof Press edit modal save bug — weight field was being set to "Red Band" (the band name from the DIV label) instead of null, causing a 400 Bad Request from Supabase (invalid input syntax for type numeric). Fixed: saveEditWorkout() now checks `ex.band` alongside `ex.bodyweight` when nulling out the weight field (lines 1233 + 1243 of app.js).

---

**21 Apr — session 2**

Pallof Press band rendering (3 fixes):
  - Prev badges now show "RB×15" / "YB×15" — abbreviated, self-contained, distinguishes Red vs Yellow
  - Weight column "Red Band" label switched from DM Mono → DM Sans (was spaced out and wrong)
  - Variation toggle button text now vertically centred (added flex align-items/justify-content)

---

**21 Apr — session 1**

Fix 1 — swUnlockAudio: Removed the swAudioUnlocked flag that was causing a hard early-return on every watch tap after the first. Now it checks swAudioCtx (create once) but calls resume() on every watch tap. This means each time you start a new set's rest timer, the gesture call re-wakes a suspended context — crucial if iOS killed it while the screen was locked between sets.

Fix 2 — swBeep is now async and awaits the resume(): Previously, resume() (which is async) was called without awaiting it. The oscillators were then scheduled immediately on a still-suspended context, producing silence. Now swBeep waits for the context to be running before scheduling the tones.

The likely scenario that was silently swallowing your beeps: you tapped the watch, rested, locked your phone screen → iOS suspended the AudioContext → timer completed → swBeep called resume() but immediately scheduled oscillators on a context that hadn't resumed yet.

---

**20 Apr**

Mid-workout refresh lockout bug — THE BIG ONE FROM THIS MORNING.
  - Happened: Mid Upper A, noticed topbar showed yesterday's date, refreshed the page. Workout marked as "logged today" and locked even though only 2 exercises were done. Stopwatch gone. Had to edit the rest via History modal (no stopwatch there).
  - Root cause: session grid marked ANY existing workout row for today as "done" — the moment you hit Mark Done on exercise 1, the tile locked.
  - Fix: added completed_at column to workouts table. NULL = in-progress, timestamp = closed. Save Workout now stamps it. Session grid only marks tiles "done" if completed_at is set. Tap a session with an existing in-progress row → silently resume. Tap a different session while one is in-progress → warn-and-switch. App load auto-closes any in-progress rows older than 24hrs.
Duplicate workouts bug removed from backlog — DB verified clean on 20 Apr (5 workouts, all legitimate, no duplicates).

---

**19 Apr**

Session grid collapses after tap — pill + "change" link + tap title to go back
History workout cards — top 3 lifts, amber label, removed duplicate white title
Greeting font — Bebas Neue → DM Sans (Bebas forces all-caps)
App renamed Del's Montage → D-Log (placeholder)
Rest day styling removed — Wed/Sun now same as all other days in week strip
Pallof prev badge partial fix — "Red Band×15" not "BW×15"

---

**18 Apr**

History page filters restyled, state persists (within session), search box keeps focus
Week strip doubling, session grid doubling
Woodchopper Cable/KG variation toggle
Seated Cable Row note "Not rope attachment"
Clear workout_draft on logout + 24hr expiry

---

**Pre 18 Apr**

Dead Bug save bug — "BW" was breaking numeric weight column
null×20 prev badges — now show BW×20
Stopwatch redesigned — inline per-exercise, wall-clock based

</details>
