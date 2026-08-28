-- Migration 075: techs messaging each other
--
-- Chat so far is per WORK ORDER and between a tech and the office. Two techs
-- on the same crew had no way to reach each other in the app — they were
-- swapping personal phone numbers, which means the coordination happens
-- somewhere Fred cannot see and nobody can look up later.
--
-- Direct messages are not tied to a job, so they need their own table.
--
-- ─── What a tech can see of other techs ─────────────────────────────────────
--
-- The directory returns NAMES ONLY. No email, no phone, no address, no pay, no
-- job counts. A tech needs to know who exists to pick someone to message; they
-- do not need anyone's contact details, and handing out a roster with emails
-- and phone numbers is a data leak dressed up as a feature.
--
-- Everything is scoped to one owner, so techs can only ever reach other techs
-- who work for the same business.
--
-- ─── Fred sees everything ───────────────────────────────────────────────────
--
-- user_id is the owner and RLS is the usual `auth.uid() = user_id`, so these
-- messages are readable from the owner app like any other table. Techs are told
-- this in the UI rather than being left to assume otherwise.

CREATE TABLE IF NOT EXISTS contractor_messages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_id      UUID        NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  to_id        UUID        NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  content      TEXT        NOT NULL,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contractor_messages_not_self CHECK (from_id <> to_id)
);

ALTER TABLE contractor_messages ENABLE ROW LEVEL SECURITY;

-- The owner reads and manages everything; techs go through the RPCs below.
DROP POLICY IF EXISTS "Owner manages contractor messages" ON contractor_messages;
CREATE POLICY "Owner manages contractor messages"
  ON contractor_messages FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_contractor_messages_pair
  ON contractor_messages (user_id, from_id, to_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contractor_messages_inbox
  ON contractor_messages (user_id, to_id, read_at);

-- ─── Who a tech can message ─────────────────────────────────────────────────
-- Names only, same owner, excluding themselves and anyone switched off.
CREATE OR REPLACE FUNCTION public.tech_directory()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_out jsonb;
BEGIN
  IF v_ctx IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_agg(
           jsonb_build_object(
             'id',     c.id,
             'name',   c.name,
             -- Unread FROM that person, so the list can show who is waiting.
             'unread', (SELECT count(*) FROM contractor_messages m
                         WHERE m.user_id = (v_ctx->>'owner_id')::uuid
                           AND m.from_id = c.id
                           AND m.to_id = (v_ctx->>'contractor_id')::uuid
                           AND m.read_at IS NULL)
           ) ORDER BY c.name
         )
    INTO v_out
  FROM contractors c
  WHERE c.user_id = (v_ctx->>'owner_id')::uuid
    AND c.id <> (v_ctx->>'contractor_id')::uuid
    AND c.portal_enabled;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$function$;

-- ─── One conversation ───────────────────────────────────────────────────────
-- Both directions between the caller and one other tech. Reading marks their
-- messages read, so the badge clears when the thread is actually opened.
CREATE OR REPLACE FUNCTION public.tech_dm_thread(p_other_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx   jsonb := tech_ctx();
  v_me    uuid;
  v_owner uuid;
  v_out   jsonb;
BEGIN
  IF v_ctx IS NULL OR p_other_id IS NULL THEN RETURN NULL; END IF;
  v_me    := (v_ctx->>'contractor_id')::uuid;
  v_owner := (v_ctx->>'owner_id')::uuid;

  -- The other party must be a real tech of the same owner.
  IF NOT EXISTS (
    SELECT 1 FROM contractors c
     WHERE c.id = p_other_id AND c.user_id = v_owner AND c.portal_enabled
  ) THEN
    RETURN NULL;
  END IF;

  UPDATE contractor_messages
     SET read_at = NOW()
   WHERE user_id = v_owner AND from_id = p_other_id AND to_id = v_me AND read_at IS NULL;

  SELECT jsonb_agg(
           jsonb_build_object(
             'id',      m.id,
             'mine',    (m.from_id = v_me),
             'content', m.content,
             'created_at', m.created_at
           ) ORDER BY m.created_at ASC
         )
    INTO v_out
  FROM contractor_messages m
  WHERE m.user_id = v_owner
    AND ((m.from_id = v_me AND m.to_id = p_other_id)
      OR (m.from_id = p_other_id AND m.to_id = v_me));

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$function$;

-- ─── Send ───────────────────────────────────────────────────────────────────
-- from_id is the resolved caller, never the client: a tech cannot post as
-- somebody else, the same rule as the job threads.
CREATE OR REPLACE FUNCTION public.tech_send_dm(p_other_id uuid, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx   jsonb := tech_ctx();
  v_me    uuid;
  v_owner uuid;
  v_body  text;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  v_me    := (v_ctx->>'contractor_id')::uuid;
  v_owner := (v_ctx->>'owner_id')::uuid;

  v_body := left(btrim(COALESCE(p_content, '')), 4000);
  IF v_body = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'empty'); END IF;
  IF p_other_id = v_me THEN RETURN jsonb_build_object('ok', false, 'reason', 'self'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM contractors c
     WHERE c.id = p_other_id AND c.user_id = v_owner AND c.portal_enabled
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_recipient');
  END IF;

  INSERT INTO contractor_messages (user_id, from_id, to_id, content)
  VALUES (v_owner, v_me, p_other_id, v_body);

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ─── Unread across every conversation, for the menu badge ───────────────────
CREATE OR REPLACE FUNCTION public.tech_dm_unread()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_n   integer;
BEGIN
  IF v_ctx IS NULL THEN RETURN 0; END IF;
  SELECT count(*) INTO v_n FROM contractor_messages m
   WHERE m.user_id = (v_ctx->>'owner_id')::uuid
     AND m.to_id = (v_ctx->>'contractor_id')::uuid
     AND m.read_at IS NULL;
  RETURN COALESCE(v_n, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.tech_directory()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_dm_thread(uuid)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_send_dm(uuid, text)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_dm_unread()             FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.tech_directory()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_dm_thread(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_send_dm(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_dm_unread()         TO authenticated;
