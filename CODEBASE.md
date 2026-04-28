# D-LOG Codebase Reference

Single-file SPA. No framework, no build step. Two files do all the work:
- `js/app.js` — all logic (~1638 lines)
- `css/style.css` — all styles (~373 lines)
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
  └─ sets topbar date
  └─ autoCloseStaleWorkouts()   — closes in-progress workouts >24hrs old
  └─ buildSessionGrid()
  └─ loadTodayLog()
  └─ showPage(page)
```

---

## Navigation (line 1131)

`showPage(name)` is the single routing function. It:
1. Removes `.active` from all `.page` and `.nav-item` elements
2. Adds `.active` to `#page-{name}` and `#nav-{name}`
3. Saves current page to `sessionStorage('del_page')` (survives reload)
4. Resets scroll via `requestAnimationFrame` → `documentElement.scrollTop = 0; body.scrollTop = 0`
5. Calls the loader for that page: `loadHomePage()`, `loadStats()`, `loadHistory()`, `loadTodayLog()`

Pages: `home`, `today`, `workout`, `stats`, `history`

---

## Supabase Tables

| Table | Key columns | Used for |
|---|---|---|
| `app_user` | `email`, `password_hash` | Auth only |
| `daily_logs` | `date`, `weight_kg`, `steps`, `calories`, `fasting_hours`, `energy`, `notes` | Daily check-in |
| `workouts` | `id`, `date`, `session_type`, `notes`, `completed_at` | Workout sessions |
| `workout_sets` | `workout_id`, `exercise`, `set_number`, `weight`, `reps`, `variation`, `rest_seconds` | Individual sets |
| `conditioning_logs` | `date`, `activity`, `duration_mins`, `notes` | Saturday cardio |
| `quotes` | `quote`, `author` | Home page quote |

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

---

## Workout Logging Flow (lines 287–719)

### Selecting a session
`buildSessionGrid()` (line 287) — renders session buttons, marks done ones green (only counts `completed_at IS NOT NULL`).

`selectSession(session, btn)` (line 306):
1. Checks for in-progress workout today (`completed_at IS NULL`)
2. If same session → adopt existing `currentWorkoutId` (resume), set `currentWorkoutHasSets = true`
3. If different session → warn user, then call `createWorkoutRow()` for the new session
4. If no in-progress → call `createWorkoutRow()` for fresh start
5. For conditioning sessions: skip workout row creation (`currentWorkoutId = null`)
6. If `createWorkoutRow()` returns null (network/DB failure) → show error toast, abort
7. Hides grid, shows session pill + workout logger (or conditioning form)
8. Calls `buildWorkoutLogger(session)`

`createWorkoutRow(sessionId)` (line 89):
- POSTs to `workouts` with `Prefer: return=representation` — gets the new row's `id` back directly (no follow-up GET)
- Returns the UUID on success, `null` on failure

### Building the logger
`buildWorkoutLogger(session)` (line 375):
1. Fetches last 2 workouts for this session type to get previous set data
2. Builds HTML: one `.exercise-block` per exercise, each with N set rows
3. Set row layout (CSS grid): `[set#] [weight input] [reps input] [prev badge]`
4. Calls `restoreDraft(session)` to repopulate any saved inputs
5. If `currentWorkoutId` exists (resume): fetches saved sets (weight, reps, rest_seconds), paints rest lines, fills empty inputs from DB, marks completed exercises green

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
`saveDraft(sessionId)` (line 511) — called on every input event. Serialises all set inputs + notes + `pendingRest` to `localStorage('workout_draft')`. Expires after 24hrs.

`restoreDraft(session)` (line 532) — called at end of `buildWorkoutLogger`. Reads draft, checks sessionId matches, populates inputs and rest lines.

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

## Daily Check-in (lines 736–783)

`loadTodayLog()` (line 736) — always clears fields first, then fetches today's row and populates if found.

`saveDailyLog()` (line 755) — checks if today's row exists: PATCH if yes, POST if no.

`setEnergy(val)` (line 778) — sets `selectedEnergy`, toggles `.selected` on emoji buttons. Called with `0` to deselect all.

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
