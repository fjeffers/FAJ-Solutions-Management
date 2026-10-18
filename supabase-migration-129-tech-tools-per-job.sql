-- Migration 129: the tech's Tools only on jobs the office turns them on for (2026-10-18).
--
-- Fred, looking at the tech app's job screen: "Tools should only apply if
-- admin adds it". Tools = Scan, Sign a PDF, Read a code, Count, Measure.
--
--   work_orders.tech_tools   Off unless the office turns it on for the job,
--                            on the WorkFlow job page. Every job starts off,
--                            the ones already out included.
--   wf_tech_tools_on()       The tech's own live job: are Tools on? Same job
--                            check as wf_tech_job_files (migration 125). A
--                            separate call, so wf_tech_jobs() is not touched.
--
-- Documents the office shares for signing still reach the tech either way.

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS tech_tools boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.wf_tech_tools_on(p_wo_number text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_wo uuid;
BEGIN
  IF tech_ctx() IS NULL THEN RETURN false; END IF;
  v_wo := (wf_tech_photo_target(p_wo_number)->>'wo_id')::uuid;
  IF v_wo IS NULL THEN RETURN false; END IF;
  RETURN COALESCE((SELECT w.tech_tools FROM work_orders w WHERE w.id = v_wo), false);
END;
$$;
REVOKE ALL ON FUNCTION public.wf_tech_tools_on(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf_tech_tools_on(text) TO authenticated;
