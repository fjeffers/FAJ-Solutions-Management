-- Migration 117: Projects — the tech's day on a project, receipts the office
-- adds, and a reason for anything the tech couldn't do.
--
-- Fred, 2026-10-13: "my jobs, and right under my jobs ... projects. The
-- projects will have everything a job has ... the starting travel, when you're
-- on site, when you're leaving the site, and it needs to calculate the mileage
-- ... the meals, hotels ... I could add the hotels ... at the end of that
-- project ... send it to the client with a PDF, attaching it to the invoice."
-- Projects live inside WorkFlow: a project is the work orders that share a
-- project_name and have is_project switched on (one per site).
--
--   work_orders.is_project   the job uses the project day (travel → start job
--                            → lunch → off site → hotel / home / next site).
--   job_day_events           travel and lunch taps. Kept OUT of job_punches on
--                            purpose: hours and pay read job_punches and treat
--                            anything that isn't 'in' as a clock-out, so a
--                            lunch tap there would cut a tech's hours. Start
--                            job / Off site still go through wf_tech_clock_gps
--                            exactly as today.
--   wf_tech_day_event()      a tech records one of those taps on their job. A
--                            travel_end works out the miles from where that
--                            leg started (straight line x 1.2, rounded) when
--                            both ends have GPS. Safe to repeat (same tap time).
--   wf_tech_jobs()           + is_project, and my_day: the tech's own taps on a
--                            project job (last 21 days) so the phone knows
--                            where they are in the day. Still no money.
--   job_expenses             + 'hotel'; + paid_by ('tech' | 'faj'). Receipts the
--                            office adds itself (a hotel on the company card)
--                            are paid_by 'faj': approved, and never a pay line.
--   wf_owner_add_expense()   Fred adds a receipt to a job.
--   wf_owner_decide_expense  'Hotel' label; refuses an office receipt (nothing
--                            to approve, nobody to pay back).
--   wf_tech_closeout()       + 'skip' (a deliverable the tech couldn't do, with
--                            the reason) and 'skip_sign' (no signature, why).

-- ── 1. Projects ─────────────────────────────────────────────────────────────

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS is_project boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS work_orders_project_idx ON public.work_orders (user_id, project_name) WHERE is_project;

-- ── 2. The day: travel and lunch ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.job_day_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  wo_id           uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  wo_number       text NOT NULL,
  contractor_name text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('travel_start', 'travel_end', 'lunch_start', 'lunch_end')),
  at              timestamptz NOT NULL,
  lat             double precision,
  lng             double precision,
  accuracy        double precision,
  origin          text CHECK (origin IN ('home', 'hotel', 'site', 'other')),
  dest            text CHECK (dest IN ('site', 'hotel', 'home', 'next_site')),
  miles           numeric(7, 1) CHECK (miles >= 0 AND miles < 3000),
  miles_from_gps  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wo_id, contractor_name, kind, at)
);
CREATE INDEX IF NOT EXISTS job_day_events_wo_idx ON public.job_day_events (wo_id, at);
ALTER TABLE public.job_day_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_day_events_owner_read ON public.job_day_events;
CREATE POLICY job_day_events_owner_read ON public.job_day_events FOR SELECT TO authenticated USING (user_id = auth.uid());
-- Fred may correct the miles on a leg; nothing else is editable.
DROP POLICY IF EXISTS job_day_events_owner_miles ON public.job_day_events;
CREATE POLICY job_day_events_owner_miles ON public.job_day_events FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE ALL ON public.job_day_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.job_day_events FROM authenticated;
GRANT SELECT ON public.job_day_events TO authenticated;
GRANT UPDATE (miles, miles_from_gps) ON public.job_day_events TO authenticated;

CREATE OR REPLACE FUNCTION public.wf_tech_day_event(
  p_wo_number text, p_kind text, p_at timestamptz,
  p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_origin text, p_dest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx   jsonb := tech_ctx();
  v_name  text;
  v_owner uuid;
  v_wo    uuid;
  v_at    timestamptz := wf_trusted_time(p_at);
  v_pos   boolean := p_lat IS NOT NULL AND p_lng IS NOT NULL
                     AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180
                     AND NOT (p_lat = 0 AND p_lng = 0);
  v_acc   double precision := CASE WHEN p_accuracy >= 0 THEN p_accuracy END;
  v_last  job_day_events%ROWTYPE;
  v_miles numeric;
  v_dest  text;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  IF p_kind NOT IN ('travel_start', 'travel_end', 'lunch_start', 'lunch_end') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_action');
  END IF;
  v_name := v_ctx ->> 'contractor_name';
  v_owner := (v_ctx ->> 'owner_id')::uuid;

  SELECT w.id INTO v_wo FROM work_orders w
   WHERE w.wo_number = p_wo_number AND w.user_id = v_owner AND w.archived_at IS NULL
     AND COALESCE(w.wo_status, 'Open') NOT IN ('Approved', 'Paid', 'Cancelled')
     AND (w.contractor_name = v_name OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
          OR w.lead_contractor_name = v_name)
   LIMIT 1;
  IF v_wo IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours'); END IF;

  IF p_kind = 'travel_start' THEN
    v_dest := COALESCE(NULLIF(p_dest, ''), 'site');
    IF v_dest NOT IN ('site', 'hotel', 'home', 'next_site')
       OR (NULLIF(p_origin, '') IS NOT NULL AND p_origin NOT IN ('home', 'hotel', 'site', 'other')) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_action');
    END IF;
  END IF;

  -- The miles for a leg: from the GPS where it started to here.
  IF p_kind = 'travel_end' AND v_pos THEN
    SELECT * INTO v_last FROM job_day_events
     WHERE wo_id = v_wo AND contractor_name = v_name AND kind IN ('travel_start', 'travel_end') AND at <= v_at
     ORDER BY at DESC LIMIT 1;
    IF v_last.kind = 'travel_start' AND v_last.lat IS NOT NULL AND v_last.lng IS NOT NULL THEN
      v_miles := round((1.2 * 3958.8 * 2 * asin(sqrt(
        power(sin(radians(p_lat - v_last.lat) / 2), 2)
        + cos(radians(v_last.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - v_last.lng) / 2), 2))))::numeric, 1);
      IF v_miles >= 3000 THEN v_miles := NULL; END IF;
    END IF;
  END IF;

  INSERT INTO job_day_events (user_id, wo_id, wo_number, contractor_name, kind, at, lat, lng, accuracy,
                              origin, dest, miles, miles_from_gps)
  VALUES (v_owner, v_wo, p_wo_number, v_name, p_kind, v_at,
          CASE WHEN v_pos THEN p_lat END, CASE WHEN v_pos THEN p_lng END, CASE WHEN v_pos THEN v_acc END,
          CASE WHEN p_kind = 'travel_start' THEN NULLIF(p_origin, '') END,
          CASE WHEN p_kind = 'travel_start' THEN v_dest END,
          v_miles, v_miles IS NOT NULL)
  ON CONFLICT (wo_id, contractor_name, kind, at) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'at', v_at, 'gps', v_pos, 'miles', v_miles);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_tech_day_event(text, text, timestamptz, double precision, double precision, double precision, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_day_event(text, text, timestamptz, double precision, double precision, double precision, text, text) TO authenticated;

-- ── 3. The tech's jobs: + is_project and their day ──────────────────────────

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
        'my_day', CASE WHEN COALESCE(w.is_project, false) THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('kind', e.kind, 'at', e.at, 'origin', e.origin, 'dest', e.dest, 'miles', e.miles)
                           ORDER BY e.at)
            FROM (
              SELECT d.kind, d.at, d.origin, d.dest, d.miles FROM job_day_events d
               WHERE d.wo_id = w.id AND d.contractor_name = v_name AND d.at > now() - interval '21 days'
              UNION ALL
              SELECT p.kind, p.at, NULL, NULL, NULL FROM job_punches p
               WHERE p.wo_id = w.id AND p.contractor_name = v_name AND p.at > now() - interval '21 days'
            ) e), '[]'::jsonb) ELSE '[]'::jsonb END,
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

-- ── 4. Receipts: hotels, and the ones the office adds ───────────────────────

ALTER TABLE public.job_expenses DROP CONSTRAINT IF EXISTS job_expenses_category_check;
ALTER TABLE public.job_expenses ADD CONSTRAINT job_expenses_category_check
  CHECK (category IN ('materials', 'fuel', 'tolls_parking', 'equipment', 'meals', 'hotel', 'other'));
ALTER TABLE public.job_expenses ADD COLUMN IF NOT EXISTS paid_by text NOT NULL DEFAULT 'tech';
ALTER TABLE public.job_expenses DROP CONSTRAINT IF EXISTS job_expenses_paid_by_check;
ALTER TABLE public.job_expenses ADD CONSTRAINT job_expenses_paid_by_check CHECK (paid_by IN ('tech', 'faj'));

CREATE OR REPLACE FUNCTION public.wf_tech_add_expense(p_wo_number text, p_category text, p_vendor text, p_amount numeric, p_date date, p_note text, p_receipt_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_target jsonb := wf_tech_photo_target(p_wo_number);
  v_wo uuid;
  v_id uuid;
BEGIN
  IF v_target IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours'); END IF;
  v_wo := (v_target ->> 'wo_id')::uuid;
  IF p_category NOT IN ('materials', 'fuel', 'tolls_parking', 'equipment', 'meals', 'hotel', 'other') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_category');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount >= 10000 THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_amount'); END IF;
  IF p_date IS NULL OR p_date > (now() AT TIME ZONE 'America/New_York')::date + 1 OR p_date < (now() - interval '120 days')::date THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_date');
  END IF;
  IF p_receipt_path IS NOT NULL AND p_receipt_path !~ ('^' || v_wo::text || '/[0-9a-z_-]+\.jpg$') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_file');
  END IF;

  INSERT INTO job_expenses (user_id, wo_id, wo_number, contractor_name, category, vendor, amount, expense_date, note, receipt_path)
  VALUES ((v_ctx ->> 'owner_id')::uuid, v_wo, p_wo_number, v_ctx ->> 'contractor_name', p_category,
          NULLIF(left(btrim(COALESCE(p_vendor, '')), 120), ''), round(p_amount, 2), p_date,
          NULLIF(left(btrim(COALESCE(p_note, '')), 1000), ''), p_receipt_path)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

-- Fred adds a receipt himself (a hotel on the company card). Approved at once;
-- no pay line, because no tech paid it.
CREATE OR REPLACE FUNCTION public.wf_owner_add_expense(
  p_wo_id uuid, p_category text, p_vendor text, p_amount numeric, p_date date, p_note text, p_receipt_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_wo work_orders%ROWTYPE;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT is_business_owner(auth.uid()) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_owner'); END IF;
  SELECT * INTO v_wo FROM work_orders WHERE id = p_wo_id AND user_id = auth.uid();
  IF v_wo.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF p_category NOT IN ('materials', 'fuel', 'tolls_parking', 'equipment', 'meals', 'hotel', 'other') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_category');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount >= 10000 THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_amount'); END IF;
  IF p_date IS NULL OR p_date > (now() AT TIME ZONE 'America/New_York')::date + 1 OR p_date < (now() - interval '400 days')::date THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_date');
  END IF;
  IF p_receipt_path IS NOT NULL AND p_receipt_path !~ ('^' || v_wo.id::text || '/[0-9a-z_-]+\.(jpg|png|pdf)$') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_file');
  END IF;

  INSERT INTO job_expenses (user_id, wo_id, wo_number, contractor_name, category, vendor, amount, expense_date, note,
                            receipt_path, status, decided_at, paid_by)
  VALUES (auth.uid(), v_wo.id, v_wo.wo_number, 'Office', p_category,
          NULLIF(left(btrim(COALESCE(p_vendor, '')), 120), ''), round(p_amount, 2), p_date,
          NULLIF(left(btrim(COALESCE(p_note, '')), 1000), ''), p_receipt_path, 'approved', now(), 'faj')
  RETURNING id INTO v_id;
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'create', 'job_expense', v_id, jsonb_build_object('label',
    'Office added $' || round(p_amount, 2) || ' ' || p_category || ' receipt on WO#' || v_wo.wo_number));
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_owner_add_expense(uuid, text, text, numeric, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_owner_add_expense(uuid, text, text, numeric, date, text, text) TO authenticated;

-- Fred removes a receipt he added himself (a typo). Tech receipts are declined, never deleted.
CREATE OR REPLACE FUNCTION public.wf_owner_remove_expense(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_e job_expenses%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT is_business_owner(auth.uid()) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_owner'); END IF;
  SELECT * INTO v_e FROM job_expenses WHERE id = p_id AND user_id = auth.uid() AND paid_by = 'faj';
  IF v_e.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  DELETE FROM job_expenses WHERE id = v_e.id;
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'delete', 'job_expense', v_e.id, jsonb_build_object('label',
    'Office removed $' || v_e.amount || ' ' || v_e.category || ' receipt on WO#' || v_e.wo_number, 'receipt_path', v_e.receipt_path));
  RETURN jsonb_build_object('ok', true, 'receipt_path', v_e.receipt_path);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_owner_remove_expense(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_owner_remove_expense(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.wf_owner_decide_expense(p_id uuid, p_approve boolean, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_e job_expenses%ROWTYPE;
  v_wo work_orders%ROWTYPE;
  v_addons jsonb;
  v_line_id text;
  v_kind text;
  v_label text;
BEGIN
  IF auth.uid() IS NULL OR NOT is_business_owner(auth.uid()) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_owner'); END IF;
  SELECT * INTO v_e FROM job_expenses WHERE id = p_id AND user_id = auth.uid() FOR UPDATE;
  IF v_e.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  -- The office's own receipt: no tech to pay back, nothing to decide.
  IF v_e.paid_by = 'faj' THEN RETURN jsonb_build_object('ok', false, 'reason', 'office_expense'); END IF;
  SELECT * INTO v_wo FROM work_orders WHERE id = v_e.wo_id AND user_id = auth.uid() FOR UPDATE;
  IF v_wo.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  v_line_id := 'exp_' || v_e.id::text;
  v_addons := COALESCE((SELECT jsonb_agg(a) FROM jsonb_array_elements(COALESCE(v_wo.pay_addons, '[]'::jsonb)) a
                         WHERE a ->> 'id' IS DISTINCT FROM v_line_id), '[]'::jsonb);

  IF p_approve THEN
    IF jsonb_array_length(v_addons) = 0 THEN
      IF COALESCE(v_wo.billable_travel, 0) > 0 THEN
        v_addons := v_addons || jsonb_build_object('id', 'legacy_travel', 'kind', 'mileage', 'label', 'Travel (billed to client)',
          'amount', v_wo.billable_travel, 'qty', NULL, 'rate', NULL, 'deduct', false, 'bill_client', true, 'pay_tech', false, 'contractor_name', NULL);
      END IF;
      IF COALESCE(v_wo.billable_materials, 0) > 0 THEN
        v_addons := v_addons || jsonb_build_object('id', 'legacy_materials', 'kind', 'materials', 'label', 'Materials (billed to client)',
          'amount', v_wo.billable_materials, 'qty', NULL, 'rate', NULL, 'deduct', false, 'bill_client', true, 'pay_tech', false, 'contractor_name', NULL);
      END IF;
      IF COALESCE(v_wo.billable_other, 0) > 0 THEN
        v_addons := v_addons || jsonb_build_object('id', 'legacy_other', 'kind', 'other', 'label', 'Other (billed to client)',
          'amount', v_wo.billable_other, 'qty', NULL, 'rate', NULL, 'deduct', false, 'bill_client', true, 'pay_tech', false, 'contractor_name', NULL);
      END IF;
    END IF;
    v_kind := CASE v_e.category WHEN 'materials' THEN 'materials' WHEN 'tolls_parking' THEN 'tolls_parking'
                                WHEN 'equipment' THEN 'equipment' WHEN 'meals' THEN 'per_diem' ELSE 'other' END;
    v_label := CASE v_e.category WHEN 'materials' THEN 'Parts & materials' WHEN 'fuel' THEN 'Fuel' WHEN 'tolls_parking' THEN 'Tolls & parking'
                                 WHEN 'equipment' THEN 'Tools & equipment' WHEN 'meals' THEN 'Meals' WHEN 'hotel' THEN 'Hotel' ELSE 'Expense' END
               || COALESCE(' — ' || v_e.vendor, '') || ' (receipt ' || to_char(v_e.expense_date, 'Mon DD') || ')';
    v_addons := v_addons || jsonb_build_object('id', v_line_id, 'kind', v_kind, 'label', v_label,
      'amount', v_e.amount, 'qty', NULL, 'rate', NULL, 'deduct', false, 'bill_client', false, 'pay_tech', true,
      'contractor_name', v_e.contractor_name);
  END IF;

  UPDATE work_orders SET pay_addons = v_addons, updated_at = now() WHERE id = v_wo.id;
  UPDATE job_expenses
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END, decided_at = now(),
         decline_reason = CASE WHEN p_approve THEN NULL ELSE NULLIF(left(btrim(COALESCE(p_reason, '')), 500), '') END
   WHERE id = v_e.id;
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'update', 'job_expense', v_e.id, jsonb_build_object('label',
    CASE WHEN p_approve THEN 'Approved' ELSE 'Declined' END || ' $' || v_e.amount || ' expense from ' || v_e.contractor_name || ' on WO#' || v_e.wo_number));
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN p_approve THEN 'approved' ELSE 'declined' END);
END;
$$;

-- ── 5. Closeout: a reason for what couldn't be done ─────────────────────────

CREATE OR REPLACE FUNCTION public.wf_tech_closeout(p_wo_number text, p_op text, p_args jsonb, p_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx    jsonb := tech_ctx();
  v_name   text;
  v_id     uuid;
  v_wo     work_orders%ROWTYPE;
  v_c      jsonb;
  v_done   jsonb;
  v_delays jsonb;
  v_skips  jsonb;
  v_item   text;
  v_reason text;
  v_did    text;
  v_start  timestamptz;
  v_end    timestamptz;
  v_signer text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in'); END IF;

  IF v_ctx IS NOT NULL AND (v_ctx ->> 'owner_id')::uuid <> auth.uid() THEN
    v_name := v_ctx ->> 'contractor_name';
    SELECT w.id INTO v_id FROM work_orders w
     WHERE w.wo_number = p_wo_number AND w.user_id = (v_ctx ->> 'owner_id')::uuid AND w.archived_at IS NULL
       AND COALESCE(w.wo_status, 'Open') NOT IN ('Approved', 'Paid', 'Cancelled')
       AND (w.contractor_name = v_name OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
            OR w.lead_contractor_name = v_name)
     LIMIT 1;
  ELSIF is_business_owner(auth.uid()) THEN
    v_name := 'Office';
    SELECT w.id INTO v_id FROM work_orders w
     WHERE w.wo_number = p_wo_number AND w.user_id = auth.uid() AND w.archived_at IS NULL
     LIMIT 1;
  END IF;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours'); END IF;

  SELECT * INTO v_wo FROM work_orders WHERE id = v_id FOR UPDATE;

  v_c := CASE WHEN jsonb_typeof(v_wo.closeout) = 'object' THEN v_wo.closeout ELSE '{}'::jsonb END;
  v_done := CASE WHEN jsonb_typeof(v_c -> 'done') = 'array' THEN v_c -> 'done' ELSE '[]'::jsonb END;
  v_delays := CASE WHEN jsonb_typeof(v_c -> 'delays') = 'array' THEN v_c -> 'delays' ELSE '[]'::jsonb END;
  v_skips := CASE WHEN jsonb_typeof(v_c -> 'skipped') = 'object' THEN v_c -> 'skipped' ELSE '{}'::jsonb END;
  p_args := COALESCE(p_args, '{}'::jsonb);

  IF p_op = 'tick' THEN
    v_item := left(btrim(COALESCE(p_args ->> 'item', '')), 200);
    IF v_item = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_closeout'); END IF;
    SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_done
      FROM jsonb_array_elements(v_done) e WHERE e #>> '{}' <> v_item;
    IF COALESCE((p_args ->> 'done')::boolean, false) AND jsonb_array_length(v_done) < 60 THEN
      v_done := v_done || to_jsonb(v_item);
      v_skips := v_skips - v_item;   -- done after all: the reason no longer applies
    END IF;
    v_c := v_c || jsonb_build_object('done', v_done, 'skipped', v_skips);

  ELSIF p_op = 'skip' THEN
    v_item := left(btrim(COALESCE(p_args ->> 'item', '')), 200);
    v_reason := left(btrim(COALESCE(p_args ->> 'reason', '')), 300);
    IF v_item = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_closeout'); END IF;
    IF v_reason = '' THEN
      v_skips := v_skips - v_item;
    ELSIF (SELECT count(*) FROM jsonb_object_keys(v_skips)) < 60 OR v_skips ? v_item THEN
      v_skips := v_skips || jsonb_build_object(v_item, v_reason);
      SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_done
        FROM jsonb_array_elements(v_done) e WHERE e #>> '{}' <> v_item;
    END IF;
    v_c := v_c || jsonb_build_object('done', v_done, 'skipped', v_skips);

  ELSIF p_op = 'skip_sign' THEN
    v_reason := left(btrim(COALESCE(p_args ->> 'reason', '')), 300);
    v_c := v_c || jsonb_build_object('sign_skip', CASE WHEN v_reason = '' THEN NULL
      ELSE jsonb_build_object('reason', v_reason, 'at', wf_trusted_time(p_at), 'by', v_name) END);

  ELSIF p_op = 'add_delay' THEN
    v_did := left(COALESCE(p_args ->> 'id', ''), 60);
    BEGIN
      v_start := (p_args ->> 'start')::timestamptz;
      v_end   := (p_args ->> 'end')::timestamptz;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_closeout');
    END;
    IF v_did = '' OR v_start IS NULL OR v_end IS NULL OR v_end < v_start OR v_end - v_start > interval '24 hours' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_closeout');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_delays) e WHERE e ->> 'id' = v_did)
       AND jsonb_array_length(v_delays) < 50 THEN
      v_delays := v_delays || jsonb_build_object(
        'id', v_did,
        'reason', NULLIF(left(btrim(COALESCE(p_args ->> 'reason', '')), 300), ''),
        'start', v_start, 'end', v_end, 'by', v_name);
    END IF;
    v_c := v_c || jsonb_build_object('delays', v_delays);

  ELSIF p_op = 'remove_delay' THEN
    v_did := COALESCE(p_args ->> 'id', '');
    SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb) INTO v_delays
      FROM jsonb_array_elements(v_delays) WITH ORDINALITY AS t(e, ord) WHERE e ->> 'id' <> v_did;
    v_c := v_c || jsonb_build_object('delays', v_delays);

  ELSIF p_op = 'sign' THEN
    v_signer := left(btrim(COALESCE(p_args ->> 'name', '')), 120);
    IF v_signer = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_closeout'); END IF;
    v_c := v_c || jsonb_build_object('signoff', jsonb_build_object(
      'name', v_signer, 'signed_at', wf_trusted_time(p_at), 'by', v_name), 'sign_skip', NULL);

  ELSIF p_op = 'clear_sign' THEN
    v_c := v_c || jsonb_build_object('signoff', NULL);

  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_closeout');
  END IF;

  UPDATE work_orders SET closeout = v_c, updated_at = now() WHERE id = v_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
