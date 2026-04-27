# D-Log

Personal training tracker. Logs workouts, tracks progress, and handles a 4-day push/pull programme with daily check-ins.

No framework. No build step. Vanilla JS + Supabase.

---

## Features

**Workout logging**
- 4-day programme: Upper A (push), Lower A (quad), Upper B (pull), Lower B (posterior) + Saturday conditioning
- Per-set weight and reps inputs with previous session data shown inline as badges
- Variation toggles for exercises with alternatives (e.g. Hack Squat / Leg Press, Cable / KG)
- Band exercise support with abbreviation badges (RB×15, YB×15)
- Bodyweight exercise handling (null weight, no spurious "BW" string in DB)
- Mark Done per exercise — turns green and saves immediately to Supabase
- Session notes field

**Rest timer**
- Per-exercise stopwatch, wall-clock based — survives phone lock, navigation, page refresh
- Audio beep on rest complete
- Rest time saved per set and shown inline in history

**Session state**
- In-progress workout survives navigation, phone lock, and reload
- Resume same session: fills inputs from DB, marks completed exercises green
- Switch session mid-workout with confirmation — old session stays open for later resume
- 24-hour auto-close for stale in-progress sessions
- Draft auto-save to localStorage (24hr expiry, cleared on logout/save)
- Cancel safely: empty workout rows cleaned up immediately

**History**
- Full workout history with per-session cards
- Top 3 lifts per session highlighted by heaviest weight (amber label)
- Filters: This Week / This Month / All Time
- Search by session name
- Inline edit modal to correct any set (weight, reps, variation)

**Daily check-in**
- Log weight, steps, calories, fasting hours, energy level, notes
- Edit past entries via modal

**Stats**
- Weight trend chart
- Step count chart
- "Sessions this week" and recent workout summaries

**Home**
- Greeting with date
- Today's weight and steps tiles
- Weekly session overview strip

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML / CSS / JS — no framework, no build step |
| Backend | Supabase (PostgREST REST API) |
| Auth | SHA-256 hashed PIN, checked server-side via Supabase |
| Dev server | live-server (hot reload) |
| Hosting | — |
| DB migrations | Supabase CLI |

---

## Dev setup

```bash
npm install        # first time only — installs live-server
npm start          # runs at http://localhost:8080 with hot reload
```

No environment variables needed locally — Supabase URL and publishable key are inlined in `js/app.js`.

---

## Project structure

```
index.html              # single-page app shell — all pages as divs, shown/hidden by JS
css/style.css           # all styles — dark theme, DM Sans + DM Mono fonts
js/app.js               # all application logic (~1600 lines)
supabase/
  config.toml
  migrations/           # schema history (Supabase CLI format)
```

Full function reference with line numbers: [CODEBASE.md](CODEBASE.md)

App usage guide: [RTFM.md](RTFM.md)

---

## Database schema

| Table | Purpose |
|---|---|
| `workouts` | One row per logged session. `completed_at` null = in-progress. |
| `workout_sets` | Individual sets. FK to `workouts`. Stores exercise name, set number, weight, reps, variation, rest_seconds. |
| `daily_logs` | Daily check-in data — weight, steps, calories, fasting, energy, notes. |
| `conditioning_logs` | Saturday conditioning entries — activity, duration, notes. |
| `quotes` | Motivational quotes, seeded. |

---

## Programme

| Day | Session | Focus |
|---|---|---|
| Monday | Upper A | Push — Smith Machine Incline, Machine Chest Press, Shoulder Press, Lateral Raise, Tricep Ext, Tricep Pushdown |
| Tuesday | Lower A | Quad — Hack Squat/Leg Press, Leg Extension, Lying Leg Curl, Walking Lunge, Calf Raise, Pallof Press |
| Thursday | Upper B | Pull — Lat Pulldown, Chest Supported Row, Seated Cable Row, Face Pull, Straight Arm Pulldown, Hammer Curl, Incline Cable Curl |
| Friday | Lower B | Posterior — Smith RDL, Leg Press, Leg Curl, Hip Thrust Machine, Calf Raise, Dead Bug, Cable Woodchop |
| Saturday | Conditioning | Wild card |
