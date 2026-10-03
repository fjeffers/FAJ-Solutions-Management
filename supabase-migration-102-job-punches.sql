-- Migration 102: every clock-in and clock-out, kept (for the job log)
--
-- Fred, 2026-10-02: "can try job log". contractor_time_logs holds one row per
-- tech per job and each clock-in overwrites the last, so a job worked over
-- several days kept only its latest day. job_punches keeps every tap — when,
-- where (GPS) and who — so the job log can show each day.
--
--   job_punches         one row per clock-in / clock-out from the tech portal.
--                       Owner reads through RLS; only wf_tech_clock_gps writes.
--   wf_tech_clock_gps() unchanged in what it does, plus it records the punch.

CREATE TABLE IF NOT EXISTS public.job_punches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  wo_id           uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  wo_number       text NOT NULL,
  contractor_name text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('in', 'out')),
  at              timestamptz NOT NULL,
  lat             double precision,
  lng             double precision,
  accuracy        double precision,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_punches_wo_idx ON public.job_punches (wo_id, at);
ALTER TABLE public.job_punches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_punches_owner_read ON public.job_punches;
CREATE POLICY job_punches_owner_read ON public.job_punches FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.job_punches FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.job_punches FROM authenticated;

CREATE OR REPLACE FUNCTION public.wf_tech_clock_gps(
  p_wo_number text, p_action text, p_at timestamptz,
  p_lat double precision, p_lng double precision, p_accuracy double precision)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_name text;
  v_owner uuid;
  v_wo work_orders%ROWTYPE;
  v_log_id uuid;
  v_at timestamptz := wf_trusted_time(p_at);
  v_pos boolean := p_lat IS NOT NULL AND p_lng IS NOT NULL
                   AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180;
  v_acc double precision := CASE WHEN p_accuracy >= 0 THEN p_accuracy END;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  IF p_action NOT IN ('in', 'out') THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_action'); END IF;
  v_name := v_ctx ->> 'contractor_name';
  v_owner := (v_ctx ->> 'owner_id')::uuid;

  SELECT * INTO v_wo FROM work_orders w
   WHERE w.wo_number = p_wo_number AND w.user_id = v_owner AND w.archived_at IS NULL
     AND w.wo_status NOT IN ('Approved', 'Paid', 'Cancelled')
     AND (w.contractor_name = v_name OR v_name = ANY(COALESCE(w.contractor_names, ARRAY[]::text[]))
          OR w.lead_contractor_name = v_name)
   LIMIT 1;
  IF v_wo.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_or_not_yours'); END IF;

  SELECT id INTO v_log_id FROM contractor_time_logs WHERE wo_id = v_wo.id AND contractor_name = v_name LIMIT 1;
  IF v_log_id IS NULL THEN
    INSERT INTO contractor_time_logs (wo_id, wo_number, contractor_name)
    VALUES (v_wo.id, p_wo_number, v_name) RETURNING id INTO v_log_id;
  END IF;

  IF p_action = 'in' THEN
    UPDATE contractor_time_logs
       SET checked_in_at = v_at, checked_out_at = NULL,
           checked_in_lat = CASE WHEN v_pos THEN p_lat END,
           checked_in_lng = CASE WHEN v_pos THEN p_lng END,
           checked_in_accuracy = CASE WHEN v_pos THEN v_acc END,
           checked_out_lat = NULL, checked_out_lng = NULL, checked_out_accuracy = NULL,
           arrived_at  = CASE WHEN arrived_at IS NULL AND v_pos THEN v_at ELSE arrived_at END,
           arrived_lat = CASE WHEN arrived_at IS NULL AND v_pos THEN p_lat ELSE arrived_lat END,
           arrived_lng = CASE WHEN arrived_at IS NULL AND v_pos THEN p_lng ELSE arrived_lng END,
           updated_at = now()
     WHERE id = v_log_id;
    UPDATE work_orders SET wo_status = 'In Progress', updated_at = now()
     WHERE id = v_wo.id AND wo_status IN ('Open', 'Assigned');
  ELSE
    UPDATE contractor_time_logs
       SET checked_out_at = GREATEST(v_at, COALESCE(checked_in_at, v_at)),
           checked_out_lat = CASE WHEN v_pos THEN p_lat END,
           checked_out_lng = CASE WHEN v_pos THEN p_lng END,
           checked_out_accuracy = CASE WHEN v_pos THEN v_acc END,
           updated_at = now()
     WHERE id = v_log_id;
  END IF;

  -- Keep the tap itself, so a job worked over several days shows every day.
  INSERT INTO job_punches (user_id, wo_id, wo_number, contractor_name, kind, at, lat, lng, accuracy)
  VALUES (v_owner, v_wo.id, p_wo_number, v_name, p_action, v_at,
          CASE WHEN v_pos THEN p_lat END, CASE WHEN v_pos THEN p_lng END, CASE WHEN v_pos THEN v_acc END);

  RETURN jsonb_build_object('ok', true, 'reason', p_action, 'at', v_at, 'gps', v_pos);
END;
$$;
