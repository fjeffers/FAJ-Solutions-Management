-- Migration 113: Fred's own columns on the Dispatch board (2026-10-06).
--
-- Fred, looking at SimplySub's job board: "add some of these features to the
-- app". SimplySub has holding columns a job can sit in while it waits on
-- something: Revisit Needed, Pending Material, Waiting on Deliverables,
-- Pending Invoice, On Hold. FAJ's board columns come from the job's stage, so
-- a job can now also be parked in one of Fred's own columns
-- (Settings -> Lists & stages -> Extra board columns; user_settings.lists).
--
-- board_stage holds that column's key, or NULL for "wherever its stage puts
-- it". It never changes the stage, the money or what the tech sees.
--
-- get_portal_data (the tech's emailed link) sends whole job rows minus a strip
-- list, so board_stage is added to that list: "Ready to invoice" is office
-- business, not the tech's.

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS board_stage text;

DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.get_portal_data(text)'::regprocedure) INTO def;
  IF position('- ''board_stage''' in def) = 0 THEN
    def := replace(def, '- ''time_requests'' - ''custom'')', '- ''time_requests'' - ''custom'' - ''board_stage'')');
    IF position('- ''board_stage''' in def) = 0 THEN
      RAISE EXCEPTION 'get_portal_data: the strip list was not where expected';
    END IF;
    EXECUTE def;
  END IF;
END $$;

-- Message and photo counts for the board's job cards, counted in the database
-- (one call, exact however many messages there are). security invoker: RLS
-- still applies, so it only ever counts the signed-in owner's own rows.
CREATE OR REPLACE FUNCTION public.board_job_counts()
RETURNS TABLE(wo_id uuid, messages integer, photos integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
  SELECT w.id,
    (SELECT count(*) FROM work_order_messages m WHERE m.work_order_id = w.wo_number AND m.user_id = w.user_id)::int,
    (SELECT count(*) FROM wo_photos p WHERE p.wo_id = w.id)::int
  FROM work_orders w
  WHERE w.archived_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.board_job_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_job_counts() TO authenticated;
