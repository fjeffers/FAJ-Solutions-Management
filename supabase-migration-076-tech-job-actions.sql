-- Migration 076: let a signed-in tech actually work the job
--
-- The new portal could show a tech their jobs and let them accept one, and then
-- nothing. No check-in, no check-out, no closeout, no way to say the work was
-- done. All of that existed only behind a portal TOKEN, so a tech who signed in
-- hit a dead end on their own job.
--
-- These are the login-based twins of the token portal's write paths, and they
-- keep every rule migration 048 established:
--
--   * A tech may set ONLY 'In Progress' or 'Work Done'. Never 'Approved',
--     never 'Paid'. Approving your own work is the whole thing 048 fixed, and
--     it stays fixed here.
--   * CLOSED means closed. Once a job is Approved, Paid, or archived, a tech
--     cannot touch it — not the status, not the times, not the notes.
--   * Only on a job under their own name.
--
-- Times are written per contractor to contractor_time_logs, not to the work
-- order, so on a two-tech job each person's hours stay their own.

-- ─── Status ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tech_set_job_status(p_wo_number text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx   jsonb := tech_ctx();
  v_name  text;
  v_rows  int;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  -- The allowlist. A tech cannot approve or pay their own job.
  IF p_status NOT IN ('In Progress', 'Work Done') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  v_name := v_ctx->>'contractor_name';

  UPDATE work_orders w
     SET wo_status = p_status, updated_at = NOW()
   WHERE w.wo_number = p_wo_number
     AND w.user_id = (v_ctx->>'owner_id')::uuid
     AND w.archived_at IS NULL
     AND w.wo_status NOT IN ('Approved', 'Paid', 'Cancelled')
     AND (w.contractor_name = v_name
          OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
          OR w.lead_contractor_name = v_name);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_rows > 0,
                            'reason', CASE WHEN v_rows > 0 THEN p_status ELSE 'closed_or_not_yours' END);
END;
$function$;

-- ─── Check in / check out ───────────────────────────────────────────────────
-- One row per tech per job. Starting the clock also moves an untouched job to
-- In Progress, so the office sees it running without the tech doing two things.
CREATE OR REPLACE FUNCTION public.tech_clock(p_wo_number text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx   jsonb := tech_ctx();
  v_name  text;
  v_owner uuid;
  v_wo    work_orders%ROWTYPE;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  IF p_action NOT IN ('in', 'out') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_action');
  END IF;
  v_name  := v_ctx->>'contractor_name';
  v_owner := (v_ctx->>'owner_id')::uuid;

  SELECT * INTO v_wo FROM work_orders w
   WHERE w.wo_number = p_wo_number
     AND w.user_id = v_owner
     AND w.archived_at IS NULL
     AND w.wo_status NOT IN ('Approved', 'Paid', 'Cancelled')
     AND (w.contractor_name = v_name
          OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
          OR w.lead_contractor_name = v_name)
   LIMIT 1;

  IF v_wo.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours');
  END IF;

  INSERT INTO contractor_time_logs (user_id, wo_id, wo_number, contractor_name, checked_in_at)
  VALUES (v_owner, v_wo.id, p_wo_number, v_name, CASE WHEN p_action = 'in' THEN NOW() END)
  ON CONFLICT DO NOTHING;

  IF p_action = 'in' THEN
    UPDATE contractor_time_logs
       SET checked_in_at = NOW(), checked_out_at = NULL, updated_at = NOW()
     WHERE wo_id = v_wo.id AND contractor_name = v_name AND user_id = v_owner;
    -- A job somebody has started is in progress; say so without a second tap.
    UPDATE work_orders SET wo_status = 'In Progress', updated_at = NOW()
     WHERE id = v_wo.id AND wo_status IN ('Open', 'Assigned');
  ELSE
    UPDATE contractor_time_logs
       SET checked_out_at = NOW(), updated_at = NOW()
     WHERE wo_id = v_wo.id AND contractor_name = v_name AND user_id = v_owner;
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', p_action);
END;
$function$;

-- ─── Closeout ───────────────────────────────────────────────────────────────
-- What was done, in the tech's words. Written to their own time log AND to the
-- work order, because the office reads the work order and the payout reads the
-- time log.
CREATE OR REPLACE FUNCTION public.tech_save_closeout(p_wo_number text, p_summary text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx   jsonb := tech_ctx();
  v_name  text;
  v_owner uuid;
  v_wo_id uuid;
  v_body  text;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  v_name  := v_ctx->>'contractor_name';
  v_owner := (v_ctx->>'owner_id')::uuid;
  v_body  := left(btrim(COALESCE(p_summary, '')), 4000);

  SELECT w.id INTO v_wo_id FROM work_orders w
   WHERE w.wo_number = p_wo_number
     AND w.user_id = v_owner
     AND w.archived_at IS NULL
     AND w.wo_status NOT IN ('Approved', 'Paid', 'Cancelled')
     AND (w.contractor_name = v_name
          OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
          OR w.lead_contractor_name = v_name)
   LIMIT 1;

  IF v_wo_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours');
  END IF;

  UPDATE work_orders SET closeout_notes = v_body, updated_at = NOW() WHERE id = v_wo_id;

  INSERT INTO contractor_time_logs (user_id, wo_id, wo_number, contractor_name, work_summary)
  VALUES (v_owner, v_wo_id, p_wo_number, v_name, v_body)
  ON CONFLICT DO NOTHING;
  UPDATE contractor_time_logs
     SET work_summary = v_body, updated_at = NOW()
   WHERE wo_id = v_wo_id AND contractor_name = v_name AND user_id = v_owner;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.tech_set_job_status(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_clock(text, text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_save_closeout(text, text)  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.tech_set_job_status(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_clock(text, text)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_save_closeout(text, text)  TO authenticated;
