CURRENT STATUS — D-Log
Last updated: Monday 20 July 2026

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
- **History edit-workout modal shows nothing about cardio.** Found during 20 Jul UAT: tapping a workout card in History opens the edit modal, which only knows about `workout_sets` (exercises) — it has no awareness of `cardio_logs` at all, so a session with cardio entries shows no trace of them once you tap in (the History **card** itself still shows the one-line cardio summary correctly — this is specifically the modal). This was a deliberate scope cut when cardio tracking was built (see Cardio Section in CODEBASE.md) — user confirmed 20 Jul it's fine to leave as-is for now, full triage/fix deferred to a dedicated session. When picked up: decide whether the fix is read-only display (simplest — fetch `cardio_logs` for `editingWorkoutId` and render a summary in the modal) or full edit/delete support (bigger — would need modal-side state like `editSelectedVariations` and its own save path).
- **Variation toggle — prev badges don't update when switching variation.** Badges are computed once at render time for the default variation. Switching to e.g. "New Leg Extension" shows `—` even though that variation has prior data. `selectVariation()` needs to re-compute and re-render the right-side badges for the selected variation on toggle.
- History filters don't persist across visits — should remember last state between tab changes
- Bottom nav layout bug on scroll (Chrome iOS)
- **Empty workout row shows in History if you open a session and abandon it.** `beginWorkoutSession()` (`js/app.js:450`) creates the `workouts` DB row the instant a session tile is tapped, before any set is logged — deliberate, from the 27 Apr fix (avoids sets getting lost if the row were only created lazily on first Mark Done). Cleanup-on-abandon only fires via two paths: tapping the "Log Workout" title (`resetSessionSelection`, `js/app.js:997`) or switching bottom-nav tabs — but that second path explicitly excludes Home (`showPage`, `js/app.js:1482`, `if (name !== 'home' ...)`), and there's no cleanup at all if the app is just closed/backgrounded. On top of that, `loadHistory()` (`js/app.js:1268`) queries all `workouts` rows with no `completed_at` filter, so an abandoned empty row shows up in History immediately rather than only after the 24hr auto-close job stamps it. Found 20 Jul: user opened Full Body + CV, didn't log anything, had to manually delete the resulting empty entry from History. Fix options discussed: (a) make `showPage('home')` also run the cleanup-delete, and/or (b) filter `loadHistory()` to exclude zero-set `completed_at IS NULL` rows. Not yet fixed — deferred to its own session.

**Quick wins**
- App name — "D-Log" is placeholder, needs a proper name
- ~~Shoulder Press — 3rd variation option~~ ✅ (Machine / DB → Machine / Smith / DB, both Upper A and Full Body C)
- ~~Rest-timer watch ring — counting-down color~~ ✅ (orange → red while running; green at target unchanged)
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
- ~~Protein/carbs/fat/fibre on daily check-in + Supabase columns~~ ✅ (shipped 20 Jul, manual entry — MyFitnessPal API isn't usable for a personal app, see Recent Bug Fixes) — UAT pending
- Weekly nutrition summary in Stats
- Cardio edit-modal support (currently no way to edit a saved cardio entry — delete/redo the workout instead)
- Stats weight graph — weekly average trend instead of daily dots (gaps on skipped days look bad)
- Graph audit — review all charts, shift from daily to weekly trend view where appropriate
- Saturday conditioning: named exercises with variation toggle
- ~~Workout types in DB — session grid needs programme picker when multiple programmes exist~~ ✅ (shipped 11 May — `TRAINING_PROGRAMMES` + `buildSessionGrid(programmeId)`, undocumented until this update)
- ~~Freeform "pick your own exercises" mode~~ ✅ shipped 17 Jul as **Open Workout** — see Recent Bug Fixes below. UAT pending (gym test morning of 18 Jul) — check the top of this doc / TDLR.md next session for the outcome before assuming it's solid.

**Push/Pull/Legs + 5-day split fixed programmes (STILL PARKED — not built)**
Separate from Open Workout above. User wants these as additional fixed `TRAINING_PROGRAMMES` entries (pure data, same pattern as Upper/Lower and Full Body+CV — see CODEBASE.md's Programme Picker section). Not started. The plan file that used to describe this (`C:\Users\User\.claude\plans\graceful-wishing-gizmo.md`) has since been overwritten with the Open Workout plan — there is no saved plan for PPL/5-day-split anymore, it'll need re-planning from scratch if picked up.

**Supersets (STILL UNRESOLVED — not built)**
No data model or UI for pairing two exercises (e.g. "Seated Calf Raise s/s Standing Single Leg Curl") today, even in Open Workout — each exercise is logged as an independent block. User's own instinct from 17 Jul: use Open Workout for a few real sessions first, decide whether supersets are worth building after seeing what's actually missing in practice. Don't build this unprompted — ask first.

**Phase 2**
- Proper Supabase auth + Vercel, user_id on all tables, RLS

**Done**
- ~~Open Workout — pick exercises from a dropdown, log as you go~~ ✅ (UAT pending — gym test 18 Jul morning)
- ~~Daily Check-in date picker — backfill past days~~ ✅
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

- Supabase CLI v2.84.2 is buggy — `db push` silently records a migration as applied but skips executing the SQL body. Had to run migration via Supabase dashboard SQL editor instead on 20 Apr. Update to v2.90.0 (tarball already downloaded).
- **Found 20 Jul: `supabase db query --linked -f <file.sql>` is a working alternative to `db push`.** It executes SQL directly against the linked remote project via the Management API and doesn't touch migration tracking at all, so the `db push` bug doesn't apply. The CLI is already authenticated and already linked to this project (`mltikqmwwlgyzogrgemr` / Delboy Fitness — confirmed via `supabase projects list`), so this can be run directly instead of pasting SQL into the dashboard by hand. Verified working: used for the cardio_logs/nutrition-columns migration this session, confirmed via `information_schema.columns` query afterward. Prefer this over the dashboard for future schema changes.
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

**20 Jul — Cardio tracking + hide fasting + nutrition macros (DEPLOYED, UAT PENDING)**

Three related changes from the same session, all in `js/app.js` + `index.html`:

1. **Cardio tracking** — new "Cardio (optional)" section at the bottom of every workout logger (below the exercises, above Session Notes), for cardio done after weights: Skipping, HIIT (with 5/10/15 min quick-pick chips), Bike, Rower, Ski Erg, Stepper, Treadmill, each with its own relevant fields (duration always; distance/floors/incline+speed as applicable — see CODEBASE.md's new Cardio Section for the full field list and units). Multiple entries per session are allowed, including repeats of the same activity. Modeled on Open Workout's Add Exercise pattern (`CARDIO_ACTIVITIES` config, `renderCardioSection`/`renderCardioEntryBlock`, `addCardioEntry`/`removeCardioEntry`). Unlike exercises, entries aren't saved incrementally — they're read live and POSTed once to a new `cardio_logs` table inside `saveWorkout()`. Draft-persisted like Open Workout's exercise list, so a refresh mid-session doesn't lose an added-but-unsaved entry. History workout cards now show a one-line cardio summary. This is fully separate from the existing Saturday "CV + Pump" free-text conditioning form (`conditioning_logs`) — that session never reaches the workout logger, so it's untouched.

2. **Fasting hidden** — not being tracked right now. Hidden (not deleted) from Daily Check-in, the Edit Daily Log modal, and the Stats tile/chart via `display:none`; the History daily-log card's fasting pill was removed from rendering. `fasting_hours` column and all past rows are untouched, and every JS read/write path still works — fully reversible by removing the `display:none`s.

3. **Nutrition macros** — `protein_g`/`carbs_g`/`fat_g`/`fibre_g` (grams) added next to Calories on Daily Check-in and the Edit modal, manual entry. MyFitnessPal has no usable public API for a personal single-user app — third-party access was discontinued in 2018, it's enterprise-partner-only now, and unofficial scraper libraries violate their ToS and require logging in with real credentials — so there's no auto-import path here.

Migration (4 new `daily_logs` columns + new `cardio_logs` table) run and verified against the live project on 20 Jul via `supabase db query --linked -f migration.sql` — see Toolchain Audit above for why this is now the preferred way to run schema changes on this project instead of the dashboard SQL editor.

**UAT 20 Jul**: user tested on the live server. One issue found — see Backlog → Bugs → "History edit-workout modal shows nothing about cardio." Everything else (logging cardio entries, Daily Check-in macro fields, fasting hidden) not reported as broken. Full bug triage deferred to a dedicated session per user.

---

**20 Jul — Rest-timer watch ring: red while counting down (DEPLOYED)**

`.ex-watch.running` (`css/style.css:237-238`) used `var(--accent)` (orange) for the ring stroke and inner time text while a rest was in progress. Switched both to the existing `var(--red)` variable (`#e05555`, already defined at line 5, unused elsewhere on this component). `.ex-watch.done` (green, target reached) is untouched — it's declared after `.running` in the stylesheet so it still wins once `pct >= 1` adds the `done` class alongside `running` (`swRenderWatch`, `js/app.js:1838`).

---

**20 Jul — Shoulder Press: 3rd variation option (DEPLOYED)**

Added `'Smith'` to Shoulder Press's `variations` array (was `['Machine', 'DB']`, now `['Machine', 'Smith', 'DB']`) at both occurrences in `SESSIONS` — Upper A (`js/app.js:15`) and Full Body C (`js/app.js:82`). `EXERCISE_LIBRARY` (Open Workout's Add Exercise dropdown) is built by flattening `SESSIONS`, so it picked up the 3rd option automatically — no separate edit needed there. Variation-toggle rendering (`renderExerciseBlock`, edit modal) and `.variation-toggle`/`.var-btn` CSS (`flex:1`, `gap:6px`) are both generic over array length, already used by 3-variation exercises elsewhere (none currently, but nothing hardcoded to 2) — no code changes needed beyond the data.

---

**17 Jul — Open Workout: pick exercises from a dropdown, log as you go (DEPLOYED, UAT PENDING — gym test 18 Jul morning)**

Real gym sessions had drifted away from the fixed Upper/Lower and Full Body+CV templates — user's actual recent training is ad hoc, picking whatever's relevant that day, including exercises the app didn't know about at all (Lower Back Pull, Dips, Goblet Squat, etc., named 17 Jul). Fixed-template programmes can't represent that. Full design conversation and the confirmed mechanism are in this session's transcript / the plan file used to build this (now overwritten at `C:\Users\User\.claude\plans\graceful-wishing-gizmo.md`).

New "Open Workout" tile alongside the programme cards on the top-level picker (`buildSessionGrid`). Unlike every other session type, it has no fixed exercise list — the logger starts empty with an **Add Exercise** dropdown at the bottom (`renderAddExerciseRow`). Picking a name calls `addOpenExercise()`, which looks the exercise up in a new `EXERCISE_LIBRARY` (flattened + deduped from every exercise across all fixed `SESSIONS`, plus anything typed in via "+ Type a new exercise…") and inserts a normal exercise block — same sets/reps/rest/variations/weight table every other session uses — directly above the dropdown row, without touching already-filled-in blocks. A small "✕" on each not-yet-Mark-Done'd block removes a mis-pick.

Typing a brand-new name POSTs it to a new `custom_exercises` Supabase table (manual `create table` run in the dashboard — same reasoning as always: the Supabase CLI v2.84.2 migration bug) so it persists into future Open Workout dropdowns from any device. Names containing `'`, `"`, or `` ` `` are rejected client-side — they'd break the inline `onclick="...('${name}')"` handlers the whole app already relies on for exercise names (pre-existing pattern, newly reachable now that names come from free-text `prompt()` instead of only hardcoded strings).

`'open'` is deliberately **not** added to `SESSIONS` — its exercise list is per-workout, not a template. Two helpers make that safe: `sessionDisplayName(id)` (`'open'` → "Open Workout", else the usual `SESSIONS.find`) used everywhere a session name is displayed, and `reconstructSessionFromSets(sets)` which rebuilds an exercises list from what's actually saved in `workout_sets` — used both to resume an in-progress Open Workout and as the fallback in `openEditWorkout`/`saveEditWorkout` (which previously silently rendered nothing for any `session_type` not found in `SESSIONS` — dead code until now, since every session_type used to come from `SESSIONS`).

Prev-lift badges for Open Workout exercises are scoped to past Open Workouts only (`fetchOpenPreviousSets`), not fixed-programme history for the same exercise — deliberate simplification, user's choice. A refresh mid-session before Mark Done doesn't lose an added-but-unsaved block: the draft (`saveDraft`/`localStorage`) now also remembers which exercise names were added (`draft.openExercises`), separately from DB-saved sets, and `buildWorkoutLogger` merges both sources before rendering.

Also refactored: `beginWorkoutSession()` extracted from `selectSession()` (the in-progress/resume/warn-and-switch/eager-row-creation logic) so Open Workout's `startOpenWorkout()` can reuse it instead of duplicating ~30 lines of resume-sensitive logic. `renderExerciseBlock()` extracted from `buildWorkoutLogger()` so the same block-rendering code serves fixed sessions, Open Workout's initial render, and dynamic append.

**Known unconfirmed risk**: same as always — if `workouts.session_type` has a dashboard-added CHECK constraint, inserting `'open'` could 400 on first save. Watch for this specifically during the 18 Jul gym UAT.

**Whether the `custom_exercises` SQL was actually run before this session ended is unconfirmed** — if the "+ Type a new exercise…" flow doesn't remember a name between sessions, that's why; re-run the `create table custom_exercises (...)` SQL from earlier in this session's transcript. Nothing else about Open Workout depends on that table — logging, saving, and History all work regardless (verified: the POST failure path is silently absorbed, doesn't block `addOpenExercise`).

---

**17 Jul — Daily Check-in date picker (DEPLOYED, UAT passed on iPhone)**

Added a date field to Daily Check-in so past days can be backfilled — previously `loadTodayLog()`/`saveDailyLog()` hardcoded `todayStr()` with no way to log a missed day, and History's edit modal only PATCHes existing rows (can't create one for a day with no row).

`loadTodayLog()` renamed to `loadDailyLog(date = todayStr())`, both it and `saveDailyLog()` now read/write against the date in a new `#log-date` input instead of hardcoded today. Date input capped at today (`max` attribute) to block future-dating. Defaults back to today every time the Check-in page is opened — backfilling a past day requires an explicit pick each visit, so you can't land on a stale date by accident.

Also fixed on iOS Chrome: the native `<input type="date">` rendered its own pill-shaped control nested inside the app's custom `.field-input` box, producing an overlapping double-rounded-rect look. Fixed with `-webkit-appearance: none; appearance: none; color-scheme: dark;` scoped to `input[type="date"].field-input`.

App is hosted on GitHub Pages (`delpedro.github.io/dels-montage/`), auto-deploys from `main` on push — confirmed via `gh api repos/Delpedro/dels-montage/pages`. `npm start` (live-server) is local-dev-only, not how the phone accesses it day to day. Note for future UAT: GitHub Pages/Fastly CDN cache is short (`max-age=600`) but browsers (especially iOS Chrome) can hold a stale cached copy well past that — use a private/incognito tab to verify a fresh deploy rather than trusting a normal tab reload.

---

**28 Apr — band exercise save failure + incomplete-rest save failure (DEPLOYED)**

Two bugs in `completeExercise`:

(1) Band exercises (Pallof Press) always showed "Save failed" toast regardless of rest periods. Root cause: `ex.band` was not checked alongside `ex.bodyweight` when nulling the weight field. Band exercises sent `weight: "Red Band"` to the DB — a 400 if the weight column is still numeric (the `change_weight_to_text` migration may not have applied due to known CLI v2.84.2 bug). Fix: `const isBodyweight = ex.bodyweight || ex.band;` — mirrors `saveEditWorkout` which was already correct.

(2) Any exercise with fewer than all rest periods recorded showed "Save failed". Root cause: sets without a stopwatch-recorded rest omitted `rest_seconds` from the POST body entirely. If the column has a NOT NULL constraint (possible — added via dashboard due to CLI bug), the missing field caused the whole batch insert to 400. Fix: `rest_seconds` always included in every set object, defaulting to `0`. The `0` is harmless — resume paint logic uses `if (s.rest_seconds)` which is falsy for 0.

Toast now shows HTTP status code on failure (`Save failed (400)`) for gym-side diagnosis without devtools.

UAT Thursday: Pallof Press all 4 sets → should go green. Regular exercise with only some rests → should go green.

---

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
