-- Migration 127: the tech's day on every job, not only projects (2026-10-18).
--
-- Fred chose to give FAJ techs the Field Service LIVE tech screens on FAJ's
-- own data ("Replace FAJ tech, keep extras"). Field Service walks every job
-- through the day: clock in, travel, arrive, lunch, off site, travel to the
-- hotel or home. FAJ already records those taps on any job
-- (wf_tech_day_event, wf_tech_clock_gps); only the list the phone reads them
-- back from was limited to project jobs.
--
--   wf_tech_jobs()   my_day for every job (the tech's own taps, last 21
--                    days), and day_flow: true so the phone knows this
--                    database sends it. A phone on an older database keeps the
--                    plain clock in / out. Still no money. Pay, hours and
--                    miles are worked out exactly as before.

CREATE OR REPLACE FUNCTION public.wf_tech_jobs()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx   jsonb := tech_ctx();
  v_name  text;
  v_owner uuid;
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_name  := v_ctx ->> 'contractor_name';
  v_owner := (v_ctx ->> 'owner_id')::uuid;
  RETURN COALESCE((
    SELECT jsonb_agg(j ORDER BY sort_date NULLS LAST, wo_number)
    FROM (
      SELECT jsonb_build_object(
        'id', w.id, 'wo_number', w.wo_number, 'title', w.title, 'description', w.description,
        'scope_of_work', w.scope_of_work, 'service_type', w.service_type, 'wo_status', w.wo_status,
        'priority', w.priority, 'customer_name', COALESCE(NULLIF(w.customer_name, ''), w.buyer_company),
        'project_name', w.project_name,
        'is_project', COALESCE(w.is_project, false),
        'site_name', w.site_name, 'site_address', w.site_address, 'site_city', w.site_city,
        'site_state', w.site_state, 'site_zip', w.site_zip,
        'site_lat', w.site_lat, 'site_lng', w.site_lng,
        'scheduled_date', w.scheduled_date, 'start_date', w.start_date, 'end_date', w.end_date,
        'start_time', w.start_time, 'end_time', w.end_time, 'time_zone', w.time_zone,
        'poc_name', w.poc_name, 'poc_phone', w.poc_phone, 'poc_email', w.poc_email,
        'access_instructions', w.access_instructions, 'parking_instructions', w.parking_instructions,
        'special_instructions', w.special_instructions, 'deliverables', w.deliverables,
        'deliverable_instructions', w.deliverable_instructions,
        'tools_required', w.tools_required, 'required_skills', w.required_skills,
        'wo_tasks', COALESCE(w.wo_tasks, '[]'::jsonb),
        'custom_qa', COALESCE(w.custom_qa, '[]'::jsonb),
        'photo_required', COALESCE(w.photo_required, false),
        'signature_required', COALESCE(w.signature_required, false),
        'techs', CASE WHEN COALESCE(array_length(w.contractor_names, 1), 0) > 0 THEN to_jsonb(w.contractor_names)
                      WHEN COALESCE(w.contractor_name, '') <> '' THEN jsonb_build_array(w.contractor_name)
                      ELSE '[]'::jsonb END,
        'my_response', w.assignment_responses -> v_name ->> 'status',
        'my_time_request', w.time_requests -> v_name,
        'closeout', w.closeout,
        'checked_in_at', COALESCE(ctl.checked_in_at, w.checked_in_at),
        'checked_out_at', COALESCE(ctl.checked_out_at, w.checked_out_at),
        'closeout_notes', w.closeout_notes,
        'day_flow', true,
        'my_day', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('kind', e.kind, 'at', e.at, 'origin', e.origin, 'dest', e.dest, 'miles', e.miles)
                           ORDER BY e.at)
            FROM (
              SELECT d.kind, d.at, d.origin, d.dest, d.miles FROM job_day_events d
               WHERE d.wo_id = w.id AND d.contractor_name = v_name AND d.at > now() - interval '21 days'
              UNION ALL
              SELECT p.kind, p.at, NULL, NULL, NULL FROM job_punches p
               WHERE p.wo_id = w.id AND p.contractor_name = v_name AND p.at > now() - interval '21 days'
            ) e), '[]'::jsonb),
        'updated_at', w.updated_at
      ) AS j,
      COALESCE(w.scheduled_date, w.start_date, w.created_at::date) AS sort_date,
      w.wo_number
      FROM work_orders w
      LEFT JOIN contractor_time_logs ctl ON ctl.wo_id = w.id AND ctl.contractor_name = v_name
      WHERE w.user_id = v_owner
        AND w.archived_at IS NULL
        AND COALESCE(w.wo_status, 'Open') <> 'Cancelled'
        AND (w.contractor_name = v_name
             OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
             OR w.lead_contractor_name = v_name)
        AND (COALESCE(w.wo_status, 'Open') NOT IN ('Work Done', 'Approved', 'Paid')
             OR w.updated_at > now() - interval '45 days')
    ) sub
  ), '[]'::jsonb);
END;
$$;
