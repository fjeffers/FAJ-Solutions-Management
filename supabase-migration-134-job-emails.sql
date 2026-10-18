-- Migration 134: job emails from Fred's Gmail (2026-10-18).
--
-- Fred: "look for particular emails ... find the job emails for me", then
-- "Small Google script". A short Google Apps Script in Fred's own Google
-- account checks his inbox every 10 minutes with the search kept here, and
-- hands new job emails to the app (POST /api/inbox). They wait on the Work
-- orders screen under Job emails: Read the job (Generate with AI's "Build
-- this job?") or Not a job. Gmail itself is never connected to the app.
--
--   job_inbox          one row per owner: the private key in the script's
--                      link, which emails count as job emails, the last check.
--   job_emails         each email handed over, once (owner + Gmail id).
--   owner_inbox()      the owner's key and search (made on first use).
--   owner_inbox_set_query(), owner_job_email_set_status()
--   inbox_settings(key), inbox_add(key, emails)   called by /api/inbox only
--                      with the key; nothing else reaches the tables.

CREATE TABLE IF NOT EXISTS public.job_inbox (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  query text NOT NULL DEFAULT '(from:teamnetview.com OR from:fieldnation.com OR from:workmarket.com OR subject:("work order" OR "WO#" OR "dispatch" OR "assignment")) -from:me -from:fajsolutions.com',
  last_check_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_inbox_query_len CHECK (length(query) BETWEEN 1 AND 500)
);
ALTER TABLE public.job_inbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_inbox_owner_read ON public.job_inbox;
CREATE POLICY job_inbox_owner_read ON public.job_inbox FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.job_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gmail_id text NOT NULL,
  from_addr text,
  subject text,
  received_at timestamptz,
  body text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'built', 'ignored')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, gmail_id),
  CONSTRAINT job_emails_size CHECK (length(gmail_id) <= 100 AND coalesce(length(from_addr), 0) <= 400
    AND coalesce(length(subject), 0) <= 500 AND coalesce(length(body), 0) <= 30000)
);
CREATE INDEX IF NOT EXISTS job_emails_owner_new ON public.job_emails (user_id, status, received_at DESC);
ALTER TABLE public.job_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_emails_owner_read ON public.job_emails;
CREATE POLICY job_emails_owner_read ON public.job_emails FOR SELECT TO authenticated USING (user_id = auth.uid());

-- The owner's key and search, made the first time.
CREATE OR REPLACE FUNCTION public.owner_inbox()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r job_inbox%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT is_business_owner(auth.uid()) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_owner'); END IF;
  INSERT INTO job_inbox (user_id, token)
  VALUES (auth.uid(), replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO r FROM job_inbox WHERE user_id = auth.uid();
  RETURN jsonb_build_object('ok', true, 'token', r.token, 'query', r.query, 'last_check_at', r.last_check_at);
END; $$;

CREATE OR REPLACE FUNCTION public.owner_inbox_set_query(p_query text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v text := trim(coalesce(p_query, ''));
BEGIN
  IF auth.uid() IS NULL OR NOT is_business_owner(auth.uid()) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_owner'); END IF;
  IF length(v) < 1 OR length(v) > 500 THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_query'); END IF;
  UPDATE job_inbox SET query = v WHERE user_id = auth.uid();
  RETURN jsonb_build_object('ok', FOUND);
END; $$;

CREATE OR REPLACE FUNCTION public.owner_job_email_set_status(p_id uuid, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT is_business_owner(auth.uid()) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_owner'); END IF;
  IF p_status NOT IN ('new', 'built', 'ignored') THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_status'); END IF;
  UPDATE job_emails SET status = p_status WHERE id = p_id AND user_id = auth.uid();
  RETURN jsonb_build_object('ok', FOUND);
END; $$;

-- The script, by its key: which emails to look for.
CREATE OR REPLACE FUNCTION public.inbox_settings(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r job_inbox%ROWTYPE;
BEGIN
  IF length(coalesce(p_token, '')) < 40 THEN RETURN jsonb_build_object('ok', false); END IF;
  UPDATE job_inbox SET last_check_at = now() WHERE token = p_token RETURNING * INTO r;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false); END IF;
  RETURN jsonb_build_object('ok', true, 'query', r.query);
END; $$;

-- The script, by its key: the emails it found. Each one lands once.
CREATE OR REPLACE FUNCTION public.inbox_add(p_token text, p_emails jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_owner uuid; e jsonb; n int := 0; v_at timestamptz;
BEGIN
  IF length(coalesce(p_token, '')) < 40 OR jsonb_typeof(p_emails) <> 'array' THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT user_id INTO v_owner FROM job_inbox WHERE token = p_token;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(p_emails) LIMIT 50 LOOP
    CONTINUE WHEN coalesce(e->>'id', '') = '';
    BEGIN v_at := (e->>'at')::timestamptz; EXCEPTION WHEN others THEN v_at := now(); END;
    INSERT INTO job_emails (user_id, gmail_id, from_addr, subject, received_at, body)
    VALUES (v_owner, left(e->>'id', 100), left(e->>'from', 400), left(e->>'subject', 500), v_at, left(e->>'body', 30000))
    ON CONFLICT (user_id, gmail_id) DO NOTHING;
    IF FOUND THEN n := n + 1; END IF;
  END LOOP;
  UPDATE job_inbox SET last_check_at = now() WHERE user_id = v_owner;
  RETURN jsonb_build_object('ok', true, 'added', n);
END; $$;

REVOKE ALL ON FUNCTION public.owner_inbox() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_inbox_set_query(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_job_email_set_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_inbox() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_inbox_set_query(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_job_email_set_status(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.inbox_settings(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inbox_add(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inbox_settings(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inbox_add(text, jsonb) TO anon, authenticated;
