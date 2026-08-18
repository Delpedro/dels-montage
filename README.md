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
- Weight, steps, calories, protein, energy, notes — with macro targets and a colour verdict
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

**Upper / Lower**

| Day | Session | Focus |
|---|---|---|
| Monday | Upper A | Push — Smith Incline, Machine Chest Press, Shoulder Press, Lateral Raise, Tricep Ext, Tricep Pushdown |
| Tuesday | Lower A | Quad — Hack Squat/Leg Press, Leg Extension, Lying Leg Curl, Walking Lunge, Calf Raise, Pallof Press |
| Thursday | Upper B | Pull — Lat Pulldown, Chest Supported Row, Seated Cable Row, Face Pull, Straight Arm Pulldown, Hammer Curl, Incline Cable Curl |
| Friday | Lower B | Posterior — Smith RDL, Leg Press, Single Leg Curl, Seated Leg Curl, Hip Thrust Machine, Calf Raise, Dead Bug, Cable Woodchop |
| Saturday | CV + Pump | Wild card |

**Full Body + CV** — 3 strength days, 2 CV + pump days.

Sessions are editable in the app (✎ on any tile), so the tables above are the starting shape rather
than a fixed definition.
