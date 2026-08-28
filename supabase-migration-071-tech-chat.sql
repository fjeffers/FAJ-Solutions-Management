-- Migration 071: chat for logged-in techs
--
-- Messaging already existed, but only through the token portal:
-- get_portal_messages / send_portal_message both resolve a URL token via
-- portal_resolve. A tech signed in at /tech has no token — they have a
-- session — so they had no way to message about a job.
--
-- These are the login-based twins, resolving the caller through tech_ctx()
-- instead. Same table, same threads: a message sent from the tech portal and
-- one sent from a portal link land in the same conversation, and the owner
-- sees one thread either way.
--
-- Scope is the same rule as everywhere else in the tech portal: a tech may only
-- read or write on a job that is under their name.

-- ─── Read one job's thread ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tech_messages(p_wo_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx  jsonb := tech_ctx();
  v_name text;
  v_out  jsonb;
BEGIN
  IF v_ctx IS NULL OR p_wo_number IS NULL THEN RETURN NULL; END IF;
  v_name := v_ctx->>'contractor_name';

  -- The job must be theirs. Without this a tech could read any thread by
  -- guessing a work order number.
  IF NOT EXISTS (
    SELECT 1 FROM work_orders w
     WHERE w.wo_number = p_wo_number
       AND w.user_id = (v_ctx->>'owner_id')::uuid
       AND (w.contractor_name = v_name
            OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
            OR w.lead_contractor_name = v_name)
  ) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_agg(
           jsonb_build_object(
             'id',          m.id,
             'sender_name', m.sender_name,
             'sender_role', m.sender_role,
             'content',     m.content,
             'created_at',  m.created_at
           ) ORDER BY m.created_at ASC
         )
    INTO v_out
  FROM work_order_messages m
  WHERE m.work_order_id = p_wo_number
    AND m.user_id = (v_ctx->>'owner_id')::uuid;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$function$;

-- ─── Post to one job's thread ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tech_send_message(p_wo_number text, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx  jsonb := tech_ctx();
  v_name text;
  v_body text;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  v_name := v_ctx->>'contractor_name';
  v_body := left(btrim(COALESCE(p_content, '')), 4000);
  IF v_body = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'empty'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM work_orders w
     WHERE w.wo_number = p_wo_number
       AND w.user_id = (v_ctx->>'owner_id')::uuid
       AND (w.contractor_name = v_name
            OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
            OR w.lead_contractor_name = v_name)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_your_job');
  END IF;

  -- sender_name is taken from the resolved contractor, never from the client:
  -- a tech cannot post as somebody else.
  INSERT INTO work_order_messages (user_id, work_order_id, sender_name, sender_role, content)
  VALUES ((v_ctx->>'owner_id')::uuid, p_wo_number, v_name, 'contractor', v_body);

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- ─── Unread-ish count for the menu badge ────────────────────────────────────
-- Owner messages the tech has not read, across all their jobs.
CREATE OR REPLACE FUNCTION public.tech_unread_count()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx  jsonb := tech_ctx();
  v_name text;
  v_n    integer;
BEGIN
  IF v_ctx IS NULL THEN RETURN 0; END IF;
  v_name := v_ctx->>'contractor_name';

  SELECT count(*) INTO v_n
  FROM work_order_messages m
  JOIN work_orders w
    ON w.wo_number = m.work_order_id AND w.user_id = m.user_id
  WHERE m.user_id = (v_ctx->>'owner_id')::uuid
    AND m.sender_role <> 'contractor'
    AND m.read_at IS NULL
    AND (w.contractor_name = v_name
         OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
         OR w.lead_contractor_name = v_name);

  RETURN COALESCE(v_n, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.tech_messages(text)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_send_message(text, text)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_unread_count()             FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.tech_messages(text)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_send_message(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_unread_count()           TO authenticated;
