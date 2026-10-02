-- Migration 092: an assistant login — everything but the money.
--
-- The business is growing past one person. Fred is hiring an assistant to keep
-- jobs scheduled, chase techs, and keep the app, website, LinkedIn and Google
-- profile up to date. They need a login of their own that shows the work and
-- never the money: not what a client pays, not what a tech is paid, not the
-- profit, not a tech's bank or tax details.
--
-- ─── The model (same shape as the tech portal, migration-067) ──────────────
--
-- staff_members ties one Supabase Auth login to one business owner. RLS on
-- work_orders/contractors/crew_* stays `user_id = auth.uid()` (Fred's id), so
-- an assistant selecting those tables directly gets zero rows. Every read and
-- write goes through an asst_* SECURITY DEFINER function that names each
-- column it returns. A new money column added to a table later cannot leak
-- through a function that never mentions it.
--
-- ─── Guards ─────────────────────────────────────────────────────────────────
--
-- * Only a real business owner (someone who owns work orders or contractors)
--   can add an assistant. A tech's login owns nothing, so it cannot.
-- * A business owner can never BE an assistant. Without this, anyone could add
--   Fred's email as "their" assistant and his next login would be claimed into
--   their empty business and bounced out of his own app.
-- * The claiming email must be confirmed, the row unclaimed, the login unused.
-- * The table has no INSERT/UPDATE/DELETE policy: the owner manages it only
--   through owner_staff_* functions, so auth_user_id cannot be set by hand.

-- ─── Tables ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.staff_members (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(trim(name)) > 0),
  email          text NOT NULL CHECK (position('@' in email) > 1),
  role           text NOT NULL DEFAULT 'assistant' CHECK (role IN ('assistant')),
  enabled        boolean NOT NULL DEFAULT true,
  auth_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_members_auth_user_idx
  ON public.staff_members (auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS staff_members_owner_email_idx
  ON public.staff_members (owner_id, lower(email));

ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_members_owner_read ON public.staff_members;
CREATE POLICY staff_members_owner_read ON public.staff_members
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

-- Fred's to-do list for the assistant. Fred writes it directly (his rows only);
-- the assistant reads it and ticks items off through asst_* functions.
CREATE TABLE IF NOT EXISTS public.staff_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_id    uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  title       text NOT NULL CHECK (length(trim(title)) > 0),
  details     text,
  due_date    date,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  done_at     timestamptz,
  done_note   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_tasks_owner_idx ON public.staff_tasks (owner_id, status, due_date);

ALTER TABLE public.staff_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_tasks_owner ON public.staff_tasks;
CREATE POLICY staff_tasks_owner ON public.staff_tasks FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- ─── Who is calling? ────────────────────────────────────────────────────────

-- Someone who owns the books. Used to keep owners and assistants apart.
CREATE OR REPLACE FUNCTION public.is_business_owner(p_uid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM work_orders WHERE user_id = p_uid)
      OR EXISTS (SELECT 1 FROM contractors WHERE user_id = p_uid);
$$;

-- NULL for anyone who is not a linked, enabled assistant — including Fred.
CREATE OR REPLACE FUNCTION public.staff_ctx()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR is_business_owner(auth.uid()) THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('staff_id', s.id, 'name', s.name, 'email', s.email,
                            'owner_id', s.owner_id, 'role', s.role)
    INTO v_out
  FROM staff_members s
  WHERE s.auth_user_id = auth.uid() AND s.enabled AND s.owner_id <> auth.uid()
  ORDER BY s.created_at
  LIMIT 1;
  RETURN v_out;
END;
$$;

-- First sign-in: claim the assistant row that matches your confirmed email.
CREATE OR REPLACE FUNCTION public.staff_claim_account()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_email     text;
  v_confirmed timestamptz;
  v_id        uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in'); END IF;
  IF is_business_owner(auth.uid()) THEN RETURN jsonb_build_object('ok', false, 'reason', 'is_owner'); END IF;

  IF EXISTS (SELECT 1 FROM staff_members WHERE auth_user_id = auth.uid() AND enabled) THEN
    UPDATE staff_members SET last_login_at = now() WHERE auth_user_id = auth.uid();
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

  SELECT s.id INTO v_id
  FROM staff_members s
  WHERE lower(s.email) = lower(v_email)
    AND s.auth_user_id IS NULL
    AND s.enabled
    AND s.owner_id <> auth.uid()
  ORDER BY s.created_at
  LIMIT 1;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_matching_assistant');
  END IF;

  UPDATE staff_members SET auth_user_id = auth.uid(), last_login_at = now() WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'reason', 'linked');
END;
$$;

-- The owner app's root asks this, the same way it asks belongs_in_tech_portal.
CREATE OR REPLACE FUNCTION public.belongs_in_assistant_section()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$ SELECT staff_ctx() IS NOT NULL; $$;

-- ─── Owner: manage assistants ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.owner_staff_add(p_name text, p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name  text := trim(coalesce(p_name, ''));
  v_id    uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT is_business_owner(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;
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
  INSERT INTO staff_members (owner_id, name, email) VALUES (auth.uid(), v_name, v_email)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'reason', 'added', 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_staff_set_enabled(p_id uuid, p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  UPDATE staff_members SET enabled = coalesce(p_enabled, false)
   WHERE id = p_id AND owner_id = auth.uid();
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true, 'reason', CASE WHEN p_enabled THEN 'turned_on' ELSE 'turned_off' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_staff_remove(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM staff_members WHERE id = p_id AND owner_id = auth.uid();
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true, 'reason', 'removed');
END;
$$;

-- ─── Assistant: reads (no money, ever) ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.asst_me()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$ SELECT staff_ctx(); $$;

-- Live jobs. Explicit column list: no total_amount, contractor_pay, rates,
-- hours_worked, budgets, billables, pay add-ons, materials or mileage costs,
-- payment terms, documents, or the public portal token.
CREATE OR REPLACE FUNCTION public.asst_jobs()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := staff_ctx();
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

-- The tech roster: who they are and how to reach them. No pay rate, payment
-- method, Zelle, bank, routing, account, tax ID, home address or Fred's notes.
CREATE OR REPLACE FUNCTION public.asst_techs()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := staff_ctx();
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

-- Crew-project sites on the calendar. No bill rate, travel cap or team pay.
CREATE OR REPLACE FUNCTION public.asst_crew_sites()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := staff_ctx();
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
DECLARE v_ctx jsonb := staff_ctx();
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

-- ─── Assistant: writes ──────────────────────────────────────────────────────

-- Tick a task done (with a note for Fred), or reopen it.
CREATE OR REPLACE FUNCTION public.asst_task_set(p_id uuid, p_done boolean, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ctx jsonb := staff_ctx();
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_an_assistant'); END IF;
  UPDATE staff_tasks
     SET status     = CASE WHEN p_done THEN 'done' ELSE 'open' END,
         done_at    = CASE WHEN p_done THEN now() ELSE NULL END,
         done_note  = CASE WHEN p_done THEN NULLIF(trim(p_note), '') ELSE NULL END,
         updated_at = now()
   WHERE id = p_id
     AND owner_id = (v_ctx ->> 'owner_id')::uuid
     AND (staff_id IS NULL OR staff_id = (v_ctx ->> 'staff_id')::uuid);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true, 'reason', CASE WHEN p_done THEN 'done' ELSE 'reopened' END);
END;
$$;

-- Scheduling and site details only. Status, assignment and anything priced
-- stay with Fred: status drives closing and pay, and reassigning a job moves
-- money between techs. Only keys present in p_patch are touched.
CREATE OR REPLACE FUNCTION public.asst_update_job(p_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx   jsonb := staff_ctx();
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

-- ─── Grants ─────────────────────────────────────────────────────────────────
-- Helpers are internal: only callable from inside the functions above.
REVOKE ALL ON FUNCTION public.is_business_owner(uuid), public.staff_ctx() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
  public.staff_claim_account(), public.belongs_in_assistant_section(),
  public.owner_staff_add(text, text), public.owner_staff_set_enabled(uuid, boolean), public.owner_staff_remove(uuid),
  public.asst_me(), public.asst_jobs(), public.asst_techs(), public.asst_crew_sites(), public.asst_tasks(),
  public.asst_task_set(uuid, boolean, text), public.asst_update_job(uuid, jsonb)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.staff_claim_account(), public.belongs_in_assistant_section(),
  public.owner_staff_add(text, text), public.owner_staff_set_enabled(uuid, boolean), public.owner_staff_remove(uuid),
  public.asst_me(), public.asst_jobs(), public.asst_techs(), public.asst_crew_sites(), public.asst_tasks(),
  public.asst_task_set(uuid, boolean, text), public.asst_update_job(uuid, jsonb)
TO authenticated;
