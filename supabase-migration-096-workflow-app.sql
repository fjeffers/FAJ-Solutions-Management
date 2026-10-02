-- Migration 096: server side of the WorkFlow app (Fred's Flutter app, github
-- fjeffers/primio-WorkFlow-3b2fad68), which replaces the tech portal and the
-- Work Orders screen as the place work orders are handled.
--
-- Fred, 2026-10-02: WorkFlow becomes where all work orders live. Techs see only
-- their own jobs and no pay. Fred sees every job and creates and assigns them.
--
--   wf_tech_jobs()     a tech's jobs: live ones, offers waiting for an answer,
--                      and finished ones from the last 45 days, with everything
--                      a tech needs on site (contact, access, parking, checklist,
--                      their own clock times). No money of any kind.
--   wf_create_job(p)   the owner creates a job. The work order number is picked
--                      here by the one rule (lib/wo-number.ts): continue from the
--                      highest number in use and skip anything taken. The
--                      per-owner unique index from migration-078 still guards it,
--                      because payments find their job by this number.
--
-- Accepting, declining, clocking in/out, marking work done and job messages use
-- the existing tech_* functions unchanged, so WorkFlow and the old tech portal
-- write the same records while both are running.

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
        'tools_required', w.tools_required, 'required_skills', w.required_skills,
        'wo_tasks', COALESCE(w.wo_tasks, '[]'::jsonb),
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

CREATE OR REPLACE FUNCTION public.wf_create_job(p_job jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_owner  uuid := auth.uid();
  v_title  text := NULLIF(trim(p_job ->> 'title'), '');
  v_client text := NULLIF(trim(p_job ->> 'customer_name'), '');
  v_techs  text[] := ARRAY[]::text[];
  v_pay    jsonb := '{}'::jsonb;
  v_t      jsonb;
  v_name   text;
  v_next   bigint;
  v_number text;
  v_date   date;
  v_price  numeric;
  v_id     uuid;
BEGIN
  IF v_owner IS NULL OR NOT is_business_owner(v_owner) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;
  IF v_title IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'title_required'); END IF;
  IF v_client IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'client_required'); END IF;

  BEGIN
    v_date  := NULLIF(p_job ->> 'scheduled_date', '')::date;
    v_price := COALESCE(NULLIF(p_job ->> 'total_amount', '')::numeric, 0);
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_value');
  END;
  IF v_price < 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_value'); END IF;

  -- Techs must be the owner's own contractors, named exactly as on file:
  -- payments and the tech portal match by name.
  FOR v_t IN SELECT * FROM jsonb_array_elements(COALESCE(p_job -> 'techs', '[]'::jsonb)) LOOP
    v_name := trim(v_t ->> 'name');
    IF NOT EXISTS (SELECT 1 FROM contractors WHERE user_id = v_owner AND name = v_name) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'unknown_tech', 'name', v_name);
    END IF;
    IF NOT v_name = ANY(v_techs) THEN v_techs := v_techs || v_name; END IF;
    -- Pay is recorded only when it was given; no figure stays "not set",
    -- which the app reports honestly instead of guessing.
    IF NULLIF(v_t ->> 'pay', '') IS NOT NULL THEN
      v_pay := v_pay || jsonb_build_object(v_name, round((v_t ->> 'pay')::numeric, 2));
    END IF;
  END LOOP;

  -- The one numbering rule: highest number in use + 1, stepping over taken ones.
  LOCK TABLE work_orders IN SHARE ROW EXCLUSIVE MODE;
  SELECT COALESCE(max(wo_number::bigint), 1000) + 1 INTO v_next
  FROM work_orders WHERE user_id = v_owner AND wo_number ~ '^\d{1,15}$';
  WHILE EXISTS (SELECT 1 FROM work_orders WHERE user_id = v_owner AND wo_number = v_next::text) LOOP
    v_next := v_next + 1;
  END LOOP;
  v_number := v_next::text;

  INSERT INTO work_orders (
    user_id, wo_number, title, customer_name, description, service_type, priority,
    site_name, site_address, site_city, site_state, site_zip,
    scheduled_date, start_date, start_time, end_time,
    poc_name, poc_phone, access_instructions, special_instructions,
    total_amount, contractor_name, contractor_names, contractor_pay, pay_type, wo_status
  ) VALUES (
    v_owner, v_number, v_title, v_client, NULLIF(trim(p_job ->> 'description'), ''),
    NULLIF(trim(p_job ->> 'service_type'), ''), NULLIF(trim(p_job ->> 'priority'), ''),
    NULLIF(trim(p_job ->> 'site_name'), ''), NULLIF(trim(p_job ->> 'site_address'), ''),
    NULLIF(trim(p_job ->> 'site_city'), ''), NULLIF(trim(p_job ->> 'site_state'), ''),
    NULLIF(trim(p_job ->> 'site_zip'), ''),
    v_date, v_date, NULLIF(trim(p_job ->> 'start_time'), ''), NULLIF(trim(p_job ->> 'end_time'), ''),
    NULLIF(trim(p_job ->> 'poc_name'), ''), NULLIF(trim(p_job ->> 'poc_phone'), ''),
    NULLIF(trim(p_job ->> 'access_instructions'), ''), NULLIF(trim(p_job ->> 'special_instructions'), ''),
    v_price, COALESCE(v_techs[1], ''), v_techs,
    CASE WHEN v_pay = '{}'::jsonb THEN NULL ELSE v_pay END,
    'Fixed', CASE WHEN array_length(v_techs, 1) > 0 THEN 'Assigned' ELSE 'Open' END
  ) RETURNING id INTO v_id;

  INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
  VALUES (v_owner, 'create', 'work_order', v_id::text,
          jsonb_build_object('label', 'WO ' || v_number || ' created in WorkFlow', 'title', v_title));

  RETURN jsonb_build_object('ok', true, 'reason', 'created', 'id', v_id, 'wo_number', v_number);
END;
$$;

REVOKE ALL ON FUNCTION public.wf_tech_jobs(), public.wf_create_job(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_jobs(), public.wf_create_job(jsonb) TO authenticated;
