-- app_user's "allow all" policy let anyone with the anon key read every row directly
-- (rest/v1/app_user?select=email,password_hash), i.e. dump every login's password hash.
-- Replace direct table access with a login() RPC that checks the credentials server-side
-- and returns only a boolean — the anon key can no longer SELECT the table at all.

DROP POLICY IF EXISTS "allow all" ON app_user;

CREATE OR REPLACE FUNCTION public.login(p_email text, p_password_hash text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_user
    WHERE email = p_email AND password_hash = p_password_hash
  );
$$;

REVOKE ALL ON FUNCTION public.login(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login(text, text) TO anon, authenticated;
