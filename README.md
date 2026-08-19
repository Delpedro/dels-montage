# D-Log

Personal training tracker. Logs workouts, tracks progress, and handles multiple training programmes
with daily check-ins.

No framework. No build step. Vanilla JS + Supabase. Installs to an iPhone home screen as a PWA.

---

## Features

**Workout logging**
- **Two programmes**: Upper / Lower (Upper A, Lower A, Upper B, Lower B) and Full Body + CV
  (3 strength days, 2 CV + pump days). Session tiles are coloured by what you train.
- **Open Workout** — log anything that isn't a fixed session, and turn it into a reusable one afterwards
- Per-set weight and reps, with last session's numbers shown inline as badges
- **Supersets** — pair any two exercises; the pair gets one Mark Done and one rest timer
- Variation toggles for exercises with alternatives (Hack Squat / Leg Press, Cable / KG)
- Band exercises with abbreviation badges (RB×15, YB×15), and bodyweight exercises (null weight, no "BW" string in the DB)
- Cardio blocks (treadmill, bike, rower, …) logged alongside the lifting
- **Session template editor** (✎) — rename, reorder, add, remove, superset, change set counts
- Custom exercises, added inline from the picker
- Mark Done per exercise — turns green and writes to Supabase immediately
- PR badges on weight *and* reps, keyed by exercise **and** variation

**Rest timer**
- Per-exercise stopwatch, wall-clock based — survives phone lock, navigation and page refresh
- Starts itself when you tap Mark Done; audio beep and vibration on target
- Rest time saved per set and shown inline in history

**Session state**
- In-progress workout survives navigation, phone lock and reload
- Resume: fills inputs from the DB and marks completed exercises green
- Switch session mid-workout with confirmation — the old one stays open for later
- Draft auto-save to localStorage (24hr expiry), 24hr auto-close for stale sessions
- Empty workout rows cleaned up on the way out, so they never reach History

**History**
- Per-session cards, top 3 lifts by heaviest weight
- Filters by date range and by workout, plus free-text search
- Inline edit modal to correct any set (weight, reps, variation)

**Daily check-in**
- Weight, steps, calories, protein, energy, notes — with macro targets. In History a macro row is
  plain unless it actually misses its target, and then it says by how much
- **Weekly average weight**, numbered in *tracking* weeks (week 1 = your first weigh-in of the
  current run), compared against the week you're in
- Edit past entries via modal

**Home / Stats**
- Weekly session strip — each day shows what was trained (UA / LA / UB / LB / FBA / CVP / OW)
- Weight trend, weekly averages, session counts
- Amber nag when the last backup is over a week old

**Data safety**
- Export everything to JSON (UTF-8 declared, so notes don't open as gibberish)
- `tools/backup.js` — credential-free dump of every table
- Supabase Auth with per-user RLS on every table

**Offline / deployment**
- Service worker: network-first with `cache: 'reload'`, so a deploy can never be masked by a cache
- Build stamp checked on every foreground — an installed PWA that iOS *resumes* rather than
  relaunches still notices it's running old code and refreshes itself

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML / CSS / JS — no framework, no build step |
| Backend | Supabase (PostgREST REST API) |
| Auth | Supabase Auth (GoTrue), per-user RLS on every table |
| Dev server | live-server (hot reload) |
| Tests | Plain `node`, no framework — `npm test` |
| Hosting | GitHub Pages, served from `main` |
| DB migrations | Supabase CLI |

---

## Dev setup

```bash
npm install        # first time only — installs live-server
npm start          # runs at http://localhost:8080 with hot reload
npm test           # ~629 assertions, no dependencies
```

No environment variables needed locally — the Supabase URL and publishable key are inlined in
`js/app.js`. They are safe there: the key is publishable, and every table is behind RLS.

**Before every push**, run `node tools/bump-build.js`. It stamps `APP_BUILD`, `version.json`, the
`?v=` query strings in `index.html` and `sw.js`'s `CACHE_NAME`. Skip it and the app stops
self-updating on the phone.

---

## Project structure

```
index.html              # single-page app shell — all pages as divs, shown/hidden by JS
css/style.css           # all styles — dark theme, DM Sans + DM Mono + Bebas
js/app.js               # all application logic (~5,100 lines)
sw.js                   # service worker — network-first, cache only as offline fallback
version.json            # build stamp the app polls to detect its own staleness
tests/                  # node test suite — see below
tools/
  bump-build.js         # stamps the build id everywhere it appears
  backup.js             # dumps every table to .backup/
supabase/
  config.toml
  migrations/           # schema history (Supabase CLI format)
```

Full function reference: [CODEBASE.md](CODEBASE.md) · App usage guide: [RTFM.md](RTFM.md)

---

## Tests

`npm test` runs every `tests/*.test.js` plus `node --check` on the app's JS. No framework and no
dependencies, because the project has no build step and isn't getting one.

The interesting part is [tests/extract.js](tests/extract.js): it reads `js/app.js` as text, slices
named functions and top-level declarations straight out of the source, and evaluates them against
stubbed dependencies. So a test cannot quietly pass against a stale copy of the function — there is
no copy. It also means a single-file, no-module, `<script>`-tag app is properly testable without
being restructured into something it isn't.

```bash
npm test                        # everything
node tests/sb-offline.test.js   # one file
```

---

## Database schema

| Table | Purpose |
|---|---|
| `workouts` | One row per logged session. `completed_at` null = in-progress. |
| `workout_sets` | Individual sets. FK to `workouts`. Exercise, set number, weight, reps, variation, rest_seconds. Unique on `(workout_id, exercise, set_number)`. |
| `cardio_logs` | Cardio entries attached to a workout — activity, duration, distance, intensity. |
| `conditioning_logs` | CV + Pump entries — activity, duration, notes. |
| `daily_logs` | Daily check-in — weight, steps, calories, protein, energy, notes. |
| `goals` | Macro and weight targets. |
| `session_templates` | A session tile: name, programme, order. |
| `session_exercises` | The exercises in a template, including superset groups. |
| `custom_exercises` | Exercises added by hand from the picker. |
| `app_meta` | Cross-device state — currently `last_backup_at`. |
| `quotes` | Motivational quotes, seeded. |

Every table has `user_id` and RLS enabled; `anon` can read none of them.

---

## Programmes

**Upper / Lower** — run as a **rolling rotation**, not fixed weekdays: Upper A → Lower A → Upper B →
Lower B → Upper A → …, roughly 5 sessions a week, so a given session lands on a different weekday
each time.

| Session | Focus | Sets | Exercises |
|---|---|---|---|
| **Upper A** | Upper chest + side delts | 25 | Incline Chest Press, Incline DB Press, Incline DB Fly, Machine Chest Press, Shoulder Press, Lateral Raise, Single-Arm Cable Lateral Raise, Rear Delts, Overhead Cable Tricep Ext, Tricep Pushdown |
| **Lower A** | Quad, forearm + core | 25 | Seated Calf Raise ⇄ Single Leg Curl, Lying Leg Curl, Pendulum Squat, Hack Squat / Leg Press, Leg Extension, Farmers Walk, Reverse Wrist Curl, Side Plank, Lower AB leg raises |
| **Upper B** | Pull + side delts | 23 | Pull Ups, DeadHang, Lat Pulldown, Chest Supported Row, T Bar Row, Face Pull, Lateral Raise, Straight Arm Pulldown, Incline Single Cable Curl, Hammer Curl |
| **Lower B** | Posterior chain + core | 22 | Seated Calf Raise ⇄ Single Leg Curl, RDL, Seated Leg Curl, Leg Press, Hip Thrusts, Abductor / Adductor, Lower AB leg raises, Side Plank |

`⇄` marks a superset. Both lower days open with calves then hamstrings, deliberately.
**95 sets per full four-session cycle.** Rebalanced 18 Aug 2026 towards the two things the programme
was written for and trained least — upper chest went from 3 sets a cycle to 8, side delts from 3 to
10 across both upper days — funded by trims to triceps, front delt, T-bar and hammer curls. Forearm
work was added at the same time. Legs were deliberately left alone.

`Side Plank` and `Farmers Walk` are **timed** (see `TIMED_EXERCISES` in `js/app.js`), so their second
input is seconds rather than reps. `Farmers Walk` is also in `OPTIONAL_WEIGHT_EXERCISES` — it is a
loaded hold, and without that a timed exercise stores no weight at all.

**Full Body + CV** — Full Body A / B / C plus CV + Pump days.

Sessions are editable in the app (✎ on any tile) and the exercise list lives in `session_exercises`,
not in source. **The table above is generated from the live data, not a design document** — if they
disagree, the database is right.
