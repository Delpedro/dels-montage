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
// This function is that server. It is called when a rest starts, waits out the remaining seconds,
// then pushes.
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

async function sendToUser(userId: string, title: string, body: string) {
  const res = await admin(`push_subscriptions?user_id=eq.${userId}&select=endpoint,p256dh,auth`);
  if (!res.ok) return { sent: 0, gone: 0 };
  const subs = await res.json();
  let sent = 0;
  let gone = 0;

  await Promise.all((subs ?? []).map(async (s: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body, tag: 'rest-alert' }),
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
      }
    }
  }));

  return { sent, gone };
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
  let remaining: number;
  let token: string;
  let exercise: string;

  if (payload.chain === true) {
    if (bearer !== SERVICE_KEY) return json({ error: 'forbidden' }, 403);
    userId = String(payload.userId ?? '');
    remaining = Number(payload.remaining ?? 0);
    token = String(payload.token ?? '');
    exercise = String(payload.exercise ?? '');
    if (!userId || !token) return json({ error: 'bad chain payload' }, 400);
  } else {
    const id = await userIdFromToken(bearer);
    if (!id) return json({ error: 'unauthorised' }, 401);
    userId = id;
    remaining = Number(payload.seconds ?? 0);
    token = String(payload.token ?? '');
    exercise = String(payload.exercise ?? '');
    if (!token) return json({ error: 'token required' }, 400);
    // A rest is at most 180s today; the ceiling stops a bad client parking a function for hours,
    // and the floor keeps the test button honest.
    if (!(remaining >= 1 && remaining <= 600)) return json({ error: 'seconds out of range' }, 400);
  }

  // ── THE WAIT DOES NOT HAPPEN ON THE CALLER'S CONNECTION ──────────────────────────────────────
  // The obvious shape is to sleep and then respond, but the caller is a phone in a gym. netFetch()
  // in the app aborts on NET_TIMEOUT_MS, the phone locks, the radio drops, the user walks out of
  // signal — and a severed connection can take the function down with it, killing the very push it
  // was called to send. So the response goes back immediately and the wait runs in the background,
  // where nothing the client does can interrupt it. The wall-clock cap still covers the whole
  // invocation, which is why CHAIN_AFTER stays well under it.
  const work = (async () => {
    const leg = Math.min(remaining, CHAIN_AFTER);
    await sleep(leg);
    const left = remaining - leg;

    if (left > 0) {
      // Hand the remainder to a fresh function so neither leg goes near the 150s wall.
      await fetch(`${SUPABASE_URL}/functions/v1/rest-alert`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: true, userId, remaining: left, token, exercise }),
      }).catch((e) => console.error('chain hop failed', e?.message));
      return;
    }

    if (!(await stillPending(userId, token))) {
      console.log('skipped — rest already over');
      return;
    }

    const body = exercise ? `${exercise} — next set` : 'Next set';
    const result = await sendToUser(userId, 'Rest over', body);
    console.log('sent', JSON.stringify(result));

    await admin(`rest_alerts?user_id=eq.${userId}&token=eq.${encodeURIComponent(token)}`, { method: 'DELETE' });
  })();

  // Keeps the isolate alive past the response. Without it the runtime is free to tear the function
  // down the moment the reply is written, and the sleep above would never finish.
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(work);
  else await work;

  return json({ accepted: true, seconds: remaining });
});
