# D-LOG Codebase Reference

Single-file SPA. No framework, no build step. Two files do all the work:
- `js/app.js` — all logic (~2195 lines as of 20 Jul)
- `css/style.css` — all styles (~394 lines as of 17 Jul)
- `index.html` — static shell, no logic

Backend is Supabase (Postgres + REST API). All DB calls go through one helper: `sb()` at line 73.

---

## File Structure

```
index.html          — HTML shell: login screen + app div + modals
css/style.css       — All styles
js/app.js           — Everything else
```

---

## Auth (lines 111–143)

No sessions, no JWT. On login, password is SHA-256 hashed client-side and compared against `app_user.password_hash` in Supabase. Auth state lives in `sessionStorage` (`del_auth = '1'`). On page reload, `window.addEventListener('load')` checks for this key and restores the session.

**Login flow:**
1. `handleLogin()` (line 111) — hashes pw, queries `app_user`, if match: hides `#login-screen`, shows `#app`, calls `initApp()`
2. `handleLogout()` (line 131) — clears sessionStorage + `workout_draft` from localStorage, flips visibility back

---

## App Init (line 194)

```
initApp(page = 'home')
  └─ sets topbar date, #log-date max
  └─ autoCloseStaleWorkouts()   — closes in-progress workouts >24hrs old
  └─ loadCustomExercises()      — merges custom_exercises into EXERCISE_LIBRARY, fire-and-forget
  └─ buildSessionGrid()
  └─ loadDailyLog()
  └─ showPage(page)
```

---

## Navigation (line 1131)

`showPage(name)` is the single routing function. It:
1. Removes `.active` from all `.page` and `.nav-item` elements
2. Adds `.active` to `#page-{name}` and `#nav-{name}`
3. Saves current page to `sessionStorage('del_page')` (survives reload)
4. Resets scroll via `requestAnimationFrame` → `documentElement.scrollTop = 0; body.scrollTop = 0`
5. Calls the loader for that page: `loadHomePage()`, `loadStats()`, `loadHistory()`, `loadDailyLog()`

Pages: `home`, `today`, `workout`, `stats`, `history`

---

## Supabase Tables

| Table | Key columns | Used for |
|---|---|---|
| `app_user` | `email`, `password_hash` | Auth only |
| `daily_logs` | `date`, `weight_kg`, `steps`, `calories`, `fasting_hours`, `protein_g`, `carbs_g`, `fat_g`, `fibre_g`, `energy`, `notes` | Daily check-in. `fasting_hours` is hidden from the UI (20 Jul) but the column and old rows are untouched — see Fasting section below |
| `workouts` | `id`, `date`, `session_type`, `notes`, `completed_at` | Workout sessions |
| `workout_sets` | `workout_id`, `exercise`, `set_number`, `weight`, `reps`, `variation`, `rest_seconds` | Individual sets |
| `cardio_logs` | `workout_id`, `activity`, `duration_mins`, `distance`, `floors`, `incline`, `speed_kmh` | Structured cardio logged after weights (20 Jul) — see Cardio Section below. Separate from `conditioning_logs` |
| `conditioning_logs` | `date`, `activity`, `duration_mins`, `notes` | Saturday cardio (CV + Pump's free-text form only) |
| `quotes` | `quote`, `author` | Home page quote |
| `custom_exercises` | `name` (unique) | Names typed into Open Workout's "+ Type a new exercise…" — added 17 Jul, manual `create table` (see Open Workout section) |

`completed_at = null` means a workout is in-progress. `autoCloseStaleWorkouts()` (line 179) stamps these with `now` if they're >24hrs old.

---

## SESSIONS Data (lines 6–57)

Hardcoded array of 5 session objects. Each has:
- `id` — used as `session_type` in DB (e.g. `'upper-a'`)
- `day`, `name`, `focus`
- `exercises[]` — each with `name`, `sets`, `reps`, `rest`, optional `note`, `variations[]`, `band`, `bodyweight`

Special exercise flags:
- `bodyweight: true` — weight column shows "BW", saves `null` to DB
- `band: true` — weight column shows the selected variation name (e.g. "Red Band"), saves `null`
- `variations[]` — shows toggle buttons; selected variation stored in `selectedVariations[exName]`

Conditioning (id: `'conditioning'`) has no exercises array — shows a free-text form instead.

Each session also has a `programme` field (e.g. `'upper-lower'`, `'full-body-cv'`) grouping it under a `TRAINING_PROGRAMMES` entry — see below. (Added 11 May, previously undocumented here.)

---

## Programme Picker (added 11 May 2026 — not covered by the line numbers below, which predate it)

`TRAINING_PROGRAMMES` — array of `{ id, name, focus }`, one entry per training programme (currently: Upper/Lower, Full Body + CV).

`buildSessionGrid(programmeId = null)` is now two-mode:
- `programmeId` falsy → renders `TRAINING_PROGRAMMES` as tiles (`showProgrammeSessions(id)` on tap), sets `selectedProgramme = null`
- `programmeId` given → renders `SESSIONS.filter(s => s.programme === programmeId)` as session tiles, plus a "← Programmes" back tile

`selectedProgramme` (module-level var) tracks which mode is active. `resetSessionSelection(toProgrammePicker)` — `true` goes all the way back to the programme picker, `false` (default, used by the pill's "change" link and the "Log Workout" title tap) stays within the current programme.

An **"Open Workout"** tile also sits on this top-level screen, alongside the `TRAINING_PROGRAMMES` cards — it's not a programme (no sub-sessions), tapping it goes straight into the logger. See the dedicated Open Workout section below.

Push/Pull/Legs and a 5-day split (additional *fixed* programmes) were discussed 17 Jul but not built — see CURRENT_STATUS.md backlog. (Note: the plan file previously referenced here has since been overwritten with the Open Workout plan — there's no saved plan for this anymore.)

---

## Workout Logging Flow (lines 287–719, predates the 11 May programme picker — line numbers approximate)

### Selecting a session
`buildSessionGrid()` (line 287) — renders session buttons, marks done ones green (only counts `completed_at IS NOT NULL`).

`selectSession(session, btn)` (~line 415, since the 17 Jul refactor below):
1. Handles the cardio (`cv-pump`) special case directly (no workout row)
2. Otherwise delegates the in-progress/resume/warn-and-switch/row-creation logic to `beginWorkoutSession(session)` (see below)
3. Hides grid, shows session pill + workout logger (or conditioning form)
4. Calls `buildWorkoutLogger(session)`

`beginWorkoutSession(session)` (~line 425, extracted 17 Jul so Open Workout's `startOpenWorkout()` can reuse it):
1. Checks for in-progress workout today (`completed_at IS NULL`)
2. If same session → adopt existing `currentWorkoutId` (resume), set `currentWorkoutHasSets = true`
3. If different session → warn user (via `sessionDisplayName()`), then call `createWorkoutRow()` for the new session
4. If no in-progress → call `createWorkoutRow()` for fresh start
5. If `createWorkoutRow()` returns null (network/DB failure) → show error toast, return `false`
6. On success: sets `selectedSession`, resets `selectedVariations`, returns `true`

`createWorkoutRow(sessionId)` (line 89):
- POSTs to `workouts` with `Prefer: return=representation` — gets the new row's `id` back directly (no follow-up GET)
- Returns the UUID on success, `null` on failure

### Building the logger
`renderExerciseBlock(ex, session)` (~line 519, extracted 17 Jul) — builds the HTML for one exercise block (header, variation toggle, set rows, Mark Done button, and a "✕" remove button if `session.id === 'open'`). Pure function of `ex` + the module-level `previousSets{}` — reused for fixed-session rendering, Open Workout's initial render, and dynamic append via the Add Exercise dropdown.

`loadPreviousSetsForSession(session)` (~line 598) — populates `previousSets{}`. Fixed sessions: last workout of that `session_type`. Open Workout: delegates to `fetchOpenPreviousSets()` (see Open Workout section) — scoped to past Open Workouts only.

`buildWorkoutLogger(session)` (~line 655):
1. For Open Workout: merges in any exercises the draft remembers but the DB doesn't have saved sets for yet (`peekDraftOpenExercises()`) — covers a refresh before Mark Done
2. Calls `loadPreviousSetsForSession(session)`
3. Builds HTML via `renderExerciseBlock()` per exercise; for Open Workout, appends the Add Exercise row too
4. Calls `restoreDraft(session)` to repopulate any saved inputs
5. If `currentWorkoutId` exists (resume): fetches saved sets (weight, reps, rest_seconds), paints rest lines, fills empty inputs from DB, marks completed exercises green (and hides their "✕" remove button)

### Marking an exercise done
`completeExercise(exName)` (line 591):
1. Reads all set inputs for that exercise
2. Guards on `!currentWorkoutId` — shows error toast and returns (workout row is always created eagerly in `selectSession`, so this only fires on error)
3. Builds set objects — `weight: null` for bodyweight AND band exercises (`ex.bodyweight || ex.band`); `rest_seconds` always included (defaults to `0` if no stopwatch was used for that set)
4. Deletes existing sets for this exercise from DB (idempotent re-save)
5. POSTs new sets to `workout_sets`
6. Checks `saveRes.ok` — on failure, shows "Save failed (STATUS)" toast with HTTP status code and returns WITHOUT turning the exercise green
7. Sets `currentWorkoutHasSets = true`, flashes block border green

### Saving the workout
`saveWorkout()` (line 700):
- PATCHes the `workouts` row: sets `notes` + `completed_at = now()`
- Resets `currentWorkoutHasSets = false`, `currentWorkoutId = null`
- Clears draft, rebuilds session grid

### Cancelling a session
`resetSessionSelection()` (line 669):
- If `currentWorkoutId` is set and `currentWorkoutHasSets` is false (user tapped back before any Mark Done), DELETEs the empty workout row immediately
- Resets `currentWorkoutHasSets = false`, `currentWorkoutId = null`, `selectedSession = null`
- Clears draft, rebuilds session grid

### Draft auto-save
`saveDraft(sessionId)` (line 511) — called on every input event. Serialises all set inputs + notes + `pendingRest` to `localStorage('workout_draft')`. For Open Workout, also saves `draft.openExercises` (the list of exercise names added so far) — DB reconstruction alone only knows about *saved* sets, so a refresh before Mark Done would otherwise lose an added-but-empty block. Expires after 24hrs.

`restoreDraft(session)` (line 532) — called at end of `buildWorkoutLogger`. Reads draft, checks sessionId matches, populates inputs and rest lines.

---

## Open Workout (added 17 Jul 2026)

An alternative to the fixed `SESSIONS` templates — pick exercises from a dropdown as you go, instead of following a pre-built list. `'open'` is deliberately **not** added to `SESSIONS`; its exercise list is per-workout, not a template, so `SESSIONS.find(s => s.id === 'open')` correctly returns `undefined` everywhere and the code paths below handle that explicitly.

**`EXERCISE_LIBRARY`** (line 107, `buildExerciseLibrary()`) — flattens `SESSIONS[].exercises` deduped by name (first occurrence wins), keyed by name. `loadCustomExercises()` (line 117) merges in `custom_exercises` rows at app init (fire-and-forget, not awaited — see `initApp`). Custom entries get a default shape (`sets:3, reps:'8–12', rest:'90s'`, no variations/band/bodyweight).

**Entry point**: a tile on the top-level programme picker (see Programme Picker section) calls `startOpenWorkout()` (line 720):
1. Builds `{ id: 'open', name: 'Open Workout', exercises: [] }`, calls `beginWorkoutSession()`
2. If resuming an in-progress Open Workout, fetches its saved `workout_sets` and rebuilds the exercise list via `reconstructSessionFromSets()`
3. Shows the logger, calls `buildWorkoutLogger()` — which also merges in any draft-only (not-yet-saved) exercises before rendering

**The Add Exercise dropdown**: `renderAddExerciseRow()` (line 740) + `openExerciseSelectOptionsHtml()` (line 749) build a `<select>` of `EXERCISE_LIBRARY` names not already in the session, plus "+ Type a new exercise…". `handleOpenExerciseSelect()` routes to:
- `addOpenExercise(name)` (line 796) — looks up the def, pushes it into `selectedSession.exercises`, fetches its prev-lift data, and inserts a rendered block (`renderExerciseBlock()`) directly into the DOM just above the Add Exercise row — doesn't touch other already-filled-in blocks. Calls `saveDraft('open')` so the addition survives a refresh.
- `promptCustomExercise()` (line 773) — `prompt()`s for a name, rejects `'`/`"`/`` ` `` (these flow into inline `onclick="...('${name}')"` handlers throughout the app — a pre-existing pattern, newly reachable now that names can be free-typed instead of only hardcoded), checks for an existing `custom_exercises` row before POSTing a new one, then calls `addOpenExercise()`.

`removeOpenExercise(name)` (line 815) — the "✕" on each not-yet-Mark-Done'd block (hidden once Mark Done fires, same as the other done-state styling). Pulls the exercise back out of `selectedSession.exercises` and the DOM, re-renders the dropdown options.

**Previous-lift lookup**: `fetchOpenPreviousSets(exNames)` (line 617) — deliberately scoped to past Open Workouts only (`session_type=eq.open`), not fixed-programme history for the same exercise. Fetches the last ~20 completed Open workouts, then their `workout_sets` filtered to the requested exercise names via a PostgREST `in.()` filter, keeping only the sets from the most recent workout that actually contained each exercise (a single "last Open workout" won't reliably contain every exercise picked this time, since they vary session to session).

**History editing**: `openEditWorkout()`/`saveEditWorkout()` both fall back to `reconstructSessionFromSets(sets)` (line 503) when `SESSIONS.find()` comes up empty — rebuilds a synthetic `{ exercises: [...] }` from the distinct exercise names + max `set_number` actually saved, enriched via `EXERCISE_LIBRARY` for `bodyweight`/`band`/`variations` flags where the name matches. This was previously dead code (every `session_type` used to come from `SESSIONS`) — now load-bearing for Open Workout.

**Display name**: `sessionDisplayName(sessionType)` (line 496) — `'open'` → `'Open Workout'`, else the usual `SESSIONS.find(...)?.name || sessionType`. Used everywhere a session name is shown (recent workouts, history cards, history search, history filter dropdown, edit modal title) so Open Workout doesn't show up as the raw string `'open'`.

**Known unconfirmed risk**: if `workouts.session_type` has a dashboard-added CHECK constraint (possible, given the CLI v2.84.2 migration bug's history — see Toolchain Audit in CURRENT_STATUS.md), inserting `'open'` could 400. Not yet hit in testing as of 17 Jul, but watch for it.

---

## Cardio Section (added 20 Jul 2026)

Optional structured cardio, logged at the bottom of every workout logger — below the exercises, above Session Notes — for cardio done after weights (stairmaster, treadmill, bike, rower, ski erg, skipping, HIIT). Separate from the `cv-pump` "CV + Pump" session's pre-existing free-text conditioning form (`conditioning_logs` table) — that session never reaches `buildWorkoutLogger` (see Workout Logging Flow above), so it's untouched and the two systems don't overlap.

**`CARDIO_ACTIVITIES`** — config object (near `SESSIONS`) naming which fields each activity needs: duration is universal; `distance` (km for Bike, meters for Rower/Ski Erg), `floors` (Stepper), `incline`+`speed` (Treadmill). HIIT additionally gets `presets: [5,10,15]` for quick-pick duration chips.

**Rendering**: `renderCardioSection(session)` builds the "Cardio (optional)" heading + already-added entries (`session.cardioEntries`, initialized to `[]` in `buildWorkoutLogger`) + an "Add Cardio" `<select>`. Unlike Open Workout's Add Exercise dropdown, this one does **not** filter out already-picked activities — the same activity can be logged more than once in a session (e.g. two separate bike intervals). `renderCardioEntryBlock(entry, sessionId)` renders one activity's fields plus an `.ex-remove-btn` "✕" (reused as-is from Open Workout).

`handleAddCardio()` → `addCardioEntry(activity, values?)` (pushes into `selectedSession.cardioEntries`, inserts the block above the Add Cardio row — `values` is used on restore, see Draft below) / `removeCardioEntry(id)`, mirroring `addOpenExercise()`/`removeOpenExercise()`.

**Saving — deliberately not incremental**: unlike exercises (Mark Done saves immediately), cardio entries are only ever read live from their inputs and POSTed once, in `saveWorkout()`, via the new `collectCardioRows()` helper (skips any entry left completely empty). No delete-before-resave logic exists for cardio because nothing is written to `cardio_logs` until that single final save — there's no "already saved, now re-editing" case to handle.

**Draft persistence**: `saveDraft()`/`restoreDraft()` gained a `draft.cardio` array (activity + current field values per entry), same idea as `draft.openExercises` — protects added-but-unsaved cardio blocks from a mid-session refresh. Restoring replays `addCardioEntry(activity, values)` for each saved entry.

**History display**: `loadHistory()` batch-fetches `cardio_logs` for all visible workouts into `window._cardioByWorkout` (same one-call-not-per-card pattern as `window._setsByWorkout`). The workout history card renders one extra summary line under the top-3-lifts line via `formatCardioEntry()`, e.g. `Treadmill 20min, 6% @ 6km/h`. No edit-modal support for cardio yet — deleting/redoing the workout is the fallback if an entry needs correcting.

---

## Fasting — hidden from UI (20 Jul 2026)

Not being tracked currently. The `fasting_hours` column, all past rows, and every JS read/write path (`loadDailyLog`, `saveDailyLog`, `openEditLog`, `saveEditLog`) are untouched — only the UI is hidden, via `style="display:none"` on: the Fasting `field-group` on Today's Daily Check-in, the Fasting `field-group` in the Edit Daily Log modal, and `#tile-fasting` on the Stats page (its `switchChart('fasting')` chart type still works in code, just unreachable from the UI now). The History daily-log card's fasting pill was removed from rendering entirely (not just hidden) since it's built dynamically per-row rather than being a static element. Fully reversible — remove the `display:none`s (and re-add the History pill line) to bring it back.

---

## Rest Timer / Stopwatch (lines ~1350–1638)

Per-exercise watch button (`.ex-watch`) inside each exercise tile. SVG ring shows progress toward the target rest duration.

**Key state:**
- `swStartTimestamp` — `Date.now()` when timer started (wall-clock, survives phone lock)
- `swTargetSeconds` — parsed from exercise `rest` field (e.g. `'180s'` → 180)
- `swRunning`, `swActiveExercise`

**Tap = start/stop.** Long press (450ms) = reset without saving.

`swStop()` (line 1525):
1. Calculates elapsed
2. Finds last typed set for this exercise via `swFindLastTypedSetForExercise()` (line 1442)
3. Saves `rest_seconds` to DB via `swSaveRest()`, or buffers in `pendingRest{}` if workout row doesn't exist yet
4. Paints `↳ Rest m:ss` under the set row

Timer state persisted to `sessionStorage('sw_state')` so it survives navigating to Stats and back. Restored by `swRestoreFromStorage()` (line 1620) at end of `buildWorkoutLogger`.

**Audio:** Web Audio API, lazy-init. iOS needs the AudioContext created inside a user gesture — handled by `swUnlockAudio()` (line 1395) called inside `swStart()`. Context is re-resumed on every tap because iOS suspends it on screen lock.

---

## Home Page (lines 215–285)

`loadHomePage()` (line 215):
- Sets greeting (`getGreeting()` — morning/afternoon/evening by hour)
- Picks random quote from `quotes` table
- Fetches: latest weight, today's steps, this week's workout count, last 7 days steps for average
- Calls `buildWeekStrip('home-week-strip')`

`buildWeekStrip(containerId)` (line 256) — renders 7 day bubbles for the current Sun–Sat week. Highlights today (accent) and days with a workout (green).

`getWeekStart()` (line 249) — returns Monday's date string for the current week.

---

## Daily Check-in (lines ~850–900)

`loadDailyLog(date = todayStr())` — resets `#log-date` to today, clears fields, then fetches the given date's row and populates if found. Called with no args on page nav (always resets to today first — backfilling a past day requires an explicit re-pick each visit).

`saveDailyLog()` — reads the date from `#log-date` (falls back to `todayStr()` if empty), checks if a row for that date exists: PATCH if yes, POST if no. This existing PATCH/POST branching is what makes backfilling work — no separate "create" path was needed once the date stopped being hardcoded.

**Nutrition (added 20 Jul)**: `protein_g`/`carbs_g`/`fat_g`/`fibre_g` (grams) sit alongside `calories`, same read/write pattern, manual entry — MyFitnessPal has no usable public API for a personal app (third-party access discontinued 2018), so there's no auto-import path. Mirrored in the Edit Daily Log modal (`edit-protein`/etc.) and shown as extra pills on the History daily-log card.

`setEnergy(val)` — sets `selectedEnergy`, toggles `.selected` on emoji buttons. Called with `0` to deselect all.

`index.html` `#log-date` — `<input type="date">`, `max` set to today in `initApp()` to block future-dating. Needs `-webkit-appearance:none; appearance:none; color-scheme:dark` (see CSS Layout section below) or iOS renders its own nested pill control inside `.field-input`, causing a visual double-box overlap.

---

## Stats Page (lines 786–911)

`loadStats()` (line 786) — single `Promise.all` fetches last 14 days of weight logs, daily logs, workouts, plus 5 most recent workouts. Populates 4 stat tiles + calls `switchChart()`.

`switchChart(type)` (line 832) — destroys existing Chart.js instance if present, builds new one. Types: `weight`, `sessions`, `fasting`, `steps`. Data lives in `statsData{}` set during `loadStats()`.

---

## History Page (lines 913–1129)

`loadHistory()` (line 913) — fetches all daily_logs + workouts. Fetches all workout_sets in one batched call (grouped into `window._setsByWorkout` for O(1) lookup during render).

`renderHistoryPage()` (line 977) — builds the filter bar + paginated list. Items sorted by date, grouped by date header. 15 items per page.

Filter state (module-level vars):
- `historyTab` — `'all'` / `'workouts'` / `'daily'`
- `historyDateRange` — `'all'` / `'month'` / `'week'`
- `historyWorkoutFilter` — `'all'` or session id
- `historySearchTerm` — string

`restoreSearchFocus()` (line 1086) — hack to keep cursor position in the search input across re-renders. Saves `{focused, pos}` before `renderHistoryPage()`, restores after.

Editing: tapping a daily log card → `openEditLog(l)` (line 1152) → edit modal. Tapping a workout card → `openEditWorkout()` (line 1201) → edit modal.

`deleteWorkout()` (line 1325) — deletes `workout_sets` rows first, then `workouts` row (foreign key order).

---

## Edit Modals

Two modals in `index.html`, both `position:fixed; inset:0; z-index:200`.

- `#edit-modal` — edit daily log. State: `editingLogDate`, `editingEnergy`
- `#edit-workout-modal` — edit workout sets. State: `editingWorkoutId`, `editingSessionType`, `editSelectedVariations`

---

## CSS Layout

Dark theme. CSS variables in `:root` for all colours.

**Two top-level states:**
- `#login-screen` visible (`display:flex`), `#app` hidden (`display:none`) — before auth
- `#login-screen` hidden, `#app` visible (`display:block`) — after auth

**App shell:**
- `.topbar` — `position:sticky; top:0; z-index:100` — always visible
- `.bottom-nav` — `position:fixed; bottom:0; z-index:100; height:65px` — always visible
- `#app` — `padding-bottom:80px` to clear the nav
- `.page` — `display:none` by default; `.page.active { display:block }`

**Fonts:** Bebas Neue (headings/numbers), DM Sans (body), DM Mono (set inputs, badges)

**Native `<input type="date">` on iOS**: needs `-webkit-appearance:none; appearance:none; color-scheme:dark` (see `input[type="date"].field-input` in style.css) or WebKit renders its own pill-shaped control nested inside the custom `.field-input` box — visible as an overlapping double-rounded-rect.

---

## Global State Variables (lines 59–70)

| Variable | Purpose |
|---|---|
| `selectedEnergy` | Current energy emoji selection (1–5, 0 = none) |
| `selectedSession` | The session object user tapped in the grid |
| `previousSets{}` | Last session's set data, keyed by exercise name |
| `selectedVariations{}` | Active variation per exercise in current logger |
| `editSelectedVariations{}` | Same but for the edit workout modal |
| `mainChart` | Chart.js instance (destroyed on tab switch) |
| `currentChartType` | `'weight'` / `'sessions'` / `'fasting'` / `'steps'` |
| `currentPage` | Current page name |
| `currentWorkoutId` | DB id of the in-progress workout row — set eagerly in `selectSession`, never null during logging |
| `currentWorkoutHasSets` | True once any exercise has been successfully saved; used to decide whether to delete the workout row on cancel |
| `lastCompletedExercise` | Set after each `completeExercise()` call |
| `pendingRest{}` | Buffer for rest times in edge cases where workout row isn't set yet |

---

## Known Quirks / Non-Obvious Behaviour

- Workout row is created **eagerly in `selectSession`** (not lazily on first Mark Done). This means `currentWorkoutId` is always set by the time the user can interact with exercises. The `pendingRest{}` buffer is a legacy safety net for edge cases.
- History sets are fetched in one batched call and stored in `window._setsByWorkout` — not a per-card fetch.
- `buildWeekStrip` clears `innerHTML` AFTER the async fetch to prevent race conditions from concurrent calls both writing to the same empty container.
- `buildSessionGrid` does the same: fetch first, clear second.
- iOS Chrome scroll bug (FIXED): fresh load + login was showing greeting scrolled off top ~60px. Winning combo: login-screen as `position:fixed` overlay + `#app` always `display:block` + `html.login-active{overflow:hidden;touch-action:none}` held from page load + JS scroll guard on scroll event + overlay hidden after 2 rAFs post scroll reset.
- iOS audio: Web Audio context must be created inside a user gesture and re-resumed after screen lock. `swUnlockAudio()` handles both.
- `history.scrollRestoration = 'manual'` set at line 1 to suppress browser scroll restoration.
