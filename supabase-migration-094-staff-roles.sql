-- Migration 094: a role for every person on the app.
--
-- Fred: "more than one assistant can log on if needed, same as the tech ...
-- a role for each person assigned to the app, whether a tech or assistant or
-- developer or something else, accountant etc."
--
-- Several assistants already worked (one staff_members row per person, each
-- with its own login). What changes here is that a person's ROLE now decides
-- which section's functions answer them:
--
--   staff_ctx()  any linked, enabled staff member, whatever their role
--   asst_ctx()   only role = 'assistant' — every asst_* function now asks this
--
-- So when a new role such as accountant is added, those people get only the
-- functions written for that role. They can never fall through into the
-- assistant's data just by being "staff".
--
-- Roles are listed in ONE place, staff_role_allowed(). The table CHECK and
-- owner_staff_add both use it. A role joins that list only once its section
-- exists, so nobody can be given a login that lands nowhere. Today that is
-- 'assistant'. Techs keep their own model (contractors.auth_user_id).
--
-- staff_claim_account now also returns the person's role, so the sign-in
-- page can send each role to its own section.

CREATE OR REPLACE FUNCTION public.staff_role_allowed(p_role text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT p_role IN ('assistant'); $$;

ALTER TABLE public.staff_members DROP CONSTRAINT IF EXISTS staff_members_role_check;
ALTER TABLE public.staff_members ADD CONSTRAINT staff_members_role_check CHECK (staff_role_allowed(role));

-- The assistant section's gate: a linked, enabled staff member whose role is assistant.
CREATE OR REPLACE FUNCTION public.asst_ctx()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v jsonb := staff_ctx();
BEGIN
  IF v IS NULL OR v ->> 'role' <> 'assistant' THEN RETURN NULL; END IF;
  RETURN v;
END;
$$;

-- Adding a person now takes their role (assistant unless said otherwise).
DROP FUNCTION IF EXISTS public.owner_staff_add(text, text);
CREATE OR REPLACE FUNCTION public.owner_staff_add(p_name text, p_email text, p_role text DEFAULT 'assistant')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name  text := trim(coalesce(p_name, ''));
  v_role  text := lower(trim(coalesce(p_role, 'assistant')));
  v_id    uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT is_business_owner(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;
  IF NOT staff_role_allowed(v_role) THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_role'); END IF;
  IF v_name = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'name_required'); END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_email');
  END IF;
  IF v_email = (SELECT lower(email) FROM auth.users WHERE id = auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'own_email');
  END IF;
  IF EXISTS (SELECT 1 FROM staff_members WHERE owner_id = auth.uid() AND lower(email) = v_email) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate');
  END IF;
  INSERT INTO staff_members (owner_id, name, email, role) VALUES (auth.uid(), v_name, v_email, v_role)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'reason', 'added', 'id', v_id);
END;
$$;

-- Sign-in claim, now returning the role.
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
    RETURN jsonb_build_object('ok', true, 'reason', 'already_linked', 'role', v_row.role);
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
  RETURN jsonb_build_object('ok', true, 'reason', 'linked', 'role', v_row.role);
END;
$$;

-- Every assistant function, now answering only the assistant role.
CREATE OR REPLACE FUNCTION public.belongs_in_assistant_section()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$ SELECT asst_ctx() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION public.asst_me()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$ SELECT asst_ctx(); $$;

CREATE OR REPLACE FUNCTION public.asst_jobs()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := asst_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', w.id, 'wo_number', w.wo_number, 'title', w.title, 'description', w.description,
      'status', w.wo_status, 'priority', w.priority, 'service_type', w.service_type,
      'customer_name', COALESCE(NULLIF(w.customer_name, ''), w.buyer_company),
      'project_name', w.project_name, 'client_reference', w.client_reference,
      'source_platform', w.source_platform, 'external_wo_id', w.external_wo_id,
      'site_name', w.site_name, 'site_address', w.site_address, 'site_city', w.site_city,
      'site_state', w.site_state, 'site_zip', w.site_zip,
      'scheduled_date', w.scheduled_date, 'start_date', w.start_date, 'end_date', w.end_date,
      'start_time', w.start_time, 'end_time', w.end_time, 'time_zone', w.time_zone,
      'techs', CASE WHEN COALESCE(array_length(w.contractor_names, 1), 0) > 0
                    THEN to_jsonb(w.contractor_names)
                    WHEN COALESCE(w.contractor_name, '') <> '' THEN jsonb_build_array(w.contractor_name)
                    ELSE '[]'::jsonb END,
      'lead_tech', w.lead_contractor_name,
      'poc_name', w.poc_name, 'poc_phone', w.poc_phone, 'poc_email', w.poc_email,
      'access_instructions', w.access_instructions, 'parking_instructions', w.parking_instructions,
      'special_instructions', w.special_instructions, 'scope_of_work', w.scope_of_work,
      'deliverables', w.deliverables, 'tools_required', w.tools_required,
      'required_skills', w.required_skills,
      'travel_start_at', w.travel_start_at, 'arrived_at', w.arrived_at,
      'checked_in_at', w.checked_in_at, 'checked_out_at', w.checked_out_at,
      'created_at', w.created_at, 'updated_at', w.updated_at
    ) ORDER BY w.scheduled_date NULLS LAST, w.wo_number)
    FROM work_orders w
    WHERE w.user_id = (v_ctx ->> 'owner_id')::uuid
      AND w.archived_at IS NULL
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.asst_techs()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := asst_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email,
      'business_name', c.business_name, 'city', c.city, 'state', c.state,
      'w9_received', COALESCE(c.w9_received, false),
      'agreement_signed', c.contract_signed_at IS NOT NULL,
      'has_login', c.auth_user_id IS NOT NULL,
      'last_login_at', c.portal_last_login_at
    ) ORDER BY c.name)
    FROM contractors c
    WHERE c.user_id = (v_ctx ->> 'owner_id')::uuid
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.asst_crew_sites()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := asst_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'project', p.name, 'client', p.client, 'team', t.name,
      'lead', c.name, 'helper', t.helper_name,
      'week_start', s.week_start, 'survey_date', s.survey_date,
      'name', s.name, 'address', s.address, 'city', s.city, 'state', s.state, 'zip', s.zip,
      'property_id', s.property_id, 'status', s.status
    ) ORDER BY s.week_start NULLS LAST, s.name)
    FROM crew_sites s
    JOIN crew_projects p ON p.id = s.project_id AND p.archived_at IS NULL
    LEFT JOIN crew_teams t ON t.id = s.team_id
    LEFT JOIN contractors c ON c.id = t.lead_contractor_id
    WHERE s.user_id = (v_ctx ->> 'owner_id')::uuid
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.asst_tasks()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := asst_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', k.id, 'title', k.title, 'details', k.details, 'due_date', k.due_date,
      'status', k.status, 'done_at', k.done_at, 'done_note', k.done_note, 'created_at', k.created_at
    ) ORDER BY (k.status = 'done'), k.due_date NULLS LAST, k.created_at)
    FROM staff_tasks k
    WHERE k.owner_id = (v_ctx ->> 'owner_id')::uuid
      AND (k.staff_id IS NULL OR k.staff_id = (v_ctx ->> 'staff_id')::uuid)
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.asst_update_job(p_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx   jsonb := asst_ctx();
  v_label text;
  v_keys  text[];
  v_allowed text[] := ARRAY['scheduled_date','start_time','end_time','poc_name','poc_phone',
                            'poc_email','access_instructions','parking_instructions','special_instructions'];
  v_date  date;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_an_assistant'); END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nothing_to_save');
  END IF;

  SELECT array_agg(k) INTO v_keys FROM jsonb_object_keys(p_patch) k;
  IF v_keys IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'nothing_to_save'); END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE k <> ALL (v_allowed)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'field_not_allowed');
  END IF;

  IF p_patch ? 'scheduled_date' AND NULLIF(p_patch ->> 'scheduled_date', '') IS NOT NULL THEN
    BEGIN
      v_date := (p_patch ->> 'scheduled_date')::date;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_date');
    END;
  END IF;

  UPDATE work_orders w SET
    scheduled_date       = CASE WHEN p_patch ? 'scheduled_date' THEN v_date ELSE w.scheduled_date END,
    start_time           = CASE WHEN p_patch ? 'start_time' THEN NULLIF(trim(p_patch ->> 'start_time'), '') ELSE w.start_time END,
    end_time             = CASE WHEN p_patch ? 'end_time' THEN NULLIF(trim(p_patch ->> 'end_time'), '') ELSE w.end_time END,
    poc_name             = CASE WHEN p_patch ? 'poc_name' THEN NULLIF(trim(p_patch ->> 'poc_name'), '') ELSE w.poc_name END,
    poc_phone            = CASE WHEN p_patch ? 'poc_phone' THEN NULLIF(trim(p_patch ->> 'poc_phone'), '') ELSE w.poc_phone END,
    poc_email            = CASE WHEN p_patch ? 'poc_email' THEN NULLIF(trim(p_patch ->> 'poc_email'), '') ELSE w.poc_email END,
    access_instructions  = CASE WHEN p_patch ? 'access_instructions' THEN NULLIF(trim(p_patch ->> 'access_instructions'), '') ELSE w.access_instructions END,
    parking_instructions = CASE WHEN p_patch ? 'parking_instructions' THEN NULLIF(trim(p_patch ->> 'parking_instructions'), '') ELSE w.parking_instructions END,
    special_instructions = CASE WHEN p_patch ? 'special_instructions' THEN NULLIF(trim(p_patch ->> 'special_instructions'), '') ELSE w.special_instructions END,
    updated_at           = now()
  WHERE w.id = p_id
    AND w.user_id = (v_ctx ->> 'owner_id')::uuid
    AND w.archived_at IS NULL
  RETURNING w.wo_number INTO v_label;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  -- Recorded in Fred's audit log so he can see who changed what.
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
  VALUES ((v_ctx ->> 'owner_id')::uuid, 'update', 'work_order', p_id::text,
          jsonb_build_object('label', 'WO ' || coalesce(v_label, '') || ' (by assistant ' || (v_ctx ->> 'name') || ')',
                             'by_assistant', v_ctx ->> 'name') || p_patch);
  RETURN jsonb_build_object('ok', true, 'reason', 'saved');
END;
$$;

CREATE OR REPLACE FUNCTION public.asst_task_set(p_id uuid, p_done boolean, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx   jsonb := asst_ctx();
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

REVOKE ALL ON FUNCTION public.asst_ctx() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.owner_staff_add(text, text, text), public.staff_claim_account(), public.belongs_in_assistant_section(),
  public.asst_me(), public.asst_jobs(), public.asst_techs(), public.asst_crew_sites(), public.asst_tasks(),
  public.asst_task_set(uuid, boolean, text), public.asst_update_job(uuid, jsonb)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.owner_staff_add(text, text, text), public.staff_claim_account(), public.belongs_in_assistant_section(),
  public.asst_me(), public.asst_jobs(), public.asst_techs(), public.asst_crew_sites(), public.asst_tasks(),
  public.asst_task_set(uuid, boolean, text), public.asst_update_job(uuid, jsonb)
TO authenticated;
