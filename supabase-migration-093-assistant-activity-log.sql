-- Migration 093: Fred sees everything the assistant does.
--
-- "I want to be able to see every single thing they do." Job edits were
-- already written to Fred's audit_log by asst_update_job (migration-092).
-- This adds the other two things an assistant does: signing in, and ticking a
-- task done or reopening it. Every row carries details.by_assistant, which is
-- what the Assistant screen's activity list reads.
--
-- Rows are written under Fred's user_id, so his existing audit_log RLS
-- ("view their own") shows them to him and to no one else. The assistant
-- cannot read audit_log at all.

CREATE OR REPLACE FUNCTION public.staff_claim_account()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_email     text;
  v_confirmed timestamptz;
  v_row       staff_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in'); END IF;
  IF is_business_owner(auth.uid()) THEN RETURN jsonb_build_object('ok', false, 'reason', 'is_owner'); END IF;

  SELECT * INTO v_row FROM staff_members WHERE auth_user_id = auth.uid() AND enabled LIMIT 1;
  IF FOUND THEN
    UPDATE staff_members SET last_login_at = now() WHERE id = v_row.id;
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
    VALUES (v_row.owner_id, 'login', 'staff', v_row.id::text,
            jsonb_build_object('label', v_row.name || ' signed in', 'by_assistant', v_row.name));
    RETURN jsonb_build_object('ok', true, 'reason', 'already_linked');
  END IF;
  IF EXISTS (SELECT 1 FROM staff_members WHERE auth_user_id = auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'turned_off');
  END IF;

  SELECT u.email, u.email_confirmed_at INTO v_email, v_confirmed
  FROM auth.users u WHERE u.id = auth.uid();
  IF v_confirmed IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'email_not_confirmed');
  END IF;

  SELECT * INTO v_row
  FROM staff_members s
  WHERE lower(s.email) = lower(v_email)
    AND s.auth_user_id IS NULL
    AND s.enabled
    AND s.owner_id <> auth.uid()
  ORDER BY s.created_at
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_matching_assistant');
  END IF;

  UPDATE staff_members SET auth_user_id = auth.uid(), last_login_at = now() WHERE id = v_row.id;
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
  VALUES (v_row.owner_id, 'login', 'staff', v_row.id::text,
          jsonb_build_object('label', v_row.name || ' signed in for the first time', 'by_assistant', v_row.name));
  RETURN jsonb_build_object('ok', true, 'reason', 'linked');
END;
$$;

CREATE OR REPLACE FUNCTION public.asst_task_set(p_id uuid, p_done boolean, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx   jsonb := staff_ctx();
  v_title text;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_an_assistant'); END IF;
  UPDATE staff_tasks
     SET status     = CASE WHEN p_done THEN 'done' ELSE 'open' END,
         done_at    = CASE WHEN p_done THEN now() ELSE NULL END,
         done_note  = CASE WHEN p_done THEN NULLIF(trim(p_note), '') ELSE NULL END,
         updated_at = now()
   WHERE id = p_id
     AND owner_id = (v_ctx ->> 'owner_id')::uuid
     AND (staff_id IS NULL OR staff_id = (v_ctx ->> 'staff_id')::uuid)
  RETURNING title INTO v_title;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
  VALUES ((v_ctx ->> 'owner_id')::uuid, 'update', 'task', p_id::text,
          jsonb_build_object(
            'label', (v_ctx ->> 'name') || CASE WHEN p_done THEN ' finished "' ELSE ' reopened "' END || v_title || '"',
            'by_assistant', v_ctx ->> 'name',
            'note', NULLIF(trim(p_note), '')));
  RETURN jsonb_build_object('ok', true, 'reason', CASE WHEN p_done THEN 'done' ELSE 'reopened' END);
END;
$$;

-- CREATE OR REPLACE keeps the grants from migration-092; restated for clarity.
REVOKE ALL ON FUNCTION public.staff_claim_account(), public.asst_task_set(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_claim_account(), public.asst_task_set(uuid, boolean, text) TO authenticated;
