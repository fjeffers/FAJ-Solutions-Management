-- Migration 154: private direct messages between the office and each technician.
--
-- Existing job conversations remain keyed by WO number in work_order_messages.
-- A direct office thread uses work_order_id = 'direct:<contractor uuid>', so it
-- gets the same realtime, owner RLS and read state without another message table.

CREATE OR REPLACE FUNCTION public.tech_owner_thread()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_me uuid;
  v_owner uuid;
  v_thread text;
  v_out jsonb;
BEGIN
  IF v_ctx IS NULL THEN RETURN NULL; END IF;
  v_me := (v_ctx->>'contractor_id')::uuid;
  v_owner := (v_ctx->>'owner_id')::uuid;
  v_thread := 'direct:' || v_me::text;

  UPDATE work_order_messages
     SET read_at = NOW()
   WHERE user_id = v_owner
     AND work_order_id = v_thread
     AND sender_role <> 'contractor'
     AND read_at IS NULL;

  SELECT jsonb_agg(
           jsonb_build_object(
             'id', m.id,
             'mine', m.sender_role = 'contractor',
             'content', m.content,
             'created_at', m.created_at
           ) ORDER BY m.created_at ASC
         )
    INTO v_out
  FROM work_order_messages m
  WHERE m.user_id = v_owner
    AND m.work_order_id = v_thread;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.tech_send_owner_message(p_content text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_me uuid;
  v_owner uuid;
  v_name text;
  v_body text;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  v_me := (v_ctx->>'contractor_id')::uuid;
  v_owner := (v_ctx->>'owner_id')::uuid;
  v_name := v_ctx->>'contractor_name';
  v_body := left(btrim(COALESCE(p_content, '')), 4000);
  IF v_body = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'empty'); END IF;

  INSERT INTO work_order_messages (user_id, work_order_id, sender_name, sender_role, content)
  VALUES (v_owner, 'direct:' || v_me::text, v_name, 'contractor', v_body);

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- Job messages plus the office's direct messages. Tech-to-tech unread stays in
-- tech_dm_unread(), and the app adds both counts for the Messenger badge.
CREATE OR REPLACE FUNCTION public.tech_unread_count()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_me uuid;
  v_name text;
  v_owner uuid;
  v_n integer;
BEGIN
  IF v_ctx IS NULL THEN RETURN 0; END IF;
  v_me := (v_ctx->>'contractor_id')::uuid;
  v_name := v_ctx->>'contractor_name';
  v_owner := (v_ctx->>'owner_id')::uuid;

  SELECT
    (SELECT count(*)
       FROM work_order_messages m
       JOIN work_orders w ON w.wo_number = m.work_order_id AND w.user_id = m.user_id
      WHERE m.user_id = v_owner
        AND m.sender_role <> 'contractor'
        AND m.read_at IS NULL
        AND (w.contractor_name = v_name
             OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
             OR w.lead_contractor_name = v_name))
    +
    (SELECT count(*)
       FROM work_order_messages m
      WHERE m.user_id = v_owner
        AND m.work_order_id = 'direct:' || v_me::text
        AND m.sender_role <> 'contractor'
        AND m.read_at IS NULL)
    INTO v_n;

  RETURN COALESCE(v_n, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.tech_owner_thread() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_send_owner_message(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tech_owner_thread() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_send_owner_message(text) TO authenticated;
