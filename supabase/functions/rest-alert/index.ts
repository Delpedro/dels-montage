// rest-alert — the half of the rest cue that reaches a locked phone.
//
// Why this exists at all: swBeep() in the app can only make a sound while the page is rendering,
// which means screen on and app in front. A phone in a pocket gets nothing. The 21 Aug attempt to
// fix that inside the page — a long silent WAV so the tones landed on wall-clock time — worked and
// was binned after one session, because a page playing audio owns the iOS audio session for the
// length of the file, so Spotify stopped for the WHOLE rest. A notification never touches the audio
// session: it chimes and hands it straight back.
//
// The web has no LOCAL scheduled notification, so on iOS this has to be a real push from a server.
// This function is that server. It is called when a rest starts, waits until the rest is up, then
// pushes.
//
// IT COUNTS TO A DEADLINE, NOT OUT A DURATION (24 Aug 2026). The client sends `dueAt` — the instant
// the rest is up, stamped when the watch was tapped — and every sleep below is measured against it.
// It used to be handed `seconds` and start counting when it began running, which quietly added the
// client's upsert, its token check, the dispatch, and this function's cold start onto the front of
// every rest. Del measured the result at 4–6s late, worst on the longest rests because the chain hop
// pays a second cold start. A deadline absorbs all of that: whatever the round trip cost, the target
// instant is the same one.
//
// THE 150-SECOND WALL. Supabase caps a free-tier function at 150s of wall clock, and Del's longest
// programmed rest is 180s (session_exercises holds 45/60/90/120/150/180). So one sleep cannot cover
// the longest rests, and the function chains into itself: sleep at most CHAIN_AFTER, then re-invoke
// with the remainder and let the second leg send. Do not raise CHAIN_AFTER to 150 — the send itself
// needs headroom inside the same budget.
//
// CANCELLATION. Stopping a rest early must not leave a buzz to arrive mid-set two minutes later.
// The client writes a token to rest_alerts when a rest starts and deletes the row when it stops, and
// this function re-reads that row after sleeping. A missing row, or a different token, means the
// rest this push was scheduled for is over — so it says nothing.

import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:delpeter@gmail.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

// Leaves ~30s of the 150s budget for the send and for the chain hop itself.
const CHAIN_AFTER = 120;

// Sent this far BEFORE the deadline. The push still has to cross the push service, APNs, the phone
// and — for Del, who reads it on his wrist — the Watch relay, and none of that is free. A cue 1.2s
// early is invisible; the 4–6s late one is what he came out of the gym complaining about.
const SEND_LEAD_MS = 1200;

// How far the client's stamped deadline may differ from the duration it sent alongside it before the
// deadline is treated as coming off a wrong clock. Ten seconds is far wider than any round trip and
// far narrower than a clock actually being wrong.
const SKEW_TOLERANCE_MS = 10_000;

// Seconds from now until the alert should go out.
const secondsUntil = (dueAt: number) => (dueAt - SEND_LEAD_MS - Date.now()) / 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

// Service-role REST call. Only ever used AFTER the caller has been identified — never with input
// that has not been through the auth check below.
async function admin(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

// ── THE READOUT (25 Aug 2026) ────────────────────────────────────────────────────────────────────
// Every decision below used to go to console.log, where nothing can read it afterwards. Two fixes
// have been made to a miss that is still happening, and "the alert never arrived" and "the alert was
// correctly cancelled" leave the same trace once the session is over: none. So each branch writes a
// row instead. Never awaited into the critical path and never allowed to throw — a broken readout
// must not be able to cost the push it is watching.
//
// TEMPORARY. This and the table both go once the miss is explained.
function logPhase(userId: string, phase: string, token: string, exercise: string, detail?: string) {
  admin('rest_alert_log', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      phase,
      token: token.slice(0, 80),
      exercise: exercise ? exercise.slice(0, 80) : null,
      detail: detail ? detail.slice(0, 300) : null,
    }),
  }).catch(() => {});
}

// Who is calling. The user's own access token is exchanged for their id through GoTrue rather than
// decoded here, so a forged or expired token cannot name someone else's user_id.
async function userIdFromToken(token: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user?.id ?? null;
}

// Still wanted? A deleted row or a rotated token means the rest was stopped or restarted while this
// function was asleep, and the push would land in the middle of the next set.
async function stillPending(userId: string, token: string): Promise<boolean> {
  const res = await admin(`rest_alerts?user_id=eq.${userId}&select=token`);
  if (!res.ok) return false;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 && rows[0].token === token;
}

async function sendToUser(userId: string, title: string, body: string, dueAt: number) {
  const res = await admin(`push_subscriptions?user_id=eq.${userId}&select=endpoint,p256dh,auth`);
  if (!res.ok) return { sent: 0, gone: 0, error: `subscription read failed ${res.status}` };
  const subs = await res.json();
  let sent = 0;
  let gone = 0;
  let pushError = '';

  await Promise.all((subs ?? []).map(async (s: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        // dueAt travels so sw.js can refuse to show a cue that arrives long after the rest ended.
        JSON.stringify({ title, body, dueAt, tag: 'rest-alert' }),
        { TTL: 60 },
      );
      sent++;
    } catch (err: any) {
      // 404/410 is the push service saying this subscription is dead — a reinstalled PWA, cleared
      // site data, a revoked permission. Drop it rather than retrying it on every rest forever.
      const code = err?.statusCode;
      if (code === 404 || code === 410) {
        gone++;
        await admin(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' });
      } else {
        console.error('push failed', code, err?.body ?? err?.message);
        pushError = `${code ?? '?'} ${String(err?.body ?? err?.message ?? '').slice(0, 200)}`;
      }
    }
  }));

  return { sent, gone, error: pushError };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  const auth = req.headers.get('Authorization') ?? '';
  const bearer = auth.replace(/^Bearer\s+/i, '');

  // Two ways in. A chain hop carries the service-role key and already knows whose rest it is; a
  // client call carries a user token and is only ever allowed to schedule for itself.
  let userId: string;
  let dueAt: number;
  let token: string;
  let exercise: string;

  if (payload.chain === true) {
    if (bearer !== SERVICE_KEY) return json({ error: 'forbidden' }, 403);
    userId = String(payload.userId ?? '');
    dueAt = Number(payload.dueAt ?? 0);
    token = String(payload.token ?? '');
    exercise = String(payload.exercise ?? '');
    if (!userId || !token || !dueAt) return json({ error: 'bad chain payload' }, 400);
  } else {
    const id = await userIdFromToken(bearer);
    if (!id) return json({ error: 'unauthorised' }, 401);
    userId = id;
    token = String(payload.token ?? '');
    exercise = String(payload.exercise ?? '');
    if (!token) return json({ error: 'token required' }, 400);
    // `seconds` is the pre-24-Aug wire format. It is still sent, and it is still useful: a deadline
    // is a point on the CLIENT's clock being read against the SERVER's, so it is only better than a
    // duration while the two agree. They normally do — an iPhone is NTP-synced — but a phone whose
    // clock is minutes out would otherwise fire the alert minutes out, which a duration never could.
    // So take the stamped deadline, and fall back to the duration if the two disagree by more than
    // the round trip could possibly explain.
    const stamped = Number(payload.dueAt ?? 0);
    const secondsSent = Number(payload.seconds ?? 0);
    const byDuration = Date.now() + secondsSent * 1000;
    dueAt = stamped || byDuration;
    if (stamped && secondsSent >= 1 && Math.abs(stamped - byDuration) > SKEW_TOLERANCE_MS) {
      console.log('clock skew — falling back to the duration', stamped - byDuration);
      dueAt = byDuration;
    }
    const seconds = (dueAt - Date.now()) / 1000;
    // A rest is at most 180s today; the ceiling stops a bad client parking a function for hours,
    // and the floor keeps the test button honest. A deadline already in the past fails it too, which
    // is right — there is nothing left to wait for.
    if (!(seconds >= 1 && seconds <= 600)) return json({ error: 'seconds out of range' }, 400);
  }

  // ── THE WAIT DOES NOT HAPPEN ON THE CALLER'S CONNECTION ──────────────────────────────────────
  // The obvious shape is to sleep and then respond, but the caller is a phone in a gym. netFetch()
  // in the app aborts on NET_TIMEOUT_MS, the phone locks, the radio drops, the user walks out of
  // signal — and a severed connection can take the function down with it, killing the very push it
  // was called to send. So the response goes back immediately and the wait runs in the background,
  // where nothing the client does can interrupt it. The wall-clock cap still covers the whole
  // invocation, which is why CHAIN_AFTER stays well under it.
  const work = (async () => {
    logPhase(userId, payload.chain === true ? 'chain-leg' : 'invoked', token, exercise,
      `due in ${Math.round(secondsUntil(dueAt))}s`);
    const leg = Math.min(secondsUntil(dueAt), CHAIN_AFTER);
    if (leg > 0) await sleep(leg);

    // Re-measured against the deadline rather than subtracted from a running total, so a slow leg or
    // a slow hop is corrected by the next one instead of compounding.
    if (secondsUntil(dueAt) > 1) {
      // Hand the rest of the wait to a fresh function so neither leg goes near the 150s wall.
      await fetch(`${SUPABASE_URL}/functions/v1/rest-alert`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: true, userId, dueAt, token, exercise }),
      }).catch((e) => {
        console.error('chain hop failed', e?.message);
        logPhase(userId, 'chain-failed', token, exercise, String(e?.message ?? e).slice(0, 300));
      });
      return;
    }

    if (!(await stillPending(userId, token))) {
      console.log('skipped — rest already over');
      logPhase(userId, 'skipped', token, exercise, 'row gone or token rotated — rest ended early');
      return;
    }

    const body = exercise ? `${exercise} — next set` : 'Next set';
    const result = await sendToUser(userId, 'Rest over', body, dueAt);
    console.log('sent', JSON.stringify(result));
    logPhase(userId, result.sent ? 'sent' : 'push-error', token, exercise,
      `sent ${result.sent} · dropped ${result.gone}${result.error ? ' · ' + result.error : ''}`);

    await admin(`rest_alerts?user_id=eq.${userId}&token=eq.${encodeURIComponent(token)}`, { method: 'DELETE' });
  })();

  // Keeps the isolate alive past the response. Without it the runtime is free to tear the function
  // down the moment the reply is written, and the sleep above would never finish.
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(work);
  else await work;

  return json({ accepted: true, dueAt, seconds: Math.round(secondsUntil(dueAt)) });
});
