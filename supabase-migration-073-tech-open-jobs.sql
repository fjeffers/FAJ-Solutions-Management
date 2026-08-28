-- Migration 073: open work a tech can pick up, and accept/decline in the portal
--
-- Accept/decline already existed, but only as one-click links in an assignment
-- email hitting /api/portal/respond. A tech signed in at /tech had no way to
-- respond, and no way to see work that was going spare.
--
-- ─── What counts as "open" ──────────────────────────────────────────────────
--
-- Only genuinely UNASSIGNED jobs. A job already under another tech's name stays
-- invisible, which keeps the rule Fred set: a tech sees their own work, their
-- own pay, and work nobody has taken. Nothing about anyone else.
--
-- Money is stripped exactly as it is in tech_my_jobs — same named column list,
-- no total_amount, no contractor_pay, no rates. Open work is something to pick
-- up, not a price list.

CREATE OR REPLACE FUNCTION public.tech_open_jobs()
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
  IF v_ctx IS NULL THEN RETURN NULL; END IF;
  v_name := v_ctx->>'contractor_name';

  SELECT jsonb_agg(j ORDER BY sort_date ASC NULLS LAST) INTO v_out
  FROM (
    SELECT jsonb_build_object(
      'id', w.id, 'wo_number', w.wo_number, 'title', w.title, 'description', w.description,
      'scope_of_work', w.scope_of_work, 'service_type', w.service_type, 'wo_status', w.wo_status,
      'customer_name', w.customer_name, 'project_name', w.project_name,
      'site_name', w.site_name, 'site_address', w.site_address, 'site_city', w.site_city,
      'site_state', w.site_state, 'site_zip', w.site_zip,
      'start_date', w.start_date, 'end_date', w.end_date, 'scheduled_date', w.scheduled_date,
      'start_time', w.start_time, 'end_time', w.end_time,
      'required_skills', w.required_skills, 'priority', w.priority,
      -- Whether THIS tech has already responded, so the UI is honest about it.
      'my_response', w.assignment_responses -> v_name ->> 'status',
      'created_at', w.created_at
    ) AS j,
    COALESCE(w.scheduled_date, w.start_date, w.created_at::date) AS sort_date
    FROM work_orders w
    WHERE w.user_id = (v_ctx->>'owner_id')::uuid
      AND w.archived_at IS NULL
      AND w.wo_status NOT IN ('Approved', 'Paid', 'Cancelled')
      -- Unassigned only: nobody's name on it by any route.
      AND COALESCE(NULLIF(btrim(w.contractor_name), ''), NULL) IS NULL
      AND COALESCE(array_length(w.contractor_names, 1), 0) = 0
      AND COALESCE(NULLIF(btrim(w.lead_contractor_name), ''), NULL) IS NULL
      -- Already declined by this tech: stop offering it back to them.
      AND COALESCE(w.assignment_responses -> v_name ->> 'status', '') <> 'declined'
  ) sub;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$function$;

-- ─── Accept or decline ──────────────────────────────────────────────────────
-- Accepting an unassigned job takes it. The UPDATE re-checks that the job is
-- still unassigned in the same statement, so two techs tapping Accept at the
-- same moment cannot both end up on it — the second is told it was taken.
CREATE OR REPLACE FUNCTION public.tech_respond_to_job(p_wo_number text, p_response text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx     jsonb := tech_ctx();
  v_name    text;
  v_owner   uuid;
  v_updated int;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  IF p_response NOT IN ('accepted', 'declined') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_response');
  END IF;

  v_name  := v_ctx->>'contractor_name';
  v_owner := (v_ctx->>'owner_id')::uuid;

  IF p_response = 'declined' THEN
    UPDATE work_orders w
       SET assignment_responses = COALESCE(w.assignment_responses, '{}'::jsonb)
             || jsonb_build_object(v_name, jsonb_build_object('status', 'declined', 'at', NOW())),
           updated_at = NOW()
     WHERE w.wo_number = p_wo_number
       AND w.user_id = v_owner
       AND w.archived_at IS NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN jsonb_build_object('ok', v_updated > 0, 'reason',
                              CASE WHEN v_updated > 0 THEN 'declined' ELSE 'not_found' END);
  END IF;

  -- Accept: take it, but only while it is still free.
  UPDATE work_orders w
     SET contractor_name = v_name,
         assignment_responses = COALESCE(w.assignment_responses, '{}'::jsonb)
           || jsonb_build_object(v_name, jsonb_build_object('status', 'accepted', 'at', NOW())),
         updated_at = NOW()
   WHERE w.wo_number = p_wo_number
     AND w.user_id = v_owner
     AND w.archived_at IS NULL
     AND w.wo_status NOT IN ('Approved', 'Paid', 'Cancelled')
     AND COALESCE(NULLIF(btrim(w.contractor_name), ''), NULL) IS NULL
     AND COALESCE(array_length(w.contractor_names, 1), 0) = 0
     AND COALESCE(NULLIF(btrim(w.lead_contractor_name), ''), NULL) IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_taken');
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', 'accepted');
END;
$function$;

REVOKE ALL ON FUNCTION public.tech_open_jobs()                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_respond_to_job(text, text)        FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.tech_open_jobs()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_respond_to_job(text, text) TO authenticated;
