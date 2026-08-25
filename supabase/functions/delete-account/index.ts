// delete-account — the other half of the signup screen, shipped in the same build.
//
// WHY IT IS A FUNCTION AND NOT A FETCH FROM THE APP. Deleting a row from auth.users needs the
// service-role key. That key is a master key over the whole project — it bypasses every RLS policy
// on every table — so it can never be in js/app.js, which anyone can read from view-source on
// delpedro.github.io. It lives here, in the function's environment, and the only thing the client
// gets to do is prove who it is.
//
// THE CLIENT CANNOT NAME A VICTIM. There is no user id in the request. The caller's own JWT is the
// entire input: it is exchanged for a user id against /auth/v1/user, and that id is the one deleted.
// A stolen anon key buys nothing here — an anon key is not a session — and a signed-in user cannot
// spell any account but their own, however the body is crafted.
//
// THE DATA GOES WITH IT, and not because this function walks a list of tables. Every user-data table
// in D-LOG carries `user_id uuid references auth.users(id) on delete cascade` (set up in
// 20260813120000_supabase_auth_and_per_user_rls.sql and repeated by every table added since), so
// Postgres removes the workouts, the sets, the daily logs, the goals, the profile, the custom
// exercises, the push subscriptions and the rest alerts as part of deleting the auth row. A list in
// here would be a second place to forget a new table; a foreign key cannot be forgotten.
//
// The shared exercise_catalogue is owned by nobody and stays — it is not this user's data, it is the
// app's, and deleting an account must not empty the exercise picker for everyone else.
//
// Deploy: supabase functions deploy delete-account

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Same shape as rest-alert's helper. CORS is spelled out rather than assumed: this is called from
// delpedro.github.io with an Authorization header, which is a preflighted cross-origin request, and
// a missing header here would fail as an opaque network error in the app rather than as a status.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function userFromToken(token: string): Promise<{ id: string; email: string } | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user?.id ? { id: user.id, email: user.email ?? '' } : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!bearer) return json({ error: 'unauthorised' }, 401);

  // The service-role key is not a way in. It authenticates as nobody, so an id read back from it
  // would be meaningless — but rejecting it explicitly means this endpoint can never be talked into
  // deleting on behalf of a caller who simply holds a project key.
  if (bearer === SERVICE_KEY) return json({ error: 'unauthorised' }, 401);

  const user = await userFromToken(bearer);
  if (!user) return json({ error: 'unauthorised' }, 401);

  // `should_soft_delete` is deliberately not set. A soft delete leaves the row, and with it the
  // email address, which would mean an account someone asked to be rid of is still on file and the
  // address can never be reused. This is a real deletion — see the GDPR note in the app's Delete
  // Account block; Del is in Ireland and erasure means erasure.
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('delete failed', res.status, detail.slice(0, 300));
    // The status is worth passing back but the body is not: it is GoTrue's wording about an internal
    // resource, and the app has its own sentence for "nothing was deleted".
    return json({ error: `delete failed (${res.status})` }, 502);
  }

  console.log('deleted account', user.id);
  return json({ deleted: true });
});
