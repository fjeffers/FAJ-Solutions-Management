-- Migration 147: each tech's rates for the client's copy of the job log (2026-10-30).
--
-- Fred: "i need a copy i can entered how much per an hour the milage for each
-- tech ... the client just asked for this then i need a copy with out it for
-- the tech". He picked "Rates and the dollars": the client's copy shows each
-- tech's hours × $ per hour and miles × $ per mile, and a total (PDF and
-- Excel); the tech's copy shows none of it (lib/job-log-rates.ts).
--
--   job_log_rates   one per work order: rates { "<tech>": { hour, mile } },
--                   each a dollar figure or null (not set).
--
-- Its own table, owner only, like the Field Sheet: the lead tech can read their
-- work order's row (contractors_view_own_workorders), so the rates the client
-- is billed don't go on work_orders.

CREATE TABLE IF NOT EXISTS public.job_log_rates (
  wo_id uuid PRIMARY KEY REFERENCES public.work_orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  rates jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_log_rates_shape CHECK (jsonb_typeof(rates) = 'object' AND pg_column_size(rates) < 8192)
);

ALTER TABLE public.job_log_rates ENABLE ROW LEVEL SECURITY;

-- The owner's own rates, on the owner's own work orders.
DROP POLICY IF EXISTS job_log_rates_owner ON public.job_log_rates;
CREATE POLICY job_log_rates_owner ON public.job_log_rates FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.work_orders w WHERE w.id = wo_id AND w.user_id = auth.uid()));
