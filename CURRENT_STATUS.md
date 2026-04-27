CURRENT STATUS — D-Log
Last updated: Wednesday 23 April 2026

---

<details open>
<summary>🔴 TOP PRIORITY NEXT</summary>

**PWA + background notifications**
- Requires manifest.json + service-worker.js + icons
- Enables iOS beep when phone locked/app closed
- Big job — start in a fresh chat at low usage

**iOS audio workarounds to trial (researched 27 Apr)**
Three approaches found for keeping AudioContext alive when navigating away / locking screen:
1. **Silent audio loop** — create an `<audio>` element playing a silent/near-silent file in a loop, started on a user gesture (e.g. "Start Training" tap). iOS keeps the JS engine awake if it thinks media is playing.
2. **Route AudioContext through a MediaStream** — `const stream = audioCtx.createMediaStreamDestination()`. Safari treats a live MediaStream like an active call and doesn't kill it in the background.
3. **`visibilitychange` resume** — `document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') audioContext.resume(); })` — catches the return-to-app case when context has suspended.
Approach 1 is considered most reliable. Best tried together with the PWA service worker work.

</details>

---

<details open>
<summary>📚 DOCS</summary>

- ~~CODEBASE.md — full function reference with line numbers~~ ✅
- ~~RTFM.md — how to use the app~~ ✅

</details>

---

<details open>
<summary>📋 Backlog (roughly priority order)</summary>

**Bugs**
- ~~Login page scroll bug — iOS Chrome + Safari, fresh load scrolled past greeting~~ ✅ FIXED session 7
- **Variation toggle — prev badges don't update when switching variation.** Badges are computed once at render time for the default variation. Switching to e.g. "New Leg Extension" shows `—` even though that variation has prior data. `selectVariation()` needs to re-compute and re-render the right-side badges for the selected variation on toggle.
- History filters don't persist across visits — should remember last state between tab changes
- Bottom nav layout bug on scroll (Chrome iOS)

**Quick wins**
- App name — "D-Log" is placeholder, needs a proper name
- ~~Smith Machine Incline — variation toggle~~ ✅ (renamed → Incline Chest Press, variations: Smith / DB)
- ~~Lateral Raise — variation toggle (Machine / DBs)~~ ✅
- Display rest_seconds in workout history cards
- Data labels on chart nodes
- Retrofit more comments into app.js

**Features**
- Home weight tile → weekly average trend (Mon–Mon)
- Stats "Recent Workouts" → show lifts not session descriptions
- Stats: exercise picker — progressive overload chart for a chosen lift
- Adherence score on home page (e.g. "3/4 sessions, 5/7 step target")
- Protein/carbs/fat on daily check-in + Supabase columns
- Weekly nutrition summary in Stats
- Stats weight graph — weekly average trend instead of daily dots (gaps on skipped days look bad)
- Graph audit — review all charts, shift from daily to weekly trend view where appropriate
- Saturday conditioning: named exercises with variation toggle
- Programme B (3–5 rep heavy strength) + Programme C (15–20 reps)
- Workout types in DB — session grid needs programme picker when multiple programmes exist

**Phase 2**
- Proper Supabase auth + Vercel, user_id on all tables, RLS

**Done**
- ~~Pallof null fix in edit modal~~ ✅
- ~~Stopwatch — inline per-exercise, wall-clock based, survives lock/background/navigation/refresh~~ ✅
- ~~Audio beep on rest complete~~ ✅
- ~~Session grid collapses after selection — pill + full screen logging~~ ✅
- ~~Tap "Log Workout" title to go back — warns if data exists~~ ✅
- ~~History workout cards — top 3 lifts by heaviest weight, amber label~~ ✅
- ~~Draft auto-save — survives reload, 24hr expiry, cleared on logout~~ ✅
- ~~Dead Bug saves correctly (null weight, not "BW")~~ ✅
- ~~Pallof/band prev badges show "RB×15" / "YB×15"~~ ✅
- ~~Pallof weight column label renders in DM Sans~~ ✅
- ~~Variation toggle buttons — text vertically centred~~ ✅
- ~~In-progress workout state — save/resume/warn-and-switch/24hr auto-close~~ ✅
- ~~History "This Week" filter — was using rolling 7-day window instead of Mon–today~~ ✅

</details>

---

<details>
<summary>🔧 Toolchain Audit (dedicated session — do this before next bigger feature work)</summary>

- Supabase CLI v2.84.2 is buggy — db push silently records a migration as applied but skips executing the SQL body. Had to run migration via Supabase dashboard SQL editor instead on 20 Apr. Update to v2.90.0 (tarball already downloaded).
- Supabase CLI installed at C:\WINDOWS\system32\supabase.exe — bad practice, should be relocated to a proper tools folder or installed via package manager.
- General audit: npm global packages, Docker status, VS Code extensions.

</details>

---

<details>
<summary>📝 Phase 3 — multi-user / coach platform (PARKED)</summary>

App started as a personal tool but is growing fast. Plan: ship multiple-programmes support → recruit UAT testers → evaluate multi-user rollout.

**Foundation priorities (before UAT):**
- Security: no secrets/hashes in source code — must be gone before anyone else logs in
- Proper Supabase auth (Phase 2): replace custom auth with Supabase Auth, add user_id FK on all tables, enable RLS
- Schema hygiene: keep SESSIONS (template) / workouts+workout_sets (log) separation — right shape for multi-user
- Performance: index foreign keys now; stay within Supabase free-tier limits (500 MB DB, 2 GB bandwidth)
- Migrations via Supabase CLI only — resolve CLI v2.84.2 bug before next schema change

**Coaching platform ideas (not urgent):**
- Adherence scoring, coach/client roles, programme library, progression automation, weekly check-ins
- None of this until single-user experience is bulletproof and UAT has validated the core loop

</details>

---

<details open>
<summary>✅ Recent Bug Fixes</summary>

**27 Apr — silent workout save failure (DEPLOYED — needs UAT at next workout)**

Two root causes: (1) `completeExercise` created the workout row lazily on first Mark Done — if `currentWorkoutId` was null for exercises 2–N (state loss, race condition), each call would silently fail or scatter sets to orphaned rows. (2) `sb('workout_sets', 'POST', sets)` return value was never checked — Supabase 4xx/5xx silently swallowed, exercise always turned green regardless of DB outcome.

Fix: workout row now created eagerly in `selectSession` (using `Prefer: return=representation` to get ID directly — no follow-up GET needed). `completeExercise` now guards on `!currentWorkoutId` and checks `saveRes.ok`, showing an error toast on failure instead of falsely turning green. `currentWorkoutHasSets` flag added so cancelled sessions clean up their empty workout row. Conditioning sessions gated out from row creation. Also removed stray `session-pill` DOM hide from `saveDraft` that was firing on every keystroke.

---

**23 Apr — workout data loss on resume (FIXED — superseded by 27 Apr root cause work)**

After mid-workout navigation, `selectSession` set `currentWorkoutId = existing.id` but the next line unconditionally reset it to `null`. Removed the rogue reset. Also added resume UX: `buildWorkoutLogger` fetches saved sets, fills inputs, marks completed exercises green.

**Known iOS audio limitation:** Stopwatch beep may stop if the phone locks during a rest. `AudioContext.resume()` from `setInterval` (not a user gesture) is silently rejected by iOS. Real fix requires the PWA service worker (top backlog item).

---

**21 Apr — sessions 5, 6, 7 — login scroll bug (FIXED session 7)**

iOS Chrome only. After fresh load + login, home page loads with greeting scrolled off top (~60px). Logout+login works fine. Safari fixed. Chrome still broken.

All failed attempts:
- `history.scrollRestoration = 'manual'`
- `requestAnimationFrame(() => window.scrollTo(0,0))`
- `position:fixed` on login screen (original attempt — broke iOS keyboard layout)
- `document.documentElement.scrollTop = 0; document.body.scrollTop = 0`
- Removed `height:100%` from `html,body`
- `document.activeElement?.blur()` + 350ms delay
- `overflow:hidden` on html+body during transition, released after 500ms + rAF
- `window.scrollTo(0,0)` in window.load handler
- `#login-screen` as `position:fixed` overlay, `#app` always `display:block` — fixed Safari, Chrome still broken
- `html.login-active { overflow:hidden; touch-action:none }` held from page load until login
- JS scroll guard: `window.scrollTo(0,0)` on every scroll event while login-active
- Keep overlay visible for 2 rAFs after scroll reset before hiding

Current code state: login-screen is position:fixed overlay, #app always display:block, html.login-active{overflow:hidden;touch-action:none} from page load, JS scroll guard while login-active, overlay hidden after 2 rAFs.

CONFIRMED FIXED on Chrome + Safari, cold load, no Web Inspector, history cleared. Winning combination: login-screen as position:fixed overlay + #app always display:block + html.login-active{overflow:hidden;touch-action:none} held from page load + JS scroll guard + overlay hidden after 2 rAFs post scroll reset.

Also session 6: wrote CODEBASE.md — full function reference with line numbers.

---

**21 Apr — session 4**

History "This Week" date range bug — filter was using rolling `today - 7` instead of current calendar week. `getWeekStart()` was anchored to Sunday. Fixed: `(d.getDay() + 6) % 7` (Monday anchor), `getDateRangeFilter()` calls `getWeekStart()` directly. Also fixed "Sessions This Week" on Home + Stats (same function).

---

**21 Apr — session 3**

Pallof Press edit modal save bug — weight field was being set to "Red Band" (band name from DIV label) instead of null, causing 400 from Supabase. Fixed: `saveEditWorkout()` now checks `ex.band` alongside `ex.bodyweight` when nulling weight field.

---

**21 Apr — session 2**

Pallof Press band rendering (3 fixes):
- Prev badges now show "RB×15" / "YB×15" — abbreviated, distinguishes Red vs Yellow
- Weight column label switched DM Mono → DM Sans
- Variation toggle button text vertically centred

---

**21 Apr — session 1**

Audio beep fixes:
- Removed `swAudioUnlocked` flag causing hard early-return after first tap — now calls `resume()` on every watch tap to re-wake suspended context
- `swBeep` now async and awaits `resume()` before scheduling oscillators — previously scheduled on still-suspended context (silence)

---

**20 Apr**

Mid-workout refresh lockout bug:
- Root cause: session grid marked ANY workout row for today as "done" — tile locked after first Mark Done
- Fix: added `completed_at` column. NULL = in-progress, timestamp = closed. Grid only marks "done" if `completed_at` is set. Tap same session → silently resume. Tap different session → warn-and-switch. App load auto-closes rows older than 24hrs.

---

**19 Apr**
- Session grid collapses after tap — pill + "change" link + tap title to go back
- History workout cards — top 3 lifts, amber label, removed duplicate white title
- Greeting font — Bebas Neue → DM Sans
- App renamed Del's Montage → D-Log
- Rest day styling removed from week strip
- Pallof prev badge partial fix

---

**18 Apr**
- History page filters restyled, state persists within session, search box keeps focus
- Week strip + session grid doubling bug fixed
- Woodchopper Cable/KG variation toggle
- Seated Cable Row note added
- Clear workout_draft on logout + 24hr expiry

---

**Pre 18 Apr**
- Dead Bug save bug — "BW" breaking numeric weight column
- null×20 prev badges → now show BW×20
- Stopwatch redesigned — inline per-exercise, wall-clock based

</details>
