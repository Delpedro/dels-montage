# D-LOG — How To Use It

---

## Logging In

- Go to `delpedro.github.io` on your phone or PC
- Enter your email + password, tap **Get In**
- Session persists until you tap **logout** — closing the tab does NOT log you out on the same device

---

## Home Screen

- **Current KG** — pulls the most recent weight from your Daily Check-in
- **Sessions / Week** — counts workouts from Monday to today (resets each Monday)
- **Avg Steps** — rolling 7-day average from your daily check-ins
- **Week strip** — Mon–Sun, green dot = workout logged, orange dot = today. Tapping a day does nothing (display only)
- **Daily Check-in** / **Log Workout** — main entry points

---

## Daily Check-in

Fill in as many or as few fields as you want — everything is optional except saving:

| Field | Notes |
|---|---|
| Weight (kg) | Decimal ok — 80.5 etc |
| Fasting (hrs) | Hours of overnight fast |
| Calories | Daily total |
| Steps | Daily step count |
| Energy | 😴 to 🔥 — tap to select |
| Notes | Free text |

- Tap **Save Check-in**
- If you've already logged today, it **updates** the existing entry (no duplicates)
- You can edit any past check-in from the **History** tab → tap a log entry → **Edit**

---

## Logging a Workout

1. Tap **Log Workout** from Home, or the barbell icon in the bottom nav
2. The session grid shows your programme sessions — tap the one you're doing
3. A pill appears at the top showing the active session. Tap **change** or the **Log Workout** title to go back to the grid
4. Fill in **weight** and **reps** for each set

### Variations (Hack Squat / Leg Press, etc.)
- Where an exercise has multiple variations, toggle buttons appear at the top of that exercise block
- The app remembers which variation you used last time and defaults to it
- Changing the variation **only affects that exercise** — other exercises are unaffected

### Previous lifts (grey badges)
- Each set row shows a grey badge on the right — e.g. `82.5×8`
- This is what you did on that exact set last time you ran this session
- For band exercises (Pallof Press): badge shows abbreviated band + reps — e.g. `RB×15` (Red Band) or `YB×15` (Yellow Band)
- For bodyweight exercises (Dead Bug): badge shows `BW×reps`

### Rest timer (stopwatch icon)
- Tap the **watch icon** (top right of each exercise) to start the rest timer
- Timer counts up from 0:00 and displays as m:ss inside the watch ring
- Tap again to stop — the rest time saves to that set and shows as `↳ Rest 2:45` below the set row
- Timer survives locking your phone, navigating away, and refreshing the page — it's wall-clock based
- **Audio beep** plays when rest is complete (only works when app is open and visible — iOS limitation)

### Draft auto-save
- Every keystroke saves a draft to localStorage automatically
- If you close the app mid-workout, refresh, or navigate away — come back to the **same session** and your numbers are still there
- Draft expires after **24 hours**
- Draft is **cleared on logout** — don't log out mid-session

### Saving
- Tap **Save Workout** at the bottom when done
- Only exercises with at least one set filled in are saved — blank sets are ignored

### In-progress workouts
- If you've started logging but haven't saved, the session tile shows as in-progress
- Tapping the same session again **silently resumes** — your data is still there
- Tapping a **different** session while one is in-progress shows a warning — you can switch without losing the old one (it stays saved as in-progress)
- Any in-progress workout older than 24 hours is automatically closed on next app load

### Saturday Conditioning
- Tap **Conditioning** from the session grid
- Enter activity (e.g. "Les Mills"), duration in minutes, and optional notes
- No sets/reps — just a single save

---

## Stats

- Tap any tile at the top (**Current Weight**, **Sessions This Week**, **Avg Fasting**, **Avg Steps**) to switch the chart below
- Chart always shows last 14 days of data
- **Recent Workouts** shows your last 5 sessions

---

## History

### Filters
- **This Week** — Monday to today
- **Last Week** — previous Mon–Sun
- **This Month** — 1st to today
- **All** — everything

### Search
- Type in the search box to filter by session name (e.g. "Upper", "Lower")
- Search box keeps focus while you type — no jumping

### Workout cards
- Show date, session name, and the **top 3 heaviest lifts** from that session
- Amber label = session type
- Tap **Edit** to open the edit modal — you can correct weights/reps after the fact

### Daily log cards
- Show weight, steps, calories, fasting, energy, and notes for that day
- Tap **Edit** to update

---

## Edge Cases Worth Knowing

- **Refreshing mid-workout** — safe. Draft restores automatically. The session stays in-progress.
- **Logging out mid-workout** — draft is wiped. Don't do this.
- **Same exercise in two sessions** — previous lift badges pull from the last time that session was run, not globally across all sessions
- **Dead Bug / bodyweight exercises** — weight column shows "BW", not a number. Saves as null weight — this is correct.
- **Pallof Press / band exercises** — weight column shows the band colour label. Saves as null weight with band name stored as the variation.
- **Long-pressing anything** — nothing. No hidden long-press actions exist.
