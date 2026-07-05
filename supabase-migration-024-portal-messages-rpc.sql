-- Migration 024: Portal-side access to work_order_messages
--
-- work_order_messages already exists (built outside this repo) with RLS scoped to
-- user_id (the owner/admin). A portal-token contractor has no auth.uid(), so they
-- can't satisfy that RLS policy directly. These two SECURITY DEFINER RPCs mirror
-- get_portal_data's token-validation pattern (migration-021) to grant scoped access:
-- a contractor can only read/send messages for a WO they're actually assigned to.

CREATE OR REPLACE FUNCTION get_portal_messages(p_token text, p_wo_number text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contractor jsonb;
  v_messages   jsonb;
BEGIN
  SELECT to_jsonb(c) INTO v_contractor
  FROM contractors c
  WHERE c.portal_token = p_token::uuid;

  IF v_contractor IS NULL THEN RETURN NULL; END IF;

  -- Confirm this contractor is actually assigned to the WO being asked about.
  IF NOT EXISTS (
    SELECT 1 FROM work_orders w
    WHERE w.wo_number = p_wo_number
      AND w.user_id = (v_contractor->>'user_id')::uuid
      AND (
        w.contractor_name = (v_contractor->>'name')
        OR (v_contractor->>'name') = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
      )
  ) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at ASC)
  INTO v_messages
  FROM work_order_messages m
  WHERE m.work_order_id = p_wo_number
    AND m.user_id = (v_contractor->>'user_id')::uuid;

  RETURN COALESCE(v_messages, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION send_portal_message(p_token text, p_wo_number text, p_content text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contractor jsonb;
  v_message    jsonb;
BEGIN
  SELECT to_jsonb(c) INTO v_contractor
  FROM contractors c
  WHERE c.portal_token = p_token::uuid;

  IF v_contractor IS NULL THEN RETURN NULL; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM work_orders w
    WHERE w.wo_number = p_wo_number
      AND w.user_id = (v_contractor->>'user_id')::uuid
      AND (
        w.contractor_name = (v_contractor->>'name')
        OR (v_contractor->>'name') = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
      )
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO work_order_messages (user_id, work_order_id, sender_email, sender_name, sender_role, content)
  VALUES (
    (v_contractor->>'user_id')::uuid,
    p_wo_number,
    v_contractor->>'email',
    v_contractor->>'name',
    'contractor',
    p_content
  )
  RETURNING to_jsonb(work_order_messages.*) INTO v_message;

  RETURN v_message;
END;
$$;
