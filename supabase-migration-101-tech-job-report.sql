-- Migration 101: the job report in the tech portal
--
-- Fred, 2026-10-02: "don't see where I can add info to the work orders or save
-- or close the work orders, or answer questions". The emailed job link has
-- questions (custom_qa), closeout notes and a work-done check; the tech portal
-- now has them too.
--
--   wf_tech_jobs()        also returns the job's questions (custom_qa, with any
--                         answers), whether photos / a signature are required,
--                         and the closeout instructions. Still no money.
--   wf_tech_save_report() a tech saves their notes and their answers on their
--                         own live job. Answers are matched to the office's
--                         questions by id — a tech can answer a question but
--                         never add, remove or reword one.

CREATE OR REPLACE FUNCTION public.wf_tech_jobs()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
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
        'site_name', w.site_name, 'site_address', w.site_address, 'site_city', w.site_city,
        'site_state', w.site_state, 'site_zip', w.site_zip,
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
        'checked_in_at', COALESCE(ctl.checked_in_at, w.checked_in_at),
        'checked_out_at', COALESCE(ctl.checked_out_at, w.checked_out_at),
        'closeout_notes', w.closeout_notes,
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

CREATE OR REPLACE FUNCTION public.wf_tech_save_report(p_wo_number text, p_notes text, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx  jsonb := tech_ctx();
  v_name text;
  v_wo   work_orders%ROWTYPE;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  v_name := v_ctx ->> 'contractor_name';
  SELECT * INTO v_wo FROM work_orders w
   WHERE w.wo_number = p_wo_number AND w.user_id = (v_ctx ->> 'owner_id')::uuid AND w.archived_at IS NULL
     AND COALESCE(w.wo_status, 'Open') NOT IN ('Approved', 'Paid', 'Cancelled')
     AND (w.contractor_name = v_name OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
          OR w.lead_contractor_name = v_name)
   LIMIT 1;
  IF v_wo.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours'); END IF;

  UPDATE work_orders w
     SET closeout_notes = CASE WHEN p_notes IS NULL THEN w.closeout_notes ELSE NULLIF(left(btrim(p_notes), 8000), '') END,
         custom_qa = CASE
           WHEN p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' OR jsonb_typeof(w.custom_qa) <> 'array' THEN w.custom_qa
           ELSE (
             SELECT jsonb_agg(
                      CASE WHEN p_answers ? (e.q ->> 'id')
                           THEN e.q || jsonb_build_object('answer',
                                  NULLIF(left(btrim(COALESCE(p_answers ->> (e.q ->> 'id'), '')), 4000), ''))
                           ELSE e.q END
                      ORDER BY e.ord)
             FROM jsonb_array_elements(w.custom_qa) WITH ORDINALITY AS e(q, ord))
         END,
         updated_at = now()
   WHERE w.id = v_wo.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.wf_tech_save_report(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_save_report(text, text, jsonb) TO authenticated;
