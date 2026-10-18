-- Migration 128: what each job asks the tech for, odometer photos, fuel gallons (2026-10-18).
--
-- Fred, 2026-10-18: on jobs where the client has their own portal for the
-- work, FAJ only keeps the time, the miles and the receipts, for the weekly
-- bill. "I need all work order is customizable. No one want to look at blank
-- items if not needed." He chose job templates plus ticks on each job, and
-- odometer photos at the start and end of each drive, read by AI, with the
-- GPS miles kept as a check.
--
--   work_orders.capture        The items this job asks the tech for. NULL means
--                              everything, exactly as before this migration.
--   user_settings.job_templates Fred's saved sets of items ("Client portal job:
--                              travel, odometer, receipts"). Office only.
--   job_odometer               One odometer reading: when, the number, what the
--                              AI read from the photo, the photo, and where (GPS).
--   work_orders.start_asks     What else the office wants at check-in on this job:
--                              a photo or a short answer each (lib/checkin.ts).
--   wf_tech_add_odometer()     A tech records a reading on their own live job.
--   job_expenses.gallons, .ai  Fuel gallons, and what the AI read off the
--                              receipt photo (to flag a mismatch).
--   wf_tech_add_expense(9)     The same as the 7-argument one, plus gallons and
--                              the AI's reading. The 7-argument one stays, so the
--                              app keeps working while it updates.
--   wf_tech_jobs()             Also sends each job's capture and the tech's own
--                              odometer readings from the last 21 days.
--
-- Nothing changes how pay, hours or GPS miles are worked out.

-- ── What each job asks for ──────────────────────────────────────────────────
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS capture text[];
ALTER TABLE public.work_orders DROP CONSTRAINT IF EXISTS work_orders_capture_known;
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_capture_known CHECK (
  capture IS NULL OR capture <@ ARRAY['travel', 'lunch', 'odometer', 'receipts', 'photos', 'checklist',
                                      'questions', 'deliverables', 'signature', 'notes']::text[]);

-- Fred, 2026-10-18: "I want to be able to add what I'm looking for when starting".
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS start_asks jsonb;
ALTER TABLE public.work_orders DROP CONSTRAINT IF EXISTS work_orders_start_asks_shape;
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_start_asks_shape CHECK (
  start_asks IS NULL OR (jsonb_typeof(start_asks) = 'array' AND pg_column_size(start_asks) < 8192));

ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS job_templates jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.user_settings DROP CONSTRAINT IF EXISTS user_settings_job_templates_size;
ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_job_templates_size CHECK (pg_column_size(job_templates) < 32768);

-- ── Odometer readings ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_odometer (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  wo_id           uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  wo_number       text NOT NULL,
  contractor_name text NOT NULL,
  at              timestamptz NOT NULL,
  reading         numeric(9, 1) NOT NULL CHECK (reading >= 0 AND reading < 10000000),
  ai_reading      numeric(9, 1) CHECK (ai_reading >= 0 AND ai_reading < 10000000),
  photo_path      text,
  lat             double precision CHECK (lat BETWEEN -90 AND 90),
  lng             double precision CHECK (lng BETWEEN -180 AND 180),
  accuracy        double precision CHECK (accuracy >= 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_odometer_wo_idx ON public.job_odometer (wo_id, at);
CREATE INDEX IF NOT EXISTS job_odometer_owner_idx ON public.job_odometer (user_id, at);
ALTER TABLE public.job_odometer ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_odometer_owner_read ON public.job_odometer;
CREATE POLICY job_odometer_owner_read ON public.job_odometer FOR SELECT TO authenticated USING (user_id = auth.uid());
-- Fred may correct a reading the photo shows clearly; nothing else is editable.
DROP POLICY IF EXISTS job_odometer_owner_fix ON public.job_odometer;
CREATE POLICY job_odometer_owner_fix ON public.job_odometer FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE ALL ON public.job_odometer FROM anon;
REVOKE INSERT, DELETE ON public.job_odometer FROM authenticated;

CREATE OR REPLACE FUNCTION public.wf_tech_add_odometer(
  p_wo_number text, p_at timestamptz, p_reading numeric, p_ai_reading numeric, p_photo_path text,
  p_lat double precision, p_lng double precision, p_accuracy double precision)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx    jsonb := tech_ctx();
  v_target jsonb := wf_tech_photo_target(p_wo_number);
  v_wo     uuid;
  v_id     uuid;
BEGIN
  IF v_ctx IS NULL OR v_target IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours'); END IF;
  v_wo := (v_target ->> 'wo_id')::uuid;
  IF p_reading IS NULL OR p_reading < 0 OR p_reading >= 10000000
     OR (p_ai_reading IS NOT NULL AND (p_ai_reading < 0 OR p_ai_reading >= 10000000)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_reading');
  END IF;
  IF p_photo_path IS NOT NULL AND p_photo_path !~ ('^' || v_wo::text || '/odo_[0-9a-z_-]+\.jpg$') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_file');
  END IF;
  INSERT INTO job_odometer (user_id, wo_id, wo_number, contractor_name, at, reading, ai_reading, photo_path, lat, lng, accuracy)
  VALUES ((v_ctx ->> 'owner_id')::uuid, v_wo, p_wo_number, v_ctx ->> 'contractor_name', wf_trusted_time(p_at),
          round(p_reading, 1), round(p_ai_reading, 1), p_photo_path,
          -- A position outside the world is dropped, not refused: the reading still counts.
          CASE WHEN p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180 THEN p_lat END,
          CASE WHEN p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180 THEN p_lng END,
          CASE WHEN p_accuracy >= 0 THEN p_accuracy END)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_tech_add_odometer(text, timestamptz, numeric, numeric, text, double precision, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_add_odometer(text, timestamptz, numeric, numeric, text, double precision, double precision, double precision) TO authenticated;

-- ── Fuel gallons and the AI's reading on receipts ──────────────────────────
ALTER TABLE public.job_expenses ADD COLUMN IF NOT EXISTS gallons numeric(7, 3);
ALTER TABLE public.job_expenses DROP CONSTRAINT IF EXISTS job_expenses_gallons_range;
ALTER TABLE public.job_expenses ADD CONSTRAINT job_expenses_gallons_range CHECK (gallons IS NULL OR (gallons > 0 AND gallons < 1000));
ALTER TABLE public.job_expenses ADD COLUMN IF NOT EXISTS ai jsonb;
ALTER TABLE public.job_expenses DROP CONSTRAINT IF EXISTS job_expenses_ai_size;
ALTER TABLE public.job_expenses ADD CONSTRAINT job_expenses_ai_size CHECK (ai IS NULL OR pg_column_size(ai) < 4096);

CREATE OR REPLACE FUNCTION public.wf_tech_add_expense(
  p_wo_number text, p_category text, p_vendor text, p_amount numeric, p_date date, p_note text, p_receipt_path text,
  p_gallons numeric, p_ai jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF p_gallons IS NOT NULL AND (p_gallons <= 0 OR p_gallons >= 1000) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_gallons');
  END IF;
  IF p_ai IS NOT NULL AND (jsonb_typeof(p_ai) <> 'object' OR pg_column_size(p_ai) >= 4096) THEN p_ai := NULL; END IF;
  -- The checks and the insert are the 7-argument function's own.
  v_res := wf_tech_add_expense(p_wo_number, p_category, p_vendor, p_amount, p_date, p_note, p_receipt_path);
  IF (v_res ->> 'ok')::boolean THEN
    UPDATE job_expenses SET gallons = CASE WHEN p_category = 'fuel' THEN round(p_gallons, 3) END, ai = p_ai
     WHERE id = (v_res ->> 'id')::uuid;
  END IF;
  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.wf_tech_add_expense(text, text, text, numeric, date, text, text, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_add_expense(text, text, text, numeric, date, text, text, numeric, jsonb) TO authenticated;

-- ── The tech's job list: also the capture and their own odometer readings ──
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
        'day_flow', true
      ) || jsonb_build_object(
        -- A second object: jsonb_build_object takes at most 100 arguments.
        'capture', to_jsonb(w.capture),
        'start_asks', COALESCE(w.start_asks, '[]'::jsonb),
        'my_odometer', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('at', o.at, 'reading', o.reading) ORDER BY o.at)
            FROM job_odometer o
           WHERE o.wo_id = w.id AND o.contractor_name = v_name AND o.at > now() - interval '21 days'), '[]'::jsonb),
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

-- The office sees new readings as they come in, like the other day tables (migration 126).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'job_odometer') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.job_odometer;
  END IF;
END $$;
