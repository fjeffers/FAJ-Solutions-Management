-- Migration 074: a tech sees what they were SENT, not a job board
--
-- Corrects migration 073. That version listed every unassigned work order and
-- let any tech claim one. Fred's rule is the opposite and it is the right one:
--
--   "unless i send work orders to them they should see it.
--    my jobs should be the ones i sent"
--
-- A tech's portal is not a marketplace. Nothing appears until Fred puts their
-- name on it. What they still get is the ability to ACCEPT or DECLINE what they
-- were sent, in the app, instead of only through a one-click email link.
--
-- So tech_open_jobs stops meaning "unclaimed work" and starts meaning "sent to
-- you, awaiting your answer". My Jobs is unchanged — everything under their
-- name — so nothing they already had disappears.

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
      'my_response', w.assignment_responses -> v_name ->> 'status',
      'created_at', w.created_at
    ) AS j,
    COALESCE(w.scheduled_date, w.start_date, w.created_at::date) AS sort_date
    FROM work_orders w
    WHERE w.user_id = (v_ctx->>'owner_id')::uuid
      AND w.archived_at IS NULL
      AND w.wo_status NOT IN ('Approved', 'Paid', 'Cancelled')
      -- SENT TO THEM. This is the whole correction: their name must be on it.
      AND (w.contractor_name = v_name
           OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
           OR w.lead_contractor_name = v_name)
      -- Still waiting on them. Once they answer either way it leaves this list.
      AND COALESCE(w.assignment_responses -> v_name ->> 'status', '') = ''
  ) sub;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$function$;

-- Accept/decline no longer claims anything — the job is already theirs. It
-- records the answer so Fred knows who has committed and who has passed.
--
-- A decline deliberately does NOT unassign the job. Quietly pulling a tech's
-- name off a work order would hide the fact that it needs re-crewing; Fred
-- sees the decline and decides.
CREATE OR REPLACE FUNCTION public.tech_respond_to_job(p_wo_number text, p_response text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx     jsonb := tech_ctx();
  v_name    text;
  v_updated int;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  IF p_response NOT IN ('accepted', 'declined') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_response');
  END IF;
  v_name := v_ctx->>'contractor_name';

  UPDATE work_orders w
     SET assignment_responses = COALESCE(w.assignment_responses, '{}'::jsonb)
           || jsonb_build_object(v_name, jsonb_build_object('status', p_response, 'at', NOW())),
         updated_at = NOW()
   WHERE w.wo_number = p_wo_number
     AND w.user_id = (v_ctx->>'owner_id')::uuid
     AND w.archived_at IS NULL
     -- Only on a job that was actually sent to them.
     AND (w.contractor_name = v_name
          OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
          OR w.lead_contractor_name = v_name);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_your_job');
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', p_response);
END;
$function$;
