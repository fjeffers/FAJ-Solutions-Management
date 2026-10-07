-- Migration 114: office notes on a job, and hours on the board's cards (2026-10-06).
--
-- Fred, again pointing at SimplySub's job board: "add some of these features
-- to the app". Two of them:
--
-- 1. job_notes — SimplySub's "Recent Notes": dated notes on a job with a kind
--    (General, Site, Billing, Client, Follow-up) and who wrote them. Office
--    only: owner RLS, nothing for anon, and no RPC hands them to a tech.
--
-- 2. board_job_counts() now also returns the hours worked on each job (the
--    blue hours badge on SimplySub's cards), worked out the way lib/tech-ledger
--    hoursOnJob does for each tech: clock punches first (in → out pairs), else
--    the time-log record (adjusted hours, or checked in → out), and when no
--    tech has anything, the job's own hours_worked. Changing the return type
--    needs a drop and re-create.

CREATE TABLE IF NOT EXISTS public.job_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wo_id       uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  body        text NOT NULL,
  kind        text NOT NULL DEFAULT 'General',
  author      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_notes_body_len CHECK (char_length(body) BETWEEN 1 AND 4000),
  CONSTRAINT job_notes_kind_len CHECK (char_length(kind) <= 40)
);
CREATE INDEX IF NOT EXISTS job_notes_wo_idx ON public.job_notes (wo_id, created_at DESC);

ALTER TABLE public.job_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner manages job notes" ON public.job_notes;
CREATE POLICY "Owner manages job notes" ON public.job_notes FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
REVOKE ALL ON public.job_notes FROM anon;

DROP FUNCTION IF EXISTS public.board_job_counts();
CREATE FUNCTION public.board_job_counts()
RETURNS TABLE(wo_id uuid, messages integer, photos integer, hours numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
  WITH live AS (
    SELECT w.id, w.wo_number, w.user_id, w.hours_worked FROM work_orders w WHERE w.archived_at IS NULL
  ),
  pp AS (
    SELECT p.wo_id, p.contractor_name, p.kind, p.at,
      lag(p.kind) OVER w AS prev_kind, lag(p.at) OVER w AS prev_at
    FROM job_punches p
    WHERE p.wo_id IN (SELECT id FROM live)
    WINDOW w AS (PARTITION BY p.wo_id, p.contractor_name ORDER BY p.at)
  ),
  punch AS (
    SELECT pp.wo_id, pp.contractor_name, sum(extract(epoch FROM (pp.at - pp.prev_at)) / 3600.0) AS h
    FROM pp WHERE pp.kind = 'out' AND pp.prev_kind = 'in'
    GROUP BY pp.wo_id, pp.contractor_name
  ),
  punched AS (
    SELECT DISTINCT p.wo_id, p.contractor_name FROM job_punches p WHERE p.wo_id IN (SELECT id FROM live)
  ),
  rec AS (
    SELECT r.wo_id,
      CASE WHEN r.adjusted_hours > 0 THEN r.adjusted_hours::numeric
           WHEN r.checked_in_at IS NOT NULL AND r.checked_out_at IS NOT NULL
             THEN (extract(epoch FROM (r.checked_out_at - r.checked_in_at)) / 3600.0)::numeric
      END AS h
    FROM contractor_time_logs r
    WHERE r.wo_id IN (SELECT id FROM live)
      AND NOT EXISTS (SELECT 1 FROM punched x WHERE x.wo_id = r.wo_id AND x.contractor_name = r.contractor_name)
  ),
  tech AS (
    SELECT t.wo_id, sum(t.h) AS h FROM (
      SELECT punch.wo_id, punch.h::numeric AS h FROM punch
      UNION ALL SELECT rec.wo_id, rec.h FROM rec WHERE rec.h IS NOT NULL
    ) t GROUP BY t.wo_id
  )
  SELECT l.id,
    (SELECT count(*) FROM work_order_messages m WHERE m.work_order_id = l.wo_number AND m.user_id = l.user_id)::int,
    (SELECT count(*) FROM wo_photos p WHERE p.wo_id = l.id)::int,
    round(coalesce(tech.h, nullif(l.hours_worked, 0)::numeric), 2)
  FROM live l LEFT JOIN tech ON tech.wo_id = l.id;
$$;
REVOKE ALL ON FUNCTION public.board_job_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_job_counts() TO authenticated;
