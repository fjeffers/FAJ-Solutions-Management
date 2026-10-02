-- Migration 099: usernames for the tech portal sign-in
--
-- Fred, 2026-10-02: "change log in style so name and email address then user
-- name and password". Creating a login now asks for name and email, then a
-- username and password; signing in takes the username (or the email) and the
-- password.
--
-- Supabase Auth signs in by email, so a username is a lookup to the login it
-- belongs to. The lookup happens only on the server (app/api/tech/login), with
-- the service key: nothing here lets a browser turn a username into an email,
-- so the sign-in page cannot be used to collect techs' addresses.
--
--   login_usernames      one username per login; lower-case letters, digits,
--                        dot, dash, underscore; 3-30 characters; unique.
--                        RLS on with no policies — browsers cannot read it.
--   my_username()        the signed-in person's own username (or null).
--   set_my_username(u)   pick or change your own username (Profile screen).

CREATE TABLE IF NOT EXISTS public.login_usernames (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT login_usernames_format CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,29}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS login_usernames_username_key ON public.login_usernames (username);

ALTER TABLE public.login_usernames ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_usernames FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_username()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
  SELECT username FROM login_usernames WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.set_my_username(p_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v text := lower(btrim(coalesce(p_username, '')));
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in'); END IF;
  IF v !~ '^[a-z0-9][a-z0-9._-]{2,29}$' THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_username'); END IF;
  IF EXISTS (SELECT 1 FROM login_usernames WHERE username = v AND user_id <> auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'taken');
  END IF;
  INSERT INTO login_usernames (user_id, username) VALUES (auth.uid(), v)
  ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'username', v);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'taken');
END;
$$;

REVOKE ALL ON FUNCTION public.my_username(), public.set_my_username(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_username(), public.set_my_username(text) TO authenticated;
