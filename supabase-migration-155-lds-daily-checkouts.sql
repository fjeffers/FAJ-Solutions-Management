-- Migration 155: one structured LDS checkout per technician, work order and day.
-- Answers and labeled evidence stay in FAJ; a generated client report is later
-- attached to this row and copied to the matching SimplySub job.

CREATE TABLE IF NOT EXISTS public.lds_daily_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wo_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  wo_number text NOT NULL,
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  contractor_name text NOT NULL,
  day date NOT NULL,
  install_day text NOT NULL,
  progress text NOT NULL DEFAULT 'on_track'
    CHECK (progress IN ('on_track', 'at_risk', 'behind')),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz,
  report_url text,
  report_generated_at timestamptz,
  simplysub_file_key text,
  simplysub_uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wo_id, contractor_id, day)
);

CREATE INDEX IF NOT EXISTS lds_daily_checkouts_owner_day_idx
  ON public.lds_daily_checkouts (user_id, day DESC);
CREATE INDEX IF NOT EXISTS lds_daily_checkouts_job_idx
  ON public.lds_daily_checkouts (wo_id, day DESC);

ALTER TABLE public.lds_daily_checkouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner manages LDS daily checkouts" ON public.lds_daily_checkouts;
CREATE POLICY "Owner manages LDS daily checkouts"
  ON public.lds_daily_checkouts FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
REVOKE ALL ON public.lds_daily_checkouts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lds_daily_checkouts TO authenticated;

CREATE OR REPLACE FUNCTION public.tech_lds_checkout(p_wo_number text, p_day date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_row public.lds_daily_checkouts%ROWTYPE;
BEGIN
  IF v_ctx IS NULL OR p_wo_number IS NULL OR p_day IS NULL THEN RETURN NULL; END IF;
  IF (wf_tech_own_job(p_wo_number)).id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_row
  FROM public.lds_daily_checkouts c
  WHERE c.user_id = (v_ctx->>'owner_id')::uuid
    AND c.wo_number = p_wo_number
    AND c.contractor_id = (v_ctx->>'contractor_id')::uuid
    AND c.day = p_day;

  RETURN CASE WHEN v_row.id IS NULL THEN NULL ELSE to_jsonb(v_row) END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tech_save_lds_checkout(
  p_wo_number text,
  p_day date,
  p_data jsonb,
  p_submit boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx jsonb := tech_ctx();
  v_wo public.work_orders%ROWTYPE;
  v_start date;
  v_end date;
  v_install_day text;
  v_progress text;
  v_row public.lds_daily_checkouts%ROWTYPE;
BEGIN
  IF v_ctx IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_tech'); END IF;
  IF p_day IS NULL OR p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_checkout');
  END IF;
  v_wo := wf_tech_own_job(p_wo_number);
  IF v_wo.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_your_job'); END IF;

  v_start := COALESCE(v_wo.scheduled_date, v_wo.start_date, p_day);
  v_end := v_wo.end_date;
  v_install_day := CASE
    WHEN v_end IS NOT NULL AND p_day > v_end THEN 'return'
    WHEN p_day <= v_start THEN '1'
    WHEN (p_day - v_start + 1) >= 5 THEN '5'
    ELSE (p_day - v_start + 1)::text
  END;
  v_progress := CASE p_data->>'progress'
    WHEN 'behind' THEN 'behind'
    WHEN 'at_risk' THEN 'at_risk'
    ELSE 'on_track'
  END;

  INSERT INTO public.lds_daily_checkouts (
    user_id, wo_id, wo_number, contractor_id, contractor_name, day,
    install_day, progress, data, submitted_at, updated_at
  ) VALUES (
    (v_ctx->>'owner_id')::uuid, v_wo.id, v_wo.wo_number,
    (v_ctx->>'contractor_id')::uuid, v_ctx->>'contractor_name', p_day,
    v_install_day, v_progress, p_data,
    CASE WHEN p_submit THEN now() END, now()
  )
  ON CONFLICT (wo_id, contractor_id, day) DO UPDATE SET
    data = EXCLUDED.data,
    install_day = EXCLUDED.install_day,
    progress = EXCLUDED.progress,
    submitted_at = CASE
      WHEN p_submit THEN now()
      ELSE public.lds_daily_checkouts.submitted_at
    END,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'checkout', to_jsonb(v_row));
END;
$function$;

REVOKE ALL ON FUNCTION public.tech_lds_checkout(text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_save_lds_checkout(text, date, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tech_lds_checkout(text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_save_lds_checkout(text, date, jsonb, boolean) TO authenticated;
